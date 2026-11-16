# Masry · مصري

An Egyptian Arabic acquisition app built around **listening**: frequency vocabulary with separate
reading/listening skills, words in context, comprehensible input, a listening lab, an AI conversation
partner, WhatsApp/Franco reading, and real progress diagnostics. See [ARCHITECTURE.md](ARCHITECTURE.md)
for the design and roadmap.

## Run it

```bash
npm install
```

```bash
npm run build && npm start        # http://localhost:3001  (API + app, one process)
```

For development (hot reload, http://localhost:5173):

```bash
npm run dev
```

The SQLite database is created and seeded automatically in `data/masry.db`. After editing anything in
`content/`, reload it (user progress is kept):

```bash
npm run seed
```

Tests (analyzer, SRS, dictation diff, and an API test that walks all six phases):

```bash
npm test
```

## Optional services (the app works without them)

| Variable | What it unlocks | Without it |
|---|---|---|
| `AZURE_SPEECH_KEY`, `AZURE_SPEECH_REGION` | Egyptian neural voices `ar-EG-SalmaNeural` / `ar-EG-ShakirNeural`, rendered at real slow/normal/fast rates and cached in `data/audio/` (each clip is generated once). Free tier: 0.5M characters/month. | Browser speech. Edge exposes Egyptian voices; Chrome/Safari usually only have MSA/Gulf voices, and the app shows a red "not Egyptian" badge when that happens. |
| `ANTHROPIC_API_KEY` | AI conversation partner (Learning/Natural/Challenge), AI-generated unexpected follow-up questions, end-of-chat feedback, translations/questions for imported YouTube transcripts, and `npm run draft-vocab`. | These features show a clear "needs key" notice; scripted drills still work. |

**Native recordings beat everything.** Open *Native Speaker Studio* and have an Egyptian friend record
sentences. A recording replaces the synthetic voice for that sentence everywhere in the app. They can also
flag lines that don't sound Egyptian.

## Content

All content is plain text in `content/` (nothing is hard-coded in the frontend):

- `vocab/*.txt`: frequency-ordered words (753 hand-written: levels 1–3 complete, level 4 partial) with
  transliteration, part of speech, inflected forms, example, and usage notes.
- `sentences.txt`: contextual ladders for 30 key words and connectors (tiers 2–7). `/` marks phrase
  chunks for the segmentation drill.
- `input/*.txt`: 19 dialogues and stories, beginner → advanced, with Arabic-language comprehension questions.
- `reading/chats.txt`: WhatsApp-style chats, Arabic and Franco.
- `scenarios.txt`: branching unexpected-response conversations.

Every token in this content is glossed automatically by an Egyptian morphological analyzer
(`server/arabic.ts`). It splits clitics such as مـ…ـش, بـ, هـ, الـ, و and pronoun suffixes. Run
`npm run seed` to print a coverage report; it currently glosses 98.4% of tokens.

To extend vocabulary to 2,000 words, run `npm run draft-vocab -- --count 1250`. AI-drafted entries are
loaded as **unverified** and carry a badge in the app. Have a native speaker review them before moving
them into a normal file.
