import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { startMockServer, type MockServer } from './mock-server.js';

const execFileAsync = promisify(execFile);
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(__dirname, '../..');
const CLI_PATH = path.join(PROJECT_ROOT, 'dist/index.js');

let mockServer: MockServer;
let tmpHome: string;
let gitRepoDir: string;
let mockBinDir: string;
let mockCodexLogPath: string;

interface CliResult {
  stdout: string;
  stderr: string;
  exitCode: number;
}

interface MockCodexInvocation {
  args: string[];
  stdin: string;
}

function parseFirstJsonObject(output: string): any {
  const start = output.indexOf('{');
  if (start === -1) {
    throw new Error('No JSON object found in CLI output');
  }

  let depth = 0;
  let inString = false;
  let escaped = false;

  for (let i = start; i < output.length; i++) {
    const ch = output[i];

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
        return JSON.parse(output.slice(start, i + 1));
      }
    }
  }

  throw new Error('Incomplete JSON object in CLI output');
}

async function runCli(
  args: string[],
  opts: { cwd?: string; env?: Record<string, string> } = {},
): Promise<CliResult> {
  try {
    const { stdout, stderr } = await execFileAsync('node', [CLI_PATH, ...args], {
      cwd: opts.cwd ?? gitRepoDir,
      env: {
        PATH: `${mockBinDir}${path.delimiter}${process.env.PATH ?? ''}`,
        HOME: tmpHome,
        FORGEREVIEW_API_URL: mockServer.url,
        FORGEREVIEW_CODEX_COMMAND: 'codex',
        NO_COLOR: '1',
        FORCE_COLOR: '0',
        NODE_NO_WARNINGS: '1',
        ...opts.env,
      },
      timeout: 30_000,
    });
    return { stdout, stderr, exitCode: 0 };
  } catch (error: any) {
    return {
      stdout: error.stdout ?? '',
      stderr: error.stderr ?? '',
      exitCode: typeof error.code === 'number' ? error.code : 1,
    };
  }
}

async function readMockCodexInvocations(): Promise<MockCodexInvocation[]> {
  try {
    const content = await fs.readFile(mockCodexLogPath, 'utf-8');
    return content
      .split('\n')
      .map((line) => line.trim())
      .filter(Boolean)
      .map((line) => JSON.parse(line) as MockCodexInvocation);
  } catch {
    return [];
  }
}

async function resetMockCodexInvocations(): Promise<void> {
  if (!mockCodexLogPath) return;
  await fs.writeFile(mockCodexLogPath, '', 'utf-8').catch(() => {});
}

async function createMockCodexBinary(logPath: string): Promise<string> {
  const binDir = await fs.mkdtemp(path.join(os.tmpdir(), 'forgereview-mock-codex-bin-'));
  const scriptPath = path.join(binDir, 'codex');
  const escapedLogPath = JSON.stringify(logPath);
  const script = `#!/usr/bin/env node
const fs = require('node:fs');
const args = process.argv.slice(2);
if (args.includes('--version')) {
  process.stdout.write('codex-mock 0.0.0\\n');
  process.exit(0);
}
if (args[0] === 'exec') {
  let stdin = '';
  process.stdin.setEncoding('utf8');
  process.stdin.on('data', (c) => { stdin += c; });
  process.stdin.on('end', () => {
    fs.appendFileSync(${escapedLogPath}, JSON.stringify({ args, stdin }) + '\\n');
    const issueCount = stdin.includes('let z = 3') ? 1 : 0;
    const payload = {
      summary: issueCount ? 'Mock review found 1 issue' : 'No issues found',
      filesAnalyzed: 1,
      issues: issueCount ? [{
        file: 'test.ts',
        line: 3,
        endLine: null,
        severity: 'warning',
        category: 'code_quality',
        message: 'Mock issue',
        suggestion: 'Use const',
        recommendation: null,
        ruleId: 'mock-rule',
        fixable: false,
        fix: null
      }] : []
    };
    process.stdout.write(JSON.stringify(payload));
    process.exit(0);
  });
  process.stdin.resume();
  return;
}
process.stderr.write('Unsupported mock codex invocation\\n');
process.exit(1);
`;
  await fs.writeFile(scriptPath, script, { mode: 0o755 });
  return binDir;
}

