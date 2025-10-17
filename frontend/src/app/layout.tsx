import type { Metadata } from "next";
import { Inter } from "next/font/google";
import "./globals.css";
import { SupabaseProvider } from "@/components/providers/supabase-provider";

const inter = Inter({
  subsets: ["latin"],
  variable: "--font-inter",
});

const siteUrl = "https://genvidsfast.com";
const ogImage = `${siteUrl}/og-image.jpg`;

export const metadata: Metadata = {
  title: "GenVids Fast | Sora UGC",
  description: "Upload a product, describe the vibe, get a Sora video in minutes.",
  metadataBase: new URL(siteUrl),
  icons: {
    icon: "/favicon.svg",
  },
  keywords: [
    "Sora",
    "UGC",
    "video generation",
    "marketing credits",
    "AI video",
    "GenVids Fast",
  ],
  openGraph: {
    title: "GenVids Fast | Sora UGC",
    description:
      "Pay-as-you-go Sora video generation. Upload a product, describe the vibe, and get campaign-ready clips within minutes.",
    url: siteUrl,
    siteName: "GenVids Fast",
    images: [
      {
        url: ogImage,
        width: 1200,
        height: 630,
        alt: "GenVids Fast Sora UGC",
      },
    ],
    locale: "en_US",
    type: "website",
  },
  twitter: {
    card: "summary_large_image",
    title: "GenVids Fast | Sora UGC",
    description:
      "No subscriptions. Promotional launch rate: $20 for 75 credits while it lasts.",
    images: [ogImage],
  },
  alternates: {
    canonical: siteUrl,
  },
  robots: {
    index: true,
    follow: true,
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body className={`${inter.variable} bg-slate-950 text-white antialiased`}>
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{
            __html: JSON.stringify({
              "@context": "https://schema.org",
              "@type": "Product",
              name: "GenVids Fast UGC Credits",
              description:
                "Pay-as-you-go Sora video generation credits. Promotional launch rate: $20 for 75 credits.",
              url: siteUrl,
              offers: {
                "@type": "Offer",
                price: "20",
                priceCurrency: "USD",
                availability: "https://schema.org/InStock",
              },
              brand: {
                "@type": "Brand",
                name: "GenVids Fast",
              },
            }),
          }}
        />
        <SupabaseProvider>{children}</SupabaseProvider>
      </body>
    </html>
  );
}
