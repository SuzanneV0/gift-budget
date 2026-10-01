// Vercel build step: writes config.js from the environment variables added by
// the Vercel Supabase integration. Only the project URL and the publishable
// (anon) key are used. Both are public by design; never put the service role
// or secret key here, since config.js is served to every visitor.
// With no variables set (local dev, previews), config.js is left alone and
// the app runs in demo mode.
import { writeFileSync } from 'node:fs';

const env = process.env;
const url = env.SUPABASE_URL || env.NEXT_PUBLIC_SUPABASE_URL || '';
const key =
  env.SUPABASE_PUBLISHABLE_KEY ||
  env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ||
  env.SUPABASE_ANON_KEY ||
  env.NEXT_PUBLIC_SUPABASE_ANON_KEY ||
  '';

if (!url || !key) {
  console.log('write-config: Supabase variables not set, keeping demo-mode config.js');
  process.exit(0);
}
if (!/^https:\/\/[a-z0-9-]+\.supabase\.co$/.test(url)) {
  console.error(`write-config: unexpected SUPABASE_URL "${url}"`);
  process.exit(1);
}
if (key.startsWith('sb_secret_') || /service_role/.test(Buffer.from(key.split('.')[1] ?? '', 'base64').toString())) {
  console.error('write-config: refusing to publish a secret / service role key');
  process.exit(1);
}

writeFileSync(
  'config.js',
  `// Generated at build time by scripts/write-config.mjs. Do not edit.\n` +
    `window.GIFT_CONFIG = ${JSON.stringify({ supabaseUrl: url, supabaseAnonKey: key }, null, 2)};\n`,
);
console.log(`write-config: connected to ${url}`);
