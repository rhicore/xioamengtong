import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const customerDir = path.join(root, 'customer_web');

execFileSync(process.execPath, [
  path.join(customerDir, 'node_modules', 'vite', 'bin', 'vite.js'),
  'build'
], {
  cwd: customerDir,
  stdio: 'inherit'
});

const builtIndex = readFileSync(path.join(customerDir, 'dist', 'index.html'), 'utf8');
assert.match(builtIndex, /assets\//);
assert.ok(existsSync(path.join(customerDir, 'dist')));
console.log('customer web production build passed');
