import chalk from 'chalk';
import ora from 'ora';
import { authService } from '../../services/auth.service.js';
import { loadConfig } from '../../utils/config.js';
import { codexReviewService } from '../../services/codex-review.service.js';

export async function statusAction(): Promise<void> {
  const spinner = ora();

  try {
    const isAuthenticated = await authService.isAuthenticated();

    if (isAuthenticated) {
      const credentials = await authService.getCredentials();
      const teamConfig = await loadConfig();

      const hasTeamKey = !!teamConfig?.teamKey;
      const hasUserEmail = !!credentials?.user?.email;

      if (!hasUserEmail && hasTeamKey) {
        console.log(chalk.bold('\nAuthentication Status\n'));
        console.log(`${chalk.dim('Mode:')}  ${chalk.green('Team Key')}`);
        console.log(`${chalk.dim('Organization:')} ${teamConfig?.organizationName ?? '(unknown)'}`);
        console.log(`${chalk.dim('Team:')}         ${teamConfig?.teamName ?? '(unknown)'}`);
        console.log(`${chalk.dim('Token:')}        ${chalk.green('Configured')}`);
        return;
      }

      if (!credentials) {
        console.log(chalk.yellow('\nNo credentials found.'));
        return;
      }
      
      console.log(chalk.bold('\nAuthentication Status\n'));
      console.log(`${chalk.dim('Mode:')}  ${chalk.green('Logged In')}`);
      console.log(`${chalk.dim('Email:')} ${credentials.user?.email ?? '(unknown)'}`);
      
      const expiresAt = new Date(credentials.expiresAt);
      const timeUntilExpiry = expiresAt.getTime() - Date.now();
      const hoursUntilExpiry = Math.floor(timeUntilExpiry / (1000 * 60 * 60));
      
      if (timeUntilExpiry > 0) {
        if (hoursUntilExpiry < 1) {
          console.log(`${chalk.dim('Token:')}  ${chalk.yellow('Expires in < 1 hour')}`);
        } else if (hoursUntilExpiry < 24) {
          console.log(`${chalk.dim('Token:')}  ${chalk.yellow(`Expires in ${hoursUntilExpiry} hours`)}`);
        } else {
          console.log(`${chalk.dim('Token:')}  ${chalk.green('Valid')}`);
        }
      } else {
        console.log(`${chalk.dim('Token:')}  ${chalk.red('Expired')}`);
        console.log(chalk.yellow('\nYour session has expired. Run `forgereview auth login` to refresh.'));
        return;
      }
      
      if (credentials.user?.orgs && credentials.user.orgs.length > 0) {
        console.log(`${chalk.dim('Organizations:')}`);
        credentials.user.orgs.forEach((org) => {
          console.log(`  ${chalk.dim('•')} ${org}`);
        });
      }

    } else {
      spinner.start(chalk.blue('Checking local Codex CLI...'));
      const codexStatus = await codexReviewService.getCliStatus();
      spinner.stop();

      console.log(chalk.bold('\nAuthentication Status\n'));
      console.log(`${chalk.dim('Mode:')}           ${chalk.yellow('Local Codex')}`);
      console.log(`${chalk.dim('ForgeReview auth:')}     ${chalk.yellow('Not configured')}`);

      if (codexStatus.available) {
        console.log(`${chalk.dim('Codex CLI:')}      ${chalk.green('Available')}`);
        if (codexStatus.version) {
          console.log(`${chalk.dim('Version:')}        ${codexStatus.version}`);
        }
      } else {
        console.log(`${chalk.dim('Codex CLI:')}      ${chalk.red('Not found')}`);
        console.log(chalk.yellow('\nInstall with: npm install -g @openai/codex'));
      }
    }

  } catch (error) {
    spinner.fail(chalk.red('Failed to get status'));
    if (error instanceof Error) {
      console.error(chalk.red(error.message));
    }
    process.exit(1);
  }
}
