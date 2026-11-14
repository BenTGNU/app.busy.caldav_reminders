/** Minimal iCalendar (RFC 5545) reader: VEVENTs with alarms and a practical subset of RRULE. */

export interface CalEvent {
  uid: string;
  title: string;
  startMs: number;
  endMs: number;
  /** When the reminder fires: start + VALARM trigger (negative = before start), or start. */
  reminderMs: number;
  allDay: boolean;
  /** TRANSP:TRANSPARENT events do not block time, so they never set Busy. */
  transparent: boolean;
}

interface Prop {
  name: string;
  params: Record<string, string>;
  value: string;
}

const DAY_MS = 86400000;
const WEEKDAY_CODES = ["SU", "MO", "TU", "WE", "TH", "FR", "SA"];

/** Splits a content line into name, parameters and value, honoring quoted parameter values. */
function splitProp(line: string): Prop | null {
  let inQuote = false;
  let colon = -1;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (c === '"') inQuote = !inQuote;
    else if (c === ":" && !inQuote) {
      colon = i;
      break;
    }
  }
  if (colon < 0) return null;
  const parts = line.slice(0, colon).split(";");
  const params: Record<string, string> = {};
  for (let k = 1; k < parts.length; k++) {
    const eq = parts[k].indexOf("=");
    if (eq > 0) params[parts[k].slice(0, eq).toUpperCase()] = parts[k].slice(eq + 1).replace(/^"|"$/g, "");
  }
  return { name: parts[0].toUpperCase(), params, value: line.slice(colon + 1) };
}

/** Unfolds continuation lines (RFC 5545 3.1). */
function unfold(text: string): string[] {
  const raw = text.split(/\r\n|\r|\n/);
  const lines: string[] = [];
  for (const l of raw) {
    if ((l.startsWith(" ") || l.startsWith("\t")) && lines.length > 0) {
      lines[lines.length - 1] += l.slice(1);
    } else if (l.length > 0) {
      lines.push(l);
    }
  }
  return lines;
}

/** Unescapes TEXT values (RFC 5545 3.3.11). */
function unescapeText(value: string): string {
  return value.replace(/\\(.)/g, (_m, c: string) => {
    if (c === "n" || c === "N") return "\n";
    return c;
  });
}

/** Parses a DATE or DATE-TIME value. UTC ("Z") is exact; floating and TZID values are read as device-local time. */
function parseDateTime(value: string, params: Record<string, string>, tzOffsetMs: number): { ms: number; allDay: boolean } | null {
  const v = value.trim();
  if (!/^\d{8}(T\d{6}(Z)?)?$/.test(v)) return null;
  const allDay = v.length === 8;
  const y = parseInt(v.slice(0, 4), 10);
  const mo = parseInt(v.slice(4, 6), 10) - 1;
  const d = parseInt(v.slice(6, 8), 10);
  if (v.length === 8) {
    return { ms: Date.UTC(y, mo, d, 0, 0, 0) - tzOffsetMs, allDay: true };
  }
  const h = parseInt(v.slice(9, 11), 10);
  const mi = parseInt(v.slice(11, 13), 10);
  const s = parseInt(v.slice(13, 15), 10);
  const ms = Date.UTC(y, mo, d, h, mi, s);
  void params;
  return { ms: v.endsWith("Z") ? ms : ms - tzOffsetMs, allDay };
}

/** Parses an ISO 8601 duration, e.g. "-PT15M", "P1DT2H". Returns signed milliseconds. */
function parseDuration(value: string): number | null {
  const m = /^(-)?P(?:(\d+)W)?(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?)?$/.exec(value.trim());
  if (!m) return null;
  const sign = m[1] ? -1 : 1;
  const weeks = m[2] ? parseInt(m[2], 10) : 0;
  const days = m[3] ? parseInt(m[3], 10) : 0;
  const hours = m[4] ? parseInt(m[4], 10) : 0;
  const mins = m[5] ? parseInt(m[5], 10) : 0;
  const secs = m[6] ? parseInt(m[6], 10) : 0;
  return sign * (((weeks * 7 + days) * 24 + hours) * 3600 + mins * 60 + secs) * 1000;
}

interface RRule {
  freq: string;
  interval: number;
  count?: number;
  untilMs?: number;
  byday: string[];
}

