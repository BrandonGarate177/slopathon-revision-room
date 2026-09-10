# Revision Room

## 1. What this is

**Revision Room** lets a Business Bangerz client talk back to a draft banger while it plays, and turns what they say into a timestamped, prioritized revision sheet the writer can act on. The client holds a key, says "verse two feels corny" at 0:47, and the sheet already knows which verse, what kind of problem, and how much it matters.

## 2. The outcome it targets

**Outcome: reduce cost.** **Friction: F2, revision friction.**

Today feedback on a draft arrives as a paragraph of email: untimestamped, unprioritized, ambiguous. The founder reads it, re-listens to the track to figure out which bar "the corny part" is, guesses whether "must" means must, and writes the production notes himself. A song costs roughly four cents to generate; the conversation around it is where the hours go. Revision Room removes the translation step and the second round of "wait, which part?" email. Our estimate is 1.5 to 2 founder hours back per song, which at a solo shop is the difference between 3 and 4 songs a month at the same hours.

## 3. What actually works

Real, running in this repo:

- Push-to-talk audio capture in the browser while the draft plays, stamped with the playback position where the client started talking (MR-1, MR-2).
- Speech-to-text of each note with Whisper (OR-1).
- Structuring each note into section, category, one-line production note, and priority with a language model (MR-3).
- One clarifying question, spoken aloud, when a note is too vague to act on; the client's next push-to-talk answers it and the note is updated (OR-3, OR-2).
- End of session: a prioritized JSON revision sheet, downloadable, plus a spoken read-back of the must-fix list (MR-3, OR-2).
- Per-session cost estimate on the sheet (OR-10).
- Offline demonstration mode with a recorded four-note session and browser speech synthesis, no API key needed (OR-13).
- Credentials read from the environment, `.env.example` lists every variable (OR-12).

Stubbed, mocked, or not built:

- **Demo mode notes are fixtures.** With `REVISION_ROOM_DEMO_MODE=1` or no `OPENAI_API_KEY`, the microphone still records but the transcript and structured note come from `fixtures/session.json`, not from the audio. Live mode calls the real APIs.
- **Nothing is saved.** Notes live in the browser tab. Writing the sheet to Supabase next to the existing song record is described in section 7, not built.
- **Section detection is a guess** from the words and the timestamp. There is no song-structure map.
- **No hummed-reference clips.** The client can talk; a hummed alternative is not yet attached to the note.
- **No writer-side view.** The writer gets the JSON, not a UI.

## 4. How it works

1. The client opens the Revision Room for one draft and presses play.
2. They hold the space bar (or the button) and say what they hear. Playback pauses and the moment they started talking is stamped on the note.
3. The recording is transcribed to text.
4. The transcript, the timestamp, and the song context go to a language model that returns a structured revision note: which section, what category (lyric, vocal, instrumentation, mix, structure), a one-sentence production note in the writer's language, and a priority (must-fix, nice-to-have, unclear).
5. If the note cannot be acted on without one more fact, the agent asks one clarifying question out loud. The client's next push-to-talk is treated as the answer, and the note is updated in place.
6. When the client finishes, every note is sorted by priority and time into a revision sheet, the agent reads the must-fix list back for confirmation, and the sheet is available as JSON for the writer's next generation pass.

The whole workflow is in `src/lib/revision-room.ts`. The two API routes and the page are thin wrappers around it.

## 5. Setup

- Node 22 or newer, npm 10.
- `npm install`
- Copy `.env.example` to `.env.local`. Live mode needs `OPENAI_API_KEY` (whisper-1, gpt-4o-mini, tts-1, all paid, a full session costs about a cent). Leave it empty for offline demo mode.
- Put the draft at `public/audio/clarity-principle.mp3`. The audio is not committed; see section 9.

## 6. The primary path

```
npm run demo        # offline, fixtures, no key
npm run start:live  # live, needs OPENAI_API_KEY in .env.local
```

Open http://localhost:3000, press play, hold space, talk, release. Say something vague to get a clarifying question. Click **Finish session** to get the revision sheet and hear it read back. A pre-baked sheet from the fixture session is in `fixtures/revision-sheet.json`.

## 7. What you did not build, and why

Cut on purpose, in the first ten minutes:

- **Intake (F1) and memory (F6).** Other teams will build the brief interviewer. Revisions touch every project and nobody owns them.
- **Persisting to Supabase.** The site already keeps a song record in Supabase; the sheet is shaped to sit next to it as a `revision_sessions` row keyed by song id. That is a one-table migration and one insert, roughly an hour, and it is the first thing to do with more time.
- **Hummed references.** The client should be able to hum the drum feel they want and have the clip attached to the note. The capture path is already there; the attachment and playback are not.
- **Regenerating the prompt.** With a Suno-style lyric and style prompt on the song record, the must-fix notes could produce a lyric diff and a new prompt. That is the second hour.
- **Realtime speech-to-speech.** An assembled pipeline was chosen so each step could be stubbed and the timestamp stamping stayed under our control.
- **Measurement.** Logging rounds-per-song before and after is the metric that proves the outcome. Not built.

## 8. AI-use disclosure

- Claude (Claude Code, Fable 5.1) wrote most of the code, the fixtures, and this README from a plan agreed in conversation, and ran two research passes on the public site to ground the business case.
- OpenAI whisper-1, gpt-4o-mini, and tts-1 run inside the product for transcription, structuring, and the spoken read-back. OpenAI's terms permit commercial use of API outputs.

## 9. Attribution

- Next.js, React, Tailwind CSS, and the `openai` SDK, all MIT or Apache licensed.
- The demo draft is "The Clarity Principle," an original Business Bangerz portfolio song from its public Jukebox, used here with Business Bangerz as the audience of this prototype. It is not committed to the repository and is not client material.
- No voices were cloned. The read-back uses a stock synthetic voice. The push-to-talk audio is the presenter's own.
