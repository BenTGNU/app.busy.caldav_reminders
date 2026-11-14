import { base64Encode } from "./base64.ts";
import { extractTagText } from "./xml.ts";
import { parseEvents, type CalEvent } from "./ical.ts";

export interface CaldavConfig {
  serverUrl: string;
  username: string;
  password: string;
}

export class CaldavError extends Error {}
export class AuthError extends CaldavError {}
export class OfflineError extends CaldavError {}

const pad = (n: number) => String(n).padStart(2, "0");

/** Formats epoch ms as a CalDAV UTC date-time, e.g. "20251113T143000Z". */
function formatUtc(ms: number): string {
  const d = new Date(ms);
  return `${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}T${pad(d.getUTCHours())}${pad(d.getUTCMinutes())}${pad(d.getUTCSeconds())}Z`;
}

function queryBody(winStartMs: number, winEndMs: number): string {
  return (
    '<?xml version="1.0" encoding="utf-8"?>\n' +
    '<C:calendar-query xmlns:D="DAV:" xmlns:C="urn:ietf:params:xml:ns:caldav">' +
    "<D:prop><C:calendar-data/></D:prop>" +
    "<C:filter><C:comp-filter name=\"VCALENDAR\"><C:comp-filter name=\"VEVENT\">" +
    `<C:time-range start="${formatUtc(winStartMs)}" end="${formatUtc(winEndMs)}"/>` +
    "</C:comp-filter></C:comp-filter></C:filter>" +
    "</C:calendar-query>"
  );
}

/**
 * Fetches the events of one calendar collection overlapping [winStartMs, winEndMs)
 * with a CalDAV REPORT calendar-query, right from the device over Wi-Fi.
 */
export async function fetchEvents(
  config: CaldavConfig,
  winStartMs: number,
  winEndMs: number,
  tzOffsetMs: number,
): Promise<CalEvent[]> {
  const url = config.serverUrl.endsWith("/") ? config.serverUrl : config.serverUrl + "/";
  let res: Response;
  try {
    res = await fetch(url, {
      method: "REPORT",
      headers: {
        Authorization: "Basic " + base64Encode(`${config.username}:${config.password}`),
        "Content-Type": "application/xml; charset=utf-8",
        Depth: "1",
      },
      body: queryBody(winStartMs, winEndMs),
    });
  } catch (err) {
    throw new OfflineError(err instanceof Error ? err.message : String(err));
  }

  if (res.status === 401 || res.status === 403) {
    throw new AuthError(`HTTP ${res.status}`);
  }
  if (res.status !== 207 && !res.ok) {
    throw new CaldavError(`HTTP ${res.status}`);
  }

  const text = await res.text();
  const events: CalEvent[] = [];
  const seen = new Set<string>();
  for (const data of extractTagText(text, "calendar-data")) {
    for (const event of parseEvents(data, tzOffsetMs, winStartMs, winEndMs)) {
      const key = `${event.uid}|${event.startMs}`;
      if (seen.has(key)) continue;
      seen.add(key);
      events.push(event);
    }
  }
  events.sort((a, b) => a.startMs - b.startMs || a.reminderMs - b.reminderMs);
  return events;
}
