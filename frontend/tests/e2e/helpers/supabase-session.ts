import { BrowserContext, Page } from '@playwright/test';
import { createClient, type Session } from '@supabase/supabase-js';

const DEFAULT_MAX_LOGIN_ATTEMPTS = 3;
const DEFAULT_RETRY_DELAY_MS = 500;
const DEFAULT_RETRY_JITTER_MS = 250;

export type SupabaseSessionSeed = {
  storageKey: string;
  storageValue: string;
  storageArea: 'localStorage' | 'sessionStorage';
  session: Session;
  userStorageKey?: string;
  userStorageValue?: string;
  cookiePairs?: Array<{ name: string; value: string }>;
  magicLink?: string;
};

type TelemetryStage =
  | 'mock'
  | 'env'
  | 'password-login'
  | 'provision'
  | 'magic-link';

type TelemetryStatus = 'success' | 'error' | 'info' | 'skip';

export type SupabaseSessionTelemetryEvent = {
  stage: TelemetryStage;
  status: TelemetryStatus;
  message: string;
  attempt?: number;
  timestamp: number;
};

export type SupabaseSessionResult =
  | { status: 'success'; seed: SupabaseSessionSeed; telemetry: SupabaseSessionTelemetryEvent[] }
  | { status: 'skipped'; reason: string; telemetry: SupabaseSessionTelemetryEvent[] };

export type SupabaseSessionOptions = {
  email?: string;
  password?: string;
  logger?: (message: string) => void;
  maxAttempts?: number;
  retryDelayMs?: number;
  retryJitterMs?: number;
  onTelemetry?: (event: SupabaseSessionTelemetryEvent) => void;
};

