"""앱 아이콘(PNG)을 외부 라이브러리 없이 생성한다.  사용법: python tools/make_icons.py"""
import pathlib
import struct
import zlib

ROOT = pathlib.Path(__file__).resolve().parent.parent
BG = (123, 63, 42)       # 짙은 갈색
PAGE = (250, 244, 234)   # 종이색
SS = 4                   # 안티앨리어싱 샘플 수 (SS x SS)

LEFT = [(0.20, 0.36), (0.485, 0.42), (0.485, 0.78), (0.20, 0.72)]
RIGHT = [(0.515, 0.42), (0.80, 0.36), (0.80, 0.72), (0.515, 0.78)]
CROSS = [(0.475, 0.12, 0.525, 0.36), (0.41, 0.18, 0.59, 0.225)]


def in_poly(x, y, poly):
    inside = False
    j = len(poly) - 1
    for i in range(len(poly)):
        xi, yi = poly[i]
        xj, yj = poly[j]
        if (yi > y) != (yj > y) and x < (xj - xi) * (y - yi) / (yj - yi) + xi:
            inside = not inside
        j = i
    return inside


def in_round_rect(x, y, r):
    cx = min(max(x, r), 1 - r)
    cy = min(max(y, r), 1 - r)
    return (x - cx) ** 2 + (y - cy) ** 2 <= r * r


def shade(x, y, scale, rounded):
    """(x, y)는 0..1 좌표. scale<1 이면 그림을 가운데로 축소(maskable 안전영역)."""
    if rounded and not in_round_rect(x, y, 0.22):
        return None
    u = (x - 0.5) / scale + 0.5
    v = (y - 0.5) / scale + 0.5
    if in_poly(u, v, LEFT) or in_poly(u, v, RIGHT):
        return PAGE
    for x0, y0, x1, y1 in CROSS:
        if x0 <= u <= x1 and y0 <= v <= y1:
            return PAGE
    return BG


def render(size, scale=1.0, rounded=True):
    rows = []
    for py in range(size):
        row = bytearray([0])
        for px in range(size):
            r = g = b = a = 0
            for sy in range(SS):
                for sx in range(SS):
                    c = shade((px + (sx + 0.5) / SS) / size, (py + (sy + 0.5) / SS) / size, scale, rounded)
                    if c:
                        r += c[0]; g += c[1]; b += c[2]; a += 1
            n = SS * SS
            if a:
                row += bytes([r // a, g // a, b // a, 255 * a // n])
            else:
                row += bytes([0, 0, 0, 0])
        rows.append(bytes(row))
    return png(size, b"".join(rows))


def png(size, raw):
    def chunk(tag, data):
        return struct.pack(">I", len(data)) + tag + data + struct.pack(">I", zlib.crc32(tag + data) & 0xFFFFFFFF)
    ihdr = struct.pack(">IIBBBBB", size, size, 8, 6, 0, 0, 0)
    return b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", ihdr) + chunk(b"IDAT", zlib.compress(raw, 9)) + chunk(b"IEND", b"")


out = ROOT / "icons"
out.mkdir(exist_ok=True)
(out / "icon-192.png").write_bytes(render(192))
(out / "icon-512.png").write_bytes(render(512))
(out / "maskable-512.png").write_bytes(render(512, scale=0.78, rounded=False))
(out / "favicon-32.png").write_bytes(render(32))
print("icons written to", out)
