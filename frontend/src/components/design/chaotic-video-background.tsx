"use client";

import Image from "next/image";
import { useEffect, useMemo, useState } from "react";

type ImageSplatter = {
  id: string;
  x: number;
  y: number;
  rotation: number;
  scale: number;
  delay: number;
  duration: number;
  platform: "instagram" | "tiktok" | "youtube";
  content: string;
  imageSrc: string;
};

const ugcImages: Array<{ content: string; src: string }> = [
  { content: "OMG this serum cleared my acne in 2 weeks!", src: "/shocked-woman-clear-skin-transformation-ugc.jpg" },
  { content: "I lost 15lbs with this supplement - PROOF!", src: "/before-after-weight-loss-supplement-ugc.jpg" },
  { content: "This mascara made my lashes INSANE", src: "/dramatic-lash-transformation-mascara-ugc.jpg" },
  { content: "My wrinkles vanished overnight with this cream", src: "/anti-aging-cream-wrinkle-results-ugc.jpg" },
  { content: "This protein powder tastes like dessert!", src: "/excited-man-protein-shake-taste-test-ugc.jpg" },
  { content: "My hair grew 3 inches in one month!", src: "/hair-growth-oil-length-comparison-ugc.jpg" },
  { content: "This gadget saved me 2 hours daily", src: "/time-saving-kitchen-gadget-demo-ugc.jpg" },
  { content: "I can't believe this jewelry is only $20!", src: "/affordable-luxury-jewelry-haul-ugc.jpg" },
  { content: "This mascara routine changed my life", src: "/beauty-transformation.jpg" },
  { content: "My skin is glowing after one use!", src: "/glowing-skin-face-mask-results-ugc.jpg" },
  { content: "This coffee burns fat while I sleep", src: "/weight-loss-coffee-testimonial-ugc.jpg" },
  { content: "I look 10 years younger with this device", src: "/anti-aging-device-face-results-ugc.jpg" },
  { content: "This app made me $500 in a week", src: "/money-making-app-earnings-proof-ugc.jpg" },
  { content: "My anxiety disappeared with this supplement", src: "/calm-woman-anxiety-supplement-ugc.jpg" },
  { content: "Hormonal acne routine finally works", src: "/hormonal-acne-skincare-transformation-ugc.jpg" },
];

export function ChaoticVideoBackground() {
  const [imageSplatters, setImageSplatters] = useState<ImageSplatter[]>([]);

  const platforms = useMemo(() => ["instagram", "tiktok", "youtube"] as const, []);

  useEffect(() => {
    setImageSplatters(
      Array.from({ length: 18 }, (_, index) => {
        const source = ugcImages[Math.floor(Math.random() * ugcImages.length)];
        return {
          id: `ugc-${index}`,
          x: Math.random() * 100,
          y: Math.random() * 100,
          rotation: Math.random() * 40 - 20,
          scale: 0.45 + Math.random() * 0.35,
          delay: Math.random() * 4,
          duration: 7 + Math.random() * 7,
          platform: platforms[Math.floor(Math.random() * platforms.length)],
          content: source.content,
          imageSrc: source.src,
        } satisfies ImageSplatter;
      }),
    );
  }, [platforms]);

  return (
    <div className="pointer-events-none fixed inset-0 z-[1] overflow-hidden">
      <div className="absolute inset-0 bg-gradient-to-b from-background via-background/95 to-background" />
      {imageSplatters.map((splatter) => (
        <div
          key={splatter.id}
          className="absolute animate-[float_16s_ease-in-out_infinite]"
          style={{
            left: `${splatter.x}%`,
            top: `${splatter.y}%`,
            transform: `translate(-50%, -50%) rotate(${splatter.rotation}deg) scale(${splatter.scale})`,
            animationDelay: `${splatter.delay}s`,
            animationDuration: `${splatter.duration}s`,
          }}
        >
          <div
            className={`relative h-72 w-44 overflow-hidden rounded-3xl border-2 border-white/5 shadow-2xl shadow-primary/20 backdrop-blur`}
          >
            <Image
              src={splatter.imageSrc}
              alt={splatter.content}
              fill
              sizes="180px"
              className="object-cover"
              priority={false}
            />
            <div
              className={`absolute inset-0 opacity-25 ${
                splatter.platform === "instagram"
                  ? "bg-gradient-to-br from-pink-500 via-purple-500 to-indigo-600"
                  : splatter.platform === "tiktok"
                    ? "bg-gradient-to-br from-black via-slate-800 to-rose-600"
                    : "bg-gradient-to-br from-rose-500 to-red-500"
              }`}
            />
            <div className="absolute top-3 left-3 flex flex-col gap-1 text-white text-[10px]">
              <span className="inline-flex items-center gap-1 rounded-full bg-black/60 px-2 py-1">
                <span className="h-1.5 w-1.5 rounded-full bg-red-400 animate-pulse" /> LIVE
              </span>
              <span className="inline-flex rounded-full bg-black/60 px-2 py-1">
                {Math.floor(Math.random() * 40 + 15)}K views
              </span>
            </div>
            <div className="absolute bottom-0 left-0 right-0 space-y-1 bg-gradient-to-t from-black/80 via-black/40 to-transparent p-3 text-white">
              <p className="text-xs font-semibold leading-snug">{splatter.content}</p>
              <div className="flex items-center justify-between text-[10px] opacity-90">
                <div className="flex items-center gap-2">
                  <span>❤️ {Math.floor(Math.random() * 700 + 120)}</span>
                  <span>💬 {Math.floor(Math.random() * 80 + 20)}</span>
                  <span>🔄 {Math.floor(Math.random() * 160 + 40)}</span>
                </div>
                <span>#ugc</span>
              </div>
            </div>
            <div className="absolute inset-0 flex items-center justify-center">
              <span className="flex h-12 w-12 items-center justify-center rounded-full bg-white/20 text-white">
                ▶
              </span>
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}
