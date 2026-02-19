import json
import shutil
from datetime import datetime
from pathlib import Path
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, UploadFile, File
from sqlalchemy.orm import Session

from ..database import get_db
from ..models import Order
from ..schemas import BaseResponse, OrderInfo # 必须引入 OrderConfig

router = APIRouter(prefix="/api/v1")

# 物理路径常量
IMAGE_ROOT = Path("data/images")
CONFIG_FILE = Path("backend/configs/notebook_templates.json")

# 内存缓存，防止高频读取磁盘
_CONFIG_CACHE = {}

def get_notebook_config(slug: str) -> dict:
    """根据英文 Slug 获取本册配置，带缓存和默认值降级逻辑"""
    global _CONFIG_CACHE
    if not _CONFIG_CACHE:
        # 文件不存在时的极值兜底
        if not CONFIG_FILE.exists():
            return {"display_name": "未知本册", "image_count": 1, "aspect_ratio": "3:4"}
        with open(CONFIG_FILE, "r", encoding="utf-8") as f:
            _CONFIG_CACHE = json.load(f)
    
    # 优先精确匹配 slug，匹配不到则取 default，再匹配不到则硬编码兜底
    fallback = {"display_name": "常规本册", "image_count": 1, "aspect_ratio": "3:4"}
    return _CONFIG_CACHE.get(slug, _CONFIG_CACHE.get("default", fallback))

def get_relative_date_path() -> Path:
    """仅生成日期部分的路径 (如 2026/02/19)"""
    now = datetime.now()
    return Path(now.strftime("%Y")) / now.strftime("%m") / now.strftime("%d")

@router.get("/orders/{order_id}", response_model=BaseResponse)
def get_order(order_id: str, db: Session = Depends(get_db)):
    order = db.query(Order).filter(Order.order_id == order_id).first()
    if not order:
        raise HTTPException(status_code=404, detail={"code": 404, "message": "订单不存在"})
    
    # 1. 基础数据转换
    res_data = OrderInfo.from_orm(order)
    
    # 2. 路径转换
    if order.front_image:
        res_data.front_url = f"/static/{order.front_image}"
    if order.back_image:
        res_data.back_url = f"/static/{order.back_image}"
    
    # 3. 扁平化配置注入
# 核心：使用英文 Slug 去配置表里查
    config_payload = get_notebook_config(order.notebook_type)
    
    # 修改前（引发报错的旧逻辑，如果有请删除）：
    # res_data.config = OrderConfig(**config_payload) 
    
    # 修改后（正确的扁平化赋值逻辑）：
    res_data.display_name = config_payload.get("display_name")
    res_data.image_count = config_payload.get("image_count")
    res_data.aspect_ratio = config_payload.get("aspect_ratio")
    
    return BaseResponse(data=res_data)

@router.post("/orders/{order_id}/images", response_model=BaseResponse)
async def upload_images(
    order_id: str, 
    front: Optional[UploadFile] = File(None), 
    back: Optional[UploadFile] = File(None), 
    db: Session = Depends(get_db)
):
    """保存图片：存盘用物理路径，存库用强制规范化的正斜杠相对路径"""
    order = db.query(Order).filter(Order.order_id == order_id).first()
    if not order:
        return BaseResponse(code=404, message="订单无效")

    rel_date_path = get_relative_date_path()
    
    # 物理创建目录
    full_phys_dir = IMAGE_ROOT / rel_date_path
    full_phys_dir.mkdir(parents=True, exist_ok=True)

    timestamp = int(datetime.now().timestamp())

    if front:
        filename = f"{order_id}_front_{timestamp}.jpg"
        # 物理写入：pathlib 自动处理系统斜杠
        with open(full_phys_dir / filename, "wb") as buffer:
            shutil.copyfileobj(front.file, buffer)
        # 存入数据库：使用 as_posix() 强制转换为正斜杠且不带 data/images
        order.front_image = (rel_date_path / filename).as_posix()

    if back:
        filename = f"{order_id}_back_{timestamp}.jpg"
        with open(full_phys_dir / filename, "wb") as buffer:
            shutil.copyfileobj(back.file, buffer)
        order.back_image = (rel_date_path / filename).as_posix()

    order.status = "completed"
    order.updated_at = datetime.now()
    db.commit()
    return BaseResponse(message="上传成功")