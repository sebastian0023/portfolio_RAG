import type { Logger, LogEvent } from '../../core/ports/logger.js';

// One JSON line per event on stdout; Lambda's JSON log format indexes the fields. LogEvent is closed, so no
// request content can reach this sink (ADR-028).
export function createJsonLogger(
  write: (line: string) => void = (line) => {
    process.stdout.write(line);
  },
): Logger {
  return {
    log(event: LogEvent): void {
      write(`${JSON.stringify({ level: 'INFO', ...event })}\n`);
    },
  };
}
