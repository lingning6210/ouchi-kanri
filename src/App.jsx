import { useState, useMemo, useEffect, useRef } from "react";
import "./styles.css";
import {
  DAYS_JP, parseD, fmtD, todayD, occursOn, occursOnTodo, movedFrom, repeatSummary, repeatShort,
  nthOfMonth, getNthWeekdayInMonth,
} from "./recurrence.js";
import { supabase, cloudLoad, cloudSave, makeHouseholdCode } from "./cloud.js";
import { pushSupported, isPushEnabled, enablePush, disablePush, updatePushTime } from "./push.js";

const uid = () => Math.random().toString(36).slice(2, 9);
const TODAY = todayD();
const TODAY_STR = fmtD(TODAY);
const LS = "ouchi_kanri_v3";
const HH = "ouchi_household_code"; // shared-household code (opt-in cloud sync)

// warm, muted palette that reads well as soft tinted calendar chips
const COLORS = ["#c56b4b", "#d99a3f", "#7fa06a", "#6e86a6", "#9d6a8e", "#4f9d94", "#b98a5e", "#8a8078"];
const EMOJIS = ["👩", "👨", "👧", "🧒", "👴", "👵", "🧑", "🙋", "😊", "😎", "🐱", "🐶", "🐼", "🌸", "⭐", "🦊"];

// ─── initial (empty) state — no preset family; the user adds their own ───
const SEED = {
  currentUser: null,
  members: [],
  todos: [],
  shopping: [],
  notifyTime: "20:00",
};

function load() {
  try {
    const raw = localStorage.getItem(LS);
    if (raw) return { ...SEED, ...JSON.parse(raw) };
  } catch {}
  return SEED;
}

// ─── demo mode (?demo): populated sample data, no saving, no cloud sync ───
const DEMO = typeof window !== "undefined" && new URLSearchParams(window.location.search).has("demo");
const monthStart = fmtD(new Date(TODAY.getFullYear(), TODAY.getMonth(), 1));
const dAgo = (n) => { const d = new Date(TODAY); d.setDate(d.getDate() - n); return fmtD(d); };
const DEMO_SEED = {
  currentUser: "m1",
  members: [
    { id: "m1", name: "お母さん", emoji: "👩", color: "#c56b4b", reward: { threshold: 3, message: "お菓子買ってきて🫶" } },
    { id: "m2", name: "お父さん", emoji: "👨", color: "#6e86a6", reward: { threshold: 3, message: "コーヒー奢って☕" } },
    { id: "m3", name: "長女", emoji: "👧", color: "#9d6a8e", reward: { threshold: 5, message: "ジュース買って🧃" } },
    { id: "m4", name: "長男", emoji: "🧒", color: "#d99a3f", reward: null },
  ],
  todos: [
    { id: "t1", name: "お風呂掃除", ownerId: "m1", color: "#c56b4b", start: monthStart, repeat: { freq: "weekly", interval: 1, weekdays: [1, 4] }, supply: "バスクリーナー", completionLog: [{ date: dAgo(3), doerId: "m1", isSub: false }] },
    { id: "t2", name: "ゴミ捨て", ownerId: "m2", color: "#6e86a6", start: monthStart, repeat: { freq: "weekly", interval: 1, weekdays: [2, 5] }, supply: "ゴミ袋", completionLog: [] },
    { id: "t3", name: "トイレ掃除", ownerId: "m1", color: "#c56b4b", start: monthStart, repeat: { freq: "monthly", interval: 1, mode: "nth", nth: 1, weekday: 5, date: 3 }, supply: "トイレクリーナー", completionLog: [] },
    { id: "t4", name: "シーツ交換", ownerId: "m3", color: "#9d6a8e", start: monthStart, repeat: { freq: "monthly", interval: 1, mode: "date", date: 1, nth: 0, weekday: 0 }, supply: "", completionLog: [] },
    { id: "t5", name: "掃除機かけ", ownerId: "m4", color: "#d99a3f", start: dAgo(10), repeat: { freq: "daily", interval: 2 }, supply: "", completionLog: [{ date: dAgo(2), doerId: "m4", isSub: false }] },
  ],
  shopping: [
    { id: "s1", name: "牛乳", done: false },
    { id: "s2", name: "洗剤", done: false },
    { id: "s3", name: "卵", done: true },
  ],
  notifyTime: "20:00",
};

