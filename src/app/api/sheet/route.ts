import { NextResponse } from "next/server";
import {
  buildRevisionSheet,
  isDemoMode,
  saveRevisionSession,
  speakReadBack,
  type RevisionNote,
} from "@/lib/revision-room";

export const runtime = "nodejs";

/**
 * Session end: every timestamped note becomes one prioritized revision sheet
 * (the artifact a downstream production step consumes, MR-3) plus a spoken
 * read-back for the client (OR-2).
 */
export async function POST(req: Request) {
  const { song, notes, mode = "founder", song_id = "clarity-principle" } = (await req.json()) as {
    song: string;
    notes: RevisionNote[];
    mode?: string;
    song_id?: string;
  };
  const sheet = buildRevisionSheet(song, notes);
  // A failed disk write must not take the read-back down with it.
  await saveRevisionSession(sheet, { mode, song: song_id }).catch((e) => console.error("saveRevisionSession", e));

  if (isDemoMode()) {
    // Browser speech synthesis handles the read-back in offline mode (OR-13).
    return NextResponse.json({ sheet, readback_audio: null, demo: true });
  }
  const mp3 = await speakReadBack(sheet.readback_text);
  return NextResponse.json({
    sheet,
    readback_audio: `data:audio/mpeg;base64,${mp3.toString("base64")}`,
    demo: false,
  });
}
