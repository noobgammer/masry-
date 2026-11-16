// Load keys from a .env file in the project root (if present) before anything else reads process.env.
import fs from 'node:fs';
import path from 'node:path';

const file = path.resolve(import.meta.dirname, '..', '.env');
if (fs.existsSync(file)) {
  try { process.loadEnvFile(file); } catch (e) { console.warn(`Could not read .env: ${(e as Error).message}`); }
}
