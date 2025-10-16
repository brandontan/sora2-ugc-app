"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { type Session, type SupabaseClient } from "@supabase/supabase-js";
import { createBrowserClient } from "@supabase/ssr";
import { generateProfileTemplate, type GeneratedProfile } from "@/lib/profile";

type Profile = {
  id: string;
  display_name: string | null;
  avatar_seed: string | null;
  avatar_style: string | null;
  job_tray_cleared_before: string | null;
};

type SupabaseContextValue = {
  supabase: SupabaseClient | MockSupabaseClient | null;
  session: Session | null;
  loading: boolean;
  profile: Profile | null;
  profileLoading: boolean;
  refreshProfile: () => Promise<void>;
  isAdmin: boolean;
};

const createMockAccessToken = (): string => {
  const uuid = typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  return `mock:${uuid}`;
};

const SupabaseContext = createContext<SupabaseContextValue | undefined>(
  undefined,
);

export function SupabaseProvider({
  children,
}: {
  children: React.ReactNode;
}) {
  const [supabase, setSupabase] = useState<
    SupabaseClient | MockSupabaseClient | null
  >(null);
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [profileLoading, setProfileLoading] = useState(false);
  const [isAdmin, setIsAdmin] = useState(false);
  const allowedEmails = useMemo(
    () =>
      (
        process.env.NEXT_PUBLIC_ADMIN_ALLOWED_EMAILS ??
        process.env.ADMIN_ALLOWED_EMAILS ??
        "brandontan@gmail.com"
      )
        .split(",")
        .map((value) => value.trim().toLowerCase())
        .filter((value) => value.length > 0),
    [],
  );

  const refreshProfile = useCallback(async () => {
    if (!supabase || !session?.user?.id) {
      setProfile(null);
      setProfileLoading(false);
      return;
    }

    setProfileLoading(true);
    try {
      const userId = session.user.id;
      const email = session.user.email ?? null;
      const client = supabase as SupabaseClient;

      const { data: existing, error } = await client
        .from("profiles")
        .select("id, display_name, avatar_seed, avatar_style, job_tray_cleared_before")
        .eq("id", userId)
        .maybeSingle();

      if (error) throw error;

     const generated = generateProfileTemplate(userId, email);
     const needsUpdate =
       !existing ||
       !existing.avatar_seed ||
       !existing.avatar_style ||
       !existing.display_name;

      if (needsUpdate) {
        const upsertResult = await client
          .from("profiles")
          .upsert(
            {
              id: userId,
              display_name: generated.displayName,
              avatar_seed: generated.avatarSeed,
              avatar_style: generated.avatarStyle,
              job_tray_cleared_before:
                existing?.job_tray_cleared_before ?? null,
            },
            { onConflict: "id" },
          )
          .select()
          .maybeSingle();

        if (upsertResult.error) {
          const isRls = upsertResult.error.message?.includes("row-level security");
          if (isRls && session?.access_token) {
            const response = await fetch("/api/profile/ensure", {
              method: "POST",
              headers: {
                "Content-Type": "application/json",
              },
              body: JSON.stringify({
                accessToken: session.access_token,
                userId,
                email,
              }),
            });

            if (response.ok) {
              const payload = (await response.json()) as { profile?: Profile | GeneratedProfile };
              const ensured = payload.profile as Profile | undefined;
              setProfile(
                ensured
                  ? {
                      id: ensured.id,
                      display_name: ensured.display_name,
                      avatar_seed: ensured.avatar_seed,
                      avatar_style: ensured.avatar_style,
                      job_tray_cleared_before:
                        ensured.job_tray_cleared_before ?? existing?.job_tray_cleared_before ?? null,
                    }
                  : {
                      id: userId,
                      display_name: generated.displayName,
                      avatar_seed: generated.avatarSeed,
                      avatar_style: generated.avatarStyle,
                      job_tray_cleared_before: existing?.job_tray_cleared_before ?? null,
                    },
              );
              return;
            }
          }
          throw upsertResult.error;
        }

        setProfile(
          upsertResult.data ?? {
            id: userId,
            display_name: generated.displayName,
            avatar_seed: generated.avatarSeed,
            avatar_style: generated.avatarStyle,
            job_tray_cleared_before: existing?.job_tray_cleared_before ?? null,
          },
        );
      } else {
        setProfile({
          id: existing.id,
          display_name: existing.display_name,
          avatar_seed: existing.avatar_seed,
          avatar_style: existing.avatar_style,
          job_tray_cleared_before: existing.job_tray_cleared_before ?? null,
        });
      }
    } catch (error) {
      console.warn("supabase-profile", error);
    } finally {
      setProfileLoading(false);
    }
  }, [supabase, session?.user?.id, session?.user?.email, session?.access_token]);

  useEffect(() => {
    if (typeof window === "undefined") return;

    if (process.env.NEXT_PUBLIC_SUPABASE_USE_MOCK === "true") {
      const mock = createMockSupabaseClient((newSession) => {
        setSession(newSession);
      });
      setSupabase(mock);
      setLoading(false);
      setProfileLoading(false);
      return () => {
        mock.cleanup();
      };
    }

    const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

    if (!url || !key) {
      console.warn(
        "Supabase env vars missing. Set NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY.",
      );
      setLoading(false);
      return;
    }

    const client = createBrowserClient(url, key);
    setSupabase(client);

    let mounted = true;

    client.auth
      .getSession()
      .then(({ data }) => {
        if (mounted) {
          setSession(data.session ?? null);
          setLoading(false);
          if (!data.session) {
            setProfile(null);
            setProfileLoading(false);
          }
        }
      })
      .catch(() => mounted && setLoading(false));

    const {
      data: { subscription },
    } = client.auth.onAuthStateChange((_event, newSession) => {
      if (mounted) {
        setSession(newSession);
        const email = newSession?.user?.email ?? null;
        setIsAdmin(email ? allowedEmails.includes(email.toLowerCase()) : false);
      }
    });

    return () => {
      mounted = false;
      subscription.unsubscribe();
    };
  }, [allowedEmails]);

  useEffect(() => {
    if (!supabase) return;
    if (!session?.user?.id) {
      setProfile(null);
      setProfileLoading(false);
      return;
    }
    void refreshProfile();
  }, [supabase, session?.user?.id, refreshProfile]);

  useEffect(() => {
    const email = session?.user?.email ?? null;
    setIsAdmin(email ? allowedEmails.includes(email.toLowerCase()) : false);
  }, [session?.user?.email, allowedEmails]);

  const inactivityMinutes = useMemo(() => {
    const raw = process.env.NEXT_PUBLIC_SESSION_TIMEOUT_MINUTES;
    if (!raw) return 30;
    const parsed = Number(raw);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : 30;
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") return;
    if (!supabase || !session?.user?.id) {
      window.localStorage.removeItem("gvf:last-activity");
      return;
    }

    const limitMs = inactivityMinutes * 60_000;
    const storageKey = "gvf:last-activity";
    const events: Array<keyof WindowEventMap> = [
      "mousemove",
      "keydown",
      "click",
      "touchstart",
      "focus",
    ];

    let timeoutId: ReturnType<typeof setTimeout> | undefined;

    const scheduleSignOut = () => {
      if (timeoutId) clearTimeout(timeoutId);
      timeoutId = setTimeout(() => {
        supabase.auth.signOut().catch((error) => {
          console.warn("session-timeout", error);
        });
      }, limitMs);
    };

    const handleActivity = () => {
      window.localStorage.setItem(storageKey, Date.now().toString());
      scheduleSignOut();
    };

    const lastActivityRaw = window.localStorage.getItem(storageKey);
    let lastActivity = lastActivityRaw ? Number(lastActivityRaw) : NaN;
    if (!Number.isFinite(lastActivity)) {
      lastActivity = Date.now();
      window.localStorage.setItem(storageKey, lastActivity.toString());
    } else if (Date.now() - lastActivity >= limitMs) {
      void supabase.auth.signOut();
      return;
    }

    scheduleSignOut();
    events.forEach((event) => window.addEventListener(event, handleActivity));

    return () => {
      if (timeoutId) clearTimeout(timeoutId);
      events.forEach((event) => window.removeEventListener(event, handleActivity));
    };
  }, [supabase, session?.user?.id, inactivityMinutes]);

  const value = useMemo(
    () => ({
      supabase,
      session,
      loading,
      profile,
      profileLoading,
      refreshProfile,
      isAdmin,
    }),
    [supabase, session, loading, profile, profileLoading, refreshProfile, isAdmin],
  );

  return (
    <SupabaseContext.Provider value={value}>
      {children}
    </SupabaseContext.Provider>
  );
}

