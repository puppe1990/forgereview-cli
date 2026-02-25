import { inspect } from 'node:util';

function envFlag(name: string): boolean {
  return process.env[name] === 'true';
}

export function isQuietMode(): boolean {
  return envFlag('FORGEREVIEW_QUIET');
}

export function isVerboseMode(): boolean {
  return envFlag('FORGEREVIEW_VERBOSE');
}

function formatLogMessage(message: unknown): string {
  if (typeof message === 'string') return message;
  return inspect(message, { colors: false, depth: 5, breakLength: 120 });
}

function write(stream: NodeJS.WriteStream, message: unknown): void {
  stream.write(`${formatLogMessage(message)}\n`);
}

export const cliLogger = {
  info(message: unknown): void {
    if (isQuietMode()) return;
    write(process.stdout, message);
  },
  warn(message: unknown): void {
    if (isQuietMode()) return;
    write(process.stderr, message);
  },
  error(message: unknown): void {
    write(process.stderr, message);
  },
  verbose(message: unknown): void {
    if (!isVerboseMode() || isQuietMode()) return;
    write(process.stderr, message);
  },
};
