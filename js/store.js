// Data layer. Two interchangeable stores with the same async API:
//   SupabaseStore: real accounts (Google sign-in) and a Postgres database
//   LocalStore:    demo mode kept in this browser's localStorage, used when
//                  config.js has no Supabase project yet
import { mockPrice, detectAlert, round2 } from '../supabase/functions/_shared/pricing.js';

export async function createStore(config) {
  if (config.supabaseUrl && config.supabaseAnonKey) {
    await loadScript('vendor/supabase.js'); // self-hosted @supabase/supabase-js (UMD build)
    const client = window.supabase.createClient(config.supabaseUrl, config.supabaseAnonKey, {
      auth: { flowType: 'pkce', detectSessionInUrl: true, persistSession: true },
    });
    return new SupabaseStore(client);
  }
  return new LocalStore();
}

function loadScript(src) {
  return new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = src;
    s.onload = resolve;
    s.onerror = () => reject(new Error(`Couldn't load ${src}`));
    document.head.append(s);
  });
}

const byDate = (key) => (a, b) => new Date(a[key]) - new Date(b[key]);

function normalizeEvent(e) {
  e.recipients = (e.recipients ?? []).sort(byDate('created_at'));
  e.gifts = (e.gifts ?? []).sort(byDate('created_at'));
  for (const g of e.gifts) g.price_history = (g.price_history ?? []).sort(byDate('checked_at'));
  return e;
}

// ---------------------------------------------------------------------------

class SupabaseStore {
  constructor(client) {
    this.db = client;
    this.demo = false;
  }

  async getUser() {
    const { data } = await this.db.auth.getSession();
    return data.session ? toUser(data.session.user) : null;
  }

  onAuthChange(cb) {
    this.db.auth.onAuthStateChange((_event, session) => cb(session ? toUser(session.user) : null));
  }

  async signInWithGoogle() {
    const { error } = await this.db.auth.signInWithOAuth({
      provider: 'google',
      options: { redirectTo: location.origin + location.pathname },
    });
    if (error) throw error;
  }

  async signOut() {
    await this.db.auth.signOut();
  }

  /** Everything stored about the signed-in user, for "Download my data". */
  async exportData() {
    const { data: session } = await this.db.auth.getSession();
    const u = session.session?.user;
    const [events, notifications] = await Promise.all([
      this.db.from('events').select('*, recipients(*), gifts(*, price_history(price, source, checked_at))'),
      this.db.from('notifications').select('*'),
    ]);
    if (events.error) throw events.error;
    if (notifications.error) throw notifications.error;
    return {
      account: u && { id: u.id, email: u.email, created_at: u.created_at, last_sign_in_at: u.last_sign_in_at, profile: u.user_metadata },
      events: events.data,
      notifications: notifications.data,
    };
  }

  /** Permanently deletes the account and all its data (server-side). */
  async deleteAccount() {
    const { error } = await this.db.functions.invoke('delete-account', { body: { confirm: true } });
    if (error) throw error;
    await this.db.auth.signOut({ scope: 'local' });
  }

  async listEvents() {
    const { data, error } = await this.db
      .from('events')
      .select('*, recipients(*), gifts(*)')
      .order('event_date', { ascending: true, nullsFirst: false });
    if (error) throw error;
    return data.map(normalizeEvent);
  }

  async getEvent(id) {
    const { data, error } = await this.db
      .from('events')
      .select('*, recipients(*), gifts(*, price_history(price, checked_at))')
      .eq('id', id)
      .maybeSingle();
    if (error) throw error;
    return data && normalizeEvent(data);
  }

  async createEvent(event, recipients) {
    const { data, error } = await this.db.from('events').insert(event).select().single();
    if (error) throw error;
    if (recipients.length) {
      const rows = recipients.map((r) => ({ ...r, event_id: data.id }));
      const { error: rErr } = await this.db.from('recipients').insert(rows);
      if (rErr) throw rErr;
    }
    return data;
  }

  async updateEvent(id, patch) {
    const { error } = await this.db.from('events').update(patch).eq('id', id);
    if (error) throw error;
  }

  async deleteEvent(id) {
    const { error } = await this.db.from('events').delete().eq('id', id);
    if (error) throw error;
  }

  async addRecipient(eventId, recipient) {
    const { error } = await this.db.from('recipients').insert({ ...recipient, event_id: eventId });
    if (error) throw error;
  }

  async updateRecipient(id, patch) {
    const { error } = await this.db.from('recipients').update(patch).eq('id', id);
    if (error) throw error;
  }

  async deleteRecipient(id) {
    const { error } = await this.db.from('recipients').delete().eq('id', id);
    if (error) throw error;
  }

  async addGift(eventId, gift) {
    const { data, error } = await this.db
      .from('gifts')
      .insert({ ...gift, event_id: eventId })
      .select()
      .single();
    if (error) throw error;
    // Record a first price point right away so tracking starts now.
    if (data.track_price) await this.checkPrices({ gift_id: data.id }).catch(() => {});
    return data;
  }

  async updateGift(id, patch) {
    const { error } = await this.db.from('gifts').update(patch).eq('id', id);
    if (error) throw error;
  }