async function createTempGitRepo(): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'forgereview-test-repo-'));
  await execFileAsync('git', ['init'], { cwd: dir });
  await execFileAsync('git', ['config', 'user.email', 'test@test.com'], { cwd: dir });
  await execFileAsync('git', ['config', 'user.name', 'Test'], { cwd: dir });
  return dir;
}

beforeAll(async () => {
  // 1. Isolated HOME so ~/.forgereview is temp
  tmpHome = await fs.mkdtemp(path.join(os.tmpdir(), 'forgereview-test-home-'));
  const forgereviewDir = path.join(tmpHome, '.forgereview');
  await fs.mkdir(forgereviewDir, { recursive: true });

  // 2. Team key config
  await fs.writeFile(
    path.join(forgereviewDir, 'config.json'),
    JSON.stringify({
      teamKey: 'forgereview_test_key',
      teamName: 'Test Team',
      organizationName: 'Test Org',
    }),
  );

  // 3. Git repo with uncommitted changes
  gitRepoDir = await createTempGitRepo();
  await fs.writeFile(path.join(gitRepoDir, 'test.ts'), 'let x = 1;\nlet y = 2;\n');
  await execFileAsync('git', ['add', '.'], { cwd: gitRepoDir });
  await execFileAsync('git', ['commit', '-m', 'initial'], { cwd: gitRepoDir });
  await fs.writeFile(path.join(gitRepoDir, 'test.ts'), 'let x = 1;\nlet y = 2;\nlet z = 3;\n');

  // 4. Mock API server
  mockServer = await startMockServer();
  // 5. Mock Codex CLI for current local-review implementation
  mockCodexLogPath = path.join(tmpHome, '.forgereview', 'mock-codex-invocations.jsonl');
  await fs.writeFile(mockCodexLogPath, '', 'utf-8');
  mockBinDir = await createMockCodexBinary(mockCodexLogPath);
});

afterAll(async () => {
  await mockServer?.close();
  if (tmpHome) await fs.rm(tmpHome, { recursive: true, force: true });
  if (gitRepoDir) await fs.rm(gitRepoDir, { recursive: true, force: true });
  if (mockBinDir) await fs.rm(mockBinDir, { recursive: true, force: true });
});

beforeEach(() => {
  mockServer.reset();
  return resetMockCodexInvocations();
});

// ---------------------------------------------------------------------------
// Smoke tests — no API needed
// ---------------------------------------------------------------------------
describe('CLI smoke', () => {
  it('prints version', async () => {
    const pkg = JSON.parse(await fs.readFile(path.join(PROJECT_ROOT, 'package.json'), 'utf-8'));
    const { stdout, exitCode } = await runCli(['--version']);
    expect(exitCode).toBe(0);
    expect(stdout.trim()).toBe(pkg.version);
  });

  it('prints help with main commands', async () => {
    const { stdout, exitCode } = await runCli(['--help']);
    expect(exitCode).toBe(0);
    expect(stdout).toContain('review');
    expect(stdout).toContain('auth');
  });

  it('prints review subcommand help', async () => {
    const { stdout, exitCode } = await runCli(['review', '--help']);
    expect(exitCode).toBe(0);
    expect(stdout).toContain('--staged');
    expect(stdout).toContain('--full');
    expect(stdout).toContain('--fast');
    expect(stdout).toContain('--prompt-only');
  });
});

