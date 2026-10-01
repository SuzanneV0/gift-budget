# Gift Budget

Keep gift-giving on budget for any occasion: birthdays, holidays, baby showers, housewarmings.

- Create an event (e.g. "Lauren's birthday", "Christmas 2026", "Jane's baby shower")
- Set **one budget for the whole event**, or **a budget per person**
- Build a shopping list. Gift prices are tracked over time, and you get an alert when something goes on sale or reaches your target price
- Mark gifts as bought with the amount you actually spent
- A progress bar at the top of each event shows spent / still on the list / budget
- Warnings before a purchase takes you near (90%) or over budget, and when your whole list would go over

Plain HTML/CSS/JS with no build step, plus [Supabase](https://supabase.com) for Google sign-in, the database and the scheduled price checker. Hosts on Vercel like Medsprout.

## Run it locally

```bash
python -m http.server 5173
```

Open http://localhost:5173. With `config.js` left empty, the app runs in **demo mode**: "Continue with Google" signs you in as a demo user, data stays in your browser, and a sample Christmas event is created. "Check prices now" moves a simulated clock forward six hours so you can watch prices move and sale alerts appear.

## Project layout

| Path | What it is |
| --- | --- |
| `index.html`, `styles.css`, `icon.svg` | Page shell and styles (light and dark) |
| `config.js` | Supabase URL and anon key (both public) |
| `js/app.js` | Router and pages: home, log in, my account, my events, new event, event |
| `js/store.js` | Data layer: `SupabaseStore` (real) and `LocalStore` (demo) |
| `js/budget.js` | Budget maths and over-budget warnings |
| `supabase/migrations/` | Tables with row-level security, plus the 6-hourly cron job |
| `supabase/functions/check-prices/` | Edge Function that records prices and creates sale alerts |
| `supabase/functions/_shared/pricing.js` | Sale detection and the mock price provider (shared by server and browser) |

## Connect Supabase and Google sign-in

1. **Create a Supabase project** at https://supabase.com/dashboard.
2. **Google OAuth client**: in [Google Cloud Console](https://console.cloud.google.com/apis/credentials), create an OAuth client ID (type "Web application").
   - Authorized redirect URI: `https://<project-ref>.supabase.co/auth/v1/callback`
   - Configure the OAuth consent screen (app name, support email).
3. In Supabase, go to **Authentication → Sign In / Providers → Google**, enable it, and paste the client ID and secret.
4. In **Authentication → URL Configuration**, set the Site URL to your production URL and add `http://localhost:5173` to the redirect URLs.
5. **Database**: link the project and push the migrations:
   ```bash
   supabase link --project-ref <project-ref>
   supabase db push
   ```
   Before pushing, add two Vault secrets (Dashboard → Project Settings → Vault) that the cron job reads: `project_url` (`https://<project-ref>.supabase.co`) and `cron_secret` (any long random string).
6. **Price checker**:
   ```bash
   supabase secrets set CRON_SECRET=<the same random string> PRICE_PROVIDER=mock
   supabase functions deploy check-prices
   ```
7. Put the project URL and **anon/publishable key** (Project Settings → API) in `config.js`.

## Plugging in a real price API

Prices come from `PRICE_PROVIDER` (default `mock`, which simulates realistic prices and sales). To use a real source such as Keepa (Amazon), SerpApi (Google Shopping) or Rainforest:

1. Add `supabase/functions/check-prices/providers/<name>.ts` that implements `PriceProvider.getPrice(gift)`, using `gift.url` and/or `gift.name` and returning `{ price, source }` (or `null` if not found).
2. Register it in `providers/index.ts`.
3. `supabase secrets set PRICE_PROVIDER=<name> <NAME>_API_KEY=...` and redeploy the function.

Sale rules live in `_shared/pricing.js`: an alert fires when the price drops at least 5% from the last check **and** is the lowest in 30 days, or when it crosses your target price.

## Deploy

Import the repo in Vercel (no build command, output directory = repo root). `vercel.json` sets security headers; `.vercelignore` keeps migrations and server code out of the static site. Add the production URL to Supabase's redirect URLs.

## Notes and next steps

- Alerts appear in the app (bell icon) and, if enabled under My account, as browser notifications while the app is open. Email or push alerts would be a natural next step (e.g. sending from the Edge Function).
- Prices are checked every 6 hours and may not match the store at checkout.
