import chalk from 'chalk';
import { gitService } from '../../services/git.service.js';
import { memoryService } from '../../services/memory.service.js';

export async function showAction(name?: string): Promise<void> {
  const isRepo = await gitService.isGitRepository();
  if (!isRepo) {
    console.error(chalk.red('Error: Not a git repository.'));
    process.exit(1);
  }

  const repoRoot = (await gitService.getGitRoot()).trim();

  if (!name) {
    // Show current branch PR memory
    let branch: string;
    try {
      branch = (await gitService.getCurrentBranch()).trim();
    } catch {
      console.error(chalk.red('Error: Could not determine current branch.'));
      process.exit(1);
      return;
    }

    const prMemory = await memoryService.readPrMemory(repoRoot, branch);
    if (!prMemory) {
      console.log(chalk.dim(`No PR memory found for branch: ${branch}`));
      return;
    }

    console.log(prMemory.content);
    return;
  }

  // Try as module name first
  const moduleContent = await memoryService.readModuleMemory(repoRoot, name);
  if (moduleContent) {
    console.log(moduleContent);
    return;
  }

  // Try as branch name
  const branchMemory = await memoryService.readPrMemory(repoRoot, name);
  if (branchMemory) {
    console.log(branchMemory.content);
    return;
  }

  console.log(chalk.dim(`No memory found for: ${name}`));
}