// ---------------------------------------------------------------------------
// Review command — local Codex round-trip using mock codex binary
// ---------------------------------------------------------------------------
describe('review integration', () => {
  it('returns JSON review result', async () => {
    const { stdout, exitCode } = await runCli(['review', '--fast', '--format', 'json']);
    expect(exitCode).toBe(0);

    const json = parseFirstJsonObject(stdout);
    expect(json).toHaveProperty('summary');
    expect(json).toHaveProperty('issues');
    expect(json.issues).toHaveLength(1);
    expect(json.filesAnalyzed).toBe(1);
    expect(typeof json.duration).toBe('number');
    expect(json.duration).toBeGreaterThan(0);
  });

  it('keeps --format json output clean on stdout (operational logs may go to stderr)', async () => {
    const { stdout, stderr, exitCode } = await runCli(['review', '--fast', '--format', 'json']);
    expect(exitCode).toBe(0);

    expect(() => JSON.parse(stdout)).not.toThrow();
    expect(stderr).not.toContain('"summary"');
    expect(stderr).not.toContain('"issues"');
  });

  it('falls back to JSON in non-interactive shell and sends warning to stderr only', async () => {
    const { stdout, stderr, exitCode } = await runCli(['review', '--fast']);
    expect(exitCode).toBe(0);

    expect(() => JSON.parse(stdout)).not.toThrow();
    expect(stderr).toContain('Non-interactive shell detected');
    expect(stderr).not.toContain('"summary"');
  });

  it('suppresses fallback warning in quiet mode while keeping stdout JSON clean', async () => {
    const { stdout, stderr, exitCode } = await runCli(['review', '--fast', '--quiet']);
    expect(exitCode).toBe(0);

    expect(() => JSON.parse(stdout)).not.toThrow();
    expect(stderr).toBe('');
  });

  it('does not call ForgeReview review API in local Codex mode', async () => {
    await runCli(['review', '--fast', '--format', 'json']);

    const req = mockServer.requests.find((r) => r.url === '/cli/review');
    expect(req).toBeUndefined();
  });

  it('sends diff to codex via stdin prompt', async () => {
    await runCli(['review', '--fast', '--format', 'json']);
    const calls = await readMockCodexInvocations();
    expect(calls.length).toBeGreaterThan(0);
    const last = calls.at(-1)!;
    expect(last.args).toContain('exec');
    expect(last.stdin).toContain('Git diff to analyze:');
    expect(last.stdin).toContain('let z = 3');
  });

  it('reports "No changes" when working tree is clean', async () => {
    const cleanRepo = await createTempGitRepo();
    await fs.writeFile(path.join(cleanRepo, 'file.ts'), 'const x = 1;\n');
    await execFileAsync('git', ['add', '.'], { cwd: cleanRepo });
    await execFileAsync('git', ['commit', '-m', 'init'], { cwd: cleanRepo });

    try {
      const { stdout, stderr } = await runCli(['review', '--format', 'json'], { cwd: cleanRepo });
      const output = stdout + stderr;
      expect(output).toContain('No changes to review');
    } finally {
      await fs.rm(cleanRepo, { recursive: true, force: true });
    }
  });

  it('respects --staged flag (only staged diff)', async () => {
    await fs.writeFile(path.join(gitRepoDir, 'staged.ts'), 'const staged = true;\n');
    await execFileAsync('git', ['add', 'staged.ts'], { cwd: gitRepoDir });

    try {
      const { exitCode } = await runCli(['review', '--staged', '--fast', '--format', 'json']);
      expect(exitCode).toBe(0);
      const calls = await readMockCodexInvocations();
      const stdin = calls.at(-1)?.stdin ?? '';
      // staged diff should contain the new file, NOT the unstaged test.ts change
      expect(stdin).toContain('staged.ts');
      expect(stdin).toContain('const staged = true;');
      expect(stdin).not.toContain('let z = 3');
    } finally {
      await execFileAsync('git', ['reset', 'HEAD', 'staged.ts'], { cwd: gitRepoDir }).catch(() => {});
      await fs.unlink(path.join(gitRepoDir, 'staged.ts')).catch(() => {});
    }
  });

  it('supports --full to review entire repository even with clean working tree', async () => {
    const cleanRepo = await createTempGitRepo();
    await fs.writeFile(path.join(cleanRepo, 'file.ts'), 'const x = 1;\n');
    await execFileAsync('git', ['add', '.'], { cwd: cleanRepo });
    await execFileAsync('git', ['commit', '-m', 'init'], { cwd: cleanRepo });

    try {
      const { exitCode } = await runCli(['review', '--full', '--fast', '--format', 'json'], { cwd: cleanRepo });
      expect(exitCode).toBe(0);
      const calls = await readMockCodexInvocations();
      const stdin = calls.at(-1)?.stdin ?? '';
      expect(stdin).toContain('file.ts');
      expect(stdin).toContain('const x = 1;');
    } finally {
      await fs.rm(cleanRepo, { recursive: true, force: true });
    }
  });

  it('outputs markdown format', async () => {
    const { stdout, exitCode } = await runCli(['review', '--fast', '--format', 'markdown']);
    expect(exitCode).toBe(0);
    expect(stdout).toContain('# Code Review Report');
    expect(stdout).toContain('Mock review found 1 issue');
  });
});

