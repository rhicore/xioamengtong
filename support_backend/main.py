from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from .api import admin

app = FastAPI(title="Support Admin Backend")

# 允许跨域（如果前端独立运行）
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(admin.router)

if __name__ == "__main__":
    import uvicorn
    # 运行在 8001 端口，与用户端 8000 隔离
    uvicorn.run(app, host="0.0.0.0", port=8001)