import { lazy, Suspense, useState } from 'react';
import { getImageBlobUrl, getImagePreviewUrls, getOrder, submitOrder, uploadImages } from './api.js';

const ImageEditor = lazy(() => import('./ImageEditor.jsx'));

const EMPTY_IMAGE = { file: null, url: '', fileId: '', removed: false };

function customerTemplateOptions(rawTemplates) {
  const twoImageTemplate = rawTemplates.find((template) => (
    template.slug === 'jiaotao' || template.slug === 'chexian'
  ));
  const oneImageTemplate = rawTemplates.find((template) => template.slug === 'huoye');

  return [
    {
      ...(twoImageTemplate || {}),
      slug: 'two_images',
      backend_slug: twoImageTemplate?.slug || 'chexian',
      display_name: '两图',
      description: '上传正面和反面，共 2 张图',
      image_count: 2,
      allow_blank: true
    },
    {
      ...(oneImageTemplate || {}),
      slug: 'one_image',
      backend_slug: oneImageTemplate?.slug || 'huoye',
      display_name: '一张图',
      description: '只上传正面 1 张图',
      image_count: 1,
      allow_blank: false
    }
  ];
}

function customerTypeSlug(rawSlug) {
  return rawSlug === 'huoye' ? 'one_image' : (rawSlug ? 'two_images' : '');
}

function backendTypeSlug(selectedSlug, existingRawSlug) {
  if (selectedSlug === 'one_image') return 'huoye';
  return existingRawSlug === 'jiaotao' || existingRawSlug === 'chexian'
    ? existingRawSlug
    : 'chexian';
}

function imageState(url, fileId) {
  return {
    file: null,
    url: url || '',
    fileId: fileId || '',
    removed: false,
    loading: Boolean(fileId && !url)
  };
}