// ---------------------------------------------------------------------------
// Auth status — team key and local codex paths
// ---------------------------------------------------------------------------
describe('auth status integration', () => {
  it('shows team key mode', async () => {
    const { stdout, stderr, exitCode } = await runCli(['auth', 'status']);
    expect(exitCode).toBe(0);
    const output = stdout + stderr;
    expect(output).toContain('Team Key');
    expect(output).toContain('Test Org');
    expect(output).toContain('Test Team');
  });

  it('shows local codex mode when no auth configured', async () => {
    const noAuthHome = await fs.mkdtemp(path.join(os.tmpdir(), 'forgereview-noauth-'));

    try {
      const { stdout, stderr, exitCode } = await runCli(['auth', 'status'], {
        env: { HOME: noAuthHome },
      });
      expect(exitCode).toBe(0);
      const output = stdout + stderr;
      expect(output).toContain('Local Codex');
      expect(output).toContain('Not configured');
    } finally {
      await fs.rm(noAuthHome, { recursive: true, force: true });
    }
  });
});

// ---------------------------------------------------------------------------
// Hook commands — install, status, uninstall
// ---------------------------------------------------------------------------
describe('hook integration', () => {
  it('forgereview hook install creates pre-push hook', async () => {
    const { stdout, stderr, exitCode } = await runCli(['hook', 'install', '--force']);
    expect(exitCode).toBe(0);
    const output = stdout + stderr;
    expect(output).toContain('installed');

    const hookPath = path.join(gitRepoDir, '.git', 'hooks', 'pre-push');
    const content = await fs.readFile(hookPath, 'utf-8');
    expect(content).toContain('# forgereview-hook');
    expect(content).toContain('--fail-on critical');
  });

  it('forgereview hook status shows installed', async () => {
    // Install first
    await runCli(['hook', 'install', '--force']);

    const { stdout, stderr, exitCode } = await runCli(['hook', 'status']);
    expect(exitCode).toBe(0);
    const output = stdout + stderr;
    expect(output).toContain('installed');
    expect(output).toContain('critical');
  });

  it('forgereview hook uninstall removes the hook', async () => {
    // Install first
    await runCli(['hook', 'install', '--force']);

    const { stdout, stderr, exitCode } = await runCli(['hook', 'uninstall']);
    expect(exitCode).toBe(0);
    const output = stdout + stderr;
    expect(output).toContain('removed');

    const hookPath = path.join(gitRepoDir, '.git', 'hooks', 'pre-push');
    await expect(fs.access(hookPath)).rejects.toThrow();
  });
});

