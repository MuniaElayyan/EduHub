# Deploying to Vercel

The build command in `vercel.json` is `npm run db:migrate && npm run build`: every production deploy
applies pending migrations (schema, the 39 subjects, the default section types) before building.
A production build fails with a clear message if there is no database, instead of going live broken.

## What Vercel needs

| Variable | Required | Where it comes from |
| --- | --- | --- |
| `APP_SECRET` | yes | You generate it: 32+ random characters. Keep a copy; losing it makes stored national IDs unreadable. |
| `DATABASE_URL` | yes | Added by the database integration (pooled address). `POSTGRES_URL` is accepted too. |
| `DATABASE_URL_UNPOOLED` | no | Added by Neon's integration; migrations use it when present. |
| `EMAIL_PROVIDER` | yes | `resend`, `sendgrid`, `postmark` or `ses`. |
| `EMAIL_API_KEY` | yes (not for `ses`) | From the email provider. |
| `EMAIL_FROM` | yes | `EduHub <no-reply@your-verified-domain>`. |
| `BLOB_READ_WRITE_TOKEN` | for uploads | Added by Vercel when a private Blob store is created and connected. |
| `APP_URL` | no | Only to override the address. By default the production domain Vercel reports is used. |
| `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` | no | Google sign-in. The button stays hidden without them. |
| `AI_PROVIDER=anthropic`, `ANTHROPIC_API_KEY`, `AI_MODEL` | no | The assistant shows "not switched on" without them. |

Never set `EDUHUB_TEST_MODE` on Vercel.

## Steps

1. **Database.** Project → Storage → Create Database → Neon (Postgres). Connect it to this project for
   Production (and Preview if you want previews to work). This adds `DATABASE_URL` and `DATABASE_URL_UNPOOLED`.
2. **File storage.** Project → Storage → Create → Blob → access **Private** → connect to this project.
   This adds `BLOB_READ_WRITE_TOKEN`.
3. **Email.** Create the provider account, verify your sending domain (SPF and DKIM records), create an API key,
   then add `EMAIL_PROVIDER`, `EMAIL_API_KEY` and `EMAIL_FROM` under Settings → Environment Variables (Production).
4. **Deploy.** Push to the connected branch, or Redeploy. Environment variables are read at deploy time, so a
   redeploy is needed after changing them.
5. **Check.** `https://<your-domain>/api/v1/health` answers `{"ok":true}`. Register, then use "Forgot your password?"
   with a real address and confirm the six-digit code arrives.

## How the app behaves on Vercel

- **Uploads** go straight from the browser to the Blob store with a short-lived token, so they are not bound by the
  4.5 MB request limit of Vercel Functions. Downloads are streamed through `/api/v1/files/:id`, which checks the owner.
- **Rate limits** are counted in the database (`rate_limits`), because each function instance has its own memory.
- **Emails sent after the reply** (reset codes, notices) are handed to the platform with `after()`, so they are not
  lost when the function is frozen.
- **Database connections:** each instance keeps a small pool (3). Keep `DATABASE_URL` on the pooled address.
