import assert from 'node:assert/strict';
import { OUTPUT_WIDTH, OUTPUT_HEIGHT, CROP_ASPECT, initialTransform, getCropFrame, getFitScale, getMinimumZoom, constrainTransform, rotatePoint, transformGesture, zoomAround, drawCroppedImage } from '../customer_web/src/cropGeometry.js';

const near = (actual, expected) => assert.ok(Math.abs(actual - expected) < 1e-7, `${actual} != ${expected}`);
assert.equal(OUTPUT_WIDTH, 1704);
assert.equal(OUTPUT_HEIGHT, 2400);
for (const [width, height] of [[390, 600], [320, 300], [1200, 750], [844, 180]]) {
  const frame = getCropFrame(width, height);
  near(frame.width / frame.height, CROP_ASPECT);
  assert.ok(frame.width <= width && frame.height <= height);
}

// Two fingers scale and rotate around the same image point, rather than slipping to the image center.
const base = { x: 60, y: 80, zoom: 2, rotation: 0 };
const start = [{ x: 100, y: 100 }, { x: 300, y: 100 }];
const current = [{ x: 250, y: 50 }, { x: 250, y: 450 }];
const next = transformGesture(base, start, current, 16);
near(next.zoom, 4);
near(next.rotation, 90);
const originalAnchor = { x: (200 - base.x) / base.zoom, y: (100 - base.y) / base.zoom };
const moved = rotatePoint({ x: originalAnchor.x * next.zoom, y: originalAnchor.y * next.zoom }, next.rotation);
near(moved.x + next.x, 250);
near(moved.y + next.y, 250);
const capped = transformGesture(base, start, current, 3);
near(capped.zoom, 3);
const clampedAnchor = rotatePoint({ x: originalAnchor.x * capped.zoom, y: originalAnchor.y * capped.zoom }, capped.rotation);
near(clampedAnchor.x + capped.x, 250);
near(clampedAnchor.y + capped.y, 250);

// Rebase after lifting a finger: stationary fingers must not jump the image.
const rebased = transformGesture(next, [{ x: 250, y: 450 }], [{ x: 250, y: 450 }], 16);
assert.deepEqual(rebased, next);
const dragged = transformGesture(next, [{ x: 250, y: 450 }], [{ x: 280, y: 490 }], 16);
near(dragged.x - next.x, 30);
near(dragged.y - next.y, 40);
const zoomed = zoomAround(base, 4, { x: 200, y: 100 });
near((200 - zoomed.x) / zoomed.zoom, originalAnchor.x);
near((100 - zoomed.y) / zoomed.zoom, originalAnchor.y);
near(getFitScale(1704, 2400), 1);
near(getFitScale(4000, 240), 10);
near(getFitScale(240, 4000), 7.1);

// Independently map all crop corners back into the original image. Testing only
// the rotated bounding box would miss empty triangular corners in the crop.
for (const [width, height] of [[1704, 2400], [4000, 240], [240, 4000], [900, 900], [70, 12000], [12000, 70]]) {
  for (let rotation = -180; rotation <= 180; rotation += 7) {
    for (const zoom of [.01, 1, 2, 4]) {
      for (const [x, y] of [[0, 0], [1e6, -1e6], [-1e6, 1e6], [500, 700]]) {
        const transform = constrainTransform({ x, y, zoom, rotation }, width, height);
        const scale = getFitScale(width, height) * transform.zoom;
        for (const cropX of [-OUTPUT_WIDTH / 2, OUTPUT_WIDTH / 2]) {
          for (const cropY of [-OUTPUT_HEIGHT / 2, OUTPUT_HEIGHT / 2]) {
            const source = rotatePoint({ x: cropX - transform.x, y: cropY - transform.y }, -rotation);
            assert.ok(Math.abs(source.x / scale) <= width / 2 + 1e-7, `crop escapes source width at ${width}×${height}, ${rotation}°`);
            assert.ok(Math.abs(source.y / scale) <= height / 2 + 1e-7, `crop escapes source height at ${width}×${height}, ${rotation}°`);
          }
        }
      }
    }
  }
}
const rotating = transformGesture(initialTransform(), [{ x: -100, y: 0 }, { x: 100, y: 0 }], [{ x: 0, y: -30 }, { x: 0, y: 30 }], 4, { width: 1704, height: 2400 });
near(rotating.zoom, getMinimumZoom(1704, 2400, 90));
near(rotating.rotation, 90);

const operations = [];
const context = Object.fromEntries(['save', 'fillRect', 'translate', 'rotate', 'scale', 'drawImage', 'restore'].map(name => [name, (...args) => operations.push([name, ...args])]));
drawCroppedImage(context, { naturalWidth: 1704, naturalHeight: 2400 }, initialTransform());
assert.deepEqual(operations.find(([name]) => name === 'fillRect'), ['fillRect', 0, 0, 1704, 2400]);
assert.deepEqual(operations.find(([name]) => name === 'translate'), ['translate', 852, 1200]);
assert.deepEqual(operations.find(([name]) => name === 'scale'), ['scale', 1, 1]);
assert.equal(context.fillStyle, '#ffffff');
console.log('crop geometry: fixed output, aspect, gesture anchor and all crop corners stay inside wide/tall/square sources through rotation, panning and zoom limits');