export default function App() {
  const init = DEMO ? DEMO_SEED : load();
  const [currentUser, setCurrentUser] = useState(init.currentUser);
  const [members, setMembers] = useState(init.members);
  const [todos, setTodos] = useState(init.todos);
  const [shopping, setShopping] = useState(init.shopping);
  const [notifyTime, setNotifyTime] = useState(init.notifyTime || "20:00");

  const [tab, setTab] = useState("cal");
  const [calMonth, setCalMonth] = useState({ y: TODAY.getFullYear(), m: TODAY.getMonth() });
  const [daySheet, setDaySheet] = useState(null); // "YYYY-MM-DD"

  const [tf, setTf] = useState(null); // task form (editor open when non-null)
  const [repeatOpen, setRepeatOpen] = useState(false);
  const [memberForm, setMemberForm] = useState(null);
  const [supplyPop, setSupplyPop] = useState(null);
  const [rewardPop, setRewardPop] = useState(null);

  // ─── cloud sync (opt-in via "おうちコード") ───────────────
  const [householdCode, setHouseholdCode] = useState(() => {
    try { return localStorage.getItem(HH) || null; } catch { return null; }
  });
  const [syncState, setSyncState] = useState("idle"); // idle | syncing | ok | error
  const [syncErr, setSyncErr] = useState("");
  const [loginJoinCode, setLoginJoinCode] = useState("");
  const suppressSaveRef = useRef(false); // skip cloud-save when the change came from remote
  const channelRef = useRef(null);
  const payloadRef = useRef(null);

  // keep localStorage cache + a live snapshot for seeding the cloud
  useEffect(() => {
    if (DEMO) return; // demo is ephemeral: never persist
    payloadRef.current = { members, todos, shopping, notifyTime, v: 2 };
    try {
      localStorage.setItem(LS, JSON.stringify({ currentUser, members, todos, shopping, notifyTime }));
    } catch {}
  }, [currentUser, members, todos, shopping, notifyTime]);

  function applyRemote(payload) {
    if (!payload || !payload.members) return;
    suppressSaveRef.current = true;
    setMembers(payload.members);
    setTodos(payload.todos || []);
    setShopping(payload.shopping || []);
    if (payload.notifyTime) setNotifyTime(payload.notifyTime);
  }

  function persistHouseholdCode(code) {
    setHouseholdCode(code);
    try {
      if (code) localStorage.setItem(HH, code);
      else localStorage.removeItem(HH);
    } catch {}
  }

  // subscribe + initial load whenever the household code changes
  useEffect(() => {
    if (!householdCode) { setSyncState("idle"); return; }
    let alive = true;
    setSyncState("syncing");

    const ch = supabase.channel(`hh:${householdCode}`, { config: { broadcast: { self: false } } });
    ch.on("broadcast", { event: "sync" }, ({ payload }) => { if (alive) applyRemote(payload); });
    ch.subscribe();
    channelRef.current = ch;

    cloudLoad(householdCode)
      .then((remote) => {
        if (!alive) return;
        if (remote && remote.members) {
          applyRemote(remote);
        } else {
          // brand-new household: seed the cloud with what's on this device
          suppressSaveRef.current = false;
          cloudSave(householdCode, payloadRef.current)
            .then(() => ch.send({ type: "broadcast", event: "sync", payload: payloadRef.current }))
            .catch((e) => { if (alive) { setSyncState("error"); setSyncErr(e?.message || String(e)); } });
        }
        setSyncState("ok"); setSyncErr("");
      })
      .catch((e) => { if (alive) { setSyncState("error"); setSyncErr(e?.message || String(e)); } });

    return () => {
      alive = false;
      supabase.removeChannel(ch);
      channelRef.current = null;
    };
  }, [householdCode]);

  // debounced push whenever local data changes (skips remote-originated changes)
  useEffect(() => {
    if (!householdCode) return;
    if (suppressSaveRef.current) { suppressSaveRef.current = false; return; }
    const payload = { members, todos, shopping, notifyTime, v: 2 };
    const t = setTimeout(() => {
      setSyncState("syncing");
      cloudSave(householdCode, payload)
        .then(() => {
          channelRef.current?.send({ type: "broadcast", event: "sync", payload });
          setSyncState("ok"); setSyncErr("");
        })
        .catch((e) => { setSyncState("error"); setSyncErr(e?.message || String(e)); });
    }, 600);
    return () => clearTimeout(t);
  }, [members, todos, shopping, notifyTime, householdCode]);

  // re-pull when the tab regains focus (covers missed realtime events)
  useEffect(() => {
    if (!householdCode) return;
    const onFocus = () => cloudLoad(householdCode).then((r) => r && applyRemote(r)).catch(() => {});
    window.addEventListener("focus", onFocus);
    return () => window.removeEventListener("focus", onFocus);
  }, [householdCode]);

  // auto-join from a shared link: ?join=OUCHI-XXXX-XXXX
  useEffect(() => {
    if (DEMO) return;
    const params = new URLSearchParams(window.location.search);
    const j = params.get("join");
    if (j) {
      persistHouseholdCode(j.trim().toUpperCase());
      params.delete("join");
      const qs = params.toString();
      window.history.replaceState({}, "", window.location.pathname + (qs ? `?${qs}` : ""));
    }
  }, []);

  const me = members.find((m) => m.id === currentUser);
  const memberById = (id) => members.find((m) => m.id === id);

  // ─── completion ───────────────────────────────────────
  function isDone(todo, dateStr) {
    return (todo.completionLog || []).some((l) => l.date === dateStr);
  }
  function toggleComplete(todoId, dateStr) {
    const t = todos.find((x) => x.id === todoId);
    if (!t) return;
    if (isDone(t, dateStr)) {
      setTodos((ts) => ts.map((x) => x.id === todoId ? { ...x, completionLog: x.completionLog.filter((l) => l.date !== dateStr) } : x));
      return;
    }
    if (t.supply) setSupplyPop({ todoId, dateStr, supply: t.supply });
    else finishComplete(todoId, dateStr);
  }
  function finishComplete(todoId, dateStr) {
    const t = todos.find((x) => x.id === todoId);
    if (!t) return;
    const doerId = currentUser;
    const isSub = !!(t.ownerId && doerId && doerId !== t.ownerId);
    const log = { date: dateStr, doerId, isSub };
    setTodos((ts) => ts.map((x) => x.id === todoId ? { ...x, completionLog: [...(x.completionLog || []), log] } : x));

    if (isSub && t.ownerId) {
      const owner = memberById(t.ownerId);
      if (owner?.reward?.threshold) {
        const prev = todos
          .filter((x) => x.ownerId === t.ownerId)
          .flatMap((x) => (x.completionLog || []).filter((l) => l.isSub && l.doerId === doerId)).length;
        const count = prev + 1;
        if (count % owner.reward.threshold === 0) {
          const helper = memberById(doerId);
          setTodos((ts) => [...ts, {
            id: uid(), name: owner.reward.message, ownerId: t.ownerId, color: owner.color,
            start: TODAY_STR, repeat: { freq: "none" }, supply: "", completionLog: [],
            isReward: true, rewardFor: doerId,
          }]);
          setRewardPop({ ownerEmoji: owner.emoji, ownerName: owner.name, helperEmoji: helper?.emoji || "👤", helperName: helper?.name || "？", message: owner.reward.message, count });
        }
      }
    }
  }
  function supplyYes() { const { todoId, dateStr } = supplyPop; setSupplyPop(null); finishComplete(todoId, dateStr); }
  function supplyNo() {
    setShopping((s) => [...s, { id: uid(), name: supplyPop.supply, done: false }]);
    const { todoId, dateStr } = supplyPop; setSupplyPop(null); finishComplete(todoId, dateStr);
  }

  // ─── task form ────────────────────────────────────────
  function openNewTask(dateOverride) {
    const ds = dateOverride || TODAY_STR;
    setTf({ id: null, name: "", ownerId: currentUser || "", date: ds, origOcc: ds, repeat: { freq: "none" }, supply: "", color: me?.color || COLORS[0] });
  }
  function openEditTask(t, occDate) {
    const oc = occDate || t.start;
    setTf({ id: t.id, name: t.name, ownerId: t.ownerId || "", start: t.start, repeat: t.repeat, supply: t.supply || "", color: t.color || COLORS[0], date: oc, origOcc: oc });
  }
  function saveTask() {
    if (!tf.name.trim()) return;
    if (tf.id) {
      // series-level attributes (keep the anchor start & moves untouched)
      setTodos((ts) => ts.map((x) => x.id === tf.id ? { ...x, name: tf.name.trim(), ownerId: tf.ownerId || null, repeat: tf.repeat, supply: tf.supply.trim(), color: tf.color } : x));
      // if the shown date changed, move just this occurrence
      if (tf.date && tf.date !== tf.origOcc) moveOccurrence(tf.id, tf.origOcc, tf.date);
    } else {
      setTodos((ts) => [...ts, { id: uid(), name: tf.name.trim(), ownerId: tf.ownerId || null, start: tf.date, repeat: tf.repeat, supply: tf.supply.trim(), color: tf.color, completionLog: [] }]);
    }
    setTf(null);
  }
  function deleteTask(id) {
    setTodos((ts) => ts.filter((x) => x.id !== id));
    setTf(null);
  }

  // move a single occurrence from one date to another (keeps the recurrence)
  function moveOccurrence(todoId, fromDateStr, toDateStr) {
    if (!toDateStr || toDateStr === fromDateStr) return;
    setTodos((ts) => ts.map((t) => {
      if (t.id !== todoId) return t;
      if (!t.repeat || t.repeat.freq === "none") return { ...t, start: toDateStr };
      const moves = { ...(t.moves || {}) };
      let originKey = fromDateStr;
      for (const [orig, dest] of Object.entries(moves)) { if (dest === fromDateStr) { originKey = orig; break; } }
      if (toDateStr === originKey) delete moves[originKey]; // moved back to original
      else moves[originKey] = toDateStr;
      return { ...t, moves };
    }));
  }

  // delete just one occurrence (skip it); once-tasks delete the whole task
  function skipOccurrence(todoId, dateStr) {
    const t = todos.find((x) => x.id === todoId);
    if (!t) return;
    if (!t.repeat || t.repeat.freq === "none") { deleteTask(todoId); return; }
    setTodos((ts) => ts.map((x) => {
      if (x.id !== todoId) return x;
      const moves = { ...(x.moves || {}) };
      let originKey = dateStr;
      for (const [orig, dest] of Object.entries(moves)) { if (dest === dateStr) { originKey = orig; delete moves[originKey]; break; } }
      const skips = Array.from(new Set([...(x.skips || []), originKey]));
      return { ...x, moves, skips };
    }));
  }

  // ─── login ────────────────────────────────────────────
  if (!currentUser) {
    return (
      <div className="phone">
        <div className="login">
          <div className="logo">🏠</div>
          <h1>おうち管理</h1>
          {members.length === 0
            ? (householdCode && syncState === "syncing"
                ? <p>同期中…<br />少しお待ちください</p>
                : <p>ようこそ！<br />まずは家族を追加しましょう</p>)
            : <p>今日は誰として使いますか？</p>}
          <div className="login-grid">
            {members.map((m) => (
              <button key={m.id} className="login-card" onClick={() => setCurrentUser(m.id)}>
                <span className="e">{m.emoji}</span>
                <span className="n">{m.name}</span>
              </button>
            ))}
          </div>
          <button className="link-btn" onClick={() => setMemberForm({ name: "", emoji: "😊", color: COLORS[0], rThresh: "3", rMsg: "" })}>
            ＋ 家族を追加
          </button>

          <div className="login-join">
            {householdCode ? (
              <div className="login-connected">
                <span>🔗 共有中：<b>{householdCode}</b></span>
                <span className="login-conn-state" style={syncState === "error" ? { color: "var(--brand-ink)" } : undefined}>
                  {syncState === "syncing" ? "同期中…" : syncState === "error" ? "接続できません" : "同期済み"}
                </span>
                <button className="login-leave" onClick={() => persistHouseholdCode(null)}>共有を解除</button>
              </div>
            ) : (
              <>
                <div className="login-or">または、家族から共有された方は</div>
                {syncState === "error" && <div className="login-join-err">コードが見つからないか、接続できませんでした</div>}
                <div className="login-join-row">
                  <input value={loginJoinCode} onChange={(e) => setLoginJoinCode(e.target.value)}
                    placeholder="OUCHI-XXXX-XXXX" style={{ textTransform: "uppercase" }}
                    onKeyDown={(e) => { if (e.key === "Enter" && loginJoinCode.trim()) persistHouseholdCode(loginJoinCode.trim().toUpperCase()); }} />
                  <button onClick={() => { const c = loginJoinCode.trim().toUpperCase(); if (c) persistHouseholdCode(c); }}>参加</button>
                </div>
              </>
            )}
          </div>
        </div>
        {memberForm && <MemberEditor mf={memberForm} setMf={setMemberForm} onSave={saveMemberForm} onClose={() => setMemberForm(null)} onDelete={memberForm.id ? () => deleteMember(memberForm.id) : null} />}
      </div>
    );
  }

  function saveMemberForm() {
    const mf = memberForm;
    if (!mf.name.trim()) return;
    const thr = parseInt(mf.rThresh);
    const reward = mf.rMsg.trim() ? { threshold: isNaN(thr) ? 3 : thr, message: mf.rMsg.trim() } : null;
    if (mf.id) setMembers((ms) => ms.map((m) => m.id === mf.id ? { ...m, name: mf.name.trim(), emoji: mf.emoji, color: mf.color, reward } : m));
    else setMembers((ms) => [...ms, { id: uid(), name: mf.name.trim(), emoji: mf.emoji, color: mf.color, reward }]);
    setMemberForm(null);
  }

  function deleteMember(id) {
    setMembers((ms) => ms.filter((m) => m.id !== id));
    setTodos((ts) => ts.map((t) => t.ownerId === id ? { ...t, ownerId: null } : t));
    if (currentUser === id) setCurrentUser(null);
    setMemberForm(null);
  }

  return (
    <div className="phone">
      {DEMO && <div className="demo-banner">🔎 デモ（お試し）— 入力は保存されません</div>}
      {tab === "cal" && (
        <CalendarView
          calMonth={calMonth} setCalMonth={setCalMonth} todos={todos}
          onDay={(ds) => setDaySheet(ds)} isDone={isDone}
        />
      )}
      {tab === "todo" && (
        <TodoView todos={todos} members={members} currentUser={currentUser} isDone={isDone}
          onComplete={toggleComplete} onEdit={(t) => openEditTask(t, TODAY_STR)} />
      )}
      {tab === "shop" && <ShopView shopping={shopping} setShopping={setShopping} />}
      {tab === "more" && (
        <MoreView members={members} todos={todos} currentUser={currentUser} me={me}
          notifyTime={notifyTime} setNotifyTime={setNotifyTime}
          householdCode={householdCode} syncState={syncState} syncErr={syncErr}
          onCreateHousehold={() => persistHouseholdCode(makeHouseholdCode())}
          onJoinHousehold={(code) => { const c = (code || "").trim().toUpperCase(); if (c) persistHouseholdCode(c); }}
          onLeaveHousehold={() => persistHouseholdCode(null)}
          onAddMember={() => setMemberForm({ name: "", emoji: "😊", color: COLORS[0], rThresh: "3", rMsg: "" })}
          onEditMember={(m) => setMemberForm({ id: m.id, name: m.name, emoji: m.emoji, color: m.color, rThresh: m.reward?.threshold?.toString() || "3", rMsg: m.reward?.message || "" })}
          onSwitchUser={() => setCurrentUser(null)} />
      )}

      {/* tab bar */}
      <nav className="tabbar">
        <button className={tab === "cal" ? "on" : ""} onClick={() => setTab("cal")}><span className="ti">📅</span>カレンダー</button>
        <button className={tab === "todo" ? "on" : ""} onClick={() => setTab("todo")}><span className="ti">✓</span>ToDo</button>
        <div className="fab-wrap"><button className="fab" onClick={() => openNewTask()}>＋</button></div>
        <button className={tab === "shop" ? "on" : ""} onClick={() => setTab("shop")}><span className="ti">🛒</span>買い物</button>
        <button className={tab === "more" ? "on" : ""} onClick={() => setTab("more")}><span className="ti">☰</span>その他</button>
      </nav>

      {/* day detail sheet */}
      {daySheet && (
        <DaySheet dateStr={daySheet} todos={todos} members={members} isDone={isDone}
          onClose={() => setDaySheet(null)} onComplete={toggleComplete} onEdit={(t) => { const ds = daySheet; setDaySheet(null); openEditTask(t, ds); }} onMove={moveOccurrence} onSkip={skipOccurrence}
          onAdd={(ds) => { setDaySheet(null); openNewTask(ds); }} />
      )}

      {/* task editor */}
      {tf && !repeatOpen && (
        <TaskEditor tf={tf} setTf={setTf} members={members} onSave={saveTask}
          onClose={() => setTf(null)} onDelete={tf.id ? () => deleteTask(tf.id) : null}
          onOpenRepeat={() => setRepeatOpen(true)} />
      )}
      {tf && repeatOpen && (
        <RepeatEditor start={tf.date} repeat={tf.repeat}
          onChange={(r) => setTf((f) => ({ ...f, repeat: r }))}
          onBack={() => setRepeatOpen(false)} />
      )}

      {/* member editor */}
      {memberForm && <MemberEditor mf={memberForm} setMf={setMemberForm} onSave={saveMemberForm} onClose={() => setMemberForm(null)} onDelete={memberForm.id ? () => deleteMember(memberForm.id) : null} />}

      {/* popups */}
      {supplyPop && (
        <div className="pop-ov">
          <div className="pop">
            <div className="pe">🧴</div>
            <div className="pt">消耗品の確認</div>
            <div className="pd">「<strong>{supplyPop.supply}</strong>」はまだ残っていますか？</div>
            <div className="btn-row">
              <button className="btn g" onClick={supplyNo}>もうない<br /><small style={{ fontWeight: 400 }}>→買い物リストへ</small></button>
              <button className="btn p" onClick={supplyYes}>まだある！</button>
            </div>
          </div>
        </div>
      )}
      {rewardPop && (
        <div className="pop-ov">
          <div className="pop reward-pop">
            <div style={{ fontSize: 30, letterSpacing: 4 }}>🎉✨🎊</div>
            <div className="pt">{rewardPop.message}</div>
            <div className="pd">
              {rewardPop.helperEmoji}<strong>{rewardPop.helperName}</strong>さんが<br />
              {rewardPop.ownerEmoji}<strong>{rewardPop.ownerName}</strong>さんの代わりに<br />
              {rewardPop.count}回がんばりました！
            </div>
            <div className="btn-row"><button className="btn p" onClick={() => setRewardPop(null)}>ありがとう！</button></div>
          </div>
        </div>
      )}
    </div>
  );
}