export function useSupabase() {
  const context = useContext(SupabaseContext);
  if (!context) {
    throw new Error("useSupabase must be used within SupabaseProvider");
  }
  return context;
}

type MockSupabaseClient = {
  auth: {
    getSession: () => Promise<{ data: { session: Session | null } }>;
    onAuthStateChange: (
      callback: (event: string, session: Session | null) => void,
    ) => { data: { subscription: { unsubscribe: () => void } } };
    signInWithOtp: (args: { email: string }) => Promise<{ error: null }>;
    verifyOtp: (args: {
      email: string;
      token: string;
      type: string;
    }) => Promise<{ data: { session: Session | null }; error: null }>;
    signOut: () => Promise<{ error: null }>;
  };
  from: (table: string) => unknown;
  storage: {
    from: (_bucket: string) => {
      upload: (
        _path: string,
        _file: File | Blob,
      ) => Promise<{ data: { path: string }; error: null }>;
    };
  };
  cleanup: () => void;
};

function createMockSupabaseClient(
  onSessionChange: (session: Session | null) => void,
): MockSupabaseClient {
  const STORAGE_KEY = 'mock-supabase-session';

  const loadSession = (): Session | null => {
    if (typeof window === 'undefined') return null;
    const raw = window.sessionStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    try {
      const parsed = JSON.parse(raw) as Session;
      return parsed;
    } catch {
      return null;
    }
  };

  let currentSession: Session | null = loadSession();
  let listener:
    | ((event: string, session: Session | null) => void)
    | null = null;

  const userId = "mock-user-id";
  let mockProfile: Profile | null = null;

  const ensureMockProfile = (email?: string | null) => {
    if (!mockProfile) {
      const generated = generateProfileTemplate(userId, email);
      mockProfile = {
        id: userId,
        display_name: generated.displayName,
        avatar_seed: generated.avatarSeed,
        avatar_style: generated.avatarStyle,
      };
    }
    return mockProfile;
  };

  const buildSession = (email: string): Session => {
    const template = generateProfileTemplate(userId, email);
    mockProfile = {
      id: userId,
      display_name: template.displayName,
      avatar_seed: template.avatarSeed,
      avatar_style: template.avatarStyle,
    };
    const accessToken = createMockAccessToken();
    return {
      access_token: accessToken,
      refresh_token: "",
      expires_in: 3600,
      expires_at: Math.floor(Date.now() / 1000) + 3600,
      token_type: "bearer",
      user: {
        id: userId,
        email,
      } as unknown as Session["user"],
    } as Session;
  };

  const saveSession = (session: Session | null) => {
    if (typeof window === 'undefined') return;
    if (session) {
      window.sessionStorage.setItem(STORAGE_KEY, JSON.stringify(session));
    } else {
      window.sessionStorage.removeItem(STORAGE_KEY);
    }
  };

  const notify = (event: string, session: Session | null) => {
    onSessionChange(session);
    listener?.(event, session);
  };

  const fetchState = async () => {
    try {
      const response = await fetch(
        `/api/mock/state?user_id=${encodeURIComponent(userId)}`,
      );
      if (!response.ok) {
        return { ledger: [], jobs: [] };
      }
      return (await response.json()) as { ledger: unknown[]; jobs: unknown[] };
    } catch {
      return { ledger: [], jobs: [] };
    }
  };

  const client: MockSupabaseClient = {
    auth: {
      async getSession() {
        return { data: { session: currentSession } };
      },
      onAuthStateChange(callback) {
        listener = callback;
        return {
          data: {
            subscription: {
              unsubscribe() {
                listener = null;
              },
            },
          },
        };
      },
      async signInWithOtp({ email }) {
        currentSession = buildSession(email);
        saveSession(currentSession);
        notify("SIGNED_IN", currentSession);
        return { error: null };
      },
      async verifyOtp({ email }) {
        currentSession = buildSession(email);
        saveSession(currentSession);
        notify("SIGNED_IN", currentSession);
        return { data: { session: currentSession }, error: null };
      },
      async signOut() {
        currentSession = null;
        saveSession(null);
        notify("SIGNED_OUT", null);
        return { error: null };
      },
    },
    from(table: string) {
      if (table === "profiles") {
        return {
          select() {
            return {
              eq(_column: string, value: string) {
                return {
                  async maybeSingle() {
                    if (value !== userId) {
                      return { data: null, error: null };
                    }
                    return { data: ensureMockProfile(currentSession?.user?.email ?? null), error: null };
                  },
                  async single() {
                    const profile = ensureMockProfile(currentSession?.user?.email ?? null);
                    if (value !== userId) {
                      return { data: profile, error: null };
                    }
                    return { data: profile, error: null };
                  },
                };
              },
            };
          },
          upsert(payload: Record<string, unknown> | Record<string, unknown>[]) {
            const record = Array.isArray(payload) ? payload[0] : payload;
            const base = ensureMockProfile(currentSession?.user?.email ?? null);
            mockProfile = {
              id: userId,
              display_name: (record?.display_name as string | undefined) ?? base.display_name,
              avatar_seed: (record?.avatar_seed as string | undefined) ?? base.avatar_seed,
              avatar_style: (record?.avatar_style as string | undefined) ?? base.avatar_style,
            };
            return {
              select() {
                return {
                  async maybeSingle() {
                    return { data: mockProfile, error: null };
                  },
                  async single() {
                    return { data: mockProfile, error: null };
                  },
                };
              },
            };
          },
        };
      }
      return {
        select() {
          const run = async (): Promise<{ data: unknown[]; error: null }> => {
            const state = await fetchState();
            if (table === "credit_ledger") {
              return { data: [...state.ledger], error: null };
            }
            if (table === "jobs") {
              return { data: [...state.jobs], error: null };
            }
            return { data: [], error: null };
          };

          return {
            eq() {
              const response = {
                async order() {
                  return run();
                },
                then(
                  onfulfilled: (value: { data: unknown[]; error: null }) => unknown,
                  onrejected?: (reason: unknown) => unknown,
                ) {
                  return run().then(onfulfilled, onrejected);
                },
              };
              return response;
            },
          };
        },
      };
    },
    storage: {
      from() {
        return {
          async upload(path: string) {
            return {
              data: { path: path || `mock/${Date.now()}` },
              error: null,
            };
          },
        };
      },
    },
    cleanup() {
      listener = null;
      currentSession = null;
      saveSession(null);
    },
  };

  notify("INITIAL", currentSession);

  return client;
}
