"use client";

import { useRouter } from "next/navigation";
import { Sparkles } from "lucide-react";
import { useSupabase } from "@/components/providers/supabase-provider";

export function WelcomeHeader() {
  const router = useRouter();
  const { session, loading } = useSupabase();

  return (
    <header className="relative z-30 border-b border-border/50 bg-background/80 backdrop-blur-xl">
      <div className="mx-auto flex h-16 w-full max-w-6xl items-center justify-between px-6">
        <button
          type="button"
          onClick={() => router.push("/")}
          className="flex items-center gap-2 text-base font-semibold tracking-tight text-foreground"
        >
          <Sparkles className="h-5 w-5 text-primary" />
          GenVids Fast
        </button>
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={() => {
              if (session) {
                router.push("/dashboard");
              } else {
                document.getElementById("magic-link-email")?.focus();
              }
            }}
            className="rounded-full bg-primary px-5 py-2 text-sm font-semibold text-primary-foreground shadow-lg shadow-primary/30 transition hover:bg-primary/90"
            disabled={loading}
          >
            {session ? "Open app" : "Start creating"}
          </button>
        </div>
      </div>
    </header>
  );
}