  async deleteGift(id) {
    const { error } = await this.db.from('gifts').delete().eq('id', id);
    if (error) throw error;
  }

  async checkPrices(scope) {
    const { data, error } = await this.db.functions.invoke('check-prices', { body: scope });
    if (error) throw error;
    return data;
  }

  async listNotifications() {
    const { data, error } = await this.db
      .from('notifications')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(50);
    if (error) throw error;
    return data;
  }

  async markNotificationsRead(ids) {
    if (!ids.length) return;
    const { error } = await this.db.from('notifications').update({ read: true }).in('id', ids);
    if (error) throw error;
  }
}

function toUser(u) {
  const meta = u.user_metadata ?? {};
  return {
    id: u.id,
    email: u.email,
    name: meta.full_name || meta.name || u.email,
    avatar: meta.avatar_url || meta.picture || null,
    provider: u.app_metadata?.provider ?? 'google',
    created_at: u.created_at,
  };
}

// ---------------------------------------------------------------------------

const LOCAL_KEY = 'giftbudget-demo-v1';
const SIX_HOURS = 6 * 60 * 60 * 1000;

class LocalStore {
  constructor() {
    this.demo = true;
    this.listeners = [];
    this.data = this.load();
  }

  load() {
    try {
      const raw = localStorage.getItem(LOCAL_KEY);
      if (raw) return JSON.parse(raw);
    } catch {
      /* storage blocked or corrupt: start empty */
    }
    return emptyData();
  }

  save() {
    try {
      localStorage.setItem(LOCAL_KEY, JSON.stringify(this.data));
    } catch {
      /* keep working in memory */
    }
  }

  async getUser() {
    return this.data.user;
  }

  onAuthChange(cb) {
    this.listeners.push(cb);
  }

  emit() {
    for (const cb of this.listeners) cb(this.data.user);
  }

  // In demo mode "Continue with Google" signs in as a local demo user.
  async signInWithGoogle() {
    this.data = emptyData();
    this.data.user = {
      id: 'demo-user',
      email: 'demo@example.com',
      name: 'Demo user',
      avatar: null,
      provider: 'demo',
      created_at: new Date().toISOString(),
    };
    seedDemo(this);
    this.save();
    this.emit();
  }

  async signOut() {
    this.data = emptyData();
    this.save();
    this.emit();
  }

  async exportData() {
    const { user, events, recipients, gifts, price_history, notifications } = this.data;
    return { account: user, events, recipients, gifts, price_history, notifications };
  }

  async deleteAccount() {
    try {
      localStorage.removeItem(LOCAL_KEY);
    } catch {
      /* ignore */
    }
    await this.signOut();
  }

  assemble(e, withHistory) {
    const d = this.data;
    return normalizeEvent({
      ...e,
      recipients: d.recipients.filter((r) => r.event_id === e.id).map((r) => ({ ...r })),
      gifts: d.gifts
        .filter((g) => g.event_id === e.id)
        .map((g) => ({
          ...g,
          price_history: withHistory ? d.price_history.filter((h) => h.gift_id === g.id) : undefined,
        })),
    });
  }

  async listEvents() {
    return this.data.events
      .map((e) => this.assemble(e, false))
      .sort((a, b) => (a.event_date || '9999').localeCompare(b.event_date || '9999'));
  }

  async getEvent(id) {
    const e = this.data.events.find((x) => x.id === id);
    return e ? this.assemble(e, true) : null;
  }

  async createEvent(event, recipients) {
    const row = { id: uid(), created_at: now(), notes: null, ...event };
    this.data.events.push(row);
    for (const r of recipients) this.data.recipients.push({ id: uid(), created_at: now(), ...r, event_id: row.id });
    this.save();
    return row;
  }

  async updateEvent(id, patch) {
    Object.assign(this.data.events.find((e) => e.id === id), patch);
    this.save();
  }

  async deleteEvent(id) {
    const d = this.data;
    const giftIds = new Set(d.gifts.filter((g) => g.event_id === id).map((g) => g.id));
    d.events = d.events.filter((e) => e.id !== id);
    d.recipients = d.recipients.filter((r) => r.event_id !== id);
    d.gifts = d.gifts.filter((g) => g.event_id !== id);
    d.price_history = d.price_history.filter((h) => !giftIds.has(h.gift_id));
    d.notifications = d.notifications.filter((n) => n.event_id !== id);
    this.save();
  }

  async addRecipient(eventId, recipient) {
    this.data.recipients.push({ id: uid(), created_at: now(), ...recipient, event_id: eventId });
    this.save();
  }

  async updateRecipient(id, patch) {
    Object.assign(this.data.recipients.find((r) => r.id === id), patch);
    this.save();
  }

  async deleteRecipient(id) {
    this.data.recipients = this.data.recipients.filter((r) => r.id !== id);
    for (const g of this.data.gifts) if (g.recipient_id === id) g.recipient_id = null;
    this.save();
  }

