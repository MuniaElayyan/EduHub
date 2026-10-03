# Architecture

## Stack

| Layer | Choice |
| --- | --- |
| Web | Next.js 15 (App Router), React 19, TypeScript, Tailwind 4 |
| API | Hono mounted at `/api/v1`: versioned REST used by the web app, ready for a mobile app |
| Data | PostgreSQL through Drizzle ORM; embedded PGlite in development |
| Email | One `sendEmail` function with drivers for Resend, SendGrid, Postmark and Amazon SES |
| Files | `Storage` interface: local disk, or a private Vercel Blob store with direct browser uploads |
| AI | Streaming provider function; Anthropic Messages API, or a mock without a key |

Pages read through services. Every change goes through the REST API. Every service function takes the
user id and filters by owner, so no query can return another teacher's row.

## Database

```
users ─┬─ user_credentials      password hash only (absent for Google-only accounts)
       ├─ identity_documents    national ID: ciphertext, last four digits, keyed hash for uniqueness
       ├─ oauth_accounts        provider + provider user id
       ├─ sessions              one per device: token hash, previous token hash, remember, expiry
       ├─ verification_codes    purpose, HMAC of the code, target email, attempts, expiry
       ├─ password_resets       single-use ticket issued after a correct reset code
       ├─ teacher_subjects ──── subjects        (39 seeded rows, Arabic and English names)
       ├─ teacher_grades
       └─ courses               subject + grade + academic year
            └─ semesters        two per class
                 └─ units       twelve per semester by default
                      └─ sections ── section_types   (seeded defaults and what each accepts)
                           └─ resources ── files
resource_states   favourite and last-opened, per user
notifications, ai_usage, audit_logs
```

- `users.school_name` is free text. There is no schools table.
- `users.role` is an enum with one value, `teacher`.
- `users.status`: a registration is `active` at once; a first Google sign-in is `pending_profile` until the teaching details are filled in. `pending_email` is kept only for accounts created by an earlier version, which become `active` the next time they are seen.
- A unit's default sections are created the first time the unit is opened, so unused units cost nothing.
- Trash is `resources.deleted_at`. Permanent deletion works only from the trash and frees the stored
  file once nothing else points to it.

## Authentication

**Passwords.** scrypt with a salt per password, in their own table. Nothing returns or displays them.

**Email codes** (`auth.ts`: `issueCode`, `checkCode`). `crypto.randomInt`, six digits, stored as an HMAC,
ten minutes, five wrong tries, single use; a new code cancels the old one; 60 seconds between sends,
five an hour. Used for password reset and email change. Registration sends no code and does not prove the
address: `email_verified_at` is set when a reset code is entered, or by Google.

**Sessions.** A random 256-bit token in an HttpOnly, SameSite=Lax cookie (Secure over https); the
database keeps its SHA-256. "Remember me" gives a 180-day session and a persistent cookie; without it
the cookie ends with the browser and the session after 24 idle hours. The token is replaced every
24 hours on an API request; the replaced token stays valid for 60 seconds, and its reuse after that
revokes the session. IP addresses are recorded for display only and never decide anything.
Settings lists the devices and can sign out one or all others.

**Password reset.** Email → code → single-use ticket → new password. The reply is the same whether
or not the address has an account. Every session is revoked afterwards and a notice is emailed.

**Email change.** Current password → code to the new address → swap. The old address is notified.

**Google.** Authorization-code flow with PKCE, state and nonce in a signed cookie, code exchanged on
the server. Requires `email_verified`. A matching email links to the existing account; if that account
never confirmed its address, its password and sessions are removed first.

**Configuration.** `config.ts` validates the environment at boot. In production the server does not
start without a secret, a database, an https URL and a real email provider.

## API

| Area | Routes |
| --- | --- |
| Reference | `GET /reference`, `GET /health` |
| Registration | `POST /auth/register` |
| Sign-in | `POST /auth/login`, `/auth/logout`; `GET /auth/oauth/google/start`, `/callback`; `POST /auth/complete-profile` |
| Reset | `POST /auth/forgot-password`, `/auth/reset/verify-code`, `/auth/reset/complete` |
| Account | `GET`, `PATCH /me`; `POST /me/password`, `/me/email`, `/me/email/verify`; `GET`, `DELETE /me/sessions`, `DELETE /me/sessions/:id` |
| Structure | `GET`, `POST /courses`; `DELETE /courses/:id`; `GET /courses/:id/semesters`; `GET`, `POST /semesters/:id/units`; `PATCH`, `DELETE /units/:id`; `GET`, `POST /units/:id/sections`; `PATCH`, `DELETE /sections/:id`; `POST /sections/:id/reorder` |
| Resources | `GET`, `POST /resources`; `GET`, `PATCH`, `DELETE /resources/:id`; `/duplicate`, `/favorite`, `/open`, `/restore`, `/permanent`; `POST /resources/suggest`; `DELETE /trash` |
| Files | `POST /uploads`, `GET /files/:id` |
| Other | `GET /notifications`, `POST /notifications/read`, `POST /ai/chat` |

Errors are `{ "error": { "code": "…" } }` with stable codes the interface translates.
State-changing requests must carry this site's Origin.

## Security summary

- Uploads: extension allow-list, signature check on the first bytes, size limit, per-teacher quota;
  served only to their owner with `nosniff`.
- Rate limits on registration, sign-in, codes, reset, upload and AI, counted in the database so all instances share them.
- The client address for rate limiting is the entry our own proxy added to `X-Forwarded-For` (`TRUSTED_PROXY_HOPS`).
- Registrations that never confirm their email are deleted after seven days, national ID included.
- The assistant's sample-reply provider and the log mailer are refused in production.
- National ID: AES-256-GCM with a key derived from `APP_SECRET`; only the last four digits are ever returned.
- Audit log for sign-ins, resets, email and password changes, token reuse and permanent deletions.

## Not done yet

- Facebook sign-in.
- "Delete my account" and data export.
- A script-source Content-Security-Policy (needs nonces and a browser pass).
- Thumbnails from the content of PDF and Office files; video duration; link previews.
- Reading DOCX and PPTX content for the assistant and for classification.
- S3 storage driver; antivirus scanning.
- Offline support; automated browser tests.
- Privacy policy and terms text; social links and contact email (`src/lib/site.ts`).
