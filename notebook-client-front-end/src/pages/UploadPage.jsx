import React, { useState, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import Cropper from 'react-easy-crop';
import { Upload, ArrowRight, X, Check, Loader2, ChevronLeft } from 'lucide-react';
import { getCroppedImg } from '../utils/cropImage'; // 引入刚才抽离的工具

export default function UploadPage() {
  const { orderId } = useParams(); // 从 URL 获取订单号
  const navigate = useNavigate();

  // 状态
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [images, setImages] = useState({ front: null, back: null });
  
  // 裁剪相关
  const [cropState, setCropState] = useState({
    image: null,      // 原图
    side: null,       // 'front' | 'back'
    crop: { x: 0, y: 0 },
    zoom: 1,
    croppedAreaPixels: null
  });

  // 1. 选择文件
  const onFileChange = async (e, side) => {
    if (e.target.files && e.target.files.length > 0) {
      const file = e.target.files[0];
      const reader = new FileReader();
      reader.readAsDataURL(file);
      reader.onload = () => {
        // 选中图片后，直接进入裁剪模式
        setCropState({
          ...cropState,
          image: reader.result,
          side: side,
          crop: { x: 0, y: 0 },
          zoom: 1
        });
      };
    }
    // 清空 input 允许重复选择同一文件
    e.target.value = null; 
  };

  // 2. 保存裁剪
  const handleSaveCrop = async () => {
    try {
      const croppedImage = await getCroppedImg(cropState.image, cropState.croppedAreaPixels);
      setImages(prev => ({ ...prev, [cropState.side]: croppedImage }));
      setCropState({ ...cropState, image: null, side: null }); // 关闭裁剪窗
    } catch (e) {
      console.error(e);
    }
  };

  // 3. 提交
  const handleSubmit = () => {
    if (!images.front || !images.back) return;
    setIsSubmitting(true);
    // 模拟提交
    setTimeout(() => {
      alert(`订单 ${orderId} 上传成功！`);
      navigate('/'); // 回到首页
    }, 1500);
  };

  return (
    <div className="pb-20">
      {/* 顶部导航 */}
      <div className="bg-white px-4 py-4 shadow-sm flex items-center justify-between sticky top-0 z-10">
        <button onClick={() => navigate(-1)} className="p-2 -ml-2 text-gray-600">
          <ChevronLeft />
        </button>
        <div className="font-mono font-bold text-blue-600 bg-blue-50 px-3 py-1 rounded">
          {orderId}
        </div>
        <div className="w-8"></div> {/* 占位，保持标题居中 */}
      </div>

      <div className="p-5 max-w-md mx-auto space-y-6 mt-2">
        {/* 上传区域 */}
        <UploadCard 
          label="前封面 (Front)" 
          image={images.front} 
          onChange={(e) => onFileChange(e, 'front')} 
        />
        
        <UploadCard 
          label="后封底 (Back)" 
          image={images.back} 
          onChange={(e) => onFileChange(e, 'back')} 
        />
      </div>

      {/* 底部提交栏 */}
      <div className="fixed bottom-0 left-0 right-0 p-4 bg-white border-t border-gray-100 safe-area-pb">
        <button 
          onClick={handleSubmit}
          disabled={!images.front || !images.back || isSubmitting}
          className={`w-full max-w-md mx-auto py-4 rounded-xl font-bold shadow-lg transition-all flex items-center justify-center gap-2
            ${(!images.front || !images.back) 
              ? 'bg-gray-100 text-gray-400 cursor-not-allowed' 
              : 'bg-green-600 text-white shadow-green-600/30 active:scale-95'}`}
        >
          {isSubmitting ? <Loader2 className="animate-spin w-5 h-5" /> : (
            <>确认上传 <ArrowRight className="w-5 h-5" /></>
          )}
        </button>
      </div>

      {/* 全屏裁剪 Modal */}
      {cropState.image && (
        <div className="fixed inset-0 z-50 bg-black flex flex-col animate-fade-in">
          <div className="relative flex-1 bg-black">
            <Cropper
              image={cropState.image}
              crop={cropState.crop}
              zoom={cropState.zoom}
              aspect={3 / 4}
              onCropChange={(location) => setCropState(prev => ({ ...prev, crop: location }))}
              onZoomChange={(zoom) => setCropState(prev => ({ ...prev, zoom: zoom }))}
              onCropComplete={(_, pixels) => setCropState(prev => ({ ...prev, croppedAreaPixels: pixels }))}
            />
          </div>
          <div className="bg-white px-6 py-6 pb-10 flex items-center justify-between rounded-t-3xl">
             <button 
                onClick={() => setCropState({ ...cropState, image: null })} 
                className="p-3 rounded-full bg-gray-100 text-gray-600 hover:bg-red-50 hover:text-red-500 transition-colors"
              >
                <X className="w-6 h-6" />
             </button>
             <span className="font-bold text-gray-900">
               调整{cropState.side === 'front' ? '封面' : '封底'}
             </span>
             <button 
                onClick={handleSaveCrop} 
                className="p-3 rounded-full bg-blue-600 text-white shadow-lg shadow-blue-600/30 active:scale-90 transition-transform"
              >
                <Check className="w-6 h-6" />
             </button>
          </div>
        </div>
      )}
    </div>
  );
}

// 抽取的小组件
function UploadCard({ label, image, onChange }) {
  return (
    <div className="relative w-full aspect-[3/4] bg-white rounded-2xl border-2 border-dashed border-gray-200 overflow-hidden group">
      {image ? (
        <>
          <img src={image} className="w-full h-full object-cover" alt="preview" />
          <div className="absolute inset-0 bg-black/50 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
            <span className="text-white text-sm font-medium border border-white/40 px-3 py-1 rounded-full">点击修改</span>
          </div>
        </>
      ) : (
        <div className="absolute inset-0 flex flex-col items-center justify-center text-gray-400">
          <Upload className="w-8 h-8 mb-2 text-gray-300" />
          <span className="text-sm font-medium">{label}</span>
        </div>
      )}
      <input 
        type="file" 
        accept="image/*" 
        className="absolute inset-0 w-full h-full opacity-0 cursor-pointer z-10"
        onChange={onChange}
      />
    </div>
  );
}