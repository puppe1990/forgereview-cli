import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import { afterEach, describe, expect, it, vi } from 'vitest';

async function importConfigModule(homeDir: string): Promise<typeof import('../config.js')> {
  vi.resetModules();
  vi.doMock('os', async () => {
    const actual = await vi.importActual<any>('os');
    return {
      ...actual,
      homedir: () => homeDir,
      default: {
        ...actual,
        homedir: () => homeDir,
      },
    };
  });

  return import('../config.js');
}

describe('config utils', () => {
  const tempDirs: string[] = [];

  afterEach(async () => {
    vi.doUnmock('os');
    vi.restoreAllMocks();
    vi.resetModules();

    while (tempDirs.length > 0) {
      const dir = tempDirs.pop()!;
      await fs.rm(dir, { recursive: true, force: true });
    }
  });

  it('returns null when config file does not exist', async () => {
    const home = await fs.mkdtemp(path.join(os.tmpdir(), 'forgereview-config-test-'));
    tempDirs.push(home);
    const { loadConfig } = await importConfigModule(home);

    await expect(loadConfig()).resolves.toBeNull();
  });

  it('saves and loads config successfully', async () => {
    const home = await fs.mkdtemp(path.join(os.tmpdir(), 'forgereview-config-test-'));
    tempDirs.push(home);
    const { saveConfig, loadConfig } = await importConfigModule(home);

    const input = {
      teamKey: 'forgereview_abc123',
      teamName: 'Platform Team',
      organizationName: 'ForgeReview',
    };

    await saveConfig(input);
    const loaded = await loadConfig();

    expect(loaded).toEqual(input);
  });

  it('writes config atomically without leaving temp files', async () => {
    const home = await fs.mkdtemp(path.join(os.tmpdir(), 'forgereview-config-test-'));
    tempDirs.push(home);
    const { saveConfig } = await importConfigModule(home);

    await saveConfig({
      teamKey: 'forgereview_abc123',
      teamName: 'Platform Team',
      organizationName: 'ForgeReview',
    });

    const configDir = path.join(home, '.forgereview');
    const files = await fs.readdir(configDir);
    expect(files.some((f) => f.includes('.tmp'))).toBe(false);
    expect(files).toContain('config.json');
  });

  it('self-heals malformed JSON by isolating corrupted config', async () => {
    const home = await fs.mkdtemp(path.join(os.tmpdir(), 'forgereview-config-test-'));
    tempDirs.push(home);
    const { loadConfig } = await importConfigModule(home);

    const configDir = path.join(home, '.forgereview');
    const configFile = path.join(configDir, 'config.json');
    await fs.mkdir(configDir, { recursive: true });
    await fs.writeFile(configFile, '{ malformed-json ', 'utf-8');

    const loaded = await loadConfig();
    expect(loaded).toBeNull();

    const files = await fs.readdir(configDir);
    expect(files).not.toContain('config.json');
    expect(files.some((f) => f.startsWith('config.json.corrupted.'))).toBe(true);
  });
});