// ══════════════════════════════════════════════════════════
// Calendar
// ══════════════════════════════════════════════════════════
function CalendarView({ calMonth, setCalMonth, todos, onDay, isDone }) {
  const { y, m } = calMonth;
  const first = new Date(y, m, 1);
  const startPad = first.getDay();
  const cells = [];
  const gridStart = new Date(y, m, 1 - startPad);
  for (let i = 0; i < 42; i++) {
    const d = new Date(gridStart);
    d.setDate(gridStart.getDate() + i);
    cells.push(d);
  }
  // trim trailing full week if unused
  const weeks = cells.length / 7;
  const used = Math.ceil((startPad + new Date(y, m + 1, 0).getDate()) / 7);
  const shown = cells.slice(0, Math.max(used, 5) * 7);

  function eventsFor(d) {
    const ds = fmtD(d);
    const list = [];
    todos.forEach((t) => {
      if (occursOnTodo(t, d)) list.push({ id: t.id, name: t.name, color: t.color, done: isDone(t, ds) });
    });
    return list;
  }

  return (
    <>
      <div className="pheader cal-header">
        <div className="ym">
          <span className="yr">{y}</span>
          <span className="mo">{m + 1}月</span>
          <div className="nav-group">
            <button className="navbtn" onClick={() => setCalMonth((p) => { const d = new Date(p.y, p.m - 1); return { y: d.getFullYear(), m: d.getMonth() }; })}>‹</button>
            <button className="navbtn" onClick={() => setCalMonth((p) => { const d = new Date(p.y, p.m + 1); return { y: d.getFullYear(), m: d.getMonth() }; })}>›</button>
          </div>
        </div>
      </div>
      <div className="cal-dow">
        {DAYS_JP.map((d, i) => <div key={d} className={i === 0 ? "sun" : i === 6 ? "sat" : ""}>{d}</div>)}
      </div>
      <div className="body" style={{ paddingBottom: "calc(var(--tabbar-h) + 8px)" }}>
        <div className="cal-grid">
          {shown.map((d, i) => {
            const inMonth = d.getMonth() === m;
            const ds = fmtD(d);
            const isToday = ds === TODAY_STR;
            const evs = eventsFor(d);
            const wd = d.getDay();
            return (
              <div key={i} className={`cal-cell${inMonth ? "" : " other"}${isToday ? " today" : ""}${wd === 0 ? " sun" : wd === 6 ? " sat" : ""}`}
                onClick={() => onDay(ds)}>
                <div className="dn">{d.getDate()}</div>
                {evs.slice(0, 3).map((e) => (
                  <div key={e.id} className={`cal-ev${e.done ? " done" : ""}`} style={{ background: e.color + "22", color: e.color }}>{e.name}</div>
                ))}
                {evs.length > 3 && <div className="cal-more">+{evs.length - 3}</div>}
              </div>
            );
          })}
        </div>
      </div>
    </>
  );
}

