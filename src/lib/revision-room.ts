/**
 * Revision Room — the whole primary workflow in one module.
 *
 * Friction F2: client feedback on a draft banger arrives as untimestamped,
 * unprioritized prose in email, and someone translates it into production
 * notes by hand. Here the client talks while the track plays. Every spoken
 * note is stamped with the playback position, transcribed, structured, and
 * (when vague) answered with one clarifying question. The session ends as a
 * machine-readable revision sheet the writer can act on directly.
 */
import OpenAI, { toFile } from "openai";

export type Priority = "must-fix" | "nice-to-have" | "unclear";
export type Category =
  | "lyric"
  | "vocal"
  | "instrumentation"
  | "mix"
  | "structure"
  | "other";

export interface RevisionNote {
  id: string;
  /** Playback position in the draft when the client started talking. */
  timestamp_seconds: number;
  timestamp_label: string;
  /** Verbatim transcript of what the client said. */
  transcript: string;
  /** Best guess at the song section the note is about. */
  section: string;
  category: Category;
  /** The production note a writer can act on, in one sentence. */
  production_note: string;
  priority: Priority;
  /** True when the note is too vague to act on and needs one follow-up. */
  vague: boolean;
  /** The one follow-up the agent asks when the note is vague. */
  clarifying_question: string | null;
  /** The client's spoken answer to the clarifying question, if any. */
  clarification: string | null;
  /** The brief-derived cue whose window this note landed in, if any. */
  cue_id: string | null;
}

export type CueKind = "required" | "lyric" | "vibe" | "mix" | "pronunciation";

/** One question from the brief, pinned to a window of the song. */
export interface Cue {
  id: string;
  at: number;
  until?: number;
  section: string;
  kind: CueKind;
  question: string;
  must_confirm?: boolean;
}

export interface CueCheck {
  cue: Cue;
  note: RevisionNote | null;
}

export function cueEnd(c: Cue): number {
  return c.until ?? c.at + 15;
}

/** The cue whose window contains this playback position, if any. */
export function matchCue(timestamp: number, cues: Cue[]): Cue | null {
  return cues.find((c) => timestamp >= c.at && timestamp < cueEnd(c)) ?? null;
}

export interface RevisionSheet {
  song: string;
  created_at: string;
  summary: string;
  must_fix: RevisionNote[];
  nice_to_have: RevisionNote[];
  unclear: RevisionNote[];
  /** What the agent says back to the client to confirm the sheet. */
  readback_text: string;
  cost_estimate_usd: number;
  /** Required cues that got a remark inside their window. */
  confirmed_checks: CueCheck[];
  /** Required cues nobody reacted to. The founder's blind spot, made visible. */
  unanswered_checks: CueCheck[];
}

/** Offline demonstration mode: recorded fixtures, no paid API calls (OR-13). */
export function isDemoMode(): boolean {
  return (
    process.env.REVISION_ROOM_DEMO_MODE === "1" || !process.env.OPENAI_API_KEY
  );
}

function client(): OpenAI {
  return new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
}

