"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Sparkles } from "lucide-react";
import { useSupabase } from "@/components/providers/supabase-provider";
import { ChaoticVideoBackground } from "@/components/design/chaotic-video-background";
import { WelcomeHeader } from "@/components/design/welcome-header";

export default function Home() {
  const { supabase, session, loading } = useSupabase();
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [status, setStatus] = useState<"idle" | "sending" | "sent" | "error">("idle");
  const [message, setMessage] = useState("");
  const formRef = useRef<HTMLFormElement | null>(null);

  const handleMagicLink = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!email) {
      setStatus("error");
      setMessage("Drop an email so we can send the link.");
      return;
    }
    if (!supabase) {
      setStatus("error");
      setMessage("Supabase client not ready. Refresh and try again.");
      return;
    }
    setStatus("sending");
    setMessage("");
    const { error } = await supabase.auth.signInWithOtp({
      email,
      options: {
        emailRedirectTo: process.env.NEXT_PUBLIC_SUPABASE_REDIRECT_URL ?? undefined,
      },
    });
    if (error) {
      setStatus("error");
      setMessage(error.message);
      return;
    }
    setStatus("sent");
    setMessage("Magic link sent. Check your inbox.");
  };

  const launchWorkspace = () => {
    if (session) {
      router.push("/dashboard");
      return;
    }
    formRef.current?.requestSubmit();
  };

  useEffect(() => {
    if (!loading && session) {
      router.replace("/dashboard");
    }
  }, [loading, session, router]);

  return (
    <div className="relative min-h-screen overflow-hidden bg-background text-foreground">
      <ChaoticVideoBackground />
      <div className="pointer-events-none absolute inset-0 z-[2] bg-gradient-to-b from-background/70 via-background/40 to-background" />
      <WelcomeHeader />

      <main className="relative z-[3] container mx-auto flex flex-col items-center px-4 pb-24 pt-20">
        <div className="max-w-4xl text-center">
          <span className="inline-flex items-center justify-center gap-2 rounded-full border border-border/60 bg-background/70 px-4 py-2 text-xs uppercase tracking-[0.35em] text-muted-foreground">
            Ultra-fast Sora2 UGC
          </span>
          <h1 className="mt-8 text-5xl font-semibold leading-tight md:text-7xl">
            Product photo <span className="gradient-text">→ Sora video</span>
          </h1>
          <div className="mt-12 flex flex-col items-center gap-4 sm:flex-row sm:justify-center">
            <button
              type="button"
              onClick={launchWorkspace}
              className="inline-flex items-center justify-center gap-2 rounded-full bg-primary px-8 py-3 text-sm font-semibold text-primary-foreground shadow-lg shadow-primary/40 transition hover:bg-primary/90 disabled:cursor-not-allowed disabled:bg-muted"
              disabled={status === "sending"}
            >
              <Sparkles className="h-4 w-4" />
              {session ? "Open dashboard" : "Start creating"}
            </button>
            <button
              type="button"
              onClick={() => document.getElementById("magic-link-email")?.focus()}
              className="inline-flex items-center justify-center gap-2 rounded-full border border-border/60 px-8 py-3 text-sm font-semibold text-muted-foreground transition hover:border-border hover:text-foreground"
            >
              Email me access
            </button>
          </div>
        </div>

        <div className="relative mt-16 w-full max-w-xl">
          <div className="absolute -inset-[2px] rounded-[30px] bg-gradient-to-br from-primary/50 via-indigo-500/30 to-fuchsia-500/20 blur-[70px]" />
          <div className="relative glass-surface rounded-[28px] p-8 text-left shadow-2xl">
            <h2 className="text-2xl font-semibold">Sign in instantly</h2>
            <p className="mt-2 text-sm text-muted-foreground">
              Enter your email and we’ll send a one-click sign-in link.
            </p>
            <form ref={formRef} onSubmit={handleMagicLink} className="mt-6 space-y-4">
              <label className="block text-sm text-muted-foreground">
                Email address
                <input
                  id="magic-link-email"
                  type="email"
                  required
                  value={email}
                  onChange={(event) => setEmail(event.target.value)}
                  placeholder="you@brand.com"
                  className="mt-2 w-full rounded-2xl border border-border/60 bg-background/70 px-4 py-3 text-sm text-foreground outline-none transition focus:border-primary/80 focus:ring-2 focus:ring-primary/40"
                />
              </label>
              <button
                type="submit"
                className="w-full rounded-2xl bg-primary px-4 py-3 text-sm font-semibold text-primary-foreground transition hover:bg-primary/90 disabled:cursor-not-allowed disabled:bg-muted"
                disabled={status === "sending"}
              >
                {status === "sending" ? "Sending magic link…" : "Email me a link"}
              </button>
            </form>
            {message && (
              <p className={`mt-4 text-sm ${status === "error" ? "text-red-400" : "text-primary"}`}>{message}</p>
            )}
          </div>
        </div>
      </main>
    </div>
  );
}
