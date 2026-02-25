import { spawn } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import type { ReviewIssue, ReviewResult, Severity, IssueCategory, CodeFix } from '../types/index.js';

const CODEX_COMMAND = process.env.FORGEREVIEW_CODEX_COMMAND || 'codex';

const REVIEW_RESULT_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    summary: { type: 'string' },
    filesAnalyzed: { type: 'integer', minimum: 0 },
    issues: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        properties: {
          file: { type: 'string' },
          line: { type: 'integer', minimum: 1 },
          endLine: { type: ['integer', 'null'], minimum: 1 },
          severity: { type: 'string', enum: ['info', 'warning', 'error', 'critical'] },
          category: {
            type: ['string', 'null'],
            enum: [
              'security_vulnerability',
              'performance',
              'code_quality',
              'best_practices',
              'style',
              'bug',
              'complexity',
              'maintainability',
              null,
            ],
          },
          message: { type: 'string' },
          suggestion: { type: ['string', 'null'] },
          recommendation: { type: ['string', 'null'] },
          ruleId: { type: ['string', 'null'] },
          fixable: { type: 'boolean' },
          fix: {
            type: ['object', 'null'],
            additionalProperties: false,
            properties: {
              type: { type: ['string', 'null'], enum: ['replace', 'insert', 'delete', null] },
              startLine: { type: ['integer', 'null'], minimum: 1 },
              endLine: { type: ['integer', 'null'], minimum: 1 },
              oldCode: { type: ['string', 'null'] },
              newCode: { type: ['string', 'null'] },
            },
            required: ['type', 'startLine', 'endLine', 'oldCode', 'newCode'],
          },
        },
        required: ['file', 'line', 'endLine', 'severity', 'category', 'message', 'suggestion', 'recommendation', 'ruleId', 'fixable', 'fix'],
      },
    },
  },
  required: ['summary', 'filesAnalyzed', 'issues'],
} as const;

interface ProcessResult {
  code: number;
  stdout: string;
  stderr: string;
}

interface CodexStatus {
  available: boolean;
  version?: string;
}

class CodexReviewService {
  async analyze(diff: string, options?: { verbose?: boolean; fast?: boolean; rulesOnly?: boolean; timeoutMs?: number }): Promise<ReviewResult> {
    if (!diff.trim()) {
      return {
        summary: 'No changes to analyze',
        filesAnalyzed: 0,
        issues: [],
        duration: 0,
      };
    }

    const startedAt = Date.now();
    const schemaPath = await this.writeOutputSchema();

    try {
      const prompt = this.buildPrompt(diff, options);
      const result = await this.runCodex(prompt, schemaPath, options?.timeoutMs);

      if (result.code !== 0) {
        const errorOutput = [result.stderr, result.stdout].filter(Boolean).join('\n').trim();
        throw new Error(
          errorOutput
            ? `Codex CLI review failed: ${errorOutput}`
            : 'Codex CLI review failed with a non-zero exit code.',
        );
      }

      const parsed = this.parseJsonObject(result.stdout);
      const normalized = this.normalizeReviewResult(parsed, startedAt);

      if (options?.verbose) {
        console.log(`[verbose] Codex CLI issues: ${normalized.issues.length}`);
      }

      return normalized;
    } finally {
      await fs.unlink(schemaPath).catch(() => {});
    }
  }

  async getCliStatus(): Promise<CodexStatus> {
    const result = await this.runCommand([CODEX_COMMAND, '--version']);
    if (result.code !== 0) {
      return { available: false };
    }

    const version = result.stdout.trim() || undefined;
    return { available: true, version };
  }

  private async writeOutputSchema(): Promise<string> {
    const schemaPath = path.join(os.tmpdir(), `forgereview-codex-review-schema-${process.pid}-${Date.now()}.json`);
    await fs.writeFile(schemaPath, JSON.stringify(REVIEW_RESULT_SCHEMA, null, 2), 'utf-8');
    return schemaPath;
  }

