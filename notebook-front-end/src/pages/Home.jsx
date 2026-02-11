import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { Search, Loader2, AlertCircle, ChevronRight } from 'lucide-react';

export default function Home() {
  const navigate = useNavigate();
  
  // 状态管理
  const [orderId, setOrderId] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [showError, setShowError] = useState(false);

  // 处理输入变化
  const handleInputChange = (e) => {
    setOrderId(e.target.value);
    if (showError) setShowError(false); // 用户重新输入时隐藏错误
  };

  // 核心逻辑：模拟查询
  const handleCheckOrder = (e) => {
    e.preventDefault(); // 防止表单默认提交
    
    if (!orderId.trim()) return;

    setIsLoading(true);
    setShowError(false);

    // 模拟网络请求延迟 800ms
    setTimeout(() => {
      // === 模拟后端逻辑 ===
      if (orderId.trim() === '1') {
        // 成功：跳转到上传页
        navigate(`/upload/${orderId}`);
      } else {
        // 失败：显示错误弹窗
        setShowError(true);
        setIsLoading(false);
      }
    }, 800);
  };

  return (
    <div className="min-h-screen bg-[#FDFDFD] flex flex-col px-6 font-sans text-gray-900 relative overflow-hidden">
      
      {/* 装饰性背景圆 (营造氛围感) */}
      <div className="absolute top-[-10%] right-[-10%] w-64 h-64 bg-blue-50 rounded-full blur-3xl opacity-60 pointer-events-none"></div>
      
      {/* 1. 顶部区域：大标题 */}
      <div className="mt-24 mb-12 animate-fade-in-up">
        <h1 className="text-4xl font-extrabold tracking-tight mb-3 text-gray-900">
          订单检索.
        </h1>
        <p className="text-gray-500 text-lg font-medium leading-relaxed">
          请输入您的数字化采集<br />
          任务编号以开始工作。
        </p>
      </div>

      {/* 2. 核心表单区域 */}
      <form onSubmit={handleCheckOrder} className="w-full max-w-sm space-y-6 animate-fade-in-up delay-100">
        
        {/* 输入框容器 */}
        <div className="group relative">
          <div className="absolute left-4 top-1/2 -translate-y-1/2 text-gray-400 transition-colors group-focus-within:text-blue-600">
            <Search className="w-6 h-6" />
          </div>
          <input
            type="text" // 也可以用 text 配合 inputMode="numeric"
            inputMode="numeric"
            placeholder="输入订单号 (例如: 1)"
            value={orderId}
            onChange={handleInputChange}
            className={`
              w-full h-16 pl-14 pr-4 rounded-2xl text-xl font-medium tracking-wide outline-none transition-all duration-300
              placeholder:text-gray-300
              ${showError 
                ? 'bg-red-50 text-red-900 ring-2 ring-red-100 placeholder:text-red-200' 
                : 'bg-gray-100 focus:bg-white focus:ring-2 focus:ring-blue-600/20 focus:shadow-xl focus:shadow-blue-500/10'}
            `}
          />
        </div>

        {/* 提交按钮 */}
        <button
          type="submit"
          disabled={!orderId || isLoading}
          className={`
            w-full h-16 rounded-2xl text-lg font-bold text-white flex items-center justify-center gap-2 transition-all duration-300
            ${!orderId 
              ? 'bg-gray-200 cursor-not-allowed text-gray-400' 
              : 'bg-black shadow-xl shadow-gray-200 hover:shadow-2xl hover:-translate-y-1 active:scale-95 active:translate-y-0'}
          `}
        >
          {isLoading ? (
            <Loader2 className="w-6 h-6 animate-spin text-white/80" />
          ) : (
            <>
              开始采集 <ChevronRight className="w-5 h-5 opacity-60" />
            </>
          )}
        </button>
      </form>

      {/* 3. 错误弹窗 (Toast) */}
      {/* 使用绝对定位浮动在顶部，带有简单的进入动画 */}
      <div className={`
        absolute top-6 left-6 right-6 z-50 transform transition-all duration-500 ease-out
        ${showError ? 'translate-y-0 opacity-100' : '-translate-y-24 opacity-0 pointer-events-none'}
      `}>
        <div className="bg-white/90 backdrop-blur-md border border-red-100 p-4 rounded-2xl shadow-2xl shadow-red-500/10 flex items-center gap-4">
          <div className="w-10 h-10 bg-red-50 rounded-full flex items-center justify-center flex-shrink-0">
            <AlertCircle className="w-5 h-5 text-red-500" />
          </div>
          <div>
            <h3 className="font-bold text-gray-900 text-sm">订单不存在</h3>
            <p className="text-gray-500 text-xs mt-0.5">请检查编号是否正确 (测试号: 1)</p>
          </div>
        </div>
      </div>

      {/* 底部版本号 (极简风格) */}
      <div className="mt-auto mb-8 text-center">
        <p className="text-[10px] font-mono text-gray-300 tracking-widest uppercase">
          System v2.0 &bull; Secure Access
        </p>
      </div>

    </div>
  );
}