import chalk from 'chalk';
import fs from 'fs/promises';
import path from 'path';
import { gitService } from '../../services/git.service.js';
import { cliLogger } from '../../utils/logger.js';
import { FORGEREVIEW_MARKER } from './install.js';

export async function statusAction(): Promise<void> {
  const isRepo = await gitService.isGitRepository();
  if (!isRepo) {
    cliLogger.error(chalk.red('Error: Not a git repository.'));
    process.exit(1);
  }

  const gitRoot = await gitService.getGitRoot();
  const hookPath = path.join(gitRoot.trim(), '.git', 'hooks', 'pre-push');

  let content: string;
  try {
    content = await fs.readFile(hookPath, 'utf-8');
  } catch {
    cliLogger.info(chalk.yellow('Pre-push hook: not installed'));
    return;
  }

  if (!content.includes(FORGEREVIEW_MARKER)) {
    cliLogger.info(chalk.yellow('Pre-push hook: installed (not by forgereview)'));
    return;
  }

  cliLogger.info(chalk.green('Pre-push hook: installed'));

  // Parse config from hook script
  const failOnMatch = content.match(/--fail-on\s+(\S+)/);
  const hasFast = content.includes('--fast');

  cliLogger.info(chalk.dim(`  Fail on: ${failOnMatch?.[1] ?? 'unknown'}`));
  cliLogger.info(chalk.dim(`  Fast mode: ${hasFast ? 'yes' : 'no'}`));
  cliLogger.info(chalk.dim(`  Path: ${hookPath}`));
}
