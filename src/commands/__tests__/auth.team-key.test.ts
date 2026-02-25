import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../utils/config.js', () => ({
  loadConfig: vi.fn(),
  saveConfig: vi.fn(),
  clearConfig: vi.fn(),
}));

vi.mock('../../utils/credentials.js', () => ({
  clearCredentials: vi.fn(),
}));

import { clearConfig, loadConfig, saveConfig } from '../../utils/config.js';
import { clearCredentials } from '../../utils/credentials.js';
import { teamKeyAction, teamStatusAction } from '../auth/team-key.js';

const mockLoadConfig = vi.mocked(loadConfig);
const mockSaveConfig = vi.mocked(saveConfig);
const mockClearConfig = vi.mocked(clearConfig);
const mockClearCredentials = vi.mocked(clearCredentials);

function mockProcessExit(): ReturnType<typeof vi.spyOn> {
  return vi.spyOn(process, 'exit').mockImplementation((code?: string | number | null) => {
    throw new Error(`process.exit:${code ?? 0}`);
  }) as any;
}

describe('auth team-key command', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal('fetch', vi.fn());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('exits when key is missing', async () => {
    const exitSpy = mockProcessExit();
    const errorSpy = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);

    await expect(teamKeyAction({})).rejects.toThrow('process.exit:1');
    expect(exitSpy).toHaveBeenCalledWith(1);
    expect(errorSpy).toHaveBeenCalled();
  });

  it('exits when key format is invalid', async () => {
    const exitSpy = mockProcessExit();
    const errorSpy = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);

    await expect(teamKeyAction({ key: 'invalid' })).rejects.toThrow('process.exit:1');
    expect(exitSpy).toHaveBeenCalledWith(1);
    expect(errorSpy).toHaveBeenCalled();
  });

  it('saves config and clears credentials when key is valid', async () => {
    const fetchMock = vi.mocked(fetch);
    fetchMock.mockResolvedValue(
      new Response(
        JSON.stringify({
          data: {
            team: { name: 'Platform Team' },
            organization: { name: 'ForgeReview' },
          },
        }),
        {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        },
      ),
    );
    mockClearCredentials.mockResolvedValue(undefined);

    await teamKeyAction({ key: 'forgereview_abc123' });

    expect(mockSaveConfig).toHaveBeenCalledWith({
      teamKey: 'forgereview_abc123',
      teamName: 'Platform Team',
      organizationName: 'ForgeReview',
    });
    expect(mockClearCredentials).toHaveBeenCalled();
    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining('/cli/validate-key'),
      expect.objectContaining({
        headers: expect.objectContaining({ 'X-Team-Key': 'forgereview_abc123' }),
      }),
    );
  });

  it('fails and rolls back team config when clearing old credentials throws', async () => {
    const fetchMock = vi.mocked(fetch);
    const exitSpy = mockProcessExit();
    const errorSpy = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
    fetchMock.mockResolvedValue(
      new Response(
        JSON.stringify({
          data: {
            teamName: 'Backend Team',
            organizationName: 'ForgeReview',
          },
        }),
        {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        },
      ),
    );
    mockClearCredentials.mockRejectedValue(new Error('fs error'));

    await expect(teamKeyAction({ key: 'forgereview_abc123' })).rejects.toThrow('process.exit:1');
    expect(exitSpy).toHaveBeenCalledWith(1);
    expect(errorSpy).toHaveBeenCalled();
    expect(mockClearConfig).toHaveBeenCalledTimes(1);
    expect(mockSaveConfig).toHaveBeenCalled();
  });

  it('exits when API returns invalid key', async () => {
    const fetchMock = vi.mocked(fetch);
    const exitSpy = mockProcessExit();
    const errorSpy = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);

    fetchMock.mockResolvedValue(
      new Response(
        JSON.stringify({ message: 'Invalid team key' }),
        {
          status: 401,
          headers: { 'Content-Type': 'application/json' },
        },
      ),
    );

    await expect(teamKeyAction({ key: 'forgereview_abc123' })).rejects.toThrow('process.exit:1');
    expect(exitSpy).toHaveBeenCalledWith(1);
    expect(errorSpy).toHaveBeenCalled();
  });

  it('shows device limit message when API returns DEVICE_LIMIT_REACHED with current count', async () => {
    const fetchMock = vi.mocked(fetch);
    const exitSpy = mockProcessExit();
    const errorSpy = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);

    fetchMock.mockResolvedValue(
      new Response(
        JSON.stringify({
          code: 'DEVICE_LIMIT_REACHED',
          details: { limit: 2, current: 2 },
        }),
        {
          status: 401,
          headers: { 'Content-Type': 'application/json' },
        },
      ),
    );

    await expect(teamKeyAction({ key: 'forgereview_abc123' })).rejects.toThrow('process.exit:1');
    expect(exitSpy).toHaveBeenCalledWith(1);
    const output = errorSpy.mock.calls.map((c) => String(c[0])).join('');
    expect(output).toContain('Device limit reached (2/2). Remove an old device or contact your admin.');
  });
});

describe('auth team-status command', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('shows not-authenticated message when no team config exists', async () => {
    const logSpy = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    mockLoadConfig.mockResolvedValue(null);

    await teamStatusAction();

    const output = logSpy.mock.calls.map((c) => String(c[0])).join('');
    expect(output).toContain('Not authenticated with team key');
  });

  it('shows team details when team config exists', async () => {
    const logSpy = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    mockLoadConfig.mockResolvedValue({
      teamKey: 'forgereview_abc123',
      teamName: 'Platform Team',
      organizationName: 'ForgeReview',
    } as any);

    await teamStatusAction();

    const output = logSpy.mock.calls.map((c) => String(c[0])).join('');
    expect(output).toContain('Authenticated');
    expect(output).toContain('ForgeReview');
    expect(output).toContain('Platform Team');
  });
});