export async function createSupabaseSession(
  options: SupabaseSessionOptions = {},
): Promise<SupabaseSessionResult> {
  const telemetry: SupabaseSessionTelemetryEvent[] = [];
  const log = (
    stage: TelemetryStage,
    status: TelemetryStatus,
    message: string,
    attempt?: number,
  ) => {
    const event: SupabaseSessionTelemetryEvent = {
      stage,
      status,
      message,
      attempt,
      timestamp: Date.now(),
    };
    telemetry.push(event);
    if (options.logger) {
      const attemptSuffix = attempt ? ` (attempt ${attempt})` : '';
      options.logger(`[supabase:${stage}] ${message}${attemptSuffix}`);
    }
    options.onTelemetry?.(event);
  };

  if (process.env.NEXT_PUBLIC_SUPABASE_USE_MOCK === 'true') {
    const userId = 'mock-user-id';
    const expiresIn = 3600;
    const expiresAt = Math.floor(Date.now() / 1000) + expiresIn;
    const mockSession = {
      access_token: `mock-session:${userId}`,
      refresh_token: '',
      expires_in: expiresIn,
      token_type: 'bearer',
      user: {
        id: userId,
        email: options.email ?? 'mock@sora2.app',
      },
      expires_at: expiresAt,
    } as Session;

    log('mock', 'success', 'Using mock Supabase session.');

    return {
      status: 'success',
      seed: {
        storageKey: 'mock-supabase-session',
        storageValue: JSON.stringify(mockSession),
        storageArea: 'sessionStorage',
        session: mockSession,
      },
      telemetry,
    };
  }

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  const email = options.email ?? process.env.LIVE_TEST_EMAIL;
  const password = options.password ?? process.env.LIVE_TEST_PASSWORD;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url || !anonKey || !email || !password) {
    log('env', 'skip', 'Missing required Supabase env configuration.');
    return {
      status: 'skipped',
      reason: 'Supabase session missing required env.',
      telemetry,
    };
  }

  const maxAttempts = Math.max(
    1,
    Number.isFinite(options.maxAttempts ?? NaN)
      ? Math.trunc(options.maxAttempts as number)
      : DEFAULT_MAX_LOGIN_ATTEMPTS,
  );
  const retryDelay = Math.max(
    0,
    Number.isFinite(options.retryDelayMs ?? NaN)
      ? Math.trunc(options.retryDelayMs as number)
      : DEFAULT_RETRY_DELAY_MS,
  );
  const retryJitter = Math.max(
    0,
    Number.isFinite(options.retryJitterMs ?? NaN)
      ? Math.trunc(options.retryJitterMs as number)
      : DEFAULT_RETRY_JITTER_MS,
  );

  const waitWithBackoff = async (attempt: number) => {
    const backoff = retryDelay * attempt;
    const jitter = retryJitter > 0 ? Math.floor(Math.random() * retryJitter) : 0;
    const totalDelay = backoff + jitter;
    if (totalDelay > 0) {
      await wait(totalDelay);
    }
  };

  const projectRef = new URL(url).host.split('.')[0];
  const supabase = createClient(url, anonKey, {
    auth: { persistSession: false },
  });

  const adminClient = serviceRoleKey
    ? createClient(url, serviceRoleKey, {
        auth: { persistSession: false, autoRefreshToken: false },
      })
    : null;

  const encodeBase64Url = (value: string) =>
    Buffer.from(value, 'utf-8')
      .toString('base64')
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
      .replace(/=+$/g, '');

  const buildSessionSeed = (session: Session): SupabaseSessionSeed => {
    const expiresIn = session.expires_in ?? 3600;
    const expiresAt = Math.floor(Date.now() / 1000) + expiresIn;
    const normalizedSession = {
      ...session,
      expires_at: session.expires_at ?? expiresAt,
    } satisfies Session;

    const storageValue = JSON.stringify({
      currentSession: normalizedSession,
      currentUser: normalizedSession.user,
      expiresAt,
    });
    const userStorageKey = `sb-${projectRef}-auth-token-user`;
    const userStorageValue = JSON.stringify({ user: normalizedSession.user });
    const cookiePairs = [
      {
        name: `sb-${projectRef}-auth-token`,
        value: `base64-${encodeBase64Url(storageValue)}`,
      },
      {
        name: userStorageKey,
        value: `base64-${encodeBase64Url(userStorageValue)}`,
      },
    ];

    return {
      storageKey: `sb-${projectRef}-auth-token`,
      storageValue,
      storageArea: 'localStorage',
      session: normalizedSession,
      userStorageKey,
      userStorageValue,
      cookiePairs,
    } satisfies SupabaseSessionSeed;
  };

  const attemptPasswordLogin = async (): Promise<SupabaseSessionSeed | null> => {
    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
      try {
        const { data, error } = await supabase.auth.signInWithPassword({
          email,
          password,
        });

        if (error) {
          log('password-login', 'error', error.message, attempt);
          await waitWithBackoff(attempt);
          continue;
        }

        const session = data.session;
        if (!session) {
          log('password-login', 'error', 'No session returned from Supabase.', attempt);
          await waitWithBackoff(attempt);
          continue;
        }

        const seed = buildSessionSeed(session);
        log('password-login', 'success', 'Supabase password login succeeded.', attempt);
        return seed;
      } catch (cause) {
        log('password-login', 'error', (cause as Error).message, attempt);
        await waitWithBackoff(attempt);
      }
    }

    log(
      'password-login',
      'skip',
      `Supabase login exhausted after ${maxAttempts} attempts.`,
    );
    return null;
  };

  const getMagicLink = async (): Promise<string | undefined> => {
    if (!adminClient) return undefined;

    const redirectTo = process.env.SITE_URL
      ? (() => {
          try {
            const base = process.env.SITE_URL.endsWith('/')
              ? process.env.SITE_URL
              : `${process.env.SITE_URL}/`;
            return new URL('dashboard', base).toString();
          } catch {
            return undefined;
          }
        })()
      : undefined;

    try {
      const { data, error } = await adminClient.auth.admin.generateLink({
        type: 'magiclink',
        email,
        options: redirectTo ? { redirectTo } : undefined,
      });

      if (error) {
        log('magic-link', 'error', error.message ?? 'Unknown magic link error.');
        return undefined;
      }

      const actionLink = (data as Record<string, unknown> | null)?.action_link as
        | string
        | undefined;
      if (actionLink) {
        log('magic-link', 'success', 'Magic link generated.');
        return actionLink;
      }

      log('magic-link', 'error', 'Magic link response missing action link.');
    } catch (error) {
      log('magic-link', 'error', (error as Error).message);
    }

    return undefined;
  };

  const provisionUser = async () => {
    if (!adminClient) {
      log('provision', 'info', 'Service role unavailable; skip provisioning.');
      return false;
    }

    try {
      const normalizedEmail = email.toLowerCase();
      let foundUser: { id: string } | null = null;
      let page = 1;
      const perPage = 200;

      while (!foundUser) {
        const { data, error } = await adminClient.auth.admin.listUsers({ page, perPage });
        if (error) throw error;
        const match = data.users.find((user) => user.email?.toLowerCase() === normalizedEmail);
        if (match) {
          foundUser = { id: match.id };
          break;
        }
        if (data.users.length < perPage) break;
        page += 1;
      }

      if (!foundUser) {
        const created = await adminClient.auth.admin.createUser({
          email,
          password,
          email_confirm: true,
        });

        if (created.error || !created.data?.user) {
          throw created.error ?? new Error('Failed to create Supabase user.');
        }
        foundUser = { id: created.data.user.id };
      } else {
        await adminClient.auth.admin.updateUserById(foundUser.id, {
          password,
          email_confirm: true,
        });
      }

      log('provision', 'success', 'Provisioned Supabase test user via service role.');
      return true;
    } catch (error) {
      log('provision', 'error', (error as Error).message);
      return false;
    }
  };

  const attachMagicLink = async (
    seed: SupabaseSessionSeed,
  ): Promise<SupabaseSessionSeed> => {
    const magicLink = await getMagicLink();
    if (magicLink) {
      return { ...seed, magicLink } satisfies SupabaseSessionSeed;
    }
    return seed;
  };

  const firstPass = await attemptPasswordLogin();
  if (firstPass) {
    const seedWithLink = await attachMagicLink(firstPass);
    return { status: 'success', seed: seedWithLink, telemetry };
  }

  if (await provisionUser()) {
    const secondPass = await attemptPasswordLogin();
    if (secondPass) {
      const seedWithLink = await attachMagicLink(secondPass);
      return { status: 'success', seed: seedWithLink, telemetry };
    }
  }

  const magicLinkFallback = await getMagicLink();
  if (magicLinkFallback) {
    const fallbackSeed: SupabaseSessionSeed = {
      storageKey: `sb-${projectRef}-auth-token`,
      storageValue: '',
      storageArea: 'localStorage',
      session: {} as Session,
      cookiePairs: [],
      magicLink: magicLinkFallback,
    };
    return { status: 'success', seed: fallbackSeed, telemetry };
  }

  return {
    status: 'skipped',
    reason: 'Supabase login exhausted retries.',
    telemetry,
  };
}

