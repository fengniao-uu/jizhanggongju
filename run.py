#!/usr/bin/env python3
"""
智能记账系统 - 统一启动脚本
前后端一体化部署
"""
import sys
import os
from pathlib import Path

# 添加 backend 到 Python 路径
backend_dir = Path(__file__).parent / "backend"
sys.path.insert(0, str(backend_dir))

# 切换到 backend 目录
os.chdir(backend_dir)

# 导入并启动 Flask 应用
from app import app

if __name__ == "__main__":
    print("=" * 60)
    print("智能记账系统 - 前后端一体化服务")
    print("=" * 60)
    print("访问地址: http://localhost:5000")
    print("API 基础路径: http://localhost:5000/api")
    print("=" * 60)
    print("按 Ctrl+C 停止服务")
    print("=" * 60)
    
    app.run(host="0.0.0.0", port=5000, debug=False, threaded=True)
