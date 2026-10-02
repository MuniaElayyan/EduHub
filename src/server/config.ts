import { hkdfSync } from "node:crypto";

/**
 * Environment handling in one place.
 * In production the server refuses to start when something it needs is missing,
 * so a deployment can never run with a fake mailer or a default secret.
 */
const isProd = process.env.NODE_ENV === "production";
/** Lets automated tests run a production build with the embedded database and the log mailer. Never set it on a real deployment. */
export const testMode = process.env.EDUHUB_TEST_MODE === "1";
export const strict = isProd && !testMode;

export const EMAIL_PROVIDERS = ["resend", "sendgrid", "postmark", "ses"] as const;

/** The PostgreSQL address. `POSTGRES_URL` is what Vercel's database integrations call it. */
export const databaseUrl = () => process.env.DATABASE_URL || process.env.POSTGRES_URL || "";

/**
 * Where uploaded files go. Chosen explicitly with STORAGE_DRIVER, otherwise:
 * a Vercel Blob store connected to the project → "vercel-blob"; anything else → "local" disk.
 */
export function storageDriver(): "local" | "vercel-blob" {
  const explicit = process.env.STORAGE_DRIVER;
  if (explicit === "local" || explicit === "vercel-blob") return explicit;
  return process.env.BLOB_READ_WRITE_TOKEN ? "vercel-blob" : "local";
}
/** Vercel's filesystem is read-only, so the local driver cannot work there. Uploads then answer with a clear error. */
export const storageUsable = () => !(process.env.VERCEL && storageDriver() === "local");

export function validateConfig() {
  if (!strict) return;
  const env = process.env;
  const problems: string[] = [];
  if (!env.APP_SECRET || env.APP_SECRET.length < 32) problems.push("APP_SECRET must be set to at least 32 random characters");
  if (!databaseUrl()) problems.push("DATABASE_URL is required");
  if (!appUrl().startsWith("https://")) problems.push("APP_URL must be the public https:// address");
  const provider = env.EMAIL_PROVIDER ?? "";
  if (!(EMAIL_PROVIDERS as readonly string[]).includes(provider)) {
    problems.push(`EMAIL_PROVIDER must be one of ${EMAIL_PROVIDERS.join(", ")} (the log mailer is for development only)`);
  } else if (provider === "ses") {
    if (!env.AWS_REGION || !env.AWS_ACCESS_KEY_ID || !env.AWS_SECRET_ACCESS_KEY) problems.push("SES needs AWS_REGION, AWS_ACCESS_KEY_ID and AWS_SECRET_ACCESS_KEY");
  } else if (!env.EMAIL_API_KEY) problems.push("EMAIL_API_KEY is required");
  if (!env.EMAIL_FROM) problems.push("EMAIL_FROM is required, for example: EduHub <no-reply@your-domain>");
  if (problems.length) throw new Error(`EduHub cannot start:\n- ${problems.join("\n- ")}`);
}

function appSecret() {
  const s = process.env.APP_SECRET;
  if (s && s.length >= 32) return s;
  if (strict) throw new Error("APP_SECRET is not set");
  return "development-only-secret-do-not-use-in-production";
}

/** Independent keys derived from APP_SECRET, one per purpose. */
export function subkey(purpose: "national-id-encrypt" | "national-id-index" | "codes" | "oauth-state") {
  return Buffer.from(hkdfSync("sha256", appSecret(), "eduhub", purpose, 32));
}

/**
 * The site's public address. APP_URL wins. On Vercel, when it is not set, the address comes from the
 * platform: the production domain for production deployments, the deployment's own address for previews.
 */
export function appUrl() {
  const explicit = process.env.APP_URL?.trim().replace(/\/$/, "");
  if (explicit) return explicit;
  const env = process.env;
  if (env.VERCEL_ENV === "production" && env.VERCEL_PROJECT_PRODUCTION_URL) return `https://${env.VERCEL_PROJECT_PRODUCTION_URL}`;
  if (env.VERCEL_URL) return `https://${env.VERCEL_URL}`;
  return "http://localhost:3000";
}
export const secureCookies = () => isProd && appUrl().startsWith("https://");
export const googleConfigured = () => !!process.env.GOOGLE_CLIENT_ID && !!process.env.GOOGLE_CLIENT_SECRET;