export default function App() {
  const [step, setStep] = useState('order');
  const [orderId, setOrderId] = useState('');
  const [order, setOrder] = useState(null);
  const [templates, setTemplates] = useState([]);
  const [selectedType, setSelectedType] = useState('');
  const [images, setImages] = useState({ front: EMPTY_IMAGE, back: EMPTY_IMAGE });
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [editor, setEditor] = useState(null);
  const [editingSide, setEditingSide] = useState('');

  const customerTemplates = customerTemplateOptions(templates);
  const selectedTemplate = customerTemplates.find((item) => item.slug === selectedType) || null;

  async function loadExistingImages(existingOrderId, existingImages) {
    try {
      const previewUrls = await getImagePreviewUrls(existingOrderId);
      const previewSides = ['front', 'back'].filter((side) => previewUrls[side + '_url']);
      previewSides.forEach((side) => {
        const url = previewUrls[side + '_url'];
        setImages((current) => {
          const image = current[side];
          if (image.file || image.fileId !== existingImages[side].fileId || image.removed) return current;
          return { ...current, [side]: { ...image, url, loading: false } };
        });
      });

      const missingSides = ['front', 'back'].filter((side) => (
        existingImages[side].fileId && !previewUrls[side + '_url']
      ));
      await Promise.all(missingSides.map((side) => loadImageBlobFallback(existingOrderId, side, existingImages)));
    } catch {
      const sides = ['front', 'back'].filter((side) => existingImages[side].fileId);
      await Promise.all(sides.map((side) => loadImageBlobFallback(existingOrderId, side, existingImages)));
    }
  }

  async function loadImageBlobFallback(existingOrderId, side, existingImages) {
    try {
      const url = await getImageBlobUrl(existingOrderId, side);
      setImages((current) => {
        const image = current[side];
        if (image.file || image.fileId !== existingImages[side].fileId || image.removed) {
          URL.revokeObjectURL(url);
          return current;
        }
        return { ...current, [side]: { ...image, url, loading: false } };
      });
    } catch {
      setImages((current) => ({
        ...current,
        [side]: { ...current[side], loading: false }
      }));
    }
  }

  function resetToOrder() {
    setStep('order');
    setOrderId('');
    setOrder(null);
    setTemplates([]);
    setSelectedType('');
    setImages({ front: EMPTY_IMAGE, back: EMPTY_IMAGE });
    setMessage('');
    setError('');
  }

  async function loadOrder() {
    const normalizedOrderId = orderId.trim();
    if (!normalizedOrderId || loading) return;
    setLoading(true);
    setError('');
    setMessage('');
    const controller = new AbortController();
    const timeoutTimer = window.setTimeout(() => controller.abort(), 30000);
    try {
      const result = await getOrder(normalizedOrderId, { signal: controller.signal, preview: false });
      setOrderId(normalizedOrderId);
      setOrder(result);
      setTemplates(result.templates || []);
      setSelectedType(customerTypeSlug(result.notebook_type || ''));
      const nextImages = {
        front: imageState(result.front_url, result.front_file_id),
        back: imageState(result.back_url, result.back_file_id)
      };
      setImages(nextImages);
      setStep('upload');
      if (result.exists) void loadExistingImages(normalizedOrderId, nextImages);
    } catch (requestError) {
      setError(requestError.name === 'AbortError'
        ? '订单查询超时，请检查网络后重试'
        : (requestError.message || '订单信息查询失败，请稍后重试'));
    } finally {
      window.clearTimeout(timeoutTimer);
      setLoading(false);
    }
  }

  function selectType(slug) {
    if (selectedType && selectedType !== slug) {
      setImages({ front: { ...EMPTY_IMAGE, removed: true }, back: { ...EMPTY_IMAGE, removed: true } });
    }
    setSelectedType(slug);
    setError('');
  }

  function chooseImage(side, event) {
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
    const url = URL.createObjectURL(file);
    setEditor({ side, sourceUrl: url, sourceName: file.name, temporaryUrl: url });
    setError('');
  }

  function clearImage(side) {
    if (images[side].url.startsWith('blob:')) URL.revokeObjectURL(images[side].url);
    setImages((current) => ({ ...current, [side]: { ...EMPTY_IMAGE, removed: true } }));
  }

  async function editImage(side) {
    const image = images[side];
    if (!image.url) return;
    setError('');
    setEditingSide(side);
    try {
      const sourceUrl = image.file || image.url.startsWith('blob:')
        ? image.url
        : await getImageBlobUrl(orderId, side);
      setEditor({
        side,
        sourceUrl,
        sourceName: image.file?.name || `${side}.jpg`,
        temporaryUrl: image.file ? '' : sourceUrl
      });
    } catch (requestError) {
      setError(requestError.message || '图片读取失败，请重新上传');
    } finally {
      setEditingSide('');
    }
  }

  function cancelEdit() {
    if (editor?.temporaryUrl) URL.revokeObjectURL(editor.temporaryUrl);
    setEditor(null);
  }

  function applyEdit({ file, previewUrl }) {
    const side = editor.side;
    const current = images[side];
    if (current.url.startsWith('blob:')) URL.revokeObjectURL(current.url);
    if (editor.temporaryUrl) URL.revokeObjectURL(editor.temporaryUrl);
    setImages((currentImages) => ({
      ...currentImages,
      [side]: { file, url: previewUrl, fileId: '', removed: false }
    }));
    setEditor(null);
    setError('');
  }

  async function submit() {
    if (!selectedTemplate) {
      setError('请选择类型');
      return;
    }
    if (!selectedTemplate.allow_blank && !images.front.file && !images.front.fileId) {
      setError('一张图请先上传正面图片');
      return;
    }

    setLoading(true);
    setError('');
    setMessage('正在上传图片...');
    try {
      const files = {
        front: images.front.file,
        back: selectedTemplate.image_count === 1 ? null : images.back.file
      };
      const uploadResult = files.front || files.back
        ? await uploadImages(orderId, files, { preview: false })
        : {};
      const frontFileId = images.front.removed ? null : (uploadResult.front_file_id || images.front.fileId || null);
      const backFileId = selectedTemplate.image_count === 1 || images.back.removed
        ? null
        : (uploadResult.back_file_id || images.back.fileId || null);

      await submitOrder(orderId, {
        notebook_type: backendTypeSlug(selectedType, order?.notebook_type),
        front_file_id: frontFileId,
        back_file_id: backFileId,
        source: 'web'
      });
      setMessage('');
      setStep('success');
    } catch (requestError) {
      setError(requestError.message || '提交失败，请稍后重试');
      setMessage('');
    } finally {
      setLoading(false);
    }
  }

  if (step === 'order') {
    return (
      <main className="customer-shell entry-shell">
        <section className="customer-card entry-card">
          <p className="eyebrow">CUSTOM NOTEBOOK</p>
          <h1>照片上传与编辑</h1>
          <p className="subtitle">输入订单号，选择类型并上传图片</p>
          <label className="field-label">
            订单号
            <input
              value={orderId}
              onChange={(event) => setOrderId(event.target.value)}
              onKeyDown={(event) => { if (event.key === 'Enter') loadOrder(); }}
              placeholder="请输入订单号"
              autoComplete="off"
            />
          </label>
          <button className="primary-button" onClick={loadOrder} disabled={loading || !orderId.trim()}>
            {loading ? '查询中...' : '下一步'}
          </button>
          {loading && <p className="query-progress">正在查询订单，请稍候。</p>}
          {error && <p className="error-box">{error}</p>}
        </section>
      </main>
    );
  }

  if (step === 'success') {
    return (
      <main className="customer-shell entry-shell success-shell">
        <section className="customer-card success-card">
          <div className="success-icon" aria-hidden="true">✓</div>
          <p className="eyebrow">ORDER RECEIVED</p>
          <h1>提交成功</h1>
          <p className="success-message">提交成功，小二给您加紧安排制作，请您耐心等待！</p>
          <p className="success-order">订单号：{orderId}</p>
          <button className="primary-button" onClick={resetToOrder}>返回首页</button>
        </section>
      </main>
    );
  }

  return (
    <main className="customer-shell">
      <header className="customer-header">
        <button className="back-button" onClick={resetToOrder} aria-label="返回">←</button>
        <div>
          <p className="eyebrow">CUSTOM NOTEBOOK</p>
          <h1>上传定制图片</h1>
          <p className="order-caption">
            订单号：{orderId}
            <span className={order?.platform ? 'platform-label' : 'platform-label unknown'}>
              {' · 平台：'}{order?.platform || '未知平台'}
            </span>
            {!order?.platform && (
              <span className="platform-warning">未知订单号，请检查订单号是否正确</span>
            )}
          </p>
        </div>
      </header>

      <section className="customer-card type-card">
        <div className="section-heading">
          <div>
            <h2>请正确选择类型</h2>
            <p>请先确认本子类型，选错会影响装订和图片张数。</p>
          </div>
          {order?.exists && <span className="saved-badge">正在修改已有提交</span>}
        </div>
        <div className="type-list">
          {customerTemplates.map((template) => (
            <button
              className={`type-option ${selectedType === template.slug ? 'selected' : ''}`}
              key={template.slug}
              onClick={() => selectType(template.slug)}
            >
              <span className="type-option-main">
                <TemplateVisual slug={template.slug} />
                <span className="type-option-copy">
                <strong>{template.display_name}</strong>
                  <small>{templateUploadHint(template)}</small>
                </span>
              </span>
              <span className="radio-mark">{selectedType === template.slug ? '✓' : ''}</span>
            </button>
          ))}
        </div>
      </section>

      {selectedTemplate && (
        <section className="customer-card upload-card">
          <div className="section-heading">
            <div>
              <h2>上传图片</h2>
              <p>{templateUploadHint(selectedTemplate)}</p>
            </div>
          </div>
          <div className="image-grid">
            <ImagePicker
              label="正面"
              side="front"
              image={images.front}
              required={!selectedTemplate.allow_blank}
              onChange={chooseImage}
              onEdit={editImage}
              onClear={clearImage}
              editingSide={editingSide}
            />
            {selectedTemplate.image_count > 1 && (
              <ImagePicker
                label="反面"
                side="back"
                image={images.back}
                onChange={chooseImage}
                onEdit={editImage}
                onClear={clearImage}
                editingSide={editingSide}
              />
            )}
          </div>
          <button className="primary-button submit-button" onClick={submit} disabled={loading}>
            {loading ? '提交中...' : '确认提交'}
          </button>
          {message && <p className="success-text">{message}</p>}
          {error && <p className="error-box">{error}</p>}
        </section>
      )}
      {editor && (
        <Suspense fallback={<div className="editor-backdrop"><div className="image-editor editor-loading-card">正在打开图片编辑器...</div></div>}>
          <ImageEditor
            sourceUrl={editor.sourceUrl}
            sourceName={editor.sourceName}
            title={editor.side === 'front' ? '正面' : '反面'}
            onCancel={cancelEdit}
            onApply={applyEdit}
            onClear={() => {
              clearImage(editor.side);
              cancelEdit();
            }}
          />
        </Suspense>
      )}
    </main>
  );
}

