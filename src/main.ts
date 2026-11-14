import { device } from "@shared/device";
import { type BusyBarSettings } from "@busy-app/busy-lib";
import manifest from "./appmeta/manifest.json";
import { DEFAULTS, loadSettings, type CaldavSettings } from "./settings.ts";
import { AuthError, CaldavError, fetchEvents, OfflineError } from "./caldav.ts";
import { syncTimeZone, getTzOffsetMs } from "./time.ts";
import { frame, type View } from "./frame.ts";
import type { CalEvent } from "./ical.ts";

const APP = manifest.id;

const TICK_MS = 15000;
const BUSY_SYNC_MS = 30000;
const DAY_MS = 86400000;
const MAX_LISTED = 12;

/** Card id the app uses when it starts the BUSY timer itself, so it can recognize its own timer later. */
const OWN_CARD_ID = "ca1da1e0-0000-4000-8000-000000000000";

const FALLBACK_BBS: BusyBarSettings = { theme: "on_air", show_work_phase_only: false, trigger_smart_home: true };

function main(): void {
  let settings: CaldavSettings = { ...DEFAULTS };
  let events: CalEvent[] = [];
  let fetched = false;
  let lastFetch = 0;
  let errorTitle = "";
  let errorSub = "";
  let selected = -1;
  let shownFrame = "";
  let stopped = false;
  let busyBarSettings: BusyBarSettings = FALLBACK_BBS;
  let lastBusySync = 0;
  let busySyncing = false;

  const report = (err: unknown) =>
    console.error(`${APP}: ${err instanceof Error ? err.message : String(err)}`);

  function setError(title: string, sub: string): void {
    errorTitle = title;
    errorSub = sub;
  }

  async function refresh(): Promise<void> {
    if (!settings.server_url || !settings.username) {
      setError("Not set up", "Open settings");
      return;
    }
    try {
      const wifi = await device.WifiStatusGet();
      if (wifi.state !== "connected") {
        setError("No Wi-Fi", "Check Wi-Fi");
        return;
      }
    } catch (err) {
      report(err);
    }
    await syncTimeZone(() => device.TimeGet());
    const now = Date.now();
    const winStart = now - DAY_MS;
    const winEnd = now + settings.lookahead_days * DAY_MS;
    try {
      events = await fetchEvents(
        { serverUrl: settings.server_url, username: settings.username, password: settings.password },
        winStart,
        winEnd,
        getTzOffsetMs(),
      );
      lastFetch = now;
      fetched = true;
      errorTitle = "";
      errorSub = "";
    } catch (err) {
      lastFetch = now;
      fetched = true;
      if (err instanceof AuthError) setError("Auth failed", "Check login");
      else if (err instanceof OfflineError) setError("Offline", "Check Wi-Fi");
      else if (err instanceof CaldavError) setError("Server error", "Check URL");
      else report(err);
    }
  }

  function listEvents(now: number): CalEvent[] {
    const announced = events.filter((e) => e.reminderMs <= now && now < e.endMs);
    const upcoming = events.filter((e) => e.reminderMs > now);
    return [...announced, ...upcoming].slice(0, MAX_LISTED);
  }

  function computeView(now: number): View {
    if (errorTitle) return { kind: "error", title: errorTitle, sub: errorSub };
    if (!fetched) return { kind: "loading" };
    const list = listEvents(now);
    if (list.length === 0) return { kind: "idle", now };
    let event: CalEvent;
    if (selected >= 0 && selected < list.length) {
      event = list[selected];
    } else {
      const announced = list.filter((e) => e.reminderMs <= now && now < e.endMs);
      event = announced.length > 0 ? announced[announced.length - 1] : list[0];
    }
    const announced = event.reminderMs <= now && now < event.endMs;
    return { kind: "event", event, now, announced };
  }

  async function draw(): Promise<void> {
    if (stopped) return;
    const elements = frame(computeView(Date.now()));
    const next = JSON.stringify(elements);
    if (next === shownFrame) return;
    shownFrame = next;
    await device.DisplayDraw({ application_name: APP, priority: 50, elements });
  }

  /** Sets the BUSY timer for the duration of ongoing events, without touching a timer the user started. */
  async function syncBusy(now: number): Promise<void> {
    const ongoing = events.filter((e) => !e.transparent && e.startMs <= now && now < e.endMs);
    let snapshot;
    try {
      snapshot = await device.BusySnapshotGet();
    } catch (err) {
      report(err);
      return;
    }
    const s = snapshot.snapshot;
    const owned = s.type === "SIMPLE" && "card_id" in s && s.card_id === OWN_CARD_ID;
    try {
      if (ongoing.length > 0) {
        const remaining = Math.max(...ongoing.map((e) => e.endMs)) - now;
        if (owned || s.type === "NOT_STARTED") {
          await device.BusySnapshotSet({
            snapshot: {
              type: "SIMPLE",
              card_id: OWN_CARD_ID,
              time_left_ms: remaining,
              is_paused: false,
              busy_bar_settings: busyBarSettings,
            },
            snapshot_timestamp_ms: now,
          });
        }
      } else if (owned) {
        await device.BusySnapshotSet({
          snapshot: { type: "NOT_STARTED", busy_bar_settings: busyBarSettings },
          snapshot_timestamp_ms: now,
        });
      }
    } catch (err) {
      report(err);
    }
  }

  async function tick(forceRefresh: boolean): Promise<void> {
    if (stopped) return;
    const now = Date.now();
    if (forceRefresh || now - lastFetch >= settings.refresh_minutes * 60000) {
      await refresh();
    }
    if (now - lastBusySync >= BUSY_SYNC_MS && !busySyncing) {
      busySyncing = true;
      lastBusySync = now;
      await syncBusy(now).finally(() => {
        busySyncing = false;
      });
    }
    await draw();
  }

  async function start(): Promise<void> {
    settings = await loadSettings(device, APP);
    try {
      const profile = await device.BusyProfileGet({ slot: "busy" });
      busyBarSettings = profile.busy_bar_settings ?? FALLBACK_BBS;
    } catch (err) {
      report(err);
    }
    await tick(true);
  }

  const timer = setInterval(() => {
    void tick(false).catch(report);
  }, TICK_MS);

  const unbind = listen("input", (event) => {
    if (stopped) return;
    if (event.key === "back" && event.action === "short") {
      stopped = true;
      clearInterval(timer);
      setTimeout(unbind, 0);
      return;
    }
    if (event.key === "start" && event.action === "short") {
      void tick(true).catch(report);
      return;
    }
    if (event.key === "ok" && event.action === "short") {
      selected = -1;
      void draw().catch(report);
      return;
    }
    if (event.key === "encoder") {
      const now = Date.now();
      const list = listEvents(now);
      if (list.length === 0) return;
      const current = selected >= 0 && selected < list.length ? selected : 0;
      const step = event.action === "clockwise" ? event.delta : -event.delta;
      selected = (((current + step) % list.length) + list.length) % list.length;
      void draw().catch(report);
    }
  });

  void start().catch(report);
}

main();
