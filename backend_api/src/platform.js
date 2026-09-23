const PLATFORM_RULES = [
  {
    platform: '拼多多',
    confidence: 'high',
    pattern: /^\d{6}-\d{15}$/,
    reason: '符合常见的日期段-流水号格式'
  },
  {
    platform: '拼多多',
    confidence: 'medium',
    pattern: /^DD[A-Z0-9]{14,18}$/i,
    reason: '符合拼多多订单号常见字母前缀格式'
  },
  {
    platform: '淘宝/天猫',
    confidence: 'low',
    pattern: /^\d{18}$/,
    reason: '符合淘宝/天猫常见的 18 位纯数字格式，但该格式并非官方唯一标识'
  },
  {
    platform: '京东',
    confidence: 'low',
    pattern: /^\d{15,17}$/,
    reason: '符合京东常见的 15-17 位纯数字格式，但该格式并非官方唯一标识'
  }
];

function detectPlatform(orderId) {
  const normalized = String(orderId || '').trim();
  const matched = PLATFORM_RULES.find((rule) => rule.pattern.test(normalized));
  if (matched) {
    return {
      platform: matched.platform,
      confidence: matched.confidence,
      reason: matched.reason
    };
  }
  return {
    platform: '',
    confidence: 'none',
    reason: '订单号格式不足以唯一判断平台'
  };
}

module.exports = { detectPlatform };
