import { column, measure, render, row, type TextNode } from "@busy-app/busy-lib";
import type { CalEvent } from "./ical.ts";
import { toAscii } from "./text.ts";
import { formatDate, formatEventTime, formatHM, formatIn } from "./time.ts";

export type View =
  | { kind: "loading" }
  | { kind: "error"; title: string; sub: string }
  | { kind: "idle"; now: number }
  | { kind: "event"; event: CalEvent; now: number; announced: boolean };

const ICON = { path: "images/calendar.png", width: 13, height: 14 };

const MARGIN = 1;
const ICON_GAP = 2;
const LINE_GAP = 2;
const AVAIL_W = 72 - MARGIN * 2 - ICON.width - ICON_GAP;

const WHITE = "#FFFFFFFF";
const DIMMED = "#FFFFFF7F";
const RED = "#FF5252FF";

function titleNode(text: string, color: string): TextNode {
  const boldWidth = measure({ type: "text", id: "title", text, font: "bold" }).width;
  const font = boldWidth <= AVAIL_W ? "bold" : "small";
  const node: TextNode = { type: "text", id: "title", text, font, color };
  if (measure({ type: "text", id: "title", text, font }).width > AVAIL_W) {
    node.width = AVAIL_W;
    node.scroll_rate = 40;
    node.scroll_start_delay = 1500;
    node.scroll_repeat_delay = 4000;
  }
  return node;
}

function subNode(text: string): TextNode {
  return { type: "text", id: "sub", text, font: "small", color: DIMMED };
}

/** Builds the front-screen elements (72x16), laid out like the Clock app: icon + main line + sub line. */
export function frame(view: View) {
  if (view.kind === "loading") {
    return render(
      row({ gap: ICON_GAP, justify: "center", align: "center" }, [
        { type: "image", id: "icon", ...ICON },
        column({ gap: LINE_GAP }, [titleNode("Loading...", WHITE)]),
      ]),
    );
  }

  if (view.kind === "error") {
    return render(
      row({ gap: ICON_GAP, justify: "center", align: "center" }, [
        { type: "image", id: "icon", ...ICON },
        column({ gap: LINE_GAP }, [titleNode(view.title, RED), subNode(view.sub)]),
      ]),
    );
  }

  if (view.kind === "idle") {
    return render(
      row({ gap: ICON_GAP, justify: "center", align: "center" }, [
        { type: "image", id: "icon", ...ICON },
        column({ gap: LINE_GAP }, [titleNode("No events", DIMMED), subNode(formatDate(view.now))]),
      ]),
    );
  }

  const event = view.event;
  const title = toAscii(event.title) || "(no title)";
  const ongoing = event.startMs <= view.now && view.now < event.endMs;
  let sub: string;
  if (event.allDay && view.announced) {
    sub = "All day";
  } else if (view.announced && !ongoing) {
    sub = formatIn(event.startMs, view.now);
  } else if (ongoing) {
    sub = `until ${formatHM(event.endMs)}`;
  } else {
    sub = formatEventTime(event.startMs, view.now);
  }
  const color = view.announced ? WHITE : DIMMED;

  return render(
    row({ gap: ICON_GAP, justify: "center", align: "center" }, [
      { type: "image", id: "icon", ...ICON },
      column({ gap: LINE_GAP }, [titleNode(title, color), subNode(sub)]),
    ]),
  );
}