export function formatTimestamp(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${s.toString().padStart(2, "0")}`;
}

/** Transcribe the client's spoken feedback into text (OR-1). */
export async function transcribeSpokenFeedback(
  audio: File | Blob,
): Promise<string> {
  const mime = audio.type || "audio/webm";
  const ext = mime.includes("mp4") ? "mp4" : mime.includes("ogg") ? "ogg" : "webm";
  const file = await toFile(Buffer.from(await audio.arrayBuffer()), `note.${ext}`, { type: mime });
  const result = await client().audio.transcriptions.create({
    model: "whisper-1",
    file,
    prompt:
      "Client feedback on a draft song: chorus, verse, bridge, hook, drums, vocals, lyrics, corny, energy.",
  });
  return result.text.trim();
}

const STRUCTURE_PROMPT = `You are the Revision Room agent for Business Bangerz, a company that writes original songs for business messages.
A client is listening to a draft song and talking while it plays. Turn ONE spoken note into a structured production note.

Rules:
- "section" is your best guess at the song section (e.g. "Chorus", "Verse 2", "Intro", "Bridge") from the words and the timestamp. If unsure, use the timestamp label.
- "production_note" is one sentence a songwriter can act on, in the writer's language, not the client's.
- "priority" is "must-fix" if the client is clearly unhappy or says it must change, "nice-to-have" if it is a preference, "unclear" if you cannot tell.
- "vague" is true only when the note cannot be acted on without one more fact (for example "verse two feels corny" — is it the lyric or the delivery?). When vague, write ONE short clarifying_question, spoken naturally, that resolves it. Otherwise clarifying_question is null.
- If a clarification answer is provided, fold it in, set vague to false and clarifying_question to null.
- If a cue question is provided, the client is answering that question: use the cue's section and write the production note as the answer (for example "Client confirms the 80/20 line is audible in the chorus.").
Return only JSON with keys: section, category, production_note, priority, vague, clarifying_question.`;

interface StructuredFields {
  section: string;
  category: Category;
  production_note: string;
  priority: Priority;
  vague: boolean;
  clarifying_question: string | null;
}

/**
 * Turn a transcribed note into a structured revision note (MR-3), asking one
 * follow-up question when the answer is vague or incomplete (OR-3).
 */
export async function structureRevisionNote(input: {
  transcript: string;
  timestamp_seconds: number;
  previous?: RevisionNote | null;
  cues?: Cue[];
}): Promise<RevisionNote> {
  const label = formatTimestamp(input.timestamp_seconds);
  const cue = input.previous?.cue_id
    ? (input.cues ?? []).find((c) => c.id === input.previous?.cue_id) ?? null
    : matchCue(input.timestamp_seconds, input.cues ?? []);
  const user = [
    `Timestamp: ${label}`,
    cue ? `Cue (${cue.section}, ${cue.kind}): the client was asked "${cue.question}"` : "",
    `Client said: "${input.transcript}"`,
    input.previous
      ? `This is an answer to your clarifying question "${input.previous.clarifying_question}" about the earlier note "${input.previous.transcript}".`
      : "",
  ]
    .filter(Boolean)
    .join("\n");

  const completion = await client().chat.completions.create({
    model: "gpt-4o-mini",
    response_format: { type: "json_object" },
    messages: [
      { role: "system", content: STRUCTURE_PROMPT },
      { role: "user", content: user },
    ],
  });
  const fields = JSON.parse(
    completion.choices[0].message.content ?? "{}",
  ) as StructuredFields;

  const base = input.previous;
  return {
    id: base?.id ?? crypto.randomUUID(),
    timestamp_seconds: base?.timestamp_seconds ?? input.timestamp_seconds,
    timestamp_label: base?.timestamp_label ?? label,
    transcript: base?.transcript ?? input.transcript,
    section: fields.section,
    category: fields.category,
    production_note: fields.production_note,
    priority: fields.priority,
    vague: Boolean(fields.vague),
    clarifying_question: fields.vague ? fields.clarifying_question : null,
    clarification: base ? input.transcript : null,
    cue_id: cue?.id ?? base?.cue_id ?? null,
  };
}

/** Rough per-session cost so the founder knows what one run costs (OR-10). */
/** Parse the optional `cues` form field the client sends with every recording. */
export function parseCues(raw: FormDataEntryValue | string | null | undefined): Cue[] {
  if (!raw) return [];
  try {
    const v = JSON.parse(String(raw)) as Cue[] | { cues: Cue[] };
    return Array.isArray(v) ? v : v.cues ?? [];
  } catch {
    return [];
  }
}

/** Demo mode: fixture notes without a cue_id get one by timestamp. */
export function tagWithCues(notes: RevisionNote[], cues: Cue[]): RevisionNote[] {
  return notes.map((n) => ({ ...n, cue_id: n.cue_id ?? matchCue(n.timestamp_seconds, cues)?.id ?? null }));
}

export function estimateSessionCost(notes: RevisionNote[], readbackChars: number): number {
  const whisperMinutes = notes.length * 0.15; // ~9s per spoken note
  const whisper = whisperMinutes * 0.006;
  const structuring = notes.length * 0.0004; // gpt-4o-mini, ~800 tokens per note
  const tts = (readbackChars / 1_000_000) * 15; // tts-1
  return Number((whisper + structuring + tts).toFixed(4));
}

/** Prioritize every note into the revision sheet the writer consumes (MR-3). */
export function buildRevisionSheet(song: string, notes: RevisionNote[], cues: Cue[] = []): RevisionSheet {
  const required = cues.filter((c) => c.must_confirm);
  const checks: CueCheck[] = required.map((cue) => ({
    cue,
    note: notes.find((n) => n.cue_id === cue.id) ?? notes.find((n) => matchCue(n.timestamp_seconds, [cue])) ?? null,
  }));
  const confirmed_checks = checks.filter((c) => c.note);
  const unanswered_checks = checks.filter((c) => !c.note);
  const checkLine = required.length
    ? `${confirmed_checks.length} required check${confirmed_checks.length === 1 ? "" : "s"} confirmed${
        unanswered_checks.length
          ? `, ${unanswered_checks.length} unanswered: ${unanswered_checks.map((c) => `the ${c.cue.section.toLowerCase()} ${c.cue.kind === "required" ? "message" : c.cue.kind}`).join(", ")}`
          : ""
      }.`
    : "";
  const byTime = [...notes].sort((a, b) => a.timestamp_seconds - b.timestamp_seconds);
  const must_fix = byTime.filter((n) => n.priority === "must-fix" && !n.vague);
  const nice_to_have = byTime.filter((n) => n.priority === "nice-to-have" && !n.vague);
  const unclear = byTime.filter((n) => n.priority === "unclear" || n.vague);

  const summary = `${must_fix.length} must-fix, ${nice_to_have.length} nice-to-have, ${unclear.length} still unclear across ${notes.length} timestamped notes.`;
  const readbackParts = [
    `Here is what I have for ${song}.`,
    must_fix.length
      ? `Must fix: ${must_fix.map((n) => `at ${n.timestamp_label}, ${n.production_note}`).join(". ")}.`
      : "Nothing is marked must fix.",
    nice_to_have.length
      ? `Nice to have: ${nice_to_have.map((n) => `at ${n.timestamp_label}, ${n.production_note}`).join(". ")}.`
      : "",
    unclear.length ? `I still need a word on ${unclear.length} note${unclear.length > 1 ? "s" : ""}.` : "",
    checkLine,
    "Sending this to the writer now.",
  ].filter(Boolean);
  const readback_text = readbackParts.join(" ");

  return {
    song,
    created_at: new Date().toISOString(),
    summary,
    must_fix,
    nice_to_have,
    unclear,
    readback_text,
    cost_estimate_usd: estimateSessionCost(notes, readback_text.length),
    confirmed_checks,
    unanswered_checks,
  };
}

/** Speak the sheet back to the client with synthesized speech (OR-2). Returns MP3 bytes. */
export async function speakReadBack(text: string): Promise<Buffer> {
  const speech = await client().audio.speech.create({
    model: "tts-1",
    voice: "alloy",
    input: text,
  });
  return Buffer.from(await speech.arrayBuffer());
}

/**
 * Reaction track: the client talks over the whole draft without stopping the
 * music, and the transcription's own segment timestamps place every remark on
 * the song timeline (OR-1, MR-3). `offset_seconds` is where playback was when
 * recording began, normally zero.
 */
export async function transcribeReactionTrack(
  audio: File | Blob,
  offset_seconds = 0,
): Promise<Array<{ start: number; text: string }>> {
  const mime = audio.type || "audio/webm";
  const ext = mime.includes("mp4") ? "mp4" : mime.includes("ogg") ? "ogg" : "webm";
  const file = await toFile(Buffer.from(await audio.arrayBuffer()), `reaction.${ext}`, { type: mime });
  const result = await client().audio.transcriptions.create({
    model: "whisper-1",
    file,
    response_format: "verbose_json",
    prompt:
      "A client reacting out loud to a draft song while it plays: chorus, verse, bridge, hook, drums, vocals, lyrics, corny, energy, love it, keep that.",
  });
  const segments = (result as unknown as { segments?: Array<{ start: number; text: string }> }).segments ?? [];
  return segments
    .map((s) => ({ start: s.start + offset_seconds, text: s.text.trim() }))
    .filter((s) => s.text.length > 3);
}

/** Every reaction segment becomes one structured revision note. */
export async function structureReactionTrack(
  segments: Array<{ start: number; text: string }>,
  cues: Cue[] = [],
): Promise<RevisionNote[]> {
  return Promise.all(
    segments.map((s) => structureRevisionNote({ transcript: s.text, timestamp_seconds: s.start, cues })),
  );
}