function templateUploadHint(template) {
  return template.slug === 'one_image'
    ? '只上传正面 1 张图'
    : '上传正面和反面，共 2 张图';
}

function TemplateVisual({ slug }) {
  const imageCount = slug === 'one_image' ? '1张' : '2张';
  return (
    <span className={`template-visual ${slug || 'default'}-visual`} aria-hidden="true">
      <span className="template-visual-sheet template-visual-sheet-back" />
      <span className="template-visual-sheet template-visual-sheet-front" />
      <span className="template-visual-count">{imageCount}</span>
    </span>
  );
}

function ImagePicker({ label, side, image, required, onChange, onEdit, editingSide }) {
  return (
    <div className="image-picker">
      <div className="picker-title">{label}{required && <em>必传</em>}</div>
      <div
        className={`image-preview ${image.url ? 'has-image' : ''}`}
        role={image.url ? 'button' : undefined}
        tabIndex={image.url ? 0 : undefined}
        onClick={() => image.url && onEdit(side)}
        onKeyDown={(event) => {
          if (image.url && (event.key === 'Enter' || event.key === ' ')) onEdit(side);
        }}
        aria-label={image.url ? `${label}，点击调整图片` : undefined}
      >
        {image.url ? (
          <>
            <img src={image.url} alt={label} />
            <span className="image-edit-hint">{editingSide === side ? '正在打开编辑器...' : '点击调整图片'}</span>
          </>
        ) : (
          <label className="empty-image-picker">
            <span>{image.loading ? '正在读取之前的图片...' : '点击选择图片'}</span>
            <input type="file" accept="image/jpeg,image/png,image/webp" onChange={(event) => onChange(side, event)} />
          </label>
        )}
      </div>
    </div>
  );
}
