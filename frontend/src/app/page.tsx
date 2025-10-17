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
  const [emailSubmitState, setEmailSubmitState] = useState<
    "idle" | "submitting" | "sent" | "error"
  >("idle");
  const [statusNotice, setStatusNotice] = useState("");
  const [phase, setPhase] = useState<"email" | "otp">("email");
  const [otp, setOtp] = useState("");
  const [otpStatus, setOtpStatus] = useState<"idle" | "verifying" | "error">("idle");
  const formRef = useRef<HTMLFormElement | null>(null);
  const otpFormRef = useRef<HTMLFormElement | null>(null);
  const otpInputRef = useRef<HTMLInputElement | null>(null);

  const handleMagicLink = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!email) {
      setEmailSubmitState("error");
      setStatusNotice("Drop an email so we can email you the link.");
      return;
    }
    if (!supabase) {
      setEmailSubmitState("error");
                      setStatusNotice("Supabase client not ready. Refresh and try again.");
      return;
    }
    setEmailSubmitState("submitting");
    setStatusNotice("");
    const { error } = await supabase.auth.signInWithOtp({
      email,
    });
    if (error) {
      setEmailSubmitState("error");
      setStatusNotice(error.message);
      return;
    }
    setEmailSubmitState("sent");
    setStatusNotice("Check your inbox for the magic link. Enter the 6-digit code below to finish signing in.");

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
      setStatusNotice("Enter the email used for the code.");
      return;
    }

    const token = otp.replace(/\s+/g, "");
    if (!token) {
      setOtpStatus("error");
      setStatusNotice("Add the 6-digit code from your inbox.");
      return;
    }

    if (!supabase) {
      setOtpStatus("error");
      setStatusNotice("Supabase client not ready. Refresh and try again.");
      return;
    }

    setOtpStatus("verifying");
    setStatusNotice("");

    const { error } = await supabase.auth.verifyOtp({
      email,
      token,
      type: "email",
    });

    if (error) {
      setOtpStatus("error");
      setStatusNotice(error.message ?? "Code invalid or expired. Resend to try again.");
      return;
    }

    setOtpStatus("idle");
                      setStatusNotice("Signed in. Redirecting to your dashboard…");
    setPhase("email");
    router.push("/dashboard");
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
          <span className="inline-flex items-center justify-center gap-2 rounded-full border border-border/60 bg-background/70 px-5 py-2 text-sm uppercase tracking-[0.35em] text-muted-foreground md:text-base">
            Ultra-fast Sora + Veo 3.1 UGC
          </span>
          <h1 className="mt-8 text-5xl font-semibold leading-tight md:text-7xl">
            Create UGC Video Ads <span className="gradient-text">that actually Sells</span>
          </h1>
          {session && isAdmin ? (
            <div className="mt-6 flex justify-center">
              <button
                type="button"
                onClick={() => router.push("/admin/jobs")}
                className="inline-flex items-center gap-2 rounded-full border border-primary/40 px-5 py-2 text-sm font-semibold text-primary transition hover:border-primary hover:bg-primary/10 hover:text-white"
              >
                Admin Jobs
              </button>
            </div>
          ) : null}
          <div className="mt-8 grid gap-4 text-left text-sm text-muted-foreground sm:grid-cols-2 sm:text-base">
            <div className="rounded-2xl border border-border/60 bg-background/70 p-4">
              <p className="text-base font-semibold text-foreground">No subscriptions</p>
              <p className="mt-2 leading-relaxed">
                Pay only when you generate. Unlock production-quality videos without long-term contracts or hidden fees.
              </p>
            </div>
            <div className="rounded-2xl border border-border/60 bg-background/70 p-4">
              <p className="text-base font-semibold text-foreground">Promotional launch rate</p>
              <p className="mt-2 leading-relaxed">
                Grab 75 credits for just <span className="font-semibold text-primary">$20</span> while the offer lasts. Enough for dozens of standout clips.
              </p>
            </div>
          </div>
        </div>

        <div className="relative mt-16 w-full max-w-xl">
          <div className="absolute -inset-[2px] rounded-[30px] bg-gradient-to-br from-primary/50 via-indigo-500/30 to-fuchsia-500/20 blur-[70px]" />
          <div className="relative glass-surface rounded-[28px] p-8 text-left shadow-2xl">
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
                  disabled={emailSubmitState === "submitting"}
                >
                  {emailSubmitState === "submitting" ? "Requesting magic link…" : "Email me a link"}
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
                      setEmailSubmitState("idle");
                      setOtpStatus("idle");
                      setOtp("");
                      setStatusNotice("");
                      setTimeout(() => formRef.current?.querySelector<HTMLInputElement>("input")?.focus(), 0);
                    }}
                    className="w-full rounded-2xl border border-border/60 px-4 py-3 text-sm font-semibold text-muted-foreground transition hover:border-border hover:text-foreground"
                  >
                    Send new code
                  </button>
                </div>
              </form>
            )}
            {statusNotice && (
              <p
                className={`mt-4 text-sm ${
                  emailSubmitState === "error" || otpStatus === "error" ? "text-red-400" : "text-primary"
                }`}
              >
                {statusNotice}
              </p>
            )}
          </div>
        </div>
      </main>
    </div>
  );
}
