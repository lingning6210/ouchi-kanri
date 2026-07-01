-- ============================================================
-- 通知（Web Push）用のセットアップ SQL
-- Supabase ダッシュボード → SQL Editor に貼り付けて Run。
-- （先に supabase_setup.sql を実行済みであること）
-- ============================================================

-- 各端末のプッシュ購読情報
create table if not exists public.push_subs (
  endpoint    text primary key,
  sub         jsonb not null,
  notify_time text  not null default '20:00',   -- JST の HH:MM
  code        text,                             -- 任意：おうちコード
  updated_at  timestamptz not null default now()
);

alter table public.push_subs enable row level security;
revoke all on public.push_subs from anon, authenticated;

-- 購読の保存（upsert）
create or replace function public.push_save(p_endpoint text, p_sub jsonb, p_time text, p_code text)
returns void language plpgsql security definer set search_path = public as $$
begin
  insert into public.push_subs (endpoint, sub, notify_time, code, updated_at)
  values (p_endpoint, p_sub, coalesce(p_time,'20:00'), p_code, now())
  on conflict (endpoint) do update
    set sub = excluded.sub, notify_time = excluded.notify_time, code = excluded.code, updated_at = now();
end;
$$;

-- 購読の削除
create or replace function public.push_delete(p_endpoint text)
returns void language sql security definer set search_path = public as $$
  delete from public.push_subs where endpoint = p_endpoint;
$$;

grant execute on function public.push_save(text, jsonb, text, text) to anon, authenticated;
grant execute on function public.push_delete(text)                  to anon, authenticated;
