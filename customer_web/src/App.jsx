import { useState } from 'react';
import { getImageBlobUrl, getOrder, submitOrder, uploadImages } from './api.js';
import ImageEditor from './ImageEditor.jsx';

const EMPTY_IMAGE = { file: null, url: '', fileId: '', removed: false };

function imageState(url, fileId) {
  return { file: null, url: url || '', fileId: fileId || '', removed: false };
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

  const selectedTemplate = templates.find((item) => item.slug === selectedType) || null;

  async function loadOrder() {
    const normalizedOrderId = orderId.trim();
    if (!normalizedOrderId || loading) return;
    setLoading(true);
    setError('');
    setMessage('');
    try {
      const result = await getOrder(normalizedOrderId);
      setOrderId(normalizedOrderId);
      setOrder(result);
      setTemplates(result.templates || []);
      setSelectedType(result.notebook_type || '');
      setImages({
        front: imageState(result.front_url, result.front_file_id),
        back: imageState(result.back_url, result.back_file_id)
      });
      setStep('upload');
    } catch (requestError) {
      setError(requestError.message || '订单信息查询失败，请稍后重试');
    } finally {
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
      const sourceUrl = image.file
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
      setError('请选择本子类型');
      return;
    }
    if (!selectedTemplate.allow_blank && !images.front.file && !images.front.fileId) {
      setError('活页本请先上传封面图片');
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
        ? await uploadImages(orderId, files)
        : {};
      const frontFileId = images.front.removed ? null : (uploadResult.front_file_id || images.front.fileId || null);
      const backFileId = selectedTemplate.image_count === 1 || images.back.removed
        ? null
        : (uploadResult.back_file_id || images.back.fileId || null);

      await submitOrder(orderId, {
        notebook_type: selectedType,
        front_file_id: frontFileId,
        back_file_id: backFileId,
        source: 'web'
      });
      setMessage('提交成功，正在刷新图片预览...');
      const refreshed = await getOrder(orderId);
      setOrder(refreshed);
      setTemplates(refreshed.templates || []);
      setSelectedType(refreshed.notebook_type || selectedType);
      setImages({
        front: imageState(refreshed.front_url, refreshed.front_file_id),
        back: imageState(refreshed.back_url, refreshed.back_file_id)
      });
      setMessage('提交成功');
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
          <h1>图书定制采集</h1>
          <p className="subtitle">输入订单号，选择本子类型并上传定制图片</p>
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
          {error && <p className="error-box">{error}</p>}
        </section>
      </main>
    );
  }

  return (
    <main className="customer-shell">
      <header className="customer-header">
        <button className="back-button" onClick={() => setStep('order')} aria-label="返回">←</button>
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
            <h2>选择本子类型</h2>
            <p>可以重新选择类型，图片会按新类型重新上传。</p>
          </div>
          {order?.exists && <span className="saved-badge">正在修改已有提交</span>}
        </div>
        <div className="type-list">
          {templates.map((template) => (
            <button
              className={`type-option ${selectedType === template.slug ? 'selected' : ''}`}
              key={template.slug}
              onClick={() => selectType(template.slug)}
            >
              <span>
                <strong>{template.display_name}</strong>
                <small>{template.description}</small>
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
              <p>{selectedTemplate.description}</p>
            </div>
          </div>
          <div className="image-grid">
            <ImagePicker
              label="前封面"
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
                label="后封底"
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
        <ImageEditor
          sourceUrl={editor.sourceUrl}
          sourceName={editor.sourceName}
          title={editor.side === 'front' ? '前封面' : '后封底'}
          onCancel={cancelEdit}
          onApply={applyEdit}
          onClear={() => {
            clearImage(editor.side);
            cancelEdit();
          }}
        />
      )}
    </main>
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
            <span>点击选择图片</span>
            <input type="file" accept="image/jpeg,image/png,image/webp" onChange={(event) => onChange(side, event)} />
          </label>
        )}
      </div>
    </div>
  );
}
