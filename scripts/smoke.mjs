// End-to-end test against a running server.
//   BASE=http://localhost:3100 SMOKE_LOG=server.log node scripts/smoke.mjs
// The server must run with:
//   EDUHUB_TEST_MODE=1                       log mailer: codes are read from the log, as a teacher reads them from an inbox
//   SESSION_ROTATE_SECONDS=3 SESSION_ROTATION_GRACE_SECONDS=1    so token rotation can be observed
//   GOOGLE_CLIENT_ID=test-client GOOGLE_CLIENT_SECRET=test-secret GOOGLE_TOKEN_URL=http://localhost:3101/token
//                                            Google's token endpoint is played by this script; everything else is the real code
import crypto from "node:crypto";
import fs from "node:fs";
import http from "node:http";

const BASE = process.env.BASE ?? "http://localhost:3000";
const LOG = process.env.SMOKE_LOG;
let failed = 0;
let passed = 0;
function check(name, cond, detail = "") {
  if (cond) passed++;
  else {
    failed++;
    console.log(`  FAIL  ${name} ${detail}`);
  }
}

class Client {
  cookies = new Map();
  lastSetCookie = "";
  async req(method, path, body, { origin = BASE, headers = {}, raw = false } = {}) {
    const h = { ...headers };
    if (this.cookies.size) h.cookie = [...this.cookies].map(([k, v]) => `${k}=${v}`).join("; ");
    if (origin && method !== "GET") h.origin = origin;
    let payload = body;
    if (body && !(body instanceof FormData)) {
      h["content-type"] = "application/json";
      payload = JSON.stringify(body);
    }
    const res = await fetch(BASE + path, { method, headers: h, body: payload, redirect: "manual" });
    for (const c of res.headers.getSetCookie()) {
      if (c.startsWith("eduhub_session=")) this.lastSetCookie = c;
      const [pair] = c.split(";");
      const i = pair.indexOf("=");
      const value = pair.slice(i + 1);
      if (value) this.cookies.set(pair.slice(0, i), value);
      else this.cookies.delete(pair.slice(0, i));
    }
    if (raw) return res;
    const text = await res.text();
    let json = null;
    try {
      json = JSON.parse(text);
    } catch {
      /* not JSON */
    }
    return { status: res.status, json, text, headers: res.headers };
  }
  get = (p, o) => this.req("GET", p, undefined, o);
  post = (p, b = {}, o) => this.req("POST", p, b, o);
  patch = (p, b) => this.req("PATCH", p, b);
  del = (p) => this.req("DELETE", p);
}

const api = (p) => `/api/v1${p}`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
/** The newest code emailed to this address. */
async function codeFor(email) {
  await sleep(250);
  const log = fs.readFileSync(LOG, "utf8");
  const all = [...log.matchAll(new RegExp(`── email to ${email.replace(/[.+]/g, "\\$&")} ──[\\s\\S]*?\\n(\\d{6})\\n`, "g"))];
  return all.at(-1)?.[1];
}
const wrong = (code) => String((Number(code) + 1) % 1_000_000).padStart(6, "0");
function upload(client, name, bytes) {
  const form = new FormData();
  form.append("file", new Blob([bytes]), name);
  return client.post(api("/uploads"), form);
}

const stamp = Date.now();
const emailA = `ahmad.${stamp}@example.com`;
const emailA2 = `ahmad.new.${stamp}@example.com`;
const emailB = `reem.${stamp}@example.com`;
const emailC = `sami.${stamp}@example.com`;
const idA = String(stamp * 7).slice(-9);
const profile = (over = {}) => ({
  firstName: "أحمد", secondName: "محمد", thirdName: "علي", lastName: "سالم", gender: "male", nationalId: idA,
  schoolName: "مدرسة ذكور طولكرم الثانوية", subjects: ["english", "arabic"], grades: [7, 6], academicYear: "2026/2027",
  locale: "ar", theme: "system", ...over,
});
const A = new Client();
const B = new Client();
const anon = new Client();

