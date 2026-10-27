"""Render reviewed scene cuts with different promotion on every scene.

Usage: python scripts/render-social-video.py scene-manifest.json output.mp4
The manifest records source, start, end, title and subtitle for each scene.
Optional title_color accepts a game neon name or a matching six-digit RGB hex.
Run with --check-colors to verify palette membership and input validation.
"""
import json
from pathlib import Path
import re
import subprocess
import sys
import tempfile

ROOT = Path(__file__).resolve().parents[1]
FFMPEG = Path("C:/pinokio/bin/miniconda/Library/bin/ffmpeg.exe")
FONT = Path("C:/Windows/Fonts/impact.ttf")
# Current arena district colors (src/world.js) and map danger/accent colors
# (src/gameData.js). Only these bright game colors may enter a drawtext filter.
TITLE_COLORS = {
    "pink": "ff4f87", "cyan": "28e7ff", "red": "ff416c", "blue": "6b9cff",
    "mint": "4dffc2", "gold": "ffc247", "violet": "9d7bff", "magenta": "ff4fd8",
}
DEFAULT_TITLE_COLORS = ("pink", "cyan", "red", "blue")


def title_color(scene, index):
    value = scene.get("title_color", DEFAULT_TITLE_COLORS[index % len(DEFAULT_TITLE_COLORS)])
    if not isinstance(value, str):
        raise ValueError("title_color must be a game neon name or palette RGB hex")
    value = value.strip().lower()
    color = TITLE_COLORS.get(value)
    if color is None:
        match = re.fullmatch(r"(?:#|0x)?([0-9a-f]{6})", value)
        if not match or match[1] not in TITLE_COLORS.values():
            raise ValueError("title_color must name a game neon color or match its six-digit RGB hex")
        color = match[1]
    return f"0x{color}"


def validate(scenes):
    if len(scenes) < 2:
        raise ValueError("A montage requires at least two reviewed scenes")
    texts = set()
    total = 0
    for index, scene in enumerate(scenes):
        title_color(scene, index)
        duration = scene["end"] - scene["start"]
        if scene["start"] < 0 or not 1 <= duration <= 5:
            raise ValueError("Use reviewed scene cuts of one to five seconds")
        copy = (scene["title"], scene["subtitle"])
        if copy in texts or any(not text.strip() for text in copy):
            raise ValueError("Every scene needs its own nonempty promotional text")
        texts.add(copy)
        total += duration
    if not 10 <= total <= 20:
        raise ValueError("The final montage must be ten to twenty seconds")


def run(*args, cwd):
    subprocess.run([str(FFMPEG), "-hide_banner", "-loglevel", "warning", "-y", *args],
                   cwd=cwd, check=True, timeout=180)


def render(manifest, output):
    scenes = json.loads(manifest.read_text(encoding="utf-8"))["scenes"]
    validate(scenes)
    output.parent.mkdir(parents=True, exist_ok=True)
    # ponytail: installed encoder and installed font; no editing framework or dependency.
    with tempfile.TemporaryDirectory(prefix="social-edit-", dir=output.parent) as directory:
        work = Path(directory)
        (work / "font.ttf").write_bytes(FONT.read_bytes())
        for i, scene in enumerate(scenes):
            source = (manifest.parent / scene["source"]).resolve()
            if not source.is_file():
                raise FileNotFoundError(source)
            for key in ("title", "subtitle"):
                (work / f"{key}.txt").write_text(scene[key], encoding="utf-8")
            # Text enters over six frames. Each cut resets the text and animation.
            style = "fontfile=font.ttf:shadowcolor=black@0.8:shadowx=3:shadowy=4"
            animation = "alpha='min(1,t/0.18)':x='80+24*max(0,1-t/0.18)'"
            filters = ("setpts=PTS-STARTPTS,fps=30,scale=1080:1920,setsar=1,"
                       "drawbox=x=56:y=246:w=870:h=215:color=0x04121c@0.86:t=fill,"
                       f"drawtext={style}:fontcolor={title_color(scene, i)}:textfile=title.txt:fontsize=82:{animation}:y=270,"
                       f"drawtext={style}:fontcolor=white:textfile=subtitle.txt:fontsize=47:{animation}:y=370")
            run("-ss", str(scene["start"]), "-i", str(source), "-t", str(scene["end"] - scene["start"]),
                "-map", "0:v:0", "-map", "0:a:0", "-vf", filters,
                "-af", "aresample=async=1:first_pts=0,asetpts=N/SR/TB",
                "-c:v", "libx264", "-preset", "fast", "-crf", "20", "-pix_fmt", "yuv420p",
                "-c:a", "aac", "-ar", "48000", "-ac", "2", "-b:a", "160k", f"scene{i}.mp4", cwd=work)
        (work / "cuts.txt").write_text("".join(f"file 'scene{i}.mp4'\n" for i in range(len(scenes))), encoding="utf-8")
        run("-f", "concat", "-safe", "0", "-i", "cuts.txt", "-vf", "fps=30", "-c:v", "libx264",
            "-preset", "fast", "-crf", "18", "-pix_fmt", "yuv420p", "-af",
            "loudnorm=I=-16:TP=-1.5:LRA=11", "-c:a", "aac", "-ar", "48000", "-ac", "2",
            "-b:a", "160k", "-t", str(round(sum(s["end"] - s["start"] for s in scenes), 3)),
            "-movflags", "+faststart", str(output), cwd=work)


def check_colors():
    game_colors = ((ROOT / "src/world.js").read_text(encoding="utf-8")
                   + (ROOT / "src/gameData.js").read_text(encoding="utf-8")).lower()
    assert all(f"0x{color}" in game_colors for color in TITLE_COLORS.values())
    assert [title_color({}, i) for i in range(4)] == ["0xff4f87", "0x28e7ff", "0xff416c", "0x6b9cff"]
    for value in (" PINK ", "#FF4F87", "0xff4f87", "ff4f87"):
        assert title_color({"title_color": value}, 0) == "0xff4f87"
    for value in ("white", "#ffffff", "#ff4f87:fontsize=999", "red@0.5", "red,drawbox", "#ff4f87\nred", None, 123):
        try:
            title_color({"title_color": value}, 0)
        except ValueError:
            continue
        raise AssertionError(f"Unsafe or off-palette color accepted: {value!r}")
    print("Game palette, default cut colors, accepted RGB formats and rejected filter injections passed.")


if __name__ == "__main__":
    if sys.argv[1:] == ["--check-colors"]:
        check_colors()
    else:
        render(Path(sys.argv[1]).resolve(), Path(sys.argv[2]).resolve())
