// ─── date helpers ─────────────────────────────────────────────
export const DAYS_JP = ["日", "月", "火", "水", "木", "金", "土"];
const DAY_MS = 86400000;

export function parseD(s) {
  const [y, m, d] = s.split("-").map(Number);
  return new Date(y, m - 1, d);
}
export function fmtD(dt) {
  return `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, "0")}-${String(dt.getDate()).padStart(2, "0")}`;
}
export function todayD() {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d;
}
export function daysBetween(a, b) {
  return Math.round((strip(b) - strip(a)) / DAY_MS);
}
function strip(dt) {
  return new Date(dt.getFullYear(), dt.getMonth(), dt.getDate()).getTime();
}
function startOfWeek(dt) {
  const d = new Date(dt);
  d.setDate(d.getDate() - d.getDay());
  return d;
}
export function getNthWeekdayInMonth(year, month, nth, weekday) {
  if (nth === "last") {
    const d = new Date(year, month + 1, 0);
    while (d.getDay() !== weekday) d.setDate(d.getDate() - 1);
    return d.getDate();
  }
  let count = -1;
  const d = new Date(year, month, 1);
  while (d.getMonth() === month) {
    if (d.getDay() === weekday) {
      count++;
      if (count === nth) return d.getDate();
    }
    d.setDate(d.getDate() + 1);
  }
  return null;
}
// which occurrence of its weekday within the month a date is (0-based) => {nth, weekday}
export function nthOfMonth(dt) {
  return { nth: Math.floor((dt.getDate() - 1) / 7), weekday: dt.getDay() };
}

// ─── repeat model ─────────────────────────────────────────────
// { freq:"none" }
// { freq:"daily",   interval, until }
// { freq:"weekly",  interval, weekdays:[0-6], until }
// { freq:"monthly", interval, mode:"date"|"nth", date, nth, weekday, until }
// { freq:"yearly",  interval, month, date, until }

// Does a task (with start date `start` string) occur on target Date?
export function occursOn(start, repeat, target) {
  const s = parseD(start);
  if (target < s) return false;
  const r = repeat || { freq: "none" };
  if (r.until && target > parseD(r.until)) return false;
  const iv = Math.max(1, r.interval || 1);

  switch (r.freq) {
    case "none":
      return fmtD(target) === start;
    case "daily":
      return daysBetween(s, target) % iv === 0;
    case "weekly": {
      if (!(r.weekdays || []).includes(target.getDay())) return false;
      const w = Math.floor(daysBetween(startOfWeek(s), startOfWeek(target)) / 7);
      return w % iv === 0;
    }
    case "monthly": {
      const md = (target.getFullYear() - s.getFullYear()) * 12 + (target.getMonth() - s.getMonth());
      if (md < 0 || md % iv !== 0) return false;
      if (r.mode === "nth") {
        return getNthWeekdayInMonth(target.getFullYear(), target.getMonth(), r.nth, r.weekday) === target.getDate();
      }
      const last = new Date(target.getFullYear(), target.getMonth() + 1, 0).getDate();
      return target.getDate() === Math.min(r.date, last);
    }
    case "yearly": {
      const yd = target.getFullYear() - s.getFullYear();
      if (yd < 0 || yd % iv !== 0) return false;
      const last = new Date(target.getFullYear(), r.month, 0).getDate();
      return target.getMonth() === r.month - 1 && target.getDate() === Math.min(r.date, last);
    }
    default:
      return false;
  }
}

// Effective occurrence for a todo, accounting for single-occurrence moves.
// todo.moves maps "元の日(YYYY-MM-DD)" -> "移動先(YYYY-MM-DD)".
export function occursOnTodo(todo, target) {
  const ds = fmtD(target);
  const moves = todo.moves || {};
  for (const to of Object.values(moves)) if (to === ds) return true; // 移動してきた
  if (moves[ds]) return false; // 別の日へ移動した
  return occursOn(todo.start, todo.repeat, target);
}

// If the given date is a move target, return the original date (else null).
export function movedFrom(todo, dateStr) {
  const moves = todo.moves || {};
  for (const [from, to] of Object.entries(moves)) if (to === dateStr) return from;
  return null;
}

// human summary shown in repeat editor headline
export function repeatSummary(repeat, startStr) {
  const r = repeat || { freq: "none" };
  const start = parseD(startStr);
  const iv = Math.max(1, r.interval || 1);
  switch (r.freq) {
    case "none":
      return "繰り返さない";
    case "daily":
      return iv === 1 ? "毎日" : `${iv}日ごと`;
    case "weekly": {
      const days = (r.weekdays || []).slice().sort((a, b) => a - b).map((w) => DAYS_JP[w]);
      const pre = iv === 1 ? "毎週" : `${iv}週間ごと `;
      return days.length ? `${pre}${days.join("・")}曜日` : pre.trim();
    }
    case "monthly": {
      const pre = iv === 1 ? "毎月" : `${iv}ヶ月ごと `;
      if (r.mode === "nth") {
        const nl = r.nth === "last" ? "最終" : `第${r.nth + 1}`;
        return `${pre}${nl}${DAYS_JP[r.weekday]}曜日`;
      }
      return `${pre}${r.date}日`;
    }
    case "yearly": {
      const pre = iv === 1 ? "毎年" : `${iv}年ごと `;
      return `${pre}${r.month}月${r.date}日`;
    }
    default:
      return "";
  }
}

// short label for cards
export function repeatShort(repeat, startStr) {
  if (!repeat || repeat.freq === "none") return "単発";
  return repeatSummary(repeat, startStr);
}
