"""Voiceover for the demo video.
  python demo/make_audio.py clips            speak every line in narration.json (macOS `say`) -> out/narration/*.wav + durations.json
  python demo/make_audio.py mix FFMPEG        place each line at the time its caption appeared (out/timeline.json) and mux onto the video -> out/carecircle-demo.mp4
"""
import array, json, subprocess, sys, wave
from pathlib import Path

HERE = Path(__file__).parent
OUT = HERE / "out"; CLIPS = OUT / "narration"
VOICE = "Tara"                      # en_IN
RATE = 172
RATE_HZ = 44100
narr = json.loads((HERE / "narration.json").read_text())

def clips():
    CLIPS.mkdir(parents=True, exist_ok=True)
    durations = {}
    for k, v in narr.items():
        aiff, wav = CLIPS / f"{k}.aiff", CLIPS / f"{k}.wav"
        subprocess.run(["say", "-v", VOICE, "-r", str(RATE), "-o", str(aiff), v["say"]], check=True)
        subprocess.run(["afconvert", "-f", "WAVE", "-d", f"LEI16@{RATE_HZ}", "-c", "1", str(aiff), str(wav)], check=True)
        with wave.open(str(wav)) as w:
            durations[k] = w.getnframes() / w.getframerate()
        aiff.unlink()
    (CLIPS / "durations.json").write_text(json.dumps(durations, indent=1))
    print(f"{len(durations)} clips, {sum(durations.values()):.1f}s of speech")

def mix(ffmpeg):
    tl = json.loads((OUT / "timeline.json").read_text())
    total = tl["video_seconds"] + 1
    buf = array.array("h", [0]) * int(total * RATE_HZ)
    for item in tl["lines"]:
        with wave.open(str(CLIPS / f"{item['id']}.wav")) as w:
            data = array.array("h"); data.frombytes(w.readframes(w.getnframes()))
        off = int(item["start"] * RATE_HZ)
        for i, s in enumerate(data):
            if off + i < len(buf):
                buf[off + i] = max(-32768, min(32767, buf[off + i] + s))
    mixed = OUT / "voiceover.wav"
    with wave.open(str(mixed), "wb") as w:
        w.setnchannels(1); w.setsampwidth(2); w.setframerate(RATE_HZ); w.writeframes(buf.tobytes())
    mp4 = OUT / "carecircle-demo.mp4"
    subprocess.run([ffmpeg, "-y", "-loglevel", "error", "-i", str(OUT / "carecircle-silent.webm"), "-i", str(mixed), "-map", "0:v", "-map", "1:a",
                    "-c:v", "libx264", "-pix_fmt", "yuv420p", "-crf", "20", "-preset", "medium", "-c:a", "aac", "-b:a", "160k", "-shortest", "-movflags", "+faststart", str(mp4)], check=True)
    print("wrote", mp4, f"{mp4.stat().st_size/1e6:.1f} MB")

{"clips": clips, "mix": lambda: mix(sys.argv[2])}[sys.argv[1]]()
