function parseDate(value) {
  if (!value) return null;
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value;

  if (typeof value === 'object') {
    if (value.$date) return parseDate(value.$date);
    if (typeof value.toDate === 'function') return parseDate(value.toDate());
    if (typeof value.seconds === 'number') return new Date(value.seconds * 1000);
    if (typeof value._seconds === 'number') return new Date(value._seconds * 1000);
  }

  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function pad(value) {
  return String(value).padStart(2, '0');
}

function dateKey(date) {
  return `${date.getFullYear()}-${date.getMonth()}-${date.getDate()}`;
}

function startOfDay(date) {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
}

function timePart(date) {
  return `${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

/**
 * 用后台人员更容易理解的相对时间展示订单时间。
 * 允许传入 Date、ISO 字符串以及 CloudBase 常见的日期对象。
 */
export function formatRelativeTime(value, now = new Date()) {
  const date = parseDate(value);
  const current = parseDate(now) || new Date();
  if (!date) return '—';

  const diffMs = current.getTime() - date.getTime();
  if (diffMs < 60 * 1000) return '刚刚';
  if (diffMs < 60 * 60 * 1000) return `${Math.floor(diffMs / (60 * 1000))}分钟前`;

  const today = dateKey(current);
  const orderDay = dateKey(date);
  if (today === orderDay) return `今天 ${timePart(date)}`;

  const dayDiff = Math.floor((startOfDay(current) - startOfDay(date)) / (24 * 60 * 60 * 1000));
  if (dayDiff === 1) return `昨天 ${timePart(date)}`;
  if (dayDiff > 1 && dayDiff < 7) return `${dayDiff}天前`;
  if (current.getFullYear() === date.getFullYear()) return `${date.getMonth() + 1}月${date.getDate()}日`;
  return `${date.getFullYear()}年${date.getMonth() + 1}月${date.getDate()}日`;
}

export function getOrderUploadTime(order) {
  return order?.submitted_at || order?.created_at;
}

export function getOrderUpdatedTime(order) {
  return order?.updated_at || order?.submitted_at || order?.created_at;
}
