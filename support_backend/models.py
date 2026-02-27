# 数据库schema
from sqlalchemy import Column, Integer, String, DateTime, Index
from datetime import datetime
from .database import Base

class Order(Base):
    __tablename__ = "orders"
    order_id = Column(String, primary_key=True, index=True)
    # 存储英文 Slug，例如 'jiaotao_a5'
    notebook_type = Column(String, nullable=False) 
    quantity = Column(Integer, default=1)
    platform = Column(String, index=True)                             # 平台 (taobao等)
    shop = Column(String, index=True)                                 # 店铺
    product_name = Column(String)                                     # 商品全名
    remark = Column(String)                                           # 备注
    front_image = Column(String)                                      # 存储图片相对路径
    back_image = Column(String)                                       # 存储图片相对路径
    status = Column(String, default="pending")                        # pending/completed
    created_at = Column(DateTime, default=datetime.now, index=True)   # 用于日期筛选
    updated_at = Column(DateTime, onupdate=datetime.now)              # 上传时间

# 建立组合索引，优化客服后台的多条件筛选速度
Index('idx_filter', Order.created_at, Order.platform, Order.shop)