"""IndexNow 提交脚本 —— 让 Bing / Yandex 等搜索引擎即时收录
无需任何账号。用法: python indexnow_submit.py
"""
import json, os, sys, urllib.request

BASE = r"D:\code\face-mosaic"
KEY_FILE = os.path.join(BASE, ".indexnow-key")
HOST = "haixiansheng.github.io"
SITE = f"https://{HOST}/face-mosaic"

URLS = [
    f"{SITE}/",
    f"{SITE}/about.html",
    f"{SITE}/privacy.html",
    f"{SITE}/en/",
    f"{SITE}/en/about.html",
    f"{SITE}/en/privacy.html",
]

# 同时提交给多个 IndexNow 端点（都是同一份协议）
ENDPOINTS = [
    "https://api.indexnow.org/indexnow",      # 通用入口（会分发给 Bing/Yandex 等）
    "https://www.bing.com/indexnow",          # Bing
    "https://yandex.com/indexnow",            # Yandex
]


def main():
    if not os.path.exists(KEY_FILE):
        print("✗ 找不到 .indexnow-key，请先生成 key")
        return 1
    key = open(KEY_FILE, encoding="utf-8").read().strip()
    key_location = f"{SITE}/{key}.txt"

    # 先验证 key 文件可访问（IndexNow 会去校验）
    print(f"→ 校验 key 文件: {key_location}")
    try:
        with urllib.request.urlopen(key_location, timeout=20) as r:
            body = r.read().decode("utf-8", "ignore").strip()
        ok = body == key
        print(f"  HTTP {r.status} | 内容匹配: {'✅' if ok else '❌ 内容不符'}")
        if not ok:
            print(f"  期望: {key}")
            print(f"  实际: {body[:60]}")
            return 1
    except Exception as e:
        print(f"  ✗ 无法访问: {e}")
        print("  请先部署 key 文件（git push）后再运行")
        return 1

    payload = {
        "host": HOST,
        "key": key,
        "keyLocation": key_location,
        "urlList": URLS,
    }
    data = json.dumps(payload).encode("utf-8")

    print(f"\n→ 提交 {len(URLS)} 个 URL 到 IndexNow")
    for ep in ENDPOINTS:
        try:
            req = urllib.request.Request(
                ep, data=data,
                headers={"Content-Type": "application/json; charset=utf-8"},
                method="POST",
            )
            with urllib.request.urlopen(req, timeout=30) as r:
                status = r.status
            # 200/202 都表示接受
            mark = "✅" if status in (200, 202) else "⚠"
            print(f"  {mark} {ep} → HTTP {status}")
        except urllib.error.HTTPError as e:
            # 200/202 之外的常见码: 400 参数错, 403 key 未验证, 422 URL 不属于该 host
            print(f"  ⚠ {ep} → HTTP {e.code} {e.reason}")
        except Exception as e:
            print(f"  ✗ {ep} → {e}")

    print("\n说明: 提交成功即已通知搜索引擎，通常数小时到 2 天内收录。")
    print("      200/202 = 接受; 403 = key 未验证(等部署后再试)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
