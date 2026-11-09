-- Brought to u by MidManStudio
-- MidNote settings sync (Round U). Run this ONCE in the Supabase SQL editor (Dashboard -> SQL Editor -> New query -> paste -> Run).
-- It is safe to run again: nothing is dropped, nothing is lost.
--
-- UPDATE (tags sync): this file now also lets the tag list (the setting named midnote:known-tags) be up to 20000 characters instead of
-- 2000. If you ran an earlier copy of this file, run this one again: it only replaces the function, nothing is lost.
--
-- What it adds: one row per person holding their synced look-and-feel settings, and one function the app calls to send its
-- settings and get the merged set back. Each setting is stored as { "v": "its value", "t": <when it was changed, ms> } and
-- the NEWER "t" wins, setting by setting, so two phones that change different settings both keep their change.
-- Row level security: a person can only ever see or change their own row.

create table if not exists public.midnote_settings (
  user_id uuid primary key references auth.users (id) on delete cascade,
  payload jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now(),
  constraint midnote_settings_object check (jsonb_typeof(payload) = 'object'),
  constraint midnote_settings_size check (octet_length(payload::text) <= 65536)
);

alter table public.midnote_settings enable row level security;

drop policy if exists midnote_settings_select on public.midnote_settings;
create policy midnote_settings_select on public.midnote_settings for select to authenticated using (user_id = (select auth.uid()));

drop policy if exists midnote_settings_insert on public.midnote_settings;
create policy midnote_settings_insert on public.midnote_settings for insert to authenticated with check (user_id = (select auth.uid()));

drop policy if exists midnote_settings_update on public.midnote_settings;
create policy midnote_settings_update on public.midnote_settings for update to authenticated using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));

drop policy if exists midnote_settings_delete on public.midnote_settings;
create policy midnote_settings_delete on public.midnote_settings for delete to authenticated using (user_id = (select auth.uid()));

create or replace function public.midnote_merge_settings(p_settings jsonb)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  uid uuid := auth.uid();
  cur jsonb;
  merged jsonb;
  k text;
  v jsonb;
  n integer;
begin
  if uid is null then
    raise exception 'not signed in' using errcode = '28000';
  end if;
  if p_settings is null or jsonb_typeof(p_settings) <> 'object' then
    raise exception 'settings must be a JSON object' using errcode = '22023';
  end if;
  select count(*) into n from jsonb_object_keys(p_settings);
  if n > 50 then
    raise exception 'too many settings in one call (max 50)' using errcode = '54000';
  end if;
  insert into public.midnote_settings (user_id, payload) values (uid, '{}'::jsonb) on conflict (user_id) do nothing;
  select payload into cur from public.midnote_settings where user_id = uid for update;
  merged := cur;
  for k, v in select key, value from jsonb_each(p_settings) loop
    -- only names like midnote:font-size, and only { "v": text-or-null, "t": number }
    if k !~ '^midnote:[a-z0-9-]{1,48}$' then
      continue;
    end if;
    if jsonb_typeof(v) <> 'object' or jsonb_typeof(v -> 't') <> 'number' then
      continue;
    end if;
    if coalesce(jsonb_typeof(v -> 'v'), 'missing') not in ('string', 'null') then
      continue;
    end if;
    -- 2000 characters for an ordinary setting; the tag list (midnote:known-tags) can be longer, up to 20000
    if length(coalesce(v ->> 'v', '')) > (case when k = 'midnote:known-tags' then 20000 else 2000 end) then
      continue;
    end if;
    if (v ->> 't')::numeric <= 0 then
      continue;
    end if;
    -- keep exactly the two fields we know, so nothing else can be stored
    if merged -> k is null or (v ->> 't')::numeric > coalesce((merged -> k ->> 't')::numeric, 0) then
      merged := jsonb_set(merged, array[k], jsonb_build_object('v', v -> 'v', 't', v -> 't'), true);
    end if;
  end loop;
  if octet_length(merged::text) > 65536 then
    raise exception 'settings storage limit reached for this account' using errcode = '54000';
  end if;
  if merged is distinct from cur then
    update public.midnote_settings set payload = merged, updated_at = now() where user_id = uid;
  end if;
  return merged;
end;
$$;

revoke all on function public.midnote_merge_settings(jsonb) from public;
revoke all on function public.midnote_merge_settings(jsonb) from anon;
grant execute on function public.midnote_merge_settings(jsonb) to authenticated;
