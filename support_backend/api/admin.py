import zipfile
from io import BytesIO
from pathlib import Path
from typing import List, Optional
from fastapi import APIRouter, Depends, Query, HTTPException
from fastapi.responses import StreamingResponse
from sqlalchemy.orm import Session

from ..core.database import get_db
from ..core.config_loader import get_template_by_slug
from ..models import Order

router = APIRouter(prefix="/api/v1/admin")

@router.get("/orders")
def list_orders(
    current: int = 1,
    pageSize: int = 20,
    db: Session = Depends(get_db),
    # 动态筛选参数
    order_id: Optional[str] = None,
    platform: Optional[str] = None,
    shop: Optional[str] = None,
    notebook_type: Optional[str] = None,
    status: Optional[str] = None
):
    query = db.query(Order)
    
    # 自动筛选逻辑
    filters = {
        "order_id": order_id, 
        "platform": platform, 
        "shop": shop, 
        "notebook_type": notebook_type,
        "status": status
    }
    
    for field, value in filters.items():
        if value:
            query = query.filter(getattr(Order, field).contains(value))

    total = query.count()
    orders = query.order_by(Order.order_id.desc()).offset((current - 1) * pageSize).limit(pageSize).all()

    # 扁平化处理：将 config 里的 display_name 直接塞入返回结果
    result_data = []
    for o in orders:
        temp = o.__dict__.copy()
        conf = get_template_by_slug(o.notebook_type)
        temp["display_name"] = conf.get("display_name", "未知")
        temp["image_count"] = conf.get("image_count", 1)
        result_data.append(temp)

    return {"data": result_data, "total": total, "success": True}

@router.post("/batch-download")
async def batch_download(order_ids: List[str], db: Session = Depends(get_db)):
    """核心：按照 客服规则 命名并打包"""
    orders = db.query(Order).filter(Order.order_id.in_(order_ids)).all()
    
    zip_buffer = BytesIO()
    image_base = Path(__file__).resolve().parent.parent.parent / "data" / "images"

    with zipfile.ZipFile(zip_buffer, "a", zipfile.ZIP_DEFLATED) as zip_f:
        for order in orders:
            # 获取该类型的中文名称用于文件名
            conf = get_template_by_slug(order.notebook_type)
            display_name = conf.get("display_name", order.notebook_type)
            
            for side in ["front", "back"]:
                img_path = getattr(order, f"{side}_image")
                if img_path:
                    full_p = image_base / img_path
                    if full_p.exists():
                        # 最终命名：胶套本-淘宝-某某店-1-front-备注.jpg
                        ext = full_p.suffix
                        safe_remark = (order.remark or "").strip()
                        file_name = f"{display_name}-{order.platform}-{order.shop}-{order.order_id}-{side}-{safe_remark}{ext}"
                        zip_f.write(full_p, arcname=file_name)

    zip_buffer.seek(0)
    return StreamingResponse(
        zip_buffer,
        media_type="application/x-zip-compressed",
        headers={"Content-Disposition": "attachment; filename=service_export.zip"}
    )