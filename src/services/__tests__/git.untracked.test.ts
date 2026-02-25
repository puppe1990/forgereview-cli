import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import { execFileSync } from 'node:child_process';

let originalCwd: string;
let tmpDir: string;

async function importGitService() {
  vi.resetModules();
  return import('../git.service.js');
}

describe('gitService untracked file diffs', () => {
  beforeEach(async () => {
    originalCwd = process.cwd();
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'forgereview-git-untracked-'));
    execFileSync('git', ['init'], { cwd: tmpDir, stdio: 'ignore' });
    process.chdir(tmpDir);
  });

  afterEach(async () => {
    process.chdir(originalCwd);
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it('includes untracked files in working tree diff', async () => {
    await fs.writeFile(path.join(tmpDir, 'new-file.ts'), 'export const x = 1;\n', 'utf-8');
    const { gitService } = await importGitService();

    const diff = await gitService.getWorkingTreeDiff();

    expect(diff).toContain('diff --git a/new-file.ts b/new-file.ts');
    expect(diff).toContain('new file mode');
    expect(diff).toContain('+export const x = 1;');
  });

  it('includes explicitly requested untracked files in file diff mode', async () => {
    await fs.writeFile(path.join(tmpDir, 'notes.md'), '# Hello\n', 'utf-8');
    const { gitService } = await importGitService();

    const diff = await gitService.getDiffForFiles(['notes.md']);

    expect(diff).toContain('diff --git a/notes.md b/notes.md');
    expect(diff).toContain('new file mode');
    expect(diff).toContain('+# Hello');
  });
});
