-- Security review hardening (October 2026).

-- 1. A gift's person must belong to the same event (and so the same user).
--    Previously only the event was checked, so a gift could point at another
--    account's person if its ID was known.
create or replace function public.check_event_owner() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if not exists (select 1 from public.events e where e.id = new.event_id and e.user_id = new.user_id) then
    raise exception 'event not found';
  end if;
  -- Separate IF: PL/pgSQL would resolve new.recipient_id even when the table
  -- test is false, and recipients has no such column.
  if tg_table_name = 'gifts' then
    if new.recipient_id is not null and not exists (
      select 1 from public.recipients r where r.id = new.recipient_id and r.event_id = new.event_id
    ) then
      raise exception 'recipient not found';
    end if;
  end if;
  return new;
end $$;
revoke execute on function public.check_event_owner() from public, anon, authenticated;

-- 2. Least-privilege table grants, as a second line of defence behind RLS.
--    Signed-out visitors never touch tables directly.
revoke all on public.events, public.recipients, public.gifts, public.price_history,
  public.notifications, public.price_check_requests from anon;
--    Signed-in users: full access to their own events, people and gifts (RLS
--    still limits rows); read-only price history; alerts can only be read,
--    marked read, or deleted; the rate-limit table is server-only.
revoke all on public.price_history, public.notifications, public.price_check_requests from authenticated;
grant select on public.price_history to authenticated;
grant select, delete on public.notifications to authenticated;
grant update (read) on public.notifications to authenticated;

-- 3. Length limits on free-text fields that had none.
alter table public.events add constraint events_notes_length check (notes is null or char_length(notes) <= 2000);
alter table public.gifts add constraint gifts_url_length check (url is null or char_length(url) <= 2048);
alter table public.notifications add constraint notifications_message_length check (char_length(message) <= 500);
alter table public.price_history add constraint price_history_source_length check (char_length(source) <= 40);
