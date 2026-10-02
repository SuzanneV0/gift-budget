// delete-account: permanently deletes the signed-in user's account.
// Every table references auth.users with ON DELETE CASCADE, so removing the
// auth user also removes their events, people, gifts, price history and alerts.
import { createClient } from 'npm:@supabase/supabase-js@2';
import { corsHeaders, originAllowed } from '../_shared/cors.ts';

Deno.serve(async (req) => {
  const cors = corsHeaders(req);
  const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } });

  if (!originAllowed(req)) return json({ error: 'origin not allowed' }, 403);
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  if (req.method !== 'POST') return json({ error: 'method not allowed' }, 405);

  const body = await req.json().catch(() => ({}));
  if (body.confirm !== true) return json({ error: 'confirmation required' }, 400);

  const admin = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    { auth: { persistSession: false } },
  );

  // Only ever deletes the account the caller is signed in as.
  const jwt = (req.headers.get('Authorization') ?? '').replace(/^Bearer\s+/i, '');
  const { data, error } = await admin.auth.getUser(jwt);
  if (error || !data.user) return json({ error: 'unauthorized' }, 401);

  const { error: delError } = await admin.auth.admin.deleteUser(data.user.id);
  if (delError) {
    console.error('delete failed', delError);
    return json({ error: 'could not delete account' }, 500);
  }
  return json({ deleted: true });
});
