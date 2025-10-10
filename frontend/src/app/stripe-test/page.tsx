"use client";

import { useSupabase } from "@/components/providers/supabase-provider";
import { useState } from "react";

export default function StripeTestPage() {
  const { session } = useSupabase();
  const [output, setOutput] = useState<string | null>(null);

  const handleCheckout = async () => {
    if (!session?.access_token) {
      setOutput("No Supabase session. Sign in first.");
      return;
    }

    try {
      const response = await fetch("/api/credits/checkout", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${session.access_token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({}),
      });

      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        setOutput(`Error ${response.status}: ${payload?.error?.message ?? "Unknown"}`);
        return;
      }

      setOutput(`Success: ${payload.url}`);
      window.open(payload.url, "_blank");
    } catch (error) {
      setOutput(`Exception: ${(error as Error).message}`);
    }
  };

  return (
    <main className="mx-auto flex min-h-screen max-w-xl flex-col gap-6 px-6 py-16">
      <h1 className="text-2xl font-semibold">Stripe Checkout Test</h1>
      <p className="text-sm text-muted-foreground">
        You must be signed in. Click the button to call <code>/api/credits/checkout</code> and open Stripe Checkout in a new tab.
      </p>
      <button
        type="button"
        onClick={handleCheckout}
        className="rounded-full bg-primary px-5 py-2 text-sm font-semibold text-primary-foreground shadow-lg shadow-primary/30 transition hover:bg-primary/90"
      >
        Start Stripe Checkout
      </button>
      {output ? (
        <pre className="rounded-lg bg-muted p-4 text-xs text-foreground/90">{output}</pre>
      ) : null}
    </main>
  );
}
