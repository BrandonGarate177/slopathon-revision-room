import { NextResponse } from "next/server";
import {
  isDemoMode,
  parseCues,
  structureReactionTrack,
  tagWithCues,
  transcribeReactionTrack,
  type RevisionNote,
} from "@/lib/revision-room";
import fixture from "../../../../fixtures/session.json";

export const runtime = "nodejs";
export const maxDuration = 120;

/**
 * Reaction track in: one continuous recording made while the draft played
 * start to finish (MR-1, MR-2). Timestamped, structured notes out (MR-3).
 */
export async function POST(req: Request) {
  const form = await req.formData();
  const offset = Number(form.get("offset_seconds") ?? 0);
  const cues = parseCues(form.get("cues"));

  if (isDemoMode()) {
    // Offline demonstration mode replays the recorded session (OR-13).
    return NextResponse.json({ notes: tagWithCues(fixture.notes as RevisionNote[], cues), demo: true });
  }
  const audio = form.get("audio");
  if (!(audio instanceof Blob)) {
    return NextResponse.json({ error: "audio missing" }, { status: 400 });
  }
  const segments = await transcribeReactionTrack(audio, offset);
  const notes = await structureReactionTrack(segments, cues);
  return NextResponse.json({ notes, demo: false });
}