console.log("public");
{
  const ar = await anon.get("/");
  check("landing renders in Arabic, RTL", ar.status === 200 && /<html lang="ar" dir="rtl"/.test(ar.text) && ar.text.includes("نظام تشغيل المعلم"));
  const en = await anon.get("/", { headers: { cookie: "eduhub_locale=en; eduhub_theme=dark" } });
  check("english is LTR with the dark theme", /<html lang="en" dir="ltr"/.test(en.text) && /data-theme="dark"/.test(en.text));
  const gate = await anon.req("GET", "/app", undefined, { raw: true });
  check("workspace needs login", gate.status === 307 && gate.headers.get("location")?.includes("/login"));
  check("health", (await anon.get(api("/health"))).json?.ok === true);
  const ref = (await anon.get(api("/reference"))).json;
  check("39 subjects come from the database, in both languages", ref.subjects.length === 39 && ref.subjects[1].nameAr === "اللغة الإنجليزية" && ref.subjects[1].nameEn === "English");
  check("google sign-in is offered when its keys are set", ref.google === true);
  for (const p of ["/register", "/login", "/forgot-password", "/info/help"]) check(`page ${p}`, (await anon.get(p)).status === 200);
  check("the teacher is the only kind of user: no other workspace exists", (await anon.get("/school")).status === 404 && (await anon.get(api("/school/teachers"))).status === 404 && (await anon.get("/admin")).status === 404);
}

