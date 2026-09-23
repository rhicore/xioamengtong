/**
 * CloudBase/Web HTTP adapter 共用的响应协议处理。
 *
 * 业务页面只依赖 callFunction 返回的 data，未来把后端迁移到普通服务器时，
 * 只需要让 HTTP adapter 也返回同样的业务 data，不需要改页面代码。
 */
export function unwrapAuthResponse(response) {
  if (response && response.error) {
    throw new Error(response.error.message || '登录失败');
  }

  return response && response.data !== undefined ? response.data : response;
}

export function unwrapFunctionResponse(response) {
  let payload = response && response.result !== undefined ? response.result : response;

  if (typeof payload === 'string') {
    try {
      payload = JSON.parse(payload);
    } catch {
      throw new Error('云函数返回了无法解析的结果');
    }
  }

  if (!payload || typeof payload !== 'object') {
    throw new Error('云函数返回格式错误');
  }

  if (payload.code !== undefined && payload.code !== 200) {
    throw new Error(payload.message || '云函数调用失败');
  }

  return payload.data !== undefined ? payload.data : payload;
}

