import chalk from 'chalk';
import ora from 'ora';
import { authService } from '../../services/auth.service.js';

export async function logoutAction(): Promise<void> {
  const spinner = ora();

  try {
    const isAuthenticated = await authService.isAuthenticated();
    
    if (!isAuthenticated) {
      console.log(chalk.yellow('\nNot authenticated.'));
      return;
    }

    spinner.start(chalk.blue('Logging out...'));

    await authService.logout();

    spinner.succeed(chalk.green('Logged out successfully'));

  } catch (error) {
    spinner.fail(chalk.red('Logout failed'));
    if (error instanceof Error) {
      console.error(chalk.red(error.message));
    }
    process.exit(1);
  }
}
