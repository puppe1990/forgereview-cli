import chalk from 'chalk';
import ora from 'ora';
import { authService } from '../../services/auth.service.js';
import { loadConfig } from '../../utils/config.js';
import { codexReviewService } from '../../services/codex-review.service.js';
import { cliLogger } from '../../utils/logger.js';

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
        cliLogger.info(chalk.bold('\nAuthentication Status\n'));
        cliLogger.info(`${chalk.dim('Mode:')}  ${chalk.green('Team Key')}`);
        cliLogger.info(`${chalk.dim('Organization:')} ${teamConfig?.organizationName ?? '(unknown)'}`);
        cliLogger.info(`${chalk.dim('Team:')}         ${teamConfig?.teamName ?? '(unknown)'}`);
        cliLogger.info(`${chalk.dim('Token:')}        ${chalk.green('Configured')}`);
        return;
      }

      if (!credentials) {
        cliLogger.info(chalk.yellow('\nNo credentials found.'));
        return;
      }
      
      cliLogger.info(chalk.bold('\nAuthentication Status\n'));
      cliLogger.info(`${chalk.dim('Mode:')}  ${chalk.green('Logged In')}`);
      cliLogger.info(`${chalk.dim('Email:')} ${credentials.user?.email ?? '(unknown)'}`);
      
      const expiresAt = new Date(credentials.expiresAt);
      const timeUntilExpiry = expiresAt.getTime() - Date.now();
      const hoursUntilExpiry = Math.floor(timeUntilExpiry / (1000 * 60 * 60));
      
      if (timeUntilExpiry > 0) {
        if (hoursUntilExpiry < 1) {
          cliLogger.info(`${chalk.dim('Token:')}  ${chalk.yellow('Expires in < 1 hour')}`);
        } else if (hoursUntilExpiry < 24) {
          cliLogger.info(`${chalk.dim('Token:')}  ${chalk.yellow(`Expires in ${hoursUntilExpiry} hours`)}`);
        } else {
          cliLogger.info(`${chalk.dim('Token:')}  ${chalk.green('Valid')}`);
        }
      } else {
        cliLogger.info(`${chalk.dim('Token:')}  ${chalk.red('Expired')}`);
        cliLogger.info(chalk.yellow('\nYour session has expired. Run `forgereview auth login` to refresh.'));
        return;
      }
      
      if (credentials.user?.orgs && credentials.user.orgs.length > 0) {
        cliLogger.info(`${chalk.dim('Organizations:')}`);
        credentials.user.orgs.forEach((org) => {
          cliLogger.info(`  ${chalk.dim('•')} ${org}`);
        });
      }

    } else {
      spinner.start(chalk.blue('Checking local Codex CLI...'));
      const codexStatus = await codexReviewService.getCliStatus();
      spinner.stop();

      cliLogger.info(chalk.bold('\nAuthentication Status\n'));
      cliLogger.info(`${chalk.dim('Mode:')}           ${chalk.yellow('Local Codex')}`);
      cliLogger.info(`${chalk.dim('ForgeReview auth:')}     ${chalk.yellow('Not configured')}`);

      if (codexStatus.available) {
        cliLogger.info(`${chalk.dim('Codex CLI:')}      ${chalk.green('Available')}`);
        if (codexStatus.version) {
          cliLogger.info(`${chalk.dim('Version:')}        ${codexStatus.version}`);
        }
      } else {
        cliLogger.info(`${chalk.dim('Codex CLI:')}      ${chalk.red('Not found')}`);
        cliLogger.info(chalk.yellow('\nInstall with: npm install -g @openai/codex'));
      }
    }

  } catch (error) {
    spinner.fail(chalk.red('Failed to get status'));
    if (error instanceof Error) {
      cliLogger.error(chalk.red(error.message));
    }
    process.exit(1);
  }
}
