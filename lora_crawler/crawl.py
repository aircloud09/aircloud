"""Danbooru에서 캐릭터 이미지를 모아 LoRA 학습용 데이터셋으로 정리한다.

사용 예:
    pip install requests pillow
    python crawl.py --find kaoruko                 # 태그 이름 확인
    python crawl.py --tag waguri_kaoruko --count 80
"""
import argparse
import hashlib
import io
import time
from pathlib import Path

import requests
from PIL import Image

API = "https://danbooru.donmai.us"
HEADERS = {"User-Agent": "lora-dataset-crawler/1.0"}
EXCLUDE = ["comic", "monochrome", "multiple_girls", "text_focus", "sketch"]


def find_tags(keyword):
    r = requests.get(f"{API}/tags.json", headers=HEADERS, timeout=30, params={
        "search[name_matches]": f"*{keyword}*", "search[order]": "count", "limit": 20})
    r.raise_for_status()
    for t in r.json():
        print(f"{t['name']:40s} {t['post_count']:>6}")


def fetch_posts(tag, rating, pages):
    # 비로그인 검색은 태그 2개까지만 허용되므로 나머지 필터는 클라이언트에서 처리
    for page in range(1, pages + 1):
        r = requests.get(f"{API}/posts.json", headers=HEADERS, timeout=30, params={
            "tags": f"{tag} rating:{rating}", "limit": 100, "page": page})
        r.raise_for_status()
        posts = r.json()
        if not posts:
            return
        yield from posts
        time.sleep(1)


def resize_short_side(img, size):
    w, h = img.size
    if min(w, h) <= size:
        return img
    scale = size / min(w, h)
    return img.resize((round(w * scale), round(h * scale)), Image.LANCZOS)


def main():
    p = argparse.ArgumentParser()
    p.add_argument("--find", help="키워드로 태그 이름 검색")
    p.add_argument("--tag", help="캐릭터 태그 (예: waguri_kaoruko)")
    p.add_argument("--trigger", default="kaoruko_waguri", help="캡션 맨 앞에 넣을 트리거 단어")
    p.add_argument("--count", type=int, default=80, help="모을 장수")
    p.add_argument("--repeats", type=int, default=10, help="kohya 폴더 반복 횟수")
    p.add_argument("--rating", default="general", help="general / sensitive 등")
    p.add_argument("--min-size", type=int, default=768, help="짧은 변 최소 픽셀")
    p.add_argument("--resize", type=int, default=1024, help="짧은 변을 이 크기로 축소 (0=안 함)")
    p.add_argument("--out", default="dataset")
    p.add_argument("--max-pages", type=int, default=20)
    a = p.parse_args()

    if a.find:
        find_tags(a.find)
        return
    if not a.tag:
        p.error("--tag 또는 --find 필요")

    out = Path(a.out) / "img" / f"{a.repeats}_{a.trigger}"
    out.mkdir(parents=True, exist_ok=True)
    seen = {f.stem for f in out.glob("*.png")}
    saved = len(seen)

    for post in fetch_posts(a.tag, a.rating, a.max_pages):
        if saved >= a.count:
            break
        tags = post.get("tag_string_general", "").split()
        url = post.get("file_url")
        if not url or post.get("file_ext") not in ("jpg", "jpeg", "png", "webp"):
            continue
        if any(t in tags for t in EXCLUDE) or post.get("tag_string_character", "").split() != [a.tag]:
            continue
        if min(post["image_width"], post["image_height"]) < a.min_size:
            continue
        md5 = post.get("md5") or hashlib.md5(url.encode()).hexdigest()
        if md5 in seen:
            continue
        try:
            data = requests.get(url, headers=HEADERS, timeout=60).content
            img = Image.open(io.BytesIO(data)).convert("RGB")
        except Exception as e:
            print(f"skip {post['id']}: {e}")
            continue
        if a.resize:
            img = resize_short_side(img, a.resize)
        img.save(out / f"{md5}.png")
        caption = [a.trigger] + [t for t in tags if t not in EXCLUDE]
        (out / f"{md5}.txt").write_text(", ".join(t.replace("_", " ") for t in caption), encoding="utf-8")
        seen.add(md5)
        saved += 1
        print(f"[{saved}/{a.count}] {post['id']}")
        time.sleep(1)

    print(f"완료: {saved}장 -> {out}")


if __name__ == "__main__":
    main()
