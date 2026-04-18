import { useState, useMemo, useEffect } from "react";

const STORAGE_KEY = "ouchi_current_user";

// ─── utils ────────────────────────────────────────────────────────
const uid = () => Math.random().toString(36).slice(2, 9);
const DAYS_JP = ["日","月","火","水","木","金","土"];
const today = new Date();
today.setHours(0,0,0,0);

function dateStr(d) {
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}`;
}
const todayStr = dateStr(today);

function fmtMD(str) {
  // "YYYY-MM-DD" → "M/D"
  const [,mo,da] = str.split("-");
  return `${parseInt(mo)}/${parseInt(da)}`;
}

// ─── repeat ───────────────────────────────────────────────────────
// types: "once" | "weekly" | "monthly_date" | "monthly_nth"
// monthly_nth shape: { nth: 0|1|2|3|"last", weekday: 0-6 }

function getNthWeekdayInMonth(year, month, nth, weekday) {
  if (nth === "last") {
    const d = new Date(year, month+1, 0);
    while (d.getDay() !== weekday) d.setDate(d.getDate()-1);
    return d.getDate();
  }
  let count = -1;
  const d = new Date(year, month, 1);
  while (d.getMonth() === month) {
    if (d.getDay() === weekday) { count++; if (count === nth) return d.getDate(); }
    d.setDate(d.getDate()+1);
  }
  return null;
}

// All due dates of a repeat from a given date back N months, for overdue detection
function getDueDatesInRange(repeat, fromDate, toDate) {
  const results = [];
  if (repeat.type === "once") return [];
  const from = new Date(fromDate); from.setHours(0,0,0,0);
  const to   = new Date(toDate);   to.setHours(0,0,0,0);

  if (repeat.type === "weekly") {
    const d = new Date(from);
    while (d <= to) {
      if (repeat.days?.includes(DAYS_JP[d.getDay()])) results.push(dateStr(d));
      d.setDate(d.getDate()+1);
    }
  } else if (repeat.type === "monthly_date") {
    const d = new Date(from.getFullYear(), from.getMonth(), 1);
    while (d <= to) {
      (repeat.dates||[]).forEach(date => {
        const candidate = new Date(d.getFullYear(), d.getMonth(), date);
        if (candidate >= from && candidate <= to) results.push(dateStr(candidate));
      });
      d.setMonth(d.getMonth()+1);
    }
  } else if (repeat.type === "monthly_nth") {
    const d = new Date(from.getFullYear(), from.getMonth(), 1);
    while (d <= to) {
      const date = getNthWeekdayInMonth(d.getFullYear(), d.getMonth(), repeat.nth, repeat.weekday);
      if (date) {
        const candidate = new Date(d.getFullYear(), d.getMonth(), date);
        if (candidate >= from && candidate <= to) results.push(dateStr(candidate));
      }
      d.setMonth(d.getMonth()+1);
    }
  }
  return results;
}

function repeatLabel(r) {
  if (!r) return "";
  if (r.type === "once")          return "単発";
  if (r.type === "weekly")        return `毎週 ${r.days?.join("・")}`;
  if (r.type === "monthly_date")  return `毎月 ${r.dates?.join("・")}日`;
  if (r.type === "monthly_nth") {
    const nl = r.nth === "last" ? "最終" : `第${r.nth+1}`;
    return `毎月${nl}${DAYS_JP[r.weekday]}曜`;
  }
  return "";
}

// Is this repeat due today or overdue (has a due date ≤ today not yet completed)?
// Returns { dueToday: bool, overdueDates: ["YYYY-MM-DD",...] }
function getDueStatus(repeat, completionLog) {
  if (repeat.type === "once") return { dueToday: true, overdueDates: [] };

  // look back up to 90 days
  const lookback = new Date(today);
  lookback.setDate(lookback.getDate() - 90);

  const allDueDates = getDueDatesInRange(repeat, lookback, today);
  if (allDueDates.length === 0) return { dueToday: false, overdueDates: [] };

  // which of those are completed?
  const completedOn = new Set((completionLog||[]).map(l => l.date.slice(0,10)));

  // For each due date, find the most recent completion on or after that date
  // Simple approach: a due date is "satisfied" if there's a completion recorded on that exact date
  // or between that due date and the next due date
  const overdueDates = [];
  for (let i = 0; i < allDueDates.length; i++) {
    const dueDate   = allDueDates[i];
    const nextDue   = allDueDates[i+1] || todayStr;
    // Is there a completion in [dueDate, nextDue)?
    const satisfied = [...completedOn].some(cd => cd >= dueDate && cd < nextDue);
    if (!satisfied && dueDate < todayStr) overdueDates.push(dueDate);
  }

  const dueToday = allDueDates[allDueDates.length-1] === todayStr;
  return { dueToday, overdueDates };
}

// ─── seed data ────────────────────────────────────────────────────
const SEED_MEMBERS = [
  { id:"m1", name:"お母さん", emoji:"👩", reward:{ threshold:3, message:"お菓子買ってきて🫶" } },
  { id:"m2", name:"お父さん", emoji:"👨", reward:{ threshold:3, message:"コーヒー奢って☕" } },
  { id:"m3", name:"長女",     emoji:"👧", reward:{ threshold:5, message:"ジュース買って🧃" } },
  { id:"m4", name:"長男",     emoji:"🧒", reward:null },
];

const SEED_TODOS = [
  { id:uid(), name:"お風呂掃除",  ownerId:"m1", repeat:{type:"weekly",days:["月","木"]},         supply:"バスクリーナー",  completionLog:[] },
  { id:uid(), name:"ゴミ捨て",    ownerId:"m2", repeat:{type:"weekly",days:["火","金"]},          supply:"",               completionLog:[] },
  { id:uid(), name:"トイレ掃除",  ownerId:"m1", repeat:{type:"monthly_nth",nth:2,weekday:5},      supply:"トイレクリーナー", completionLog:[] },
  { id:uid(), name:"シーツ交換",  ownerId:"m3", repeat:{type:"monthly_date",dates:[1]},           supply:"",               completionLog:[] },
  { id:uid(), name:"窓拭き",      ownerId:"m2", repeat:{type:"monthly_nth",nth:"last",weekday:6}, supply:"窓用クリーナー",  completionLog:[] },
];

// ─── icons ────────────────────────────────────────────────────────
const Ic = {
  Check: ()=><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" width="18" height="18"><polyline points="20 6 9 17 4 12"/></svg>,
  Cart:  ()=><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" width="20" height="20"><circle cx="9" cy="21" r="1"/><circle cx="20" cy="21" r="1"/><path d="M1 1h4l2.68 13.39a2 2 0 0 0 2 1.61h9.72a2 2 0 0 0 2-1.61L23 6H6"/></svg>,
  List:  ()=><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" width="20" height="20"><rect x="3" y="5" width="6" height="6" rx="1"/><path d="m3 17 2 2 4-4"/><path d="M13 6h8M13 12h8M13 18h8"/></svg>,
  Cal:   ()=><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" width="20" height="20"><rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>,
  Plus:  ()=><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" width="20" height="20"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>,
  Trash: ()=><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" width="16" height="16"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14H6L5 6"/><path d="M10 11v6M14 11v6"/><path d="M9 6V4h6v2"/></svg>,
  Rpt:   ()=><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" width="12" height="12"><polyline points="17 1 21 5 17 9"/><path d="M3 11V9a4 4 0 0 1 4-4h14"/><polyline points="7 23 3 19 7 15"/><path d="M21 13v2a4 4 0 0 1-4 4H3"/></svg>,
  Medal: ()=><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" width="17" height="17"><circle cx="12" cy="14" r="6"/><path d="M8 6l-2-4h12l-2 4"/><path d="M12 10v4"/></svg>,
  Gift:  ()=><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" width="13" height="13"><polyline points="20 12 20 22 4 22 4 12"/><rect x="2" y="7" width="20" height="5"/><line x1="12" y1="22" x2="12" y2="7"/><path d="M12 7H7.5a2.5 2.5 0 0 1 0-5C11 2 12 7 12 7z"/><path d="M12 7h4.5a2.5 2.5 0 0 0 0-5C13 2 12 7 12 7z"/></svg>,
  Warn:  ()=><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" width="12" height="12"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>,
};

const EMOJIS = ["👩","👨","👧","🧒","👴","👵","🧑","👱","🙋","😊","😎","🐱","🐶","🌸","⭐","🦊"];

// ══════════════════════════════════════════════════════════════════
export default function App() {
  const [currentUser, setCurrentUserRaw] = useState(() => {
    try { return localStorage.getItem(STORAGE_KEY) || null; } catch { return null; }
  });

  function setCurrentUser(id) {
    setCurrentUserRaw(id);
    try {
      if (id) localStorage.setItem(STORAGE_KEY, id);
      else    localStorage.removeItem(STORAGE_KEY);
    } catch {}
  }
  const [members,  setMembers]  = useState(SEED_MEMBERS);
  const [todos,    setTodos]    = useState(SEED_TODOS);
  const [shopping, setShopping] = useState([]);
  const [tab,      setTab]      = useState("todo");

  const [calMonth, setCalMonth] = useState({y:today.getFullYear(), m:today.getMonth()});
  const [selDay,   setSelDay]   = useState(null);

  const [todoModal,   setTodoModal]   = useState(false);
  const [shopModal,   setShopModal]   = useState(false);
  const [statsModal,  setStatsModal]  = useState(false);
  const [memberModal, setMemberModal] = useState(false);
  const [editMember,  setEditMember]  = useState(null);

  const [supplyPop, setSupplyPop] = useState(null);
  const [rewardPop, setRewardPop] = useState(null);

  const emptyTF = {name:"",ownerId:"",repeatType:"once",days:[],dates:"",nthN:"0",nthW:"1",supply:""};
  const [tf, setTf] = useState(emptyTF);
  const [shopItem, setShopItem] = useState("");
  const emptyMF = {name:"",emoji:"😊",rThresh:"3",rMsg:""};
  const [mf, setMf] = useState(emptyMF);

  const me = members.find(m => m.id === currentUser);

  // ── substitute matrix ─────────────────────────────────────────
  const subMatrix = useMemo(() => {
    const mx = {};
    todos.forEach(t => {
      if (!t.ownerId) return;
      (t.completionLog||[]).forEach(l => {
        if (!l.isSub) return;
        if (!mx[t.ownerId]) mx[t.ownerId] = {};
        mx[t.ownerId][l.doerId] = (mx[t.ownerId][l.doerId]||0) + 1;
      });
    });
    return mx;
  }, [todos]);

  // ── complete flow ─────────────────────────────────────────────
  function startComplete(todoId) {
    const t = todos.find(x => x.id === todoId);
    if (!t) return;
    if (t.supply) setSupplyPop({todoId, supply:t.supply});
    else          finishComplete(todoId);
  }
  function supplyYes() { const id=supplyPop.todoId; setSupplyPop(null); finishComplete(id); }
  function supplyNo()  {
    setShopping(s => [...s, {id:uid(), name:supplyPop.supply, done:false}]);
    const id=supplyPop.todoId; setSupplyPop(null); finishComplete(id);
  }

  function finishComplete(todoId) {
    const t = todos.find(x => x.id === todoId);
    if (!t) return;
    const doerId = currentUser;
    const isSub  = !!(t.ownerId && doerId && doerId !== t.ownerId);
    const iso    = new Date().toISOString();
    const newLog = {doerId, date:iso, isSub};

    if (t.repeat.type === "once" || t.isReward) {
      // Single-use: remove from list on completion, after logging
      setTodos(ts => ts
        .map(x => x.id===todoId ? {...x, completionLog:[...(x.completionLog||[]), newLog]} : x)
        .filter(x => x.id !== todoId)
      );
    } else {
      // Recurring: just log, stays in list (will be "satisfied" for this period)
      setTodos(ts => ts.map(x => x.id===todoId
        ? {...x, completionLog:[...(x.completionLog||[]), newLog]}
        : x
      ));
    }

    // check substitute reward
    if (isSub && t.ownerId) {
      const owner = members.find(m => m.id===t.ownerId);
      if (owner?.reward?.threshold) {
        const prevCount = todos
          .filter(x => x.ownerId===t.ownerId)
          .flatMap(x => (x.completionLog||[]).filter(l => l.isSub && l.doerId===doerId))
          .length;
        const newCount = prevCount + 1;
        if (newCount % owner.reward.threshold === 0) {
          const helper = members.find(m => m.id===doerId);
          // Add reward task to owner
          setTodos(ts => [...ts, {
            id:uid(), name:owner.reward.message,
            ownerId:t.ownerId, repeat:{type:"once"},
            supply:"", completionLog:[], isReward:true, rewardFor:doerId,
          }]);
          setRewardPop({
            ownerEmoji:owner.emoji, ownerName:owner.name,
            helperEmoji:helper?.emoji||"👤", helperName:helper?.name||"？",
            message:owner.reward.message, count:newCount,
          });
        }
      }
    }
  }

  // ── add todo ──────────────────────────────────────────────────
  function addTodo() {
    if (!tf.name.trim()) return;
    let repeat;
    if      (tf.repeatType==="weekly")       repeat={type:"weekly",days:tf.days};
    else if (tf.repeatType==="monthly_date") repeat={type:"monthly_date",dates:tf.dates.split(",").map(s=>parseInt(s.trim())).filter(Boolean)};
    else if (tf.repeatType==="monthly_nth")  repeat={type:"monthly_nth",nth:tf.nthN==="last"?"last":parseInt(tf.nthN),weekday:parseInt(tf.nthW)};
    else                                     repeat={type:"once"};
    setTodos(ts => [...ts, {
      id:uid(), name:tf.name.trim(), ownerId:tf.ownerId||null,
      repeat, supply:tf.supply.trim(), completionLog:[],
    }]);
    setTf(emptyTF); setTodoModal(false);
  }

  // ── members ───────────────────────────────────────────────────
  function openAddMember()   { setMf(emptyMF); setEditMember(null); setMemberModal(true); }
  function openEditMember(m) {
    setMf({name:m.name,emoji:m.emoji,rThresh:m.reward?.threshold?.toString()||"3",rMsg:m.reward?.message||""});
    setEditMember(m.id); setMemberModal(true);
  }
  function saveMember() {
    if (!mf.name.trim()) return;
    const thresh=parseInt(mf.rThresh);
    const reward=mf.rMsg.trim()?{threshold:isNaN(thresh)?3:thresh,message:mf.rMsg.trim()}:null;
    if (editMember) {
      setMembers(ms=>ms.map(m=>m.id===editMember?{...m,name:mf.name.trim(),emoji:mf.emoji,reward}:m));
    } else {
      setMembers(ms=>[...ms,{id:uid(),name:mf.name.trim(),emoji:mf.emoji,reward}]);
    }
    setMemberModal(false);
  }

  // ── shop ──────────────────────────────────────────────────────
  function addShop() {
    if (!shopItem.trim()) return;
    setShopping(s=>[...s,{id:uid(),name:shopItem.trim(),done:false}]);
    setShopItem(""); setShopModal(false);
  }

  // ── compute todo display list ─────────────────────────────────
  // For each recurring todo, compute dueStatus
  const todosWithStatus = useMemo(() => {
    return todos.map(t => {
      if (t.repeat.type === "once") {
        return {...t, dueToday:true, overdueDates:[]};
      }
      const {dueToday, overdueDates} = getDueStatus(t.repeat, t.completionLog);
      // Is the current period already done?
      const dueDates = getDueDatesInRange(t.repeat,
        (() => { const d=new Date(today); d.setDate(d.getDate()-1); return d; })(),
        today
      );
      const latestDue = dueDates[dueDates.length-1];
      const completedOn = new Set((t.completionLog||[]).map(l=>l.date.slice(0,10)));
      const currentPeriodDone = latestDue ? completedOn.has(latestDue) : false;

      return {...t, dueToday, overdueDates, currentPeriodDone};
    });
  }, [todos]);

  // visible = due today OR overdue (not yet satisfied this period)
  const visibleTodos = todosWithStatus.filter(t => {
    if (t.repeat.type === "once") return true; // always visible until completed (removed)
    if (t.currentPeriodDone && t.overdueDates.length === 0) return false; // all clear
    return t.dueToday || t.overdueDates.length > 0;
  });

  // split: mine vs others
  const myTodos    = visibleTodos.filter(t => t.ownerId === currentUser);
  const otherTodos = visibleTodos.filter(t => t.ownerId !== currentUser);

  // ── calendar ──────────────────────────────────────────────────
  const allLogs = todos.flatMap(t =>
    (t.completionLog||[]).map(l => ({
      date:l.date.slice(0,10), name:t.name,
      doer:members.find(m=>m.id===l.doerId), isSub:l.isSub,
    }))
  );
  const doneDates = new Set(allLogs.map(l=>l.date));
  const {y,m} = calMonth;
  function calCells() {
    const first=new Date(y,m,1).getDay(), last=new Date(y,m+1,0).getDate();
    const c=[]; for(let i=0;i<first;i++) c.push(null);
    for(let d=1;d<=last;d++) c.push(d); return c;
  }
  const calKey = (day) => `${y}-${String(m+1).padStart(2,"0")}-${String(day).padStart(2,"0")}`;
  const selKey = selDay ? calKey(selDay) : null;
  const selLogs = selKey
    ? allLogs.filter(l=>l.date===selKey)
    : allLogs.sort((a,b)=>b.date.localeCompare(a.date)).slice(0,30);

  // ── sub stats for current user ────────────────────────────────
  // Who has subbed for me, and how many times
  const subsForMe = Object.entries(subMatrix[currentUser]||{}).map(([helperId,cnt]) => ({
    helper:members.find(m=>m.id===helperId), cnt,
  }));
  // Who I've subbed for
  const mySubsFor = Object.entries(subMatrix).flatMap(([ownerId,helpers]) =>
    Object.entries(helpers)
      .filter(([hId]) => hId===currentUser)
      .map(([,cnt]) => ({owner:members.find(m=>m.id===ownerId), cnt}))
  );

  // ── login screen ──────────────────────────────────────────────
  if (!currentUser) return (
    <>
      <style>{CSS}</style>
      <div className="app center">
        <div className="login-wrap">
          <div className="login-logo">🏠</div>
          <h1 className="login-title">おうち管理</h1>
          <p className="login-sub">今日は誰として使いますか？</p>
          <div className="login-grid">
            {members.map(m => (
              <button key={m.id} className="login-card" onClick={()=>setCurrentUser(m.id)}>
                <span className="login-emoji">{m.emoji}</span>
                <span className="login-name">{m.name}</span>
              </button>
            ))}
          </div>
          <button className="add-member-btn" onClick={openAddMember}><span style={{fontSize:18}}>＋</span> メンバーを追加</button>
        </div>
        {memberModal && <MemberModal mf={mf} setMf={setMf} onSave={saveMember} onClose={()=>setMemberModal(false)} isEdit={!!editMember}/>}
      </div>
    </>
  );

  // ── main app ──────────────────────────────────────────────────
  return (
    <>
      <style>{CSS}</style>
      <div className="app">

        {/* header */}
        <div className="hdr">
          <div className="hdr-row">
            <div>
              <h1 className="hdr-h1">🏠 おうち管理</h1>
              <div className="hdr-d">{today.getFullYear()}/{today.getMonth()+1}/{today.getDate()}（{DAYS_JP[today.getDay()]}）</div>
            </div>
            <div style={{display:"flex",gap:8,alignItems:"center"}}>
              <button className="hdr-btn" onClick={()=>setStatsModal(true)}><Ic.Medal/>代行</button>
              <button className="user-pill" onClick={()=>setCurrentUser(null)}>
                {me?.emoji} {me?.name}
              </button>
            </div>
          </div>
        </div>

        {/* tabs */}
        <div className="tabs">
          {[{id:"todo",l:"やること",ic:<Ic.List/>},{id:"shop",l:"買い物",ic:<Ic.Cart/>},{id:"cal",l:"カレンダー",ic:<Ic.Cal/>}].map(t=>(
            <button key={t.id} className={`tab${tab===t.id?" on":""}`} onClick={()=>setTab(t.id)}>{t.ic}{t.l}</button>
          ))}
        </div>

        {/* body */}
        <div className="body">

          {/* ── TODO TAB ── */}
          {tab==="todo"&&<>
            {/* my tasks */}
            {myTodos.length>0&&<>
              <div className="lbl">✋ 自分のタスク</div>
              {myTodos.map(t=>(
                <TodoCard key={t.id} t={t} members={members} isMine={true}
                  onDone={()=>startComplete(t.id)}
                  onDel={()=>setTodos(ts=>ts.filter(x=>x.id!==t.id))}
                />
              ))}
            </>}

            {/* others' tasks */}
            {otherTodos.length>0&&<>
              <div className="lbl">👨‍👩‍👧‍👦 みんなのタスク</div>
              {otherTodos.map(t=>(
                <TodoCard key={t.id} t={t} members={members} isMine={false}
                  onDone={()=>startComplete(t.id)}
                  onDel={()=>setTodos(ts=>ts.filter(x=>x.id!==t.id))}
                />
              ))}
            </>}

            {myTodos.length===0&&otherTodos.length===0&&(
              <div className="empty">今日やることはありません 🎉<br/><span style={{fontSize:12,opacity:.6}}>＋ボタンでタスクを追加できます</span></div>
            )}
          </>}

          {/* ── SHOP TAB ── */}
          {tab==="shop"&&<>
            <div className="lbl">🛒 買い物リスト</div>
            {shopping.length===0&&<div className="empty">リストは空です<br/><span style={{fontSize:12,opacity:.6}}>＋ボタンで追加しましょう</span></div>}
            {shopping.map(i=>(
              <div key={i.id} className="shop-row">
                <button className={`sc${i.done?" on":""}`}
                  onClick={()=>setShopping(s=>s.filter(x=>x.id!==i.id))}
                  title="タップで完了・削除">
                  {i.done&&<Ic.Check/>}
                </button>
                <span className="sn">{i.name}</span>
                <button className="del" onClick={()=>setShopping(s=>s.filter(x=>x.id!==i.id))}><Ic.Trash/></button>
              </div>
            ))}
          </>}

          {/* ── CALENDAR TAB ── */}
          {tab==="cal"&&<>
            <div className="cal-nav">
              <button className="cnb" onClick={()=>setCalMonth(p=>{const d=new Date(p.y,p.m-1);return{y:d.getFullYear(),m:d.getMonth()};})}>‹</button>
              <span className="cm">{y}年{m+1}月</span>
              <button className="cnb" onClick={()=>setCalMonth(p=>{const d=new Date(p.y,p.m+1);return{y:d.getFullYear(),m:d.getMonth()};})}>›</button>
            </div>
            <div className="cgrid">
              {DAYS_JP.map(d=><div key={d} className="cdow">{d}</div>)}
              {calCells().map((day,i)=>{
                if(!day) return <div key={i}/>;
                const k=calKey(day), isT=k===todayStr, hd=doneDates.has(k);
                return(
                  <div key={i} className={`cc${isT?" td":""}${hd?" hd":""}`}
                    onClick={()=>hd&&setSelDay(d=>d===day?null:day)}>
                    {day}{hd&&!isT&&<div className="cdot"/>}
                  </div>
                );
              })}
            </div>
            <div style={{marginTop:16}}>
              <div className="lbl">{selDay?`${m+1}/${selDay} の完了`:"最近の完了履歴"}</div>
              {selLogs.length===0&&<div className="empty">記録がありません</div>}
              {selLogs.map((l,i)=>(
                <div key={i} className="log-row">
                  <span className="log-d">{fmtMD(l.date)}</span>
                  <span style={{flex:1}}>{l.name}</span>
                  {l.doer&&<span className="log-who">{l.doer.emoji}{l.doer.name}</span>}
                  {l.isSub&&<span className="badge-sub">代行</span>}
                </div>
              ))}
            </div>
          </>}
        </div>

        {/* FAB */}
        <button className="fab" onClick={()=>tab==="shop"?setShopModal(true):setTodoModal(true)}><Ic.Plus/></button>

        {/* ══ ADD TODO MODAL ══ */}
        {todoModal&&(
          <div className="ov" onClick={e=>e.target===e.currentTarget&&(setTodoModal(false),setTf(emptyTF))}>
            <div className="sh">
              <div className="sh-t">タスクを追加</div>
              <div className="fld"><label>タスク名 *</label>
                <input placeholder="例：お風呂掃除" value={tf.name} onChange={e=>setTf(f=>({...f,name:e.target.value}))}/>
              </div>
              <div className="fld"><label>タスクオーナー</label>
                <select value={tf.ownerId} onChange={e=>setTf(f=>({...f,ownerId:e.target.value}))}>
                  <option value="">なし</option>
                  {members.map(m=><option key={m.id} value={m.id}>{m.emoji} {m.name}</option>)}
                </select>
              </div>
              <div className="fld"><label>繰り返し</label>
                <select value={tf.repeatType} onChange={e=>setTf(f=>({...f,repeatType:e.target.value}))}>
                  <option value="once">単発（1回のみ）</option>
                  <option value="weekly">毎週</option>
                  <option value="monthly_date">毎月（日付指定）</option>
                  <option value="monthly_nth">毎月（第◯曜日）</option>
                </select>
              </div>
              {tf.repeatType==="weekly"&&(
                <div className="fld"><label>曜日</label>
                  <div className="day-row">
                    {DAYS_JP.map(d=>(
                      <button key={d} className={`db${tf.days.includes(d)?" on":""}`}
                        onClick={()=>setTf(f=>({...f,days:f.days.includes(d)?f.days.filter(x=>x!==d):[...f.days,d]}))}>
                        {d}
                      </button>
                    ))}
                  </div>
                </div>
              )}
              {tf.repeatType==="monthly_date"&&(
                <div className="fld"><label>日にち（カンマ区切り）</label>
                  <input placeholder="例：1, 15" value={tf.dates} onChange={e=>setTf(f=>({...f,dates:e.target.value}))}/>
                </div>
              )}
              {tf.repeatType==="monthly_nth"&&(
                <div className="fld">
                  <label>第◯曜日</label>
                  <div style={{display:"flex",gap:8}}>
                    <select style={{flex:1,padding:"10px 8px",borderRadius:10,border:"1.5px solid var(--bdr)",background:"var(--bg)",fontFamily:"inherit",fontSize:14}}
                      value={tf.nthN} onChange={e=>setTf(f=>({...f,nthN:e.target.value}))}>
                      <option value="0">第1</option>
                      <option value="1">第2</option>
                      <option value="2">第3</option>
                      <option value="3">第4</option>
                      <option value="last">最終</option>
                    </select>
                    <select style={{flex:1,padding:"10px 8px",borderRadius:10,border:"1.5px solid var(--bdr)",background:"var(--bg)",fontFamily:"inherit",fontSize:14}}
                      value={tf.nthW} onChange={e=>setTf(f=>({...f,nthW:e.target.value}))}>
                      {DAYS_JP.map((d,i)=><option key={i} value={i}>{d}曜日</option>)}
                    </select>
                  </div>
                </div>
              )}
              <div className="fld"><label>消耗品（完了時に確認）</label>
                <input placeholder="例：バスクリーナー（任意）" value={tf.supply} onChange={e=>setTf(f=>({...f,supply:e.target.value}))}/>
              </div>
              <div className="btn-row">
                <button className="btn g" onClick={()=>{setTodoModal(false);setTf(emptyTF);}}>キャンセル</button>
                <button className="btn p" onClick={addTodo}>追加する</button>
              </div>
            </div>
          </div>
        )}

        {/* ══ ADD SHOP MODAL ══ */}
        {shopModal&&(
          <div className="ov" onClick={e=>e.target===e.currentTarget&&setShopModal(false)}>
            <div className="sh">
              <div className="sh-t">買い物を追加</div>
              <div className="fld"><label>アイテム名</label>
                <input placeholder="例：牛乳" value={shopItem} onChange={e=>setShopItem(e.target.value)}
                  onKeyDown={e=>e.key==="Enter"&&addShop()} autoFocus/>
              </div>
              <div className="btn-row">
                <button className="btn g" onClick={()=>{setShopModal(false);setShopItem("");}}>キャンセル</button>
                <button className="btn p" onClick={addShop}>追加する</button>
              </div>
            </div>
          </div>
        )}

        {/* ══ SUPPLY POPUP ══ */}
        {supplyPop&&(
          <div className="pop-ov">
            <div className="pop">
              <div className="pop-icon">🧴</div>
              <div className="pop-title">消耗品を確認</div>
              <div className="pop-desc">「<strong>{supplyPop.supply}</strong>」はまだ残っていますか？</div>
              <div className="btn-row">
                <button className="btn g" onClick={supplyNo}>なくなりそう<br/><small style={{fontWeight:400}}>→買い物リストへ</small></button>
                <button className="btn p" onClick={supplyYes}>まだある！</button>
              </div>
            </div>
          </div>
        )}

        {/* ══ REWARD POPUP ══ */}
        {rewardPop&&(
          <div className="pop-ov">
            <div className="pop reward-pop">
              <div style={{fontSize:28,textAlign:"center",letterSpacing:4,marginBottom:8}}>🎉✨🎊</div>
              <div className="pop-title">{rewardPop.message}</div>
              <div className="pop-desc">
                {rewardPop.helperEmoji}<strong>{rewardPop.helperName}</strong>さんが<br/>
                {rewardPop.ownerEmoji}<strong>{rewardPop.ownerName}</strong>さんの代わりに<br/>
                {rewardPop.count}回頑張りました！
              </div>
              <button className="btn p" style={{width:"100%"}} onClick={()=>setRewardPop(null)}>ありがとう！</button>
            </div>
          </div>
        )}

        {/* ══ STATS MODAL ══ */}
        {statsModal&&(
          <div className="ov" onClick={e=>e.target===e.currentTarget&&setStatsModal(false)}>
            <div className="sh">
              <div className="sh-t">🏅 代行記録</div>

              {subsForMe.length>0&&<>
                <div className="stats-section-label">助けてもらった回数</div>
                {subsForMe.map(({helper,cnt},i)=>{
                  const thr = me?.reward?.threshold||0;
                  const pct = thr ? Math.min(100,(cnt%thr||thr)/thr*100) : 0;
                  const next = thr ? thr-(cnt%thr||thr) : 0;
                  return(
                    <div key={i} className="stat-card">
                      <div style={{display:"flex",justifyContent:"space-between",alignItems:"center"}}>
                        <span>{helper?.emoji} <strong>{helper?.name}</strong>さんから</span>
                        <span className="stat-cnt">{cnt}回</span>
                      </div>
                      {me?.reward&&<>
                        <div className="stat-reward-tag"><Ic.Gift/> {me.reward.message}</div>
                        <div className="pbar-w"><div className="pbar-f" style={{width:`${pct}%`}}/></div>
                        <div style={{fontSize:11,color:"var(--tx2)",marginTop:2,textAlign:"right"}}>
                          あと{next}回でリクエスト
                        </div>
                      </>}
                    </div>
                  );
                })}
              </>}

              {mySubsFor.length>0&&<>
                <div className="stats-section-label" style={{marginTop:16}}>代行した回数</div>
                {mySubsFor.map(({owner,cnt},i)=>{
                  const thr=owner?.reward?.threshold||0;
                  const pct=thr?Math.min(100,(cnt%thr||thr)/thr*100):0;
                  const next=thr?thr-(cnt%thr||thr):0;
                  return(
                    <div key={i} className="stat-card">
                      <div style={{display:"flex",justifyContent:"space-between",alignItems:"center"}}>
                        <span>{owner?.emoji} <strong>{owner?.name}</strong>さんを</span>
                        <span className="stat-cnt">{cnt}回</span>
                      </div>
                      {owner?.reward&&<>
                        <div className="stat-reward-tag"><Ic.Gift/> {owner.reward.message}</div>
                        <div className="pbar-w"><div className="pbar-f" style={{width:`${pct}%`}}/></div>
                        <div style={{fontSize:11,color:"var(--tx2)",marginTop:2,textAlign:"right"}}>
                          あと{next}回でもらえる
                        </div>
                      </>}
                    </div>
                  );
                })}
              </>}

              {subsForMe.length===0&&mySubsFor.length===0&&(
                <div className="empty">代行の記録がまだありません</div>
              )}

              <div className="stats-section-label" style={{marginTop:16,display:"flex",justifyContent:"space-between",alignItems:"center"}}>
                <span>メンバー管理</span>
                <button className="inline-add-btn" onClick={openAddMember}>＋ 追加</button>
              </div>
              {members.map(m=>(
                <div key={m.id} className="member-row">
                  <span style={{fontSize:22}}>{m.emoji}</span>
                  <span style={{flex:1,fontWeight:600}}>{m.name}</span>
                  {m.reward&&<span style={{fontSize:11,color:"var(--tx2)"}}>{m.reward.threshold}回→{m.reward.message}</span>}
                  <button className="inline-edit-btn" onClick={()=>openEditMember(m)}>編集</button>
                </div>
              ))}
              <div className="btn-row" style={{marginTop:16}}>
                <button className="btn g" onClick={()=>setStatsModal(false)}>閉じる</button>
              </div>
            </div>
          </div>
        )}

        {/* ══ MEMBER MODAL ══ */}
        {memberModal&&(
          <MemberModal mf={mf} setMf={setMf} onSave={saveMember}
            onClose={()=>setMemberModal(false)} isEdit={!!editMember}/>
        )}

      </div>
    </>
  );
}

// ── TodoCard ──────────────────────────────────────────────────────
function TodoCard({t, members, isMine, onDone, onDel}) {
  const owner = members.find(m=>m.id===t.ownerId);
  const hasOverdue = t.overdueDates?.length > 0;
  const overdueCount = t.overdueDates?.length || 0;
  const lastOverdue = t.overdueDates?.[t.overdueDates.length-1];

  return(
    <div className={`tc${isMine?" mine":""}${hasOverdue?" overdue":""}`}>
      <button className="ck" onClick={onDone} title="完了">
        <Ic.Check/>
      </button>
      <div className="tb">
        <div className="tn">{t.isReward&&"🎁 "}{t.name}</div>
        <div className="meta">
          {owner&&!isMine&&<span className="b b-owner">{owner.emoji} {owner.name}</span>}
          {isMine&&<span className="b b-mine">自分のタスク</span>}
          <span className="b b-rpt"><Ic.Rpt/> {repeatLabel(t.repeat)}</span>
          {t.supply&&<span className="b b-sup">🧴 {t.supply}</span>}
          {t.isReward&&t.rewardFor&&<span className="b b-reward"><Ic.Gift/> {members.find(m=>m.id===t.rewardFor)?.name}さんへ</span>}
        </div>
        {hasOverdue&&(
          <div className="overdue-tag">
            <Ic.Warn/>
            {overdueCount===1
              ? `前回（${fmtMD(lastOverdue)}）が未完了`
              : `${overdueCount}回分が未完了（最古：${fmtMD(t.overdueDates[0])}）`
            }
          </div>
        )}
      </div>
      <button className="del" onClick={onDel}><Ic.Trash/></button>
    </div>
  );
}

// ── MemberModal ───────────────────────────────────────────────────
const EMOJIS_LIST = ["👩","👨","👧","🧒","👴","👵","🧑","👱","🙋","😊","😎","🐱","🐶","🌸","⭐","🦊"];
function MemberModal({mf, setMf, onSave, onClose, isEdit}) {
  return(
    <div className="ov" onClick={e=>e.target===e.currentTarget&&onClose()}>
      <div className="sh">
        <div className="sh-t">{isEdit?"メンバーを編集":"メンバーを追加"}</div>
        <div className="fld"><label>名前</label>
          <input placeholder="例：お母さん" value={mf.name} onChange={e=>setMf(f=>({...f,name:e.target.value}))}/>
        </div>
        <div className="fld"><label>絵文字</label>
          <div className="emoji-grid">
            {EMOJIS_LIST.map(e=>(
              <button key={e} className={`emoji-btn${mf.emoji===e?" on":""}`} onClick={()=>setMf(f=>({...f,emoji:e}))}>{e}</button>
            ))}
          </div>
        </div>
        <div style={{background:"#FFFBF0",border:"1.5px solid #F0D99A",borderRadius:12,padding:"12px 14px",marginTop:4}}>
          <div style={{fontSize:11,fontWeight:700,color:"var(--org)",letterSpacing:".06em",textTransform:"uppercase",marginBottom:10,display:"flex",alignItems:"center",gap:5}}>
            <Ic.Gift/> 代行報酬の設定（任意）
          </div>
          <div className="fld"><label>代行されたらリクエストする回数のしきい値</label>
            <input type="number" min="1" placeholder="3" value={mf.rThresh} onChange={e=>setMf(f=>({...f,rThresh:e.target.value}))}/>
          </div>
          <div className="fld" style={{marginBottom:0}}><label>リクエストメッセージ</label>
            <input placeholder="例：お菓子買ってきて🫶" value={mf.rMsg} onChange={e=>setMf(f=>({...f,rMsg:e.target.value}))}/>
          </div>
        </div>
        <div className="btn-row">
          <button className="btn g" onClick={onClose}>キャンセル</button>
          <button className="btn p" onClick={onSave}>{isEdit?"保存":"追加"}</button>
        </div>
      </div>
    </div>
  );
}

// ─── CSS ──────────────────────────────────────────────────────────
const CSS = `
  @import url('https://fonts.googleapis.com/css2?family=Zen+Kaku+Gothic+New:wght@400;500;700&family=DM+Sans:wght@400;600&display=swap');
  *,*::before,*::after{box-sizing:border-box;margin:0;padding:0}
  :root{
    --bg:#F5F0E8;--surf:#FFFDF7;--surf2:#F0EAD9;--bdr:#D6CCB4;
    --tx:#2A2318;--tx2:#6B5E45;
    --red:#C4593A;--grn:#3A7C6B;--pur:#7B5EA7;--org:#C07C28;--sub:#D4692A;
    --warn:#E07A00;--warn-bg:#FFF4E0;--warn-bdr:#F5C56A;
    --mine:#EBF4F1;--mine-bdr:#3A7C6B;
    --shd:0 2px 14px rgba(42,35,24,.09);--r:14px;
  }
  body{background:var(--bg);font-family:'Zen Kaku Gothic New',sans-serif;color:var(--tx);-webkit-font-smoothing:antialiased}
  .app{max-width:430px;margin:0 auto;min-height:100vh;display:flex;flex-direction:column}
  .app.center{justify-content:center;align-items:center}

  /* login */
  .login-wrap{width:100%;padding:32px 24px 48px;display:flex;flex-direction:column;align-items:center}
  .login-logo{font-size:56px;margin-bottom:12px}
  .login-title{font-size:26px;font-weight:700;margin-bottom:6px}
  .login-sub{font-size:14px;color:var(--tx2);margin-bottom:28px}
  .login-grid{display:grid;grid-template-columns:1fr 1fr;gap:12px;width:100%;margin-bottom:20px}
  .login-card{background:var(--surf);border:1.5px solid var(--bdr);border-radius:16px;
              padding:20px 12px;display:flex;flex-direction:column;align-items:center;gap:8px;
              cursor:pointer;transition:all .18s;box-shadow:var(--shd)}
  .login-card:hover{border-color:var(--red);transform:translateY(-2px)}
  .login-emoji{font-size:36px}
  .login-name{font-size:15px;font-weight:600}
  .add-member-btn{background:transparent;border:1.5px dashed var(--bdr);border-radius:12px;
                  padding:12px 24px;color:var(--tx2);font-family:inherit;font-size:14px;cursor:pointer;
                  display:flex;align-items:center;gap:8px;transition:all .18s}
  .add-member-btn:hover{border-color:var(--red);color:var(--red)}

  /* header */
  .hdr{background:var(--tx);color:#F5F0E8;padding:14px 18px 12px}
  .hdr-row{display:flex;align-items:center;justify-content:space-between}
  .hdr-h1{font-size:20px;font-weight:700}
  .hdr-d{font-size:11px;opacity:.5;font-family:'DM Sans',sans-serif;margin-top:1px}
  .hdr-btn{background:rgba(255,255,255,.13);border:none;color:#F5F0E8;border-radius:8px;
           padding:6px 10px;font-size:12px;font-family:inherit;cursor:pointer;
           display:flex;align-items:center;gap:4px;font-weight:600}
  .user-pill{background:rgba(255,255,255,.18);border:none;color:#F5F0E8;
             border-radius:20px;padding:6px 12px;font-size:13px;font-family:inherit;
             cursor:pointer;font-weight:600;letter-spacing:.01em}

  /* tabs */
  .tabs{display:flex;background:var(--tx);padding:0 16px 12px;gap:6px}
  .tab{flex:1;display:flex;flex-direction:column;align-items:center;gap:3px;padding:8px 4px;
       border-radius:10px;border:none;background:transparent;color:rgba(245,240,232,.4);
       cursor:pointer;font-family:inherit;font-size:10px;transition:all .2s}
  .tab.on{background:var(--red);color:#fff}

  /* body */
  .body{flex:1;overflow-y:auto;padding:16px;padding-bottom:90px}
  .lbl{font-size:11px;font-weight:700;letter-spacing:.08em;color:var(--tx2);
       text-transform:uppercase;margin:16px 0 8px}
  .lbl:first-child{margin-top:0}
  .empty{text-align:center;color:var(--tx2);font-size:14px;padding:36px 0;opacity:.7;line-height:1.8}

  /* todo card */
  .tc{background:var(--surf);border-radius:var(--r);padding:13px 12px 12px;margin-bottom:8px;
      box-shadow:var(--shd);border:1.5px solid var(--bdr);display:flex;align-items:flex-start;gap:10px;
      transition:all .2s;position:relative}
  .tc.mine{background:var(--mine);border-color:var(--mine-bdr);border-left:4px solid var(--mine-bdr)}
  .tc.overdue{border-color:var(--warn-bdr);background:var(--warn-bg)}
  .tc.mine.overdue{background:#FFF6E0;border-color:var(--warn-bdr);border-left:4px solid var(--warn)}

  .ck{width:32px;height:32px;border-radius:50%;border:2px solid var(--bdr);background:transparent;
      cursor:pointer;display:flex;align-items:center;justify-content:center;flex-shrink:0;
      margin-top:1px;transition:all .2s;color:transparent}
  .ck:hover{background:var(--grn);border-color:var(--grn);color:#fff}
  .tc.mine .ck{border-color:var(--mine-bdr)}
  .tc.mine .ck:hover{background:var(--mine-bdr);border-color:var(--mine-bdr);color:#fff}

  .tb{flex:1;min-width:0}
  .tn{font-size:15px;font-weight:600;line-height:1.3}
  .meta{display:flex;flex-wrap:wrap;gap:4px;margin-top:5px}
  .b{font-size:10px;padding:2px 7px;border-radius:20px;font-weight:600;display:inline-flex;align-items:center;gap:3px}
  .b-owner{background:#F0EAD9;color:var(--tx2)}
  .b-mine{background:#C8E6DC;color:#1F5C4A;font-weight:700}
  .b-rpt{background:#EBF4F1;color:var(--grn)}
  .b-sup{background:#F3EEF8;color:var(--pur)}
  .b-reward{background:#FFF8E1;color:var(--org)}
  .b-sub{background:#FEF0E6;color:var(--sub)}

  .overdue-tag{display:flex;align-items:center;gap:5px;font-size:11px;font-weight:700;
               color:var(--warn);background:rgba(224,122,0,.1);border-radius:6px;
               padding:4px 8px;margin-top:7px;width:fit-content}

  .del{background:none;border:none;color:var(--bdr);cursor:pointer;padding:4px;
       border-radius:6px;transition:color .2s;flex-shrink:0}
  .del:hover{color:var(--red)}

  /* shop */
  .shop-row{background:var(--surf);border-radius:var(--r);padding:14px;margin-bottom:8px;
            box-shadow:var(--shd);border:1.5px solid var(--bdr);display:flex;align-items:center;gap:12px}
  .sc{width:26px;height:26px;border-radius:8px;border:2px solid var(--bdr);background:transparent;
      cursor:pointer;display:flex;align-items:center;justify-content:center;flex-shrink:0;
      transition:all .2s;color:transparent}
  .sc:hover{background:var(--grn);border-color:var(--grn);color:#fff}
  .sc.on{background:var(--grn);border-color:var(--grn);color:#fff}
  .sn{flex:1;font-size:15px}

  /* calendar */
  .cal-nav{display:flex;align-items:center;justify-content:space-between;margin-bottom:12px}
  .cnb{background:var(--surf2);border:1px solid var(--bdr);border-radius:8px;width:34px;height:34px;
       cursor:pointer;font-size:16px;display:flex;align-items:center;justify-content:center}
  .cm{font-size:16px;font-weight:700}
  .cgrid{display:grid;grid-template-columns:repeat(7,1fr);gap:3px}
  .cdow{text-align:center;font-size:10px;font-weight:700;color:var(--tx2);padding-bottom:4px}
  .cc{aspect-ratio:1;border-radius:8px;display:flex;flex-direction:column;align-items:center;
      justify-content:flex-start;padding-top:4px;font-size:12px;background:var(--surf);border:1px solid transparent}
  .cc.td{background:var(--red);color:#fff;font-weight:700}
  .cc.hd{border-color:var(--grn);cursor:pointer}
  .cdot{width:5px;height:5px;border-radius:50%;background:var(--grn);margin-top:2px}
  .log-row{font-size:13px;padding:10px 14px;background:var(--surf);border-radius:10px;
           margin-bottom:6px;border:1.5px solid var(--bdr);display:flex;gap:8px;align-items:center}
  .log-d{color:var(--tx2);font-family:'DM Sans',sans-serif;white-space:nowrap;font-size:12px}
  .log-who{font-size:12px;color:var(--tx2)}
  .badge-sub{font-size:11px;background:#FEF0E6;color:var(--sub);padding:1px 7px;border-radius:20px;font-weight:600}

  /* stats */
  .stats-section-label{font-size:11px;font-weight:700;letter-spacing:.08em;color:var(--tx2);
                       text-transform:uppercase;margin:0 0 8px}
  .stat-card{background:var(--bg);border-radius:12px;padding:14px;margin-bottom:10px;border:1.5px solid var(--bdr)}
  .stat-cnt{font-size:22px;font-weight:700;color:var(--sub)}
  .stat-reward-tag{font-size:12px;background:#FFF8E1;color:var(--org);padding:4px 10px;
                   border-radius:20px;display:inline-flex;align-items:center;gap:4px;margin:8px 0 4px}
  .pbar-w{height:5px;background:var(--bdr);border-radius:5px;overflow:hidden}
  .pbar-f{height:100%;background:var(--sub);border-radius:5px;transition:width .5s}
  .member-row{display:flex;align-items:center;gap:10px;padding:10px 0;
              border-bottom:1px solid var(--bdr)}
  .member-row:last-of-type{border-bottom:none}
  .inline-add-btn{background:var(--surf2);border:1px solid var(--bdr);border-radius:8px;
                  padding:4px 10px;font-size:12px;font-family:inherit;cursor:pointer;color:var(--tx2)}
  .inline-edit-btn{background:var(--surf2);border:1px solid var(--bdr);border-radius:8px;
                   padding:4px 10px;font-size:12px;font-family:inherit;cursor:pointer;color:var(--tx2)}

  /* fab */
  .fab{position:fixed;bottom:24px;right:20px;width:54px;height:54px;border-radius:50%;
       background:var(--red);color:#fff;border:none;cursor:pointer;
       box-shadow:0 4px 20px rgba(196,89,58,.5);display:flex;align-items:center;
       justify-content:center;transition:transform .2s;z-index:10}
  .fab:active{transform:scale(.92)}

  /* overlay / sheet */
  .ov{position:fixed;inset:0;background:rgba(42,35,24,.5);z-index:100;
      display:flex;align-items:flex-end;backdrop-filter:blur(3px)}
  .sh{background:var(--surf);border-radius:20px 20px 0 0;padding:20px 20px 40px;
      width:100%;max-height:90vh;overflow-y:auto;animation:sup .25s ease}
  @keyframes sup{from{transform:translateY(40px);opacity:0}to{transform:translateY(0);opacity:1}}
  .sh-t{font-size:17px;font-weight:700;margin-bottom:16px}

  .fld{margin-bottom:13px}
  .fld label{display:block;font-size:11px;font-weight:700;letter-spacing:.06em;
             color:var(--tx2);text-transform:uppercase;margin-bottom:5px}
  .fld input,.fld select{width:100%;padding:11px 13px;border-radius:10px;
                         border:1.5px solid var(--bdr);background:var(--bg);
                         font-family:inherit;font-size:15px;color:var(--tx);outline:none;transition:border-color .2s}
  .fld input:focus,.fld select:focus{border-color:var(--red)}
  .day-row{display:flex;gap:6px;flex-wrap:wrap;margin-top:6px}
  .db{width:36px;height:36px;border-radius:50%;border:1.5px solid var(--bdr);background:var(--bg);
      font-size:12px;font-family:inherit;cursor:pointer;transition:all .2s}
  .db.on{background:var(--red);border-color:var(--red);color:#fff;font-weight:700}
  .emoji-grid{display:flex;flex-wrap:wrap;gap:6px;margin-top:4px}
  .emoji-btn{width:38px;height:38px;border-radius:10px;border:1.5px solid var(--bdr);background:var(--bg);
             font-size:20px;cursor:pointer;transition:all .18s;display:flex;align-items:center;justify-content:center}
  .emoji-btn.on{border-color:var(--red);background:#FDF0ED;transform:scale(1.15)}
  .btn-row{display:flex;gap:10px;margin-top:16px}
  .btn{flex:1;padding:13px;border-radius:12px;border:none;font-family:inherit;
       font-size:15px;font-weight:700;cursor:pointer;transition:opacity .2s}
  .btn.p{background:var(--red);color:#fff}
  .btn.g{background:var(--surf2);color:var(--tx2)}
  .btn:active{opacity:.8}

  /* popup */
  .pop-ov{position:fixed;inset:0;background:rgba(42,35,24,.55);z-index:200;
          display:flex;align-items:center;justify-content:center;padding:20px}
  .pop{background:var(--surf);border-radius:20px;padding:24px 20px 22px;
       width:100%;max-width:340px;animation:pin .2s ease}
  @keyframes pin{from{transform:scale(.9);opacity:0}to{transform:scale(1);opacity:1}}
  .pop-icon{font-size:38px;text-align:center;margin-bottom:10px}
  .pop-title{font-size:17px;font-weight:700;text-align:center;margin-bottom:8px}
  .pop-desc{font-size:13px;color:var(--tx2);text-align:center;line-height:1.8;margin-bottom:18px}
  .reward-pop{background:linear-gradient(145deg,#FFF8E1,#FFFDF7);border:2px solid #F0D99A}
`;
