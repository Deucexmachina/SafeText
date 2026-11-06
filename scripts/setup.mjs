import { existsSync, copyFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { acquireLock, checkWindowsProcesses } from './runtime.mjs';
process.chdir(fileURLToPath(new URL('../', import.meta.url)));
try { acquireLock(); checkWindowsProcesses(); }
catch (error) { console.error(error.message); process.exit(1); }
for (const folder of ['', 'server/']) {
  if (!existsSync(`${folder}.env`)) copyFileSync(`${folder}.env.example`, `${folder}.env`);
}
for (const folder of ['server', 'web']) {
  const windows = process.platform === 'win32';
  const result = spawnSync(windows ? (process.env.ComSpec ?? 'cmd.exe') : 'npm', windows ? ['/d', '/s', '/c', 'npm ci'] : ['ci'], {
    cwd: folder, stdio: 'inherit',
  });
  if (result.status !== 0) {
    console.error('Setup did not finish. Stop all SafeText dev terminals, then rerun npm run setup before npm run dev.');
    process.exit(result.status ?? 1);
  }
}
console.log('Dependencies installed. Start Docker Desktop, run npm run db:up, then npm run dev.');
