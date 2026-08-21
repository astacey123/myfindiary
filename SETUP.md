# Financial Diary — going live

This turns the prototype into a real product: people can create an account,
pay £5 through Stripe, and their diary entries are actually saved. Here's
everything to wire up, in order. None of these steps can be done for you —
each one needs your own accounts and identity/bank details.

Rough time: 30–45 minutes. Cost to get started: £0 (all free tiers), then
Stripe only takes its per-transaction fee (1.5% + 20p per UK card payment)
when someone actually pays.

## 1. Create a Supabase project (the database + accounts)

1. Go to [supabase.com](https://supabase.com) and sign up (free).
2. Create a new project. Pick any name/region; save the database password
   somewhere safe (you likely won't need it again for this).
3. Once it's ready, open **SQL Editor** → **New query**, paste in the full
   contents of `supabase-schema.sql` from this folder, and click **Run**.
   This creates the `profiles` and `diary_entries` tables with the security
   rules that keep everyone's data private to them.
4. Go to **Project Settings → API**. You'll need three values from this page
   in later steps:
   - **Project URL**
   - **anon public** key
   - **service_role** key (keep this one secret — never put it in the frontend)
5. Go to **Authentication → Providers → Email** and turn **off** "Confirm
   email" (unless you'd rather people verify their email before paying — the
   app handles either setting, but turning it off makes signup → payment feel
   instant, which matches a quick £5 impulse-signup product).

## 2. Create a Stripe account (taking the £5)

1. Go to [stripe.com](https://stripe.com) and sign up with your business/personal
   details — this is the one part that's genuinely you: your bank details,
   business info, and identity verification.
2. While Stripe is reviewing you, you can build everything else using **test
   mode** (toggle in the Stripe dashboard) — test payments use fake card
   numbers, so you can try the whole flow before you're able to take real money.
3. Go to **Developers → API keys** and copy the **Secret key** (starts `sk_test_`
   in test mode, `sk_live_` once you switch to live mode).
4. You'll register a webhook in step 4, after the site is deployed (Stripe
   needs a real URL to send it to).

## 3. Fill in your config

1. Open `config.js` in this folder and replace the two placeholder values with
   your real Supabase **Project URL** and **anon public** key from step 1.
2. These two values are safe to be visible in the browser — Supabase's
   security rules (not secrecy of this key) are what keep data private.

## 4. Deploy to Vercel

1. Push this folder to a GitHub repository (or use the Vercel CLI to deploy
   directly — `npx vercel` from inside this folder works too).
2. At [vercel.com](https://vercel.com), sign up and import the repository (or
   confirm the CLI deploy).
3. Before the first deploy finishes, go to **Project Settings → Environment
   Variables** and add:
   | Name | Value |
   |---|---|
   | `SUPABASE_URL` | same Project URL as in `config.js` |
   | `SUPABASE_SERVICE_ROLE_KEY` | the **service_role** key from step 1 (secret) |
   | `STRIPE_SECRET_KEY` | the Secret key from step 2 |
   | `STRIPE_WEBHOOK_SECRET` | leave blank for now — you'll add this in step 5 |
4. Deploy. You'll get a URL like `financial-diary.vercel.app`.

## 5. Register the Stripe webhook

This is the step that tells your app when someone's actually paid.

1. In the Stripe dashboard, go to **Developers → Webhooks → Add endpoint**.
2. Endpoint URL: `https://<your-vercel-url>/api/stripe-webhook`
3. Select the event `checkout.session.completed`.
4. Save, then copy the **Signing secret** it gives you (starts `whsec_`).
5. Back in Vercel's Environment Variables, paste that into `STRIPE_WEBHOOK_SECRET`
   and redeploy (Vercel → Deployments → ⋯ → Redeploy) so the function picks it up.

## 6. Test it end to end

1. In Stripe test mode, visit your live URL and sign up with a real-looking
   email and any password.
2. On the Stripe checkout page, use the test card `4242 4242 4242 4242`, any
   future expiry date, any 3-digit CVC, any postcode.
3. You should land back on your site and reach the dashboard within a few
   seconds. Log a diary entry, sign out, log back in — it should still be there.
4. In Supabase, open **Table Editor → profiles** and confirm your test user's
   `has_paid` is `true`.
5. When you're happy, switch Stripe out of test mode, swap `STRIPE_SECRET_KEY`
   for your live secret key, and register a second webhook endpoint (same URL)
   for live mode with its own signing secret.

## 7. Optional: a custom domain

In Vercel, **Project Settings → Domains** lets you attach a domain you buy
from any registrar (Namecheap, Cloudflare, etc. — roughly £8–12/year for a
`.com`). Point its DNS at Vercel following the instructions Vercel shows you,
and update the Stripe webhook URL to match once it's live.

## What still isn't handled

This covers accounts, payment-gating, and saving your diary entries — the
core of "real product." A few things worth knowing are still simplified or
missing, roughly in order of how soon you'd likely want them:

- **No password reset flow.** Supabase Auth supports it, but the UI for it
  isn't built here yet.
- **No refund handling.** If you refund someone in Stripe, their `has_paid`
  flag stays `true` — you'd want a webhook handler for refund events too.
- **Calculator inputs aren't saved per-user** — only diary log entries are.
  Each tab still resets to its defaults on login; only what you explicitly
  log is remembered.
- **No terms of service / privacy policy** — worth having before charging
  real people, especially since you're storing personal financial figures.
