// check-prices: records a new price for tracked gifts and raises sale alerts.
//
// Called two ways:
//   - by pg_cron every 6 hours, with header x-cron-secret, body {"scope":"all"}
//   - by a signed-in user from the app, body {"event_id"?: uuid, "gift_id"?: uuid}
//     (only that user's gifts are checked)
import { createClient } from 'npm:@supabase/supabase-js@2';
import { detectAlert } from '../_shared/pricing.js';
import { getProvider } from './providers/index.ts';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MAX_GIFTS_PER_RUN = 500;

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, 'Content-Type': 'application/json' },
  });
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  if (req.method !== 'POST') return json({ error: 'method not allowed' }, 405);

  const admin = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    { auth: { persistSession: false } },
  );

  const body = await req.json().catch(() => ({}));
  const cronSecret = Deno.env.get('CRON_SECRET');
  const isCron = !!cronSecret && req.headers.get('x-cron-secret') === cronSecret;

  let userId: string | null = null;
  if (!isCron) {
    const jwt = (req.headers.get('Authorization') ?? '').replace(/^Bearer\s+/i, '');
    const { data, error } = await admin.auth.getUser(jwt);
    if (error || !data.user) return json({ error: 'unauthorized' }, 401);
    userId = data.user.id;
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
  if (error) return json({ error: error.message }, 500);
  if (!gifts?.length) return json({ checked: 0, alerts: 0 });

  const { data: historyRows, error: histError } = await admin
    .from('price_history')
    .select('gift_id, price, checked_at')
    .in('gift_id', gifts.map((g) => g.id))
    .order('checked_at', { ascending: true });
  if (histError) return json({ error: histError.message }, 500);

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
