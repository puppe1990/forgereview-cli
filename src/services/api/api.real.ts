import type {
  AuthResponse,
  ReviewConfig,
  ReviewResult,
  PullRequestSuggestionsResponse,
  TrialReviewResult,
  TrialStatus,
} from '../../types/index.js';
import { ApiError } from '../../types/index.js';
import type { MemoryCaptureApiRequest, MemoryCaptureApiResponse } from '../../types/index.js';
import type { IForgeReviewApi, IAuthApi, IReviewApi, ITrialApi, IMemoryApi, GitMetrics } from './api.interface.js';
import { getDeviceIdentity, updateDeviceToken } from '../../utils/device.js';
import { cliLogger } from '../../utils/logger.js';

/**
 * Validates and returns the API base URL
 * Prevents URL injection attacks by validating custom API URLs
 */
function getApiBaseUrl(): string {
  const customUrl = process.env.FORGEREVIEW_API_URL;
  const defaultUrl = 'https://api.forgereview.io';

  if (!customUrl) {
    return defaultUrl;
  }

  try {
    const url = new URL(customUrl);

    // Only allow HTTPS (except localhost for development)
    const isLocalhost = url.hostname === 'localhost' || url.hostname === '127.0.0.1';
    if (url.protocol !== 'https:' && !isLocalhost) {
      cliLogger.error('Security Error: FORGEREVIEW_API_URL must use HTTPS protocol');
      cliLogger.error(`Falling back to default: ${defaultUrl}`);
      return defaultUrl;
    }

    // Warn about non-standard API URLs
    const standardDomains = ['api.forgereview.io', 'localhost', '127.0.0.1'];
    const isStandard = standardDomains.some(domain => url.hostname === domain || url.hostname.endsWith(`.${domain}`));

    if (!isStandard && process.env.FORGEREVIEW_VERBOSE) {
      cliLogger.verbose(`Warning: Using non-standard API URL: ${url.hostname}`);
    }

    return customUrl;
  } catch (error) {
    cliLogger.error(`Invalid FORGEREVIEW_API_URL format: ${customUrl}`);
    cliLogger.error(`Falling back to default: ${defaultUrl}`);
    return defaultUrl;
  }
}

const API_BASE_URL = getApiBaseUrl();
const REQUEST_TIMEOUT_MS = 20 * 60 * 1000; // 20 minutes

interface ApiErrorPayload {
  message?: string;
  code?: string;
  details?: {
    limit?: number;
    current?: number;
    activeDevices?: number;
  };
}

function getDefaultApiErrorMessage(statusCode: number, endpoint: string): string {
  const endpointPath = endpoint.split('?')[0] || endpoint;

  if (statusCode === 400) {
    return `Invalid request sent to ForgeReview API (${endpointPath}).`;
  }

  if (statusCode === 401) {
    if (endpointPath === '/pull-requests/suggestions') {
      return 'Authentication failed while fetching pull request suggestions. Run: forgereview auth login or configure a valid team key.';
    }
    return 'Authentication failed. Run: forgereview auth login or configure a valid team key.';
  }

  if (statusCode === 403) {
    return `Access denied for ForgeReview API endpoint (${endpointPath}).`;
  }

  if (statusCode === 404) {
    return `ForgeReview API endpoint not found (${endpointPath}).`;
  }

  if (statusCode === 422) {
    return `ForgeReview API could not process the request (${endpointPath}).`;
  }

  if (statusCode === 429) {
    return 'Rate limit exceeded. Please try again later.';
  }

  if (statusCode >= 500) {
    return 'ForgeReview API is currently unavailable. Please try again.';
  }

  return `Request failed with status ${statusCode}`;
}

function normalizeApiErrorMessage(statusCode: number, endpoint: string, errorData: ApiErrorPayload): string {
  if (errorData.code === 'DEVICE_LIMIT_REACHED') {
    const limit = errorData.details?.limit;
    const activeDevices = errorData.details?.current ?? errorData.details?.activeDevices;
    if (typeof limit === 'number' && typeof activeDevices === 'number') {
      return `Device limit reached (${activeDevices}/${limit}). Remove an old device or contact your admin.`;
    }
    return 'Device limit reached for this organization. Remove an old device or contact your admin.';
  }

  const fallbackMessage = getDefaultApiErrorMessage(statusCode, endpoint);
  if (!errorData.message || typeof errorData.message !== 'string') {
    return fallbackMessage;
  }

  // Keep auth/permission/server errors deterministic and always in CLI English.
  if (statusCode === 401 || statusCode === 403 || statusCode === 404 || statusCode === 429 || statusCode >= 500) {
    return fallbackMessage;
  }

  const trimmed = errorData.message.trim();
  if (!trimmed) {
    return fallbackMessage;
  }

  const hasNonAscii = Array.from(trimmed).some((ch) => ch.charCodeAt(0) > 0x7f);
  if (hasNonAscii) {
    return fallbackMessage;
  }

  return trimmed;
}

