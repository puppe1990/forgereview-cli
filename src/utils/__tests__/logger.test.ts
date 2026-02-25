import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cliLogger, isQuietMode, isVerboseMode } from '../logger.js';

describe('cliLogger', () => {
  const originalQuiet = process.env.FORGEREVIEW_QUIET;
  const originalVerbose = process.env.FORGEREVIEW_VERBOSE;

  beforeEach(() => {
    delete process.env.FORGEREVIEW_QUIET;
    delete process.env.FORGEREVIEW_VERBOSE;
  });

  afterEach(() => {
    if (originalQuiet === undefined) delete process.env.FORGEREVIEW_QUIET;
    else process.env.FORGEREVIEW_QUIET = originalQuiet;
    if (originalVerbose === undefined) delete process.env.FORGEREVIEW_VERBOSE;
    else process.env.FORGEREVIEW_VERBOSE = originalVerbose;
    vi.restoreAllMocks();
  });

  it('reads quiet/verbose flags from env', () => {
    process.env.FORGEREVIEW_QUIET = 'true';
    process.env.FORGEREVIEW_VERBOSE = 'true';

    expect(isQuietMode()).toBe(true);
    expect(isVerboseMode()).toBe(true);
  });

  it('suppresses info and warn in quiet mode', () => {
    process.env.FORGEREVIEW_QUIET = 'true';
    const stdoutSpy = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    const stderrSpy = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);

    cliLogger.info('hello');
    cliLogger.warn('warn');

    expect(stdoutSpy).not.toHaveBeenCalled();
    expect(stderrSpy).not.toHaveBeenCalled();
  });

  it('writes warn/error/verbose to stderr and info to stdout', () => {
    process.env.FORGEREVIEW_VERBOSE = 'true';
    const stdoutSpy = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    const stderrSpy = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);

    cliLogger.info('info');
    cliLogger.warn('warn');
    cliLogger.error('error');
    cliLogger.verbose('verbose');

    expect(stdoutSpy).toHaveBeenCalledWith('info\n');
    expect(stderrSpy).toHaveBeenCalledWith('warn\n');
    expect(stderrSpy).toHaveBeenCalledWith('error\n');
    expect(stderrSpy).toHaveBeenCalledWith('verbose\n');
  });
});
