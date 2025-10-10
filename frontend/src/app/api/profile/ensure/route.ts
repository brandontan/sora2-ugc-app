import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { generateProfileTemplate } from '@/lib/profile';

type EnsureProfilePayload = {
  accessToken: string;
  userId?: string;
  email?: string | null;
};

export async function POST(request: Request) {
  try {
    const { accessToken, userId: rawUserId, email: rawEmail }: EnsureProfilePayload = await request.json();

    if (!accessToken) {
      return NextResponse.json({ error: 'Missing access token.' }, { status: 400 });
    }

    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

    if (!supabaseUrl || !serviceKey) {
      return NextResponse.json({ error: 'Supabase credentials missing.' }, { status: 500 });
    }

    const adminClient = createClient(supabaseUrl, serviceKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    const {
      data: { user },
      error: userError,
    } = await adminClient.auth.getUser(accessToken);

    if (userError || !user) {
      return NextResponse.json({ error: 'Invalid session.' }, { status: 401 });
    }

    const targetId = rawUserId ?? user.id;
    const targetEmail = rawEmail ?? user.email ?? null;

    const template = generateProfileTemplate(targetId, targetEmail);

    const { data, error } = await adminClient
      .from('profiles')
      .upsert(
        {
          id: targetId,
          display_name: template.displayName,
          avatar_seed: template.avatarSeed,
          avatar_style: template.avatarStyle,
        },
        { onConflict: 'id' },
      )
      .select()
      .maybeSingle();

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({ profile: data ?? template });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unexpected error';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
