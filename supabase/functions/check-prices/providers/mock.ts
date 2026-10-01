// Simulated prices so the whole pipeline (history, sale alerts, sparklines)
// works before a real price API is connected.
import { mockPrice } from '../../_shared/pricing.js';
import type { PriceProvider } from './index.ts';

export const mockProvider: PriceProvider = {
  name: 'mock',
  async getPrice(gift) {
    const base = Number(gift.base_price ?? gift.current_price ?? 0);
    return { price: mockPrice(gift.id, base), source: 'mock' };
  },
};
