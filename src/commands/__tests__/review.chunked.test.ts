import { describe, it, expect } from 'vitest';
import type { ReviewResult } from '../../types/index.js';
import { __reviewInternals } from '../review.js';

describe('review chunked internals', () => {
  it('merges chunked results with structured meta, dedupe and sorting', () => {
    const baseIssue = {
      file: 'b.ts',
      line: 10,
      severity: 'warning' as const,
      message: ' Duplicate   message ',
      ruleId: 'dup-rule',
      fixable: false,
    };

    const results: ReviewResult[] = [
      {
        summary: 'chunk1',
        filesAnalyzed: 1,
        duration: 100,
        issues: [
          baseIssue,
          { file: 'a.ts', line: 2, severity: 'critical', message: 'Critical issue', fixable: false },
        ],
      },
      {
        summary: 'chunk2',
        filesAnalyzed: 1,
        duration: 80,
        issues: [
          { ...baseIssue, message: 'duplicate message' },
          { file: 'a.ts', line: 5, severity: 'error', message: 'Error issue', fixable: false },
        ],
      },
    ];

    const merged = __reviewInternals.mergeResults({
      results,
      processedFiles: new Set(['a.ts', 'b.ts']),
      failedFiles: new Set(['c.ts']),
      successfulChunks: 2,
      failedChunks: 1,
      telemetry: [],
    } as any, 3, 3, true);

    expect(merged.issues).toHaveLength(3);
    expect(merged.issues.map((i) => `${i.severity}:${i.file}:${i.line}`)).toEqual([
      'critical:a.ts:2',
      'error:a.ts:5',
      'warning:b.ts:10',
    ]);

    expect(merged.meta?.chunkedReview).toMatchObject({
      chunked: true,
      totalChunks: 3,
      successfulChunks: 2,
      failedChunks: 1,
      totalFiles: 3,
      processedFiles: 2,
      failedFiles: ['c.ts'],
      coverage: 67,
      partial: true,
    });
  });

  it('normalizes totalChunks when recursive splits produce more chunk executions than planned', () => {
    const merged = __reviewInternals.mergeResults({
      results: [],
      processedFiles: new Set<string>(),
      failedFiles: new Set<string>(['x.ts']),
      successfulChunks: 3,
      failedChunks: 1,
      telemetry: [],
    } as any, 1, 2, true);

    expect(merged.meta?.chunkedReview?.totalChunks).toBe(4);
    expect(merged.summary).toContain('3/4 chunks succeeded');
  });

  it('detects non-interactive terminal when stdio TTY flags are false', () => {
    const stdinDesc = Object.getOwnPropertyDescriptor(process.stdin, 'isTTY');
    const stdoutDesc = Object.getOwnPropertyDescriptor(process.stdout, 'isTTY');

    Object.defineProperty(process.stdin, 'isTTY', { value: false, configurable: true });
    Object.defineProperty(process.stdout, 'isTTY', { value: false, configurable: true });

    expect(__reviewInternals.isInteractiveTerminal()).toBe(false);

    if (stdinDesc) Object.defineProperty(process.stdin, 'isTTY', stdinDesc);
    if (stdoutDesc) Object.defineProperty(process.stdout, 'isTTY', stdoutDesc);
  });
});
