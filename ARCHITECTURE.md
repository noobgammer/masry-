# Masry (مصري) — Architecture & Roadmap

An Egyptian Arabic acquisition platform built around **listening comprehension**, comprehensible
input and frequency vocabulary — not gamified translation drills.

## 1. Learner model (what the app is designed around)

Urdu L1, fluent English, reads Arabic script, Saudi exposure, ~1 year of Egyptian. Strong at
memorised phrases; weak at fast speech, real-time parsing, unexpected responses, and reading
without translating. Every design decision below maps to one of those weaknesses:

| Weakness | Feature that targets it |
|---|---|
| Fast speech | Speed ladder (0.7× → 1.6×) in Fast Speech Trainer, per-item speed control, "comfortable speed" metric |
| Breaking sentences down in real time | Sentence Segmentation drill, morphological breakdown (مـ + كنت + ش), word-by-word view |
| Predicting instead of understanding | Unexpected Responses drill (AI or scripted, random branch selection) |
| Switching to English | Conversation partner never switches unless asked; corrections deferred |
| Translating text to English | Reading section hides English by default; Arabic-language comprehension questions; reliance meter |
| Words don't connect | Contextual ladders: same word in 4–6 sentences of growing complexity; connector-focused content |
| Read-vs-listen gap | **Separate SRS cards** per word for *reading* and *listening*; separate metrics |

## 2. Technology stack

| Layer | Choice | Why |
|---|---|---|
| Frontend | React 18 + TypeScript + Vite, Tailwind CSS v4, React Router | Fast, maintainable, mobile-friendly; no SSR needed |
| Fonts | IBM Plex Sans Arabic / Noto Naskh Arabic + Inter | Good RTL rendering, readable diacritics |
| Backend | Node 22 + Express 5 (TypeScript via `tsx`) | One process serves API + built SPA |
| Database | SQLite via Node's built-in `node:sqlite` | Persistent, zero native deps, trivially backed up (`data/masry.db`); schema is portable to Postgres later |
| SRS | SM-2 variant with learning steps; separate `read` / `listen` cards | Proven, explainable, tunable |
| TTS | **Azure Speech** `ar-EG-SalmaNeural` (F) and `ar-EG-ShakirNeural` (M) | The only major provider with dedicated Egyptian-dialect neural voices; SSML rate for real slow/fast renders |
| TTS fallback | Browser `speechSynthesis`, preferring any `ar-EG` voice (Edge exposes Salma/Shakir online) | App remains usable with no keys; UI warns when the voice is not Egyptian |
| Native audio | Built-in **Native Speaker Studio**: an Egyptian friend records sentences in the browser; recordings always override TTS | Real connected/reduced speech that TTS cannot produce |
| Speech recognition | Web Speech API with `lang = ar-EG` (Chrome/Edge/Safari) + always-available typed input | Free, dialect-aware in Chrome; Azure STT is a drop-in upgrade (roadmap) |
| AI partner & generation | Claude API (`claude-opus-5-5`, structured JSON output, refusal fallback) | Strong Egyptian dialect control, can return reply + silent evaluation in one call |
| Tests | Vitest (unit + API integration) and a Playwright smoke run | Run after every phase |

### External services & keys (all optional — the app runs without them)

| Env var | Service | Used for | Cost (approx.) |
|---|---|---|---|
| `AZURE_SPEECH_KEY`, `AZURE_SPEECH_REGION` | Azure AI Speech | Egyptian neural TTS (cached to disk, each clip is generated once) | Free tier 0.5M chars/month; then ~$15 / 1M chars |
| `ANTHROPIC_API_KEY` | Anthropic Claude API | Conversation partner, unexpected follow-ups, feedback, draft content for levels 5–6 | Pay per token; a 10-minute conversation is a few cents |

## 3. Data model (SQLite)

