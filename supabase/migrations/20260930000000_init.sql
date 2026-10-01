-- Gift Budget: initial schema.
-- Every table is owned by a user and locked down with row-level security,
-- so the browser (using the public anon key) can only ever see its own rows.

create extension if not exists pgcrypto;

-- One event = one gift-giving occasion (Christmas 2026, Lauren's birthday, ...)
create table public.events (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null default auth.uid() references auth.users(id) on delete cascade,
  name          text not null check (char_length(name) between 1 and 120),
  event_date    date,
  -- 'total': one budget for the whole event; 'per_recipient': a budget per person
  budget_mode   text not null default 'total' check (budget_mode in ('total', 'per_recipient')),
  total_budget  numeric(10,2) check (total_budget is null or total_budget >= 0),
  notes         text,
  created_at    timestamptz not null default now()
);

create table public.recipients (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null default auth.uid() references auth.users(id) on delete cascade,
  event_id    uuid not null references public.events(id) on delete cascade,
  name        text not null check (char_length(name) between 1 and 80),
  budget      numeric(10,2) check (budget is null or budget >= 0),
  created_at  timestamptz not null default now()
);

create table public.gifts (
  id              uuid primary key default gen_random_uuid(),
  user_id         uuid not null default auth.uid() references auth.users(id) on delete cascade,
  event_id        uuid not null references public.events(id) on delete cascade,
  recipient_id    uuid references public.recipients(id) on delete set null,
  name            text not null check (char_length(name) between 1 and 200),
  url             text check (url is null or url ~* '^https?://'),
  current_price   numeric(10,2) check (current_price is null or current_price >= 0),
  target_price    numeric(10,2) check (target_price is null or target_price >= 0),
  track_price     boolean not null default true,
  status          text not null default 'wanted' check (status in ('wanted', 'bought')),
  amount_spent    numeric(10,2) check (amount_spent is null or amount_spent >= 0),
  bought_at       timestamptz,
  last_checked_at timestamptz,
  created_at      timestamptz not null default now()
);

-- One row per price observation, written by the check-prices function.
create table public.price_history (
  id          bigint generated always as identity primary key,
  user_id     uuid not null references auth.users(id) on delete cascade,
  gift_id     uuid not null references public.gifts(id) on delete cascade,
  price       numeric(10,2) not null check (price >= 0),
  source      text not null default 'mock',
  checked_at  timestamptz not null default now()
);

-- In-app alerts ("Lego set dropped to $39.99").
create table public.notifications (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references auth.users(id) on delete cascade,
  gift_id     uuid references public.gifts(id) on delete cascade,
  event_id    uuid references public.events(id) on delete cascade,
  kind        text not null default 'sale' check (kind in ('sale', 'target')),
  message     text not null,
  read        boolean not null default false,
  created_at  timestamptz not null default now()
);

create index on public.events (user_id);
create index on public.recipients (event_id);
create index on public.gifts (event_id);
create index on public.gifts (track_price, status);
create index on public.price_history (gift_id, checked_at);
create index on public.notifications (user_id, read);

-- A recipient/gift must belong to an event owned by the same user.
create or replace function public.check_event_owner() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if not exists (select 1 from public.events e where e.id = new.event_id and e.user_id = new.user_id) then
    raise exception 'event not found';
  end if;
  return new;
end $$;

create trigger recipients_owner before insert or update on public.recipients
  for each row execute function public.check_event_owner();
create trigger gifts_owner before insert or update on public.gifts
  for each row execute function public.check_event_owner();

alter table public.events        enable row level security;
alter table public.recipients    enable row level security;
alter table public.gifts         enable row level security;
alter table public.price_history enable row level security;
alter table public.notifications enable row level security;

create policy "own events" on public.events
  for all using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
create policy "own recipients" on public.recipients
  for all using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
create policy "own gifts" on public.gifts
  for all using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
-- Price history and notifications are written by the server (service role);
-- users can read them, and mark notifications read.
create policy "read own price history" on public.price_history
  for select using ((select auth.uid()) = user_id);
create policy "read own notifications" on public.notifications
  for select using ((select auth.uid()) = user_id);
create policy "update own notifications" on public.notifications
  for update using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
create policy "delete own notifications" on public.notifications
  for delete using ((select auth.uid()) = user_id);
