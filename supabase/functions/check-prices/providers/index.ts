// Price providers. Each one looks up the current price of a gift.
//
// To add a real provider (Keepa, SerpApi, Rainforest, ...):
//   1. create providers/<name>.ts exporting a PriceProvider
//   2. register it in PROVIDERS below
//   3. `supabase secrets set PRICE_PROVIDER=<name> <NAME>_API_KEY=...`
import { mockProvider } from './mock.ts';

export interface GiftForPricing {
  id: string;
  name: string;
  url: string | null;
  current_price: number | null;
  /** Oldest known price, used by the mock provider as a stable base. */
  base_price: number | null;
}

export interface PriceResult {
  price: number;
  source: string;
}

export interface PriceProvider {
  name: string;
  /** Return null when the price can't be found (the gift is skipped). */
  getPrice(gift: GiftForPricing): Promise<PriceResult | null>;
}

const PROVIDERS: Record<string, PriceProvider> = {
  mock: mockProvider,
};

export function getProvider(): PriceProvider {
  const name = Deno.env.get('PRICE_PROVIDER') ?? 'mock';
  const provider = PROVIDERS[name];
  if (!provider) throw new Error(`Unknown PRICE_PROVIDER "${name}"`);
  return provider;
}
