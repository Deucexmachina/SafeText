import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';

test('production refuses insecure origin/default database credentials without echoing secrets', () => {
  function check(origin: string, database: string) {
    return spawnSync(process.execPath, ['--import', 'tsx', '--input-type=module', '-e', "await import('./src/config.ts')"], {
      cwd: fileURLToPath(new URL('../', import.meta.url)), encoding: 'utf8', windowsHide: true,
      env: { ...process.env, NODE_ENV: 'production', APP_ORIGIN: origin, DATABASE_URL: database },
    });
  }
  assert.notEqual(check('http://localhost:5173', 'postgres://user:secret@localhost/app').status, 0);
  assert.notEqual(check('https://safetext.example', 'postgres://safetext:safetext@localhost/app').status, 0);
  const invalid = check('https://safetext.example', 'private-invalid-credential');
  assert.notEqual(invalid.status, 0); assert.doesNotMatch(invalid.stderr, /private-invalid-credential/);
  assert.equal(check('https://safetext.example', 'postgres://user:nondefault@localhost/app').status, 0);
});
