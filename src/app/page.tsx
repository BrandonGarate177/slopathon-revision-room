"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { RevisionNote, RevisionSheet } from "@/lib/revision-room";
import example from "../../fixtures/example-session.json";

const SONG = "The Clarity Principle";
const SRC = "/audio/clarity-principle.mp3";
const SONG_ID = "clarity-principle";

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
  const [time, setTime] = useState(0);
  const [duration, setDuration] = useState(0);
  // Async review link: ?mode=client opens the same page for the client alone.
  const [mode, setMode] = useState<"founder" | "client">("founder");
  const [started, setStarted] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const isClient = mode === "client";
  useEffect(() => {
    // Deferred so the server-rendered founder view hydrates cleanly before the URL flips it.
    const t = setTimeout(() => {
      if (new URLSearchParams(window.location.search).get("mode") === "client") setMode("client");
    }, 0);
    return () => clearTimeout(t);
  }, []);
  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 2800);
    return () => clearTimeout(t);
  }, [toast]);
  useEffect(() => {
    if (!isClient || status !== "reacting") return;
    const warn = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = "";
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [isClient, status]);
  // Deterministic waveform bars so the timeline reads as a song, not a progress bar.
  const bars = Array.from({ length: 48 }, (_, i) => 22 + Math.round(60 * Math.abs(Math.sin(i * 1.7) * Math.cos(i * 0.6))));
  const pct = (sec: number) => (duration ? Math.min(100, (sec / duration) * 100) : 0);
  const priClass = (n: RevisionNote) => (n.vague ? "word" : n.priority === "must-fix" ? "must" : n.priority === "nice-to-have" ? "nice" : "unclear");
  const priLabel = (n: RevisionNote) => (n.vague ? "needs a word" : n.priority === "must-fix" ? "must fix" : n.priority === "nice-to-have" ? "nice to have" : "unclear");
  const seek = (e: React.MouseEvent<HTMLDivElement>) => {
    const el = audioRef.current;
    if (!el || !duration) return;
    const r = e.currentTarget.getBoundingClientRect();
    el.currentTime = ((e.clientX - r.left) / r.width) * duration;
  };
  const needsWord = notes.filter((n) => n.vague).length;


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
      return data.notes;
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setStatus("idle");
    }
    return [];
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
    if (isClient) return; // no push-to-talk in client mode
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
  }, [startRecording, stopRecording, isClient]);

  // `extra` carries notes that finishReaction just returned; React state hasn't caught up in the same tick.
  const finish = async (extra: RevisionNote[] = []) => {
    setStatus("thinking");
    audioRef.current?.pause();
    const res = await fetch("/api/sheet", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ song: SONG, notes: [...notes, ...extra], mode, song_id: SONG_ID }),
    });
    const data = (await res.json()) as { sheet: RevisionSheet; readback_audio: string | null; demo: boolean };
    setSheet(data.sheet);
    setDemo(data.demo);
    speak(data.sheet.readback_text, data.readback_audio);
    setStatus("idle");
  };

  // Example session: a full fictional client review, loaded in one click for the demo.
  const showExample = async () => {
    const exNotes = example.notes as RevisionNote[];
    setNotes(exNotes);
    setPending(null);
    setError(null);
    setStatus("thinking");
    const res = await fetch("/api/sheet", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ song: SONG, notes: exNotes }),
    });
    const data = (await res.json()) as { sheet: RevisionSheet; readback_audio: string | null; demo: boolean };
    setSheet(data.sheet);
    setStatus("idle");
  };

  const clearSession = () => {
    setNotes([]);
    setSheet(null);
    setPending(null);
    setError(null);
  };

  const logEvent = (event: string, data: Record<string, unknown> = {}) =>
    fetch("/api/events", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ event, song: SONG_ID, ...data }),
    }).catch(() => {});

  const copyLink = async () => {
    const url = `${window.location.origin}/?mode=client&song=${SONG_ID}`;
    try {
      await navigator.clipboard.writeText(url);
      setToast("Link copied. Send it in the delivery email.");
    } catch {
      setToast(url);
    }
    logEvent("link_created");
  };

  // Client mode: mic permission is asked for on Start, not on load. Song plays from 0:00.
  const startClient = async () => {
    const el = audioRef.current;
    if (el) el.currentTime = 0;
    setStarted(true);
    logEvent("session_started", { mode: "client" });
    try {
      await startReaction();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setStarted(false);
    }
  };

  const clientDone = async () => {
    const fresh = status === "reacting" ? await finishReaction() : [];
    await finish(fresh ?? []);
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
    <main className="wrap">
      <header>
        <div className="eyebrow">
          Business Bangerz · Revision Room
          {demo !== null && <span className={`pill ${demo ? "" : "live"}`}>{demo ? "offline demo" : "live"}</span>}
        </div>
        {isClient ? (
          <>
            <h1>{SONG}</h1>
            <p className="lede">Matt sent you a draft. Press record, say what you hear, and you&apos;re done.</p>
          </>
        ) : (
          <>
            <h1>Talk back to the draft.</h1>
            <p className="lede">
              Press record. The song plays straight through, you say what you hear, and every remark lands on the timeline. Or hold{" "}
              <kbd>space</kbd> to drop one note right where you are.
            </p>
          </>
        )}
      </header>

      {isClient && !started && (
        <section className="landing" aria-label="Start your review">
          <h2>Ready when you are</h2>
          <p className="lede">
            The song plays from the top. Talk over it like Matt is in the room: what you like, what&apos;s off, what you&apos;d change. Press Done when it ends.
          </p>
          <p className="consent">
            Your voice is used to write revision notes for this song, kept 30 days, delete any time.
          </p>
          <div className="controls">
            <button className="btn rec" onClick={startClient}>
              <span className="o" />
              Start
            </button>
          </div>
          {error && <p className="err">{error}</p>}
        </section>
      )}

      {isClient && sheet && (
        <section className="closing" aria-label="Sent">
          <h2>Sent to Matt.</h2>
          <p>You can close this tab. Here&apos;s what was captured, so you know it landed.</p>
        </section>
      )}

      <section className="player" aria-label="Draft player" style={isClient && (!started || sheet) ? { display: "none" } : undefined}>
        <div className="song">
          <span className="t">{SONG}</span>
          <span className="m">{formatTime(time)} / {formatTime(duration)}</span>
        </div>
        <div className="timeline" onClick={seek} aria-hidden="true">
          {bars.map((h, i) => (
            <i key={i} className={pct(time) > (i / bars.length) * 100 ? "p" : ""} style={{ height: `${h}%` }} />
          ))}
          <span className="head" data-t={formatTime(time)} style={{ left: `${pct(time)}%` }} />
          {notes.map((n) => (
            <span key={n.id} className={`dot ${priClass(n)}`} style={{ left: `${pct(n.timestamp_seconds)}%` }} title={n.timestamp_label} />
          ))}
        </div>
        <audio
          ref={audioRef}
          src={SRC}
          controls
          onTimeUpdate={(e) => setTime(e.currentTarget.currentTime)}
          onLoadedMetadata={(e) => setDuration(e.currentTarget.duration)}
          onDurationChange={(e) => setDuration(e.currentTarget.duration)}
          onCanPlay={(e) => setDuration(e.currentTarget.duration)}
        />
        {isClient ? (
          <div className="controls">
            {!sheet && (
              <button className={`btn ${status === "reacting" ? "hot" : "rec"}`} onClick={clientDone} disabled={status === "thinking"}>
                <span className="o" />
                {status === "thinking" ? "Writing your notes…" : "Done"}
              </button>
            )}
            <span className="hint">
              {status === "reacting" ? "Listening. Talk whenever." : `${notes.length} note${notes.length === 1 ? "" : "s"}`}
            </span>
          </div>
        ) : (
        <div className="controls">
          <button
            className={`btn ${status === "reacting" ? "hot" : "rec"}`}
            onClick={status === "reacting" ? finishReaction : startReaction}
            disabled={(status !== "idle" && status !== "reacting") || !!sheet}
          >
            <span className="o" />
            {status === "reacting" ? "Stop reaction track" : "Record reaction track"}
          </button>
          <button
            className={`btn ${status === "recording" ? "hot" : ""}`}
            onKeyDown={(e) => e.code === "Space" && e.preventDefault()}
            onMouseDown={startRecording}
            onMouseUp={stopRecording}
            onTouchStart={startRecording}
            onTouchEnd={stopRecording}
            disabled={status === "thinking" || status === "reacting" || !!sheet}
          >
            {status === "recording" ? "Listening…" : status === "thinking" ? "Writing the note…" : "Hold to talk"}
          </button>
          <button className="btn ghost" onClick={() => finish()} disabled={notes.length === 0 || status !== "idle" || !!sheet}>
            Finish session
          </button>
          <button className="btn ghost" onClick={sheet || notes.length ? clearSession : showExample} disabled={status !== "idle"}>
            {sheet || notes.length ? "Clear" : "Show example session"}
          </button>
          <button className="btn ghost" onClick={copyLink} title="Client-mode link for the delivery email">
            Copy review link
          </button>
          <span className="hint">
            {notes.length} note{notes.length === 1 ? "" : "s"}{needsWord ? ` · ${needsWord} needs a word` : ""}
          </span>
        </div>
        )}
        {pending && (
          <div className="callout" role="status">
            <span className="who">Agent asks</span>
            <span className="q">{pending.clarifying_question}</span>
            <span className="how">Just answer out loud. Hold to talk, and the note at {pending.timestamp_label} updates itself.</span>
          </div>
        )}
        {error && <p className="err">{error}</p>}
      </section>

      <section className="sec" aria-label="Notes on the timeline" style={isClient && !started ? { display: "none" } : undefined}>
        <h2>On the timeline</h2>
        {notes.length === 0 && <p className="empty">No notes yet. Press record and say what you hear.</p>}
        <ul className="notes">
          {notes.map((n) => (
            <li key={n.id} className="note">
              <span className="ts">{n.timestamp_label}</span>
              <div className="body">
                <div className="chips">
                  <span className="chip">{n.section}</span>
                  <span className="chip">{n.category}</span>
                  <span className={`chip pri ${priClass(n)}`}>{priLabel(n)}</span>
                </div>
                <div className="pn">{n.production_note}</div>
                <div className="qt">
                  “{n.transcript}”{n.clarification ? <> → <span>“{n.clarification}”</span></> : null}
                </div>
              </div>
            </li>
          ))}
        </ul>
      </section>

      {sheet && (
        <section className="sheet" aria-label="Revision sheet">
          <div className="top">
            <h2>Revision sheet</h2>
            {!isClient && <span className="cost">session cost ≈ ${sheet.cost_estimate_usd} · {notes.length} notes</span>}
          </div>
          <div className="tally">
            <div className="must"><span className="n">{sheet.must_fix.length}</span><span className="l">must fix</span></div>
            <div className="nice"><span className="n">{sheet.nice_to_have.length}</span><span className="l">nice to have</span></div>
            <div className="word"><span className="n">{sheet.unclear.length}</span><span className="l">still unclear</span></div>
          </div>
          <p className="readback"><b>Read-back:</b> {sheet.readback_text}</p>
          {!isClient && (
            <>
              <div className="controls">
                <button className="btn solid" onClick={download}>Download JSON</button>
                <button className="btn" onClick={() => speak(sheet.readback_text)}>Play read-back</button>
              </div>
              <pre className="json">{JSON.stringify(sheet, null, 2)}</pre>
            </>
          )}
        </section>
      )}
      {toast && <div className="toast" role="status">{toast}</div>}
    </main>
  );
}

function formatTime(s: number) {
  if (!Number.isFinite(s)) return "0:00";
  return `${Math.floor(s / 60)}:${Math.floor(s % 60).toString().padStart(2, "0")}`;
}
