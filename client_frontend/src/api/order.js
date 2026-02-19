// 动态获取当前访问页面的 IP 地址
const API_HOST = `http://${window.location.hostname}:8000`;
const BASE_URL = `${API_HOST}/api/v1`;

/**
 * 提取订单详情 (GET)
 */
export async function fetchOrderDetails(orderId) {
  try {
    const response = await fetch(`${BASE_URL}/orders/${orderId}`, {
      method: 'GET',
      headers: { 'Content-Type': 'application/json' },
    });
    
    const result = await response.json();
    
    if (result.code === 200) {
      return result.data;
    } else {
      throw new Error(result.message || '查询失败，订单可能不存在');
    }
  } catch (error) {
    throw new Error(error.message || '网络连接中断');
  }
}

/**
 * 提交裁剪图像 (POST)
 */
export const uploadOrderImages = async (orderId, frontBlob, backBlob) => {
    const formData = new FormData();
    if (frontBlob) formData.append('front', frontBlob);
    if (backBlob) formData.append('back', backBlob);

    // 统一使用 BASE_URL
    const response = await fetch(`${BASE_URL}/orders/${orderId}/images`, {
        method: 'POST',
        body: formData,
    });

    if (!response.ok) {
        throw new Error(`网络请求失败: ${response.status}`);
    }

    const resData = await response.json();

    if (resData.code !== 200) {
        throw new Error(resData.message || "服务器处理异常");
    }

    return resData;
}