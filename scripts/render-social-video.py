"""Render reviewed scene cuts with different promotion on every scene.

Usage: python scripts/render-social-video.py scene-manifest.json output.mp4
The manifest records source, start, end, title and subtitle for each scene.
"""
import json
from pathlib import Path
import subprocess
import sys
import tempfile

ROOT = Path(__file__).resolve().parents[1]
FFMPEG = Path("C:/pinokio/bin/miniconda/Library/bin/ffmpeg.exe")
FONT = Path("C:/Windows/Fonts/impact.ttf")


def validate(scenes):
    if len(scenes) < 2:
        raise ValueError("A montage requires at least two reviewed scenes")
    texts = set()
    total = 0
    for scene in scenes:
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
            style = "fontfile=font.ttf:fontcolor=white:shadowcolor=black@0.8:shadowx=3:shadowy=4"
            animation = "alpha='min(1,t/0.18)':x='80+24*max(0,1-t/0.18)'"
            filters = ("setpts=PTS-STARTPTS,fps=30,scale=1080:1920,setsar=1,"
                       "drawbox=x=56:y=246:w=870:h=215:color=0x04121c@0.72:t=fill,"
                       f"drawtext={style}:textfile=title.txt:fontsize=82:{animation}:y=270,"
                       f"drawtext={style}:textfile=subtitle.txt:fontsize=47:{animation}:y=370")
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


if __name__ == "__main__":
    render(Path(sys.argv[1]).resolve(), Path(sys.argv[2]).resolve())
