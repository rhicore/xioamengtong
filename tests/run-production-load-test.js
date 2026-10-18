/*
 * 轻量线上压测：只读接口，不上传图片、不创建订单。
 *
 * 用法：
 *   node tests/run-production-load-test.js https://xiaomengtong.site
 *
 * 如需测试后台订单列表，请通过环境变量提供一次性测试账号：
 *   LOAD_TEST_ADMIN_USER=admin LOAD_TEST_ADMIN_PASSWORD=*** node tests/run-production-load-test.js
 */

const baseUrl = (process.argv[2] || process.env.LOAD_TEST_BASE_URL || 'https://xiaomengtong.site')
  .replace(/\/$/, '');
const timeoutMs = Number(process.env.LOAD_TEST_TIMEOUT_MS || 15000);
const requestsPerCase = Number(process.env.LOAD_TEST_REQUESTS || 24);
const levels = (process.env.LOAD_TEST_LEVELS || '1,5,10')
  .split(',')
  .map((value) => Number(value.trim()))
  .filter((value) => Number.isInteger(value) && value > 0);

const publicCases = [
  { name: '后台静态页', path: '/' },
  { name: '顾客静态页', path: '/customer/' },
  { name: '顾客订单查询', path: '/api/v1/customer/orders/1?preview=0' },
  { name: '顾客图片地址', path: '/api/v1/customer/orders/1/images' }
];
const selectedPublicCases = process.env.LOAD_TEST_API_ONLY === '1'
  ? publicCases.filter((testCase) => testCase.path.startsWith('/api/'))
  : publicCases;

function percentile(values, ratio) {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((left, right) => left - right);
  const index = Math.min(sorted.length - 1, Math.ceil(sorted.length * ratio) - 1);
  return sorted[index];
}

async function fetchWithTimeout(path, options = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const startedAt = performance.now();
  try {
    const response = await fetch(baseUrl + path, {
      ...options,
      signal: controller.signal,
      headers: {
        'Cache-Control': 'no-cache',
        ...(options.headers || {})
      }
    });
    await response.arrayBuffer();
    return {
      ok: response.ok,
      status: response.status,
      elapsedMs: performance.now() - startedAt
    };
  } catch (error) {
    return {
      ok: false,
      status: 0,
      elapsedMs: performance.now() - startedAt,
      error: error.name === 'AbortError' ? 'timeout' : (error.code || error.message)
    };
  } finally {
    clearTimeout(timer);
  }
}

async function loginOnce() {
  const username = process.env.LOAD_TEST_ADMIN_USER;
  const password = process.env.LOAD_TEST_ADMIN_PASSWORD;
  if (!username || !password) return null;

  let lastResult = null;
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    const startedAt = performance.now();
    try {
      const response = await fetch(baseUrl + '/api/v1/admin/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password }),
        signal: controller.signal
      });
      const payload = await response.json().catch(() => ({}));
      const cookie = response.headers.get('set-cookie')?.split(';')[0] || '';
      lastResult = {
        ok: response.ok && payload.code === 200 && Boolean(cookie),
        cookie,
        elapsedMs: performance.now() - startedAt,
        status: response.status,
        message: payload.message || '',
        attempts: attempt
      };
      if (lastResult.ok || response.status >= 400) return lastResult;
    } catch (error) {
      lastResult = {
        ok: false,
        cookie: '',
        elapsedMs: performance.now() - startedAt,
        status: 0,
        message: error.name === 'AbortError' ? 'timeout' : (error.code || error.message),
        attempts: attempt
      };
    } finally {
      clearTimeout(timer);
    }
    await new Promise((resolve) => setTimeout(resolve, 500 * attempt));
  }
  return lastResult;
}

async function runCase(testCase, concurrency, headers = {}) {
  const results = [];
  let cursor = 0;
  const startedAt = performance.now();

  async function worker() {
    while (true) {
      const index = cursor++;
      if (index >= requestsPerCase) return;
      results[index] = await fetchWithTimeout(testCase.path, { headers });
    }
  }

  await Promise.all(Array.from({ length: concurrency }, worker));
  const durationMs = performance.now() - startedAt;
  const latencies = results.map((item) => item.elapsedMs);
  const successful = results.filter((item) => item.ok).length;
  return {
    case: testCase.name,
    concurrency,
    requests: results.length,
    success: successful,
    errors: results.length - successful,
    durationMs,
    rps: results.length / (durationMs / 1000),
    statuses: [...new Set(results.map((item) => item.status))].sort((left, right) => left - right),
    avgMs: latencies.length ? latencies.reduce((sum, value) => sum + value, 0) / latencies.length : 0,
    p50Ms: percentile(latencies, 0.5),
    p95Ms: percentile(latencies, 0.95),
    maxMs: latencies.length ? Math.max(...latencies) : 0,
    errorSamples: results.filter((item) => item.error).slice(0, 3).map((item) => item.error)
  };
}

async function main() {
  console.log(JSON.stringify({
    target: baseUrl,
    timeoutMs,
    requestsPerCase,
    concurrencyLevels: levels,
    note: '只读压测，不包含上传、提交和批量下载'
  }));

  const login = await loginOnce();
  if (login) {
    console.log(JSON.stringify({
      case: '后台登录预热',
      ok: login.ok,
      status: login.status,
      elapsedMs: Math.round(login.elapsedMs),
      message: login.message
    }));
  }

  const adminCases = login?.ok
    ? [{ name: '后台订单列表', path: '/api/v1/admin/orders?page=1&pageSize=20&preview=0' }]
    : [];
  const cases = [...selectedPublicCases, ...adminCases];
  for (const concurrency of levels) {
    for (const testCase of cases) {
      const headers = testCase.name === '后台订单列表' ? { Cookie: login.cookie } : {};
      const result = await runCase(testCase, concurrency, headers);
      console.log(JSON.stringify({
        ...result,
        durationMs: Math.round(result.durationMs),
        rps: Number(result.rps.toFixed(2)),
        avgMs: Math.round(result.avgMs),
        p50Ms: Math.round(result.p50Ms),
        p95Ms: Math.round(result.p95Ms),
        maxMs: Math.round(result.maxMs)
      }));
    }
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
