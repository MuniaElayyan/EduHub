import { and, count, eq, gt } from "drizzle-orm";
import { createT, gradeLabel, sectionLabel, semesterLabel, subjectLabel, unitLabel } from "@/lib/i18n";
import type { Locale } from "@/lib/constants";
import { strict } from "../config";
import { getDb } from "../db";
import { aiUsage, files, type User } from "../db/schema";
import { storage } from "../storage";
import { getCourse, listSections, teaching, unitPath } from "./courses";
import { getResource, listResources, type ResourceDTO } from "./resources";

export const AI_ACTIONS = [
  "lesson_plan", "quiz", "worksheet", "flashcards", "summary",
  "questions", "objectives", "activities", "presentation_outline",
] as const;
export type AiAction = (typeof AI_ACTIONS)[number];

export type ChatMessage = { role: "user" | "assistant"; content: string };
export type AiContext = {
  courseId?: string;
  unitId?: string;
  sectionId?: string;
  resourceId?: string;
  useResources?: boolean;
};

const ACTION_BRIEFS: Record<AiAction, string> = {
  lesson_plan: "Write a lesson plan with: title, grade, duration, learning objectives, materials, warm-up, presentation, guided practice, independent practice, assessment, homework, and differentiation notes.",
  quiz: "Write a quiz of 10 multiple-choice questions with four options each, followed by an answer key.",
  worksheet: "Write a printable student worksheet with clear instructions, 3–4 varied exercises that grow in difficulty, and an answer key at the end.",
  flashcards: "Write 12 flashcards as a two-column table: front (term or question) and back (answer).",
  summary: "Write a clear summary for students: the key ideas as short points, then a three-sentence recap.",
  questions: "Write comprehension and discussion questions: 5 recall, 5 understanding, 3 higher-order thinking, with model answers.",
  objectives: "Write 5–7 measurable learning objectives starting with action verbs, grouped by knowledge, skills and attitudes.",
  activities: "Suggest 6 classroom activities. For each: name, duration, materials, steps, and how it checks learning.",
  presentation_outline: "Write a slide-by-slide presentation outline (10–12 slides): slide title, 3–4 bullet points, and a visual suggestion for each.",
};

const quota = () => Number(process.env.AI_DAILY_MESSAGE_LIMIT ?? 100);

export function aiAvailable() {
  const provider = process.env.AI_PROVIDER ?? "mock";
  if (provider === "openrouter") return !!process.env.OPENROUTER_API_KEY;
  if (provider === "anthropic") return !!process.env.ANTHROPIC_API_KEY;
  return provider === "mock" && !strict;
}

export async function withinDailyLimit(userId: string) {
  const db = await getDb();
  const [{ n }] = await db
    .select({ n: count() })
    .from(aiUsage)
    .where(and(eq(aiUsage.userId, userId), gt(aiUsage.createdAt, new Date(Date.now() - 86_400_000))));
  return Number(n) < quota();
}

async function logUsage(userId: string, action: string, inputTokens: number, outputTokens: number) {
  const db = await getDb();
  await db.insert(aiUsage).values({ userId, action, inputTokens, outputTokens });
}

const place = (t: ReturnType<typeof createT>, locale: Locale, r: ResourceDTO) =>
  `${subjectLabel(locale, r.course)}, ${gradeLabel(t, r.course.grade)} › ${semesterLabel(t, r.semester)} › ${unitLabel(t, r.unit)} › ${sectionLabel(locale, r.section)}`;
const describe = (t: ReturnType<typeof createT>, locale: Locale, r: ResourceDTO) =>
  `- "${r.title}" (${r.type}; ${place(t, locale, r)}${r.tags.length ? `; tags: ${r.tags.join(", ")}` : ""})`;

