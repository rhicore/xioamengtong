import os
import shutil
from fastapi import FastAPI, UploadFile, File, HTTPException, status
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel
from typing import Optional, Any

app = FastAPI(title="Library Capture System API")

# 1. 挂载静态资源：让前端能访问上传后的图片
if not os.path.exists("uploads"):
    os.makedirs("uploads")
app.mount("/static", StaticFiles(directory="uploads"), name="static")

# 2. 跨域配置
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173"],
    allow_methods=["*"],
    allow_headers=["*"],
)

# --- 3. 定义基本 API Schema (契约) ---

class BaseResponse(BaseModel):
    """最基础的响应结构"""
    code: int = 200
    message: str = "success"
    data: Optional[Any] = None

class OrderStatusData(BaseModel):
    """订单状况的具体数据结构"""
    order_id: str
    is_valid: bool
    is_uploaded: bool
    front_url: Optional[str] = None
    back_url: Optional[str] = None

# --- 4. 业务接口逻辑 ---

@app.get("/api/orders/{order_id}", response_model=BaseResponse)
async def get_order_status(order_id: str):
    """
    逻辑：前端查询订单号状况
    回复：统一 BaseResponse 结构
    """
    # 模拟数据库查询逻辑
    # =======================================
    if order_id != "1":
        # 即使报错，我们也返回符合 Schema 的 JSON，并配合 HTTP 状态码
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail={"code": 404, "message": "订单不存在", "data": None}
        )
    # =======================================



    # 检查物理文件是否存在来判断“状况”
    front_file = f"uploads/{order_id}_front.jpg"
    back_file = f"uploads/{order_id}_back.jpg"
    is_uploaded = os.path.exists(front_file) and os.path.exists(back_file)

    data = OrderStatusData(
        order_id=order_id,
        is_valid=True,
        is_uploaded=is_uploaded,
        front_url=f"/static/{order_id}_front.jpg" if is_uploaded else None,
        back_url=f"/static/{order_id}_back.jpg" if is_uploaded else None
    )

    return BaseResponse(data=data)

@app.post("/api/orders/{order_id}/upload", response_model=BaseResponse)
async def upload_order_images(
    order_id: str,
    front: UploadFile = File(...),
    back: UploadFile = File(...)
):
    """
    逻辑：前端上传图片
    回复：后端告知结果
    """
    try:
        # 文件存储逻辑
        for img, suffix in [(front, "front"), (back, "back")]:
            file_path = f"uploads/{order_id}_{suffix}.jpg"
            with open(file_path, "wb") as buffer:
                shutil.copyfileobj(img.file, buffer)
        
        return BaseResponse(message=f"Order {order_id} uploaded successfully")
    
    except Exception as e:
        return BaseResponse(code=500, message=f"Upload failed: {str(e)}")

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)