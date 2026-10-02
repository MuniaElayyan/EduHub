# EduHub

A teacher's personal workspace ("Teacher Operating System"): subjects, classes, semesters, units,
teaching resources, search, and an AI assistant that knows where the teacher is working.
Arabic and English (RTL/LTR), light and dark themes, phone-first.

The only kind of user is the teacher. There is no school administration in this product.

## Run it locally

Needs Node.js 20.11 or newer, nothing else. Without `DATABASE_URL` an embedded PostgreSQL is created
in `./.data/pg` and migrations (including the 39 subjects and the default section types) run on start.

```bash
npm install
npm run dev            # http://localhost:3000
```

Verification codes are real codes produced by the same code path as production. In development,
with no email provider configured, the email is printed in the terminal where `npm run dev` runs;
nothing is ever shown on the web page. To receive them in an inbox, set `EMAIL_PROVIDER`,
`EMAIL_API_KEY` and `EMAIL_FROM` in `.env.local` (see `.env.example`).

The AI assistant answers with a labelled sample reply until `AI_PROVIDER=anthropic` and
`ANTHROPIC_API_KEY` are set. The Google button appears once `GOOGLE_CLIENT_ID` and
`GOOGLE_CLIENT_SECRET` are set.

## Production

The server refuses to start in production unless these are set: `APP_SECRET` (32+ characters),
`DATABASE_URL`, `APP_URL` (https), and a real `EMAIL_PROVIDER` with its key and `EMAIL_FROM`.

- **Vercel:** see `docs/DEPLOY-VERCEL.md`. Migrations run in the build; files go to a private Vercel Blob store.
- **Render:** `render.yaml` describes the web service, the database and a disk for uploads.
- **Docker:** `docker build -t eduhub . && docker run -p 3000:3000 --env-file .env -v eduhub-files:/var/data eduhub`
- **Email:** verify your sending domain with the provider (SPF and DKIM) or codes will land in spam.
- **Google:** register `<APP_URL>/api/v1/auth/oauth/google/callback` as the authorised redirect URI.

## Scripts

| Command | What it does |
| --- | --- |
| `npm run dev` | Development server |
| `npm run build` / `npm start` | Production build and server |
| `npm run typecheck` | TypeScript check |
| `npm run check:i18n` | Both languages have the same keys; every key used in code exists |
| `npm run db:generate` | Create a migration after editing `src/server/db/schema.ts` |
| `npm run db:migrate` | Apply migrations to the PostgreSQL in `DATABASE_URL` |
| `npm run test:smoke` | End-to-end test against a running server |

### End-to-end test

```bash
npm run build
EDUHUB_TEST_MODE=1 SESSION_ROTATE_SECONDS=3 SESSION_ROTATION_GRACE_SECONDS=1 \
  GOOGLE_CLIENT_ID=test-client GOOGLE_CLIENT_SECRET=test-secret GOOGLE_TOKEN_URL=http://localhost:3101/token \
  APP_URL=http://localhost:3100 npx next start -p 3100 > server.log 2>&1 &
BASE=http://localhost:3100 SMOKE_LOG=server.log npm run test:smoke
```

`EDUHUB_TEST_MODE=1` lets a production build use the embedded database and the log mailer so the test
can read the emailed codes, and lets the test play Google's token endpoint. Never set it on a real
deployment: without it, production accepts only a real email provider and Google's own endpoints.

The test reads the route list from `src/server/api.ts` and checks that every route outside a short
public list answers 401 to a visitor, so a route added later is covered automatically.

## Where things are

```
drizzle/              SQL migrations: schema, then reference data (subjects, section types)
messages/             ar.json, en.json: all interface text
src/app/              landing, auth pages, workspace (/app), REST mount (/api/v1)
src/components/       interface components
src/lib/              shared by browser and server: i18n, formatting, link detection
src/server/api.ts     the REST API
src/server/auth.ts    passwords, sessions with rotation, email codes, national-ID encryption
src/server/email.ts   email service: resend, sendgrid, postmark, ses, and the development log mailer
src/server/oauth.ts   Google sign-in
src/server/services/  courses (classes, semesters, units, sections), resources, classify, ai
docs/                 PRD.md, ARCHITECTURE.md
```