async function buildSystem(user: User, ctx: AiContext, lastUserText: string, locale: Locale) {
  const t = createT(locale);
  const mine = await teaching(user.id);
  const lines: string[] = [
    "You are the teaching assistant inside EduHub, a teacher's personal workspace for classes, units and teaching resources.",
    "You help with lesson plans, quizzes, worksheets, summaries, activities, and questions about the teacher's own resources.",
    `Reply in ${locale === "ar" ? "Arabic" : "English"} unless the teacher writes in another language or asks for one. Content for a language class (for example an English lesson) stays in the language being taught.`,
    "Format replies in Markdown. Be practical and classroom-ready; match the age of the grade.",
    "You cannot change, move or delete the teacher's files. What you write is a draft the teacher can review, edit and save as a new note.",
    "When asked what resources the teacher has, answer only from the list below. If nothing matches, say so plainly.",
    "",
    "Teacher profile:",
    `- Name: ${[user.firstName, user.lastName].filter(Boolean).join(" ")}`,
    `- School: ${user.schoolName ?? "not set"}`,
    `- Grades taught: ${mine.grades.join(", ") || "not set"}`,
    `- Academic year: ${user.academicYear ?? "not set"}`,
  ];

  const path = ctx.unitId ? await unitPath(user.id, ctx.unitId) : null;
  const course = path?.course ?? (ctx.courseId ? await getCourse(user.id, ctx.courseId) : null);
  if (course) {
    lines.push("", "The teacher is currently working in:", `- Class: ${subjectLabel(locale, course)}, ${gradeLabel(t, course.grade)} (grade ${course.grade})`);
    if (path) lines.push(`- Semester: ${semesterLabel(t, path.semester)}`, `- Unit: ${unitLabel(t, path.unit)}`);
    const section = path && ctx.sectionId ? (await listSections(user.id, path.unit.id)).find((s) => s.id === ctx.sectionId) : null;
    if (section) lines.push(`- Section: ${sectionLabel(locale, section)}`);
    lines.push("Assume this subject, grade and unit for any request that does not name another one. Do not ask for them again.");
  }

  const open = ctx.resourceId ? await getResource(user.id, ctx.resourceId) : null;
  if (open) {
    lines.push("", `The teacher has this resource open: "${open.title}" (${open.type}). "This file" or "this" refers to it.`);
    if (open.content) lines.push("Its content:", open.content.slice(0, 20_000));
    else if (open.url) lines.push(`It is an external link: ${open.url}. You cannot open links; work from its title and what the teacher tells you.`);
    else if (open.file && !attachable(open)) lines.push("Its content is not readable by you yet (only PDFs and images are). Say so if asked about its content.");
  }

  const materials: ResourceDTO[] = [];
  if (ctx.useResources && course) {
    const scope = ctx.sectionId && path ? { sectionId: ctx.sectionId } : path ? { unitId: path.unit.id } : { courseId: course.id };
    let bytes = 0;
    lines.push("", "The teacher allowed you to use the materials of this place. Build your answer on them instead of starting from nothing, and say which ones you used:");
    for (const r of await listResources(user.id, { ...scope, limit: 12 })) {
      if (r.id === open?.id) continue;
      if (r.content) lines.push(`### ${r.title} (note)`, r.content.slice(0, 6_000));
      else if (attachable(r) && materials.length < 4 && bytes + r.file!.size <= 15 * 1024 * 1024) {
        materials.push(r);
        bytes += r.file!.size;
        lines.push(`- "${r.title}" (${r.type}): attached to the teacher's message`);
      } else lines.push(`- "${r.title}" (${r.type}${r.url ? `, ${r.url}` : ""}): content not readable, only the title is known`);
    }
  }

  const words = lastUserText.split(/\s+/).filter((w) => w.length > 2).slice(0, 8);
  const found = new Map<string, ResourceDTO>();
  for (const q of [lastUserText.match(/(unit|الوحدة)\s*\d+/i)?.[0], ...words]) {
    if (!q || found.size >= 30) continue;
    for (const r of await listResources(user.id, { q, limit: 10 })) found.set(r.id, r);
  }
  if (course) for (const r of await listResources(user.id, path ? { unitId: path.unit.id, limit: 25 } : { courseId: course.id, limit: 25 })) found.set(r.id, r);
  if (found.size) lines.push("", "Resources in the teacher's library that may be relevant:", ...[...found.values()].slice(0, 40).map((r) => describe(t, locale, r)));

  return { system: lines.join("\n"), open, materials };
}

const attachable = (r: ResourceDTO) =>
  !!r.file && ((r.type === "pdf" && r.file.size <= 20 * 1024 * 1024) || (r.type === "image" && r.file.size <= 4 * 1024 * 1024));