// ══════════════════════════════════════════════════════════
// Day detail sheet
// ══════════════════════════════════════════════════════════
function DaySheet({ dateStr, todos, members, isDone, onClose, onComplete, onEdit, onMove, onSkip, onAdd }) {
  const d = parseD(dateStr);
  const list = todos.filter((t) => occursOnTodo(t, d));
  const label = `${d.getMonth() + 1}月${d.getDate()}日（${DAYS_JP[d.getDay()]}）`;
  const [moving, setMoving] = useState(null); // todoId being moved
  return (
    <div className="sheet-ov" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="sheet">
        <div className="sheet-handle" />
        <h3>{label}</h3>
        {list.length === 0 && <div className="empty">この日の予定はありません</div>}
        {list.map((t) => {
          const owner = members.find((m) => m.id === t.ownerId);
          const done = isDone(t, dateStr);
          const from = movedFrom(t, dateStr);
          return (
            <div key={t.id} className="tcard">
              <button className={`ck${done ? " on" : ""}`} onClick={() => onComplete(t.id, dateStr)}>✓</button>
              <div className="tbody">
                <div className="tname" onClick={() => onEdit(t)} style={{ textDecoration: done ? "line-through" : "none", opacity: done ? 0.5 : 1 }}>
                  <span style={{ color: t.color }}>●</span> {t.isReward && "🎁 "}{t.name}
                </div>
                <div className="tmeta">
                  {owner && <span className="chip owner">{owner.emoji} {owner.name}</span>}
                  <span className="chip rpt">🔁 {repeatShort(t.repeat, t.start)}</span>
                  {t.supply && <span className="chip sup">🧴 {t.supply}</span>}
                  {from && <span className="chip moved">🔀 {fmtMD(from)}から移動</span>}
                </div>
                {moving === t.id ? (
                  <div className="move-row">
                    <span>移動先：</span>
                    <input type="date" defaultValue={dateStr}
                      onChange={(e) => { onMove(t.id, dateStr, e.target.value); setMoving(null); }} />
                    <button className="asbtn" onClick={() => setMoving(null)}>やめる</button>
                  </div>
                ) : (
                  <div className="move-actions">
                    <button className="move-btn" onClick={() => setMoving(t.id)}>📅 この日をずらす</button>
                    {(t.repeat && t.repeat.freq !== "none") && (
                      <button className="move-btn move-del" onClick={() => { if (confirm("この日の予定だけ削除します（繰り返し全体は残ります）。よろしいですか？")) onSkip(t.id, dateStr); }}>
                        🗑 この日だけ削除
                      </button>
                    )}
                  </div>
                )}
              </div>
            </div>
          );
        })}
        <button className="day-add" onClick={() => onAdd(dateStr)}>＋ この日にタスクを追加</button>
      </div>
    </div>
  );
}

