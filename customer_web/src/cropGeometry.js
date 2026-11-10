export const OUTPUT_WIDTH = 1704;
export const OUTPUT_HEIGHT = 2400;
export const CROP_ASPECT = OUTPUT_WIDTH / OUTPUT_HEIGHT;
export const MIN_ZOOM = 1;

export const initialTransform = () => ({ x: 0, y: 0, zoom: 1, rotation: 0 });
export const clamp = (value, min, max) => Math.max(min, Math.min(max, value));

export function getFitScale(width, height) {
  return Math.max(OUTPUT_WIDTH / width, OUTPUT_HEIGHT / height);
}

export function getCropFrame(width, height) {
  const frameWidth = Math.min(Math.max(1, width - 32), Math.max(1, height - 24) * CROP_ASPECT);
  const frameHeight = frameWidth / CROP_ASPECT;
  return { width: frameWidth, height: frameHeight, x: (width - frameWidth) / 2, y: (height - frameHeight) / 2, scale: frameWidth / OUTPUT_WIDTH };
}

export function rotatePoint(point, degrees) {
  const radians = degrees * Math.PI / 180;
  return { x: point.x * Math.cos(radians) - point.y * Math.sin(radians), y: point.x * Math.sin(radians) + point.y * Math.cos(radians) };
}

export function normalizeAngle(degrees) {
  return ((degrees + 180) % 360 + 360) % 360 - 180;
}

export function getMinimumZoom(width, height, rotation = 0) {
  const radians = rotation * Math.PI / 180;
  const cos = Math.abs(Math.cos(radians));
  const sin = Math.abs(Math.sin(radians));
  const fit = getFitScale(width, height);
  // Project the crop onto the image axes, so even rotated crop corners stay inside the source.
  return Math.max((OUTPUT_WIDTH * cos + OUTPUT_HEIGHT * sin) / (width * fit),
    (OUTPUT_WIDTH * sin + OUTPUT_HEIGHT * cos) / (height * fit));
}

export function constrainTransform(transform, width, height) {
  const zoom = Math.max(transform.zoom, getMinimumZoom(width, height, transform.rotation));
  const fit = getFitScale(width, height) * zoom;
  const radians = transform.rotation * Math.PI / 180;
  const cos = Math.abs(Math.cos(radians));
  const sin = Math.abs(Math.sin(radians));
  const maxX = Math.max(0, (width * fit - OUTPUT_WIDTH * cos - OUTPUT_HEIGHT * sin) / 2);
  const maxY = Math.max(0, (height * fit - OUTPUT_WIDTH * sin - OUTPUT_HEIGHT * cos) / 2);
  const local = rotatePoint(transform, -transform.rotation);
  const bounded = rotatePoint({ x: clamp(local.x, -maxX, maxX), y: clamp(local.y, -maxY, maxY) }, transform.rotation);
  return { ...transform, ...bounded, zoom };
}

export function transformGesture(base, start, current, maxZoom, imageSize) {
  if (start.length === 1 || current.length === 1) {
    return { ...base, x: base.x + current[0].x - start[0].x, y: base.y + current[0].y - start[0].y };
  }
  const midpoint = (points) => ({ x: (points[0].x + points[1].x) / 2, y: (points[0].y + points[1].y) / 2 });
  const vector = (points) => ({ x: points[1].x - points[0].x, y: points[1].y - points[0].y });
  const from = vector(start);
  const to = vector(current);
  const rotation = normalizeAngle((Math.atan2(to.y, to.x) - Math.atan2(from.y, from.x)) * 180 / Math.PI);
  const nextRotation = normalizeAngle(base.rotation + rotation);
  const minZoom = imageSize ? getMinimumZoom(imageSize.width, imageSize.height, nextRotation) : MIN_ZOOM;
  const zoom = clamp(base.zoom * Math.hypot(to.x, to.y) / Math.max(1, Math.hypot(from.x, from.y)), minZoom, maxZoom);
  const centerStart = midpoint(start);
  const centerNow = midpoint(current);
  const relative = rotatePoint({ x: base.x - centerStart.x, y: base.y - centerStart.y }, rotation);
  const ratio = zoom / base.zoom;
  return { x: centerNow.x + relative.x * ratio, y: centerNow.y + relative.y * ratio, zoom, rotation: nextRotation };
}

export function zoomAround(transform, zoom, point = { x: 0, y: 0 }) {
  const ratio = zoom / transform.zoom;
  return { ...transform, zoom, x: point.x + (transform.x - point.x) * ratio, y: point.y + (transform.y - point.y) * ratio };
}

// The same center/scale/rotation used by the preview is applied to the original image at print resolution.
export function drawCroppedImage(context, image, transform) {
  transform = constrainTransform(transform, image.naturalWidth, image.naturalHeight);
  context.save();
  // Flatten source transparency for JPEG; the crop itself is always covered by the source image.
  context.fillStyle = '#ffffff';
  context.fillRect(0, 0, OUTPUT_WIDTH, OUTPUT_HEIGHT);
  context.translate(OUTPUT_WIDTH / 2 + transform.x, OUTPUT_HEIGHT / 2 + transform.y);
  context.rotate(transform.rotation * Math.PI / 180);
  const scale = getFitScale(image.naturalWidth, image.naturalHeight) * transform.zoom;
  context.scale(scale, scale);
  context.imageSmoothingEnabled = true;
  context.imageSmoothingQuality = 'high';
  context.drawImage(image, -image.naturalWidth / 2, -image.naturalHeight / 2);
  context.restore();
}
