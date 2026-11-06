import { spawn, spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { acquireLock } from './runtime.mjs';
process.chdir(fileURLToPath(new URL('../', import.meta.url)));
try { acquireLock(); }
catch (error) { console.error(error.message); process.exit(1); }
for (const file of ['server/node_modules/tsx/dist/cli.mjs', 'web/node_modules/vite/bin/vite.js']) {
  if (!existsSync(file)) {
    console.error('Dependencies are missing or setup was interrupted. Run npm run setup before npm run dev.');
    process.exit(1);
  }
}
const children = [
  spawn(process.execPath, ['node_modules/tsx/dist/cli.mjs', 'watch', 'src/index.ts'], { cwd: 'server', stdio: 'inherit' }),
  spawn(process.execPath, ['node_modules/vite/bin/vite.js'], { cwd: 'web', stdio: 'inherit' }),
];
let stopping = false;
function stop() {
  if (stopping) return;
  stopping = true;
  for (const child of children) {
    if (!child.pid || child.exitCode !== null) continue;
    if (process.platform === 'win32') {
      // Terminate watcher descendants too, including esbuild's executable.
      spawnSync('taskkill', ['/PID', String(child.pid), '/T', '/F'], { stdio: 'ignore', windowsHide: true });
    } else child.kill();
  }
}
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
for (const child of children) child.on('exit', code => {
  if (stopping) return;
  process.exitCode = code ?? 0;
  stop();
});
for (const child of children) child.on('error', error => { console.error(error.message); stop(); process.exitCode = 1; });
