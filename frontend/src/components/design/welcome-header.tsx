"use client";

import { useRouter } from "next/navigation";
import { Sparkles } from "lucide-react";

export function WelcomeHeader() {
  const router = useRouter();

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
        <div className="flex items-center gap-3" />
      </div>
    </header>
  );
}
