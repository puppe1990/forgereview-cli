import chalk from 'chalk';
import ora from 'ora';
import { authService } from '../../services/auth.service.js';

export async function tokenAction(): Promise<void> {
  const spinner = ora();

  try {
    const isAuthenticated = await authService.isAuthenticated();
    
    if (!isAuthenticated) {
      console.log(chalk.yellow('\nYou need to be logged in to generate a token.'));
      console.log(chalk.dim('Run `forgereview auth login` first.'));
      return;
    }

    spinner.start(chalk.blue('Generating token...'));

    const token = await authService.generateCIToken();

    spinner.succeed(chalk.green('Token generated!'));
    
    console.log(chalk.bold('\nCI/CD Token\n'));
    console.log(chalk.dim('Use this token in your CI/CD pipelines:'));
    console.log(chalk.cyan(`\n${token}\n`));
    console.log(chalk.dim('Set as environment variable:'));
    console.log(chalk.dim('  export FORGEREVIEW_TOKEN=<token>'));
    console.log(chalk.yellow('\n⚠️  Keep this token secret! It provides access to your account.'));

  } catch (error) {
    spinner.fail(chalk.red('Failed to generate token'));
    if (error instanceof Error) {
      console.error(chalk.red(error.message));
    }
    process.exit(1);
  }
}

