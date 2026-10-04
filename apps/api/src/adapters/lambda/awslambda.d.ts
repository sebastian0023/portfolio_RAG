// The Lambda Node.js runtime injects `awslambda` as a global for response streaming. Only the surface
// this repository uses is declared.
interface LambdaResponseStream {
  write(chunk: string | Uint8Array): boolean;
  end(chunk?: string | Uint8Array): void;
  on(event: 'close' | 'error', listener: () => void): this;
}

declare namespace awslambda {
  function streamifyResponse(
    handler: (
      event: unknown,
      responseStream: LambdaResponseStream,
      context: unknown,
    ) => Promise<void>,
  ): (event: unknown, context: unknown) => Promise<void>;

  const HttpResponseStream: {
    from(
      responseStream: LambdaResponseStream,
      metadata: {
        statusCode: number;
        headers?: Record<string, string>;
      },
    ): LambdaResponseStream;
  };
}
