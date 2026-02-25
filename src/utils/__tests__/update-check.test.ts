import { describe, it, expect } from 'vitest';
import { isNewerVersion, shouldShowUpdateBanner } from '../update-check.js';

describe('isNewerVersion', () => {
  it('returns true when latest patch is higher', () => {
    expect(isNewerVersion('0.1.7', '0.1.8')).toBe(true);
  });

  it('returns false when versions are equal', () => {
    expect(isNewerVersion('0.1.7', '0.1.7')).toBe(false);
  });

  it('returns false when current minor is higher', () => {
    expect(isNewerVersion('0.2.0', '0.1.9')).toBe(false);
  });

  it('returns false when current major is higher', () => {
    expect(isNewerVersion('1.0.0', '0.99.99')).toBe(false);
  });

  it('returns true when latest major is higher', () => {
    expect(isNewerVersion('0.1.7', '1.0.0')).toBe(true);
  });

  it('handles versions with missing parts', () => {
    expect(isNewerVersion('1.0', '1.0.1')).toBe(true);
  });

  it('returns false when current has more parts but is equal', () => {
    expect(isNewerVersion('1.0.0', '1.0')).toBe(false);
  });
});

describe('shouldShowUpdateBanner', () => {
  it('hides banner for structured output formats', () => {
    const stdoutDesc = Object.getOwnPropertyDescriptor(process.stdout, 'isTTY');
    const stderrDesc = Object.getOwnPropertyDescriptor(process.stderr, 'isTTY');
    Object.defineProperty(process.stdout, 'isTTY', { value: true, configurable: true });
    Object.defineProperty(process.stderr, 'isTTY', { value: true, configurable: true });

    expect(shouldShowUpdateBanner({ format: 'json' })).toBe(false);
    expect(shouldShowUpdateBanner({ format: 'markdown' })).toBe(false);
    expect(shouldShowUpdateBanner({ output: 'out.json' })).toBe(false);
    expect(shouldShowUpdateBanner({ quiet: true })).toBe(false);
    expect(shouldShowUpdateBanner({ format: 'terminal' })).toBe(true);

    if (stdoutDesc) Object.defineProperty(process.stdout, 'isTTY', stdoutDesc);
    if (stderrDesc) Object.defineProperty(process.stderr, 'isTTY', stderrDesc);
  });
});
