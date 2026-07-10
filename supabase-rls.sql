-- ═══════════════════════════════════════════════════════════════════
-- VÆST — Row Level Security migration
-- Run once in: Supabase Dashboard → SQL Editor → New query → paste → Run
-- Safe to run AFTER the app deploy that sends the user's JWT (already live).
-- Rollback (emergency): alter table public.vaest_state disable row level security;
-- ═══════════════════════════════════════════════════════════════════

alter table public.vaest_state enable row level security;

-- ── 0) CLEAN SLATE — the table already has RLS with an old wide-open anon
--       policy (that's the vulnerability). Drop everything, rebuild below.
do $$ declare pol record;
begin
  for pol in select policyname from pg_policies
    where schemaname='public' and tablename='vaest_state'
  loop
    execute format('drop policy %I on public.vaest_state', pol.policyname);
  end loop;
end $$;

-- ── 1) USER STATE — owner-only. The critical fix: nobody can read or write
--       another account's workspace anymore.
create policy "own_state_select" on public.vaest_state
  for select to authenticated
  using (auth.jwt()->>'email' = email);

create policy "own_state_insert" on public.vaest_state
  for insert to authenticated
  with check (auth.jwt()->>'email' = email);

create policy "own_state_update" on public.vaest_state
  for update to authenticated
  using (auth.jwt()->>'email' = email)
  with check (auth.jwt()->>'email' = email);

-- ── 2) SHARE ROWS — readable/writable by link visitors (comments), deletable
--       by the app (revoke). Content here is what an owner chose to publish.
--       NOTE: next tightening step (needs SUPABASE_SERVICE_KEY in Vercel):
--       move share reads server-side and drop public select to prevent listing.
create policy "share_select" on public.vaest_state
  for select to anon, authenticated
  using (email like 'share:%');

create policy "share_insert" on public.vaest_state
  for insert to anon, authenticated
  with check (email like 'share:%');

create policy "share_update" on public.vaest_state
  for update to anon, authenticated
  using (email like 'share:%')
  with check (email like 'share:%');

create policy "share_delete" on public.vaest_state
  for delete to anon, authenticated
  using (email like 'share:%');

-- ── 3) WAITLIST — the public can add themselves, but can NOT read the list.
create policy "wl_insert" on public.vaest_state
  for insert to anon, authenticated
  with check (email like 'wl:%');

create policy "wl_update" on public.vaest_state
  for update to anon, authenticated
  using (email like 'wl:%')
  with check (email like 'wl:%');

-- ── 4) USAGE ROWS — the API currently writes these with the publishable key,
--       so they stay open for now (same exposure as today, low stakes).
--       Once SUPABASE_SERVICE_KEY is set in Vercel and lib/plans.js uses it,
--       drop these three policies to lock usage rows server-only.
create policy "usage_select" on public.vaest_state
  for select to anon, authenticated
  using (email like 'usage:%');

create policy "usage_insert" on public.vaest_state
  for insert to anon, authenticated
  with check (email like 'usage:%');

create policy "usage_update" on public.vaest_state
  for update to anon, authenticated
  using (email like 'usage:%')
  with check (email like 'usage:%');

-- ═══ VERIFY (run after) — both must return zero rows / denied ═══
-- 1) In the SQL editor this runs as postgres and bypasses RLS, so verify from
--    the app or with:  select * from pg_policies where tablename='vaest_state';
-- 2) Real test: log out of VÆST, then in the browser console run:
--    fetch('https://yyhqcqlylnoukmovrpwo.supabase.co/rest/v1/vaest_state?select=email',
--      {headers:{apikey:'<publishable>',Authorization:'Bearer <publishable>'}})
--      .then(r=>r.json()).then(console.log)
--    → should return ONLY share:/usage: rows, never user emails' state.