// ══════════════════════════════════════════════════════════
// ToDo view (today + overdue)
// ══════════════════════════════════════════════════════════
function TodoView({ todos, members, currentUser, isDone, onComplete, onEdit }) {
  const items = useMemo(() => {
    const res = [];
    todos.forEach((t) => {
      // overdue: occurrences in last 45 days not completed
      const overdue = [];
      for (let i = 45; i >= 1; i--) {
        const d = new Date(TODAY); d.setDate(d.getDate() - i);
        if (occursOnTodo(t, d) && !isDone(t, fmtD(d))) overdue.push(fmtD(d));
      }
      const dueToday = occursOnTodo(t, TODAY);
      if (dueToday || overdue.length) res.push({ t, dueToday, overdue, doneToday: isDone(t, TODAY_STR) });
    });
    return res;
  }, [todos]);

  const mine = items.filter((x) => x.t.ownerId === currentUser);
  const others = items.filter((x) => x.t.ownerId !== currentUser);

  const Card = ({ x }) => {
    const { t, overdue, doneToday } = x;
    const owner = members.find((m) => m.id === t.ownerId);
    return (
      <div className={`tcard${overdue.length ? " overdue" : ""}`}>
        <button className={`ck${doneToday ? " on" : ""}`} onClick={() => onComplete(t.id, TODAY_STR)}>✓</button>
        <div className="tbody" onClick={() => onEdit(t)}>
          <div className="tname" style={{ textDecoration: doneToday ? "line-through" : "none", opacity: doneToday ? 0.5 : 1 }}>
            {t.isReward && "🎁 "}{t.name}
          </div>
          <div className="tmeta">
            {owner && <span className="chip owner">{owner.emoji} {owner.name}</span>}
            <span className="chip rpt">🔁 {repeatShort(t.repeat, t.start)}</span>
            {t.supply && <span className="chip sup">🧴 {t.supply}</span>}
            {overdue.length > 0 && <span className="chip due">⚠️ 未完了{overdue.length}回</span>}
          </div>
        </div>
      </div>
    );
  };

  return (
    <>
      <div className="pheader">
        <div className="pheader-top">
          <span className="pheader-spacer" />
          <span className="pheader-title">今日のやること</span>
          <span className="pheader-spacer" />
        </div>
      </div>
      <div className="body">
        {mine.length > 0 && <div className="section-label">✋ 自分のタスク</div>}
        {mine.map((x) => <Card key={x.t.id} x={x} />)}
        {others.length > 0 && <div className="section-label">👨‍👩‍👧‍👦 みんなのタスク</div>}
        {others.map((x) => <Card key={x.t.id} x={x} />)}
        {items.length === 0 && <div className="empty">今日やることはありません 🎉<br /><span style={{ fontSize: 12 }}>＋ボタンでタスクを追加できます</span></div>}
      </div>
    </>
  );
}

// ══════════════════════════════════════════════════════════
// Shopping
// ══════════════════════════════════════════════════════════
function ShopView({ shopping, setShopping }) {
  const [text, setText] = useState("");
  function add() {
    if (!text.trim()) return;
    setShopping((s) => [...s, { id: uid(), name: text.trim(), done: false }]);
    setText("");
  }
  return (
    <>
      <div className="pheader">
        <div className="pheader-top">
          <span className="pheader-spacer" />
          <span className="pheader-title">🛒 買い物リスト</span>
          <span className="pheader-spacer" />
        </div>
      </div>
      <div className="body">
        <div className="field" style={{ display: "flex", gap: 8, alignItems: "flex-end" }}>
          <div style={{ flex: 1 }}>
            <label>アイテムを追加</label>
            <input placeholder="例：牛乳" value={text} onChange={(e) => setText(e.target.value)} onKeyDown={(e) => e.key === "Enter" && add()} />
          </div>
          <button className="btn p" style={{ flex: "0 0 72px", padding: 12 }} onClick={add}>追加</button>
        </div>
        <div style={{ height: 12 }} />
        {shopping.length === 0 && <div className="empty">リストは空です<br /><span style={{ fontSize: 12 }}>家事の完了時に消耗品も自動で追加されます</span></div>}
        {shopping.map((i) => (
          <div key={i.id} className="shop-row">
            <button className={`sc${i.done ? " on" : ""}`} onClick={() => setShopping((s) => s.map((x) => x.id === i.id ? { ...x, done: !x.done } : x))}>✓</button>
            <span className="sn" style={{ textDecoration: i.done ? "line-through" : "none", opacity: i.done ? 0.5 : 1 }}>{i.name}</span>
            <button className="del" onClick={() => setShopping((s) => s.filter((x) => x.id !== i.id))}>🗑</button>
          </div>
        ))}
      </div>
    </>
  );
}

