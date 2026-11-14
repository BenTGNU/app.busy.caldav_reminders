# CalDAV Reminders

Shows CalDAV calendar event reminders on BUSY Bar and sets Busy during events

A JavaScript app for the BUSY Bar, generated from the BUSY JS app template. It reads one CalDAV
calendar straight from the bar over Wi-Fi (no PC involved), shows the title of the event whose
reminder time has come (or whose start has come, when the event has no alarm), and switches the
bar to the BUSY state for the whole duration of the event.

## How it works

- The app sends a CalDAV `REPORT calendar-query` (HTTP `REPORT` method, Basic auth) to the
  calendar collection URL from the settings, for the window *now − 1 day* to *now + Days ahead*.
- Each returned `VEVENT` is parsed (iCalendar): `SUMMARY`, `DTSTART`/`DTEND`/`DURATION`,
  `VALARM TRIGGER`, `STATUS`, `TRANSP`, `RRULE` (DAILY/WEEKLY with BYDAY/MONTHLY/YEARLY, with
  `INTERVAL`, `COUNT`, `UNTIL`), and `EXDATE`.
- An event is *announced* from its reminder time (`DTSTART` + alarm trigger, e.g. 15 min before
  start) until its end. The announced event title is shown on the front display, laid out like the
  Clock app: calendar icon + title + a dimmed sub line (`in 15m`, `until 15:00`, or the start time
  `14:30` / `Fri 14:30` for the next event). Long titles scroll slowly. When nothing is announced,
  the next event is shown dimmed; with no events at all, the screen shows `No events` and the date.
- While an event is ongoing (`DTSTART` ≤ now < `DTEND`, not `TRANSPARENT`), the app sets the BUSY
  timer (`PUT /api/busy/snapshot`, `SIMPLE` with the remaining time) and clears it when the event
  ends. It uses its own `card_id`, so a timer you started yourself is never touched. If the bar
  quits mid-event, the timer keeps running until the event ends.
- Controls: `start` refreshes the calendar now, the `encoder` steps through the announced/upcoming
  events, `ok` returns to the automatic (current/next) event, `back` quits.
- The calendar is polled every *Refresh (min)* minutes; the screen redraws only when something
  visible changes.

Times with a `TZID` or floating times are read as device-local time (the offset comes from
`GET /api/time`); UTC (`...Z`) times are exact. DST transitions inside recurring events are not
modeled. Text is reduced to printable ASCII because the device fonts are bitmap ASCII.

## Settings

| Field             | Meaning                                                                       |
| ----------------- | ----------------------------------------------------------------------------- |
| `Calendar URL`    | CalDAV calendar collection URL, e.g. `https://host/remote.php/dav/calendars/user/personal/` (Nextcloud/ownCloud), or `https://caldav.fastmail.com/calendars/user/alice/default/` |
| `Username`        | CalDAV account username                                                       |
| `Password`        | Password or app-specific password                                             |
| `Days ahead`      | How many days of events to read (1–30, default 7)                             |
| `Refresh (min)`   | Poll interval (1–60 min, default 5)                                           |

Edit them in the BUSY Bar web UI or mobile app; the app reads them at startup.

## Getting started

```sh
npm install
npm run build         # build the app into dist/app.busy.caldav_reminders.tgz
npm run app:install   # install it on the BUSY Bar connected over USB
npm run app:run       # launch the installed app
```

The app's id is `app.busy.caldav_reminders`, set in `src/appmeta/manifest.json`. An id is `<namespace>.<app>`, at most 32 characters, made of Latin letters, digits, underscores, dashes, and dots, and not starting with a dot. If yours still says `app.example`, change it to your own namespace before publishing.

## Layout

`src/` is the app — everything in it is yours to edit.

The entry point is `src/main.ts` (or `src/main.js`). The name is fixed: the build turns it into `scripts/main.js`, the file the BUSY Bar starts. Any imported modules are emitted as separate files alongside it in `scripts/`, unless `npm run build -- --bundle` inlines them.

`src/main.ts` is run from top to bottom, not imported: it starts the app by calling `main()` at the end and must not export anything. Imported modules can use standard exports.

```
my-app/
├── src/                          the app
│   ├── main.ts                   the entry point: function main(), called at the end
│   ├── appmeta/
│   │   ├── manifest.json         id, name, version, api_version
│   │   ├── settings.json         the settings screen — optional
│   │   ├── icon_front_8x8.png    front icon, 8×8 color — optional
│   │   └── icon_back_11x11.png   back icon, 11×11 grayscale — optional
│   ├── images/
│   ├── animations/
│   └── sounds/
├── shared/                       app-level helpers, imported as @shared/*
```

Both icons are optional; without them a default is used.

## Resources

Anything in `src/` that isn't a source file is copied into the package, sorted by what the BUSY Bar can read:

