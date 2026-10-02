"use client";

import { FileText, Image as ImageIcon, PencilLine, Play, Presentation, ClipboardList } from "lucide-react";
import { useState, type CSSProperties } from "react";
import { useT } from "./providers";

const BOOKS = [
  { grade: 4, color: "coral", count: 18 },
  { grade: 6, color: "blue", count: 32 },
  { grade: 7, color: "green", count: 24 },
];
const FILES = [
  { key: "pdfs", icon: FileText, color: "coral", from: ["-30%", "-170%", "-13deg"] },
  { key: "videos", icon: Play, color: "plum", from: ["60%", "-210%", "9deg"] },
  { key: "presentations", icon: Presentation, color: "ochre", from: ["-70%", "-120%", "16deg"] },
  { key: "worksheets", icon: PencilLine, color: "blue", from: ["40%", "-260%", "-8deg"] },
  { key: "posters", icon: ImageIcon, color: "teal", from: ["-10%", "-300%", "12deg"] },
  { key: "lesson_plans", icon: ClipboardList, color: "green", from: ["80%", "-150%", "-17deg"] },
];

/**
 * The hero's moving picture: loose teaching files settle into an ordered workspace.
 * If NEXT_PUBLIC_HERO_VIDEO points at a short looping clip it plays on top; when the clip
 * is missing or fails to load, this scene is what people see.
 */
export function HeroScene() {
  const t = useT();
  const videoSrc = process.env.NEXT_PUBLIC_HERO_VIDEO;
  const [videoOk, setVideoOk] = useState(!!videoSrc);

  return (
    <div aria-hidden className="relative overflow-hidden rounded-[1.75rem] bg-board p-5 text-board-ink shadow-soft sm:p-7">
      <div className="mb-5 flex items-end justify-between gap-3">
        <div>
          <p className="font-display text-lg font-semibold sm:text-xl">{t("landing.sceneTitle")}</p>
          <svg viewBox="0 0 220 10" className="chalk-line mt-1 h-2 w-40 text-accent sm:w-52" preserveAspectRatio="none">
            <path d="M2 6 C 40 1, 80 9, 120 5 S 190 3, 218 6" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
          </svg>
        </div>
        <span className="rounded-full border border-board-ink/25 px-3 py-1 text-xs text-board-ink/80">2026/2027</span>
      </div>

      <div className="grid grid-cols-3 gap-3 sm:gap-4">
        {BOOKS.map((b, i) => (
          <div key={b.grade} data-color={b.color} style={{ "--i": i } as CSSProperties} className="notebook scene-book aspect-[4/5] p-2 ps-6 sm:p-3 sm:ps-7">
            <div className="notebook-label text-xs font-semibold sm:text-sm">{t(`grades.${b.grade}`)}</div>
            <div className="text-[0.7rem] text-white/85 sm:text-xs">{t("dash.resourceCount", { n: b.count })}</div>
          </div>
        ))}
      </div>

      <div className="mt-4 grid grid-cols-3 gap-3 sm:gap-4">
        {FILES.map((f, i) => (
          <div
            key={f.key}
            data-color={f.color}
            style={{ "--i": i, "--fx": f.from[0], "--fy": f.from[1], "--fr": f.from[2] } as CSSProperties}
            className="scene-file overflow-hidden rounded-lg bg-[#fbfcfa] text-[#12201c] shadow-soft"
          >
            <div className="grid h-9 place-items-center bg-[var(--c)] text-white sm:h-12">
              <f.icon className="size-4 sm:size-5" />
            </div>
            <div className="truncate px-2 py-1.5 text-[0.7rem] font-medium sm:text-xs">{t(`sections.${f.key}`)}</div>
          </div>
        ))}
      </div>

      {videoOk && videoSrc && (
        <video
          className="absolute inset-0 size-full object-cover motion-reduce:hidden"
          src={videoSrc}
          autoPlay
          muted
          loop
          playsInline
          preload="metadata"
          onError={() => setVideoOk(false)}
        />
      )}
    </div>
  );
}
