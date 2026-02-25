import fs from 'fs/promises';
import path from 'path';
import os from 'os';
import chalk from 'chalk';

const FORGEREVIEW_DIR = path.join(os.homedir(), '.forgereview');
const CACHE_FILE = path.join(FORGEREVIEW_DIR, 'update-check.json');
const CHECK_INTERVAL_MS = 4 * 60 * 60 * 1000; // 4 hours
const FETCH_TIMEOUT_MS = 3000;

interface UpdateCache {
  lastCheck: number;
  latestVersion: string;
}

interface UpdateCheckOptions {
  format?: string;
  quiet?: boolean;
  output?: string;
}

export function isNewerVersion(current: string, latest: string): boolean {
  const currentParts = current.split('.').map(Number);
  const latestParts = latest.split('.').map(Number);
  const len = Math.max(currentParts.length, latestParts.length);

  for (let i = 0; i < len; i++) {
    const a = currentParts[i] ?? 0;
    const b = latestParts[i] ?? 0;
    if (b > a) return true;
    if (b < a) return false;
  }

  return false;
}

function printStderr(line = ''): void {
  process.stderr.write(`${line}\n`);
}

export function shouldShowUpdateBanner(options?: UpdateCheckOptions): boolean {
  if (options?.quiet) return false;
  if (options?.output) return false;
  if (options?.format && options.format !== 'terminal') return false;
  return Boolean(process.stdout.isTTY && process.stderr.isTTY);
}

function printUpdateBanner(currentVersion: string, latestVersion: string): void {
  const message = `Update available: ${currentVersion} → ${latestVersion}`;
  const command = 'Run `npm install -g @forgereview/cli`';
  const inner = Math.max(message.length, command.length) + 4;

  const pad = (text: string) => {
    const remaining = inner - text.length;
    const left = Math.floor(remaining / 2);
    const right = remaining - left;
    return ' '.repeat(left) + text + ' '.repeat(right);
  };

  const top = `╭${'─'.repeat(inner)}╮`;
  const bottom = `╰${'─'.repeat(inner)}╯`;
  const empty = `│${' '.repeat(inner)}│`;

  printStderr();
  printStderr(chalk.yellow(top));
  printStderr(chalk.yellow(empty));
  printStderr(chalk.yellow('│') + pad(`${chalk.dim(currentVersion)} ${chalk.yellow('→')} ${chalk.green(latestVersion)}`) + chalk.yellow('│'));
  printStderr(chalk.yellow('│') + pad(chalk.cyan('Run `npm install -g @forgereview/cli`')) + chalk.yellow('│'));
  printStderr(chalk.yellow(empty));
  printStderr(chalk.yellow(bottom));
  printStderr();
}

async function readCache(): Promise<UpdateCache | null> {
  try {
    const content = await fs.readFile(CACHE_FILE, 'utf-8');
    return JSON.parse(content) as UpdateCache;
  } catch {
    return null;
  }
}

async function writeCache(cache: UpdateCache): Promise<void> {
  try {
    await fs.mkdir(FORGEREVIEW_DIR, { recursive: true, mode: 0o700 });
    await fs.writeFile(CACHE_FILE, JSON.stringify(cache, null, 2), {
      encoding: 'utf-8',
      mode: 0o600,
    });
  } catch {
    // silently ignore cache write failures
  }
}

async function fetchLatestVersion(): Promise<string | null> {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

    const response = await fetch('https://registry.npmjs.org/@forgereview/cli/latest', {
      signal: controller.signal,
      headers: { 'Accept': 'application/json' },
    });

    clearTimeout(timeout);

    if (!response.ok) return null;

    const data = (await response.json()) as { version?: string };
    return data.version ?? null;
  } catch {
    return null;
  }
}

export async function checkForUpdates(currentVersion: string, options?: UpdateCheckOptions): Promise<void> {
  try {
    if (!shouldShowUpdateBanner(options)) {
      return;
    }

    const cache = await readCache();
    const now = Date.now();

    if (cache && (now - cache.lastCheck) < CHECK_INTERVAL_MS) {
      if (isNewerVersion(currentVersion, cache.latestVersion)) {
        printUpdateBanner(currentVersion, cache.latestVersion);
      }
      return;
    }

    const latestVersion = await fetchLatestVersion();
    if (!latestVersion) return;

    await writeCache({ lastCheck: now, latestVersion });

    if (isNewerVersion(currentVersion, latestVersion)) {
      printUpdateBanner(currentVersion, latestVersion);
    }
  } catch {
    // silently ignore any errors — update check must never break the CLI
  }
}
