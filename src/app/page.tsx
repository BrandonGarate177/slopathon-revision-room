"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { RevisionNote, RevisionSheet } from "@/lib/revision-room";

const SONG = "The Clarity Principle";
const SRC = "/audio/clarity-principle.mp3";

type Status = "idle" | "recording" | "reacting" | "thinking";

export default function RevisionRoom() {
  const audioRef = useRef<HTMLAudioElement>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const startedAtRef = useRef(0);
  const holdStartedRef = useRef(0);
  const [status, setStatus] = useState<Status>("idle");
  const [notes, setNotes] = useState<RevisionNote[]>([]);
  const [pending, setPending] = useState<RevisionNote | null>(null);
  const [sheet, setSheet] = useState<RevisionSheet | null>(null);
  const [demo, setDemo] = useState<boolean | null>(null);
  const [error, setError] = useState<string | null>(null);

  const speak = useCallback((text: string, dataUrl?: string | null) => {
    if (dataUrl) {
      new Audio(dataUrl).play();
      return;
    }
    if (typeof window !== "undefined" && "speechSynthesis" in window) {
      window.speechSynthesis.cancel();
      window.speechSynthesis.speak(new SpeechSynthesisUtterance(text));
    }
  }, []);

  const startRecording = useCallback(async () => {
    if (status !== "idle" || sheet) return;
    setError(null);
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    const mimeType = ["audio/webm;codecs=opus", "audio/webm", "audio/mp4"].find((m) =>
      MediaRecorder.isTypeSupported(m),
    );
    const rec = mimeType ? new MediaRecorder(stream, { mimeType }) : new MediaRecorder(stream);
    chunksRef.current = [];
    rec.ondataavailable = (e) => chunksRef.current.push(e.data);
    rec.start();
    recorderRef.current = rec;
    // Stamp the note with where the client was in the draft when they started talking.
    startedAtRef.current = audioRef.current?.currentTime ?? 0;
    holdStartedRef.current = Date.now();
    audioRef.current?.pause();
    setStatus("recording");
  }, [status, sheet]);

  const stopRecording = useCallback(async () => {
    const rec = recorderRef.current;
    if (!rec || status !== "recording") return;
    setStatus("thinking");
    await new Promise<void>((resolve) => {
      rec.onstop = () => resolve();
      rec.stop();
    });
    rec.stream.getTracks().forEach((t) => t.stop());
    const audio = new Blob(chunksRef.current, { type: rec.mimeType || "audio/webm" });
    // A tap instead of a hold gives a blob with no audio frames; ask for a real note instead of calling the API.
    if (Date.now() - holdStartedRef.current < 600 || audio.size < 2000) {
      setError("Hold the button while you talk, then let go.");
      setStatus("idle");
      return;
    }

    const form = new FormData();
    form.append("audio", audio, "note.webm");
    form.append("timestamp_seconds", String(startedAtRef.current));
    form.append("note_index", String(notes.length));
    if (pending) form.append("previous", JSON.stringify(pending));

    try {
      const res = await fetch("/api/note", { method: "POST", body: form });
      const data = (await res.json()) as { note: RevisionNote; demo: boolean; error?: string };
      if (data.error) throw new Error(data.error);
      setDemo(data.demo);
      const note = data.note;
      setNotes((prev) =>
        pending ? prev.map((n) => (n.id === note.id ? note : n)) : [...prev, note],
      );
      if (note.vague && note.clarifying_question) {
        setPending(note);
        speak(note.clarifying_question);
      } else {
        setPending(null);
        audioRef.current?.play();
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setStatus("idle");
    }
  }, [status, notes.length, pending, speak]);

  // Reaction track: press once, the draft plays through, the client talks over it, nothing stops.
  const reactionRef = useRef<MediaRecorder | null>(null);
  const reactionChunksRef = useRef<Blob[]>([]);
  const reactionOffsetRef = useRef(0);

  const finishReaction = useCallback(async () => {
    const rec = reactionRef.current;
    if (!rec) return;
    reactionRef.current = null;
    setStatus("thinking");
    audioRef.current?.pause();
    await new Promise<void>((resolve) => {
      rec.onstop = () => resolve();
      rec.stop();
    });
    rec.stream.getTracks().forEach((t) => t.stop());
    const audio = new Blob(reactionChunksRef.current, { type: rec.mimeType || "audio/webm" });
    const form = new FormData();
    form.append("audio", audio, "reaction.webm");
    form.append("offset_seconds", String(reactionOffsetRef.current));
    try {
      const res = await fetch("/api/reaction", { method: "POST", body: form });
      const data = (await res.json()) as { notes: RevisionNote[]; demo: boolean; error?: string };
      if (data.error) throw new Error(data.error);
      setDemo(data.demo);
      setNotes((prev) => [...prev, ...data.notes]);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setStatus("idle");
    }
  }, []);

  const startReaction = useCallback(async () => {
    if (status !== "idle" || sheet) return;
    setError(null);
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: true, noiseSuppression: true },
    });
    const mimeType = ["audio/webm;codecs=opus", "audio/webm", "audio/mp4"].find((m) =>
      MediaRecorder.isTypeSupported(m),
    );
    const rec = mimeType ? new MediaRecorder(stream, { mimeType }) : new MediaRecorder(stream);
    reactionChunksRef.current = [];
    rec.ondataavailable = (e) => reactionChunksRef.current.push(e.data);
    const el = audioRef.current;
    reactionOffsetRef.current = el?.currentTime ?? 0;
    rec.start(1000);
    reactionRef.current = rec;
    if (el) {
      el.onended = () => finishReaction();
      el.play();
    }
    setStatus("reacting");
  }, [status, sheet, finishReaction]);

  // Hold the space bar to talk, like a walkie-talkie.
  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      if (e.code === "Space" && !e.repeat) {
        e.preventDefault();
        startRecording();
      }
    };
    const up = (e: KeyboardEvent) => {
      if (e.code === "Space") {
        e.preventDefault();
        stopRecording();
      }
    };
    window.addEventListener("keydown", down);
    window.addEventListener("keyup", up);
    return () => {
      window.removeEventListener("keydown", down);
      window.removeEventListener("keyup", up);
    };
  }, [startRecording, stopRecording]);

  const finish = async () => {
    setStatus("thinking");
    audioRef.current?.pause();
    const res = await fetch("/api/sheet", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ song: SONG, notes }),
    });
    const data = (await res.json()) as { sheet: RevisionSheet; readback_audio: string | null; demo: boolean };
    setSheet(data.sheet);
    setDemo(data.demo);
    speak(data.sheet.readback_text, data.readback_audio);
    setStatus("idle");
  };

  const download = () => {
    if (!sheet) return;
    const blob = new Blob([JSON.stringify(sheet, null, 2)], { type: "application/json" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = "revision-sheet.json";
    a.click();
  };

  return (
    <main className="mx-auto max-w-3xl p-6 space-y-6 font-sans">
      <header className="space-y-1">
        <p className="text-xs uppercase tracking-widest text-neutral-500">Business Bangerz · Revision Room</p>
        <h1 className="text-3xl font-bold">Talk back to the draft.</h1>
        <p className="text-neutral-600">
          Two ways in. Hold <kbd className="rounded border px-1">space</kbd> to drop a note where you are. Or record a reaction track: the song plays straight through, you talk over it, every remark lands on the timeline.
          {demo !== null && (
            <span className="ml-2 rounded bg-neutral-200 px-2 py-0.5 text-xs">{demo ? "offline demo mode" : "live"}</span>
          )}
        </p>
      </header>

      <section className="rounded-lg border p-4 space-y-3">
        <p className="font-medium">{SONG}</p>
        <audio ref={audioRef} src={SRC} controls className="w-full" />
        <div className="flex items-center gap-3">
          <button
            onKeyDown={(e) => e.code === "Space" && e.preventDefault()}
            onMouseDown={startRecording}
            onMouseUp={stopRecording}
            onTouchStart={startRecording}
            onTouchEnd={stopRecording}
            disabled={status === "thinking" || status === "reacting" || !!sheet}
            className={`rounded-full px-6 py-3 font-semibold text-white ${
              status === "recording" ? "bg-red-600" : "bg-black"
            } disabled:opacity-40`}
          >
            {status === "recording" ? "Listening…" : status === "thinking" ? "Writing the note…" : "Hold to talk"}
          </button>
          <button
            onClick={status === "reacting" ? finishReaction : startReaction}
            disabled={(status !== "idle" && status !== "reacting") || !!sheet}
            className={`rounded-full px-6 py-3 font-semibold ${
              status === "reacting" ? "bg-red-600 text-white" : "border"
            } disabled:opacity-40`}
          >
            {status === "reacting" ? "Stop reaction track" : "Record reaction track"}
          </button>
          <button
            onClick={finish}
            disabled={notes.length === 0 || status !== "idle" || !!sheet}
            className="rounded-full border px-6 py-3 font-semibold disabled:opacity-40"
          >
            Finish session
          </button>
        </div>
        {pending && (
          <p className="rounded bg-amber-50 p-3 text-amber-900">
            <span className="font-semibold">Agent:</span> {pending.clarifying_question}{" "}
            <span className="text-sm text-amber-700">(hold to answer)</span>
          </p>
        )}
        {error && <p className="text-sm text-red-600">{error}</p>}
      </section>

      <section className="space-y-2">
        <h2 className="text-lg font-semibold">Notes on the timeline</h2>
        {notes.length === 0 && <p className="text-neutral-500">No notes yet.</p>}
        <ul className="space-y-2">
          {notes.map((n) => (
            <li key={n.id} className="rounded border p-3">
              <div className="flex items-center gap-2 text-sm">
                <span className="font-mono">{n.timestamp_label}</span>
                <span className="rounded bg-neutral-100 px-2">{n.section}</span>
                <span className="rounded bg-neutral-100 px-2">{n.category}</span>
                <span
                  className={`rounded px-2 text-white ${
                    n.priority === "must-fix" ? "bg-red-600" : n.priority === "nice-to-have" ? "bg-emerald-600" : "bg-neutral-500"
                  }`}
                >
                  {n.vague ? "needs a word" : n.priority}
                </span>
              </div>
              <p className="mt-1 font-medium">{n.production_note}</p>
              <p className="text-sm text-neutral-500">“{n.transcript}”{n.clarification ? ` → “${n.clarification}”` : ""}</p>
            </li>
          ))}
        </ul>
      </section>

      {sheet && (
        <section className="rounded-lg border bg-neutral-50 p-4 space-y-3">
          <h2 className="text-lg font-semibold">Revision sheet</h2>
          <p>{sheet.summary}</p>
          <p className="text-sm text-neutral-600">{sheet.readback_text}</p>
          <p className="text-xs text-neutral-500">Estimated cost of this session: ${sheet.cost_estimate_usd}</p>
          <div className="flex gap-3">
            <button onClick={download} className="rounded-full bg-black px-5 py-2 text-white">Download JSON</button>
            <button onClick={() => speak(sheet.readback_text)} className="rounded-full border px-5 py-2">Play read-back</button>
          </div>
          <pre className="max-h-80 overflow-auto rounded bg-white p-3 text-xs">{JSON.stringify(sheet, null, 2)}</pre>
        </section>
      )}
    </main>
  );
}
