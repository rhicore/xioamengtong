from pydantic import BaseModel
from typing import Optional, Any

class BaseResponse(BaseModel):
    code: int = 200
    message: str = "success"
    data: Optional[Any] = None

class OrderInfo(BaseModel):
    order_id: str
    notebook_type: str
    quantity: int
    platform: str
    shop: str
    status: str
    front_url: Optional[str] = None
    back_url: Optional[str] = None
    
    # 扁平化注入的动态配置字段
    display_name: Optional[str] = None
    image_count: Optional[int] = None
    aspect_ratio: Optional[str] = None

    class Config:
        from_attributes = True