async function request<T>(
  endpoint: string,
  options: RequestInit = {}
): Promise<T> {
  const url = `${API_BASE_URL}${endpoint}`;
  let deviceIdentity: { deviceId: string; deviceToken?: string } | undefined;

  cliLogger.verbose(`[API] ${options.method || 'GET'} ${url}`);

  try {
    deviceIdentity = await getDeviceIdentity();
  } catch (error) {
    cliLogger.verbose(`[API] Unable to resolve device id: ${error instanceof Error ? error.message : String(error)}`);
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  let response: Response;
  try {
    response = await fetch(url, {
      ...options,
      signal: controller.signal,
      headers: {
        'Content-Type': 'application/json',
        ...(deviceIdentity?.deviceId ? { 'X-ForgeReview-Device-Id': deviceIdentity.deviceId } : {}),
        ...(deviceIdentity?.deviceToken ? { 'X-ForgeReview-Device-Token': deviceIdentity.deviceToken } : {}),
        ...options.headers,
      },
    });
  } catch (error) {
    clearTimeout(timeout);
    if (error instanceof DOMException && error.name === 'AbortError') {
      throw new ApiError(408, 'Request timed out. The server took too long to respond. Please try again.');
    }
    throw error;
  }

  clearTimeout(timeout);

  const responseDeviceToken = response.headers.get('x-forgereview-device-token');
  if (responseDeviceToken) {
    await updateDeviceToken(responseDeviceToken).catch(() => {});
  }

  const contentType = response.headers.get('content-type') || '';
  const isJson = contentType.includes('application/json');

  if (!response.ok) {
    const rawError = isJson
      ? await response.json().catch(() => ({ message: 'Request failed' }))
      : { message: `Request failed with status ${response.status}` };
    // Unwrap API envelope: errors may arrive as { data: { code, message, ... } }
    // Only unwrap if the top-level object has no message/code of its own.
    const errorData: ApiErrorPayload =
      rawError && typeof rawError === 'object' && 'data' in rawError && rawError.data && typeof rawError.data === 'object' && !('message' in rawError) && !('code' in rawError)
        ? rawError.data as ApiErrorPayload
        : rawError as ApiErrorPayload;
    const errorMessage = normalizeApiErrorMessage(response.status, endpoint, errorData);

    cliLogger.verbose({
      msg: '[API] Error',
      status: response.status,
      url,
      contentType,
      errorData,
      normalizedMessage: errorMessage,
    });

    throw new ApiError(response.status, errorMessage);
  }

  if (!isJson) {
    const text = await response.text();
    const preview = text.substring(0, 100);
    cliLogger.error(`[API] Expected JSON but received ${contentType || 'unknown content-type'}`);
    cliLogger.error(`[API] URL: ${url}`);
    cliLogger.error(`[API] Response preview: ${preview}...`);
    throw new ApiError(500, `API returned invalid response (expected JSON, got ${contentType || 'HTML'})`);
  }

  const json = await response.json() as any;

  if (process.env.FORGEREVIEW_VERBOSE) {
    cliLogger.verbose(`[API] Raw response structure: ${Object.keys(json).join(', ')}`);
    if (json && typeof json === 'object') {
      // Log key fields without logging full content (could be huge)
      const preview: Record<string, unknown> = {};
      for (const key of Object.keys(json)) {
        const val = json[key];
        if (typeof val === 'string' && val.length > 100) {
          preview[key] = `[string: ${val.length} chars]`;
        } else if (Array.isArray(val)) {
          preview[key] = `[array: ${val.length} items]`;
        } else if (typeof val === 'object' && val !== null) {
          preview[key] = `[object: ${Object.keys(val).join(', ')}]`;
        } else {
          preview[key] = val;
        }
      }
      cliLogger.verbose(`[API] Response preview: ${JSON.stringify(preview, null, 2)}`);
    }
  }

  // API usually returns { data: {...}, statusCode, type }
  // Return only .data when present.
  if (json && typeof json === 'object' && 'data' in json) {
    return json.data as T;
  }

  return json as T;
}

const RETRY_BACKOFF_MS = [1000, 3000];
const RETRYABLE_STATUS_CODES = new Set([429, 500, 502, 503, 504]);

async function requestWithRetry<T>(
  endpoint: string,
  options: RequestInit = {}
): Promise<T> {
  let lastError: unknown;

  for (let attempt = 0; attempt <= RETRY_BACKOFF_MS.length; attempt++) {
    try {
      return await request<T>(endpoint, options);
    } catch (error) {
      lastError = error;

      const isLastAttempt = attempt >= RETRY_BACKOFF_MS.length;
      if (isLastAttempt) break;

      // Only retry on network errors or retryable status codes
      const isRetryable =
        (error instanceof ApiError && RETRYABLE_STATUS_CODES.has(error.statusCode)) ||
        (!(error instanceof ApiError) && error instanceof Error);

      if (!isRetryable) break;

      cliLogger.verbose(`[API] Retry ${attempt + 1}/${RETRY_BACKOFF_MS.length} after ${RETRY_BACKOFF_MS[attempt]}ms`);

      await new Promise(resolve => setTimeout(resolve, RETRY_BACKOFF_MS[attempt]));
    }
  }

  throw lastError;
}

class RealAuthApi implements IAuthApi {
  async login(email: string, password: string): Promise<AuthResponse> {
    const response = await requestWithRetry<{ accessToken: string; refreshToken: string }>('/auth/login', {
      method: 'POST',
      body: JSON.stringify({ email, password }),
    });

    // Map API response into the CLI auth shape.
    return {
      accessToken: response.accessToken,
      refreshToken: response.refreshToken,
      expiresIn: 3600, // Default: 1 hour
      user: {
        id: 'unknown', // Login response does not include user profile fields.
        email,
        orgs: [],
      },
    };
  }

  async refresh(refreshToken: string): Promise<AuthResponse> {
    return requestWithRetry<AuthResponse>('/auth/refresh', {
      method: 'POST',
      body: JSON.stringify({ refreshToken }),
    });
  }

  async logout(accessToken: string): Promise<void> {
    await requestWithRetry<void>('/auth/logout', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
      },
    });
  }

  async generateCIToken(accessToken: string): Promise<string> {
    const response = await requestWithRetry<{ token: string }>('/auth/ci-token', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
      },
    });
    return response.token;
  }

  async verify(accessToken: string): Promise<{ valid: boolean; user?: any }> {
    // SECURITY NOTE: This performs basic client-side JWT validation without signature verification.
    // This is acceptable for a CLI client where:
    // 1. The token is securely stored locally and only accessed by the user
    // 2. The API validates the token signature on every request
    // 3. We only check format and expiration to avoid unnecessary API calls
    //
    // For production security, all authorization decisions MUST be made by the API
    // after validating the token signature.

    if (!accessToken || !accessToken.startsWith('eyJ')) {
      return { valid: false };
    }

    try {
      // Decode JWT payload (without signature validation)
      const parts = accessToken.split('.');
      if (parts.length !== 3) {
        return { valid: false };
      }

      const payload = JSON.parse(Buffer.from(parts[1], 'base64').toString());

      // Check expiration
      if (payload.exp && payload.exp * 1000 < Date.now()) {
        return { valid: false };
      }

      return {
        valid: true,
        user: {
          id: payload.sub || 'unknown',
          email: payload.email || 'unknown',
          orgs: [],
        },
      };
    } catch (error) {
      cliLogger.verbose(`Token verification failed: ${error instanceof Error ? error.message : String(error)}`);
      return { valid: false };
    }
  }
}

