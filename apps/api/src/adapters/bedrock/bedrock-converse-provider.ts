import {
  ConverseStreamCommand,
  type ConverseStreamCommandOutput,
} from '@aws-sdk/client-bedrock-runtime';
import type {
  LLMError,
  LLMEvent,
  LLMProvider,
  LLMRequest,
  LLMStopReason,
  LLMUsage,
} from '@portfolio/shared';
import { converseEventSchema } from './converse-stream-schema.js';
import { mapSdkError, mapStopReason, STREAM_EXCEPTIONS } from './error-map.js';

export interface BedrockClientLike {
  send(
    command: ConverseStreamCommand,
    options?: { abortSignal?: AbortSignal },
  ): Promise<ConverseStreamCommandOutput>;
}

// Bedrock Converse streaming adapter (ADR-037). It sends no retries (the SDK client is built with
// maxAttempts 1, ADR-024), bounds output with maxTokens only, and emits the provider-neutral event order:
// delta*, usage (once, if reported), then exactly one terminal event. Bedrock reports usage after the stop
// reason, so the terminal event is held back until the stream ends.
export function createBedrockConverseProvider(
  client: BedrockClientLike,
  modelId: string,
): LLMProvider {
  return {
    id: `bedrock-runtime:${modelId}`,

    async *stream(
      request: LLMRequest,
      signal?: AbortSignal,
    ): AsyncGenerator<LLMEvent> {
      const cancelled: LLMEvent = {
        type: 'error',
        error: { code: 'cancelled', retryable: false },
      };
      if (signal?.aborted) {
        yield cancelled;
        return;
      }

      let output: ConverseStreamCommandOutput;
      try {
        output = await client.send(
          new ConverseStreamCommand({
            modelId,
            system: [{ text: request.systemPrompt }],
            messages: [
              ...request.history.map((turn) => ({
                role: turn.role,
                content: [{ text: turn.text }],
              })),
              {
                role: 'user' as const,
                content: [{ text: request.userMessage }],
              },
            ],
            inferenceConfig: { maxTokens: request.maxOutputTokens },
          }),
          signal === undefined ? {} : { abortSignal: signal },
        );
      } catch (error) {
        yield { type: 'error', error: mapSdkError(error, signal) };
        return;
      }

      let usage: LLMUsage | undefined;
      let terminal:
        | { kind: 'done'; stopReason: LLMStopReason }
        | { kind: 'error'; error: LLMError }
        | undefined;

      try {
        for await (const raw of output.stream ?? []) {
          const parsed = converseEventSchema.safeParse(raw);
          if (!parsed.success) {
            yield {
              type: 'error',
              error: { code: 'internal', retryable: false },
            };
            return;
          }
          const event = parsed.data;

          const exception = Object.keys(STREAM_EXCEPTIONS).find(
            (member) =>
              member in event &&
              event[member as keyof typeof event] !== undefined,
          );
          if (exception !== undefined) {
            yield {
              type: 'error',
              error: mapSdkError(
                { name: STREAM_EXCEPTIONS[exception] },
                signal,
              ),
            };
            return;
          }
          const text = event.contentBlockDelta?.delta.text;
          if (text !== undefined && text !== '') {
            yield { type: 'delta', text };
          }
          if (event.messageStop) {
            terminal = mapStopReason(event.messageStop.stopReason);
          }
          const reported = event.metadata?.usage;
          if (reported) usage = reported;
        }
      } catch (error) {
        yield { type: 'error', error: mapSdkError(error, signal) };
        return;
      }

      if (signal?.aborted) {
        yield cancelled;
        return;
      }
      if (terminal === undefined) {
        // The stream ended without a stop reason: the answer is incomplete.
        yield {
          type: 'error',
          error: { code: 'unavailable', retryable: true },
        };
        return;
      }
      if (usage) yield { type: 'usage', usage };
      yield terminal.kind === 'done'
        ? { type: 'done', stopReason: terminal.stopReason }
        : { type: 'error', error: terminal.error };
    },
  };
}
