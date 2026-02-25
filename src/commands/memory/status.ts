import chalk from 'chalk';
import { gitService } from '../../services/git.service.js';
import { memoryService } from '../../services/memory.service.js';
import { loadConfig } from '../../utils/module-matcher.js';
import { cliLogger } from '../../utils/logger.js';

export async function statusAction(): Promise<void> {
  const isRepo = await gitService.isGitRepository();
  if (!isRepo) {
    cliLogger.error(chalk.red('Error: Not a git repository.'));
    process.exit(1);
  }

  const repoRoot = (await gitService.getGitRoot()).trim();

  let branch: string;
  try {
    branch = (await gitService.getCurrentBranch()).trim();
  } catch {
    cliLogger.error(chalk.red('Error: Could not determine current branch.'));
    process.exit(1);
    return;
  }

  cliLogger.info(chalk.bold(`Branch: ${branch}`));
  cliLogger.info('');

  // PR memory status
  const prMemory = await memoryService.readPrMemory(repoRoot, branch);
  if (prMemory && prMemory.meta) {
    const meta = prMemory.meta;
    cliLogger.info(chalk.green('PR Memory:'));
    cliLogger.info(`  Sessions: ${meta.sessionCount}`);
    cliLogger.info(`  Last SHA: ${meta.lastSha}`);
    cliLogger.info(`  Agent: ${meta.agent}`);
    cliLogger.info(`  Updated: ${meta.updatedAt}`);

    // Count decisions in content
    const decisionCount = (prMemory.content.match(/^### \[\w+\]/gm) || []).length;
    const captureCount = (prMemory.content.match(/^### \d{4}-\d{2}-\d{2}T/gm) || []).length;
    cliLogger.info(`  Decisions: ${decisionCount}`);
    cliLogger.info(`  Captures: ${captureCount}`);
  } else {
    cliLogger.info(chalk.dim('No PR memory for this branch yet.'));
  }

  cliLogger.info('');

  // Module config status
  const config = await loadConfig(repoRoot);
  if (config) {
    cliLogger.info(chalk.green(`Module config: ${config.modules.length} module(s)`));
    for (const mod of config.modules) {
      cliLogger.info(chalk.dim(`  - ${mod.id}: ${mod.paths.join(', ')}`));
    }
  } else {
    cliLogger.info(chalk.dim('No module config found. Run `forgereview decisions enable` to create one.'));
  }
}