  private buildPrompt(diff: string, options?: { fast?: boolean; rulesOnly?: boolean }): string {
    const modeHints: string[] = [];

    if (options?.fast) {
      modeHints.push('Use a lighter pass and only report high-signal findings.');
    }

    if (options?.rulesOnly) {
      modeHints.push('Prioritize deterministic rule-like issues and avoid speculative suggestions.');
    }

    return [
      'You are reviewing a git diff and must return ONLY valid JSON according to the provided output schema.',
      'Find concrete issues in changed code: bugs, security risks, regressions, performance issues, and maintainability problems.',
      'Do not invent files or line numbers. Use only files and lines present in the diff hunks.',
      'When possible, include a safe, minimal code fix per issue. If no safe fix is possible, set fixable=false and fix=null.',
      'For fixable=true, provide exact patch details with type/startLine/endLine/oldCode/newCode.',
      modeHints.join(' '),
      '',
      'Git diff to analyze:',
      diff,
    ]
      .filter(Boolean)
      .join('\n');
  }

  private async runCodex(prompt: string, schemaPath: string, timeoutMs?: number): Promise<ProcessResult> {
    return this.runCommand([
      CODEX_COMMAND,
      'exec',
      '-',
      '--skip-git-repo-check',
      '--color',
      'never',
      '--output-schema',
      schemaPath,
    ], prompt, timeoutMs);
  }