// ══════════════════════════════════════════════════════════
// More (members, reward stats, settings)
// ══════════════════════════════════════════════════════════
function MoreView({ members, todos, currentUser, me, notifyTime, setNotifyTime, householdCode, syncState, syncErr, onCreateHousehold, onJoinHousehold, onLeaveHousehold, onAddMember, onEditMember, onSwitchUser }) {
  const [joinCode, setJoinCode] = useState("");
  const [copied, setCopied] = useState(false);
  const [linkCopied, setLinkCopied] = useState(false);
  const [showHelp, setShowHelp] = useState(false);
  const [pushOn, setPushOn] = useState(false);
  const [pushBusy, setPushBusy] = useState(false);
  const [pushMsg, setPushMsg] = useState("");
  useEffect(() => { isPushEnabled().then(setPushOn).catch(() => {}); }, []);
  async function togglePush() {
    setPushBusy(true); setPushMsg("");
    try {
      if (pushOn) { await disablePush(); setPushOn(false); }
      else { await enablePush(notifyTime, householdCode); setPushOn(true); }
    } catch (e) { setPushMsg(e?.message || "失敗しました"); }
    setPushBusy(false);
  }
  function changeNotifyTime(v) {
    setNotifyTime(v);
    if (pushOn) updatePushTime(v, householdCode).catch(() => {});
  }
  const syncLabel = { idle: "", syncing: "同期中…", ok: "同期済み", error: "オフライン" }[syncState] || "";
  const shareUrl = householdCode ? `${window.location.origin}${window.location.pathname}?join=${householdCode}` : "";
  function copyCode() {
    try { navigator.clipboard?.writeText(householdCode); } catch {}
    setCopied(true); setTimeout(() => setCopied(false), 1500);
  }
  async function shareLink() {
    if (navigator.share) {
      try { await navigator.share({ title: "おうち管理", text: "このリンクからおうちに参加してね🏠", url: shareUrl }); } catch {}
    } else {
      try { await navigator.clipboard?.writeText(shareUrl); } catch {}
      setLinkCopied(true); setTimeout(() => setLinkCopied(false), 1500);
    }
  }

  // reward matrix
  const subMatrix = useMemo(() => {
    const mx = {};
    todos.forEach((t) => {
      if (!t.ownerId) return;
      (t.completionLog || []).forEach((l) => {
        if (!l.isSub) return;
        mx[t.ownerId] = mx[t.ownerId] || {};
        mx[t.ownerId][l.doerId] = (mx[t.ownerId][l.doerId] || 0) + 1;
      });
    });
    return mx;
  }, [todos]);

  const subsForMe = Object.entries(subMatrix[currentUser] || {}).map(([hid, c]) => ({ helper: members.find((m) => m.id === hid), cnt: c }));
  const mySubs = Object.entries(subMatrix).flatMap(([oid, hs]) =>
    Object.entries(hs).filter(([hid]) => hid === currentUser).map(([, c]) => ({ owner: members.find((m) => m.id === oid), cnt: c })));

  return (
    <>
      <div className="pheader">
        <div className="pheader-top">
          <span className="pheader-spacer" />
          <span className="pheader-title">その他</span>
          <span className="pheader-spacer" />
        </div>
      </div>
      <div className="body">
        <div className="list-group" style={{ marginTop: 16 }}>
          <div className="list-row tappable" onClick={() => setShowHelp(true)}>
            <span className="lr-label" style={{ fontWeight: 600 }}>❓ 使い方</span>
            <span className="lr-value">›</span>
          </div>
        </div>

        {/* ── おうち共有（クラウド同期） ── */}
        <div className="list-group">
          <div className="list-title">🔗 おうち共有（端末間で同期）</div>
          {householdCode ? (
            <>
              <div className="list-row">
                <span className="lr-label">おうちコード</span>
                <span className="lr-value" style={{ fontFamily: "'DM Sans',monospace", color: "var(--ink)", letterSpacing: ".02em" }}>{householdCode}</span>
              </div>
              <div className="list-row">
                <span className="lr-label">状態</span>
                <span className="lr-value">{syncLabel}</span>
              </div>
              {syncState === "error" && syncErr && (
                <div className="list-row" style={{ minHeight: 0, padding: "4px 16px 10px" }}>
                  <span style={{ fontSize: 11, color: "var(--brand-ink)", wordBreak: "break-all" }}>詳細: {syncErr}</span>
                </div>
              )}
              <div className="list-row tappable" onClick={shareLink}>
                <span className="lr-label" style={{ color: "var(--brand-ink)", fontWeight: 700 }}>{linkCopied ? "リンクをコピーしました ✓" : "🔗 参加リンクを送る"}</span>
              </div>
              <div className="list-row tappable" onClick={copyCode}>
                <span className="lr-label" style={{ color: "var(--brand-ink)" }}>{copied ? "コピーしました ✓" : "コードをコピー"}</span>
              </div>
              <div className="list-row tappable" onClick={onLeaveHousehold}>
                <span className="lr-label" style={{ color: "var(--brand-ink)" }}>共有をやめる（この端末のみに戻す）</span>
              </div>
            </>
          ) : (
            <>
              <div className="list-row tappable" onClick={onCreateHousehold}>
                <span className="lr-label" style={{ color: "var(--brand-ink)" }}>＋ 新しいおうちを作成して共有</span>
              </div>
              <div className="list-row" style={{ gap: 8 }}>
                <input value={joinCode} onChange={(e) => setJoinCode(e.target.value)} placeholder="OUCHI-XXXX-XXXX"
                  style={{ flex: 1, border: "none", background: "transparent", fontFamily: "'DM Sans',monospace", fontSize: 15, outline: "none", textTransform: "uppercase" }} />
                <button className="asbtn" style={{ color: "var(--brand-ink)", fontWeight: 700 }} onClick={() => { onJoinHousehold(joinCode); setJoinCode(""); }}>参加</button>
              </div>
              <div className="list-title" style={{ paddingTop: 4 }}>家族の「おうちコード」を入れると、同じデータを共有できます。</div>
            </>
          )}
        </div>

        <div className="list-group">
          <div className="list-title">🏅 代行記録（{me?.emoji}{me?.name}）</div>
          {subsForMe.length === 0 && mySubs.length === 0 && <div className="list-row"><span className="lr-label" style={{ color: "var(--ink3)" }}>まだ記録がありません</span></div>}
          {subsForMe.map((s, i) => (
            <div key={"f" + i} className="list-row">
              <span className="lr-label">{s.helper?.emoji} {s.helper?.name}さんに助けてもらった</span>
              <span className="lr-value">{s.cnt}回</span>
            </div>
          ))}
          {mySubs.map((s, i) => (
            <div key={"s" + i} className="list-row">
              <span className="lr-label">{s.owner?.emoji} {s.owner?.name}さんを代行した</span>
              <span className="lr-value">{s.cnt}回</span>
            </div>
          ))}
        </div>

        <div className="list-group">
          <div className="list-title">🔔 通知</div>
          <div className="list-row">
            <span className="lr-label">毎日の通知時刻</span>
            <input className="lr-date" type="time" value={notifyTime} onChange={(e) => changeNotifyTime(e.target.value)} />
          </div>
          {pushSupported() ? (
            <div className="list-row tappable" onClick={() => !pushBusy && togglePush()}>
              <span className="lr-label">プッシュ通知</span>
              <span className="lr-value" style={{ color: pushOn ? "var(--sage)" : "var(--brand-ink)", fontWeight: 700 }}>
                {pushBusy ? "…" : pushOn ? "オン ✓（タップでオフ）" : "オンにする"}
              </span>
            </div>
          ) : (
            <div className="list-row"><span className="lr-label" style={{ color: "var(--ink3)" }}>この端末はプッシュ通知に非対応</span></div>
          )}
          {pushMsg && (
            <div className="list-row" style={{ minHeight: 0, padding: "4px 16px 10px" }}>
              <span style={{ fontSize: 11, color: "var(--brand-ink)" }}>{pushMsg}</span>
            </div>
          )}
          <div className="list-title" style={{ paddingTop: 4 }}>
            ※ iPhoneは「ホーム画面に追加」したアプリから開いて有効化してください。
          </div>
        </div>

        <div className="list-group">
          <div className="list-title">👨‍👩‍👧‍👦 メンバー</div>
          {members.map((m) => (
            <div key={m.id} className="list-row tappable" onClick={() => onEditMember(m)}>
              <span className="lr-label"><span style={{ fontSize: 20 }}>{m.emoji}</span> {m.name}</span>
              <span className="lr-value">{m.reward ? `${m.reward.threshold}回→${m.reward.message}` : ""} ›</span>
            </div>
          ))}
          <div className="list-row tappable" onClick={onAddMember}><span className="lr-label" style={{ color: "var(--g3)" }}>＋ メンバーを追加</span></div>
        </div>

        <div className="btn-row"><button className="btn g" onClick={onSwitchUser}>ユーザーを切り替え</button></div>
      </div>
      {showHelp && <HelpScreen onClose={() => setShowHelp(false)} />}
    </>
  );
}

