# Putting ReviewFlow live

This takes you from the code on your machine to a working site on the internet.
Do the steps in order; each one says how to tell it worked.

You will create four free accounts. Keep a note open as you go: several steps
give you a value you need again later.

## What you need before starting

- **A domain name** you control (for example `reviewflow.yourname.com`). It is
  used for the site and for sending email. Email will not work without one.
- **The code on GitHub**, in a private repository.
- About an hour, most of it waiting for DNS.

## 1. Database: Neon

1. Create a project at [neon.tech](https://neon.tech). Choose the region
   closest to your users.
2. On the project dashboard, open **Connection string**. Copy two versions:
   - with **Pooled connection** on — this is `DATABASE_URL` for the running site
   - with it off — the **direct** string, which is `DIRECT_DATABASE_URL`, used
     for database changes at deploy time and for setup in step 6
3. Turn on backups: **Settings → Backup & restore**. The free plan keeps a
   short history; a paid plan keeps longer.

_Worked if:_ you have two strings starting `postgresql://`.

## 2. File storage: Cloudflare R2

1. In the [Cloudflare dashboard](https://dash.cloudflare.com), open **R2** and
   create a bucket, for example `reviewflow-documents`. Leave it **private**.
2. **R2 → Manage API tokens → Create token**. Give it **Object Read & Write**
   on that one bucket. Copy the **Access Key ID** and **Secret Access Key** —
   the secret is shown only once.
3. Note your **account endpoint**, shown on the R2 overview page:
   `https://<account-id>.r2.cloudflarestorage.com`.
4. Open the bucket's **Settings → CORS policy** and paste this, with your real
   site address in place of the example:

   ```json
   [
     {
       "AllowedOrigins": ["https://reviewflow.yourname.com"],
       "AllowedMethods": ["GET", "PUT", "HEAD"],
       "AllowedHeaders": ["Content-Type"],
       "MaxAgeSeconds": 3600
     }
   ]
   ```

   Without this, uploads fail in the browser with no useful message. This is
   the step most likely to be missed.

_Worked if:_ you have an endpoint, a bucket name, a key ID and a secret.

## 3. Email: Resend

1. Create an account at [resend.com](https://resend.com) and open **Domains →
   Add domain**. Use a subdomain such as `mail.yourname.com`.
2. Resend shows several DNS records. Add each one at your domain registrar,
   exactly as shown.
3. Wait until Resend marks the domain **Verified** (minutes to a few hours).
4. **API Keys → Create API key**, with sending access. Copy it.

_Worked if:_ the domain says Verified and you have a key starting `re_`.

## 4. Two secrets

Run this twice and keep both results:

```bash
openssl rand -base64 32
```

One is `SESSION_SECRET`, the other `CRON_SECRET`. The site refuses to start in
production with the placeholder values from `.env.example`.

## 5. Hosting: Vercel

1. At [vercel.com](https://vercel.com), **Add New → Project** and import the
   GitHub repository.
2. Under **Build & Development Settings**, set the **Build Command** to:

   ```
   pnpm db:deploy && pnpm build
   ```

   This applies any new database changes each time you deploy.

3. Under **Environment Variables**, add every row of this table:

   | Name                        | Value                                                          |
   | --------------------------- | -------------------------------------------------------------- |
   | `APP_URL`                   | `https://reviewflow.yourname.com` (https, no slash at the end) |
   | `APP_NAME`                  | `ReviewFlow`                                                   |
   | `DATABASE_URL`              | the **pooled** Neon string from step 1                         |
   | `DIRECT_DATABASE_URL`       | the **direct** Neon string from step 1                         |
   | `SESSION_SECRET`            | the first secret from step 4                                   |
   | `SESSION_TTL_DAYS`          | `30`                                                           |
   | `STORAGE_ENDPOINT`          | the R2 account endpoint from step 2                            |
   | `STORAGE_REGION`            | `auto`                                                         |
   | `STORAGE_BUCKET`            | your bucket name                                               |
   | `STORAGE_ACCESS_KEY_ID`     | from step 2                                                    |
   | `STORAGE_SECRET_ACCESS_KEY` | from step 2                                                    |
   | `STORAGE_FORCE_PATH_STYLE`  | `true`                                                         |
   | `EMAIL_PROVIDER`            | `resend`                                                       |
   | `EMAIL_FROM`                | `ReviewFlow <noreply@mail.yourname.com>`                       |
   | `RESEND_API_KEY`            | from step 3                                                    |
   | `CRON_SECRET`               | the second secret from step 4                                  |

4. Deploy. Then under **Settings → Domains**, add your domain and create the
   DNS record Vercel shows you.

The daily maintenance job (reminders, email retries, clean-up) is already
configured in `vercel.json` and needs nothing from you beyond `CRON_SECRET`.
You can see its runs under **Settings → Cron Jobs**.

_Worked if:_ your domain shows the ReviewFlow landing page over https.

## 6. Reference data and your administrator account

The site is running but empty: no document types, and nobody can sign in as an
administrator. Do this once, from your own machine, in the project folder.

Use the **direct** Neon string from step 1 here, not the pooled one.

```bash
# macOS / Linux / Git Bash
export DATABASE_URL="postgresql://...direct string..."
export APP_URL="https://reviewflow.yourname.com"

pnpm db:seed:reference
pnpm admin:create --email you@example.com --name "Your Name"
```

The first command adds the eleven document types and their review templates.
It creates no accounts. **Never run plain `pnpm db:seed` against production**:
it creates accounts whose password is published in the code. (It refuses to,
but do not rely on that.)

The second prints a link. Open it, choose a password, and you are the
administrator. The link works once and expires in three days.

Close that terminal afterwards so the production database string is not left in
your shell.

_Worked if:_ you can sign in at your domain and see the Submissions page.

## 7. Check it end to end

Do the whole journey once on the live site before telling anyone about it.

1. From **Invitations**, invite a reviewer using a second email address of
   yours. **The email must actually arrive** — this is the first time real
   email has been sent, so check spam too. Accept the invitation.
2. In a private window, register as an author with a third address. Confirm
   the verification email arrives, then sign in.
3. As the author, submit a Word document with a deadline. The upload is the
   test of step 2's CORS policy.
4. As the administrator, assign it to your reviewer.
5. As the reviewer, accept, open the preview, fill in the review, and upload a
   Word file with a tracked change and a comment made under your real name.
6. As the administrator, send it back once with a note, then approve the
   resubmitted review.
7. As the author, open the review and download the annotated file. Open it in
   Word and check **File → Info** and the tracked changes: every author should
   read "Reviewer". Your name must not appear anywhere.
8. Under **Activity**, confirm the whole chain is recorded with real names.

If step 1 or 2 fails, the problem is Resend (domain not verified, or
`EMAIL_FROM` not on that domain). If step 3 fails, it is the CORS policy.

## Afterwards

- **Deploying changes:** push to GitHub; Vercel builds and applies migrations.
- **Adding people:** authors register themselves. Reviewers and administrators
  are invited from **Invitations**.
- **Someone leaves:** suspend them under **People**. Reassign any reviews they
  hold first.
- **Failed email:** rows in the `EmailLog` table with status `FAILED` show what
  the provider said. They are retried by the daily job, up to five times.
- **Reminders run once a day.** That is the limit on Vercel's free plan; a paid
  plan lets you change the schedule in `vercel.json`.
- **Write a privacy notice.** You are holding people's personal statements and
  CVs. Say what you store, who can see it, and how to have it deleted, and link
  it from the site before inviting the public.

## If something goes wrong

| What you see                                     | Likely cause                                                                   |
| ------------------------------------------------ | ------------------------------------------------------------------------------ |
| Build fails: "Invalid environment configuration" | A variable from step 5 is missing or still a placeholder; the message names it |
| Upload spins and fails                           | R2 CORS policy missing, or `AllowedOrigins` is not your exact address          |
| No email arrives                                 | Resend domain not verified, or `EMAIL_FROM` uses a different domain            |
| Signed in, then signed straight out              | `APP_URL` is `http://` or does not match the address in the browser            |
| Preview is blank but download works              | CORS policy lacks `GET`                                                        |
| "Something went wrong on our side"               | Check **Logs** in Vercel; the reference on the page matches a log line         |
