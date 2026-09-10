import { NextResponse } from "next/server";
import {
  isDemoMode,
  structureRevisionNote,
  transcribeSpokenFeedback,
  type RevisionNote,
} from "@/lib/revision-room";
import fixture from "../../../../fixtures/session.json";

export const runtime = "nodejs";

/**
 * One spoken note in: audio captured while the draft played, plus the playback
 * position (MR-1, MR-2). One structured revision note out (MR-3).
 */
export async function POST(req: Request) {
  const form = await req.formData();
  const timestamp = Number(form.get("timestamp_seconds") ?? 0);
  const previousRaw = form.get("previous");
  const previous = previousRaw ? (JSON.parse(String(previousRaw)) as RevisionNote) : null;
  const noteIndex = Number(form.get("note_index") ?? 0);

  if (isDemoMode()) {
    // Offline demonstration mode: replay a recorded session instead of calling paid APIs (OR-13).
    const notes = fixture.notes as RevisionNote[];
    if (previous) {
      return NextResponse.json({ note: { ...previous, vague: false, clarifying_question: null, clarification: fixture.clarification }, demo: true });
    }
    const note = notes[noteIndex % notes.length];
    return NextResponse.json({ note: { ...note, timestamp_seconds: timestamp || note.timestamp_seconds }, demo: true });
  }

  const audio = form.get("audio");
  if (!(audio instanceof Blob)) {
    return NextResponse.json({ error: "audio missing" }, { status: 400 });
  }
  const transcript = await transcribeSpokenFeedback(audio);
  const note = await structureRevisionNote({
    transcript,
    timestamp_seconds: timestamp,
    previous,
  });
  return NextResponse.json({ note, demo: false });
}
