import { NextResponse } from "next/server";
import { logReviewEvent } from "@/lib/revision-room";

export const runtime = "nodejs";

/** Measurement hook: the client posts link_created / session_started; one line each in sessions/events.jsonl. */
export async function POST(req: Request) {
  const { event, ...data } = (await req.json()) as { event?: unknown } & Record<string, unknown>;
  if (typeof event !== "string" || !event) {
    return NextResponse.json({ error: "event required" }, { status: 400 });
  }
  await logReviewEvent(event, data);
  return NextResponse.json({ ok: true });
}
