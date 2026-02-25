import chalk from 'chalk';
import fs from 'fs/promises';
import path from 'path';
import { gitService } from '../../services/git.service.js';
import { cliLogger } from '../../utils/logger.js';
import { FORGEREVIEW_MARKER } from './install.js';

export async function uninstallAction(): Promise<void> {
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
    cliLogger.info(chalk.yellow('No pre-push hook found.'));
    return;
  }

  if (!content.includes(FORGEREVIEW_MARKER)) {
    cliLogger.info(chalk.yellow('The pre-push hook was not installed by forgereview. Skipping.'));
    return;
  }

  await fs.unlink(hookPath);
  cliLogger.info(chalk.green('✓ Pre-push hook removed successfully.'));
}
