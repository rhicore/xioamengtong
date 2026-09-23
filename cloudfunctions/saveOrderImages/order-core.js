const DEFAULT_TEMPLATES = [
  { slug: 'jiaotao', display_name: '胶套本 A5/B5', image_count: 2, aspect_ratio: '3:4', allow_blank: true, description: '前封面、后封底各 1 张；不上传时按空白处理' },
  { slug: 'chexian', display_name: '车线本 A5/B5', image_count: 2, aspect_ratio: '3:4', allow_blank: true, description: '前封面、后封底各 1 张；不上传时按空白处理' },
  { slug: 'huoye', display_name: '活页本 A5/B5', image_count: 1, aspect_ratio: '3:4', allow_blank: false, description: '上传 1 张封面图' }
];
const DEFAULT_TEMPLATE = DEFAULT_TEMPLATES[2];
function normalizeOrderId(value) {
  const orderId = String(value || '').trim();
  if (!orderId || orderId.length > 64) throw new Error('订单号不能为空且长度不能超过 64 位');
  return orderId;
}
function normalizeTemplate(template = {}) {
  return {
    slug: template.slug || DEFAULT_TEMPLATE.slug,
    display_name: template.display_name || DEFAULT_TEMPLATE.display_name,
    image_count: Number(template.image_count) || DEFAULT_TEMPLATE.image_count,
    aspect_ratio: template.aspect_ratio || DEFAULT_TEMPLATE.aspect_ratio,
    allow_blank: template.allow_blank !== false,
    description: template.description || ''
  };
}
function getDefaultTemplates() { return DEFAULT_TEMPLATES.map((template) => Object.assign({}, template)); }
module.exports = { DEFAULT_TEMPLATE, DEFAULT_TEMPLATES, normalizeOrderId, normalizeTemplate, getDefaultTemplates };
