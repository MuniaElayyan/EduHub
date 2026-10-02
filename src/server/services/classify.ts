import { FILE_TYPES, TYPE_TO_SECTION, type ResourceType } from "@/lib/constants";
import { inspectLink } from "@/lib/links";

/**
 * Rules engine that reads a file name or link and proposes where it belongs.
 * It only proposes: the teacher approves, edits or cancels in the UI.
 * The same shape can later be filled by an AI classifier.
 */
export type Suggestion = {
  title: string;
  type: ResourceType;
  grade: number | null;
  sectionKey: string;
  unit: string | null;
  topic: string | null;
  tags: string[];
  /** true when at least one rule beyond the file type matched */
  confident: boolean;
};

const AR_ORDINALS: [RegExp, number][] = [
  [/حادي\s*عشر/, 11], [/ثاني\s*عشر/, 12],
  [/[اأ]ول/, 1], [/ثاني/, 2], [/ثالث/, 3], [/رابع/, 4], [/خامس/, 5], [/سادس/, 6],
  [/سابع/, 7], [/ثامن/, 8], [/تاسع/, 9], [/عاشر/, 10],
];

const TOPICS: [RegExp, string][] = [
  [/vocab(ulary)?|مفردات/i, "Vocabulary"],
  [/grammar|قواعد/i, "Grammar"],
  [/reading|قراء[ةه]/i, "Reading"],
  [/writing|كتاب[ةه]|تعبير/i, "Writing"],
  [/listening|استماع/i, "Listening"],
  [/speaking|محادث[ةه]/i, "Speaking"],
  [/spelling|إملاء|املاء/i, "Spelling"],
  [/phonics|صوتيات/i, "Phonics"],
  [/revision|review|مراجع[ةه]/i, "Revision"],
  [/exam|test|quiz|امتحان|اختبار/i, "Assessment"],
];

const SECTION_RULES: [RegExp, string][] = [
  [/lesson\s*plan|خط[ةه]\s*(ال)?درس|تحضير/i, "lesson_plans"],
  [/work\s*sheet|ورق[ةه]\s*عمل|أوراق\s*عمل|اوراق\s*عمل/i, "worksheets"],
  [/poster|ملصق|بوستر/i, "posters"],
];

const toInt = (s: string) => {
  // accepts Western and Arabic-Indic digits
  const n = parseInt(s.replace(/[٠-٩]/g, (d) => String("٠١٢٣٤٥٦٧٨٩".indexOf(d))), 10);
  return Number.isFinite(n) ? n : null;
};

export function suggest(input: { name?: string; url?: string }): Suggestion {
  const link = input.url ? inspectLink(input.url) : null;
  const rawName = (input.name ?? "").trim();
  const extMatch = rawName.match(/\.([a-z0-9]{2,5})$/i);
  const ext = extMatch?.[1].toLowerCase();
  const base = (ext ? rawName.slice(0, -ext.length - 1) : rawName).replace(/[_\-.+]+/g, " ").replace(/\s+/g, " ").trim();
  const text = base || link?.host || "";

  const type: ResourceType = (ext && FILE_TYPES[ext]?.type) || link?.type || "link";
  // Each structural rule removes what it matched; what is left of the name is the topic.
  let rest = text;
  const take = (m: RegExpMatchArray | null) => {
    if (m) rest = rest.replace(m[0], " ");
    return m;
  };

  let grade: number | null = null;
  const g = take(text.match(/\b(?:grade|gr|class|year|g)\s*([0-9٠-٩]{1,2})\b/i) ?? text.match(/(?:ال)?صف\s*([0-9٠-٩]{1,2})/));
  if (g) grade = toInt(g[1]);
  if (grade === null) {
    const ar = text.match(/(?:ال)?صف\s+(?:ال)?([\u0600-\u06FF]+(?:\s*عشر)?)/);
    const hit = ar ? AR_ORDINALS.find(([re]) => re.test(ar[1])) : undefined;
    if (hit) {
      grade = hit[1];
      take(ar);
    }
  }
  if (grade !== null && (grade < 1 || grade > 12)) grade = null;

  let unit: string | null = null;
  const u = take(text.match(/\b(?:unit|u)\s*([0-9٠-٩]{1,2})\b/i) ?? text.match(/(?:ال)?وحد[ةه]\s*([0-9٠-٩]{1,2})/));
  if (u) unit = String(toInt(u[1]));

  const lesson = take(text.match(/\b(?:lesson|l)\s*([0-9]{1,2})\b/i) ?? text.match(/(?:ال)?درس\s*([0-9٠-٩]{1,2})/));

  const sectionRule = SECTION_RULES.find(([re]) => re.test(text));
  if (sectionRule) take(text.match(sectionRule[0]));
  const sectionKey = sectionRule?.[1] ?? TYPE_TO_SECTION[type];

  // Topic: the teacher's own words once grade/unit/lesson are taken out ("Present Perfect"),
  // otherwise a known keyword. A name with no structure at all ("IMG_2031") gives no topic.
  const structured = grade !== null || unit !== null || !!lesson || !!sectionRule;
  const leftover = rest.replace(/[()\[\]،,]+/g, " ").replace(/\s+/g, " ").trim();
  const keyword = TOPICS.find(([re]) => re.test(text))?.[1] ?? null;
  const topic = structured && leftover.length >= 2 && /\p{L}{2}/u.test(leftover) ? leftover.slice(0, 80) : keyword;

  const confident = structured || topic !== null;

  const tags: string[] = [];
  if (unit) tags.push(`Unit ${unit}`);
  if (topic) tags.push(topic);
  if (lesson) tags.push(`Lesson ${toInt(lesson[1])}`);

  return { title: base, type, grade, sectionKey, unit, topic, tags, confident };
}