async function attachment(userId: string, r: ResourceDTO) {
  const db = await getDb();
  const [f] = await db.select().from(files).where(and(eq(files.id, r.file!.id), eq(files.ownerId, userId)));
  const data = (await storage().read(f.storageKey)).toString("base64");
  return r.type === "pdf"
    ? { type: "document", source: { type: "base64", media_type: "application/pdf", data } }
    : { type: "image", source: { type: "base64", media_type: f.mime, data } };
}

export async function chatStream(
  user: User,
  input: { messages: ChatMessage[]; context: AiContext; action?: AiAction; locale: Locale },
): Promise<ReadableStream<Uint8Array>> {
  const messages = input.messages.slice(-20);
  const last = messages[messages.length - 1];
  const { system, open, materials } = await buildSystem(user, input.context, last.content, input.locale);
  const task = input.action ? `${ACTION_BRIEFS[input.action]}\n\nTeacher's request: ${last.content}` : last.content;
  const provider = process.env.AI_PROVIDER ?? "mock";
  const enc = new TextEncoder();

  if (provider === "mock") {
    const t = createT(input.locale);
    const where = system.match(/- Class: [^\n]+(?:\n- (?:Semester|Unit|Section): [^\n]+)*/)?.[0].replace(/\n/g, " ") ?? "-";
    const text = t("ai.mockReply", { request: last.content, where, files: materials.length + (open && attachable(open) ? 1 : 0) });
    await logUsage(user.id, input.action ?? "chat", 0, 0);
    return new ReadableStream({
      async start(controller) {
        for (const chunk of text.match(/.{1,24}/gs) ?? []) {
          controller.enqueue(enc.encode(chunk));
          await new Promise((r) => setTimeout(r, 15));
        }
        controller.close();
      },
    });
  }

  if (provider !== "openrouter") throw new Error(`Unknown AI_PROVIDER "${provider}"`);
  if (!process.env.OPENROUTER_API_KEY) throw new Error("OPENROUTER_API_KEY is not set");

  const apiMessages: { role: string; content: unknown }[] = messages.slice(0, -1).map((m) => ({ role: m.role, content: m.content }));
  const attached = [...(open && attachable(open) ? [open] : []), ...materials];
  apiMessages.push({
    role: "user",
    content: attached.length
      ? [...(await Promise.all(attached.map((r) => attachment(user.id, r)))), { type: "text", text: task }]
      : task,
  });

  const upstream = await fetch("https://openrouter.ai/api/v1/chat/completions", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "authorization": `Bearer ${process.env.OPENROUTER_API_KEY}`,
      "http-referer": process.env.APP_URL ?? "https://eduhub.vercel.app",
      "x-title": "EduHub",
    },
    body: JSON.stringify({
      model: process.env.AI_MODEL ?? "openrouter/free",
      max_tokens: 4096,
      messages: [{ role: "system", content: system }, ...apiMessages],
      stream: true,
    }),
  });

  if (!upstream.ok || !upstream.body) {
    console.error("AI provider error", upstream.status, await upstream.text().catch(() => ""));
    throw new Error("AI provider request failed");
  }

  const reader = upstream.body.getReader();
  const dec = new TextDecoder();
  let buffer = "";
  let inTok = 0;
  let outTok = 0;

  return new ReadableStream({
    async pull(controller) {
      const { done, value } = await reader.read();
      if (done) {
        await logUsage(user.id, input.action ?? "chat", inTok, outTok);
        controller.close();
        return;
      }

      buffer += dec.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";

      for (const line of lines) {
        if (!line.startsWith("data:")) continue;
        if (line.trim() === "data: [DONE]") continue;

        try {
          const ev = JSON.parse(line.slice(5));
          const text = ev.choices?.[0]?.delta?.content;
          if (typeof text === "string") controller.enqueue(enc.encode(text));
          inTok = ev.usage?.prompt_tokens ?? inTok;
          outTok = ev.usage?.completion_tokens ?? outTok;
        } catch {
          /* keep-alive or partial line */
        }
      }
    },
    cancel() {
      void reader.cancel();
    },
  });
}
