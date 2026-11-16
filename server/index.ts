import { createApp } from './app.ts';
import { db } from './db.ts';
import { seed } from './seed.ts';
import { azureEnabled } from './tts.ts';
import { aiEnabled } from './ai.ts';

// Seed on first run (or when content files change, run `npm run seed`).
const n = (db().prepare('SELECT COUNT(*) n FROM vocab').get() as { n: number }).n;
if (!n) seed(db());

const port = Number(process.env.PORT || 3001);
createApp().listen(port, () => {
  console.log(`Masry API on http://localhost:${port}`);
  console.log(`  Egyptian TTS (Azure): ${azureEnabled() ? 'enabled' : 'not configured — browser voice fallback'}`);
  console.log(`  AI partner (Claude):  ${aiEnabled() ? 'enabled' : 'not configured — conversation features disabled'}`);
});
