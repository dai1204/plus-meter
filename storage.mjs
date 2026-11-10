import { spawn } from 'node:child_process';
import { readFile, mkdir, writeFile, rename, unlink } from 'node:fs/promises';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { parseAuth, validateProxy } from './core.mjs';

// AppData is virtualized for packaged Codex child processes. A user-profile
// directory is shared by packaged and ordinary desktop shortcut launches.
export const dataDirectory = join(homedir(), '.plus-meter');
export function createCredentialStore(directory = dataDirectory) {
  const path = join(directory, 'auth.dpapi');
  async function crypt(mode, value) {
    if (process.platform !== 'win32') throw new Error('加密保存仅支持 Windows。');
    return new Promise((resolve, reject) => {
      const child = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', fileURLToPath(new URL('./storage.ps1', import.meta.url)), '-Mode', mode], { windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
      const chunks = []; let size = 0;
      const timer = setTimeout(() => { child.kill(); reject(new Error('凭据加密操作超时。')); }, 15000);
      child.stdout.on('data', chunk => { size += chunk.length; if (size <= 2 * 1024 * 1024) chunks.push(chunk); else child.kill(); });
      child.stderr.on('data', () => {});
      child.stdin.on('error', () => {});
      child.on('error', () => { clearTimeout(timer); reject(new Error('无法启动 Windows 凭据加密。')); });
      child.on('close', code => { clearTimeout(timer); if (code === 0) resolve(Buffer.concat(chunks).toString('utf8')); else reject(new Error('凭据加解密失败，请使用保存它的 Windows 用户登录。')); });
      child.stdin.end(value);
    });
  }
  return {
    async save(account) {
      parseAuth(account.auth); validateProxy(account.proxy);
      const encrypted = await crypt('Protect', JSON.stringify(account));
      await mkdir(directory, { recursive: true });
      const temp = path + '.tmp';
      await writeFile(temp, encrypted, { encoding: 'utf8', mode: 0o600 });
      await rename(temp, path);
    },
    async load() {
      let encrypted;
      try { encrypted = await readFile(path, 'utf8'); } catch (error) { if (error.code === 'ENOENT') return null; throw error; }
      const account = JSON.parse(await crypt('Unprotect', encrypted));
      parseAuth(account.auth); validateProxy(account.proxy);
      return account;
    },
    async clear() { try { await unlink(path); } catch (error) { if (error.code !== 'ENOENT') throw error; } },
    path,
  };
}
