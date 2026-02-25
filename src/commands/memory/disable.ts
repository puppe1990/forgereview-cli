import chalk from 'chalk';
import { gitService } from '../../services/git.service.js';
import { cliLogger } from '../../utils/logger.js';
import {
  removeClaudeCompatibleHooks,
  removeCodexNotify,
  removeMergeHook,
  resolveCodexConfigPath,
} from './hooks.js';

export async function disableAction(): Promise<void> {
  const isRepo = await gitService.isGitRepository();
  if (!isRepo) {
    cliLogger.error(chalk.red('Error: Not a git repository.'));
    process.exit(1);
  }

  const gitRoot = (await gitService.getGitRoot()).trim();

  const claudeResult = await removeClaudeCompatibleHooks(gitRoot);
  const codexResult = await removeCodexNotify(resolveCodexConfigPath());
  const mergeResult = await removeMergeHook(gitRoot);

  cliLogger.info(chalk.green('\u2713 Decision hooks removed.'));
  cliLogger.info(`  Claude Code / Cursor hooks: ${claudeResult.removed ? 'removed' : 'not found'}`);
  cliLogger.info(`  Codex notify: ${codexResult.removed ? 'removed' : 'not found'}`);
  cliLogger.info(`  Post-merge hook: ${mergeResult.removed ? 'removed' : 'not found'}`);
  cliLogger.info(chalk.dim('  Memory data in .kody/ preserved.'));
}
