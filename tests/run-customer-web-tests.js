import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const customerDir = path.join(root, 'customer_web');
const customerAppSource = readFileSync(path.join(customerDir, 'src', 'App.jsx'), 'utf8');
const imageEditorSource = readFileSync(path.join(customerDir, 'src', 'ImageEditor.jsx'), 'utf8');
const customerStyles = readFileSync(path.join(customerDir, 'src', 'styles.css'), 'utf8');
const customerIndex = readFileSync(path.join(customerDir, 'index.html'), 'utf8');
const adminStyles = readFileSync(path.join(root, 'admin_web', 'src', 'styles.css'), 'utf8');

assert.match(customerAppSource, /window\.scrollTo\(\{ top: 0/);
assert.match(imageEditorSource, /setLoaded\(false\)/);
assert.match(customerAppSource, /label="正面"[\s\S]+label="反面"/);
assert.doesNotMatch(customerAppSource, /two-image-grid/);
assert.match(customerAppSource, /notebookOneIcon/);
assert.match(customerAppSource, /notebookTwoIcon/);
assert.match(customerAppSource, /template-visual-image/);
assert.match(customerAppSource, /如果无法改图请联系小店客服/);
assert.doesNotMatch(imageEditorSource, /纵向对齐/);
assert.doesNotMatch(imageEditorSource, /横向对齐/);
assert.doesNotMatch(imageEditorSource, /白色外部填充/);
assert.doesNotMatch(imageEditorSource, /strokeStyle = 'rgba\(107, 114, 128, \.62\)'/);
assert.doesNotMatch(imageEditorSource, /function getDefaultFitMode\(/);
assert.match(imageEditorSource, /maxZoom/);
assert.match(imageEditorSource, /max=\{maxZoom\}/);
assert.match(customerAppSource, /辽ICP备2026024165号-1/);
assert.match(customerAppSource, /https:\/\/beian\.miit\.gov\.cn\//);
assert.match(customerStyles, /\.image-grid \{ grid-template-columns: repeat\(2, minmax\(0, 1fr\)\);/);
assert.doesNotMatch(customerStyles, /two-image-grid|spine-offset|书脊/);
assert.match(customerStyles, /\.picker-title \{[^}]*text-align: center/);
assert.match(customerStyles, /input \{[^}]*font-size: 16px/);
assert.match(customerStyles, /overflow-x: hidden/);
assert.match(customerIndex, /name="viewport" content="width=device-width, initial-scale=1\.0, viewport-fit=cover"/);
assert.match(customerStyles, /\.image-editor \{[^}]*background: #090909/);
assert.match(customerStyles, /:root \{[^}]*--image-edge: #9aa0a6/);
assert.match(customerStyles, /\.editor-backdrop \{[^}]*overflow: hidden/);
assert.match(customerStyles, /\.image-editor \{[^}]*overflow: hidden/);
assert.match(customerStyles, /\.editor-backdrop \{[^}]*height: 100dvh/);
assert.doesNotMatch(customerStyles, /\.editor-fit-controls/);
assert.doesNotMatch(customerStyles, /\.editor-zoom-limit/);
assert.doesNotMatch(imageEditorSource, /最低原图区域 240×320px/);
assert.match(imageEditorSource, /clear-button editor-replace-action/);
assert.doesNotMatch(imageEditorSource, /className="editor-replace-button"/);
assert.match(adminStyles, /body \{ margin: 0; min-width: 0;/);

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
