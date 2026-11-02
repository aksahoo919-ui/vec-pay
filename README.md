# Value Education Contest 2027 — Registration & Payments

Registration site for the ISKCON ABIDS **Value Education Contest 2027**.
Students (and working people / parents) register, pay the fee through
Razorpay, and admins manage schools, colleges, cities, book distribution and
Google Sheets exports.

Everything runs on **Cloudflare**:

| Part | Where |
|---|---|
| Website (React, built with Vite) | Cloudflare Worker static assets (`dist/`) |
| Server code (`/api/*`) | The same Cloudflare Worker (`worker/`) |
| Database | Cloudflare **D1** (`migrations/`) |
| Payments | Razorpay (order per registration + webhook) |
| Admin login | Username + password, sessions stored in D1 |
| Exports | Google Sheets (one per school + "Others") |

Settings shared by the website and the server (contest name, fee, classes,
languages) live in `shared/config.js`.

---

## One-time setup (Cloudflare dashboard)

You need: a Cloudflare account (free) and the Razorpay dashboard. Google
Cloud is only needed if you use the Google Sheets export.

### 1. Create the database
1. Cloudflare dashboard → **Storage & Databases → D1 SQL Database → Create**.
2. Name it **`vec-pay-db`** and create it.
3. Copy its **Database ID**.
4. In this repo, open `wrangler.jsonc` and replace
   `REPLACE_WITH_YOUR_D1_DATABASE_ID` with that ID. Commit to `main`
   (editing the file on GitHub is fine).

### 2. Create the Worker from GitHub
1. Cloudflare dashboard → **Workers & Pages → Create → Import a repository**.
2. Choose this GitHub repository.
3. Project name: **`vec-pay`** (must match `name` in `wrangler.jsonc`).
4. **Build command:** `npm run build`
5. **Deploy command:** `npm run deploy`
   (this creates/updates the database tables, then deploys)
6. Production branch: `main`. Save and deploy.

Your site will be at `https://vec-pay.<your-subdomain>.workers.dev`
(shown on the Worker's page). Every push to `main` redeploys automatically.

### 3. Add the secrets
Worker → **Settings → Variables and Secrets → Add**. Use type **Secret** for
each one:

| Name | Value |
|---|---|
| `ADMIN_USERNAME` | Username for the main admin (e.g. `owner`) |
| `ADMIN_PASSWORD` | Password for the main admin — long and hard to guess |
| `RAZORPAY_KEY_ID` | Razorpay Key ID (`rzp_live_…` or `rzp_test_…`) |
| `RAZORPAY_KEY_SECRET` | Razorpay Key Secret |
| `RAZORPAY_WEBHOOK_SECRET` | The secret you set on the Razorpay webhook (step 5) |

The webhook **refuses all requests** until `RAZORPAY_WEBHOOK_SECRET` is set.
Forgot the main admin password? Change the `ADMIN_PASSWORD` secret.

### 4. Google Sheets export (optional)
Only needed for the "Create Google Sheet / Export / Sync" buttons. Without
these, everything else works and the CSV export is still available.

| Name | Value |
|---|---|
| `GOOGLE_OAUTH_CLIENT_ID` | Google OAuth client ID (Web application) |
| `GOOGLE_OAUTH_CLIENT_SECRET` | Google OAuth client secret |
| `GOOGLE_OAUTH_REFRESH_TOKEN` | Refresh token of the Google account that owns the Sheets |

The refresh token needs the scopes
`https://www.googleapis.com/auth/spreadsheets` and
`https://www.googleapis.com/auth/drive.file`, the Google Sheets API and
Google Drive API enabled, and the OAuth app **published** (in *Testing* mode
tokens expire after 7 days).

### 5. Point Razorpay at the new address
Razorpay dashboard → **Settings → Webhooks** → add (or edit) a webhook:
- URL: `https://vec-pay.<your-subdomain>.workers.dev/api/razorpay-webhook`
- Secret: same value as `RAZORPAY_WEBHOOK_SECRET`
- Events: `payment.captured`, `payment.failed` (and optionally `order.paid`)

### 6. Test, then retire the old setup
1. Open the site → **Admin** → sign in with `ADMIN_USERNAME` /
   `ADMIN_PASSWORD`. Add more admins (username + password) from the
   **Admin Management** section; the main admin can't be removed there.
2. Add a city and a school.
3. Register on the public page and pay. Within a few seconds the payment
   should appear under **Captured Payments** in the admin panel.
4. Once that works, delete the old Vercel project and Supabase project.

---

## How payments work

1. The form sends the details to `POST /api/register`. The Worker validates
   them, creates a Razorpay order for the fixed fee, and saves the
   registration as **pending** with that order ID. The browser can't write to
   the database or choose the amount.
2. Razorpay checkout opens for that order.
3. Razorpay calls `POST /api/razorpay-webhook` (signature checked). The
   registration with that order ID becomes **captured** or **failed**. A
   success always wins over an earlier failed attempt, and a failure never
   overwrites a success.
4. The admin dashboard picks up new and changed payments every 20 seconds.

---

## Free-plan limits to know

- **Workers:** 100,000 requests/day and 10 ms of CPU time per request.
  Static pages don't count against requests. If a very large Google Sheets
  export ever fails with a CPU-limit error, the Workers Paid plan ($5/month)
  raises the limit.
- **D1:** 5 million rows read and 100,000 rows written per day (resets at
  00:00 UTC / 5:30 AM IST); queries fail for the rest of the day once
  exceeded. The dashboard only fetches changed payments, so normal use stays
  well inside this.
- **D1 never pauses**, unlike Supabase's free plan.

Check Cloudflare's pricing pages for the current numbers.

---

## Local development

```bash
npm install
```

Create a file `.dev.vars` (never committed) with the same names as the
secrets above, then:

```bash
npm run db:migrate:local
```

```bash
npm run preview
```

This builds the site and runs the Worker with a local D1 database at
http://localhost:8787. `npm run dev` runs only the Vite dev server (no API).

`RAZORPAY_API_BASE` can be set in `.dev.vars` to point order creation at a
fake Razorpay server for testing.

## Changing the database

Add a new numbered file to `migrations/` (e.g. `0002_add_column.sql`). It is
applied automatically on the next deploy.