  private runCommand(commandAndArgs: string[], stdinInput?: string, timeoutMs?: number): Promise<ProcessResult> {
    const [command, ...args] = commandAndArgs;

    return new Promise((resolve, reject) => {
      const child = spawn(command, args, {
        stdio: ['pipe', 'pipe', 'pipe'],
        env: {
          ...process.env,
          NO_COLOR: '1',
          FORCE_COLOR: '0',
        },
      });

      let stdout = '';
      let stderr = '';
      let didTimeout = false;
      let timer: NodeJS.Timeout | undefined;

      child.stdout.on('data', (chunk) => {
        stdout += chunk.toString();
      });

      child.stderr.on('data', (chunk) => {
        stderr += chunk.toString();
      });

      child.on('error', (error) => {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
          reject(new Error(`Codex CLI not found. Install it and ensure '${CODEX_COMMAND}' is on PATH.`));
          return;
        }
        reject(error);
      });

      child.on('close', (code) => {
        if (timer) clearTimeout(timer);
        if (didTimeout) {
          resolve({
            code: 124,
            stdout,
            stderr: `${stderr}\nCodex CLI timed out after ${timeoutMs}ms`.trim(),
          });
          return;
        }
        resolve({ code: code ?? 1, stdout, stderr });
      });

      if (timeoutMs && timeoutMs > 0) {
        timer = setTimeout(() => {
          didTimeout = true;
          child.kill('SIGKILL');
        }, timeoutMs);
      }

      if (stdinInput !== undefined) {
        child.stdin.write(stdinInput);
      }
      child.stdin.end();
    });
  }

  private parseJsonObject(output: string): unknown {
    const trimmed = output.trim();
    if (!trimmed) {
      throw new Error('Codex CLI returned an empty response.');
    }

    const start = trimmed.indexOf('{');
    if (start === -1) {
      throw new Error('Codex CLI did not return JSON output.');
    }

    let depth = 0;
    let inString = false;
    let escaped = false;

    for (let i = start; i < trimmed.length; i++) {
      const ch = trimmed[i];

      if (inString) {
        if (escaped) {
          escaped = false;
        } else if (ch === '\\') {
          escaped = true;
        } else if (ch === '"') {
          inString = false;
        }
        continue;
      }

      if (ch === '"') {
        inString = true;
        continue;
      }

      if (ch === '{') {
        depth += 1;
        continue;
      }

      if (ch === '}') {
        depth -= 1;
        if (depth === 0) {
          return JSON.parse(trimmed.slice(start, i + 1));
        }
      }
    }

    throw new Error('Codex CLI returned incomplete JSON output.');
  }

  private normalizeReviewResult(raw: unknown, startedAt: number): ReviewResult {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
      throw new Error('Codex CLI returned an invalid review payload.');
    }

    const payload = raw as {
      summary?: unknown;
      filesAnalyzed?: unknown;
      issues?: unknown;
    };

    const summary = typeof payload.summary === 'string' && payload.summary.trim().length > 0
      ? payload.summary.trim()
      : 'Codex review completed';

    const issuesArray = Array.isArray(payload.issues) ? payload.issues : [];
    const issues = issuesArray
      .map((issue) => this.normalizeIssue(issue))
      .filter((issue): issue is ReviewIssue => issue !== null);

    const filesAnalyzed = typeof payload.filesAnalyzed === 'number' && Number.isFinite(payload.filesAnalyzed)
      ? Math.max(0, Math.floor(payload.filesAnalyzed))
      : new Set(issues.map((issue) => issue.file)).size;

    return {
      summary,
      filesAnalyzed,
      issues,
      duration: Math.max(1, Date.now() - startedAt),
    };
  }

  private normalizeIssue(issue: unknown): ReviewIssue | null {
    if (!issue || typeof issue !== 'object' || Array.isArray(issue)) {
      return null;
    }

    const raw = issue as {
      file?: unknown;
      line?: unknown;
      endLine?: unknown;
      severity?: unknown;
      category?: unknown;
      message?: unknown;
      suggestion?: unknown;
      recommendation?: unknown;
      ruleId?: unknown;
      fixable?: unknown;
      fix?: unknown;
    };

    if (typeof raw.file !== 'string' || typeof raw.line !== 'number' || typeof raw.message !== 'string') {
      return null;
    }

    const severity = this.normalizeSeverity(raw.severity);
    const fix = this.normalizeFix(raw.fix);

    return {
      file: raw.file,
      line: Math.max(1, Math.floor(raw.line)),
      endLine: typeof raw.endLine === 'number' ? Math.max(1, Math.floor(raw.endLine)) : undefined,
      severity,
      category: this.normalizeCategory(raw.category),
      message: raw.message,
      suggestion: typeof raw.suggestion === 'string' ? raw.suggestion : undefined,
      recommendation: typeof raw.recommendation === 'string' ? raw.recommendation : undefined,
      ruleId: typeof raw.ruleId === 'string' ? raw.ruleId : undefined,
      fixable: raw.fixable === true && fix !== null,
      fix: fix ?? undefined,
    };
  }

  private normalizeFix(value: unknown): CodeFix | null {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      return null;
    }

    const raw = value as {
      type?: unknown;
      startLine?: unknown;
      endLine?: unknown;
      oldCode?: unknown;
      newCode?: unknown;
    };

    if (
      (raw.type !== 'replace' && raw.type !== 'insert' && raw.type !== 'delete')
      || typeof raw.startLine !== 'number'
      || typeof raw.endLine !== 'number'
      || typeof raw.newCode !== 'string'
    ) {
      return null;
    }

    return {
      type: raw.type,
      startLine: Math.max(1, Math.floor(raw.startLine)),
      endLine: Math.max(1, Math.floor(raw.endLine)),
      oldCode: typeof raw.oldCode === 'string' ? raw.oldCode : '',
      newCode: raw.newCode,
    };
  }

  private normalizeSeverity(value: unknown): Severity {
    if (value === 'critical' || value === 'error' || value === 'warning' || value === 'info') {
      return value;
    }
    return 'info';
  }

  private normalizeCategory(value: unknown): IssueCategory | undefined {
    const allowed: IssueCategory[] = [
      'security_vulnerability',
      'performance',
      'code_quality',
      'best_practices',
      'style',
      'bug',
      'complexity',
      'maintainability',
    ];

    if (typeof value === 'string' && allowed.includes(value as IssueCategory)) {
      return value as IssueCategory;
    }

    return undefined;
  }
}

export const codexReviewService = new CodexReviewService();
