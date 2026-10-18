// 生产环境与静态网页使用同一个自定义域名，必须走同源 /api，
import { strToU8, zipSync } from 'fflate';

// 不能把本地 .env.local 中的临时 CloudBase Run 域名打进生产包。
const baseUrl = import.meta.env.PROD
  ? ''
  : (import.meta.env.VITE_HTTP_API_BASE_URL || '');

async function request(path, options = {}) {
  const response = await fetch(`${baseUrl}${path}`, {
    ...options,
    credentials: 'include',
    headers: {
      'Content-Type': 'application/json',
      ...(options.headers || {})
    }
  });

  if (!response.ok) {
    let message = `后台请求失败（${response.status}）`;
    try {
      const payload = await response.clone().json();
      message = payload.message || payload.error || message;
    } catch {
      // 非 JSON 错误响应使用默认提示。
    }
    const error = new Error(message);
    error.status = response.status;
    throw error;
  }
  return response;
}

async function readData(response) {
  const payload = await response.json();
  if (payload.code !== undefined && payload.code !== 200) {
    throw new Error(payload.message || '后台请求失败');
  }
  return payload.data !== undefined ? payload.data : payload;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function fetchBinaryWithRetry(url) {
  let lastError;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 60 * 1000);
    try {
      const response = await fetch(url, {
        credentials: 'omit',
        cache: 'no-store',
        signal: controller.signal
      });
      if (!response.ok) throw new Error(`图片下载失败（${response.status}）`);
      return new Uint8Array(await response.arrayBuffer());
    } catch (error) {
      lastError = error;
      if (attempt < 2) await sleep(250 * (attempt + 1));
    } finally {
      clearTimeout(timeout);
    }
  }
  throw lastError || new Error('图片下载失败');
}

async function mapWithConcurrency(items, limit, mapper) {
  const results = new Array(items.length);
  let cursor = 0;
  async function worker() {
    while (cursor < items.length) {
      const index = cursor;
      cursor += 1;
      results[index] = await mapper(items[index], index);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return results;
}

export async function signIn(username, password) {
  return readData(await request('/api/v1/admin/login', {
    method: 'POST',
    body: JSON.stringify({ username, password })
  }));
}

export async function signOut() {
  await request('/api/v1/admin/logout', { method: 'POST' });
}

export async function getCurrentUser() {
  try {
    return await readData(await request('/api/v1/admin/me'));
  } catch (error) {
    if (error.status === 401 || /401|登录|会话/.test(error.message)) return null;
    throw error;
  }
}

export async function listOrders(filters = {}, options = {}) {
  const params = { ...filters };
  if (options.preview === false) params.preview = '0';
  const query = new URLSearchParams(params).toString();
  const response = await request(`/api/v1/admin/orders?${query}`);
  return readData(response);
}

export async function getOrderPreviews(orderIds = []) {
  return readData(await request('/api/v1/admin/order-previews', {
    method: 'POST',
    body: JSON.stringify({ orderIds })
  }));
}

export async function batchDownload(orderIds = []) {
  if (import.meta.env.PROD) {
    try {
      const manifest = await readData(await request('/api/v1/admin/batch-download-manifest', {
        method: 'POST',
        body: JSON.stringify({ orderIds })
      }));
      const binaryEntries = await mapWithConcurrency(
        manifest.entries.filter((entry) => entry.url),
        6,
        async (entry) => ({ name: entry.name, content: await fetchBinaryWithRetry(entry.url) })
      );
      const files = {};
      manifest.entries
        .filter((entry) => entry.content !== undefined)
        .forEach((entry) => { files[entry.name] = strToU8(entry.content); });
      binaryEntries.forEach((entry) => { files[entry.name] = entry.content; });
      const archive = zipSync(files, { level: 0 });
      return {
        download_url: URL.createObjectURL(new Blob([archive], { type: 'application/zip' })),
        client_generated: true
      };
    } catch (error) {
      if (error.status === 400 || error.status === 401 || error.status === 403) throw error;
      const query = new URLSearchParams();
      orderIds.forEach((orderId) => query.append('orderIds', String(orderId)));
      return {
        download_url: `${baseUrl}/api/v1/admin/batch-download?${query.toString()}`,
        fallback: true
      };
    }
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 10 * 60 * 1000);
  try {
    const response = await request('/api/v1/admin/batch-download', {
      method: 'POST',
      body: JSON.stringify({ orderIds }),
      signal: controller.signal
    });
    return { download_url: URL.createObjectURL(await response.blob()) };
  } catch (error) {
    if (error.name === 'AbortError') throw new Error('批量下载等待超时，请减少一次下载的订单数量后重试');
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

export async function updateOrdersStatus(orderIds = [], status) {
  return readData(await request('/api/v1/admin/orders/status', {
    method: 'PATCH',
    body: JSON.stringify({ orderIds, status })
  }));
}

export async function markOrdersInProduction(orderIds = []) {
  return updateOrdersStatus(orderIds, 'in_production');
}

export async function markOrdersCompleted(orderIds = []) {
  return updateOrdersStatus(orderIds, 'completed');
}

export async function deleteOrders(orderIds = []) {
  return readData(await request('/api/v1/admin/orders', {
    method: 'DELETE',
    body: JSON.stringify({ orderIds })
  }));
}

export async function listAccounts() {
  return readData(await request('/api/v1/admin/accounts'));
}

export async function createAccount(data) {
  return readData(await request('/api/v1/admin/accounts', {
    method: 'POST',
    body: JSON.stringify(data)
  }));
}

export async function updateAccount(id, data) {
  return readData(await request(`/api/v1/admin/accounts/${encodeURIComponent(id)}`, {
    method: 'PATCH',
    body: JSON.stringify(data)
  }));
}
