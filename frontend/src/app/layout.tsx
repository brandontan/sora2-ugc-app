import type { Metadata } from "next";
import { Inter } from "next/font/google";
import "./globals.css";
import { SupabaseProvider } from "@/components/providers/supabase-provider";

const inter = Inter({
  subsets: ["latin"],
  variable: "--font-inter",
});

export const metadata: Metadata = {
  title: "GenVids Fast | Sora UGC",
  description: "Upload a product, describe the vibe, get a Sora video in minutes.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body className={`${inter.variable} bg-slate-950 text-white antialiased`}>
        <SupabaseProvider>{children}</SupabaseProvider>
      </body>
    </html>
  );
}
