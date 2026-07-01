// 毎分 cron から呼ばれ、その時刻(JST HH:MM)に一致する購読へプッシュ通知を送る。
// デプロイ: supabase functions deploy send-reminders --no-verify-jwt
// 秘密情報: VAPID_PUBLIC / VAPID_PRIVATE を supabase secrets set で登録
import webpush from "npm:web-push@3.6.7";
import { createClient } from "npm:@supabase/supabase-js@2";

const supabase = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
);

webpush.setVapidDetails(
  "mailto:lingning6210@gmail.com",
  Deno.env.get("VAPID_PUBLIC")!,
  Deno.env.get("VAPID_PRIVATE")!,
);

function jstHHMM(): string {
  const now = new Date(new Date().toLocaleString("en-US", { timeZone: "Asia/Tokyo" }));
  return `${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}`;
}

Deno.serve(async () => {
  const hh = jstHHMM();
  const { data: subs, error } = await supabase
    .from("push_subs").select("endpoint, sub").eq("notify_time", hh);
  if (error) return new Response(JSON.stringify({ error: error.message }), { status: 500 });

  const payload = JSON.stringify({
    title: "おうち管理", body: "今日の家事をチェックしましょう🏠", url: "./",
  });

  let sent = 0;
  const gone: string[] = [];
  for (const row of subs ?? []) {
    try {
      await webpush.sendNotification(row.sub, payload);
      sent++;
    } catch (e: any) {
      if (e?.statusCode === 404 || e?.statusCode === 410) gone.push(row.endpoint);
    }
  }
  if (gone.length) await supabase.from("push_subs").delete().in("endpoint", gone);

  return new Response(JSON.stringify({ time: hh, matched: subs?.length ?? 0, sent, cleaned: gone.length }), {
    headers: { "content-type": "application/json" },
  });
});