| Extension | Destination |
| --- | --- |
| `.png` `.image` | `images/` |
| `.anim` | `animations/` |
| `.snd` | `sounds/` |
| anything else | `resources/` |

A file in `src/images`, `src/animations` or `src/sounds` keeps its folder as long as the BUSY Bar reads its format.

`images/`, `animations/` and `sounds/` hold only those formats. An image, animation or sound in another format — `.jpg`, `.gif`, `.svg`, `.wav`, `.mp3` and the like — goes to `resources/`, and the build warns that the device cannot read it.

Everything the app draws goes through the layout helpers in `@busy-app/busy-lib`: build a tree out of `row` / `column` / `stack`, hand it to `render()`, and send the result with `device.DisplayDraw()`. The screen is 72×16 pixels.

## Input

`listen("input", handler)` delivers the device keys: `ok`, `start` and `back` with a `press` / `release` / `short` / `long` / `repeat` action, and `encoder` with a `delta` of `1` or `-1`. It returns an unbind function.

Use `short` as the default action for a button press: it fires once, after a normal press and release. `press` fires immediately on key down and is followed by `short`, so handling `press` as a tap can react twice. Use `long` and `repeat` for hold gestures.

## Commands

| Command | Description |
| --- | --- |
| `npm run build` | empties `dist/` and builds the package into `dist/app.busy.caldav_reminders.tgz` |
| `npm run build -- --emit dir` | leaves the `app.busy.caldav_reminders/` folder instead of the `.tgz` |
| `npm run build -- --emit both` | leaves the folder and the `.tgz` |
| `npm run build -- --out <path>` | builds into `<path>` instead, replacing only this app's package there |
| `npm run build -- --tgz-name <name>` | names the `.tgz`, e.g. `"{id}-{version}.tgz"` |
| `npm run build -- --no-minify` | readable output, for debugging |
| `npm run build -- --bundle` | inlines every module into one `main.js` |
| `npm run build -- --addr <host>` | sets the BUSY Bar address the app connects to, `localhost` by default |
| `npm run typecheck` | type-checks the app |
| `npm run app:install` | installs `dist/app.busy.caldav_reminders.tgz` on the BUSY Bar; build it first with `npm run build` |
| `npm run app:uninstall` | removes the app from the BUSY Bar, keeping its settings |
| `npm run app:run` | launches the installed app |
| `npm run app:stop` | quits the running app |

The four `app:` commands talk to the BUSY Bar connected over USB. For a device connected over Wi-Fi, pass `--addr <host>` with its network IP address or hostname, and `--password <password>` if password protection is enabled:

```sh
npm run app:install -- --addr <host>
npm run app:install -- --addr <host> --password <password>
```

## Build output

The package folder is named after the app id:

```
dist/
└── app.busy.caldav_reminders/
    ├── appmeta/manifest.json
    ├── scripts/main.js
    └── images/ animations/ sounds/ resources/
```

By default the build packs that folder into `dist/app.busy.caldav_reminders.tgz`, with the folder itself at the root of the archive, and removes the folder; `--emit dir` keeps only the folder, `--emit both` keeps both. `--tgz-name` gives the archive another name; `{id}` and `{version}` in it are replaced with the manifest values.

## Releasing

Pushing a git tag matching the manifest `version` (e.g. `0.1.0`) builds the app and attaches `app.busy.caldav_reminders-<version>.tgz` to a GitHub release. The release notes open with the app's name, id, version and API version. The release fails when the tag differs from the manifest `version`.

## Manifest

`src/appmeta/manifest.json` carries the app's identity and a couple of knobs (see the [apps documentation](https://github.com/busy-app/busybar-firmware/blob/dev/documentation/JavaScript%20Applications.dox.md)):

| Field | Description |
| --- | --- |
| `format_version` | manifest format, `1` — required |
| `id` | up to 32 characters — required |
| `name` | display name — required |
| `version` | semver, e.g. `1.0.0` — required |
| `api_version` | minimum BUSY Bar HTTP API version the app needs, e.g. `27.12.0` — required |
| `description`, `author` | free form, default `""` |
| `heap_size_kib` | memory for the app heap, 1–512, default 128 |
| `debug` | when true, shown only in developer mode, default false |

Raise `heap_size_kib` if the app runs out of memory.

## Node version

The app builds on Node 24 — the version in `.nvmrc` and the range `engines` allows. Node 26 breaks the build and is excluded. With `fnm` or `nvm` installed, `fnm use` / `nvm use` picks the right one up from `.nvmrc`.

## Settings

To give the app a settings screen, add `src/appmeta/settings.json` describing the fields, then read the stored values:

```ts
import { loadValues } from "@shared/settings";

const values = await loadValues();
```

`loadValues()` returns `null` when nothing is stored yet — use the defaults.