// ══════════════════════════════════════════════════════════
// Help / usage guide screen
// ══════════════════════════════════════════════════════════
function HelpScreen({ onClose }) {
  return (
    <div className="screen">
      <div className="pheader">
        <div className="pheader-top">
          <button className="pheader-back" onClick={onClose}>‹</button>
          <span className="pheader-title">使い方</span>
          <span className="pheader-spacer" />
        </div>
      </div>
      <div className="body help">
        <h2>🏠 このアプリは？</h2>
        <p className="lead">家事を「定期タスク」として家族みんなで回すためのアプリです。誰が・いつ・何をやるかをカレンダーで見える化し、家事と買い物をひとつにつなげます。</p>
        <ul>
          <li>🔁 繰り返す家事を自動で管理（毎日・毎週・毎月・毎年）</li>
          <li>🧴 家事と買い物が連動（完了時に消耗品を確認して自動追加）</li>
          <li>👪 家族で共有（同じ「おうちコード」でリアルタイム同期）</li>
        </ul>

        <h2>📱 はじめ方</h2>
        <div className="step"><b>① 家族を登録</b><p>最初の画面で「＋家族を追加」。名前・絵文字・色を決めます。</p></div>
        <div className="step"><b>② おうちを作る</b><p>この「その他」タブ →「＋新しいおうちを作成して共有」。おうちコードが発行されます。</p></div>
        <div className="step"><b>③ 家族を招待</b><p>「🔗 参加リンクを送る」でLINE等に共有。家族はリンクをタップ→自分を選ぶだけで参加できます。</p></div>

        <h2>🗓 毎日の使い方</h2>
        <p><span className="tag">カレンダー</span>今月の家事を一覧。日をタップで完了チェック（先の予定を前倒しでやってもOK）。</p>
        <p><span className="tag">ToDo</span>今日やること＋やり残しを表示。○をタップで完了。</p>
        <p><span className="tag">買い物</span>足りない物を追加。家事の完了時にも自動で増えます。</p>
        <p><span className="tag">その他</span>家族・通知時刻・代行記録・共有の設定。</p>

        <h2>➕ タスクの追加</h2>
        <p>下中央の <b>＋</b> ボタンから、名前・担当・繰り返し・消耗品・色を設定して追加します。</p>

        <h2>🧴 消耗品の連携</h2>
        <p>タスクに消耗品（例：洗剤）を紐づけておくと、完了時に「まだある？／もうない」を確認。「もうない」を選ぶと買い物リストに自動で追加されます。</p>

        <h2>👪 代行のごほうび</h2>
        <p>担当じゃない家事を代わりにやると記録され、設定した回数に達するとリクエスト（例：お菓子買ってきて）が届きます。メンバー編集から設定できます。</p>

        <div className="btn-row"><button className="btn p" onClick={onClose}>とじる</button></div>
      </div>
    </div>
  );
}