class RealReviewApi implements IReviewApi {
  async analyze(diff: string, accessToken: string, config?: ReviewConfig): Promise<ReviewResult> {
    const isTeamKey = accessToken.startsWith('forgereview_');

    cliLogger.verbose('[API] analyze() called');
    cliLogger.verbose(`[API]   - diff length: ${diff.length} chars`);
    cliLogger.verbose(`[API]   - isTeamKey: ${isTeamKey}`);
    cliLogger.verbose(`[API]   - config files: ${config?.files?.length ?? 0}`);

    if (isTeamKey) {
      return requestWithRetry<ReviewResult>('/cli/review', {
        method: 'POST',
        headers: {
          'X-Team-Key': accessToken,
        },
        body: JSON.stringify({ diff, config }),
      });
    }

    let teamId: string | undefined;
    try {
      const payload = JSON.parse(Buffer.from(accessToken.split('.')[1], 'base64').toString());
      teamId = payload.organizationId;
    } catch (error) {
      // Ignore if cannot decode
    }

    const endpoint = teamId ? `/cli/review?teamId=${encodeURIComponent(teamId)}` : '/cli/review';

    return requestWithRetry<ReviewResult>(endpoint, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
      },
      body: JSON.stringify({ diff, config }),
    });
  }

  async analyzeWithMetrics(
    diff: string,
    accessToken: string,
    config?: ReviewConfig,
    metrics?: GitMetrics
  ): Promise<ReviewResult> {
    const isTeamKey = accessToken.startsWith('forgereview_');

    if (isTeamKey) {
      return requestWithRetry<ReviewResult>('/cli/review', {
        method: 'POST',
        headers: {
          'X-Team-Key': accessToken,
        },
        body: JSON.stringify({
          diff,
          config,
          ...metrics,
        }),
      });
    }

    return this.analyze(diff, accessToken, config);
  }

  async getPullRequestSuggestions(
    accessToken: string,
    params: { prUrl?: string; prNumber?: number; repositoryId?: string; format?: 'markdown'; severity?: string; category?: string }
  ): Promise<PullRequestSuggestionsResponse> {
    const query = new URLSearchParams();

    if (params.prUrl) {
      query.set('prUrl', params.prUrl);
    }

    if (params.prNumber !== undefined) {
      query.set('prNumber', params.prNumber.toString());
    }

    if (params.repositoryId) {
      query.set('repositoryId', params.repositoryId);
    }

    if (params.format) {
      query.set('format', params.format);
    }

    if (params.severity) {
      query.set('severity', params.severity);
    }

    if (params.category) {
      query.set('category', params.category);
    }

    const queryString = query.toString();
    const endpoint = `/pull-requests/suggestions${queryString ? `?${queryString}` : ''}`;
    const isTeamKey = accessToken.startsWith('forgereview_');

    return requestWithRetry<PullRequestSuggestionsResponse>(endpoint, {
      headers: {
        ...(isTeamKey
          ? { 'X-Team-Key': accessToken }
          : { Authorization: `Bearer ${accessToken}` }),
      },
    });
  }

  async trialAnalyze(diff: string, fingerprint: string): Promise<TrialReviewResult> {
    cliLogger.verbose('[API] trialAnalyze() called');
    cliLogger.verbose(`[API]   - diff length: ${diff.length} chars`);
    cliLogger.verbose(`[API]   - fingerprint: ${fingerprint.substring(0, 8)}...`);

    return requestWithRetry<TrialReviewResult>('/cli/trial/review', {
      method: 'POST',
      body: JSON.stringify({ diff, fingerprint }),
    });
  }
}

class RealTrialApi implements ITrialApi {
  async getStatus(fingerprint: string): Promise<TrialStatus> {
    return requestWithRetry<TrialStatus>(`/cli/trial/status?fingerprint=${fingerprint}`);
  }
}

class RealMemoryApi implements IMemoryApi {
  async submitCapture(payload: MemoryCaptureApiRequest, accessToken: string): Promise<MemoryCaptureApiResponse> {
    const isTeamKey = accessToken.startsWith('forgereview_');
    const headers: Record<string, string> = isTeamKey
      ? { 'X-Team-Key': accessToken }
      : { Authorization: `Bearer ${accessToken}` };

    return request<MemoryCaptureApiResponse>('/cli/memory/captures', {
      method: 'POST',
      headers,
      body: JSON.stringify(payload),
    });
  }
}

export class RealApi implements IForgeReviewApi {
  auth: IAuthApi = new RealAuthApi();
  review: IReviewApi = new RealReviewApi();
  trial: ITrialApi = new RealTrialApi();
  memory: IMemoryApi = new RealMemoryApi();
}
