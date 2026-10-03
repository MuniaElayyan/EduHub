import { createHash, createHmac } from "node:crypto";
import type { Locale } from "@/lib/constants";
import { strict, testMode } from "./config";

/**
 * Email delivery behind one function. The provider is chosen with EMAIL_PROVIDER and its key comes
 * from the environment. "console" prints the message to the server log and exists for local
 * development only: a production server refuses to start with it (see config.ts).
 */
type Message = { to: string; subject: string; text: string; html: string };
type Driver = (m: Message) => Promise<Response | void>;

const from = () => process.env.EMAIL_FROM ?? "EduHub <no-reply@localhost>";
const fromAddress = () => from().match(/<(.+)>/)?.[1] ?? from();
const fromName = () => from().match(/^(.*?)\s*</)?.[1] || "EduHub";
const json = (url: string, headers: Record<string, string>, body: unknown) =>
  fetch(url, { method: "POST", headers: { "Content-Type": "application/json", ...headers }, body: JSON.stringify(body) });

/**
 * Amazon SES v2 "send email" request, signed with Signature Version 4.
 * `alsoSign` adds headers to the signature; the sender does not need it, the signature test does.
 */
export function signSes(body: string, region: string, accessKeyId: string, secretKey: string, now: Date, alsoSign: Record<string, string> = {}) {
  const host = `email.${region}.amazonaws.com`;
  const path = "/v2/email/outbound-emails";
  const amzDate = now.toISOString().replace(/[:-]|\.\d{3}/g, "");
  const date = amzDate.slice(0, 8);
  const hash = (v: string) => createHash("sha256").update(v).digest("hex");
  const hmac = (key: Buffer | string, v: string) => createHmac("sha256", key).update(v).digest();
  const signing: Record<string, string> = { "content-type": "application/json", host, "x-amz-date": amzDate, ...alsoSign };
  const names = Object.keys(signing).sort();
  const signedHeaders = names.join(";");
  const canonical = ["POST", path, "", names.map((n) => `${n}:${signing[n]}\n`).join(""), signedHeaders, hash(body)].join("\n");
  const scope = `${date}/${region}/ses/aws4_request`;
  const toSign = ["AWS4-HMAC-SHA256", amzDate, scope, hash(canonical)].join("\n");
  const key = hmac(hmac(hmac(hmac(`AWS4${secretKey}`, date), region), "ses"), "aws4_request");
  const signature = createHmac("sha256", key).update(toSign).digest("hex");
  return {
    url: `https://${host}${path}`,
    headers: {
      "Content-Type": "application/json",
      "X-Amz-Date": amzDate,
      Authorization: `AWS4-HMAC-SHA256 Credential=${accessKeyId}/${scope}, SignedHeaders=${signedHeaders}, Signature=${signature}`,
    },
  };
}

const drivers: Record<string, Driver> = {
  resend: (m) =>
    // Always Resend's own address. Only an automated test run may point it at a local stand-in.
    json(`${(testMode && process.env.EMAIL_TEST_BASE) || "https://api.resend.com"}/emails`, { Authorization: `Bearer ${process.env.EMAIL_API_KEY}` }, {
      from: from(), to: [m.to], subject: m.subject, text: m.text, html: m.html,
    }),
  sendgrid: (m) =>
    json("https://api.sendgrid.com/v3/mail/send", { Authorization: `Bearer ${process.env.EMAIL_API_KEY}` }, {
      personalizations: [{ to: [{ email: m.to }] }],
      from: { email: fromAddress(), name: fromName() },
      subject: m.subject,
      content: [{ type: "text/plain", value: m.text }, { type: "text/html", value: m.html }],
    }),
  postmark: (m) =>
    json("https://api.postmarkapp.com/email", { "X-Postmark-Server-Token": process.env.EMAIL_API_KEY ?? "", Accept: "application/json" }, {
      From: from(), To: m.to, Subject: m.subject, TextBody: m.text, HtmlBody: m.html, MessageStream: "outbound",
    }),
  ses: (m) => {
    const region = process.env.AWS_REGION!;
    const body = JSON.stringify({
      FromEmailAddress: from(),
      Destination: { ToAddresses: [m.to] },
      Content: { Simple: { Subject: { Data: m.subject, Charset: "UTF-8" }, Body: { Text: { Data: m.text, Charset: "UTF-8" }, Html: { Data: m.html, Charset: "UTF-8" } } } },
    });
    const signed = signSes(body, region, process.env.AWS_ACCESS_KEY_ID!, process.env.AWS_SECRET_ACCESS_KEY!, new Date());
    return fetch(signed.url, { method: "POST", headers: signed.headers, body });
  },
  console: async (m) => {
    console.log(`\n── email to ${m.to} ──\n${m.subject}\n\n${m.text}\n──────────────\n`);
  },
};

/** Why a provider refused a message, in terms an operator can act on. */
export type EmailFailure = "key_invalid" | "sender_not_verified" | "testing_only" | "rejected" | "unavailable";

export class EmailError extends Error {
  constructor(public reason: EmailFailure, detail: string) {
    super(detail);
  }
}

