import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { fetchOrderDetails } from '../api/order';

export default function Home() {
  const navigate = useNavigate();
  const [orderId, setOrderId] = useState('');
  const [errorMsg, setErrorMsg] = useState('');
  const [loading, setLoading] = useState(false);

  const onSubmit = async (e) => {
    e.preventDefault();
    const id = orderId.trim();
    if (!id) return;

    setLoading(true);
    setErrorMsg('');

    try {
      // 1. 获取订单详情（后端现在会返回 status 和图片 URL）
      const orderData = await fetchOrderDetails(id);
      
      // 2. 移除原有的状态拦截逻辑，直接携带数据跳转
      // 无论 orderData.status 是 'pending' 还是 'completed'，都允许进入
      navigate(`/upload/${id}`, { state: { orderData } });
      
    } catch (err) {
      // 处理 404（订单不存在）或网络异常
      setErrorMsg(err.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="p-10 max-w-md mx-auto">
      <h1 className="text-2xl font-bold mb-6">图书定制采集系统</h1>
      <form onSubmit={onSubmit} className="flex flex-col gap-4">
        <div className="flex flex-col gap-2">
          <label className="text-sm font-medium text-gray-600">订单号</label>
          <input
            type="text"
            value={orderId}
            onChange={(e) => setOrderId(e.target.value)}
            className="border p-4 rounded-xl focus:ring-2 focus:ring-black outline-none transition-all"
            placeholder="请输入订单号"
          />
        </div>
        <button 
          type="submit" 
          disabled={loading || !orderId.trim()}
          className="bg-black text-white p-4 rounded-xl font-bold active:scale-95 disabled:bg-gray-300 transition-all"
        >
          {loading ? '查询中...' : '查询订单'}
        </button>
      </form>
      {errorMsg && (
        <div className="mt-4 p-3 bg-red-50 text-red-600 rounded-lg text-sm border border-red-100">
          {errorMsg}
        </div>
      )}
    </div>
  );
}