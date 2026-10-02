// check-prices: records a new price for tracked gifts and raises sale alerts.
//
// Called two ways:
//   - by pg_cron every 6 hours, with header x-cron-secret (from Vault), body {"scope":"all"}
//   - by a signed-in user from the app, body {"event_id"?: uuid, "gift_id"?: uuid}
//     (only that user's gifts are checked)
import { createClient } from 'npm:@supabase/supabase-js@2.117.2';
import { corsHeaders, originAllowed } from '../_shared/cors.ts';
import { detectAlert } from '../_shared/pricing.js';
import { getProvider } from './providers/index.ts';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MAX_GIFTS_PER_RUN = 500;
// User-triggered checks per account (the cron run isn't limited). Keeps costs
// bounded once a paid price API is connected.
const RATE_LIMIT = 20;
const RATE_WINDOW = '10 minutes';

Deno.serve(async (req) => {
  const cors = corsHeaders(req);
  const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } });

  if (!originAllowed(req)) return json({ error: 'origin not allowed' }, 403);
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  if (req.method !== 'POST') return json({ error: 'method not allowed' }, 405);

  const admin = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    { auth: { persistSession: false } },
  );

  const body = await req.json().catch(() => ({}));
  // The cron job sends a secret from Vault; the database checks it.
  const cronSecret = req.headers.get('x-cron-secret');
  let isCron = false;
  if (cronSecret) {
    const { data } = await admin.rpc('verify_cron_secret', { candidate: cronSecret });
    if (data !== true) return json({ error: 'unauthorized' }, 401);
    isCron = true;
  }

  let userId: string | null = null;
  if (!isCron) {
    const jwt = (req.headers.get('Authorization') ?? '').replace(/^Bearer\s+/i, '');
    const { data, error } = await admin.auth.getUser(jwt);
    if (error || !data.user) return json({ error: 'unauthorized' }, 401);
    userId = data.user.id;

    const { data: allowed, error: limitError } = await admin.rpc('consume_price_check', {
      p_user: userId,
      p_limit: RATE_LIMIT,
      p_window: RATE_WINDOW,
    });
    if (limitError) {
      console.error('rate limit check failed', limitError);
      return json({ error: 'try again later' }, 503);
    }
    if (allowed !== true) {
      return json({ error: 'rate_limited', message: 'Too many price checks. Please try again in a few minutes.' }, 429);
    }
  }

  let query = admin
    .from('gifts')
    .select('id, user_id, event_id, name, url, current_price, target_price')
    .eq('track_price', true)
    .eq('status', 'wanted')
    .order('last_checked_at', { ascending: true, nullsFirst: true })
    .limit(MAX_GIFTS_PER_RUN);
  if (userId) query = query.eq('user_id', userId);
  if (typeof body.event_id === 'string' && UUID.test(body.event_id)) query = query.eq('event_id', body.event_id);
  if (typeof body.gift_id === 'string' && UUID.test(body.gift_id)) query = query.eq('id', body.gift_id);

  const { data: gifts, error } = await query;
  if (error) {
    console.error('gift query failed', error);
    return json({ error: 'internal error' }, 500);
  }
  if (!gifts?.length) return json({ checked: 0, alerts: 0 });

  const { data: historyRows, error: histError } = await admin
    .from('price_history')
    .select('gift_id, price, checked_at')
    .in('gift_id', gifts.map((g) => g.id))
    .order('checked_at', { ascending: true });
  if (histError) {
    console.error('price history query failed', histError);
    return json({ error: 'internal error' }, 500);
  }

  const historyByGift = new Map<string, { price: number; checked_at: string }[]>();
  for (const row of historyRows ?? []) {
    const list = historyByGift.get(row.gift_id) ?? [];
    list.push(row);
    historyByGift.set(row.gift_id, list);
  }

  const provider = getProvider();
  const now = new Date();
  let checked = 0;
  let alerts = 0;

  for (const gift of gifts) {
    const history = historyByGift.get(gift.id) ?? [];
    let result;
    try {
      result = await provider.getPrice({
        id: gift.id,
        name: gift.name,
        url: gift.url,
        current_price: gift.current_price,
        base_price: history[0]?.price ?? gift.current_price,
      });
    } catch (e) {
      console.error(`price lookup failed for ${gift.id}:`, e);
      continue;
    }
    if (!result) continue;

    const alert = detectAlert(gift, history, result.price, now.getTime());

    await admin.from('price_history').insert({
      user_id: gift.user_id,
      gift_id: gift.id,
      price: result.price,
      source: result.source,
      checked_at: now.toISOString(),
    });
    await admin
      .from('gifts')
      .update({ current_price: result.price, last_checked_at: now.toISOString() })
      .eq('id', gift.id);
    if (alert) {
      await admin.from('notifications').insert({
        user_id: gift.user_id,
        gift_id: gift.id,
        event_id: gift.event_id,
        kind: alert.kind,
        message: alert.message,
      });
      alerts++;
    }
    checked++;
  }

  return json({ checked, alerts, provider: provider.name });
});
