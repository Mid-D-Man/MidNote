-- MidNote round C (sync): run this ONCE in the Supabase SQL editor. Safe to run again.
--
-- The app pulls changes by the server's updated_at (a phone's own clock can't be trusted),
-- so updated_at has to move forward every time a row really changes. This makes sure it does,
-- whatever the original table setup (midnote-001) did, and adds the index that paging uses.
--
-- It does NOT touch your data, the push function (public.midnote_push_entries), the policies or
-- the AI tables.

create or replace function public.midnote_entries_touch_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists midnote_entries_touch_updated_at on public.midnote_entries;
create trigger midnote_entries_touch_updated_at
  before insert or update on public.midnote_entries
  for each row execute function public.midnote_entries_touch_updated_at();

create index if not exists midnote_entries_pull_idx
  on public.midnote_entries (user_id, updated_at, id);
