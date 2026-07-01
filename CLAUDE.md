# おうち管理 — 開発ガイドライン

家事を定期タスクとして家族で共有するアプリ（React + Vite / Supabase 同期 / GitHub Pages 配信）。

## セキュリティルール
- `.env` や秘密鍵（`*.pem` `*.key` `*.p12` `*.pfx`）の内容を出力・共有・コミットしない。
- APIキー・パスワードをコードにハードコードしない。
  - 例外：Supabase の **anon（公開）キー**はクライアント同梱前提のため `src/cloud.js` に直書きしてよい。データ保護は Supabase 側の RLS ＋ コード制限の RPC 関数で担保する。
  - **`service_role` キーは絶対にコミットしない**（サーバー専用・管理者権限）。
- 通知（Web Push）実装時：**VAPID 秘密鍵**は Supabase のシークレット／Edge Function の環境変数に置き、リポジトリには入れない。公開鍵のみクライアントに埋め込む。
- `rm -rf` などの破壊的操作は実行しない。

## 開発メモ
- 起動: `npm install && npm run dev` / ビルド: `npm run build`
- 本番配信: `main` への push で GitHub Actions が GitHub Pages へ自動デプロイ。
- データ保存: 端末内は localStorage、共有時は Supabase（おうちコードで参加）。
- 主要ファイル: `src/App.jsx`（画面・状態）/ `src/recurrence.js`（繰り返し）/ `src/cloud.js`（同期）/ `src/styles.css`。
