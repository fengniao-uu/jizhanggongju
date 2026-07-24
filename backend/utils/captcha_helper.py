import io
import uuid
import secrets
import hashlib
import datetime as dt
import random
from typing import Tuple

from PIL import Image, ImageDraw, ImageFont, ImageFilter

_CAPTCHA_CHARS = "23456789ABCDEFGHJKLMNPQRSTUVWXYZ"
_CAPTCHA_LEN = 4
_CAPTCHA_TTL_SEC = 300
_IMG_W, _IMG_H = 160, 52


def _rand_color(lo: int = 0, hi: int = 255) -> Tuple[int, int, int]:
    return (
        random.randint(lo, hi),
        random.randint(lo, hi),
        random.randint(lo, hi),
    )


def _rand_font() -> ImageFont.ImageFont:
    sizes = [30, 31, 32, 33, 34, 35, 36]
    try:
        candidates = [
            "C:/Windows/Fonts/arialbd.ttf",
            "C:/Windows/Fonts/Arial.ttf",
            "C:/Windows/Fonts/msyhbd.ttc",
            "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf",
            "/usr/share/fonts/truetype/liberation/LiberationSans-Bold.ttf",
            "/Library/Fonts/Arial Bold.ttf",
            "/System/Library/Fonts/Supplemental/Arial Bold.ttf",
        ]
        import os
        for p in candidates:
            if os.path.exists(p):
                return ImageFont.truetype(p, random.choice(sizes))
    except Exception:
        pass
    return ImageFont.load_default()


def generate_captcha() -> dict:
    """返回 {captcha_id, image: 'data:image/png;base64,...', ttl:300, expires_at}"""
    code_chars = [secrets.choice(_CAPTCHA_CHARS) for _ in range(_CAPTCHA_LEN)]
    code_plain = "".join(code_chars)
    salt = secrets.token_hex(8)  # 生成 16 个十六进制字符
    code_hash = hashlib.sha256((salt + code_plain).encode("utf-8")).hexdigest()
    captcha_id = uuid.uuid4().hex

    # ------------ Pillow 绘图画布 ------------
    r1, g1, b1 = _rand_color(210, 255), _rand_color(210, 255), _rand_color(210, 255)
    r2, g2, b2 = _rand_color(170, 225), _rand_color(170, 225), _rand_color(170, 225)
    img = Image.new("RGB", (_IMG_W, _IMG_H), (248, 250, 252))
    pix = img.load()
    for y in range(_IMG_H):
        t = y / _IMG_H
        rr = int(r1[0] * (1 - t) + r2[0] * t) & 0xFF
        gg = int(g1[1] * (1 - t) + g2[1] * t) & 0xFF
        bb = int(b1[2] * (1 - t) + b2[2] * t) & 0xFF
        for x in range(_IMG_W):
            pix[x, y] = (rr, gg, bb)

    draw = ImageDraw.Draw(img)
    font = _rand_font()

    # 噪点
    for _ in range(80):
        x = random.randint(0, _IMG_W - 1)
        y = random.randint(0, _IMG_H - 1)
        draw.point((x, y), fill=_rand_color(60, 220))

    # 干扰线
    for _ in range(4):
        x1, y1 = random.randint(0, _IMG_W // 3), random.randint(0, _IMG_H - 1)
        x2, y2 = random.randint(_IMG_W * 2 // 3, _IMG_W - 1), random.randint(0, _IMG_H - 1)
        draw.line([(x1, y1), (x2, y2)], fill=_rand_color(90, 200), width=random.randint(1, 2))

    # 干扰弧线
    for _ in range(2):
        bbox = [
            random.randint(-10, _IMG_W // 2),
            random.randint(-10, _IMG_H // 2),
            random.randint(_IMG_W // 2, _IMG_W + 10),
            random.randint(_IMG_H // 2, _IMG_H + 10),
        ]
        draw.arc(
            bbox,
            start=random.randint(0, 180),
            end=random.randint(180, 360),
            fill=_rand_color(80, 190),
            width=random.randint(1, 2),
        )

    # 绘制字符（旋转 + 位移 + 颜色）
    char_w = _IMG_W / (_CAPTCHA_LEN + 1)
    for i, ch in enumerate(code_chars):
        char_img = Image.new("RGBA", (50, 52), (0, 0, 0, 0))
        cd = ImageDraw.Draw(char_img)
        fg = _rand_color(10, 110)
        while fg[0] + fg[1] + fg[2] > 260:
            fg = _rand_color(10, 110)
        try:
            bbox_t = cd.textbbox((0, 0), ch, font=font)
            tw, th = bbox_t[2] - bbox_t[0], bbox_t[3] - bbox_t[1]
            tx, ty = (50 - tw) // 2 - bbox_t[0], (52 - th) // 2 - bbox_t[1]
        except Exception:
            tx, ty = 10, 8
        cd.text((tx, ty), ch, font=font, fill=fg)
        angle = random.randint(-28, 28)
        char_img = char_img.rotate(angle, resample=Image.BICUBIC, expand=True)
        px = int(char_w * (i + 0.55) + random.randint(-6, 6))
        py = random.randint(0, _IMG_H - 38)
        img.paste(char_img, (px, py), char_img)

    # 轻微模糊
    img = img.filter(ImageFilter.SMOOTH)

    # 导出 PNG 格式并进行 base64 编码
    buf = io.BytesIO()
    img.save(buf, format="PNG", optimize=True)
    import base64
    b64 = base64.b64encode(buf.getvalue()).decode("ascii")
    data_uri = "data:image/png;base64," + b64

    now = dt.datetime.utcnow()
    exp = now + dt.timedelta(seconds=_CAPTCHA_TTL_SEC)
    expires_at = exp.strftime("%Y-%m-%d %H:%M:%S")

    return {
        "captcha_id": captcha_id,
        "code_hash": code_hash,
        "salt": salt,
        "expires_at": expires_at,
        "image": data_uri,
        "ttl": _CAPTCHA_TTL_SEC,
    }
