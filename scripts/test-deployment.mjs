import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { createServer } from 'node:net';
import { createRequire } from 'node:module';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';

// Use an isolated schema in an explicitly supplied test database, never production.
assert(process.env.TEST_DATABASE_URL, 'Set TEST_DATABASE_URL to a disposable test PostgreSQL database.');
const require = createRequire(new URL('../server/package.json', import.meta.url));
const { Pool } = require('pg');
const url = new URL(process.env.TEST_DATABASE_URL);
const admin = new Pool({ connectionString: url.href });
const schema = `deployment_${randomUUID().replaceAll('-', '')}`;
let child;
let exited;
try {
  await admin.query(`CREATE SCHEMA ${schema}`);
  url.searchParams.set('options', `-c search_path=${schema}`);
  const socket = createServer().listen(0, '127.0.0.1');
  await once(socket, 'listening');
  const { port } = socket.address();
  await new Promise(resolve => socket.close(resolve));
  child = spawn(process.execPath, ['server/dist/index.js'], {
    cwd: fileURLToPath(new URL('../', import.meta.url)),
    windowsHide: true, stdio: ['ignore', 'inherit', 'inherit'],
    env: { ...process.env, DATABASE_URL: url.href, PORT: String(port),
      NODE_ENV: 'production', APP_ORIGIN: 'https://safetext.example', SERVE_WEB: 'true',
      KIMI_API_KEY: '', LLM_WHISPERER_API_KEY: '', GOOGLE_SAFE_BROWSING_API_KEY: '',
      BREVO_API_KEY: '', SMTP_URL: '', EMAIL_DEV_LOG: '', CLIENT_IP_SOURCE: 'socket' },
  });
  exited = once(child, 'exit');
  const base = `http://127.0.0.1:${port}`;
  let ready = false;
  for (let attempt = 0; attempt < 100; attempt++) {
    if (child.exitCode !== null) throw new Error('Production server exited before becoming ready.');
    try {
      const response = await fetch(`${base}/api/v1/health`, { signal: AbortSignal.timeout(1000) });
      if (response.ok) { ready = true; break; }
    } catch { /* Startup can take a moment while migrations run. */ }
    await delay(200);
  }
  assert(ready, 'Production server must become ready.');
  for (const path of ['/', '/history', '/scan/example', '/forgot-password']) {
    const response = await fetch(`${base}${path}`);
    assert.equal(response.status, 200);
    assert.match(response.headers.get('content-type'), /text\/html/);
    assert.match(response.headers.get('content-security-policy'), /script-src 'self'/);
    const html = await response.text();
    assert.match(html, /<div id="root">/);
    const script = html.match(/src="([^"]+\.js)"/);
    assert(script, 'Built HTML must reference a JavaScript bundle.');
    const asset = await fetch(new URL(script[1], base));
    assert.equal(asset.status, 200);
    assert.match(asset.headers.get('content-type'), /javascript/);
  }
  const missingAsset = await fetch(`${base}/assets/missing.js`);
  assert.equal(missingAsset.status, 404);
  const unauthorized = await fetch(`${base}/api/v1/scans`);
  assert.equal(unauthorized.status, 401);
  assert.match(unauthorized.headers.get('content-type'), /application\/problem\+json/);
  const missingApi = await fetch(`${base}/api/missing`);
  assert.equal(missingApi.status, 404);
  assert.match(missingApi.headers.get('content-type'), /application\/problem\+json/);
  const crossSite = await fetch(`${base}/api/v1/auth/login`, { method: 'POST',
    headers: { Origin: 'https://untrusted.example', 'Content-Type': 'application/json' }, body: '{}' });
  assert.equal(crossSite.status, 403);
  const resetUnavailable = await fetch(`${base}/api/v1/auth/forgot-password`, { method: 'POST',
    headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: 'smoke@example.com' }) });
  assert.equal(resetUnavailable.status, 503);
  assert.match(resetUnavailable.headers.get('content-type'), /application\/problem\+json/);
  console.log('Production website, SPA routes, assets, API authentication and origin checks passed.');
} finally {
  if (child && child.exitCode === null) { child.kill(); await exited; }
  await admin.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);
  await admin.end();
}