function parseRrule(value: string): RRule | null {
  const parts: Record<string, string> = {};
  for (const piece of value.split(";")) {
    const eq = piece.indexOf("=");
    if (eq > 0) parts[piece.slice(0, eq).toUpperCase()] = piece.slice(eq + 1);
  }
  const freq = (parts["FREQ"] ?? "").toUpperCase();
  if (!freq) return null;
  return {
    freq,
    interval: Math.max(1, parseInt(parts["INTERVAL"] ?? "1", 10) || 1),
    count: parts["COUNT"] ? parseInt(parts["COUNT"], 10) : undefined,
    untilMs: undefined,
    byday: (parts["BYDAY"] ?? "").split(",").map((d) => d.toUpperCase()).filter((d) => /^(MO|TU|WE|TH|FR|SA|SU)/.test(d)),
  };
}

const MAX_OCCURRENCES = 100;

/** Expands recurrence start times within the window. Supports DAILY/WEEKLY(+BYDAY)/MONTHLY/YEARLY with INTERVAL, COUNT, UNTIL. */
function expandStarts(startMs: number, allDay: boolean, rrule: RRule, tzOffsetMs: number, winEndMs: number): number[] {
  const out: number[] = [];
  const start = new Date(startMs + tzOffsetMs); // wall-clock in UTC frame
  const timeOfDay = startMs + tzOffsetMs - Date.UTC(start.getUTCFullYear(), start.getUTCMonth(), start.getUTCDate());
  const day0 = Date.UTC(start.getUTCFullYear(), start.getUTCMonth(), start.getUTCDate());

  if (rrule.freq === "WEEKLY" && rrule.byday.length > 0) {
    const anchor = day0 - ((start.getUTCDay() + 6) % 7) * DAY_MS; // Monday of the start week
    const wanted = rrule.byday;
    for (let day = day0; day < winEndMs + tzOffsetMs && out.length < MAX_OCCURRENCES; day += DAY_MS) {
      const code = WEEKDAY_CODES[new Date(day).getUTCDay()];
      if (!wanted.includes(code)) continue;
      const weeks = Math.floor((day - anchor) / (7 * DAY_MS));
      if (weeks % rrule.interval !== 0) continue;
      const occ = day + timeOfDay - tzOffsetMs;
      if (occ >= winEndMs) break;
      if (rrule.untilMs !== undefined && occ > rrule.untilMs) break;
      out.push(occ);
      if (rrule.count !== undefined && out.length >= rrule.count) break;
    }
    return out;
  }

  for (let k = 0; k < MAX_OCCURRENCES; k++) {
    let occ: number;
    if (rrule.freq === "DAILY") {
      occ = startMs + k * rrule.interval * DAY_MS;
    } else if (rrule.freq === "WEEKLY") {
      occ = startMs + k * rrule.interval * 7 * DAY_MS;
    } else if (rrule.freq === "MONTHLY") {
      occ = Date.UTC(start.getUTCFullYear(), start.getUTCMonth() + k * rrule.interval, start.getUTCDate(), start.getUTCHours(), start.getUTCMinutes(), start.getUTCSeconds()) - tzOffsetMs;
    } else if (rrule.freq === "YEARLY") {
      occ = Date.UTC(start.getUTCFullYear() + k * rrule.interval, start.getUTCMonth(), start.getUTCDate(), start.getUTCHours(), start.getUTCMinutes(), start.getUTCSeconds()) - tzOffsetMs;
    } else {
      break;
    }
    void allDay;
    if (occ >= winEndMs) break;
    if (rrule.untilMs !== undefined && occ > rrule.untilMs) break;
    out.push(occ);
    if (rrule.count !== undefined && out.length >= rrule.count) break;
  }
  return out;
}

interface RawEvent {
  uid: string;
  title: string;
  startMs: number;
  endMs: number;
  hasStart: boolean;
  hasEnd: boolean;
  allDay: boolean;
  transparent: boolean;
  cancelled: boolean;
  triggerMs: number | null;
  rrule: RRule | null;
  exdates: number[];
}

