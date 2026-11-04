# -*- coding: utf-8 -*-
"""Chay Audio Sync (sync_engine.py) va in ket qua moi dong 1 JSON cho panel doc.
Cach dung: python sync_runner.py <file_cau_hinh.json>"""
import sys, os, json, warnings
warnings.filterwarnings("ignore")
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))


def out(o):
    print(json.dumps(o, ensure_ascii=False), flush=True)


def main():
    cfg = json.load(open(sys.argv[1], encoding="utf-8"))
    try:
        import sync_engine as se
    except ImportError as e:
        out({"type": "error", "msg": "Thiếu thư viện Python: %s. Hãy chạy: pip install numpy imageio-ffmpeg" % e})
        return 2
    eng = se.SyncEngine(log=lambda m: out({"type": "log", "msg": str(m)}),
                        progress=lambda f, m: out({"type": "progress", "f": round(float(f), 3), "msg": m}))
    st = se.Settings(window=float(cfg.get("window", 180)), thr_ratio=float(cfg.get("ratio", 1.5)),
                     drift=bool(cfg.get("drift", True)))
    try:
        res = eng.analyze(cfg["refs"], cfg["cams"], st)
    except Exception as e:
        out({"type": "error", "msg": str(e)})
        return 1
    for r in res:
        out({"type": "result", "path": r.path, "name": r.name, "duration": r.duration, "cam_time": r.cam_time,
             "ref": r.ref, "offset": r.offset, "score": round(r.score, 3), "ratio": round(r.ratio, 2),
             "status": r.status, "drift_ms": r.drift_ms, "note": r.note,
             "tc": se.fmt_tc(r.offset)})
    out({"type": "done"})
    return 0


if __name__ == "__main__":
    sys.exit(main())
