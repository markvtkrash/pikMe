# Password reset (emailed 6-digit code) — VPS and Amazon SES setup

The apps call `resetPasswordForEmail`, `verifyOtp({ type: 'recovery' })` and `updateUser({ password })`. For the email to carry a **code** (not a link), the self-hosted Supabase Auth (GoTrue) needs SMTP and a changed Reset-password template. No database migration and no edge function is involved.

## 1. Amazon SES

1. SES → Verified identities → create a **domain** identity for your sending domain (for example `pikme.app`). Add the three DKIM CNAME records it shows.
2. DNS: SPF `TXT` on the domain (`v=spf1 include:amazonses.com ~all`; merge with any existing SPF record), and DMARC `TXT` at `_dmarc.<domain>` (start with `v=DMARC1; p=none; rua=mailto:you@<domain>`, tighten to `quarantine` later).
3. Optional but recommended: a custom MAIL FROM subdomain (`mail.<domain>`) so SPF aligns.
4. **Request production access** (SES → Account dashboard). In the sandbox SES only delivers to verified addresses, so real customers would get nothing.
5. SES → SMTP settings → **Create SMTP credentials**. These are separate from your AWS access keys. Note the SMTP username and password, and the endpoint for your region (for example `email-smtp.us-east-1.amazonaws.com`).
6. Bounces and complaints: SES → Configuration sets → add an SNS destination for Bounce and Complaint events and subscribe an address you read. Keep the bounce rate under about 5% and complaints under 0.1%, or SES can pause sending.

## 2. VPS environment (the auth container)

Add to the `auth` service environment (your `.env` / docker compose), using your own values:

```
GOTRUE_SMTP_HOST=email-smtp.us-east-1.amazonaws.com
GOTRUE_SMTP_PORT=587
GOTRUE_SMTP_USER=<SES SMTP username>
GOTRUE_SMTP_PASS=<SES SMTP password>
GOTRUE_SMTP_ADMIN_EMAIL=no-reply@<your domain>
GOTRUE_SMTP_SENDER_NAME=pikMe
GOTRUE_MAILER_OTP_EXP=600
GOTRUE_MAILER_SUBJECTS_RECOVERY=Your pikMe password reset code
GOTRUE_MAILER_TEMPLATES_RECOVERY=<URL the auth container can fetch, see section 3>
```

With the standard Supabase docker compose the same settings are named `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`, `SMTP_ADMIN_EMAIL`, `SMTP_SENDER_NAME` in `.env`. `SMTP_ADMIN_EMAIL` must be an address on the verified SES domain.

Notes:
- Port 587 uses STARTTLS (what GoTrue expects); port 465 is implicit TLS. Use 587.
- `MAILER_OTP_EXP` is seconds; 600 gives the code 10 minutes.
- Rate limits: GoTrue allows one recovery email per address per 60 seconds (`GOTRUE_SMTP_MAX_FREQUENCY`, default `1m0s`), matching the 60-second resend timer in the apps. The apps also show a clear message if the limit is hit.
- Make sure the mailer is on: `GOTRUE_MAILER_AUTOCONFIRM=false` for customers if you want email confirmation (see section 5), and `GOTRUE_EXTERNAL_EMAIL_ENABLED=true`.
- Restart the auth container after changing these (`docker compose up -d auth`).

## 3. Reset-password email template (shows the code)

GoTrue reads the template from a file URL it can fetch. Save this as `recovery.html`, serve it from somewhere the auth container can reach (for example the Kong/nginx static path, or an internal URL), and point `GOTRUE_MAILER_TEMPLATES_RECOVERY` at it:

```html
<h2>Reset your password</h2>
<p>Use this code to reset your pikMe password:</p>
<p style="font-size:28px;font-weight:700;letter-spacing:6px;">{{ .Token }}</p>
<p>The code expires in 10 minutes. If you did not ask for it, you can ignore this email; your password will not change.</p>
```

`{{ .Token }}` is the 6-digit code. Do not use `{{ .ConfirmationURL }}`; the apps do not use links.

## 4. Test it

1. Create or pick a test account whose email you can read (SES production access must be on, or the address must be verified in the sandbox).
2. Customer app (or the owner site): Sign in → **Forgot password?** → enter the email → **Send Code**.
3. Check the inbox (and spam) for the code, enter it with a new password.
4. Try a wrong code (expect "That code is wrong or has expired"), an expired code (wait over 10 minutes), and **Resend code** (disabled for 60 seconds).
5. An email with no account shows the same "If that email has an account..." message, with no email sent.
6. If nothing arrives: `docker compose logs auth --tail 100` shows SMTP errors (authentication failed = wrong SMTP credentials, "not verified" = SES sandbox or sender not on the verified domain).

## 5. Open decision: email confirmation for customer self-sign-up

Today customers can sign up with any address, and the apps do not require the address to be confirmed. That is why a typo'd or someone else's address can exist as an account. Password reset sends the code to whatever address is on the account, so a mistyped address means that customer cannot recover the account.

Options:
- **Require confirmation** (`GOTRUE_MAILER_AUTOCONFIRM=false` plus a Confirm-signup template that shows `{{ .Token }}`, and a code-entry step at sign-up). Cleanest, but changes the customer sign-up flow and needs a new app build.
- **Leave as is** and rely on password reset only reaching working addresses. Customers who mistyped their email on sign-up are locked out of recovery.

Owners are created by an admin with `email_confirm: true`, so their addresses are treated as confirmed.

## 6. Accounts with invalid or placeholder emails

Run in the SQL editor to list accounts that cannot receive a reset code:

```sql
SELECT id, email, created_at, last_sign_in_at
FROM auth.users
WHERE email IS NULL
   OR email !~* '^[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}$'
   OR email ~* '@(example\.(com|org|net)|test\.com|localhost|invalid)$'
   OR email ~* '^(test|fake|sim|dummy)[^@]*@'
ORDER BY created_at DESC;
```

Review the list before acting; it is a screening query, not proof. Typical follow-ups: ask the owner for a real address, or remove simulation accounts with the admin Manage users / Manage owners screens.

## 7. What to deploy

- **VPS:** SES setup, the env lines above, the recovery template, restart the auth container.
- **Apps:** owner site (new Forgot password page, login link, route guard) and the customer app (new Forgot password screen, sign-in link, layout guard).
- **Customer app:** the screens are JavaScript only, so an OTA update (expo-updates) delivers them, but it is not in the App Store yet; it ships with the first store build.
- **Migrations / edge functions:** none.