/** Parses one VCALENDAR text into the events overlapping [winStartMs, winEndMs). */
export function parseEvents(ics: string, tzOffsetMs: number, winStartMs: number, winEndMs: number): CalEvent[] {
  const lines = unfold(ics);
  const events: CalEvent[] = [];
  let cur: RawEvent | null = null;
  let inAlarm = false;

  const finish = () => {
    if (!cur || cur.cancelled || !cur.hasStart) {
      cur = null;
      return;
    }
    if (!cur.hasEnd) {
      // RFC 5545: a DATE start without DTEND/DURATION lasts one day, a DATE-TIME start ends when it starts.
      cur.endMs = cur.allDay ? cur.startMs + DAY_MS : cur.startMs;
    }
    const durationMs = Math.max(0, cur.endMs - cur.startMs);
    const starts = cur.rrule ? expandStarts(cur.startMs, cur.allDay, cur.rrule, tzOffsetMs, winEndMs) : [cur.startMs];
    for (const startMs of starts) {
      if (cur.exdates.includes(startMs)) continue;
      const endMs = startMs + durationMs;
      if (endMs <= winStartMs || startMs >= winEndMs) continue;
      const trigger = cur.triggerMs ?? 0;
      events.push({
        uid: cur.uid,
        title: cur.title,
        startMs,
        endMs,
        reminderMs: startMs + trigger,
        allDay: cur.allDay,
        transparent: cur.transparent,
      });
    }
    cur = null;
  };

  for (const line of lines) {
    const upper = line.toUpperCase();
    if (upper === "BEGIN:VEVENT") {
      cur = { uid: "", title: "", startMs: 0, endMs: 0, hasStart: false, hasEnd: false, allDay: false, transparent: false, cancelled: false, triggerMs: null, rrule: null, exdates: [] };
      inAlarm = false;
      continue;
    }
    if (upper === "END:VEVENT") {
      finish();
      continue;
    }
    if (!cur) continue;
    if (upper === "BEGIN:VALARM") {
      inAlarm = true;
      continue;
    }
    if (upper === "END:VALARM") {
      inAlarm = false;
      continue;
    }
    const prop = splitProp(line);
    if (!prop) continue;
    if (inAlarm) {
      if (prop.name === "TRIGGER" && cur.triggerMs === null) {
        if ((prop.params["VALUE"] ?? "DURATION").toUpperCase() === "DATE-TIME") {
          const parsed = parseDateTime(prop.value, prop.params, tzOffsetMs);
          if (parsed) cur.triggerMs = parsed.ms - cur.startMs;
        } else {
          const d = parseDuration(prop.value);
          if (d !== null) cur.triggerMs = d;
        }
      }
      continue;
    }
    switch (prop.name) {
      case "UID":
        cur.uid = prop.value.trim();
        break;
      case "SUMMARY":
        cur.title = unescapeText(prop.value);
        break;
      case "DTSTART": {
        const parsed = parseDateTime(prop.value, prop.params, tzOffsetMs);
        if (parsed) {
          cur.startMs = parsed.ms;
          cur.allDay = parsed.allDay;
          cur.hasStart = true;
        }
        break;
      }
      case "DTEND": {
        const parsed = parseDateTime(prop.value, prop.params, tzOffsetMs);
        if (parsed) {
          cur.endMs = parsed.ms;
          cur.hasEnd = true;
        }
        break;
      }
      case "DURATION": {
        const d = parseDuration(prop.value);
        if (d !== null) {
          cur.endMs = cur.startMs + d;
          cur.hasEnd = true;
        }
        break;
      }
      case "STATUS":
        if (prop.value.trim().toUpperCase() === "CANCELLED") cur.cancelled = true;
        break;
      case "TRANSP":
        if (prop.value.trim().toUpperCase() === "TRANSPARENT") cur.transparent = true;
        break;
      case "RRULE": {
        const r = parseRrule(prop.value);
        if (r) {
          if (prop.value.includes("UNTIL=")) {
            const until = /UNTIL=([^;]+)/.exec(prop.value);
            if (until) {
              const parsed = parseDateTime(until[1], {}, tzOffsetMs);
              if (parsed) r.untilMs = parsed.ms;
            }
          }
          cur.rrule = r;
        }
        break;
      }
      case "EXDATE": {
        for (const v of prop.value.split(",")) {
          const parsed = parseDateTime(v, prop.params, tzOffsetMs);
          if (parsed) cur.exdates.push(parsed.ms);
        }
        break;
      }
      default:
        break;
    }
  }
  finish();

  for (const e of events) {
    if (e.endMs < e.startMs) e.endMs = e.startMs;
  }

  events.sort((a, b) => a.startMs - b.startMs || a.reminderMs - b.reminderMs);
  return events;
}
