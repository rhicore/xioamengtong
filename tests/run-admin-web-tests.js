import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  unwrapAuthResponse,
  unwrapFunctionResponse
} from '../admin_web/src/backend/protocol.js';
import {
  formatRelativeTime,
  getOrderUpdatedTime,
  getOrderUploadTime
} from '../admin_web/src/utils/time.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const adminDir = path.join(root, 'admin_web');

assert.deepEqual(
  unwrapAuthResponse({ data: { user: { uid: 'staff-1' } } }),
  { user: { uid: 'staff-1' } }
);
assert.deepEqual(
  unwrapFunctionResponse({ result: { code: 200, data: { total: 1 } } }),
  { total: 1 }
);
assert.deepEqual(
  unwrapFunctionResponse({ result: JSON.stringify({ code: 200, data: { items: [] } }) }),
  { items: [] }
);
assert.throws(
  () => unwrapFunctionResponse({ result: { code: 403, message: '没有权限' } }),
  /没有权限/
);
const fixedNow = new Date('2026-09-22T15:00:00+08:00');
assert.strictEqual(formatRelativeTime('2026-09-22T14:59:30+08:00', fixedNow), '刚刚');
assert.strictEqual(formatRelativeTime('2026-09-22T14:20:00+08:00', fixedNow), '40分钟前');
assert.strictEqual(formatRelativeTime('2026-09-21T15:00:00+08:00', fixedNow), '昨天 15:00');
assert.strictEqual(
  formatRelativeTime(getOrderUploadTime({
    created_at: '2026-09-20T10:00:00+08:00',
    submitted_at: '2026-09-21T10:00:00+08:00'
  }), fixedNow),
  '昨天 10:00'
);
assert.strictEqual(
  formatRelativeTime(getOrderUpdatedTime({
    submitted_at: '2026-09-21T10:00:00+08:00',
    updated_at: '2026-09-22T14:00:00+08:00'
  }), fixedNow),
  '今天 14:00'
);

execFileSync(process.execPath, [
  path.join(adminDir, 'node_modules', 'vite', 'bin', 'vite.js'),
  'build'
], {
  cwd: adminDir,
  stdio: 'inherit'
});

const builtIndex = readFileSync(path.join(adminDir, 'dist', 'index.html'), 'utf8');
assert.match(builtIndex, /assets\//);
console.log('admin web protocol and production build passed');
