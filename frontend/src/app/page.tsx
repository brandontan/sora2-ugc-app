"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useSupabase } from "@/components/providers/supabase-provider";

const steps = [
  {
    title: "Buy credits upfront",
    body: "Pick a pack once. No subscriptions, no drip pricing.",
  },
  {
    title: "Upload your product shot",
    body: "PNG or JPG up to 10MB. We store it in Supabase Storage.",
  },
  {
    title: "Describe the vibe",
    body: "Tell Sora2 the platform, tone, and key talking points.",
  },
  {
    title: "Download in minutes",
    body: "We keep the ledger exact so you always know the balance.",
  },
];

export default function Home() {
  const { supabase, session, loading } = useSupabase();
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [status, setStatus] = useState<"idle" | "sending" | "sent" | "error">(
    "idle",
  );
  const [message, setMessage] = useState("");

  const handleMagicLink = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!email) return;
    if (!supabase) {
      setStatus("error");
      setMessage("Supabase client not ready. Refresh the page and try again.");
      return;
    }
    setStatus("sending");
    setMessage("");
    const { error } = await supabase.auth.signInWithOtp({
      email,
      options: {
        emailRedirectTo:
          process.env.NEXT_PUBLIC_SUPABASE_REDIRECT_URL ?? undefined,
      },
    });
    if (error) {
      setStatus("error");
      setMessage(error.message);
      return;
    }
    setStatus("sent");
    setMessage("Check your inbox for the magic link.");
  };

  useEffect(() => {
    if (!loading && session) {
      router.replace("/dashboard");
    }
  }, [loading, session, router]);

  return (
    <div className="min-h-screen bg-gradient-to-b from-slate-950 via-slate-900 to-slate-950">
      <header className="border-b border-white/10 bg-slate-950/80 backdrop-blur">
        <div className="mx-auto flex w-full max-w-5xl items-center justify-between px-6 py-5">
          <Link href="/" className="text-lg font-semibold tracking-tight">
            GenVids Fast
          </Link>
          <div className="flex items-center gap-3">
            <Link
              href="#pricing"
              className="rounded-full border border-white/10 px-4 py-2 text-sm text-white/80 hover:border-white hover:text-white"
            >
              Credits
            </Link>
            <button
              type="button"
              onClick={() => router.push("/dashboard")}
              className="rounded-full bg-sky-500 px-4 py-2 text-sm font-medium text-slate-950 hover:bg-sky-400"
              disabled={loading}
            >
              {session ? "Open dashboard" : "Launch workspace"}
            </button>
          </div>
        </div>
      </header>

      <main className="mx-auto flex w-full max-w-5xl flex-col gap-20 px-6 py-16">
        <section className="flex flex-col gap-10 md:flex-row md:items-center md:justify-between">
          <div className="max-w-xl space-y-6">
            <span className="inline-flex rounded-full border border-white/10 px-3 py-1 text-xs uppercase tracking-[0.2em] text-white/60">
              Sora2 product placement
            </span>
            <h1 className="text-4xl font-semibold leading-tight md:text-5xl">
              Upload a product. Describe the vibe. Download UGC-ready video in
              minutes.
            </h1>
            <p className="text-lg text-white/70">
              We run every generation through Sora2, track every credit in
              Supabase, and skip subscriptions. Pay once, know your balance,
              ship faster.
            </p>
            <div className="flex flex-wrap gap-3">
              <button
                type="button"
                onClick={() => router.push("/dashboard")}
                className="rounded-full bg-sky-500 px-6 py-3 text-sm font-semibold text-slate-950 transition hover:bg-sky-400"
                disabled={loading}
              >
                {session ? "Open dashboard" : "Start now"}
              </button>
              <a
                href="#how-it-works"
                className="rounded-full border border-white/20 px-6 py-3 text-sm font-semibold text-white transition hover:border-white"
              >
                See how it works
              </a>
            </div>
          </div>
          <div className="relative flex w-full max-w-md flex-col gap-4 rounded-3xl border border-white/10 bg-white/[0.03] p-6">
            <div className="space-y-1">
              <h2 className="text-lg font-semibold text-white">
                Sign in with a magic link
              </h2>
              <p className="text-sm text-white/60">
                We use Supabase OTP. No passwords, no friction.
              </p>
            </div>
            <form onSubmit={handleMagicLink} className="space-y-4">
              <label className="space-y-2 text-sm text-white/70">
                Email address
                <input
                  type="email"
                  required
                  value={email}
                  onChange={(event) => setEmail(event.target.value)}
                  placeholder="you@brand.com"
                  className="w-full rounded-2xl border border-white/10 bg-slate-900 px-4 py-3 text-white outline-none transition focus:border-sky-400 focus:ring-2 focus:ring-sky-500/40"
                />
              </label>
              <button
                type="submit"
                className="w-full rounded-2xl bg-sky-500 px-4 py-3 text-sm font-semibold text-slate-950 transition hover:bg-sky-400 disabled:cursor-not-allowed disabled:bg-slate-700 disabled:text-slate-300"
                disabled={status === "sending"}
              >
                {status === "sending" ? "Sending magic link…" : "Email me a link"}
              </button>
            </form>
            {message && (
              <p
                className={`text-sm ${
                  status === "error" ? "text-red-400" : "text-sky-400"
                }`}
              >
                {message}
              </p>
            )}
            <p className="text-xs text-white/40">
              By continuing you agree to our billing policy. Credits never expire
              and are refundable until first use.
            </p>
          </div>
        </section>

        <section id="how-it-works" className="space-y-10">
          <div className="flex items-center justify-between">
            <h2 className="text-2xl font-semibold">How it works</h2>
            <span className="text-sm text-white/50">
              Honest ledger. No subscription traps.
            </span>
          </div>
          <div className="grid gap-6 md:grid-cols-2">
            {steps.map((step) => (
              <div
                key={step.title}
                className="rounded-3xl border border-white/5 bg-white/[0.02] p-6 backdrop-blur"
              >
                <h3 className="text-lg font-semibold text-white">
                  {step.title}
                </h3>
                <p className="mt-2 text-sm text-white/60">{step.body}</p>
              </div>
            ))}
          </div>
        </section>

        <section
          id="pricing"
          className="rounded-3xl border border-sky-500/20 bg-sky-500/10 p-8 backdrop-blur"
        >
          <div className="flex flex-col gap-6 md:flex-row md:items-end md:justify-between">
            <div className="max-w-lg space-y-3">
              <h2 className="text-2xl font-semibold text-white">Flat $5 per video</h2>
              <p className="text-sm text-white/70">
                Each Sora2 generation costs 5 credits. Credits are $1 each, sold in
                $15 packs so you get three runs per checkout. We debit before the
                run and refund automatically if the job fails.
              </p>
            </div>
            <div className="rounded-2xl border border-white/10 bg-slate-950/70 px-6 py-5 text-right">
              <p className="text-sm text-white/60">Standard 20s ad</p>
              <p className="text-3xl font-semibold text-white">$15 pack → 3 runs</p>
              <p className="text-xs text-white/40">Avg. gross margin: 83% at $0.40 Sora + Stripe fees</p>
            </div>
          </div>
        </section>
      </main>

      <footer className="border-t border-white/10 py-8">
        <div className="mx-auto flex w-full max-w-5xl flex-col items-center justify-between gap-3 px-6 text-sm text-white/40 md:flex-row">
          <p>© {new Date().getFullYear()} GenVids Fast</p>
          <div className="flex items-center gap-4">
            <a href="mailto:hello@genvidsfast.com" className="hover:text-white">
              Contact
            </a>
            <a href="https://status.supabase.com" className="hover:text-white">
              Supabase status
            </a>
          </div>
        </div>
      </footer>
    </div>
  );
}
