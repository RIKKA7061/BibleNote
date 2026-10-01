"""개역한글(KRV) 본문을 앱용 압축 JSON(data/krv.json)으로 변환한다.

원본: https://github.com/thiagobodruk/bible (json/ko_krv.json)
결과 형식: [책][장][절] = "본문"  (책 순서는 js/books.js 와 동일)

사용법:  python tools/build_data.py
"""
import json
import pathlib
import urllib.request

SRC_URL = "https://raw.githubusercontent.com/thiagobodruk/bible/master/json/ko_krv.json"
ROOT = pathlib.Path(__file__).resolve().parent.parent
SRC = ROOT / "tools" / "ko_krv_source.json"
OUT = ROOT / "data" / "krv.json"

if not SRC.exists():
    print("downloading", SRC_URL)
    urllib.request.urlretrieve(SRC_URL, SRC)

books = json.loads(SRC.read_text(encoding="utf-8-sig"))
assert len(books) == 66, len(books)

data = [[[" ".join(v.split()) for v in chapter] for chapter in book["chapters"]] for book in books]

OUT.write_text(json.dumps(data, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
verses = sum(len(c) for b in data for c in b)
print(f"wrote {OUT} ({OUT.stat().st_size:,} bytes, {verses:,} verses)")
