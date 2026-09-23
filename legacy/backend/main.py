import os
from pathlib import Path
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse
from .database import engine, Base, SessionLocal
from .models import Order
from .api import orders

# --- 数据库初始化与预填逻辑 ---
def init_db():
    # 1. 创建表结构
    Base.metadata.create_all(bind=engine)
    
    # 2. 预设初始订单数据集
    # 使用英文 Slug 作为 notebook_type，确保与 JSON 配置文件 key 对应
    initial_orders = [
        {
            "order_id": "1",
            "notebook_type": "jiaotao_a5",
            "quantity": 1,
            "platform": "taobao",
            "shop": "测试店一号",
            "status": "pending"
        },
        {
            "order_id": "2",
            "notebook_type": "default",
            "quantity": 1,
            "platform": "taobao",
            "shop": "测试店二号",
            "status": "pending"
        }
    ]

    db = SessionLocal()
    try:
        for order_info in initial_orders:
            # 检查订单是否存在，实现幂等初始化
            exists = db.query(Order).filter(Order.order_id == order_info["order_id"]).first()
            if not exists:
                new_order = Order(**order_info)
                db.add(new_order)
        
        db.commit()
    except Exception as e:
        db.rollback()
        print(f"CRITICAL: Database initialization failed: {e}")
    finally:
        db.close()

# 执行初始化
init_db()

app = FastAPI()

# 1. 挂载上传的图片静态目录
IMAGE_DIR = Path("data/images")
IMAGE_DIR.mkdir(parents=True, exist_ok=True)
app.mount("/static", StaticFiles(directory=str(IMAGE_DIR)), name="static")

# 2. CORS 配置 (开放局域网访问)
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# 3. 注册后端 API 路由
app.include_router(orders.router)

# ================= 新增：跨目录挂载前端 SPA =================

# 动态计算 client_frontend/dist 的绝对路径
# Path(__file__).parent 是 backend 目录，.parent.parent 是项目根目录
FRONTEND_DIST_DIR = Path(__file__).parent.parent / "client_frontend" / "dist"
FRONTEND_ASSETS_DIR = FRONTEND_DIST_DIR / "assets"
FRONTEND_INDEX_PATH = FRONTEND_DIST_DIR / "index.html"

# 4. 挂载 Vite 编译出的 assets 静态资源目录
if FRONTEND_ASSETS_DIR.exists():
    app.mount("/assets", StaticFiles(directory=str(FRONTEND_ASSETS_DIR)), name="assets")

# 5. 捕获所有其他路由，返回前端 index.html
@app.get("/{catchall:path}")
def serve_frontend(catchall: str):
    # 防止 API 请求被误拦截到前端页面
    if catchall.startswith("api/"):
        raise HTTPException(status_code=404, detail="API route not found")
        
    if FRONTEND_INDEX_PATH.exists():
        return FileResponse(str(FRONTEND_INDEX_PATH))
    
    return {"error": f"Frontend build not found at {FRONTEND_INDEX_PATH}"}
