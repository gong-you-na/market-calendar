"""assets/people/*.jpg 를 아바타 규격(160×160, 상단 중심 크롭, JPEG q82, 메타데이터 제거)으로 줄인다.
화면 표시 최대 72px 원형이므로 2배 해상도면 충분. 실행: python3 scripts/shrink_photos.py
"""
import glob, io, os, sys
from PIL import Image, ImageOps

SIZE = 160
root = os.path.join(os.path.dirname(__file__), "..", "assets", "people")
total_before = total_after = 0
for path in sorted(glob.glob(os.path.join(root, "*.jpg"))):
    before = os.path.getsize(path)
    im = ImageOps.exif_transpose(Image.open(path)).convert("RGB")
    if max(im.size) <= SIZE and before < 12000:
        continue
    # 상단 중심 크롭(얼굴이 위쪽에 있는 인물 사진 기준) 후 리사이즈
    w, h = im.size
    side = min(w, h)
    left = (w - side) // 2
    im = im.crop((left, 0, left + side, side)).resize((SIZE, SIZE), Image.LANCZOS)
    buf = io.BytesIO()
    im.save(buf, "JPEG", quality=82, optimize=True, progressive=True)
    data = buf.getvalue()
    if len(data) < before:
        with open(path, "wb") as f:
            f.write(data)
    total_before += before; total_after += os.path.getsize(path)
    print(f"[ok] {os.path.basename(path)}: {before//1024}KB → {os.path.getsize(path)//1024}KB")
print(f"[info] total {total_before//1024}KB → {total_after//1024}KB")
