import { existsSync, readFileSync, writeFileSync, unlinkSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

export const root = fileURLToPath(new URL('../', import.meta.url));
const key = createHash('sha256').update(root.toLowerCase()).digest('hex').slice(0, 16);
const lock = join(tmpdir(), `safetext-${key}.lock`);
const message = 'SafeText is already running. Stop its dev terminal with Ctrl+C before running setup or starting another dev server.';

export function acquireLock() {
  if (existsSync(lock)) {
    const pid = Number(readFileSync(lock, 'utf8'));
    let alive = false;
    if (Number.isInteger(pid) && pid > 0) {
      try { process.kill(pid, 0); alive = true; }
      catch (error) { if (error.code !== 'ESRCH') alive = true; }
    }
    if (alive) throw new Error(message);
    unlinkSync(lock);
  }
  try { writeFileSync(lock, String(process.pid), { flag: 'wx' }); }
  catch (error) { if (error.code === 'EEXIST') throw new Error(message); throw error; }
  process.on('exit', () => {
    if (existsSync(lock) && readFileSync(lock, 'utf8') === String(process.pid)) unlinkSync(lock);
  });
}

export function checkWindowsProcesses() {
  if (process.platform !== 'win32') return;
  // Also detect standalone Vite/tsx processes started outside the root dev command.
  const output = execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command',
    "@(Get-CimInstance Win32_Process | Where-Object { $_.Name -in @('node.exe', 'esbuild.exe') } | Select-Object ProcessId, ExecutablePath, CommandLine) | ConvertTo-Json -Compress"], { encoding: 'utf8', windowsHide: true });
  const parsed = JSON.parse(output || '[]');
  const processes = Array.isArray(parsed) ? parsed : [parsed];
  const prefix = root.toLowerCase().replaceAll('/', '\\');
  if (processes.some(p => p.ProcessId !== process.pid &&
    [p.ExecutablePath, p.CommandLine].some(value => value?.toLowerCase().replaceAll('/', '\\').includes(prefix)))) {
    throw new Error(message);
  }
}
