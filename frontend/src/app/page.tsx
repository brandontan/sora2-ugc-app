"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useSupabase } from "@/components/providers/supabase-provider";
import { ChaoticVideoBackground } from "@/components/design/chaotic-video-background";
import { WelcomeHeader } from "@/components/design/welcome-header";

export default function Home() {
  const { supabase, session, loading, isAdmin } = useSupabase();
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [status, setStatus] = useState<"idle" | "sending" | "sent" | "error">("idle");
  const [message, setMessage] = useState("");
  const [phase, setPhase] = useState<"email" | "otp">("email");
  const [otp, setOtp] = useState("");
  const [otpStatus, setOtpStatus] = useState<"idle" | "verifying" | "error">("idle");
  const formRef = useRef<HTMLFormElement | null>(null);
  const otpFormRef = useRef<HTMLFormElement | null>(null);
  const otpInputRef = useRef<HTMLInputElement | null>(null);

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
    });
    if (error) {
      setStatus("error");
      setMessage(error.message);
      return;
    }
    setStatus("sent");
    setMessage("Check your inbox for the magic link. Enter the 6-digit code below to finish signing in.");

    if (process.env.NEXT_PUBLIC_SUPABASE_USE_MOCK === "true") {
      router.push("/dashboard");
      return;
    }

    setPhase("otp");
    setTimeout(() => {
      otpInputRef.current?.focus();
    }, 0);
  };

  const handleVerifyOtp = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    if (!email) {
      setOtpStatus("error");
      setMessage("Enter the email used for the code.");
      return;
    }

    const token = otp.replace(/\s+/g, "");
    if (!token) {
      setOtpStatus("error");
      setMessage("Add the 6-digit code from your inbox.");
      return;
    }

    if (!supabase) {
      setOtpStatus("error");
      setMessage("Supabase client not ready. Refresh and try again.");
      return;
    }

    setOtpStatus("verifying");
    setMessage("");

    const { error } = await supabase.auth.verifyOtp({
      email,
      token,
      type: "email",
    });

    if (error) {
      setOtpStatus("error");
      setMessage(error.message ?? "Code invalid or expired. Resend to try again.");
      return;
    }

    setOtpStatus("idle");
    setMessage("Signed in. Redirecting to your dashboard…");
    setPhase("email");
    router.push("/dashboard");
  };

  useEffect(() => {
    if (!loading && session && !isAdmin) {
      router.replace("/dashboard");
    }
  }, [loading, session, isAdmin, router]);

  const handleSignOut = async () => {
    if (!supabase) return;
    await supabase.auth.signOut();
    setEmail("");
    setOtp("");
    setPhase("email");
    setStatus("idle");
    setOtpStatus("idle");
    setMessage("");
  };

  return (
    <div className="relative min-h-screen overflow-hidden bg-background text-foreground">
      <ChaoticVideoBackground />
      <div className="pointer-events-none absolute inset-0 z-[2] bg-gradient-to-b from-background/70 via-background/40 to-background" />
      <WelcomeHeader />

      <main className="relative z-[3] container mx-auto flex flex-col items-center px-4 pb-24 pt-20">
        <div className="max-w-4xl text-center">
          <span className="inline-flex items-center justify-center gap-2 rounded-full border border-border/60 bg-background/70 px-4 py-2 text-xs uppercase tracking-[0.35em] text-muted-foreground">
            Ultra-fast Sora UGC
          </span>
          <h1 className="mt-8 text-5xl font-semibold leading-tight md:text-7xl">
            Create UGC Video Ads <span className="gradient-text">that actually Sells</span>
          </h1>
        </div>

        <div className="relative mt-16 w-full max-w-xl">
          <div className="absolute -inset-[2px] rounded-[30px] bg-gradient-to-br from-primary/50 via-indigo-500/30 to-fuchsia-500/20 blur-[70px]" />
          <div className="relative glass-surface rounded-[28px] p-8 text-left shadow-2xl">
            {session ? (
              <div className="space-y-6 text-sm text-muted-foreground">
                <div>
                  <h2 className="text-2xl font-semibold text-white">Welcome back</h2>
                  <p className="mt-2">
                    Signed in as <span className="font-medium text-primary">{session.user.email}</span>.
                  </p>
                </div>
                <div className="flex flex-col gap-3 sm:flex-row">
                  <button
                    type="button"
                    onClick={() => router.push("/dashboard")}
                    className="w-full rounded-2xl bg-primary px-4 py-3 text-sm font-semibold text-primary-foreground transition hover:bg-primary/90"
                  >
                    Go to dashboard
                  </button>
                  {isAdmin ? (
                    <button
                      type="button"
                      onClick={() => router.push("/admin/jobs")}
                      className="w-full rounded-2xl border border-primary/50 px-4 py-3 text-sm font-semibold text-primary transition hover:border-primary hover:bg-primary/10 hover:text-white"
                    >
                      Open admin jobs
                    </button>
                  ) : null}
                  <button
                    type="button"
                    onClick={handleSignOut}
                    className="w-full rounded-2xl border border-border/60 px-4 py-3 text-sm font-semibold text-muted-foreground transition hover:border-border hover:text-foreground"
                  >
                    Sign out
                  </button>
                </div>
              </div>
            ) : (
              <>
                <h2 className="text-2xl font-semibold">Sign in instantly</h2>
                {phase === "email" && (
                  <form
                    ref={formRef}
                    onSubmit={handleMagicLink}
                    className="mt-6 space-y-4"
                    data-testid="email-auth-form"
                  >
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
                        autoComplete="email"
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
                )}
                {phase === "otp" && (
                  <form
                    ref={formRef}
                    onSubmit={handleMagicLink}
                    className="mt-6 space-y-4"
                    data-testid="email-auth-form"
                  >
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
                    autoComplete="email"
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
              )}
                {phase === "otp" && (
                  <form
                    ref={otpFormRef}
                    onSubmit={handleVerifyOtp}
                    className="mt-6 space-y-4"
                    data-testid="otp-auth-form"
                  >
                    <label className="block text-sm text-muted-foreground">
                      Enter the 6-digit code
                      <input
                        id="magic-link-otp"
                        ref={otpInputRef}
                        inputMode="numeric"
                        autoComplete="one-time-code"
                        pattern="[0-9]{6}"
                        maxLength={6}
                        value={otp}
                        onChange={(event) => setOtp(event.target.value.replace(/[^0-9]/g, ""))}
                        placeholder="000000"
                        className="mt-2 w-full rounded-2xl border border-border/60 bg-background/70 px-4 py-3 text-sm text-foreground tracking-[0.4em] outline-none transition focus:border-primary/80 focus:ring-2 focus:ring-primary/40"
                        data-testid="otp-input"
                      />
                    </label>
                    <div className="flex flex-col gap-3 sm:flex-row">
                      <button
                        type="submit"
                        className="w-full rounded-2xl bg-primary px-4 py-3 text-sm font-semibold text-primary-foreground transition hover:bg-primary/90 disabled:cursor-not-allowed disabled:bg-muted"
                        disabled={otpStatus === "verifying"}
                      >
                        {otpStatus === "verifying" ? "Verifying code…" : "Finish sign in"}
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          setPhase("email");
                          setStatus("idle");
                          setOtpStatus("idle");
                          setOtp("");
                          setMessage("");
                          setTimeout(() => formRef.current?.querySelector<HTMLInputElement>("input")?.focus(), 0);
                        }}
                        className="w-full rounded-2xl border border-border/60 px-4 py-3 text-sm font-semibold text-muted-foreground transition hover:border-border hover:text-foreground"
                      >
                        Resend link
                      </button>
                    </div>
                  </form>
                )}
                {message && (
                  <p
                    className={`mt-4 text-sm ${
                      status === "error" || otpStatus === "error" ? "text-red-400" : "text-primary"
                    }`}
                  >
                    {message}
                  </p>
                )}
              </>
            )}
          </div>
        </div>
      </main>
    </div>
  );
}
