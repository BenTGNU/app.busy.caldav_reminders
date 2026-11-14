/** Device time helpers: the JS engine may not apply the device timezone, so local time is derived from /api/time. */

let tzOffsetMs = 0;

/** Reads the device timezone offset from GET /api/time and caches it. */
export async function syncTimeZone(timeGet: () => Promise<{ timestamp: string }>): Promise<void> {
  try {
    const { timestamp } = await timeGet();
    const m = /([+-])(\d{2}):?(\d{2})$/.exec(timestamp);
    if (m) {
      const sign = m[1] === "-" ? -1 : 1;
      tzOffsetMs = sign * (parseInt(m[2], 10) * 60 + parseInt(m[3], 10)) * 60000;
    } else if (timestamp.endsWith("Z")) {
      tzOffsetMs = 0;
    }
  } catch {
    // Keep the previous offset; epoch math below stays correct.
  }
}

export function getTzOffsetMs(): number {
  return tzOffsetMs;
}

const pad = (n: number) => String(n).padStart(2, "0");

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

function local(ms: number): Date {
  return new Date(ms + tzOffsetMs);
}

/** Local wall-clock time as "HH:MM". */
export function formatHM(ms: number): string {
  const d = local(ms);
  return `${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}`;
}

/** Local date as "Nov 14, Fri". */
export function formatDate(ms: number): string {
  const d = local(ms);
  return `${MONTHS[d.getUTCMonth()]} ${d.getUTCDate()}, ${DAYS[d.getUTCDay()]}`;
}

/** Local start time: "14:30" today, "Fri 14:30" on another day. */
export function formatEventTime(ms: number, nowMs: number): string {
  const d = local(ms);
  const today = local(nowMs);
  const sameDay =
    d.getUTCFullYear() === today.getUTCFullYear() &&
    d.getUTCMonth() === today.getUTCMonth() &&
    d.getUTCDate() === today.getUTCDate();
  return sameDay ? formatHM(ms) : `${DAYS[d.getUTCDay()]} ${formatHM(ms)}`;
}

/** "in 5m" / "in 2h" / "now" for a future moment. */
export function formatIn(ms: number, nowMs: number): string {
  const diff = ms - nowMs;
  if (diff <= 45000) return "now";
  const mins = Math.round(diff / 60000);
  if (mins < 90) return `in ${mins}m`;
  return `in ${Math.floor(mins / 60)}h${mins % 60 ? ` ${mins % 60}m` : ""}`;
}
