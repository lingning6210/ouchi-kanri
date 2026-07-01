-- ============================================================
-- おうち管理：端末間共有（クラウド同期）用のセットアップ SQL
-- Supabase ダッシュボード → SQL Editor に貼り付けて Run するだけ。
-- （プロジェクトが一時停止していたら、先に Resume してください）
-- ============================================================

-- 家族ごとのデータを丸ごと保存するテーブル
create table if not exists public.households (
  code       text primary key,
  data       jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

-- 直接アクセスは禁止。読み書きは下の関数（おうちコードで保護）経由のみ。
alter table public.households enable row level security;
revoke all on public.households from anon, authenticated;

-- 読み込み：コードに対応するデータを返す（無ければ null）
create or replace function public.hh_load(p_code text)
returns jsonb
language sql
security definer
set search_path = public
as $$
  select data from public.households where code = p_code;
$$;

-- 保存：コードをキーに upsert（初回は新規作成）
create or replace function public.hh_save(p_code text, p_data jsonb)
returns timestamptz
language plpgsql
security definer
set search_path = public
as $$
declare ts timestamptz;
begin
  insert into public.households (code, data, updated_at)
  values (p_code, p_data, now())
  on conflict (code) do update
    set data = excluded.data, updated_at = now()
  returning updated_at into ts;
  return ts;
end;
$$;

-- anon（公開キー）から関数だけ呼べるように許可
grant execute on function public.hh_load(text)         to anon, authenticated;
grant execute on function public.hh_save(text, jsonb)  to anon, authenticated;

-- リアルタイム反映は Realtime Broadcast（チャンネル名＝おうちコード）を使うため
-- 追加のテーブル設定は不要です。
