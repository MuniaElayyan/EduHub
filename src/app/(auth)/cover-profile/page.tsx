"use client";

import { useState } from "react";
import { usePrefs } from "@/components/providers";
import { api, uploadFile } from "@/lib/api";

export default function CoverProfilePage() {
  const { locale } = usePrefs();
  const ar = locale === "ar";
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function save() {
    if (!file || busy) return;
    setBusy(true);
    setError("");
    try {
      const stored = await uploadFile(file, { purpose: "image" });
      await api("/me", { method: "PATCH", body: { coverFileId: stored.id } });
      window.location.assign("/app");
    } catch {
      setError(ar ? "تعذر حفظ الصورة." : "Could not save the image.");
      setBusy(false);
    }
  }

  return (
    <main className="mx-auto flex min-h-[70vh] max-w-xl items-center px-4 py-10">
      <div className="card w-full p-6 text-center">
        <h1 className="text-2xl font-bold">
          {ar ? "أضف صورة غلاف" : "Add a cover image"}
        </h1>

        <p className="mt-2 text-muted">
          {ar ? "يمكنك إضافة صورة الآن أو تخطي هذه الخطوة." : "Add an image now or skip this step."}
        </p>

        <label className="mt-6 block cursor-pointer rounded-xl border-2 border-dashed border-line p-8">
          <input
            type="file"
            accept="image/*"
            className="hidden"
            onChange={(e) => setFile(e.target.files?.[0] ?? null)}
          />
          <span className="font-semibold">
            {file ? file.name : ar ? "اختر صورة الغلاف" : "Choose cover image"}
          </span>
        </label>

        {error && <p className="mt-4 text-sm text-danger">{error}</p>}

        <div className="mt-6 flex justify-center gap-3">
          <button
            className="btn btn-ghost"
            type="button"
            disabled={busy}
            onClick={() => window.location.assign("/app")}
          >
            {ar ? "تخطي" : "Skip"}
          </button>

          <button
            className="btn btn-primary"
            type="button"
            disabled={!file || busy}
            onClick={() => void save()}
          >
            {busy ? (ar ? "جارٍ الحفظ…" : "Saving…") : (ar ? "حفظ الصورة" : "Save image")}
          </button>
        </div>
      </div>
    </main>
  );
}
