import json
from pathlib import Path

# 定位到 根目录/config/notebook_templates.json
CONFIG_PATH = Path(__file__).resolve().parent.parent.parent / "config" / "notebook_templates.json"

_CONFIG_CACHE = {}

def get_templates():
    global _CONFIG_CACHE
    if not _CONFIG_CACHE:
        if CONFIG_PATH.exists():
            with open(CONFIG_PATH, "r", encoding="utf-8") as f:
                _CONFIG_CACHE = json.load(f)
    return _CONFIG_CACHE

def get_template_by_slug(slug: str):
    templates = get_templates()
    return templates.get(slug, templates.get("default", {}))