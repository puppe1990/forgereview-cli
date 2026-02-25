import chalk from 'chalk';
import ora from 'ora';
import { authService } from '../../services/auth.service.js';
import { cliLogger } from '../../utils/logger.js';

export async function tokenAction(): Promise<void> {
  const spinner = ora();

  try {
    const isAuthenticated = await authService.isAuthenticated();
    
    if (!isAuthenticated) {
      cliLogger.info(chalk.yellow('\nYou need to be logged in to generate a token.'));
      cliLogger.info(chalk.dim('Run `forgereview auth login` first.'));
      return;
    }

    spinner.start(chalk.blue('Generating token...'));

    const token = await authService.generateCIToken();

    spinner.succeed(chalk.green('Token generated!'));
    
    cliLogger.info(chalk.bold('\nCI/CD Token\n'));
    cliLogger.info(chalk.dim('Use this token in your CI/CD pipelines:'));
    cliLogger.info(chalk.cyan(`\n${token}\n`));
    cliLogger.info(chalk.dim('Set as environment variable:'));
    cliLogger.info(chalk.dim('  export FORGEREVIEW_TOKEN=<token>'));
    cliLogger.info(chalk.yellow('\n⚠️  Keep this token secret! It provides access to your account.'));

  } catch (error) {
    spinner.fail(chalk.red('Failed to generate token'));
    if (error instanceof Error) {
      cliLogger.error(chalk.red(error.message));
    }
    process.exit(1);
  }
}
