// Vercel build: copies the static site into dist/ and writes dist/config.js
// from the environment variables added by the Vercel Supabase integration.
// Only the project URL and the publishable (anon) key are used. Both are
// public by design; never put the service role or secret key here, since
// config.js is served to every visitor. Without the variables (previews,
// local builds), the repo's demo-mode config.js is used as is.
import { cpSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';

const OUT = 'dist';
const FILES = ['index.html', 'styles.css', 'icon.svg', 'config.js', 'js', 'supabase/functions/_shared/pricing.js'];

rmSync(OUT, { recursive: true, force: true });
mkdirSync(OUT);
for (const f of FILES) cpSync(f, `${OUT}/${f}`, { recursive: true });

const env = process.env;
const url = env.SUPABASE_URL || env.NEXT_PUBLIC_SUPABASE_URL || '';
const key =
  env.SUPABASE_PUBLISHABLE_KEY ||
  env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ||
  env.SUPABASE_ANON_KEY ||
  env.NEXT_PUBLIC_SUPABASE_ANON_KEY ||
  '';

if (!url || !key) {
  console.log('build: Supabase variables not set, using demo-mode config.js');
  process.exit(0);
}
if (!/^https:\/\/[a-z0-9-]+\.supabase\.co$/.test(url)) {
  console.error(`build: unexpected SUPABASE_URL "${url}"`);
  process.exit(1);
}
if (key.startsWith('sb_secret_') || /service_role/.test(Buffer.from(key.split('.')[1] ?? '', 'base64').toString())) {
  console.error('build: refusing to publish a secret / service role key');
  process.exit(1);
}

writeFileSync(
  `${OUT}/config.js`,
  `// Generated at build time by scripts/build.mjs. Do not edit.\n` +
    `window.GIFT_CONFIG = ${JSON.stringify({ supabaseUrl: url, supabaseAnonKey: key }, null, 2)};\n`,
);
console.log(`build: connected to ${url}`);
