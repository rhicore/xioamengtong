import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { OUTPUT_WIDTH, OUTPUT_HEIGHT, initialTransform, clamp, getFitScale, getMinimumZoom, getCropFrame, normalizeAngle, constrainTransform, transformGesture, zoomAround, drawCroppedImage } from './cropGeometry.js';

function createCroppedFile(image, transform, name) {
  const canvas = document.createElement('canvas');
  canvas.width = OUTPUT_WIDTH;
  canvas.height = OUTPUT_HEIGHT;
  const context = canvas.getContext('2d');
  if (!context) return Promise.reject(new Error('当前浏览器不支持图片编辑'));
  drawCroppedImage(context, image, transform);
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (!blob) { reject(new Error('图片裁切失败，请更换图片后重试')); return; }
      const file = new File([blob], `${(name || 'notebook-image').replace(/\.[^.]+$/, '')}-cropped.jpg`, { type: 'image/jpeg', lastModified: Date.now() });
      resolve({ file, previewUrl: URL.createObjectURL(blob) });
    }, 'image/jpeg', 0.92);
  });
}

export default function ImageEditor({ sourceUrl, sourceName, title, onCancel, onApply, onClear }) {
  const dialogRef = useRef(null);
  const stageRef = useRef(null);
  const imageRef = useRef(null);
  const pointersRef = useRef(new Map());
  const gestureRef = useRef(null);
  const transformRef = useRef(initialTransform());
  const paintRef = useRef(null);
  const applyingRef = useRef(false);
  const sourceUrlsRef = useRef(new Set());
  const frameRef = useRef(null);
  const [source, setSource] = useState({ url: sourceUrl, name: sourceName });
  const [imageSize, setImageSize] = useState(null);
  const [stageSize, setStageSize] = useState({ width: 1, height: 1 });
  const [transform, setTransform] = useState(initialTransform);
  const [loaded, setLoaded] = useState(false);
  const [interacting, setInteracting] = useState(false);
  const [error, setError] = useState('');
  const [applying, setApplying] = useState(false);
  const maxZoom = imageSize ? Math.max(4, Math.min(16, OUTPUT_WIDTH / (getFitScale(imageSize.width, imageSize.height) * 240))) : 4;
  const minZoom = imageSize ? getMinimumZoom(imageSize.width, imageSize.height, transform.rotation) : 1;
  const frame = getCropFrame(stageSize.width, stageSize.height);
  frameRef.current = frame;

  function setView(next, animateFrame = false) {
    const image = imageRef.current;
    const bounded = image ? constrainTransform(next, image.naturalWidth, image.naturalHeight) : next;
    transformRef.current = bounded;
    if (paintRef.current !== null) cancelAnimationFrame(paintRef.current);
    if (animateFrame) paintRef.current = requestAnimationFrame(() => { paintRef.current = null; setTransform(transformRef.current); });
    else { paintRef.current = null; setTransform(bounded); }
  }

  function stopGesture() {
    pointersRef.current.clear();
    gestureRef.current = null;
    setInteracting(false);
  }

  useLayoutEffect(() => {
    const element = stageRef.current;
    const update = () => {
      setStageSize({ width: element.clientWidth, height: element.clientHeight });
      stopGesture();
    };
    update();
    const observer = new ResizeObserver(update);
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    const previousFocus = document.activeElement;
    const scrollY = window.scrollY;
    const body = document.body;
    const previous = { position: body.style.position, top: body.style.top, width: body.style.width, overflow: body.style.overflow };
    Object.assign(body.style, { position: 'fixed', top: `-${scrollY}px`, width: '100%', overflow: 'hidden' });
    dialogRef.current.focus();
    const onBlur = () => stopGesture();
    window.addEventListener('blur', onBlur);
    return () => {
      window.removeEventListener('blur', onBlur);
      Object.assign(body.style, previous);
      window.scrollTo({ top: scrollY, behavior: 'instant' });
      if (previousFocus?.isConnected) previousFocus.focus({ preventScroll: true });
      if (paintRef.current !== null) cancelAnimationFrame(paintRef.current);
      sourceUrlsRef.current.forEach((url) => URL.revokeObjectURL(url));
    };
  }, []);

  useEffect(() => {
    const image = new Image();
    image.crossOrigin = 'anonymous';
    setLoaded(false);
    image.onload = () => {
      imageRef.current = image;
      setImageSize({ width: image.naturalWidth, height: image.naturalHeight });
      setView(initialTransform());
      setLoaded(true);
      setError('');
    };
    image.onerror = () => { imageRef.current = null; setError('图片读取失败，请更换图片后重试'); };
    image.src = source.url;
    return () => { image.onload = null; image.onerror = null; imageRef.current = null; };
  }, [source.url]);

  function pointOnCrop(clientPoint) {
    const rect = stageRef.current.getBoundingClientRect();
    const crop = frameRef.current;
    return {
      x: (clientPoint.x - rect.left - crop.x - crop.width / 2) / crop.scale,
      y: (clientPoint.y - rect.top - crop.y - crop.height / 2) / crop.scale
    };
  }

  function rebaseGesture() {
    const entries = [...pointersRef.current.entries()].slice(0, 2);
    gestureRef.current = entries.length ? { ids: entries.map(([id]) => id), points: entries.map(([, point]) => pointOnCrop(point)), base: { ...transformRef.current } } : null;
    setInteracting(entries.length > 0);
  }

  function handlePointerDown(event) {
    if (!loaded || applyingRef.current || (event.pointerType === 'mouse' && event.button !== 0)) return;
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    pointersRef.current.set(event.pointerId, { x: event.clientX, y: event.clientY });
    rebaseGesture();
  }

  function handlePointerMove(event) {
    if (!pointersRef.current.has(event.pointerId) || !gestureRef.current || applyingRef.current) return;
    event.preventDefault();
    pointersRef.current.set(event.pointerId, { x: event.clientX, y: event.clientY });
    const gesture = gestureRef.current;
    const points = gesture.ids.map((id) => pointOnCrop(pointersRef.current.get(id)));
    setView(transformGesture(gesture.base, gesture.points, points, maxZoom, imageSize), true);
  }

  function handlePointerEnd(event) {
    if (!pointersRef.current.delete(event.pointerId)) return;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
    rebaseGesture();
  }

  function changeZoom(value, point) {
    if (!loaded || applyingRef.current) return;
    stopGesture();
    const image = imageRef.current;
    const minimum = getMinimumZoom(image.naturalWidth, image.naturalHeight, transformRef.current.rotation);
    setView(zoomAround(transformRef.current, clamp(Number(value), minimum, maxZoom), point));
  }

  function handleWheel(event) {
    if (!loaded || applyingRef.current) return;
    event.preventDefault();
    changeZoom(transformRef.current.zoom * Math.exp(-event.deltaY * 0.0015), pointOnCrop({ x: event.clientX, y: event.clientY }));
  }

  useEffect(() => {
    const stage = stageRef.current;
    stage.addEventListener('wheel', handleWheel, { passive: false });
    return () => stage.removeEventListener('wheel', handleWheel);
  }, [loaded, maxZoom]);

  function rotateBy90() {
    stopGesture();
    setView({ ...transformRef.current, rotation: normalizeAngle(transformRef.current.rotation + 90) });
  }

  function resetPosition() { stopGesture(); setView(initialTransform()); }

  async function apply() {
    if (!imageRef.current || applyingRef.current) return;
    applyingRef.current = true;
    setApplying(true);
    stopGesture();
    setError('');
    try { onApply(await createCroppedFile(imageRef.current, transformRef.current, source.name)); }
    catch (failure) { setError(failure.message || '图片裁切失败，请重试'); applyingRef.current = false; setApplying(false); }
  }

  function replaceImage(event) {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file || applyingRef.current) return;
    if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type)) { setError('请选择 JPG、PNG 或 WebP 图片'); return; }
    if (file.size > 20 * 1024 * 1024) { setError('图片不能超过 20MB'); return; }
    stopGesture();
    const url = URL.createObjectURL(file);
    sourceUrlsRef.current.add(url);
    setSource({ url, name: file.name });
  }

  function handleKeyDown(event) {
    if (event.key === 'Escape') { event.preventDefault(); if (!applyingRef.current) onCancel(); }
    if (event.key === 'Tab') {
      const focusable = [...dialogRef.current.querySelectorAll('button:not(:disabled), input:not(:disabled)')].filter((element) => element.getClientRects().length);
      const first = focusable[0];
      const last = focusable.at(-1);
      if (event.shiftKey && (document.activeElement === first || document.activeElement === dialogRef.current)) { event.preventDefault(); last?.focus(); }
      else if (!event.shiftKey && (document.activeElement === last || document.activeElement === dialogRef.current)) { event.preventDefault(); first?.focus(); }
    }
  }

  const fit = imageSize ? getFitScale(imageSize.width, imageSize.height) * frame.scale : 1;
  const frameStyle = { left: frame.x, top: frame.y, width: frame.width, height: frame.height };
  return createPortal(
    <div className="editor-backdrop">
      <section ref={dialogRef} tabIndex={-1} className="image-editor" role="dialog" aria-modal="true" aria-label="编辑图片" aria-busy={applying} onKeyDown={handleKeyDown}>
        <header className="editor-header">
          <button className="editor-cancel" onClick={onCancel} disabled={applying}>取消</button>
          <div><h2>{title}裁切</h2><p>1704 × 2400</p></div>
          <button className="editor-done" onClick={apply} disabled={!loaded || applying}>{applying ? '处理中…' : '完成'}</button>
        </header>
        <div ref={stageRef} className={`editor-stage${interacting ? ' interacting' : ''}`} onPointerDown={handlePointerDown} onPointerMove={handlePointerMove} onPointerUp={handlePointerEnd} onPointerCancel={handlePointerEnd} onLostPointerCapture={handlePointerEnd}>
          <div className="editor-print-paper" style={frameStyle} />
          {loaded && imageSize && <img className="editor-media" src={source.url} alt="待裁切图片" draggable={false} style={{ left: frame.x + frame.width / 2 + transform.x * frame.scale, top: frame.y + frame.height / 2 + transform.y * frame.scale, width: imageSize.width * fit, height: imageSize.height * fit, transform: `translate(-50%, -50%) rotate(${transform.rotation}deg) scale(${transform.zoom})` }} />}
          <div className="editor-crop-frame" style={frameStyle}><div className="editor-crop-grid" /></div>
          {!loaded && <div className="editor-loading">{error ? '图片暂时无法读取' : '正在读取图片…'}</div>}
        </div>
        <footer className="editor-toolbar">
          <p className="editor-tip">单指移动 · 双指缩放、旋转</p>
          <div className="editor-controls"><span>缩放</span><input aria-label="图片缩放" type="range" min={minZoom} max={maxZoom} step="0.01" value={transform.zoom} disabled={!loaded || applying} onChange={(event) => changeZoom(event.target.value)} /><output>{Math.round(transform.zoom * 100)}%</output></div>
          <div className="editor-actions">
            <button className="reset-button" onClick={rotateBy90} disabled={!loaded || applying}>旋转 90°</button>
            <button className="reset-button" onClick={resetPosition} disabled={!loaded || applying}>重置</button>
            <label className={`clear-button editor-replace-action${applying ? ' disabled' : ''}`}>更换图片<input aria-label="更换裁切图片" type="file" accept="image/jpeg,image/png,image/webp" onChange={replaceImage} disabled={applying} /></label>
            {onClear && <button className="editor-clear-button" onClick={onClear} disabled={applying}>清除图片</button>}
          </div>
          <p className="editor-warning">裁切有 3–5mm 误差，重要文字图案请远离四周边缘。</p>
          {error && <p className="error-box editor-error" role="alert">{error}</p>}
        </footer>
      </section>
    </div>, document.body
  );
}
