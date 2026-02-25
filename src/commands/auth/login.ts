import inquirer from 'inquirer';
import chalk from 'chalk';
import ora from 'ora';
import { authService } from '../../services/auth.service.js';

interface LoginOptions {
  email?: string;
  password?: string;
}

export async function loginAction(options: LoginOptions): Promise<void> {
  const spinner = ora();

  try {
    const isAuthenticated = await authService.isAuthenticated();
    
    if (isAuthenticated && !options.email) {
      const credentials = await authService.getCredentials();
      const email = credentials?.user?.email;
      console.log(
        chalk.yellow(email ? `\nAlready logged in as ${email}` : '\nAlready authenticated with team key'),
      );
      
      const { confirm } = await inquirer.prompt([
        {
          type: 'confirm',
          name: 'confirm',
          message: email
            ? 'Do you want to login with a different account?'
            : 'Do you want to login with an account instead?',
          default: false,
        },
      ]);

      if (!confirm) {
        return;
      }
    }

    let email = options.email;
    let password = options.password;

    if (!email || !password) {
      const answers = await inquirer.prompt([
        ...(!email ? [{
          type: 'input',
          name: 'email',
          message: 'Email:',
          validate: (input: string) => {
            if (!input || !input.includes('@')) {
              return 'Please enter a valid email';
            }
            return true;
          },
        }] : []),
        ...(!password ? [{
          type: 'password',
          name: 'password',
          message: 'Password:',
          mask: '*',
          validate: (input: string) => {
            if (!input || input.length < 6) {
              return 'Password must be at least 6 characters';
            }
            return true;
          },
        }] : []),
      ]);

      email = email || answers.email;
      password = password || answers.password;
    }

    spinner.start(chalk.blue('Logging in...'));

    await authService.login(email!, password!);

    spinner.succeed(chalk.green(`Logged in as ${email}`));

  } catch (error) {
    spinner.fail(chalk.red('Login failed'));

    if (error instanceof Error) {
      console.error(chalk.red(error.message));
    }
    process.exit(1);
  }
}
