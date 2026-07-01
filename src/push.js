import { supabase } from "./cloud.js";

// VAPID public key (safe to ship in the client). The matching PRIVATE key lives
// only in the Supabase Edge Function secret — never in this repo.
export const VAPID_PUBLIC =
  "BDj5G9_q0b3lK21DkJSAi1ZmZi5KNPCseU-uM5NufxQ_UWrs_HuDZHDXCqIAsgl0gPefVcwUm_SoWcL1JHkzpgk";

export function pushSupported() {
  return "serviceWorker" in navigator && "PushManager" in window && "Notification" in window;
}

function urlB64ToUint8Array(base64) {
  const padding = "=".repeat((4 - (base64.length % 4)) % 4);
  const b64 = (base64 + padding).replace(/-/g, "+").replace(/_/g, "/");
  const raw = atob(b64);
  const arr = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) arr[i] = raw.charCodeAt(i);
  return arr;
}

export async function isPushEnabled() {
  if (!pushSupported()) return false;
  const reg = await navigator.serviceWorker.getRegistration();
  const sub = await reg?.pushManager.getSubscription();
  return !!sub;
}

export async function enablePush(notifyTime, code) {
  if (!pushSupported()) throw new Error("この端末はプッシュ通知に非対応です");
  const perm = await Notification.requestPermission();
  if (perm !== "granted") throw new Error("通知が許可されませんでした");
  const reg = await navigator.serviceWorker.ready;
  let sub = await reg.pushManager.getSubscription();
  if (!sub) {
    sub = await reg.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlB64ToUint8Array(VAPID_PUBLIC),
    });
  }
  const { error } = await supabase.rpc("push_save", {
    p_endpoint: sub.endpoint, p_sub: sub.toJSON(), p_time: notifyTime || "20:00", p_code: code || null,
  });
  if (error) throw error;
  return true;
}

export async function updatePushTime(notifyTime, code) {
  if (!(await isPushEnabled())) return;
  const reg = await navigator.serviceWorker.getRegistration();
  const sub = await reg.pushManager.getSubscription();
  if (sub) {
    await supabase.rpc("push_save", { p_endpoint: sub.endpoint, p_sub: sub.toJSON(), p_time: notifyTime || "20:00", p_code: code || null });
  }
}

export async function disablePush() {
  const reg = await navigator.serviceWorker.getRegistration();
  const sub = await reg?.pushManager.getSubscription();
  if (sub) {
    try { await supabase.rpc("push_delete", { p_endpoint: sub.endpoint }); } catch {}
    await sub.unsubscribe();
  }
}
