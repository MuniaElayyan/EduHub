import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { appUrl, subkey, testMode } from "./config";

/**
 * Sign-in with Google: OpenID Connect, authorization-code flow with PKCE.
 * The code is exchanged on the server, straight with Google over TLS, using the client secret.
 * Other providers follow the same three steps (start, exchange, profile) and plug into the same account-linking code.
 */
export type OAuthProfile = { provider: "google"; providerUserId: string; email: string; firstName: string | null; lastName: string | null };

export const OAUTH_COOKIE = "eduhub_oauth";
const b64 = (b: Buffer) => b.toString("base64url");
const sign = (payload: string) => createHmac("sha256", subkey("oauth-state")).update(payload).digest("base64url");
const redirectUri = () => `${appUrl()}/api/v1/auth/oauth/google/callback`;

/** Builds the address to send the browser to, and the signed cookie that ties the answer to this browser. */
export function googleStart(remember: boolean) {
  const state = b64(randomBytes(16));
  const nonce = b64(randomBytes(16));
  const verifier = b64(randomBytes(32));
  const payload = b64(Buffer.from(JSON.stringify({ state, nonce, verifier, remember })));
  const url = new URL("https://accounts.google.com/o/oauth2/v2/auth");
  url.search = new URLSearchParams({
    client_id: process.env.GOOGLE_CLIENT_ID!,
    redirect_uri: redirectUri(),
    response_type: "code",
    scope: "openid email profile",
    state,
    nonce,
    code_challenge: b64(createHash("sha256").update(verifier).digest()),
    code_challenge_method: "S256",
    prompt: "select_account",
  }).toString();
  return { url: url.toString(), cookie: `${payload}.${sign(payload)}` };
}

export function readOAuthCookie(cookie: string | undefined): { state: string; nonce: string; verifier: string; remember: boolean } | null {
  const [payload, mac] = (cookie ?? "").split(".");
  if (!payload || !mac) return null;
  const expected = Buffer.from(sign(payload));
  const given = Buffer.from(mac);
  if (expected.length !== given.length || !timingSafeEqual(expected, given)) return null;
  try {
    return JSON.parse(Buffer.from(payload, "base64url").toString());
  } catch {
    return null;
  }
}

/** Exchanges the code for an ID token and returns the verified profile, or null when anything does not check out. */
export async function googleProfile(code: string, verifier: string, nonce: string): Promise<OAuthProfile | null> {
  // Always Google's own endpoint. Only an automated test run (EDUHUB_TEST_MODE) may substitute a local stand-in.
  const tokenUrl = (testMode && process.env.GOOGLE_TOKEN_URL) || "https://oauth2.googleapis.com/token";
  const res = await fetch(tokenUrl, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: process.env.GOOGLE_CLIENT_ID!,
      client_secret: process.env.GOOGLE_CLIENT_SECRET!,
      code,
      code_verifier: verifier,
      grant_type: "authorization_code",
      redirect_uri: redirectUri(),
    }),
  });
  if (!res.ok) return null;
  const { id_token } = (await res.json()) as { id_token?: string };
  const part = id_token?.split(".")[1];
  if (!part) return null;
  // The token came directly from Google's token endpoint over TLS, so its claims are checked rather than its signature.
  const claims = JSON.parse(Buffer.from(part, "base64url").toString()) as Record<string, unknown>;
  const issuerOk = claims.iss === "https://accounts.google.com" || claims.iss === "accounts.google.com";
  if (!issuerOk || claims.aud !== process.env.GOOGLE_CLIENT_ID || claims.nonce !== nonce) return null;
  if (typeof claims.exp !== "number" || claims.exp * 1000 < Date.now()) return null;
  // Only addresses Google itself has verified are accepted, because the address decides which account is opened.
  if (claims.email_verified !== true || typeof claims.email !== "string" || typeof claims.sub !== "string") return null;
  return {
    provider: "google",
    providerUserId: claims.sub,
    email: claims.email.trim().toLowerCase(),
    firstName: typeof claims.given_name === "string" ? claims.given_name : null,
    lastName: typeof claims.family_name === "string" ? claims.family_name : null,
  };
}
