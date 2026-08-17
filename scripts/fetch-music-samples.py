"""Build the small, redistributable CC0 instrument bank used by the adaptive score."""

from pathlib import Path
from urllib.parse import quote
from urllib.request import Request, urlopen
import wave

import numpy as np


ROOT = "https://raw.githubusercontent.com/sgossner/VSCO-2-CE/master/"
OUTPUT = Path(__file__).resolve().parents[1] / "public" / "audio" / "music"
SAMPLES = {
    "battle-drum.wav": ("Percussion/BDrumNewhit_v5_rr1_Sum.wav", 2.4),
    "battle-drum-2.wav": ("Percussion/BDrumNewhit_v5_rr2_Sum.wav", 2.4),
    "battle-drum-3.wav": ("Percussion/BDrumNewhit_v6_rr1_Sum.wav", 2.4),
    "field-snare.wav": ("Percussion/Snare2-HitNS_v5_rr1_Sum.wav", 2.0),
    "field-snare-2.wav": ("Percussion/Snare2-HitNS_v5_rr2_Sum.wav", 2.0),
    "field-snare-3.wav": ("Percussion/Snare2-HitNS_v6_rr1_Sum.wav", 2.0),
    "cymbal.wav": ("Percussion/cymbal-crash1_ff_rr1.wav", 4.0),
    "cymbal-2.wav": ("Percussion/cymbal-crash1_ff_rr2.wav", 4.0),
    "anvil.wav": ("Percussion/Anvil_Hit1_v3_Sum.wav", 2.4),
    "anvil-2.wav": ("Percussion/Anvil_Hit1_v2_Sum.wav", 2.4),
    "anvil-3.wav": ("Percussion/Anvil_Hit1_v1_Sum.wav", 2.4),
    "cello-pizz.wav": ("Strings/Cello Section/pizzT/pizzT_D2_v2_RR1.wav", 2.2),
    "cello-pizz-a2.wav": ("Strings/Cello Section/pizzT/pizzT_A2_v2_RR1.wav", 2.2),
    "cello-pizz-c3.wav": ("Strings/Cello Section/pizzT/pizzT_C3_v2_RR1.wav", 2.2),
    "cello-pizz-d4.wav": ("Strings/Cello Section/pizzT/pizzT_D4_v2_RR1.wav", 2.2),
    "cello-spic.wav": ("Strings/Cello Section/spic/spic_D2_v2_RR1.wav", 2.2),
    "cello-spic-a2.wav": ("Strings/Cello Section/spic/spic_A2_v2_RR1.wav", 2.2),
    "cello-spic-c3.wav": ("Strings/Cello Section/spic/spic_C3_v2_RR1.wav", 2.2),
    "cello-trem.wav": ("Strings/Cello Section/trem/trem_D2_v2_1.wav", 4.8),
    "cello-trem-a2.wav": ("Strings/Cello Section/trem/trem_A2_v2_1.wav", 4.8),
    "cello-trem-c3.wav": ("Strings/Cello Section/trem/trem_C3_v2_1.wav", 4.8),
    "horn-staccato.wav": ("Brass/F Horn/stac/MOHorn_stac_D2_v3_rr1.wav", 2.0),
    "horn-staccato-a2.wav": ("Brass/F Horn/stac/MOHorn_stac_A2_v3_rr1.wav", 2.0),
    "horn-staccato-c3.wav": ("Brass/F Horn/stac/MOHorn_stac_C3_v3_rr1.wav", 2.0),
    "horn-staccato-d4.wav": ("Brass/F Horn/stac/MOHorn_stac_D4_v3_rr1.wav", 2.0),
    "horn-sustain.wav": ("Brass/F Horn/sus/MOHorn_sus_D2_v3_1.wav", 4.8),
    "horn-sustain-a2.wav": ("Brass/F Horn/sus/MOHorn_sus_A2_v3_1.wav", 4.8),
    "horn-sustain-c3.wav": ("Brass/F Horn/sus/MOHorn_sus_C3_v3_1.wav", 4.8),
    "horn-sustain-d4.wav": ("Brass/F Horn/sus/MOHorn_sus_D4_v1_1.wav", 4.8),
    "trombone-buzz.wav": ("Brass/OldTrombone/Buzz/Trombone_Buzz_D2_v2_1.wav", 3.0),
    "violin-spic.wav": ("Strings/Solo Violin/spic/LLVln_spic_C4_v2_rr1.wav", 2.0),
    "violin-spic-g4.wav": ("Strings/Solo Violin/spic/LLVln_spic_G4_v2_rr1.wav", 2.0),
    "violin-spic-c5.wav": ("Strings/Solo Violin/spic/LLVln_spic_C5_v2_rr1.wav", 2.0),
}


def decode_pcm(raw: bytes, width: int) -> np.ndarray:
    if width == 1:
        return (np.frombuffer(raw, dtype=np.uint8).astype(np.float32) - 128) / 128
    if width == 2:
        return np.frombuffer(raw, dtype="<i2").astype(np.float32) / 32768
    if width == 3:
        packed = np.frombuffer(raw, dtype=np.uint8).reshape(-1, 3).astype(np.int32)
        values = packed[:, 0] | packed[:, 1] << 8 | packed[:, 2] << 16
        values = np.where(values & 0x800000, values - 0x1000000, values)
        return values.astype(np.float32) / 8388608
    if width == 4:
        return np.frombuffer(raw, dtype="<i4").astype(np.float32) / 2147483648
    raise ValueError(f"Unsupported PCM width: {width}")


def convert(source: Path, target: Path, maximum_seconds: float) -> None:
    with wave.open(str(source), "rb") as reader:
        channels, width, rate, frames = reader.getnchannels(), reader.getsampwidth(), reader.getframerate(), reader.getnframes()
        audio = decode_pcm(reader.readframes(frames), width).reshape(-1, channels).mean(axis=1)

    peak = float(np.max(np.abs(audio))) or 1
    audible = np.flatnonzero(np.abs(audio) > peak * 0.0015)
    if audible.size:
        margin = int(rate * 0.025)
        audio = audio[max(0, int(audible[0]) - margin):min(audio.size, int(audible[-1]) + margin)]
    audio = audio[: int(rate * maximum_seconds)]

    target_rate = 32000
    if rate != target_rate:
        count = max(1, round(audio.size * target_rate / rate))
        audio = np.interp(np.linspace(0, audio.size - 1, count), np.arange(audio.size), audio).astype(np.float32)
    peak = float(np.max(np.abs(audio))) or 1
    audio *= 0.88 / peak
    fade = min(audio.size // 4, int(target_rate * 0.025))
    if fade:
        audio[:fade] *= np.linspace(0, 1, fade)
        audio[-fade:] *= np.linspace(1, 0, fade)
    pcm = np.clip(audio * 32767, -32768, 32767).astype("<i2")
    with wave.open(str(target), "wb") as writer:
        writer.setnchannels(1)
        writer.setsampwidth(2)
        writer.setframerate(target_rate)
        writer.writeframes(pcm.tobytes())


def main() -> None:
    OUTPUT.mkdir(parents=True, exist_ok=True)
    for filename, (remote_path, maximum_seconds) in SAMPLES.items():
        raw = OUTPUT / f".{filename}.source"
        request = Request(ROOT + quote(remote_path), headers={"User-Agent": "Blaster-Battle-build"})
        raw.write_bytes(urlopen(request, timeout=60).read())
        convert(raw, OUTPUT / filename, maximum_seconds)
        raw.unlink()


if __name__ == "__main__":
    main()
