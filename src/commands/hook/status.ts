import chalk from 'chalk';
import fs from 'fs/promises';
import path from 'path';
import { gitService } from '../../services/git.service.js';
import { FORGEREVIEW_MARKER } from './install.js';

export async function statusAction(): Promise<void> {
  const isRepo = await gitService.isGitRepository();
  if (!isRepo) {
    console.error(chalk.red('Error: Not a git repository.'));
    process.exit(1);
  }

  const gitRoot = await gitService.getGitRoot();
  const hookPath = path.join(gitRoot.trim(), '.git', 'hooks', 'pre-push');

  let content: string;
  try {
    content = await fs.readFile(hookPath, 'utf-8');
  } catch {
    console.log(chalk.yellow('Pre-push hook: not installed'));
    return;
  }

  if (!content.includes(FORGEREVIEW_MARKER)) {
    console.log(chalk.yellow('Pre-push hook: installed (not by forgereview)'));
    return;
  }

  console.log(chalk.green('Pre-push hook: installed'));

  // Parse config from hook script
  const failOnMatch = content.match(/--fail-on\s+(\S+)/);
  const hasFast = content.includes('--fast');

  console.log(chalk.dim(`  Fail on: ${failOnMatch?.[1] ?? 'unknown'}`));
  console.log(chalk.dim(`  Fast mode: ${hasFast ? 'yes' : 'no'}`));
  console.log(chalk.dim(`  Path: ${hookPath}`));
}
