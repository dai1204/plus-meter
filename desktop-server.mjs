import { writeFile, mkdir } from 'node:fs/promises';
import { dirname } from 'node:path';
import { startServer } from './server.mjs';
import { createCredentialStore } from './storage.mjs';
const readyFile = process.argv[2];
try {
  const credentialStore = createCredentialStore();
  const initialAccount = await credentialStore.load();
  const { server, url, reused } = await startServer(18766, { credentialStore, initialAccount });
  await mkdir(dirname(readyFile), { recursive: true });
  await writeFile(readyFile, JSON.stringify({ url, pid: process.pid, ownsServer: !!server, reused }));
} catch { await writeFile(readyFile, JSON.stringify({ error: '桌面组件启动失败，请检查保存的凭据或重新安装快捷方式。' })); process.exitCode = 1; }
