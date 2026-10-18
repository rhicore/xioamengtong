import { useEffect, useRef, useState } from 'react';

const VIEWPORT_WIDTH = 360;
const VIEWPORT_HEIGHT = 480;
const MIN_OUTPUT_WIDTH = 1800;
const MIN_OUTPUT_HEIGHT = 2400;
const MIN_SOURCE_CROP_WIDTH = 240;
const MIN_SOURCE_CROP_HEIGHT = 320;

function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max);
}

function getFitScale(image) {
  return Math.min(
    VIEWPORT_WIDTH / image.naturalWidth,
    VIEWPORT_HEIGHT / image.naturalHeight
  );
}

function getMaxZoom(image) {
  const fitScale = getFitScale(image);
  const maxZoomX = VIEWPORT_WIDTH / (fitScale * MIN_SOURCE_CROP_WIDTH);
  const maxZoomY = VIEWPORT_HEIGHT / (fitScale * MIN_SOURCE_CROP_HEIGHT);
  return Math.max(1, Math.min(maxZoomX, maxZoomY));
}

function getDisplayTransform(image, zoom, offset) {
  const fitScale = getFitScale(image);
  const displayScale = fitScale * zoom;
  const displayWidth = image.naturalWidth * displayScale;
  const displayHeight = image.naturalHeight * displayScale;
  return {
    displayScale,
    displayWidth,
    displayHeight,
    x: (VIEWPORT_WIDTH - displayWidth) / 2 + offset.x,
    y: (VIEWPORT_HEIGHT - displayHeight) / 2 + offset.y
  };
}

function getSourceCropSize(image, zoom) {
  const displayScale = getFitScale(image) * zoom;
  return {
    width: VIEWPORT_WIDTH / displayScale,
    height: VIEWPORT_HEIGHT / displayScale
  };
}

function getOutputSize(image, zoom) {
  const sourceCrop = getSourceCropSize(image, zoom);
  return {
    width: Math.max(MIN_OUTPUT_WIDTH, Math.round(sourceCrop.width)),
    height: Math.max(MIN_OUTPUT_HEIGHT, Math.round(sourceCrop.height))
  };
}

function clampOffset(image, zoom, offset) {
  const transform = getDisplayTransform(image, zoom, offset);
  const maxX = Math.max(0, (transform.displayWidth - VIEWPORT_WIDTH) / 2);
  const maxY = Math.max(0, (transform.displayHeight - VIEWPORT_HEIGHT) / 2);
  return {
    x: clamp(offset.x, -maxX, maxX),
    y: clamp(offset.y, -maxY, maxY)
  };
}

function drawPreview(canvas, image, zoom, offset) {
  const context = canvas.getContext('2d');
  if (!context) return;
  const transform = getDisplayTransform(image, zoom, offset);
  canvas.width = VIEWPORT_WIDTH;
  canvas.height = VIEWPORT_HEIGHT;
  context.clearRect(0, 0, VIEWPORT_WIDTH, VIEWPORT_HEIGHT);
  context.fillStyle = '#ffffff';
  context.fillRect(0, 0, VIEWPORT_WIDTH, VIEWPORT_HEIGHT);
  context.save();
  context.beginPath();
  context.rect(0, 0, VIEWPORT_WIDTH, VIEWPORT_HEIGHT);
  context.clip();
  context.drawImage(
    image,
    transform.x,
    transform.y,
    transform.displayWidth,
    transform.displayHeight
  );
  context.restore();
}

function createCroppedFile(image, zoom, offset, name) {
  const transform = getDisplayTransform(image, zoom, offset);
  const outputSize = getOutputSize(image, zoom);
  const output = document.createElement('canvas');
  output.width = outputSize.width;
  output.height = outputSize.height;
  const context = output.getContext('2d');
  if (!context) throw new Error('当前浏览器不支持图片编辑');
  context.fillStyle = '#ffffff';
  context.fillRect(0, 0, outputSize.width, outputSize.height);
  const outputScaleX = outputSize.width / VIEWPORT_WIDTH;
  const outputScaleY = outputSize.height / VIEWPORT_HEIGHT;
  context.drawImage(
    image,
    transform.x * outputScaleX,
    transform.y * outputScaleY,
    transform.displayWidth * outputScaleX,
    transform.displayHeight * outputScaleY
  );

  return new Promise((resolve, reject) => {
    output.toBlob((blob) => {
      if (!blob) {
        reject(new Error('图片裁切失败，请更换图片后重试'));
        return;
      }
      const safeName = (name || 'notebook-image').replace(/\.[^.]+$/, '');
      const file = new File([blob], `${safeName}-cropped.jpg`, {
        type: 'image/jpeg',
        lastModified: Date.now()
      });
      resolve({ file, previewUrl: URL.createObjectURL(blob) });
    }, 'image/jpeg', 0.92);
  });
}

