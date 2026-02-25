import chalk from 'chalk';
import { clearConfig, loadConfig, saveConfig } from '../../utils/config.js';
import { clearCredentials } from '../../utils/credentials.js';
import { API_URL } from '../../constants.js';
import { getDeviceIdentity, updateDeviceToken } from '../../utils/device.js';
import { cliLogger } from '../../utils/logger.js';

interface TeamKeyErrorPayload {
  message?: string;
  code?: string;
  details?: {
    limit?: number;
    current?: number;
    activeDevices?: number;
  };
}

function getTeamKeyErrorMessage(payload: TeamKeyErrorPayload): string {
  if (payload.code === 'DEVICE_LIMIT_REACHED') {
    const limit = payload.details?.limit;
    const activeDevices = payload.details?.current ?? payload.details?.activeDevices;
    if (typeof limit === 'number' && typeof activeDevices === 'number') {
      return `Device limit reached (${activeDevices}/${limit}). Remove an old device or contact your admin.`;
    }
    return 'Device limit reached for this organization. Remove an old device or contact your admin.';
  }

  return payload.message || 'Invalid team key';
}

export async function teamKeyAction(options: { key?: string }): Promise<void> {
  if (!options.key) {
    cliLogger.error(chalk.red('Error: --key is required'));
    cliLogger.info('\nGet your team key from: https://app.forgereview.io/settings/cli');
    process.exit(1);
  }

  if (!options.key.startsWith('forgereview_')) {
    cliLogger.error(chalk.red('Error: Invalid key format. Key should start with "forgereview_"'));
    process.exit(1);
  }

  try {
    const device = await getDeviceIdentity().catch(() => undefined);
    const response = await fetch(`${API_URL}/cli/validate-key`, {
      headers: {
        'X-Team-Key': options.key,
        ...(device?.deviceId ? { 'X-ForgeReview-Device-Id': device.deviceId } : {}),
        ...(device?.deviceToken ? { 'X-ForgeReview-Device-Token': device.deviceToken } : {}),
      }
    });

    const responseDeviceToken = response.headers.get('x-forgereview-device-token');
    if (responseDeviceToken) {
      await updateDeviceToken(responseDeviceToken).catch(() => {});
    }

    if (!response.ok) {
      const rawError = await response.json().catch(() => ({} as TeamKeyErrorPayload));
      const payload: TeamKeyErrorPayload =
        rawError && typeof rawError === 'object' && 'data' in (rawError as Record<string, unknown>)
          ? ((rawError as { data?: TeamKeyErrorPayload }).data ?? {})
          : (rawError as TeamKeyErrorPayload);
      throw new Error(getTeamKeyErrorMessage(payload));
    }

    const rawData = await response.json().catch(() => ({} as any));
    const payload = rawData && typeof rawData === 'object' && 'data' in rawData ? (rawData as any).data : rawData;

    const teamName = payload?.team?.name ?? payload?.teamName;
    const organizationName = payload?.organization?.name ?? payload?.organizationName ?? payload?.org?.name;

    if (!teamName || !organizationName) {
      throw new Error('Invalid response from server. Missing organization or team info.');
    }

    await saveConfig({
      teamKey: options.key,
      teamName,
      organizationName,
    });
    // Team-key auth should not compete with a previously stored user session.
    try {
      await clearCredentials();
    } catch {
      await clearConfig().catch(() => {});
      throw new Error('Failed to switch to team-key auth because personal credentials could not be cleared.');
    }

    cliLogger.info(chalk.green('✓ Authenticated successfully!'));
    cliLogger.info(chalk.cyan(`  Organization: ${organizationName}`));
    cliLogger.info(chalk.cyan(`  Team: ${teamName}`));

  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    cliLogger.error(chalk.red(`✗ Authentication failed: ${message}`));
    cliLogger.info('\nMake sure:');
    cliLogger.info('  1. Your key is correct');
    cliLogger.info('  2. The key has not been revoked');
    cliLogger.info('  3. You have internet connection');
    process.exit(1);
  }
}

export async function teamStatusAction(): Promise<void> {
  const config = await loadConfig();

  if (!config) {
    cliLogger.info(chalk.yellow('Not authenticated with team key'));
    cliLogger.info('\nRun: forgereview auth team-key --key <your-key>');
    cliLogger.info('Get your key from: https://app.forgereview.io/settings/cli');
    return;
  }

  cliLogger.info(chalk.green('✓ Authenticated'));
  cliLogger.info(chalk.cyan(`  Organization: ${config.organizationName}`));
  cliLogger.info(chalk.cyan(`  Team: ${config.teamName}`));
}
