// CORS for the Edge Functions: only the site itself (and local development)
// may call them from a browser. Requests from any other website's origin are
// refused outright. Server-to-server calls (pg_cron, curl) send no Origin
// header; they're allowed here but still need the cron secret or a sign-in.
const DEFAULT_ORIGINS = ['https://giftingsmart.shop', 'http://localhost:5173', 'http://localhost:5174'];

function allowedOrigins(): string[] {
  const fromEnv = Deno.env.get('ALLOWED_ORIGINS');
  return fromEnv ? fromEnv.split(',').map((s) => s.trim()).filter(Boolean) : DEFAULT_ORIGINS;
}

export function originAllowed(req: Request): boolean {
  const origin = req.headers.get('Origin');
  return !origin || allowedOrigins().includes(origin);
}

export function corsHeaders(req: Request): Record<string, string> {
  const headers: Record<string, string> = {
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    Vary: 'Origin',
  };
  const origin = req.headers.get('Origin');
  if (origin && allowedOrigins().includes(origin)) headers['Access-Control-Allow-Origin'] = origin;
  return headers;
}
