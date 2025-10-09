import { Page } from '@playwright/test';
import { createClient, type Session } from '@supabase/supabase-js';

const MAX_LOGIN_ATTEMPTS = 3;

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

export async function createSupabaseSession(options?: {
  email?: string;
  password?: string;
  logger?: (message: string) => void;
}): Promise<SupabaseSessionSeed | null> {
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
        email: options?.email ?? 'mock@sora2.app',
      },
      expires_at: expiresAt,
    } as Session;

    return {
      storageKey: 'mock-supabase-session',
      storageValue: JSON.stringify(mockSession),
      storageArea: 'sessionStorage' as const,
      session: mockSession,
    };
  }

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  const email = options?.email ?? process.env.LIVE_TEST_EMAIL;
  const password = options?.password ?? process.env.LIVE_TEST_PASSWORD;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url || !anonKey || !email || !password) {
    options?.logger?.('Supabase session missing required env.');
    return null;
  }

  const projectRef = new URL(url).host.split('.')[0];
  const supabase = createClient(url, anonKey, {
    auth: { persistSession: false },
  });

  const adminClient = serviceRoleKey
    ? createClient(url, serviceRoleKey, {
        auth: { persistSession: false, autoRefreshToken: false },
      })
    : null;

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
        options?.logger?.(
          `Supabase magic link error: ${error.message ?? 'unknown error'}`,
        );
        return undefined;
      }
      const actionLink = (data as Record<string, unknown> | null)?.action_link as
        | string
        | undefined;
      if (actionLink) {
        return actionLink;
      }
      options?.logger?.('Supabase magic link missing action link response.');
    } catch (error) {
      options?.logger?.(
        `Supabase magic link provisioning failed: ${(error as Error).message}`,
      );
    }

    return undefined;
  };

  const attemptPasswordLogin = async () => {
    for (let attempt = 1; attempt <= MAX_LOGIN_ATTEMPTS; attempt += 1) {
      try {
        const { data, error } = await supabase.auth.signInWithPassword({
          email,
          password,
        });

        if (error) {
          options?.logger?.(`Supabase login attempt ${attempt} failed: ${error.message}`);
          await wait(attempt * 500);
          continue;
        }

        const session = data.session;
        if (!session) {
          options?.logger?.(`Supabase login attempt ${attempt} returned no session.`);
          await wait(attempt * 500);
          continue;
        }

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
        const encodeBase64Url = (value: string) =>
          Buffer.from(value, 'utf-8')
            .toString('base64')
            .replace(/\+/g, '-')
            .replace(/\//g, '_')
            .replace(/=+$/g, '');
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
          storageArea: 'localStorage' as const,
          session: normalizedSession,
          userStorageKey,
          userStorageValue,
          cookiePairs,
        };
      } catch (cause) {
        options?.logger?.(
          `Supabase login attempt ${attempt} threw error: ${(cause as Error).message}`,
        );
        await wait(attempt * 500);
      }
    }
    return null;
  };

  const provisionUser = async () => {
    if (!adminClient) return false;

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
          throw created.error ?? new Error('Failed to create Supabase user');
        }
        foundUser = { id: created.data.user.id };
      } else {
        await adminClient.auth.admin.updateUserById(foundUser.id, {
          password,
          email_confirm: true,
        });
      }

      options?.logger?.('Provisioned Supabase test user via service role.');
      return true;
    } catch (error) {
      options?.logger?.(
        `Supabase provisioning failed: ${(error as Error).message}`,
      );
      return false;
    }
  };

  const firstPass = await attemptPasswordLogin();
  if (firstPass) {
    const magicLink = await getMagicLink();
    return magicLink ? { ...firstPass, magicLink } : firstPass;
  }

  if (await provisionUser()) {
    const secondPass = await attemptPasswordLogin();
    if (secondPass) {
      const magicLink = await getMagicLink();
      return magicLink ? { ...secondPass, magicLink } : secondPass;
    }
  }

  const magicLink = await getMagicLink();
  if (magicLink) {
    return {
      storageKey: `sb-${projectRef}-auth-token`,
      storageValue: '',
      storageArea: 'localStorage',
      session: {} as Session,
      cookiePairs: [],
      magicLink,
    } satisfies SupabaseSessionSeed;
  }

  options?.logger?.('Supabase login exhausted retries.');
  return null;
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
