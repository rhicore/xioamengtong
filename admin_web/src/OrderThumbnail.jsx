import { createContext, useContext, useEffect, useRef, useState } from 'react';

const ThumbnailQueue = createContext(null);

function createThumbnailQueue() {
  const jobs = new Map();
  let timer;
  let destroyed = false;
  const schedule = () => {
    if (timer || destroyed) return;
    timer = window.setTimeout(() => { timer = null; drain(); }, 0);
  };
  const observer = new IntersectionObserver(entries => {
    for (const entry of entries) {
      const job = jobs.get(entry.target);
      if (job) job.visible = entry.isIntersecting;
    }
    schedule();
  }, { rootMargin: '160px 0px' });

  function drain() {
    const pending = [...jobs.values()].filter(job => job.visible && !job.started);
    // Observer 回调顺序不保证等于页面顺序；按 DOM 排序，不逐张测量布局。
    pending.sort((a, b) => a.element.compareDocumentPosition(b.element) & Node.DOCUMENT_POSITION_FOLLOWING ? -1 : 1);
    for (const job of pending) {
      job.started = true;
      job.start().finally(() => {
        if (jobs.get(job.element) === job) {
          jobs.delete(job.element);
          observer.unobserve(job.element);
        }
        schedule();
      });
    }
  }

  return {
    add(element, start, cancel) {
      const job = { element, start, cancel, visible: false, started: false };
      jobs.set(element, job);
      observer.observe(element);
      return () => {
        if (jobs.get(element) === job) jobs.delete(element);
        observer.unobserve(element);
        cancel();
      };
    },
    destroy() {
      destroyed = true;
      observer.disconnect();
      clearTimeout(timer);
      for (const job of jobs.values()) job.cancel();
      jobs.clear();
    }
  };
}

export function ThumbnailProvider({ children }) {
  const [queue, setQueue] = useState(null);
  useEffect(() => {
    const next = createThumbnailQueue();
    setQueue(next);
    return () => next.destroy();
  }, []);
  return <ThumbnailQueue.Provider value={queue}>{children}</ThumbnailQueue.Provider>;
}

export function thumbnailSources(directUrl, originalUrl) {
  let thumbnail = '';
  try {
    const url = new URL(directUrl);
    if (url.protocol === 'https:' && /\.(tcb\.qcloud\.la|tcloudbaseapp\.com|myqcloud\.com)$/.test(url.hostname)) {
      // 保留临时链接的原始签名；只在列表请求 2 倍像素的小图，不修改源文件。
      thumbnail = `${directUrl}${directUrl.includes('?') ? '&' : '?'}imageMogr2/thumbnail/80x/quality/80/format/jpg`;
    }
  } catch { /* 本地图片和非云存储地址沿用原链接。 */ }
  return [...new Set([thumbnail, directUrl, originalUrl].filter(Boolean))];
}

export default function OrderThumbnail({ directUrl, originalUrl, name, label, onClick }) {
  const queue = useContext(ThumbnailQueue);
  const imageRef = useRef(null);
  const sourcesRef = useRef([]);
  const currentSourceRef = useRef('');
  const cancelAlternativeRef = useRef(null);
  sourcesRef.current = thumbnailSources(directUrl, originalUrl);
  const [failed, setFailed] = useState(false);
  const [loaded, setLoaded] = useState(false);
  useEffect(() => {
    if (!queue) return;
    const image = imageRef.current;
    if (!sourcesRef.current.length) return;
    let finish, timeout, cancelled = false;
    setFailed(false);
    setLoaded(false);
    const stop = () => {
      cancelled = true;
      cancelAlternativeRef.current?.();
      clearTimeout(timeout);
      image.onload = image.onerror = null;
      image.removeAttribute('src');
      finish?.();
    };
    return queue.add(image, () => new Promise(resolve => {
      // 排队时链接可在后台补齐；真正启动时取最新来源，已开始的图片不取消重载。
      finish = resolve;
      const attempted = new Set();
      const next = () => {
        clearTimeout(timeout);
        if (cancelled) return resolve();
        const source = sourcesRef.current.find(url => !attempted.has(url));
        if (!source) {
          image.onload = image.onerror = null;
          setFailed(true);
          return resolve();
        }
        attempted.add(source);
        currentSourceRef.current = source;
        image.src = source;
        timeout = window.setTimeout(next, 20000);
      };
      image.onload = () => {
        clearTimeout(timeout);
        if (cancelled) return resolve();
        cancelAlternativeRef.current?.();
        setLoaded(true);
        image.onload = image.onerror = null;
        resolve();
      };
      image.onerror = next;
      next();
    }), stop);
  }, [queue, originalUrl]);

  useEffect(() => {
    const thumbnail = thumbnailSources(directUrl, originalUrl)[0];
    if (loaded || !thumbnail?.includes('imageMogr2/thumbnail/') || currentSourceRef.current !== originalUrl) return;
    // 原图立即加载；后台小图若先完成就显示小图，绝不取消原图去等待尚未完成的处理。
    const alternative = new Image();
    alternative.decoding = 'async';
    const cancel = () => {
      alternative.onload = alternative.onerror = null;
      alternative.removeAttribute('src');
    };
    cancelAlternativeRef.current = cancel;
    alternative.onload = () => {
      currentSourceRef.current = thumbnail;
      if (!imageRef.current.onload) imageRef.current.onload = () => {
        setFailed(false);
        setLoaded(true);
        cancel();
      };
      imageRef.current.src = thumbnail;
    };
    alternative.src = thumbnail;
    return cancel;
  }, [directUrl, originalUrl, loaded]);

  return (
    <button className="image-thumb-button" onClick={onClick} aria-label={label} aria-busy={!loaded && !failed} title={failed ? '图片加载失败，点击预览' : undefined}>
      <img ref={imageRef} alt={name} decoding="async" width="38" height="42" style={{ opacity: loaded ? 1 : 0 }} />
    </button>
  );
}