export async function applySupabaseSession(options: {
  page: Page;
  context: BrowserContext;
  seed: SupabaseSessionSeed;
  dashboardUrl: string;
}) {
  const { page, context, seed, dashboardUrl } = options;
  const {
    storageKey,
    storageValue,
    storageArea,
    userStorageKey,
    userStorageValue,
    cookiePairs,
  } = seed;

  if (cookiePairs?.length) {
    const origin = new URL(dashboardUrl).origin;
    const isSecure = origin.startsWith('https://');
    await context.addCookies(
      cookiePairs.map(({ name, value }) => ({
        name,
        value,
        url: origin,
        sameSite: 'Lax' as const,
        httpOnly: false,
        secure: isSecure,
        path: '/',
      })),
    );
  }

  await page.addInitScript(
    ([key, value, area, secondaryKey, secondaryValue, cookies]) => {
      const storageKeyValue = typeof key === 'string' ? key : '';
      const primaryValue = typeof value === 'string' ? value : '';
      const targetArea = area === 'sessionStorage' ? 'sessionStorage' : 'localStorage';
      const target = targetArea === 'sessionStorage' ? window.sessionStorage : window.localStorage;
      target.setItem(storageKeyValue, primaryValue);
      if (typeof secondaryKey === 'string' && typeof secondaryValue === 'string') {
        target.setItem(secondaryKey, secondaryValue);
      }
      if (Array.isArray(cookies)) {
        const maxAge = 400 * 24 * 60 * 60;
        cookies.forEach((entry) => {
          if (!Array.isArray(entry)) return;
          const [cookieName, cookieValue] = entry;
          if (typeof cookieName === 'string' && typeof cookieValue === 'string') {
            document.cookie = `${cookieName}=${cookieValue}; Path=/; Max-Age=${maxAge}; SameSite=Lax`;
          }
        });
      }
    },
    [
      storageKey,
      storageValue,
      storageArea,
      userStorageKey ?? null,
      userStorageValue ?? null,
      cookiePairs?.map((entry) => [entry.name, entry.value]) ?? null,
    ],
  );
}

export async function clearSupabaseState(page: Page) {
  await page.context().clearCookies();
  await page.evaluate(() => {
    try {
      window.localStorage.clear();
      window.sessionStorage.clear();
    } catch (error) {
      console.warn('supabase-session: unable to clear storage', error);
    }
  });
}

async function wait(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