// ══════════════════════════════════════════════════════════
// Task editor screen
// ══════════════════════════════════════════════════════════
function TaskEditor({ tf, setTf, members, onSave, onClose, onDelete, onOpenRepeat }) {
  const [confirmDel, setConfirmDel] = useState(false);
  return (
    <div className="screen">
      <div className="pheader">
        <div className="pheader-top">
          <button className="pheader-back" onClick={onClose}>✕</button>
          <span className="pheader-title">{tf.id ? "タスクを編集" : "タスクを追加"}</span>
          <span className="pheader-spacer" />
        </div>
      </div>
      <div className="body">
        <div className="field">
          <label>タスク名</label>
          <input placeholder="例：お風呂掃除" value={tf.name} onChange={(e) => setTf((f) => ({ ...f, name: e.target.value }))} autoFocus />
        </div>
        <div className="field">
          <label>担当（オーナー）</label>
          <select value={tf.ownerId} onChange={(e) => setTf((f) => ({ ...f, ownerId: e.target.value }))}>
            <option value="">なし</option>
            {members.map((m) => <option key={m.id} value={m.id}>{m.emoji} {m.name}</option>)}
          </select>
        </div>
        <div className="field">
          <label>日付</label>
          <input type="date" value={tf.date} onChange={(e) => setTf((f) => ({ ...f, date: e.target.value }))}
            style={{ width: "auto", maxWidth: "100%", padding: "10px 13px" }} />
          {tf.id && tf.repeat?.freq !== "none" && (
            <div className="list-title" style={{ padding: "6px 0 0" }}>この日だけ移動します（繰り返し全体は変わりません）。</div>
          )}
        </div>

        <div className="nav-row" onClick={onOpenRepeat}>
          <span className="nr-label">繰り返し</span>
          <span className="nr-value">{repeatSummary(tf.repeat, tf.date)}</span>
          <span className="nr-arrow">›</span>
        </div>

        <div className="field">
          <label>消耗品（完了時に残量を確認）</label>
          <input placeholder="例：バスクリーナー（任意）" value={tf.supply} onChange={(e) => setTf((f) => ({ ...f, supply: e.target.value }))} />
        </div>
        <div className="field">
          <label>カレンダーの色</label>
          <div className="color-row">
            {COLORS.map((c) => (
              <button key={c} className={`color-dot${tf.color === c ? " on" : ""}`} style={{ background: c }} onClick={() => setTf((f) => ({ ...f, color: c }))} />
            ))}
          </div>
        </div>

        <div className="btn-row">
          <button className="btn g" onClick={onClose}>キャンセル</button>
          <button className="btn p" onClick={onSave}>{tf.id ? "保存" : "追加する"}</button>
        </div>
        {onDelete && (
          <div className="field" style={{ marginTop: 8 }}>
            {confirmDel ? (
              <div className="btn-row" style={{ padding: 0 }}>
                <button className="btn g" onClick={() => setConfirmDel(false)}>やめる</button>
                <button className="btn" style={{ background: "var(--brand)", color: "#fff" }} onClick={onDelete}>本当に削除する</button>
              </div>
            ) : (
              <button className="link-btn" style={{ width: "100%", borderColor: "#e3b8ab", color: "var(--brand-ink)" }} onClick={() => setConfirmDel(true)}>
                🗑 このタスクを削除
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

// ══════════════════════════════════════════════════════════
// Repeat editor screen (matches screenshots)
// ══════════════════════════════════════════════════════════
function RepeatEditor({ start, repeat, onChange, onBack }) {
  const startD = parseD(start);
  const r = repeat || { freq: "none" };

  function setFreq(freq) {
    if (freq === "none") return onChange({ freq: "none" });
    if (freq === "daily") return onChange({ freq: "daily", interval: r.interval || 1, until: r.until || null });
    if (freq === "weekly") return onChange({ freq: "weekly", interval: r.interval || 1, weekdays: r.weekdays?.length ? r.weekdays : [startD.getDay()], until: r.until || null });
    if (freq === "monthly") {
      const nth = nthOfMonth(startD);
      return onChange({ freq: "monthly", interval: r.interval || 1, mode: r.mode || "date", date: startD.getDate(), nth: nth.nth, weekday: nth.weekday, until: r.until || null });
    }
    if (freq === "yearly") return onChange({ freq: "yearly", interval: r.interval || 1, month: startD.getMonth() + 1, date: startD.getDate(), until: r.until || null });
  }
  const patch = (p) => onChange({ ...r, ...p });
  const setInterval = (v) => patch({ interval: Math.max(1, parseInt(v) || 1) });
  const setUntil = (v) => patch({ until: v || null });
  const defaultUntil = () => { const d = new Date(startD); d.setFullYear(d.getFullYear() + 1); return fmtD(d); };

  const FREQS = [["none", "なし"], ["daily", "毎日"], ["weekly", "毎週"], ["monthly", "毎月"], ["yearly", "毎年"]];

  return (
    <div className="screen">
      <div className="pheader">
        <div className="pheader-top">
          <button className="pheader-back" onClick={onBack}>‹</button>
          <span className="pheader-title">繰り返し</span>
          <span className="pheader-spacer" />
        </div>
      </div>
      <div className="body">
        <div className="repeat-summary">{repeatSummary(r, start)}</div>

        <div className="seg">
          {FREQS.map(([f, label]) => (
            <button key={f} className={r.freq === f ? "on" : ""} onClick={() => setFreq(f)}>{label}</button>
          ))}
        </div>

        {/* weekly: weekday circles */}
        {r.freq === "weekly" && (
          <div className="wk-row">
            {DAYS_JP.map((d, i) => (
              <button key={i} className={`wk-btn${(r.weekdays || []).includes(i) ? " on" : ""}`}
                onClick={() => {
                  const has = (r.weekdays || []).includes(i);
                  const next = has ? r.weekdays.filter((x) => x !== i) : [...(r.weekdays || []), i];
                  patch({ weekdays: next.length ? next : [i] });
                }}>{d}</button>
            ))}
          </div>
        )}

        {/* monthly: 基準 */}
        {r.freq === "monthly" && (() => {
          const nth = nthOfMonth(startD);
          const nl = `第${nth.nth + 1}${DAYS_JP[nth.weekday]}曜日`;
          return (
            <div className="list-group" style={{ marginTop: 22 }}>
              <div className="list-title">基準</div>
              <div className="list-row tappable" onClick={() => patch({ mode: "date", date: startD.getDate() })}>
                <span className="lr-label">{startD.getDate()}日に繰り返す</span>
                {r.mode !== "nth" && <span className="chk">✓</span>}
              </div>
              <div className="list-row tappable" onClick={() => patch({ mode: "nth", nth: nth.nth, weekday: nth.weekday })}>
                <span className="lr-label">{nl}に繰り返す</span>
                {r.mode === "nth" && <span className="chk">✓</span>}
              </div>
            </div>
          );
        })()}

        {/* interval + until */}
        {r.freq !== "none" && (
          <div className="list-group" style={{ marginTop: r.freq === "weekly" ? 22 : (r.freq === "monthly" ? 0 : 22) }}>
            {r.freq !== "yearly" && (
              <div className="list-row">
                <span className="lr-label">間隔</span>
                <span className="lr-value">
                  <input className="lr-num" type="number" min="1" value={r.interval || 1} onChange={(e) => setInterval(e.target.value)} />
                  {r.freq === "daily" ? "日ごと" : r.freq === "weekly" ? "週間ごと" : "ヶ月ごと"}
                </span>
              </div>
            )}
            <div className="list-row">
              <span className="lr-label">終了日</span>
              <span className="lr-value">
                {r.until ? (
                  <>
                    <input className="lr-date" type="date" value={r.until} onChange={(e) => setUntil(e.target.value)} />
                    <button className="clear-btn" onClick={() => setUntil("")}>✕</button>
                  </>
                ) : (
                  <button className="asbtn" onClick={() => setUntil(defaultUntil())}>なし ›</button>
                )}
              </span>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// ══════════════════════════════════════════════════════════
// Member editor
// ══════════════════════════════════════════════════════════
function MemberEditor({ mf, setMf, onSave, onClose, onDelete }) {
  const [confirmDel, setConfirmDel] = useState(false);
  return (
    <div className="screen">
      <div className="pheader">
        <div className="pheader-top">
          <button className="pheader-back" onClick={onClose}>✕</button>
          <span className="pheader-title">{mf.id ? "メンバーを編集" : "メンバーを追加"}</span>
          <span className="pheader-spacer" />
        </div>
      </div>
      <div className="body">
        <div className="field">
          <label>名前</label>
          <input placeholder="例：お母さん" value={mf.name} onChange={(e) => setMf((f) => ({ ...f, name: e.target.value }))} autoFocus />
        </div>
        <div className="field"><label>絵文字</label></div>
        <div className="emoji-grid">
          {EMOJIS.map((e) => <button key={e} className={`emoji-btn${mf.emoji === e ? " on" : ""}`} onClick={() => setMf((f) => ({ ...f, emoji: e }))}>{e}</button>)}
        </div>
        <div className="field"><label>色</label></div>
        <div className="color-row">
          {COLORS.map((c) => <button key={c} className={`color-dot${mf.color === c ? " on" : ""}`} style={{ background: c }} onClick={() => setMf((f) => ({ ...f, color: c }))} />)}
        </div>
        <div className="field"><label>代行報酬のしきい値（回）</label>
          <input type="number" min="1" placeholder="3" value={mf.rThresh} onChange={(e) => setMf((f) => ({ ...f, rThresh: e.target.value }))} />
        </div>
        <div className="field"><label>リクエストメッセージ（任意）</label>
          <input placeholder="例：お菓子買ってきて🫶" value={mf.rMsg} onChange={(e) => setMf((f) => ({ ...f, rMsg: e.target.value }))} />
        </div>
        <div className="btn-row">
          <button className="btn g" onClick={onClose}>キャンセル</button>
          <button className="btn p" onClick={onSave}>{mf.id ? "保存" : "追加"}</button>
        </div>
        {onDelete && (
          <div className="field" style={{ marginTop: 8 }}>
            {confirmDel ? (
              <div className="btn-row" style={{ padding: 0 }}>
                <button className="btn g" onClick={() => setConfirmDel(false)}>やめる</button>
                <button className="btn" style={{ background: "var(--brand)", color: "#fff" }} onClick={onDelete}>本当に削除する</button>
              </div>
            ) : (
              <button className="link-btn" style={{ width: "100%", borderColor: "#e3b8ab", color: "var(--brand-ink)" }} onClick={() => setConfirmDel(true)}>
                🗑 このメンバーを削除
              </button>
            )}
            <div className="list-title" style={{ padding: "8px 0 0" }}>削除すると、この人が担当のタスクは「担当なし」に戻ります。</div>
          </div>
        )}
      </div>
    </div>
  );
}
