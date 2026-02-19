import React from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import Home from './pages/Home';
import UploadPage from './pages/UploadPage';

export default function App() {
  return (
    <BrowserRouter>
      <div className="min-h-screen bg-gray-50 font-sans text-gray-800">
        <Routes>
          {/* 首页：获取订单 */}
          <Route path="/" element={<Home />} />
          
          {/* 上传页：必须带 orderId，否则跳回首页 */}
          <Route path="/upload/:orderId" element={<UploadPage />} />
          
          {/* 404 捕获 */}
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </div>
    </BrowserRouter>
  );
}