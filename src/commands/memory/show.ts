import chalk from 'chalk';
import { gitService } from '../../services/git.service.js';
import { memoryService } from '../../services/memory.service.js';
import { cliLogger } from '../../utils/logger.js';

export async function showAction(name?: string): Promise<void> {
  const isRepo = await gitService.isGitRepository();
  if (!isRepo) {
    cliLogger.error(chalk.red('Error: Not a git repository.'));
    process.exit(1);
  }

  const repoRoot = (await gitService.getGitRoot()).trim();

  if (!name) {
    // Show current branch PR memory
    let branch: string;
    try {
      branch = (await gitService.getCurrentBranch()).trim();
    } catch {
      cliLogger.error(chalk.red('Error: Could not determine current branch.'));
      process.exit(1);
      return;
    }

    const prMemory = await memoryService.readPrMemory(repoRoot, branch);
    if (!prMemory) {
      cliLogger.info(chalk.dim(`No PR memory found for branch: ${branch}`));
      return;
    }

    cliLogger.info(prMemory.content);
    return;
  }

  // Try as module name first
  const moduleContent = await memoryService.readModuleMemory(repoRoot, name);
  if (moduleContent) {
    cliLogger.info(moduleContent);
    return;
  }

  // Try as branch name
  const branchMemory = await memoryService.readPrMemory(repoRoot, name);
  if (branchMemory) {
    cliLogger.info(branchMemory.content);
    return;
  }

  cliLogger.info(chalk.dim(`No memory found for: ${name}`));
}
