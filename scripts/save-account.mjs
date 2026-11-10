import { readFile } from 'node:fs/promises';
import { createCredentialStore } from '../storage.mjs';
if (!process.argv[2]) throw new Error('Provide the local auth.json path.');
try {
  const auth = JSON.parse((await readFile(process.argv[2], 'utf8')).replace(/^\uFEFF/, ''));
  const store = createCredentialStore();
  await store.save({ auth, proxy: process.argv[3] || '' });
  const restored = await store.load();
  if (JSON.stringify(restored.auth) !== JSON.stringify(auth)) throw new Error('Roundtrip failed');
  console.log('Account saved with Windows user encryption; decryption roundtrip passed.');
} catch { console.error('Account save failed.'); process.exitCode = 1; }
