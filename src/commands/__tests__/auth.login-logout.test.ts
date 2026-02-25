import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';

const spinnerInstances: Array<{ start: ReturnType<typeof vi.fn>; succeed: ReturnType<typeof vi.fn>; fail: ReturnType<typeof vi.fn>; text: string }> = [];

vi.mock('ora', () => ({
  default: vi.fn(() => {
    const spinner = {
      start: vi.fn(),
      succeed: vi.fn(),
      fail: vi.fn(),
      text: '',
    };
    spinnerInstances.push(spinner);
    return spinner;
  }),
}));

vi.mock('inquirer', () => ({
  default: {
    prompt: vi.fn(),
  },
}));

vi.mock('../../services/auth.service.js', () => ({
  authService: {
    isAuthenticated: vi.fn(),
    getCredentials: vi.fn(),
    login: vi.fn(),
    logout: vi.fn(),
  },
}));

import inquirer from 'inquirer';
import { authService } from '../../services/auth.service.js';
import { loginAction } from '../auth/login.js';
import { logoutAction } from '../auth/logout.js';

const mockPrompt = vi.mocked(inquirer.prompt);
const mockAuthService = vi.mocked(authService);

function mockProcessExit(): ReturnType<typeof vi.spyOn> {
  return vi.spyOn(process, 'exit').mockImplementation((code?: string | number | null) => {
    throw new Error(`process.exit:${code ?? 0}`);
  }) as any;
}

describe('auth login command', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    spinnerInstances.length = 0;
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('logs in with provided email/password without prompts', async () => {
    mockAuthService.isAuthenticated.mockResolvedValue(false);
    mockAuthService.login.mockResolvedValue(undefined);

    await loginAction({ email: 'test@example.com', password: 'secret123' });

    expect(mockPrompt).not.toHaveBeenCalled();
    expect(mockAuthService.login).toHaveBeenCalledWith('test@example.com', 'secret123');
    expect(spinnerInstances[0]?.start).toHaveBeenCalled();
    expect(spinnerInstances[0]?.succeed).toHaveBeenCalled();
  });

  it('does not re-login when user cancels account switch', async () => {
    mockAuthService.isAuthenticated.mockResolvedValue(true);
    mockAuthService.getCredentials.mockResolvedValue({
      accessToken: 'token',
      refreshToken: 'refresh',
      expiresAt: Date.now() + 1000 * 60 * 60,
      user: { id: 'u1', email: 'old@example.com', orgs: [] },
    } as any);
    mockPrompt.mockResolvedValue({ confirm: false } as any);

    await loginAction({});

    expect(mockAuthService.login).not.toHaveBeenCalled();
    expect(mockPrompt).toHaveBeenCalledTimes(1);
  });

  it('shows team-key switch prompt message and logs in when confirmed', async () => {
    mockAuthService.isAuthenticated.mockResolvedValue(true);
    mockAuthService.getCredentials.mockResolvedValue(null);
    mockAuthService.login.mockResolvedValue(undefined);
    mockPrompt
      .mockResolvedValueOnce({ confirm: true } as any)
      .mockResolvedValueOnce({ email: 'new@example.com', password: 'secret123' } as any);

    await loginAction({});

    expect(mockPrompt).toHaveBeenCalledTimes(2);
    const firstPrompt = mockPrompt.mock.calls[0][0] as Array<{ message?: string }>;
    expect(firstPrompt[0]?.message).toBe('Do you want to login with an account instead?');
    expect(mockAuthService.login).toHaveBeenCalledWith('new@example.com', 'secret123');
  });

  it('exits with code 1 when login fails', async () => {
    const exitSpy = mockProcessExit();
    const errorSpy = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);

    mockAuthService.isAuthenticated.mockResolvedValue(false);
    mockAuthService.login.mockRejectedValue(new Error('bad credentials'));

    await expect(loginAction({ email: 'test@example.com', password: 'wrong' })).rejects.toThrow('process.exit:1');
    expect(exitSpy).toHaveBeenCalledWith(1);
    expect(errorSpy).toHaveBeenCalled();
  });
});

describe('auth logout command', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    spinnerInstances.length = 0;
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('prints not authenticated when there is no session', async () => {
    const logSpy = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    mockAuthService.isAuthenticated.mockResolvedValue(false);

    await logoutAction();

    expect(mockAuthService.logout).not.toHaveBeenCalled();
    const output = logSpy.mock.calls.map((c) => String(c[0])).join('');
    expect(output).toContain('Not authenticated.');
  });

  it('logs out when authenticated', async () => {
    mockAuthService.isAuthenticated.mockResolvedValue(true);
    mockAuthService.logout.mockResolvedValue(undefined);

    await logoutAction();

    expect(mockAuthService.logout).toHaveBeenCalledTimes(1);
    expect(spinnerInstances[0]?.start).toHaveBeenCalled();
    expect(spinnerInstances[0]?.succeed).toHaveBeenCalled();
  });

  it('exits with code 1 when logout fails', async () => {
    const exitSpy = mockProcessExit();
    const errorSpy = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);

    mockAuthService.isAuthenticated.mockResolvedValue(true);
    mockAuthService.logout.mockRejectedValue(new Error('network'));

    await expect(logoutAction()).rejects.toThrow('process.exit:1');
    expect(exitSpy).toHaveBeenCalledWith(1);
    expect(errorSpy).toHaveBeenCalled();
  });
});