console.log("nothing is reachable without signing in");
// Every route is read from the API source itself, so a route added later is covered without touching this test.
const PUBLIC = new Set([
  "GET /health", "GET /reference", "POST /auth/register", "POST /auth/login", "POST /auth/logout", "POST /auth/forgot-password",
  "POST /auth/reset/verify-code", "POST /auth/reset/complete", "GET /auth/oauth/google/start", "GET /auth/oauth/google/callback",
  // Also receives the file store's signed "upload finished" call, so it checks the session itself (tested below).
  "POST /uploads/blob",
]);
const ZERO = "11111111-1111-4111-8111-111111111111";
const routes = [...fs.readFileSync(new URL("../src/server/api.ts", import.meta.url), "utf8").matchAll(/^api\.(get|post|patch|delete)\("([^"]+)",\s*(auth\([^)]*\))?/gm)]
  .map((m) => ({ method: m[1].toUpperCase(), path: m[2], guard: m[3] ?? null }));
const guarded = routes.filter((r) => !PUBLIC.has(`${r.method} ${r.path}`));
const call = (client, r) => client.req(r.method, api(r.path.replace(":id", ZERO)), r.method === "GET" ? undefined : {});
{
  check("the route list was read", routes.length >= 50 && guarded.length === routes.length - PUBLIC.size, `${routes.length} routes`);
  check("every non-public route declares a guard", guarded.every((r) => r.guard), guarded.filter((r) => !r.guard).map((r) => r.path).join());
  const open = [];
  for (const r of guarded) if ((await call(anon, r)).status !== 401) open.push(`${r.method} ${r.path}`);
  check(`all ${guarded.length} protected routes answer 401 to a visitor`, open.length === 0, open.join(", "));
  check("a visitor cannot get an upload token", (await anon.post(api("/uploads/blob"), { type: "blob.generate-client-token", payload: { pathname: `${ZERO}/${ZERO}.pdf` } })).status === 401);
  const pages = ["/app", "/app/classes", `/app/classes/${ZERO}`, `/app/classes/${ZERO}/${ZERO}`, `/app/classes/${ZERO}/${ZERO}/${ZERO}`, `/app/classes/${ZERO}/${ZERO}/${ZERO}/${ZERO}`,
    "/app/resources", "/app/favorites", "/app/recent", "/app/trash", "/app/settings", "/complete-profile"];
  const shown = [];
  for (const p of pages) {
    const res = await anon.req("GET", p, undefined, { raw: true });
    if (res.status !== 307 || !res.headers.get("location")?.includes("/login")) shown.push(p);
  }
  check(`all ${pages.length} private pages send a visitor to the login page`, shown.length === 0, shown.join(", "));
}

console.log("registration without an email code");
{
  check("cross-origin POST refused", (await anon.post(api("/auth/login"), { email: "a@b.co", password: "x" }, { origin: "https://evil.example" })).status === 403);
  check("weak password refused", (await anon.post(api("/auth/register"), { ...profile(), email: emailA, password: "short" })).status === 400);
  check("bad national ID refused", (await anon.post(api("/auth/register"), { ...profile({ nationalId: "abc" }), email: emailA, password: "correct horse 9" })).json?.error?.code === "invalid_national_id");
  check("unknown subject refused", (await anon.post(api("/auth/register"), { ...profile({ subjects: ["alchemy"] }), email: emailA, password: "correct horse 9" })).status === 400);
  check("phone number is not a field", !JSON.stringify(profile()).includes("phone"));

  const reg = await A.post(api("/auth/register"), { ...profile(), email: emailA.toUpperCase(), password: "correct horse 9" });
  check("registering makes the account live at once", reg.status === 201 && reg.json.user.status === "active" && reg.json.user.schoolName === "مدرسة ذكور طولكرم الثانوية", reg.text);
  await sleep(300);
  check("no email is sent when an account is created", !fs.readFileSync(LOG, "utf8").includes(`email to ${emailA}`));
  check("the workspace is there straight away", (await A.get(api("/courses"))).json?.courses?.length === 4 && (await A.get("/app")).status === 200);
  check("the code step of registration no longer exists", (await A.post(api("/auth/verify-email"), { code: "123456" })).status === 404
    && (await A.post(api("/auth/resend-code"))).status === 404 && (await A.get("/verify-email")).status === 404);
  check("same email refused", (await anon.post(api("/auth/register"), { ...profile({ nationalId: "555555551" }), email: emailA, password: "correct horse 9" })).json?.error?.code === "email_taken");
  check("same national ID refused", (await anon.post(api("/auth/register"), { ...profile(), email: emailC, password: "correct horse 9" })).json?.error?.code === "national_id_taken");
}

console.log("workspace built from the registration");
let courses, eng6, sem1, units, unit3, sections;
{
  courses = (await A.get(api("/courses"))).json.courses;
  check("one class per subject and grade", courses.length === 4 && courses.map((c) => `${c.subjectCode}${c.grade}`).join() === "english6,english7,arabic6,arabic7", courses.map((c) => `${c.subjectCode}${c.grade}`).join());
  eng6 = courses[0];
  const sems = (await A.get(api(`/courses/${eng6.id}/semesters`))).json.semesters;
  check("two semesters of twelve units", sems.length === 2 && sems.every((s) => s.unitCount === 12));
  sem1 = sems[0];
  units = (await A.get(api(`/semesters/${sem1.id}/units`))).json.units;
  check("units 1 to 12", units.map((u) => u.number).join() === "1,2,3,4,5,6,7,8,9,10,11,12");
  unit3 = units[2];

  const added = await A.post(api(`/semesters/${sem1.id}/units`), {});
  check("add unit 13", added.status === 201 && added.json.unit.number === 13);
  check("name a unit", (await A.patch(api(`/units/${added.json.unit.id}`), { title: "مراجعة عامة" })).json.unit.title === "مراجعة عامة");
  check("delete an empty unit", (await A.del(api(`/units/${added.json.unit.id}`))).status === 200);

  sections = (await A.get(api(`/units/${unit3.id}/sections`))).json.sections;
  check("eight default sections with their rules", sections.length === 8 && sections[0].typeKey === "videos" && sections[0].exts.join() === "mp4,mov" && sections[2].links === false);
  check("default sections are created once", (await A.get(api(`/units/${unit3.id}/sections`))).json.sections.length === 8);
  const custom = await A.post(api(`/units/${unit3.id}/sections`), { name: "ملفات الاختبارات", icon: "award", color: "plum" });
  check("add a custom section", custom.status === 201 && (await A.get(api(`/units/${unit3.id}/sections`))).json.sections.at(-1).exts === null);
  check("rename a default section", (await A.patch(api(`/sections/${sections[0].id}`), { name: "فيديوهات الدرس" })).json.section.name === "فيديوهات الدرس");
  check("delete an empty section", (await A.del(api(`/sections/${custom.json.section.id}`))).status === 200);
  check("add class later", (await A.post(api("/courses"), { subjectCode: "english", grade: 8 })).status === 201);
  check("the same class twice is refused", (await A.post(api("/courses"), { subjectCode: "english", grade: 8 })).json?.error?.code === "course_exists");
}

console.log("resources in their place");
const by = (key) => sections.find((s) => s.typeKey === key);
let pdf, fileId;
{
  const s = (await A.post(api("/resources/suggest"), { name: "Grade 6 Unit 3 Present Perfect.pptx" })).json.suggestion;
  check("suggests class, unit, section and topic", s.courseId === eng6.id && s.unitId === unit3.id && s.sectionId === by("presentations").id && s.topic === "Present Perfect", JSON.stringify(s));

  check("upload is admitted before any byte is sent", (await A.post(api("/uploads/start"), { name: "vocabulary list.pdf", size: 40 })).json?.mode === "form");
  check("a type that is not allowed is refused up front", (await A.post(api("/uploads/start"), { name: "run.exe", size: 40 })).status === 415);
  check("a file over the size limit is refused up front", (await A.post(api("/uploads/start"), { name: "big.mp4", size: 5e9 })).status === 413);
  check("direct-upload steps are closed when the store is the local disk", (await A.post(api("/uploads/complete"), { pathname: `${ZERO}/${ZERO}.pdf`, name: "x.pdf" })).status === 400);
  const good = await upload(A, "vocabulary list.pdf", "%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF\n");
  check("upload pdf", good.status === 201, good.text);
  fileId = good.json.file?.id;
  check("renamed executable refused", (await upload(A, "evil.pdf", "MZ not a pdf")).status === 415);
  check("upload needs login", (await upload(anon, "a.pdf", "%PDF-1.4")).status === 401);

  const r = await A.post(api("/resources"), { sectionId: by("files").id, kind: "file", title: "Vocabulary list", fileId });
  pdf = r.json.resource;
  check("a resource added inside a section inherits class, semester and unit", r.status === 201 && pdf.courseId === eng6.id && pdf.unitId === unit3.id && pdf.semesterId === sem1.id && pdf.unit.number === 3 && pdf.course.subjectEn === "English", r.text);
  const yt = await A.post(api("/resources"), { sectionId: by("videos").id, kind: "link", title: "Song", url: "https://www.youtube.com/watch?v=dQw4w9WgXcQ" });
  check("youtube link gets a thumbnail", yt.json.resource.type === "video" && yt.json.resource.thumbnailUrl.includes("dQw4w9WgXcQ"));
  check("javascript: url refused", (await A.post(api("/resources"), { sectionId: by("links").id, kind: "link", title: "x", url: "javascript:alert(1)" })).status === 400);

  // The same unit number in another class.
  const ar7 = courses[3];
  const arSem = (await A.get(api(`/courses/${ar7.id}/semesters`))).json.semesters[1];
  const arUnit3 = (await A.get(api(`/semesters/${arSem.id}/units`))).json.units[2];
  const arSecs = (await A.get(api(`/units/${arUnit3.id}/sections`))).json.sections;
  await A.post(api("/resources"), { sectionId: arSecs.find((x) => x.typeKey === "lesson_plans").id, kind: "note", title: "خطة درس النحو", content: "# خطة\n\nالمبتدأ والخبر" });

  const found = (await A.get(api("/resources?q=" + encodeURIComponent("Unit 3")))).json.resources;
  check("\"Unit 3\" finds everything filed under unit 3, in every class, whatever its title", found.length === 3 && new Set(found.map((x) => x.courseId)).size === 2 && new Set(found.map((x) => x.type)).size === 3, `${found.length}`);
  check("search by subject name in Arabic", (await A.get(api("/resources?q=" + encodeURIComponent("العربية")))).json.resources.length === 1);
  check("filter by unit and type", (await A.get(api(`/resources?unitId=${unit3.id}&type=video`))).json.resources.length === 1);

  const second = (await A.post(api("/resources"), { sectionId: by("files").id, kind: "link", title: "Second", url: "https://example.org/a" })).json.resource;
  check("reorder inside a section", (await A.post(api(`/sections/${by("files").id}/reorder`), { ids: [second.id, pdf.id] })).status === 200
    && (await A.get(api(`/resources?sectionId=${by("files").id}&sort=manual`))).json.resources.map((x) => x.title).join() === "Second,Vocabulary list");

  await A.post(api(`/resources/${pdf.id}/favorite`), { value: true });
  await A.post(api(`/resources/${pdf.id}/open`));
  check("favorites and recently used", (await A.get(api("/resources?view=favorites"))).json.resources.length === 1 && (await A.get(api("/resources?view=recent"))).json.resources[0]?.id === pdf.id);

  const part = await A.req("GET", api(`/files/${fileId}`), undefined, { raw: true, headers: { range: "bytes=0-3" } });
  check("file served to its owner, with ranges", part.status === 206 && (await part.text()) === "%PDF" && part.headers.get("x-content-type-options") === "nosniff");

  const moved = await A.patch(api(`/resources/${pdf.id}`), { sectionId: by("worksheets").id });
  check("move to another section", moved.json.resource.sectionId === by("worksheets").id);
  await A.patch(api(`/resources/${pdf.id}`), { sectionId: by("files").id });
  const copy = (await A.post(api(`/resources/${pdf.id}/duplicate`))).json.resource;
  check("permanent delete only from trash", (await A.del(api(`/resources/${copy.id}/permanent`))).status === 404);
  await A.del(api(`/resources/${copy.id}`));
  check("trash, then delete permanently", (await A.get(api("/resources?view=trash"))).json.resources.length === 1 && (await A.del(api(`/resources/${copy.id}/permanent`))).status === 200);
  check("the shared file survives deleting the copy", (await A.get(api(`/files/${fileId}`))).status === 200);
  await A.del(api(`/resources/${pdf.id}`));
  check("restore from trash", (await A.post(api(`/resources/${pdf.id}/restore`))).status === 200);
  check("a section holding resources cannot be deleted", (await A.del(api(`/sections/${by("files").id}`))).json?.error?.code === "not_empty");
}

console.log("assistant (mock provider)");
{
  const ctx = { courseId: eng6.id, unitId: unit3.id, sectionId: by("files").id };
  const plain = await A.post(api("/ai/chat"), { messages: [{ role: "user", content: "quiz from these" }], context: ctx, action: "quiz" });
  check("assistant knows subject, grade, semester, unit and section", ["Class:", "Semester:", "Unit:", "Section:"].every((k) => plain.text.includes(k)), plain.text.slice(0, 300));
  const withFiles = await A.post(api("/ai/chat"), { messages: [{ role: "user", content: "quiz from these" }], context: { ...ctx, useResources: true }, action: "quiz" });
  const n = (t) => Number(t.match(/: (\d+)\n\n(?:To get|لتفعيل)/)?.[1]);
  check("files are read only with consent", n(withFiles.text) === 1 && n(plain.text) === 0, `${n(withFiles.text)} / ${n(plain.text)}`);
}

console.log("one teacher cannot touch another's space");
{
  await B.post(api("/auth/register"), { ...profile({ firstName: "ريم", gender: "female", nationalId: String(stamp + 3).slice(-9), subjects: ["math"], grades: [5] }), email: emailB, password: "another pass 1" });
  check("second teacher has her own class", (await B.get(api("/courses"))).json.courses.length === 1);
  check("cannot read resource", (await B.get(api(`/resources/${pdf.id}`))).status === 404);
  check("cannot read file", (await B.get(api(`/files/${fileId}`))).status === 404);
  check("cannot edit or trash", (await B.patch(api(`/resources/${pdf.id}`), { title: "x" })).status === 404 && (await B.del(api(`/resources/${pdf.id}`))).status === 404);
  check("cannot add into a foreign section", (await B.post(api("/resources"), { sectionId: by("files").id, kind: "note", title: "x", content: "y" })).status === 404);
  check("cannot list or change foreign units and sections", (await B.get(api(`/semesters/${sem1.id}/units`))).json.units.length === 0
    && (await B.get(api(`/units/${unit3.id}/sections`))).json.sections.length === 0
    && (await B.patch(api(`/units/${unit3.id}`), { title: "x" })).status === 404
    && (await B.patch(api(`/sections/${by("files").id}`), { name: "x" })).status === 404);
  check("cannot attach a foreign file", (await B.post(api("/resources"), { sectionId: (await firstSection(B)).id, kind: "file", title: "x", fileId })).status === 404);
  check("search stays inside her own space", (await B.get(api("/resources?q=Vocabulary"))).json.resources.length === 0);
  check("foreign class page is not shown", (await B.get(`/app/classes/${eng6.id}`)).status !== 200);
}
async function firstSection(client) {
  const c = (await client.get(api("/courses"))).json.courses[0];
  const s = (await client.get(api(`/courses/${c.id}/semesters`))).json.semesters[0];
  const u = (await client.get(api(`/semesters/${s.id}/units`))).json.units[0];
  return (await client.get(api(`/units/${u.id}/sections`))).json.sections[1];
}

console.log("pages for the signed-in teacher");
{
  const dash = await A.get("/app");
  check("dashboard: subjects, classes and counts", dash.status === 200 && dash.text.includes("اللغة الإنجليزية") && dash.text.includes("اللغة العربية") && dash.text.includes("5 صفوف"), dash.text.match(/لديك[^<]*/)?.[0]);
  const base = `/app/classes/${eng6.id}`;
  check("class page shows two semesters", (await A.get(base)).text.includes("الفصل الدراسي الثاني"));
  check("semester page shows its units", (await A.get(`${base}/${sem1.id}`)).text.includes("الوحدة 12"));
  const unitPage = await A.get(`${base}/${sem1.id}/${unit3.id}`);
  check("unit page shows sections, renamed one included, and the breadcrumb", unitPage.text.includes("فيديوهات الدرس") && unitPage.text.includes("العروض التقديمية") && unitPage.text.includes("الفصل الدراسي الأول"));
  check("section page", (await A.get(`${base}/${sem1.id}/${unit3.id}/${by("files").id}`)).text.includes("Vocabulary list"));
  for (const p of ["/app/classes", "/app/resources?q=Unit", "/app/favorites", "/app/recent", "/app/trash", "/app/settings"]) check(`page ${p}`, (await A.get(p)).status === 200);
}

console.log("account security");
{
  const me = await A.get(api("/me"));
  check("profile shows only the last four digits of the ID", me.json.nationalIdLast4 === idA.slice(-4) && !me.text.replaceAll(String(stamp), "").includes(idA) && !/password_?hash/i.test(me.text) && !me.text.includes("scrypt"));
  check("school name is editable text", (await A.patch(api("/me"), { schoolName: "مدرسة الأمل الأساسية" })).json.user.schoolName === "مدرسة الأمل الأساسية");

  const plainLogin = new Client();
  await plainLogin.post(api("/auth/login"), { email: emailA, password: "correct horse 9" });
  check("without remember-me: a browser-session cookie", /HttpOnly/i.test(plainLogin.lastSetCookie) && /SameSite=Lax/i.test(plainLogin.lastSetCookie) && !/Max-Age/i.test(plainLogin.lastSetCookie));
  const remembered = new Client();
  await remembered.post(api("/auth/login"), { email: emailA, password: "correct horse 9", remember: true });
  check("remember-me: a 180-day cookie", /Max-Age=15552000/i.test(remembered.lastSetCookie) && /HttpOnly/i.test(remembered.lastSetCookie));
  check("a different network address does not end the session", (await remembered.get(api("/me"), { headers: { "x-forwarded-for": "203.0.113.9" } })).status === 200);
  const list = (await A.get(api("/me/sessions"))).json.sessions;
  check("each device has its own session", list.length === 3 && list.filter((s) => s.current).length === 1 && list.filter((s) => s.remember).length === 1);

  // Rotation: the token is replaced, the old one works briefly, and its later reuse closes the session.
  const before = remembered.cookies.get("eduhub_session");
  await sleep(3200);
  await remembered.get(api("/me"));
  const after = remembered.cookies.get("eduhub_session");
  check("the session token is rotated", !!after && after !== before && /Max-Age=15552000/i.test(remembered.lastSetCookie));
  const thief = new Client();
  thief.cookies.set("eduhub_session", before);
  check("the replaced token works only for a moment", (await thief.get(api("/me"))).status === 200);
  await sleep(1300);
  check("reusing a replaced token later is refused", (await thief.get(api("/me"))).status === 401);
  check("and closes that session", (await remembered.get(api("/me"))).status === 401);

  // The same when the request that triggers rotation is a streamed reply (a file download), not JSON.
  const streamer = new Client();
  await streamer.post(api("/auth/login"), { email: emailA, password: "correct horse 9", remember: true });
  const tokenBefore = streamer.cookies.get("eduhub_session");
  await sleep(3200);
  const download = await streamer.req("GET", api(`/files/${fileId}`), undefined, { raw: true });
  await download.arrayBuffer();
  check("rotation also reaches the browser on a file download", download.status === 200 && streamer.cookies.get("eduhub_session") !== tokenBefore);
  await sleep(1300);
  check("and the session is still alive afterwards", (await streamer.get(api("/me"))).status === 200);
  await streamer.post(api("/auth/logout"));

  check("wrong current password refused", (await A.post(api("/me/password"), { currentPassword: "nope", newPassword: "brand new pass 7" })).json?.error?.code === "wrong_password");
  check("change password", (await A.post(api("/me/password"), { currentPassword: "correct horse 9", newPassword: "brand new pass 7" })).status === 200);
  check("other devices are signed out, this one stays", (await plainLogin.get(api("/me"))).status === 401 && (await A.get(api("/me"))).status === 200);

  check("email change needs the password", (await A.post(api("/me/email"), { password: "nope", newEmail: emailA2 })).json?.error?.code === "wrong_password");
  check("email change to a taken address refused", (await A.post(api("/me/email"), { password: "brand new pass 7", newEmail: emailB })).json?.error?.code === "email_taken");
  check("email change sends a code to the new address", (await A.post(api("/me/email"), { password: "brand new pass 7", newEmail: emailA2 })).status === 200);
  check("old address stays until the code is entered", (await A.get(api("/me"))).json.user.email === emailA);
  check("email changed after the code", (await A.post(api("/me/email/verify"), { code: await codeFor(emailA2) })).json?.user?.email === emailA2);
  check("logout ends the session", (await A.post(api("/auth/logout"))).status === 200 && (await A.get(api("/me"))).status === 401);
}

console.log("rate limits are shared through the database");
{
  const target = `locked.${stamp}@example.com`;
  let status = 0;
  for (let i = 0; i < 11; i++) status = (await anon.post(api("/auth/login"), { email: target, password: "wrong password" })).status;
  check("the eleventh wrong sign-in for one address is blocked", status === 429);
}

console.log("forgotten password");
{
  const unknown = await anon.post(api("/auth/forgot-password"), { email: `nobody.${stamp}@example.com` });
  const known = await anon.post(api("/auth/forgot-password"), { email: emailA2 });
  check("same answer whether or not the address has an account", unknown.status === 200 && unknown.text === known.text);
  const device = new Client();
  await device.post(api("/auth/login"), { email: emailA2, password: "brand new pass 7", remember: true });
  const code = await codeFor(emailA2);
  check("reset code emailed", /^\d{6}$/.test(code ?? ""));
  check("wrong reset code refused", (await anon.post(api("/auth/reset/verify-code"), { email: emailA2, code: wrong(code) })).json?.error?.code === "invalid_code");
  const ticket = (await anon.post(api("/auth/reset/verify-code"), { email: emailA2, code })).json?.ticket;
  check("correct code gives a one-time ticket", typeof ticket === "string" && ticket.length > 20);
  check("the code cannot be used twice", (await anon.post(api("/auth/reset/verify-code"), { email: emailA2, code })).status === 400);
  check("new password saved", (await anon.post(api("/auth/reset/complete"), { ticket, password: "third password 3" })).status === 200);
  check("the ticket cannot be used twice", (await anon.post(api("/auth/reset/complete"), { ticket, password: "fourth password 4" })).status === 400);
  check("every device is signed out, remembered ones too", (await device.get(api("/me"))).status === 401);
  check("old password refused, new one accepted", (await anon.post(api("/auth/login"), { email: emailA2, password: "brand new pass 7" })).status === 401
    && (await new Client().post(api("/auth/login"), { email: emailA2, password: "third password 3" })).status === 200);
  const log = fs.readFileSync(LOG, "utf8");
  check("the password itself is never emailed or logged", !log.includes("third password 3") && !log.includes("correct horse 9"));
}

console.log("Google sign-in (token endpoint played by this script)");
{
  // Stand-in for Google's token endpoint: hands back the ID token the test prepared and records what the server sent.
  let idToken = "";
  let received = null;
  const stub = http.createServer((req, res) => {
    let raw = "";
    req.on("data", (d) => (raw += d));
    req.on("end", () => {
      received = new URLSearchParams(raw);
      res.setHeader("content-type", "application/json");
      res.end(JSON.stringify({ id_token: idToken }));
    });
  });
  await new Promise((r) => stub.listen(3101, r));
  const b64 = (o) => Buffer.from(JSON.stringify(o)).toString("base64url");

  async function google(client, claims, { tamperState = false } = {}) {
    const start = await client.req("GET", api("/auth/oauth/google/start?remember=1"), undefined, { raw: true });
    const to = new URL(start.headers.get("location"));
    idToken = `${b64({ alg: "RS256" })}.${b64({ iss: "https://accounts.google.com", aud: "test-client", exp: Math.floor(Date.now() / 1000) + 300, nonce: to.searchParams.get("nonce"), email_verified: true, ...claims })}.sig`;
    const state = tamperState ? "forged" : to.searchParams.get("state");
    const back = await client.req("GET", api(`/auth/oauth/google/callback?code=abc&state=${state}`), undefined, { raw: true });
    return { to, location: back.headers.get("location") ?? "" };
  }

  const G = new Client();
  const emailG = `google.${stamp}@example.com`;
  const first = await google(G, { sub: "g-1", email: emailG, given_name: "Lina", family_name: "Khalil" });
  check("the browser is sent to Google with PKCE, state and nonce", first.to.hostname === "accounts.google.com" && first.to.searchParams.get("code_challenge_method") === "S256"
    && first.to.searchParams.get("client_id") === "test-client" && first.to.searchParams.get("redirect_uri") === `${BASE}/api/v1/auth/oauth/google/callback`);
  check("the code is exchanged with the secret and the PKCE verifier", received.get("client_secret") === "test-secret" && received.get("code") === "abc"
    && crypto.createHash("sha256").update(received.get("code_verifier")).digest("base64url") === first.to.searchParams.get("code_challenge"));
  check("a first Google sign-in goes to \"complete your profile\"", first.location.endsWith("/complete-profile"));
  const meG = (await G.get(api("/me"))).json;
  check("the email comes from Google and is already confirmed", meG.user.email === emailG && meG.user.status === "pending_profile" && meG.hasPassword === false && meG.providers.join() === "google");
  check("no workspace before the profile is complete", (await G.get(api("/courses"))).json?.error?.code === "profile_incomplete");
  const { email: _e, ...noEmail } = { ...profile({ firstName: "لينا", gender: "female", nationalId: String(stamp * 3).slice(-9), subjects: ["science_life"], grades: [5] }) };
  const done = await G.post(api("/auth/complete-profile"), noEmail);
  check("completing the profile needs no email and creates the classes", done.status === 200 && done.json.user.status === "active" && (await G.get(api("/courses"))).json.courses.length === 1, done.text);
  check("remember-me carries through Google", /Max-Age=15552000/i.test(G.lastSetCookie));

  const again = new Client();
  check("a returning Google user goes straight to the workspace", (await google(again, { sub: "g-1", email: emailG })).location.endsWith("/app"));
  check("a forged state is refused", (await google(new Client(), { sub: "g-9", email: `x.${stamp}@example.com` }, { tamperState: true })).location.includes("/login?error=oauth"));
  check("an address Google has not verified is refused", (await google(new Client(), { sub: "g-8", email: `y.${stamp}@example.com`, email_verified: false })).location.includes("/login?error=oauth"));
  check("a token for another application is refused", (await google(new Client(), { sub: "g-7", email: `z.${stamp}@example.com`, aud: "someone-else" })).location.includes("/login?error=oauth"));

  // Same address as an existing, confirmed account: linked, not duplicated.
  const linked = new Client();
  const link = await google(linked, { sub: "g-2", email: emailA2 });
  const meL = (await linked.get(api("/me"))).json;
  check("Google with an existing account's email opens that account", link.location.endsWith("/app") && meL.user.email === emailA2 && meL.hasPassword === true && (await linked.get(api("/courses"))).json.courses.length === 5);

  // An address someone registered but never confirmed: the Google owner gets it, the stranger's password and session do not survive.
  const stranger = new Client();
  const emailD = `dana.${stamp}@example.com`;
  await stranger.post(api("/auth/register"), { ...profile({ nationalId: String(stamp * 11).slice(-9), subjects: ["math"], grades: [3] }), email: emailD, password: "stranger pass 1" });
  const owner = new Client();
  await google(owner, { sub: "g-3", email: emailD });
  check("the Google owner gets the account", (await owner.get(api("/me"))).json.user.email === emailD);
  check("the unconfirmed registrant's session is closed", (await stranger.get(api("/me"))).status === 401);
  check("and their password no longer opens it", (await new Client().post(api("/auth/login"), { email: emailD, password: "stranger pass 1" })).status === 401);
  stub.close();
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
