import chalk from 'chalk';
import { gitService } from '../../services/git.service.js';
import { memoryService } from '../../services/memory.service.js';
import { cliLogger } from '../../utils/logger.js';

interface PromoteOptions {
  branch?: string;
  modules?: string;
}

export async function promoteAction(options: PromoteOptions): Promise<void> {
  const isRepo = await gitService.isGitRepository();
  if (!isRepo) {
    cliLogger.error(chalk.red('Error: Not a git repository.'));
    process.exit(1);
  }

  const repoRoot = (await gitService.getGitRoot()).trim();

  let branch = options.branch;
  if (!branch) {
    try {
      branch = (await gitService.getCurrentBranch()).trim();
    } catch {
      cliLogger.error(chalk.red('Error: Could not determine current branch. Use --branch to specify.'));
      process.exit(1);
      return;
    }
  }

  const moduleIds = options.modules
    ? options.modules.split(',').map((m) => m.trim()).filter(Boolean)
    : undefined;

  const result = await memoryService.promoteToModuleMemory(repoRoot, branch, moduleIds);

  if (result.promoted === 0) {
    cliLogger.info(chalk.dim('No decisions to promote.'));
    if (result.modules.length === 0) {
      cliLogger.info(chalk.dim('Check that modules.yml exists and PR memory has decisions with matching files.'));
    }
    return;
  }

  cliLogger.info(chalk.green(`✓ Promoted ${result.promoted} decision(s) to ${result.modules.length} module(s):`));
  for (const modId of result.modules) {
    cliLogger.info(chalk.dim(`  - .kody/memory/${modId}.md`));
  }
}
