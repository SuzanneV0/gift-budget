-- Rate limit for user-triggered price checks ("Check prices now", and the
-- first check when a gift is added). The scheduled cron run isn't limited.
-- Only the check-prices function (service role) can use this.

create table public.price_check_requests (
  id          bigint generated always as identity primary key,
  user_id     uuid not null references auth.users(id) on delete cascade,
  created_at  timestamptz not null default now()
);
create index on public.price_check_requests (user_id, created_at);

-- RLS on with no policies: invisible to browsers, usable by the service role.
alter table public.price_check_requests enable row level security;

-- Records one request and returns true if the user is still under the limit.
create function public.consume_price_check(p_user uuid, p_limit int, p_window interval)
returns boolean
language plpgsql volatile security definer set search_path = '' as $$
declare
  recent int;
begin
  -- Serialise concurrent calls for the same user so the count is exact.
  perform pg_advisory_xact_lock(hashtext(p_user::text));
  delete from public.price_check_requests where user_id = p_user and created_at < now() - p_window;
  select count(*) into recent from public.price_check_requests where user_id = p_user;
  if recent >= p_limit then
    return false;
  end if;
  insert into public.price_check_requests (user_id) values (p_user);
  return true;
end $$;

revoke all on function public.consume_price_check(uuid, int, interval) from public, anon, authenticated;
grant execute on function public.consume_price_check(uuid, int, interval) to service_role;
