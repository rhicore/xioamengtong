import { lazy, Suspense, useEffect, useRef, useState } from 'react';
import { getImageBlobUrl, getImagePreviewUrls, getOrder, submitOrder, uploadImages } from './api.js';
import notebookOneIcon from './assets/notebook-one-icon.png?inline';
import notebookTwoIcon from './assets/notebook-two-icon.png?inline';

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
      display_name: '胶套本（两图）',
      description: '上传正面和反面，共 2 张图',
      image_count: 2,
      allow_blank: true
    },
    {
      ...(oneImageTemplate || {}),
      slug: 'one_image',
      backend_slug: oneImageTemplate?.slug || 'huoye',
      display_name: '活页本（一图）',
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

function customerStatusLabel(status) {
  return {
    draft: '用户已上传',
    submitted: '用户已上传',
    pending: '用户已上传',
    in_production: '制作中',
    completed: '已完成'
  }[status] || '用户已上传';
}

function isCustomerLockedStatus(status) {
  return status === 'in_production' || status === 'completed';
}

function IcpFooter() {
  return (
    <footer className="site-footer">
      <a href="https://beian.miit.gov.cn/" target="_blank" rel="noreferrer">
        辽ICP备2026024165号-1
      </a>
    </footer>
  );
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

function createImageGroup(data = {}) {
  return {
    id: data.id || crypto.randomUUID(),
    savedGroupId: data.id,
    notebookType: data.notebook_type,
    selectedType: customerTypeSlug(data.notebook_type || ''),
    quantity: Number(data.quantity) || 1,
    images: {
      front: imageState(data.front_url, data.front_file_id),
      back: imageState(data.back_url, data.back_file_id)
    }
  };
}

export default function App() {
  const [step, setStep] = useState('order');
  const [orderId, setOrderId] = useState('');
  const [order, setOrder] = useState(null);
  const [templates, setTemplates] = useState([]);
  const [groups, setGroups] = useState(() => [createImageGroup()]);
  const [activeGroupId, setActiveGroupId] = useState(null);
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [editor, setEditor] = useState(null);
  const [editingSide, setEditingSide] = useState('');
  const submittingRef = useRef(false);

  const activeGroup = groups.find((group) => group.id === activeGroupId) || groups[0];
  const selectedType = activeGroup.selectedType;
  const images = activeGroup.images;
  const totalQuantity = groups.reduce((total, group) => total + (Number.isSafeInteger(Number(group.quantity)) && Number(group.quantity) > 0 ? Number(group.quantity) : 0), 0);
  const customerTemplates = customerTemplateOptions(templates);
  const selectedTemplate = customerTemplates.find((item) => item.slug === selectedType) || null;
  const customerLocked = isCustomerLockedStatus(order?.status);
  const lockMessage = order?.status === 'completed'
    ? '订单已完成，图片已锁定，暂不支持上传或修改。'
    : '订单已进入制作流程，图片已锁定，暂不支持上传或修改。';

  useEffect(() => {
    if (step === 'order') return;
    // 移动端从订单输入页进入上传页时保留了上一页滚动位置，
    // 需要主动回到页面顶部，让订单号、平台和状态提示立即可见。
    window.scrollTo({ top: 0, left: 0, behavior: 'auto' });
    document.documentElement.scrollTop = 0;
    document.body.scrollTop = 0;
  }, [step, activeGroupId]);

  function setImages(update, groupId = activeGroup.id) {
    setGroups((current) => current.map((group) => group.id === groupId ? {
      ...group,
      images: typeof update === 'function' ? update(group.images) : update
    } : group));
  }

  function setSelectedType(slug) {
    setGroups((current) => current.map((group) => group.id === activeGroup.id ? { ...group, selectedType: slug } : group));
  }

  function addGroup() {
    if (customerLocked || loading || editingSide) return;
    const group = createImageGroup();
    setGroups((current) => [...current, group]);
    setActiveGroupId(group.id);
    setError('');
  }

  function removeGroup() {
    if (customerLocked || loading || editingSide || groups.length === 1) return;
    const number = groups.findIndex((group) => group.id === activeGroup.id) + 1;
    if (!window.confirm(`确定删除第 ${number} 组图片？其他组不会改变。`)) return;
    Object.values(images).forEach((image) => {
      if (image.url.startsWith('blob:')) URL.revokeObjectURL(image.url);
    });
    const remaining = groups.filter((group) => group.id !== activeGroup.id);
    setGroups(remaining);
    setActiveGroupId(remaining[Math.min(number - 1, remaining.length - 1)].id);
    setError('');
  }

  async function loadExistingImages(existingOrderId, { images: existingImages, id: groupId, savedGroupId }) {
    try {
      const previewUrls = await getImagePreviewUrls(existingOrderId, savedGroupId);
      const previewSides = ['front', 'back'].filter((side) => previewUrls[side + '_url']);
      previewSides.forEach((side) => {
        const url = previewUrls[side + '_url'];
        setImages((current) => {
          const image = current[side];
          if (image.file || image.fileId !== existingImages[side].fileId || image.removed) return current;
          return { ...current, [side]: { ...image, url, loading: false } };
        }, groupId);
      });

      const missingSides = ['front', 'back'].filter((side) => (
        existingImages[side].fileId && !previewUrls[side + '_url']
      ));
      await Promise.all(missingSides.map((side) => loadImageBlobFallback(existingOrderId, side, existingImages, groupId, savedGroupId)));
    } catch {
      const sides = ['front', 'back'].filter((side) => existingImages[side].fileId);
      await Promise.all(sides.map((side) => loadImageBlobFallback(existingOrderId, side, existingImages, groupId, savedGroupId)));
    }
  }

  async function loadImageBlobFallback(existingOrderId, side, existingImages, groupId, savedGroupId) {
    try {
      const url = await getImageBlobUrl(existingOrderId, side, savedGroupId);
      setImages((current) => {
        const image = current[side];
        if (image.file || image.fileId !== existingImages[side].fileId || image.removed) {
          URL.revokeObjectURL(url);
          return current;
        }
        return { ...current, [side]: { ...image, url, loading: false } };
      }, groupId);
    } catch {
      setImages((current) => ({
        ...current,
        [side]: { ...current[side], loading: false }
      }), groupId);
    }
  }

  function resetToOrder() {
    if (submittingRef.current) return;
    setStep('order');
    setOrderId('');
    setOrder(null);
    setTemplates([]);
    groups.forEach((group) => Object.values(group.images).forEach((image) => {
      if (image.url.startsWith('blob:')) URL.revokeObjectURL(image.url);
    }));
    setGroups([createImageGroup()]);
    setActiveGroupId(null);
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
      const nextGroups = result.groups?.length ? result.groups.map(createImageGroup) : [createImageGroup(result)];
      setGroups(nextGroups);
      setActiveGroupId(nextGroups[0].id);
      setStep('upload');
      if (result.exists) nextGroups.forEach((group) => {
        if (group.images.front.fileId || group.images.back.fileId) void loadExistingImages(normalizedOrderId, group);
      });
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
    if (loading) return;
    if (customerLocked) {
      setError(lockMessage);
      return;
    }
    if (selectedType && selectedType !== slug) {
      setImages({ front: { ...EMPTY_IMAGE, removed: true }, back: { ...EMPTY_IMAGE, removed: true } });
    }
    setSelectedType(slug);
    setError('');
  }

  function chooseImage(side, event) {
    if (loading) return;
    if (customerLocked) {
      setError(lockMessage);
      return;
    }
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
    setEditor({ groupId: activeGroup.id, side, sourceUrl: url, sourceName: file.name, temporaryUrl: url });
    setError('');
  }

  function clearImage(side) {
    if (customerLocked) {
      setError(lockMessage);
      return;
    }
    if (images[side].url.startsWith('blob:')) URL.revokeObjectURL(images[side].url);
    setImages((current) => ({ ...current, [side]: { ...EMPTY_IMAGE, removed: true } }));
  }

  async function editImage(side) {
    if (loading || editingSide) return;
    if (customerLocked) {
      setError(lockMessage);
      return;
    }
    const image = images[side];
    if (!image.url) return;
    setError('');
    setEditingSide(side);
    try {
      const sourceUrl = image.file || image.url.startsWith('blob:')
        ? image.url
        : await getImageBlobUrl(orderId, side, activeGroup.savedGroupId);
      setEditor({
        groupId: activeGroup.id,
        side,
        sourceUrl,
        sourceName: image.file?.name || `${side}.jpg`,
        temporaryUrl: image.file || image.url.startsWith('blob:') ? '' : sourceUrl
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
    if (customerLocked) {
      setError(lockMessage);
      cancelEdit();
      return;
    }
    const side = editor.side;
    const targetGroup = groups.find((group) => group.id === editor.groupId);
    if (!targetGroup) {
      URL.revokeObjectURL(previewUrl);
      cancelEdit();
      return;
    }
    const current = targetGroup.images[side];
    if (current.url.startsWith('blob:')) URL.revokeObjectURL(current.url);
    if (editor.temporaryUrl) URL.revokeObjectURL(editor.temporaryUrl);
    setImages((currentImages) => ({
      ...currentImages,
      [side]: { file, url: previewUrl, fileId: '', removed: false }
    }), editor.groupId);
    setEditor(null);
    setError('');
  }

  async function submit() {
    if (submittingRef.current || loading) return;
    if (customerLocked) {
      setError(lockMessage);
      return;
    }
    for (const [index, group] of groups.entries()) {
      const template = customerTemplates.find((item) => item.slug === group.selectedType);
      let groupError = !template ? '请选择类型' : '';
      if (template && !template.allow_blank && !group.images.front.file && !group.images.front.fileId) {
        groupError = '一张图请先上传正面图片';
      }
      if (!Number.isSafeInteger(Number(group.quantity)) || Number(group.quantity) < 1) groupError = '本组数量必须是大于 0 的整数';
      if (groupError) {
        setActiveGroupId(group.id);
        setError(groups.length > 1 ? `第 ${index + 1} 组：${groupError}` : groupError);
        return;
      }
    }

    submittingRef.current = true;
    setLoading(true);
    setError('');
    setMessage('正在上传图片...');
    try {
      const savedGroups = [];
      for (const [index, group] of groups.entries()) {
        setMessage(`正在上传第 ${index + 1}/${groups.length} 组图片...`);
        const { front, back } = group.images;
        const oneImage = group.selectedType === 'one_image';
        const files = { front: front.file, back: oneImage ? null : back.file };
        let uploaded = {};
        if (files.front || files.back) {
          try { uploaded = await uploadImages(orderId, files, { preview: false }); }
          catch (failure) { throw new Error(`第 ${index + 1} 组：${failure.message || '图片上传失败，请重试'}`); }
          setImages((current) => {
            const next = { ...current };
            for (const side of ['front', 'back']) {
              if (files[side] && uploaded[side + '_file_id'] && current[side].file === files[side]) {
                next[side] = { ...current[side], file: null, fileId: uploaded[side + '_file_id'], removed: false };
              }
            }
            return next;
          }, group.id);
        }
        savedGroups.push({
          id: group.id,
          notebook_type: backendTypeSlug(group.selectedType, group.notebookType),
          quantity: Number(group.quantity),
          front_file_id: front.removed ? null : uploaded.front_file_id || front.fileId || null,
          back_file_id: oneImage || back.removed ? null : uploaded.back_file_id || back.fileId || null
        });
      }
      setMessage('正在保存全部组...');
      const result = await submitOrder(orderId, { groups: savedGroups, source: 'web' });
      setOrder(result);
      setMessage('');
      setStep('success');
    } catch (requestError) {
      setError(requestError.message || '提交失败，请稍后重试');
      setMessage('');
    } finally {
      submittingRef.current = false;
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
        <IcpFooter />
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
        <IcpFooter />
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
            {order?.exists && (
              <span className={`order-status-label${customerLocked ? ' locked' : ''}`}>
                {' · 状态：'}{order.status_display || customerStatusLabel(order.status)}
              </span>
            )}
            {!order?.platform && (
              <span className="platform-warning">未知订单号，请检查订单号是否正确</span>
            )}
          </p>
        </div>
      </header>

      <section className="customer-card type-card">
        <div className="order-groups">
        <div className="order-group-tabs">
          {groups.map((group, index) => (
            <button
              key={group.id}
              className={`order-group-tab${group.id === activeGroup.id ? ' selected' : ''}`}
              aria-pressed={group.id === activeGroup.id}
              disabled={loading || Boolean(editingSide)}
              onClick={() => { setActiveGroupId(group.id); setError(''); }}
            >第 {index + 1} 组</button>
          ))}
          <button className="clear-button" onClick={addGroup} disabled={customerLocked || loading || Boolean(editingSide)}>＋ 添加一组</button>
          {groups.length > 1 && <button className="clear-button" onClick={removeGroup} disabled={customerLocked || loading || Boolean(editingSide)}>删除本组</button>}
        </div>
        <p>不同款式或不同图片，添加一组；相同图片印多本，修改本组数量。</p>
        </div>
        <div className="section-heading">
          <div>
            <h2>请正确选择类型</h2>
            <p>请先确认本子类型，选错会影响装订和图片张数。</p>
          </div>
          {order?.exists && (
            <span className={`saved-badge${customerLocked ? ' locked-badge' : ''}`}>
              {customerLocked ? `${order.status_display || customerStatusLabel(order.status)}，已锁定` : '正在修改已有提交'}
            </span>
          )}
        </div>
        {customerLocked && <p className="locked-notice">{lockMessage}</p>}
        <div className="type-list">
          {customerTemplates.map((template) => (
            <button
              className={`type-option ${selectedType === template.slug ? 'selected' : ''}`}
              key={template.slug}
              onClick={() => selectType(template.slug)}
              disabled={customerLocked || loading}
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
          <div className="section-heading upload-section-heading">
            <div className="upload-heading-copy">
              <h2>上传图片</h2>
              <p>
                {templateUploadHint(selectedTemplate)}
                <span className="upload-guidance">请上传高清原图，不要上传拍照图、模糊图，传图就是印刷封面。如果无法改图请联系小店客服</span>
              </p>
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
              locked={customerLocked}
              busy={loading}
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
                locked={customerLocked}
                busy={loading}
              />
            )}
          </div>
          <label className="group-quantity">
            <span>本组数量 <small>（相同图片印几本）</small></span>
            <input
              type="number"
              inputMode="numeric"
              min="1"
              step="1"
              value={activeGroup.quantity}
              disabled={customerLocked || loading}
              onChange={(event) => {
                const quantity = event.target.value === '' ? '' : Number(event.target.value);
                setGroups((current) => current.map((group) => group.id === activeGroup.id ? { ...group, quantity } : group));
                setError('');
              }}
            />
          </label>
          {groups.length > 1 && <p className="group-total">共 {groups.length} 组，合计 {totalQuantity} 本</p>}
          <button className="primary-button submit-button" onClick={submit} disabled={loading || customerLocked}>
            {customerLocked ? '制作中，无法修改' : loading ? '提交中...' : '确认提交'}
          </button>
          {message && <p className="success-text">{message}</p>}
          {error && <p className="error-box">{error}</p>}
        </section>
      )}
      {!selectedTemplate && error && <p className="error-box">{error}</p>}
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
      <IcpFooter />
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
  const imageSource = slug === 'one_image' ? notebookOneIcon : notebookTwoIcon;
  return (
    <span className={`template-visual ${slug || 'default'}-visual`} aria-hidden="true">
      <img className="template-visual-image" src={imageSource} alt="" />
      <span className="template-visual-count">{imageCount}</span>
    </span>
  );
}

function ImagePicker({ label, side, image, required, onChange, onEdit, editingSide, locked = false, busy = false }) {
  return (
    <div className="image-picker">
      <div className="picker-title">{label}{required && <em>必传</em>}</div>
      <div className="image-mount">
        <div
          className={`image-preview ${image.url ? 'has-image' : ''}${locked ? ' locked' : ''}`}
          role={image.url && !locked ? 'button' : undefined}
          tabIndex={image.url && !locked ? 0 : undefined}
          onClick={() => image.url && !locked && !busy && onEdit(side)}
          onKeyDown={(event) => {
            if (image.url && !locked && !busy && (event.key === 'Enter' || event.key === ' ')) onEdit(side);
          }}
          aria-label={image.url ? (locked ? `${label}，制作中，图片已锁定` : `${label}，点击调整图片`) : undefined}
        >
          {image.url ? (
            <img src={image.url} alt={label} />
          ) : locked ? (
            <div className="empty-image-picker locked">
              <span>制作中，不能上传</span>
            </div>
          ) : (
            <label className="empty-image-picker">
              <span>{image.loading ? '正在读取之前的图片...' : '点击选择图片'}</span>
              <input type="file" accept="image/jpeg,image/png,image/webp" disabled={busy} onChange={(event) => onChange(side, event)} />
            </label>
          )}
        </div>
      </div>
      <span className="image-edit-hint" aria-hidden={!image.url}>
        {image.url && (locked ? '制作中，图片已锁定' : editingSide === side ? '正在打开编辑器...' : '点击调整图片')}
      </span>
    </div>
  );
}