/** Reads the provider's answer and names the cause. Anything unrecognised is "unavailable". */
export function classifyEmailFailure(status: number, body: string): EmailFailure {
  const text = body.toLowerCase();
  if (/testing emails|own email address|sandbox|pending approval|not been approved/.test(text)) return "testing_only";
  if (/not verified|verify (a|your) domain|sender (identity|signature)|not a verified|unverified/.test(text)) return "sender_not_verified";
  if (status === 401 || /api key|unauthori[sz]ed|invalid.*token|authentication/.test(text)) return "key_invalid";
  if (status === 403) return "sender_not_verified";
  if (status === 400 || status === 422) return "rejected";
  return "unavailable";
}

export async function sendEmail(m: Message) {
  const name = process.env.EMAIL_PROVIDER ?? "console";
  if (name === "console" && strict) throw new Error("The log mailer cannot be used in production");
  const driver = drivers[name];
  if (!driver) throw new Error(`Unknown EMAIL_PROVIDER "${name}"`);
  let res: Response | void;
  try {
    res = await driver(m);
  } catch (err) {
    throw new EmailError("unavailable", `Email provider ${name} could not be reached: ${(err as Error).message}`);
  }
  if (res && !res.ok) {
    const body = (await res.text()).slice(0, 400);
    // The provider's own words go to the server log; the screen gets a short, named reason.
    throw new EmailError(classifyEmailFailure(res.status, body), `Email provider ${name} answered ${res.status}: ${body}`);
  }
}

/* ── Messages ──────────────────────────────────────────────────────── */

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);

function layout(locale: Locale, lines: string[], code?: string) {
  const dir = locale === "ar" ? "rtl" : "ltr";
  const paragraphs = lines.map((l) => `<p style="margin:0 0 14px">${esc(l)}</p>`).join("");
  const codeBlock = code
    ? `<p dir="ltr" style="margin:22px 0;font-size:32px;font-weight:700;letter-spacing:8px;text-align:center;color:#14574a">${code}</p>`
    : "";
  const [first, ...rest] = paragraphs.split("</p>");
  return `<div dir="${dir}" style="font-family:Tahoma,Arial,sans-serif;font-size:16px;line-height:1.7;color:#12201c;max-width:480px;margin:0 auto;padding:24px"><p style="font-size:20px;font-weight:700;color:#14574a;margin:0 0 18px">EduHub</p>${first}</p>${codeBlock}${rest.join("</p>")}</div>`;
}

const copy = {
  ar: {
    verify_email: { subject: "رمز تأكيد بريدك في EduHub", lines: ["هذا رمز تأكيد بريدك الإلكتروني:", "الرمز صالح لمدة 10 دقائق ويُستخدم مرة واحدة.", "إن لم تنشئ حسابًا في EduHub فتجاهل هذه الرسالة."] },
    reset_password: { subject: "رمز إعادة تعيين كلمة المرور في EduHub", lines: ["هذا رمز إعادة تعيين كلمة المرور:", "الرمز صالح لمدة 10 دقائق ويُستخدم مرة واحدة.", "إن لم تطلب ذلك فتجاهل هذه الرسالة، وستبقى كلمة مرورك كما هي."] },
    change_email: { subject: "رمز تأكيد بريدك الجديد في EduHub", lines: ["هذا رمز تأكيد بريدك الإلكتروني الجديد:", "الرمز صالح لمدة 10 دقائق ويُستخدم مرة واحدة.", "إن لم تطلب تغيير بريدك فتجاهل هذه الرسالة."] },
    password_changed: { subject: "تم تغيير كلمة المرور في EduHub", lines: ["تم تغيير كلمة مرور حسابك، وأُغلقت الجلسات على الأجهزة الأخرى.", "إن لم تكن أنت من غيّرها فأعد تعيينها الآن من صفحة «نسيت كلمة المرور»."] },
    email_changed: { subject: "تم تغيير بريد حسابك في EduHub", lines: ["تم تغيير البريد الإلكتروني لحسابك إلى عنوان آخر.", "إن لم تكن أنت من غيّره فتواصل مع إدارة المنصة فورًا."] },
  },
  en: {
    verify_email: { subject: "Your EduHub confirmation code", lines: ["This is the code to confirm your email address:", "It works for 10 minutes and can be used once.", "If you did not create an EduHub account, ignore this message."] },
    reset_password: { subject: "Your EduHub password reset code", lines: ["This is the code to reset your password:", "It works for 10 minutes and can be used once.", "If you did not ask for this, ignore this message and your password stays the same."] },
    change_email: { subject: "Confirm your new EduHub email", lines: ["This is the code to confirm your new email address:", "It works for 10 minutes and can be used once.", "If you did not ask to change your email, ignore this message."] },
    password_changed: { subject: "Your EduHub password was changed", lines: ["The password of your account was changed, and sessions on other devices were closed.", "If this was not you, reset it now from the \"Forgot your password?\" page."] },
    email_changed: { subject: "Your EduHub email was changed", lines: ["The email address of your account was changed to another address.", "If this was not you, contact the platform's administrators right away."] },
  },
} as const;

export function sendCodeEmail(to: string, purpose: "verify_email" | "reset_password" | "change_email", code: string, locale: Locale) {
  const c = copy[locale][purpose];
  const [first, ...rest] = c.lines;
  return sendEmail({ to, subject: c.subject, text: [first, code, ...rest].join("\n\n"), html: layout(locale, [...c.lines], code) });
}

export function sendNoticeEmail(to: string, kind: "password_changed" | "email_changed", locale: Locale) {
  const c = copy[locale][kind];
  return sendEmail({ to, subject: c.subject, text: c.lines.join("\n\n"), html: layout(locale, [...c.lines]) });
}
