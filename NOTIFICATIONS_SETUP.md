# 通知（Web Push）セットアップ手順

アプリ側（購読UI・service worker）は実装済み。通知を実際に飛ばすには、以下の
サーバー設定（あなたのSupabaseでの操作）が必要です。順番にどうぞ。

## 用意する鍵
このリポジトリには **公開鍵のみ** 入っています（`src/push.js`）。
**秘密鍵はチャットで別途お渡しします。リポジトリには絶対に入れないでください。**

---

## 1. テーブル/関数を作る
Supabase ダッシュボード → SQL Editor で `supabase_push_setup.sql` を実行。

## 2. Supabase CLI を用意（未導入なら）
```bash
npm i -g supabase
supabase login
supabase link --project-ref sajxckfiknndrgbwflsp
```

## 3. VAPID 鍵などをシークレット登録
```bash
supabase secrets set VAPID_PUBLIC=<公開鍵> VAPID_PRIVATE=<秘密鍵（チャットで渡すもの）>
```
（`SUPABASE_URL` と `SUPABASE_SERVICE_ROLE_KEY` は Edge Function に自動注入されます）

## 4. Edge Function をデプロイ
```bash
supabase functions deploy send-reminders --no-verify-jwt
```

## 5. 毎分実行の cron を設定
Supabase ダッシュボード → SQL Editor で実行（pg_cron / pg_net を有効化）：
```sql
create extension if not exists pg_cron;
create extension if not exists pg_net;

select cron.schedule(
  'ouchi-reminders',
  '* * * * *',
  $$ select net.http_post(
       url := 'https://sajxckfiknndrgbwflsp.functions.supabase.co/send-reminders'
     ); $$
);
```
（停止したいとき: `select cron.unschedule('ouchi-reminders');`）

---

## 動作確認
1. スマホでアプリを開く（iPhoneは「ホーム画面に追加」したアプリから）
2. その他タブ →「毎日の通知時刻」を**今から2分後**に設定
3. その他タブ →「プッシュ通知」→「オンにする」→ 通知を許可
4. 設定時刻に「今日の家事をチェックしましょう🏠」が届けば成功

手動テスト（すぐ確認したい場合）：Function を直接叩く
```bash
curl -X POST https://sajxckfiknndrgbwflsp.functions.supabase.co/send-reminders
```
（現在のJST時刻に一致する購読にだけ送られます。テストは通知時刻を現在の分に合わせてから）

## 注意
- iPhone は iOS 16.4+ かつ「ホーム画面に追加」したPWAでのみプッシュが有効。
- `notify_time` は JST の HH:MM。時刻は「毎日の通知時刻」を変えると自動で更新されます。
