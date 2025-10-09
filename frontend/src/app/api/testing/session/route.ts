import { NextRequest, NextResponse } from "next/server";
import { createServerClient } from "@supabase/ssr";
import { getServiceClient } from "@/lib/supabase/service-client";

export const runtime = "nodejs";

function unauthorized(message: string) {
  return NextResponse.json({ error: { message } }, { status: 403 });
}

export async function POST(request: NextRequest) {
  const secret = process.env.AUTOMATION_SECRET;
  if (!secret) {
    return unauthorized("Automation endpoint disabled");
  }

  const suppliedSecret = request.headers.get("x-automation-secret");
  if (suppliedSecret !== secret) {
    return unauthorized("Invalid automation secret");
  }

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url || !serviceKey) {
    return NextResponse.json(
      { error: { message: "Supabase env vars missing." } },
      { status: 500 },
    );
  }

  const body = (await request.json().catch(() => null)) as
    | {
        action?: string;
        email?: string;
        password?: string;
        credits?: number;
      }
    | null;

  const action = body?.action ?? "session";
  const email = body?.email;
  const password = body?.password;

  const serviceClient = getServiceClient();
  const adminApi = serviceClient.auth.admin as {
    getUserByEmail?: (email: string) => Promise<{ data: { user: { id: string } | null } | null; error: unknown }>;
    listUsers: (args: { page: number; perPage: number }) => Promise<{ data: { users: Array<{ id: string; email?: string }> }; error: unknown }>;
  };

  const findUserId = async (targetEmail: string) => {
    if (typeof adminApi.getUserByEmail === "function") {
      const { data, error } = await adminApi.getUserByEmail(targetEmail);
      if (!error && data?.user) return data.user.id;
    }
    const perPage = 200;
    for (let page = 1; ; page += 1) {
      const { data, error } = await adminApi.listUsers({ page, perPage });
      if (error) break;
      const match = data.users.find(
        (user) => user.email?.toLowerCase() === targetEmail.toLowerCase(),
      );
      if (match) return match.id;
      if (data.users.length < perPage) break;
    }
    return null;
  };

  if (action === "topup") {
    const credits = Number(body?.credits ?? 0);
    if (!email || Number.isNaN(credits) || credits <= 0) {
      return NextResponse.json(
        { error: { message: "Email and positive credit amount required." } },
        { status: 400 },
      );
    }

    const userId = await findUserId(email);
    if (!userId) {
      return NextResponse.json(
        { error: { message: "Target user not found." } },
        { status: 404 },
      );
    }

    const { error: ledgerError } = await serviceClient
      .from("credit_ledger")
      .insert({
        user_id: userId,
        delta: credits,
        reason: "automation_topup",
      });

    if (ledgerError) {
      console.error('[automation-session] topup error:', ledgerError.message);
      return NextResponse.json(
        { error: { message: ledgerError.message } },
        { status: 500 },
      );
    }

    return NextResponse.json({ ok: true });
  }

  if (action === "reset") {
    if (!email) {
      return NextResponse.json(
        { error: { message: "Email required." } },
        { status: 400 },
      );
    }

    const userId = await findUserId(email);
    if (!userId) {
      return NextResponse.json(
        { error: { message: "Target user not found." } },
        { status: 404 },
      );
    }

    await serviceClient.from("assets").delete().eq("user_id", userId);
    await serviceClient.from("jobs").delete().eq("user_id", userId);
    await serviceClient.from("credit_ledger").delete().eq("user_id", userId);

    return NextResponse.json({ ok: true });
  }

  if (!email || !password) {
    return NextResponse.json(
      { error: { message: "Email and password required." } },
      { status: 400 },
    );
  }

  const response = NextResponse.json({ ok: true });

  const supabase = createServerClient(url, serviceKey, {
    cookies: {
      getAll: () => request.cookies.getAll(),
      setAll: async (cookies) => {
        cookies.forEach(({ name, value, options }) => {
          response.cookies.set(name, value, options);
        });
      },
    },
  });

  const { data, error } = await supabase.auth.signInWithPassword({
    email,
    password,
  });

  if (error || !data.session) {
    return NextResponse.json(
      { error: { message: error?.message ?? "Login failed." } },
      { status: 401 },
    );
  }

  response.headers.set("x-supabase-user", data.session.user.id);
  return response;
}
