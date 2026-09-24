const baseUrl = import.meta.env.VITE_HTTP_API_BASE_URL || '';

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
  const response = await request('/api/v1/admin/batch-download', {
    method: 'POST',
    body: JSON.stringify({ orderIds })
  });
  return { download_url: URL.createObjectURL(await response.blob()) };
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
