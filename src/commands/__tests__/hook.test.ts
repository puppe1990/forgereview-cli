import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import fs from 'fs/promises';
import path from 'path';
import os from 'os';
import { FORGEREVIEW_MARKER, generateHookScript } from '../hook/install.js';

// Mock gitService
vi.mock('../../services/git.service.js', () => ({
  gitService: {
    isGitRepository: vi.fn().mockResolvedValue(true),
    getGitRoot: vi.fn(),
  },
}));

// Mock inquirer
vi.mock('inquirer', () => ({
  default: {
    prompt: vi.fn(),
  },
}));

import { gitService } from '../../services/git.service.js';
import inquirer from 'inquirer';
import { installAction } from '../hook/install.js';
import { uninstallAction } from '../hook/uninstall.js';
import { statusAction } from '../hook/status.js';

let tmpDir: string;

beforeEach(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'forgereview-hook-test-'));
  const hooksDir = path.join(tmpDir, '.git', 'hooks');
  await fs.mkdir(hooksDir, { recursive: true });

  vi.mocked(gitService.isGitRepository).mockResolvedValue(true);
  vi.mocked(gitService.getGitRoot).mockResolvedValue(tmpDir);
});

afterEach(async () => {
  await fs.rm(tmpDir, { recursive: true, force: true });
  vi.restoreAllMocks();
});

function hookPath(): string {
  return path.join(tmpDir, '.git', 'hooks', 'pre-push');
}

describe('hook install', () => {
  it('creates hook at the correct path', async () => {
    await installAction({ failOn: 'critical', fast: true });
    const content = await fs.readFile(hookPath(), 'utf-8');
    expect(content).toBeTruthy();
  });

  it('hook contains marker and is executable', async () => {
    await installAction({ failOn: 'critical', fast: true });
    const content = await fs.readFile(hookPath(), 'utf-8');
    expect(content).toContain(FORGEREVIEW_MARKER);

    const stat = await fs.stat(hookPath());
    // Check executable bit (owner)
    expect(stat.mode & 0o100).toBeTruthy();
  });

  it('respects --fail-on severity option', async () => {
    await installAction({ failOn: 'warning', fast: true });
    const content = await fs.readFile(hookPath(), 'utf-8');
    expect(content).toContain('--fail-on warning');
  });

  it('does not overwrite existing non-forgereview hook without --force', async () => {
    // Write a third-party hook
    await fs.writeFile(hookPath(), '#!/bin/sh\necho "third-party hook"\n');

    vi.mocked(inquirer.prompt).mockResolvedValue({ overwrite: false });

    await installAction({});

    const content = await fs.readFile(hookPath(), 'utf-8');
    expect(content).toContain('third-party hook');
    expect(content).not.toContain(FORGEREVIEW_MARKER);
  });

  it('overwrites existing forgereview hook without prompting', async () => {
    // Write an old forgereview hook
    await fs.writeFile(hookPath(), `#!/bin/sh\n${FORGEREVIEW_MARKER}\nforgereview review --fail-on error\n`);

    await installAction({ failOn: 'critical', fast: true });

    const content = await fs.readFile(hookPath(), 'utf-8');
    expect(content).toContain('--fail-on critical');
  });
});

describe('hook uninstall', () => {
  it('removes hook with forgereview marker', async () => {
    await fs.writeFile(hookPath(), `#!/bin/sh\n${FORGEREVIEW_MARKER}\nforgereview review\n`);

    await uninstallAction();

    await expect(fs.access(hookPath())).rejects.toThrow();
  });

  it('does not remove third-party hook', async () => {
    await fs.writeFile(hookPath(), '#!/bin/sh\necho "third-party"\n');

    await uninstallAction();

    const content = await fs.readFile(hookPath(), 'utf-8');
    expect(content).toContain('third-party');
  });
});

describe('hook status', () => {
  it('detects installed forgereview hook', async () => {
    const script = generateHookScript('critical', true);
    await fs.writeFile(hookPath(), script);

    const stdoutSpy = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    await statusAction();

    const output = stdoutSpy.mock.calls.map((c) => String(c[0])).join('');
    expect(output).toContain('installed');
    expect(output).toContain('critical');
  });

  it('detects when no hook is installed', async () => {
    const stdoutSpy = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    await statusAction();

    const output = stdoutSpy.mock.calls.map((c) => String(c[0])).join('');
    expect(output).toContain('not installed');
  });
});
