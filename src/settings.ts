import type { BusyBar } from "@busy-app/busy-lib";
import { loadValues, type SettingsValues } from "@shared/settings";

export interface CaldavSettings {
  /** CalDAV calendar collection URL, e.g. https://host/remote.php/dav/calendars/user/personal/ */
  server_url: string;
  username: string;
  password: string;
  lookahead_days: number;
  refresh_minutes: number;
}

export const DEFAULTS: CaldavSettings = {
  server_url: "",
  username: "",
  password: "",
  lookahead_days: 7,
  refresh_minutes: 5,
};

function coerce(values: SettingsValues): CaldavSettings {
  const out = { ...DEFAULTS };
  if (typeof values["server_url"] === "string") out.server_url = values["server_url"] as string;
  if (typeof values["username"] === "string") out.username = values["username"] as string;
  if (typeof values["password"] === "string") out.password = values["password"] as string;
  if (typeof values["lookahead_days"] === "number") out.lookahead_days = Math.min(30, Math.max(1, values["lookahead_days"] as number));
  if (typeof values["refresh_minutes"] === "number") out.refresh_minutes = Math.min(60, Math.max(1, values["refresh_minutes"] as number));
  return out;
}

/** Reads the stored settings, falling back to the schema defaults. */
export async function loadSettings(device: BusyBar, appId: string): Promise<CaldavSettings> {
  const fromGlobal = await loadValues();
  if (fromGlobal) return coerce(fromGlobal);
  try {
    const doc = await device.AppsSettingsGet({ app_id: appId });
    return coerce(doc.values ?? {});
  } catch {
    return { ...DEFAULTS };
  }
}