```
users, sessions                      – local accounts (scrypt password hash, cookie session)
vocab                                – rank, level 1–6, arabic, translit, english, pos, category,
                                       example (ar/tr/en), notes/variations, variants[], verified flag
lexicon                              – normalized surface form → vocab id (built at seed time)
sentences, sentence_vocab            – contextual ladder sentences (complexity 1–7), token glosses,
                                       phrase chunks (for segmentation), target word links
content_items                        – dialogues/stories (input), chats (reading), imported videos:
                                       lines JSON (speaker, voice, ar, en, franco), questions JSON
srs_cards                            – (user, vocab, skill ∈ {read, listen}) with SM-2 state, lapses,
                                       avg response time
attempts                             – every graded answer: exercise kind, metric skill, score 0–1,
                                       response ms, playback speed → all analytics derive from here
word_events                          – per-word evidence: modality (read/listen) × context
                                       (isolated/sentence/reading) × correct
content_progress, bookmarks, saved_words, exposure (seconds of Arabic audio heard per day),
conversations (messages + deferred feedback), native_audio, content_flags, audio_cache
```

Content lives in human-editable files under `content/` (TSV / small text formats) and is loaded into
the DB by `npm run seed`. Nothing is hard-coded in the frontend. Every content row has a `verified`
flag: hand-authored seed content is `1`; anything drafted by AI is `0` and labelled "unverified" in
the UI until a native speaker approves it in the Studio.

## 4. Learning system

* **Stage 1 – Frequency vocabulary**: 6 frequency levels; daily new-word target; placement
  "fast-track" for words already known (schedules reading card further out, keeps listening card new);
  review queue mixes read and listen cards; buckets: *forgotten often* (≥3 lapses), *instant*
  (fast + mature), *read-but-not-heard* (read card strong, listen card weak), *isolated-only*
  (card strong, sentence evidence weak).
* **Stage 2 – Context**: per word, a ladder of sentences of rising complexity (7 tiers). The 8-step
  listening flow (listen → again → pick heard words → choose meaning → reveal Arabic → reveal English →
  breakdown → follow-along). Tier unlocks adapt to accuracy.
* **Stage 3 – Comprehensible input**: 5 bands (beginner → advanced). Listen-first player; questions
  before transcript; per-line replay, paragraph replay, speed, AR/EN/hidden subtitles, click-to-gloss,
  save word, bookmark sentence. Each item shows *estimated known-word coverage* for the learner;
  recommendations target ~90–98% coverage (i+1). Advanced band supports importing YouTube videos with
  a transcript.
* **Listening Lab**: dictation (word-level diff: missing / wrong / misspelled / confused), sentence
  segmentation, unexpected responses, word recognition, fast-speech ladder.
* **Conversations**: AI partner in Egyptian Arabic; Learning / Natural / Challenge modes (prompt style +
  TTS rate); voice in/out; per-turn evaluation stored silently, shown at the end or on request.
* **Reading**: WhatsApp-style chats, Arabic + Franco; English hidden; click words; struggle tracking.
* **Progress**: 8 independent skill scores, exposure hours, comfortable speed, response time,
  streak, weakness detector with plain-language insights → recommended next exercises.
* **Daily plan**: 60-minute plan (10/15/20/10/5) with live completion; passive listening playlist.

## 5. Roadmap

| Phase | Scope | Status |
|---|---|---|
| 1 | Architecture, DB, auth, dashboard, frequency vocab DB, SRS learn/review, placement | built |
| 2 | Contextual sentences, audio engine (Azure + cache + browser fallback + native), playback, listening flow | built |
| 3 | Input library, interactive transcript, questions, adaptive difficulty, coverage, YouTube import | built |
| 4 | Listening Lab: dictation, segmentation, fast speech, word recognition, unexpected responses | built |
| 5 | AI conversation partner, speech recognition, deferred feedback | built |
| 6 | Reading/Franco, analytics, weakness detection, passive listening, Native Speaker Studio | built |
| Next | Expand hand-verified vocab beyond the seed, native recordings of all content, Azure STT pronunciation scoring, Postgres + multi-device sync, PWA offline audio | planned |
