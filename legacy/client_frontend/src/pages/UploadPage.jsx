import React, { useState } from 'react';
import { useParams, useLocation, useNavigate } from 'react-router-dom';
import Cropper from 'react-easy-crop';
import { Upload, Loader2, ChevronLeft, ArrowRight } from 'lucide-react';
import { getCroppedImg } from '../utils/cropImage';
import { uploadOrderImages } from '../api/order';

const API_BASE = `http://${window.location.hostname}:8000`;

export default function UploadPage() {
  const { orderId } = useParams();
  const { state } = useLocation();
  const navigate = useNavigate();

  const orderData = state?.orderData;
  const requiresBack = orderData?.image_count === 2;
  // 1. 初始化状态：回显逻辑
  const [images, setImages] = useState({
    front: orderData?.front_url ? `${API_BASE}${orderData.front_url}` : null,
    back: orderData?.back_url ? `${API_BASE}${orderData.back_url}` : null
  });

  const [submitting, setSubmitting] = useState(false);
  const [cropState, setCropState] = useState({
    src: null,
    side: null,
    crop: { x: 0, y: 0 },
    zoom: 1,
    pixelCrop: null
  });

  // 处理文件选择并打开裁剪器
  const onFileChange = (e, side) => {
    if (e.target.files?.length > 0) {
      const reader = new FileReader();
      reader.readAsDataURL(e.target.files[0]);
      reader.onload = () => {
        setCropState({
          src: reader.result,
          side,
          crop: { x: 0, y: 0 },
          zoom: 1,
          pixelCrop: null
        });
      };
    }
    e.target.value = null;
  };

  // 保存裁剪后的 Base64 到状态
  const saveCrop = async () => {
    try {
      const croppedBase64 = await getCroppedImg(cropState.src, cropState.pixelCrop);
      setImages(prev => ({ ...prev, [cropState.side]: croppedBase64 }));
      setCropState(prev => ({ ...prev, src: null }));
    } catch (err) {
      console.error("裁剪失败:", err);
    }
  };

  // 核心：强制将当前显示的任何内容（URL 或 Base64）转换为 Blob
  const convertToBlob = async (source) => {
    if (!source) return null;
    try {
      const resp = await fetch(source);
      return await resp.blob();
    } catch (err) {
      console.error("图片转换失败:", err);
      return null;
    }
  };

  // 提交逻辑：不做任何“未修改”拦截，直接覆盖上传
  const handleSubmit = async () => {
    setSubmitting(true);
    try {
      const frontBlob = await convertToBlob(images.front);
      const backBlob = requiresBack ? await convertToBlob(images.back) : null;

      // 移除了 !frontBlob 的报错拦截，即使全是 null 也允许提交给后端
      await uploadOrderImages(orderId, frontBlob, backBlob);
      
      alert("保存成功！");
      navigate('/');
    } catch (err) {
      alert(`操作失败: ${err.message}`);
    } finally {
      setSubmitting(false);
    }
  };

  if (!orderData) return <div className="p-10 text-center text-gray-500">数据丢失，请返回首页重新进入</div>;

  return (
    <div className="min-h-screen bg-gray-50 pb-32">
      {/* 顶部状态栏 */}
      <div className="bg-white p-4 border-b flex items-center gap-4 sticky top-0 z-20">
        <button onClick={() => navigate(-1)} className="p-2 hover:bg-gray-100 rounded-full transition-colors">
          <ChevronLeft />
        </button>
        <div>
          {/* 修正：使用 display_name 显示中文 */}
          <h2 className="font-bold text-lg">{orderData.display_name}</h2>
          <div className="flex items-center gap-2">
            <span className={`w-2 h-2 rounded-full ${orderData.status === 'completed' ? 'bg-green-500' : 'bg-orange-500'}`}></span>
            <p className="text-xs text-gray-500">订单号: {orderId} | {orderData.status === 'completed' ? '已上传 (可覆盖修改)' : '待上传'}</p>
          </div>
        </div>
      </div>

      <div className="p-6 max-w-md mx-auto space-y-8">
        <UploadCard 
          label={requiresBack ? "前封面 (Front)" : "定制图片"}
          image={images.front}
          onFileSelect={(e) => onFileChange(e, 'front')}
        />

        {requiresBack && (
          <UploadCard 
            label="后封底 (Back)"
            image={images.back}
            onFileSelect={(e) => onFileChange(e, 'back')}
          />
        )}
      </div>

      {/* 底部固定操作栏 */}
      <div className="fixed bottom-0 left-0 right-0 p-6 bg-white border-t shadow-[0_-4px_20px_rgba(0,0,0,0.05)]">
        <button
          onClick={handleSubmit}
          // 修正：取消对 images 是否存在的限制，仅在提交中时禁用
          disabled={submitting}
          className={`w-full h-14 rounded-2xl font-bold flex items-center justify-center gap-2 transition-all active:scale-[0.98]
            ${submitting ? 'bg-gray-100 text-gray-400 cursor-not-allowed' : 'bg-black text-white shadow-xl'}`}
        >
          {submitting ? <Loader2 className="animate-spin" /> : <>确认并保存 <ArrowRight size={20} /></>}
        </button>
      </div>

      {/* 裁剪模态层 */}
      {cropState.src && (
        <div className="fixed inset-0 z-50 bg-black flex flex-col">
          <div className="relative flex-1">
            <Cropper
              image={cropState.src}
              crop={cropState.crop}
              zoom={cropState.zoom}
              aspect={3 / 4} // 强制 3:4 比例
              onCropChange={(c) => setCropState(p => ({...p, crop: c}))}
              onZoomChange={(z) => setCropState(p => ({...p, zoom: z}))}
              onCropComplete={(_, px) => setCropState(p => ({...p, pixelCrop: px}))}
            />
          </div>
          <div className="bg-white p-8 flex justify-between items-center rounded-t-[2.5rem]">
            <button onClick={() => setCropState(p => ({...p, src: null}))} className="text-gray-400 font-bold px-4">取消</button>
            <span className="text-sm font-black tracking-widest text-gray-300 uppercase">Adjust Image</span>
            <button onClick={saveCrop} className="bg-blue-600 text-white px-10 py-3 rounded-full font-bold shadow-lg">确认裁剪</button>
          </div>
        </div>
      )}
    </div>
  );
}

function UploadCard({ label, image, onFileSelect }) {
  return (
    <div className="space-y-3">
      <div className="flex justify-between items-center px-1">
        <p className="text-sm font-bold text-gray-700">{label}</p>
        {image && <span className="text-[10px] bg-green-100 text-green-600 px-2 py-0.5 rounded-full font-bold">READY</span>}
      </div>
      <div className="relative aspect-[3/4] w-full bg-white rounded-[2rem] border-2 border-dashed border-gray-200 overflow-hidden flex flex-col items-center justify-center group hover:border-black transition-all">
        {image ? (
          <img src={image} className="w-full h-full object-cover" alt="Preview" />
        ) : (
          <div className="flex flex-col items-center">
            <div className="w-12 h-12 bg-gray-50 rounded-full flex items-center justify-center mb-3">
              <Upload className="text-gray-400" size={24} />
            </div>
            <span className="text-xs text-gray-400 font-bold">点击或拖拽上传图片</span>
          </div>
        )}
        <input 
          type="file" 
          accept="image/*" 
          onChange={onFileSelect}
          className="absolute inset-0 w-full h-full opacity-0 cursor-pointer z-10"
        />
      </div>
    </div>
  );
}