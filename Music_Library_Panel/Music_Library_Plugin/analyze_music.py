"""Phan tich BPM + nang luong cho file nhac. Duoc panel Music Library goi tu dong.
Cach dung: python analyze_music.py <file_json>
File json: {"mode": "music" | "sfx", "paths": [...]} (hoac danh sach duong dan nhu ban cu = music).
Che do sfx: chi do nang luong (rms, cen), bo BPM va Highlight nen nhanh hon nhieu.
Moi file in ra 1 dong JSON ket qua."""
import sys, json, warnings
warnings.filterwarnings("ignore")
import numpy as np
import librosa


def analyze_sfx(p):
    y, sr = librosa.load(p, sr=22050, mono=True, duration=30)
    dur = len(y) / sr if sr > 0 else 0.0
    try:
        dur = float(librosa.get_duration(path=p))
    except Exception:
        pass
    if y.size == 0:
        return {"ok": True, "bpm": None, "rms": -60.0, "cen": 1000.0, "dur": round(dur, 2), "highlight": 0.0}
    rms_db = float(20 * np.log10(np.mean(librosa.feature.rms(y=y)) + 1e-12))
    cen = float(np.mean(librosa.feature.spectral_centroid(y=y, sr=sr)))
    return {"ok": True, "bpm": None, "rms": round(rms_db, 2), "cen": round(cen, 1), "dur": round(dur, 2), "highlight": 0.0}


def analyze(p):
    y, sr = librosa.load(p, sr=22050, mono=True, duration=90)
    
    try:
        dur = float(librosa.get_duration(path=p))
    except Exception:
        dur = len(y) / sr if sr > 0 else 0.0

    if y.size == 0:
        return {"ok": True, "bpm": None, "rms": -60.0, "cen": 1000.0, "dur": round(dur, 2), "highlight": 0.0}

    rms_calc = librosa.feature.rms(y=y)
    rms_db = float(20 * np.log10(np.mean(rms_calc) + 1e-12))
    cen = float(np.mean(librosa.feature.spectral_centroid(y=y, sr=sr)))

    if y.size < sr:
        # File ngan (< 1s, pho bien voi Sound Effect)
        return {"ok": True, "bpm": None, "rms": round(rms_db, 2), "cen": round(cen, 1), "dur": round(dur, 2), "highlight": 0.0}

    # Tinh BPM
    try:
        tempo = float(np.atleast_1d(librosa.beat.beat_track(y=y, sr=sr)[0])[0])
        tempo = round(tempo, 1) if tempo > 0 else None
    except Exception:
        tempo = None

    # Tinh diem Highlight (doan cao trao / chorus / peak energy)
    highlight_sec = 0.0
    if dur >= 25:
        hop_length = 512
        rms_series = rms_calc[0]
        win_len = int(7 * sr / hop_length) # Cua so 7 giay
        if len(rms_series) > win_len:
            rolling_rms = np.convolve(rms_series, np.ones(win_len)/win_len, mode='valid')
            skip_frames = int(12 * sr / hop_length) # Bo qua 12s dau tranh tieng nổ/intro ngan
            if len(rolling_rms) > skip_frames:
                best_idx = skip_frames + int(np.argmax(rolling_rms[skip_frames:]))
            else:
                best_idx = int(np.argmax(rolling_rms))
            highlight_sec = round((best_idx * hop_length) / sr, 1)
        else:
            highlight_sec = round(dur * 0.35, 1)

    return {"ok": True, "bpm": tempo, "rms": round(rms_db, 2), "cen": round(cen, 1), "dur": round(dur, 1), "highlight": highlight_sec}


if __name__ == "__main__":
    cfg = json.load(open(sys.argv[1], encoding="utf-8"))
    if isinstance(cfg, list):
        cfg = {"mode": "music", "paths": cfg}
    fn = analyze_sfx if cfg.get("mode") == "sfx" else analyze
    for path in cfg.get("paths", []):
        try:
            out = fn(path)
        except Exception as e:
            out = {"ok": False, "error": (str(e) or e.__class__.__name__ + " (file aac can ffmpeg)")[:200]}
        out["path"] = path
        print(json.dumps(out), flush=True)
