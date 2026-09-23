const PLATFORM_RULES = [
  { platform: '拼多多', pattern: /^\d{6}-\d{15}$/ },
  { platform: '拼多多', pattern: /^DD[A-Z0-9]{14,18}$/i },
  { platform: '淘宝/天猫', pattern: /^\d{18}$/ },
  { platform: '京东', pattern: /^\d{15,17}$/ }
];

export function detectPlatform(orderId) {
  const normalized = String(orderId || '').trim();
  return PLATFORM_RULES.find((rule) => rule.pattern.test(normalized))?.platform || '';
}
