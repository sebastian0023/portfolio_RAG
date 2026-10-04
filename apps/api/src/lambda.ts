// Composition root of the API (ADR-043): the only place that builds adapters and wires them into core.
// Production rejects anything else, so an invalid environment fails at init instead of at the first request.
import { BedrockRuntimeClient } from '@aws-sdk/client-bedrock-runtime';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { SSMClient } from '@aws-sdk/client-ssm';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { createBedrockConverseProvider } from './adapters/bedrock/bedrock-converse-provider.js';
import { createHttpApp } from './adapters/http/app.js';
import { createStreamHandler } from './adapters/lambda/stream-handler.js';
import { DynamoDbCounterStore } from './adapters/dynamodb/dynamodb-counter-store.js';
import { createJsonLogger } from './adapters/logging/json-logger.js';
import { SsmConfigSource } from './adapters/ssm/ssm-config-source.js';
import {
  byteCapStage,
  configStage,
  contentTypeStage,
  providerStage,
  schemaStage,
} from './core/chat/admission.js';
import {
  chatEnabledStage,
  dailyCapStage,
  preAuthRateStage,
  trustedIpStage,
} from './core/admission/stages.js';
import { createChatHandler } from './core/chat/chat-handler.js';
import { createPlainChatService } from './core/chat/plain-chat-service.js';
import { CachedConfig } from './core/config/cached-config.js';
import { ProviderRegistry } from './core/llm/provider-registry.js';

const environmentSchema = z.object({
  APP_ENV: z.literal('production'),
  PARAMETER_PREFIX: z.string().regex(/^\/portfolio-v2\/[a-z]+$/),
  COUNTERS_TABLE: z.string().min(1),
  AWS_REGION: z.string().min(1),
});

const env = environmentSchema.parse(process.env);

const logger = createJsonLogger();
const config = new CachedConfig(
  new SsmConfigSource(
    new SSMClient({ region: env.AWS_REGION }),
    env.PARAMETER_PREFIX,
  ),
);

// Zero retries: a retried generation would bill twice for one admitted request (ADR-024). The bedrock-mantle
// (Gemma) adapter is registered in P6-03; until then that config is refused before anything is spent.
const bedrock = new BedrockRuntimeClient({
  region: env.AWS_REGION,
  maxAttempts: 1,
  requestHandler: { connectionTimeout: 3000 },
});
const registry = new ProviderRegistry().register('bedrock-runtime', (model) =>
  createBedrockConverseProvider(bedrock, model),
);

// A failed counter write or an unreadable response refuses the request (fail closed, ADR-017).
const counters = new DynamoDbCounterStore(
  new DynamoDBClient({ region: env.AWS_REGION, maxAttempts: 2 }),
  env.COUNTERS_TABLE,
);

// Cheapest first, nothing paid before the last stage (ADR-016, ADR-039). The rate limit runs before the
// chat_enabled check so it needs no model; every paid step still sits behind chat_enabled.
const handleChat = createChatHandler({
  stages: [
    contentTypeStage,
    byteCapStage,
    schemaStage,
    configStage(config),
    trustedIpStage,
    preAuthRateStage(counters),
    chatEnabledStage,
    providerStage(registry),
    dailyCapStage(counters),
  ],
  service: createPlainChatService({ logger }),
  logger,
});

export const handler = awslambda.streamifyResponse(
  createStreamHandler({
    app: createHttpApp({ handleChat, newRequestId: randomUUID }),
    httpResponseStream: awslambda.HttpResponseStream,
    logger,
    newRequestId: randomUUID,
  }),
);
