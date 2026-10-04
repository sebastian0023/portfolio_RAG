// Composition root of the API (ADR-043): the only place that builds adapters and wires them into core.
// Production rejects anything else, so an invalid environment fails at init instead of at the first request.
import { SSMClient } from '@aws-sdk/client-ssm';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { createHttpApp } from './adapters/http/app.js';
import { createStreamHandler } from './adapters/lambda/stream-handler.js';
import { createJsonLogger } from './adapters/logging/json-logger.js';
import { SsmConfigSource } from './adapters/ssm/ssm-config-source.js';
import {
  byteCapStage,
  configStage,
  contentTypeStage,
  schemaStage,
} from './core/chat/admission.js';
import { createChatHandler } from './core/chat/chat-handler.js';
import { unavailableService } from './core/chat/unavailable-service.js';
import { CachedConfig } from './core/config/cached-config.js';

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

const handleChat = createChatHandler({
  stages: [contentTypeStage, byteCapStage, schemaStage, configStage(config)],
  service: unavailableService,
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
