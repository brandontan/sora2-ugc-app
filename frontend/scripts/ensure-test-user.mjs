import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const EMAIL = process.env.LIVE_TEST_EMAIL;
const PASSWORD = process.env.LIVE_TEST_PASSWORD;

if (!SUPABASE_URL || !SERVICE_ROLE_KEY || !EMAIL || !PASSWORD) {
  console.error('Missing env vars. Require NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, LIVE_TEST_EMAIL, LIVE_TEST_PASSWORD.');
  process.exit(1);
}

const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
  auth: {
    persistSession: false,
    autoRefreshToken: false,
  },
});

async function findUserByEmail(email) {
  try {
    if (typeof admin.auth.admin.getUserByEmail === 'function') {
      const { data, error } = await admin.auth.admin.getUserByEmail(email);
      if (error || !data?.user) return null;
      return data.user;
    }
  } catch (error) {
    console.warn('getUserByEmail unavailable, falling back to listUsers:', error.message ?? error);
  }

  try {
    let page = 1;
    const perPage = 200;
    const target = email.toLowerCase();
    while (true) {
      const { data, error } = await admin.auth.admin.listUsers({ page, perPage });
      if (error) throw error;
      const match = data.users.find((user) => user.email?.toLowerCase() === target);
      if (match) return match;
      if (data.users.length < perPage) return null;
      page += 1;
    }
  } catch (error) {
    console.error('List users failed:', error.message ?? error);
    return null;
  }
}

(async () => {
  try {
    let user = await findUserByEmail(EMAIL);

    if (!user) {
      const { data, error } = await admin.auth.admin.createUser({
        email: EMAIL,
        password: PASSWORD,
        email_confirm: true,
      });
      if (error || !data?.user) {
        throw error ?? new Error('Failed to create user');
      }
      user = data.user;
      console.log('Created user', user.id);
    } else {
      const { error } = await admin.auth.admin.updateUserById(user.id, {
        password: PASSWORD,
        email_confirm: true,
      });
      if (error) {
        throw error;
      }
      console.log('Updated existing user password');
    }

    process.exit(0);
  } catch (error) {
    console.error('ensure-test-user error:', error.message ?? error);
    process.exit(1);
  }
})();
