import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL || !SERVICE_ROLE_KEY) {
  console.error('Missing Supabase credentials. Set NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY.');
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
  auth: {
    persistSession: false,
    autoRefreshToken: false,
  },
});

const USERS = [
  {
    label: 'high',
    email: process.env.SEED_HIGH_EMAIL ?? 'qa-high@sora2.app',
    password: process.env.SEED_HIGH_PASSWORD ?? 'HighCredits1!',
    targetCredits: Number(process.env.SEED_HIGH_CREDITS ?? 45),
  },
  {
    label: 'medium',
    email: process.env.SEED_MEDIUM_EMAIL ?? 'qa-medium@sora2.app',
    password: process.env.SEED_MEDIUM_PASSWORD ?? 'MediumCredits1!',
    targetCredits: Number(process.env.SEED_MEDIUM_CREDITS ?? 10),
  },
  {
    label: 'low',
    email: process.env.SEED_LOW_EMAIL ?? 'qa-low@sora2.app',
    password: process.env.SEED_LOW_PASSWORD ?? 'LowCredits1!',
    targetCredits: Number(process.env.SEED_LOW_CREDITS ?? 2),
  },
];

async function findUserByEmail(email) {
  const perPage = 200;
  for (let page = 1; ; page += 1) {
    const { data, error } = await supabase.auth.admin.listUsers({ page, perPage });
    if (error) {
      throw error;
    }
    const match = data.users.find((user) => user.email?.toLowerCase() === email.toLowerCase());
    if (match) {
      return match;
    }
    if (data.users.length < perPage) {
      return null;
    }
  }
}

async function ensureUser({ email, password }) {
  const existing = await findUserByEmail(email);
  if (existing) {
    return existing;
  }

  const created = await supabase.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: { seeded: true },
  });

  if (created.error || !created.data?.user) {
    throw created.error ?? new Error(`Failed to create user ${email}`);
  }

  return created.data.user;
}

async function currentCreditTotal(userId) {
  const { data, error } = await supabase
    .from('credit_ledger')
    .select('delta')
    .eq('user_id', userId);

  if (error) {
    throw error;
  }

  return data.reduce((total, entry) => total + Number(entry.delta ?? 0), 0);
}

async function adjustCredits(userId, target, label) {
  const current = await currentCreditTotal(userId);
  const delta = target - current;

  if (delta === 0) {
    console.log(`${label}: balance already ${target} credits`);
    return;
  }

  const { error } = await supabase.from('credit_ledger').insert({
    user_id: userId,
    delta,
    reason: `seed-${label}-balance`,
  });

  if (error) {
    throw error;
  }

  console.log(`${label}: adjusted by ${delta} credits (now ${target})`);
}

async function ensureProfile(userId, label) {
  const displayName = `${label.charAt(0).toUpperCase() + label.slice(1)} Credit QA`;
  try {
    const { data, error } = await supabase
      .from('profiles')
      .select('id')
      .eq('id', userId)
      .maybeSingle();

    if (error && error.code !== '42P01') {
      throw error;
    }

    if (error?.code === '42P01') {
      console.warn('profiles table missing; skipping profile seed');
      return;
    }

    if (data) {
      return;
    }

    const { error: insertError } = await supabase.from('profiles').insert({
      id: userId,
      display_name: displayName,
    });

    if (insertError && insertError.code !== '23505') {
      throw insertError;
    }
  } catch (error) {
    if (error?.code === '42P01') {
      console.warn('profiles table missing; skipping profile seed');
      return;
    }
    throw error;
  }
}

(async () => {
  try {
    for (const userConfig of USERS) {
      const user = await ensureUser(userConfig);
      await ensureProfile(user.id, userConfig.label);
      await adjustCredits(user.id, userConfig.targetCredits, userConfig.label);
    }
    console.log('Seed complete.');
    process.exit(0);
  } catch (error) {
    console.error('Seed failed:', error.message ?? error);
    process.exit(1);
  }
})();