export default function ImageEditor({ sourceUrl, sourceName, title, onCancel, onApply, onClear }) {
  const canvasRef = useRef(null);
  const imageRef = useRef(null);
  const dragRef = useRef(null);
  const pointerMapRef = useRef(new Map());
  const pinchRef = useRef(null);
  const zoomRef = useRef(1);
  const offsetRef = useRef({ x: 0, y: 0 });
  const ownedSourceUrls = useRef(new Set());
  const [activeSourceUrl, setActiveSourceUrl] = useState(sourceUrl);
  const [activeSourceName, setActiveSourceName] = useState(sourceName);
  const [zoom, setZoom] = useState(1);
  const [offset, setOffset] = useState({ x: 0, y: 0 });
  const [maxZoom, setMaxZoom] = useState(1);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState('');
  const [applying, setApplying] = useState(false);

  useEffect(() => () => {
    ownedSourceUrls.current.forEach((url) => URL.revokeObjectURL(url));
    ownedSourceUrls.current.clear();
  }, []);

  useEffect(() => {
    const image = new Image();
    image.crossOrigin = 'anonymous';
    setLoaded(false);
    image.onload = () => {
      imageRef.current = image;
      setMaxZoom(getMaxZoom(image));
      setLoaded(true);
      setError('');
    };
    image.onerror = () => {
      setLoaded(false);
      setError('图片读取失败，请重新选择图片');
    };
    image.src = activeSourceUrl;
    return () => {
      image.onload = null;
      image.onerror = null;
      imageRef.current = null;
    };
  }, [activeSourceUrl]);

  useEffect(() => {
    if (loaded && imageRef.current && canvasRef.current) {
      drawPreview(canvasRef.current, imageRef.current, zoom, offset);
    }
  }, [activeSourceUrl, loaded, zoom, offset]);

  useEffect(() => {
    function handleKeyDown(event) {
      if (event.key === 'Escape' && !applying) onCancel();
    }
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [applying, onCancel]);

  function updateZoom(value) {
    const nextZoom = clamp(Number(value), 1, maxZoom);
    const image = imageRef.current;
    zoomRef.current = nextZoom;
    setZoom(nextZoom);
    if (image) {
      const nextOffset = clampOffset(image, nextZoom, offsetRef.current);
      offsetRef.current = nextOffset;
      setOffset(nextOffset);
    }
  }

  function distanceBetween(first, second) {
    return Math.hypot(second.x - first.x, second.y - first.y);
  }

  function midpointBetween(first, second) {
    return { x: (first.x + second.x) / 2, y: (first.y + second.y) / 2 };
  }

  function handlePointerDown(event) {
    if (!loaded || applying) return;
    event.currentTarget.setPointerCapture?.(event.pointerId);
    pointerMapRef.current.set(event.pointerId, { x: event.clientX, y: event.clientY });
    const pointers = [...pointerMapRef.current.values()];
    if (pointers.length >= 2) {
      const [first, second] = pointers;
      pinchRef.current = {
        startDistance: Math.max(distanceBetween(first, second), 1),
        startMidpoint: midpointBetween(first, second),
        startZoom: zoomRef.current,
        startOffset: offsetRef.current
      };
      dragRef.current = null;
      return;
    }
    dragRef.current = {
      pointerId: event.pointerId,
      x: event.clientX,
      y: event.clientY,
      offset: offsetRef.current
    };
  }

  function handlePointerMove(event) {
    const pointer = pointerMapRef.current.get(event.pointerId);
    if (!pointer || !imageRef.current) return;
    pointerMapRef.current.set(event.pointerId, { x: event.clientX, y: event.clientY });
    const pointers = [...pointerMapRef.current.values()];
    if (pointers.length >= 2) {
      const [first, second] = pointers;
      const pinch = pinchRef.current;
      if (!pinch) return;
      const canvasWidth = canvasRef.current?.getBoundingClientRect().width || VIEWPORT_WIDTH;
      const canvasScale = VIEWPORT_WIDTH / canvasWidth;
      const nextZoom = clamp(
        pinch.startZoom * distanceBetween(first, second) / pinch.startDistance,
        1,
        maxZoom
      );
      const midpoint = midpointBetween(first, second);
      const nextOffset = clampOffset(imageRef.current, nextZoom, {
        x: pinch.startOffset.x + (midpoint.x - pinch.startMidpoint.x) * canvasScale,
        y: pinch.startOffset.y + (midpoint.y - pinch.startMidpoint.y) * canvasScale
      });
      zoomRef.current = nextZoom;
      offsetRef.current = nextOffset;
      setZoom(nextZoom);
      setOffset(nextOffset);
      return;
    }
    if (!dragRef.current || dragRef.current.pointerId !== event.pointerId) return;
    const next = {
      x: dragRef.current.offset.x + event.clientX - dragRef.current.x,
      y: dragRef.current.offset.y + event.clientY - dragRef.current.y
    };
    const nextOffset = clampOffset(imageRef.current, zoomRef.current, next);
    offsetRef.current = nextOffset;
    setOffset(nextOffset);
  }

  function handlePointerEnd(event) {
    pointerMapRef.current.delete(event.pointerId);
    event.currentTarget.releasePointerCapture?.(event.pointerId);
    if (pointerMapRef.current.size < 2) pinchRef.current = null;
    if (pointerMapRef.current.size === 1) {
      const [pointerId, pointer] = pointerMapRef.current.entries().next().value;
      dragRef.current = {
        pointerId,
        x: pointer.x,
        y: pointer.y,
        offset: offsetRef.current
      };
    } else {
      dragRef.current = null;
    }
  }

  function resetPosition() {
    zoomRef.current = 1;
    offsetRef.current = { x: 0, y: 0 };
    setZoom(1);
    setOffset({ x: 0, y: 0 });
  }

  function resetPointers() {
    pointerMapRef.current.clear();
    pinchRef.current = null;
    dragRef.current = null;
  }

  async function apply() {
    if (!imageRef.current || applying) return;
    setApplying(true);
    setError('');
    try {
      const result = await createCroppedFile(imageRef.current, zoom, offset, activeSourceName);
      onApply(result);
    } catch (applyError) {
      setError(applyError.message || '图片裁切失败，请重试');
      setApplying(false);
    }
  }

  function replaceImage(event) {
    const file = event.target.files && event.target.files[0];
    event.target.value = '';
    if (!file) return;
    if (!file.type.startsWith('image/')) {
      setError('请选择图片文件');
      return;
    }
    if (file.size > 20 * 1024 * 1024) {
      setError('图片不能超过 20MB');
      return;
    }
    ownedSourceUrls.current.forEach((url) => URL.revokeObjectURL(url));
    ownedSourceUrls.current.clear();
    const nextUrl = URL.createObjectURL(file);
    ownedSourceUrls.current.add(nextUrl);
    setActiveSourceUrl(nextUrl);
    setActiveSourceName(file.name);
    resetPosition();
    resetPointers();
    setError('');
  }

  return (
    <div className="editor-backdrop" role="presentation" onMouseDown={(event) => {
      if (event.target === event.currentTarget && !applying) onCancel();
    }}>
      <section className="image-editor" role="dialog" aria-modal="true" aria-label="编辑图片">
        <div className="editor-header">
          <div>
            <p className="eyebrow">IMAGE EDITOR</p>
            <h2>{title}裁切</h2>
          </div>
          <button className="editor-close" onClick={onCancel} disabled={applying} aria-label="关闭">×</button>
        </div>
        <p className="editor-tip">拖动图片调整位置，使用下方滑块缩放，框内区域就是最终上传内容。</p>
        <p className="editor-warning">裁切会有 3–5mm 误差，重要文字图案请远离照片四周边缘。</p>
        <div className="editor-canvas-wrap">
          {loaded ? (
            <canvas
              ref={canvasRef}
              className="editor-canvas"
              onPointerDown={handlePointerDown}
              onPointerMove={handlePointerMove}
              onPointerUp={handlePointerEnd}
              onPointerCancel={handlePointerEnd}
            />
          ) : (
            <div className="editor-loading">正在读取图片...</div>
          )}
        </div>
        <div className="editor-controls">
          <span>缩小</span>
          <input
            aria-label="图片缩放"
            type="range"
            min="1"
            max={maxZoom}
            step="0.01"
            value={zoom}
            onChange={(event) => updateZoom(event.target.value)}
            disabled={!loaded || applying}
          />
          <span>放大</span>
          <button className="reset-button" onClick={resetPosition} disabled={!loaded || applying}>重置</button>
        </div>
        {error && <p className="error-box editor-error">{error}</p>}
        <div className="editor-actions">
          {onClear && <button className="editor-clear-button" onClick={onClear} disabled={applying}>清除图片</button>}
          <label className="clear-button editor-replace-action">
            更换图片
            <input type="file" accept="image/jpeg,image/png,image/webp" onChange={replaceImage} disabled={applying} />
          </label>
          <button className="primary-button" onClick={apply} disabled={!loaded || applying}>
            {applying ? '处理中...' : '使用裁切结果'}
          </button>
        </div>
      </section>
    </div>
  );
}
