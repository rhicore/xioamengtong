const baseUrl = (import.meta.env.VITE_API_BASE_URL || '').replace(/\/$/, '');

async function readResponse(response) {
  let payload = {};
  try {
    payload = await response.json();
  } catch {
    // 使用统一错误提示。
  }
  if (!response.ok || (payload.code !== undefined && payload.code !== 200)) {
    throw new Error(payload.message || `请求失败（${response.status}）`);
  }
  return payload.data !== undefined ? payload.data : payload;
}

export async function getOrder(orderId, options = {}) {
  const { preview = true, ...fetchOptions } = options;
  const query = preview === false ? '?preview=0' : '';
  const response = await fetch(
    `${baseUrl}/api/v1/customer/orders/${encodeURIComponent(orderId)}${query}`,
    fetchOptions
  );
  return readResponse(response);
}

export async function uploadImages(orderId, files, options = {}) {
  const formData = new FormData();
  if (files.front) formData.append('front', files.front, files.front.name);
  if (files.back) formData.append('back', files.back, files.back.name);
  const query = options.preview === false ? '?preview=0' : '';
  const response = await fetch(`${baseUrl}/api/v1/customer/orders/${encodeURIComponent(orderId)}/images${query}`, {
    method: 'POST',
    body: formData
  });
  return readResponse(response);
}

export async function getImageBlobUrl(orderId, side) {
  const response = await fetch(
    `${baseUrl}/api/v1/customer/orders/${encodeURIComponent(orderId)}/images/${encodeURIComponent(side)}`
  );
  if (!response.ok) {
    let message = `图片读取失败（${response.status}）`;
    try {
      const payload = await response.json();
      message = payload.message || message;
    } catch {
      // 使用统一错误提示。
    }
    throw new Error(message);
  }
  return URL.createObjectURL(await response.blob());
}

export async function getImagePreviewUrls(orderId) {
  const response = await fetch(
    `${baseUrl}/api/v1/customer/orders/${encodeURIComponent(orderId)}/images`
  );
  return readResponse(response);
}

export async function submitOrder(orderId, data) {
  const response = await fetch(`${baseUrl}/api/v1/customer/orders/${encodeURIComponent(orderId)}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data)
  });
  return readResponse(response);
}
