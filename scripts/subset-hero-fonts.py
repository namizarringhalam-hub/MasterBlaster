"""Generate and validate heading subsets in ignored artifacts; no source writes.

Developer-only dependencies: fonttools[woff], brotli and uharfbuzz.
After a copy change, inspect generated CSS/fonts before copying into public/fonts.
"""
from pathlib import Path
import base64, gzip, hashlib, io, json, subprocess, sys

ROOT = Path(__file__).resolve().parent.parent
HERE = ROOT / ".codex-spec-render/lcp-experiment"
HERE.mkdir(parents=True, exist_ok=True)
sys.path.insert(0, str(HERE / "python-deps"))
import brotli
import uharfbuzz as hb
from fontTools import subset
from fontTools.ttLib import TTFont
from fontTools.pens.recordingPen import RecordingPen

player_text = json.loads(subprocess.check_output([
    "node", "--input-type=module", "-e",
    "import {PLAYER_TEXT as t} from './PLAYER_TEXT.js';console.log(JSON.stringify(t.landing));"
], cwd=ROOT, text=True))
lines = [player_text["headlineLine1"], player_text["headlineLine2"]]
brands = [player_text["brandFirst"], player_text["brandSecond"]]
punctuation = " \u00a0.,!?:;-–—'\"’“”&()"
stems = ["HTxwL3I-JCGChYJ8VI-L6OO_au7B45L0_3E-latin", "HTxyL3I-JCGChYJ8VI-L6OO_au7B6xTrW3bWvA-latin"]
report, rules, inline_rules = [], [], []

def outline(font, name):
    pen = RecordingPen()
    font.getGlyphSet()[name].draw(pen)
    return pen.value

def shaper(font):
    stream = io.BytesIO()
    font.flavor = None
    font.save(stream)
    hb_font = hb.Font(hb.Face(stream.getvalue()))
    order = font.getGlyphOrder()
    def shape(text):
        buffer = hb.Buffer()
        buffer.add_str(text)
        buffer.guess_segment_properties()
        hb.shape(hb_font, buffer)
        return [(order[g.codepoint], p.x_advance, p.y_advance, p.x_offset, p.y_offset) for g,p in zip(buffer.glyph_infos, buffer.glyph_positions)]
    return shape

for text, stem, style in zip(lines, stems, ["normal", "italic"]):
    source = ROOT / "public/fonts" / (stem + ".woff2")
    original = TTFont(source, recalcTimestamp=False)
    font = TTFont(source, recalcTimestamp=False)
    rendered_texts = [text.upper()] + ([value.upper() for value in brands] if style == "normal" else [])
    chars = sorted(set("".join(rendered_texts) + punctuation))
    supported = set(original.getBestCmap())
    requested = {ord(c) for c in chars}
    assert requested <= supported, f"Missing punctuation: {requested-supported}"
    options = subset.Options()
    options.layout_features = ["*"]
    options.glyph_names = True
    options.notdef_outline = True
    options.name_IDs = ["*"]
    options.name_languages = ["*"]
    options.hinting = True
    options.recalc_timestamp = False
    sub = subset.Subsetter(options=options)
    sub.populate(unicodes=requested)
    sub.subset(font)
    # Distinct internal family avoids collisions and keeps original license fields.
    for record in font["name"].names:
        if record.nameID in (1, 4, 6, 16):
            value = {1:"Master Blaster Hero", 4:f"Master Blaster Hero {style.title()}", 6:f"MasterBlasterHero-{style.title()}", 16:"Master Blaster Hero"}[record.nameID]
            record.string = value.encode(record.getEncoding())
    font.flavor = "woff2"
    output = HERE / f"hero-{style}.woff2"
    font.save(output)
    result = TTFont(output, recalcTimestamp=False)
    assert requested == set(result.getBestCmap()), "Character coverage changed"
    a, b = original.getBestCmap(), result.getBestCmap()
    for code in requested:
        assert original["hmtx"].metrics[a[code]] == result["hmtx"].metrics[b[code]]
        assert outline(original, a[code]) == outline(result, b[code])
        before_program = getattr(original["glyf"][a[code]], "program", None)
        after_program = getattr(result["glyf"][b[code]], "program", None)
        assert (before_program.getBytecode() if before_program else b"") == (after_program.getBytecode() if after_program else b"")
    for table, fields in {"head":["unitsPerEm"], "hhea":["ascent","descent","lineGap"], "OS/2":["sTypoAscender","sTypoDescender","sTypoLineGap","usWinAscent","usWinDescent","sxHeight","sCapHeight"]}.items():
        for field in fields:
            assert getattr(original[table], field) == getattr(result[table], field)
    for table in ("cvt ", "fpgm", "prep", "gasp"):
        if table in original:
            assert original.getTableData(table) == result.getTableData(table), table
    for name_id in (0,13,14):
        before = {(r.platformID,r.platEncID,r.langID,r.toUnicode()) for r in original["name"].names if r.nameID==name_id}
        after = {(r.platformID,r.platEncID,r.langID,r.toUnicode()) for r in result["name"].names if r.nameID==name_id}
        assert before == after
    original_shape, subset_shape = shaper(original), shaper(result)
    for rendered_text in rendered_texts:
        assert original_shape(rendered_text) == subset_shape(rendered_text)
    for first in chars:
        for second in chars:
            assert original_shape(first+second) == subset_shape(first+second)
    data = output.read_bytes()
    unicode_range = ",".join(f"U+{c:04X}" for c in sorted(requested))
    css = f"@font-face{{font-family:'Master Blaster Hero';font-style:{style};font-weight:900;font-display:swap;src:SOURCE format('woff2');unicode-range:{unicode_range};}}"
    rules.append(css.replace("SOURCE", f"url('/fonts/hero-{style}.woff2')"))
    inline_rules.append(css.replace("SOURCE", "url(data:font/woff2;base64,"+base64.b64encode(data).decode()+")"))
    report.append({"style":style,"text":text,"rendered_texts":rendered_texts,"characters":"".join(chars),"source":str(source),"source_bytes":source.stat().st_size,"output":str(output),"bytes":len(data),"sha256":hashlib.sha256(data).hexdigest(),"unicode_range":unicode_range,"validations":["exact coverage", "per-character outlines", "advance and side-bearing metrics", "glyph hint programs", "vertical metrics", "global hint tables", "copyright/license fields", "HarfBuzz whole headline/brand and every retained character pair shaping/kerning"]})

selector = "[data-menu-scene=landing] .hero-panel h1,[data-menu-scene=landing] .brand-mark{font-family:'Master Blaster Hero','Barlow Condensed','Barlow Condensed Fallback',sans-serif;}"
external = "\n".join(rules+[selector])+"\n"
inline = "\n".join(inline_rules+[selector])+"\n"
(HERE / "hero-fonts-external.css").write_text(external,encoding="utf-8")
(HERE / "hero-fonts-inline.css").write_text(inline,encoding="utf-8")
summary = {"fonts":report,"external_css_bytes":len(external.encode()),"external_css_gzip_bytes":len(gzip.compress(external.encode(),mtime=0)),"external_css_brotli_bytes":len(brotli.compress(external.encode())),"inline_css_bytes":len(inline.encode()),"inline_css_gzip_bytes":len(gzip.compress(inline.encode(),mtime=0)),"inline_css_brotli_bytes":len(brotli.compress(inline.encode())),"font_downloads_before":sum(x["source_bytes"] for x in report),"font_downloads_after":sum(x["bytes"] for x in report)}
(HERE / "hero-fonts.json").write_text(json.dumps(summary,indent=2),encoding="utf-8")
print(json.dumps(summary,indent=2))