// ---------------------------------------------------------------------------
// Decision commands — enable and capture
// ---------------------------------------------------------------------------
describe('decisions integration', () => {
  it('forgereview decisions enable configures .claude/settings.json, ~/.codex/config.toml, post-merge hook and modules.yml', async () => {
    const { stdout, stderr, exitCode } = await runCli([
      'decisions',
      'enable',
      '--agents',
      'claude,codex',
    ]);
    expect(exitCode).toBe(0);
    const output = stdout + stderr;
    expect(output).toContain('Decisions enabled');

    const claudeSettingsPath = path.join(gitRepoDir, '.claude', 'settings.json');
    const claudeSettings = JSON.parse(await fs.readFile(claudeSettingsPath, 'utf-8'));

    expect(claudeSettings).toHaveProperty('hooks');
    expect(claudeSettings.hooks).toHaveProperty('UserPromptSubmit');
    expect(claudeSettings.hooks).toHaveProperty('Stop');

    const userPromptSubmitJson = JSON.stringify(claudeSettings.hooks.UserPromptSubmit);
    const stopJson = JSON.stringify(claudeSettings.hooks.Stop);
    expect(userPromptSubmitJson).toContain('forgereview decisions capture --agent claude-compatible --event user-prompt-submit');
    expect(stopJson).toContain('forgereview decisions capture --agent claude-compatible --event stop');

    const codexConfigPath = path.join(tmpHome, '.codex', 'config.toml');
    const codexConfig = await fs.readFile(codexConfigPath, 'utf-8');
    expect(codexConfig).toContain('notify = ["forgereview", "decisions", "capture", "--agent", "codex", "--event", "stop"]');

    const hookPath = path.join(gitRepoDir, '.git', 'hooks', 'post-merge');
    const hookContent = await fs.readFile(hookPath, 'utf-8');
    expect(hookContent).toContain('forgereview decisions promote');
  });

  it('forgereview decisions capture writes markdown memory file under .kody/pr/<branch>.md', async () => {
    const branch = (await execFileAsync('git', ['branch', '--show-current'], { cwd: gitRepoDir })).stdout.trim();

    const payload = JSON.stringify({
      session_id: 'session-1',
      turn_id: 'turn-1',
      prompt: 'Use idempotent cache key',
      last_assistant_message: 'Done with fallback behavior',
    });

    const { exitCode } = await runCli([
      'decisions',
      'capture',
      payload,
      '--agent',
      'codex',
      '--event',
      'agent-turn-complete',
      '--summary',
      'architectural decision',
    ]);
    expect(exitCode).toBe(0);

    const memoryFilePath = path.join(gitRepoDir, '.kody', 'pr', `${branch}.md`);
    const content = await fs.readFile(memoryFilePath, 'utf-8');
    expect(content).toContain(`# PR Memory: ${branch}`);
    expect(content).toContain('codex');
    expect(content).toContain('agent-turn-complete');
    expect(content).toContain('Use idempotent cache key');
  });

  it('forgereview decisions capture resolves claude-compatible to cursor when Cursor env vars are present', async () => {
    const branch = (await execFileAsync('git', ['branch', '--show-current'], { cwd: gitRepoDir })).stdout.trim();

    const payload = JSON.stringify({
      session_id: 'session-2',
      prompt: 'add retry with backoff',
    });

    const { exitCode } = await runCli([
      'decisions',
      'capture',
      payload,
      '--agent',
      'claude-compatible',
      '--event',
      'user-prompt-submit',
    ], {
      env: {
        CURSOR_VERSION: '1.0.0',
      },
    });
    expect(exitCode).toBe(0);

    const memoryFilePath = path.join(gitRepoDir, '.kody', 'pr', `${branch}.md`);
    const content = await fs.readFile(memoryFilePath, 'utf-8');
    expect(content).toContain('| cursor | user-prompt-submit');
  });
});

// ---------------------------------------------------------------------------
// Review --fail-on flag
// ---------------------------------------------------------------------------
describe('review --fail-on integration', () => {
  it('exits with code 1 when issues meet threshold', async () => {
    const { exitCode } = await runCli([
      'review', '--fast', '--format', 'json', '--fail-on', 'warning',
    ]);
    expect(exitCode).toBe(1);
  });

  it('exits with code 0 when no issues meet threshold', async () => {
    const { exitCode } = await runCli([
      'review', '--fast', '--format', 'json', '--fail-on', 'critical',
    ]);
    expect(exitCode).toBe(0);
  });
});