  async addGift(eventId, gift) {
    const row = {
      id: uid(),
      created_at: now(),
      status: 'wanted',
      amount_spent: null,
      bought_at: null,
      last_checked_at: null,
      ...gift,
      event_id: eventId,
    };
    this.data.gifts.push(row);
    if (row.track_price) this.recordPrice(row, this.data.clock);
    this.save();
    return row;
  }

  async updateGift(id, patch) {
    Object.assign(this.data.gifts.find((g) => g.id === id), patch);
    this.save();
  }

  async deleteGift(id) {
    this.data.gifts = this.data.gifts.filter((g) => g.id !== id);
    this.data.price_history = this.data.price_history.filter((h) => h.gift_id !== id);
    this.data.notifications = this.data.notifications.filter((n) => n.gift_id !== id);
    this.save();
  }

  // Demo price check: each click moves a simulated clock forward six hours,
  // so repeated checks show the price moving and sales appearing.
  async checkPrices({ event_id, gift_id } = {}) {
    this.data.clock += SIX_HOURS;
    let checked = 0;
    let alerts = 0;
    for (const g of this.data.gifts) {
      if (!g.track_price || g.status !== 'wanted') continue;
      if (event_id && g.event_id !== event_id) continue;
      if (gift_id && g.id !== gift_id) continue;
      if (this.recordPrice(g, this.data.clock)) alerts++;
      checked++;
    }
    this.save();
    return { checked, alerts, provider: 'mock' };
  }

  recordPrice(gift, at) {
    const history = this.data.price_history.filter((h) => h.gift_id === gift.id);
    const base = Number(history[0]?.price ?? gift.current_price ?? 0);
    const price = mockPrice(gift.id, base, at);
    const alert = detectAlert(gift, history, price, at);
    const checked_at = new Date(at).toISOString();
    this.data.price_history.push({ id: uid(), gift_id: gift.id, price, source: 'mock', checked_at });
    gift.current_price = price;
    gift.last_checked_at = checked_at;
    if (alert) {
      this.data.notifications.push({
        id: uid(),
        gift_id: gift.id,
        event_id: gift.event_id,
        kind: alert.kind,
        message: alert.message,
        read: false,
        created_at: now(),
      });
    }
    return !!alert;
  }

  async listNotifications() {
    return [...this.data.notifications].sort((a, b) => b.created_at.localeCompare(a.created_at)).slice(0, 50);
  }

  async markNotificationsRead(ids) {
    for (const n of this.data.notifications) if (ids.includes(n.id)) n.read = true;
    this.save();
  }
}

function emptyData() {
  return { user: null, events: [], recipients: [], gifts: [], price_history: [], notifications: [], clock: Date.now() };
}

function uid() {
  return crypto.randomUUID();
}

function now() {
  return new Date().toISOString();
}

// A sample event so the demo isn't empty, with a couple of weeks of history.
function seedDemo(store) {
  const d = store.data;
  const year = new Date().getFullYear();
  const xmas = {
    id: uid(),
    name: `Christmas ${year}`,
    event_date: `${year}-12-25`,
    budget_mode: 'per_recipient',
    total_budget: null,
    notes: null,
    created_at: now(),
  };
  d.events.push(xmas);
  const people = [
    { name: 'Mom', budget: 150 },
    { name: 'Dad', budget: 120 },
    { name: 'Lauren', budget: 80 },
  ].map((p) => ({ id: uid(), created_at: now(), event_id: xmas.id, ...p }));
  d.recipients.push(...people);

  const gifts = [
    { name: 'Cashmere scarf', recipient: 0, price: 89, status: 'bought', spent: 79.5 },
    { name: 'Espresso machine', recipient: 1, price: 119, target: 99 },
    { name: 'LEGO Botanical bouquet', recipient: 2, price: 59.99 },
    { name: 'Hardcover cookbook', recipient: 0, price: 35 },
    { name: 'Wool socks (3-pack)', recipient: 1, price: 24 },
  ];
  const start = d.clock - 14 * 4 * SIX_HOURS;
  for (const g of gifts) {
    const row = {
      id: uid(),
      created_at: now(),
      event_id: xmas.id,
      recipient_id: people[g.recipient].id,
      name: g.name,
      url: null,
      current_price: g.price,
      target_price: g.target ?? null,
      track_price: g.status !== 'bought',
      status: g.status ?? 'wanted',
      amount_spent: g.spent ?? null,
      bought_at: g.status === 'bought' ? now() : null,
      last_checked_at: null,
    };
    d.gifts.push(row);
    if (!row.track_price) continue;
    for (let t = start; t <= d.clock; t += SIX_HOURS * 4) {
      const history = d.price_history.filter((h) => h.gift_id === row.id);
      const base = Number(history[0]?.price ?? g.price);
      const price = round2(mockPrice(row.id, base, t));
      d.price_history.push({ id: uid(), gift_id: row.id, price, source: 'mock', checked_at: new Date(t).toISOString() });
      row.current_price = price;
      row.last_checked_at = new Date(t).toISOString();
    }
  }

  const bday = {
    id: uid(),
    name: "Jane's baby shower",
    event_date: `${year + 1}-02-14`,
    budget_mode: 'total',
    total_budget: 60,
    notes: null,
    created_at: now(),
  };
  d.events.push(bday);
}
