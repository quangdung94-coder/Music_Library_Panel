# -*- coding: utf-8 -*-
"""
multicam_sync.py - Ghep nhieu may quay (khong chung timecode) CHI dua vao audio.

Cach dung:
    python multicam_sync.py <config.json> <ket_qua.json>

config.json:
{
  "engine_dir": "<thu muc co sync_engine.py>",
  "fps": 25,
  "cams": [ {"name": "Cam 1", "files": ["...mp4", ...]}, {"name": "Cam 2", "files": [...]} ],
  "recorder": ["...wav"],      # khong bat buoc: file may ghi am roi, lam truc chinh (may cuoi cung)
  "close_gaps": true,          # false: giu khoang trong that giua cac doan
  "clock_fallback": true,      # clip khong khop audio dat theo gio may da chinh
  "workers": 4
}
engine_dir bo trong thi dung thu muc chua file nay.

Y tuong:
  1. Lay "nhip nang luong" (onset 4 dai tan, 100 khung/giay) cua tung clip bang sync_engine
     (chiu duoc tieng vo).
  2. So tung cap clip giua 2 may khac nhau (tuong quan chuan hoa theo DOAN CHONG NHAU).
  3. Gop cac cap chac nhat truoc (giong Kruskal). Moi lan gop kiem tra: trong cung 1 may,
     clip phai di dung thu tu so file va khong chong len nhau -> loai cap khop sai.
  4. Sap cac cum theo so thu tu ten file (khong dung gio quay vi gio co the sai).
  5. Bo moi khoang trong (doan khong may nao quay), cac cum noi lien nhau.
In ra tien trinh tung dong JSON; ket qua ghi vao <ket_qua.json>.
"""
from __future__ import annotations

import json
import os
import re
import sys
import time
from concurrent.futures import ThreadPoolExecutor

import numpy as np

# ---- nguong (co the chinh) ----
MIN_OV_S = 3.0        # doan chong toi thieu de tin (giay)
EXCL_S = 1.0          # bo +-1 s quanh dinh khi tim dinh thu 2
S_MIN = 0.45          # do tuong quan toi thieu
R_MIN = 1.5           # dinh 1 / dinh 2 toi thieu
S_GREEN = 0.4         # chac chan (xanh)
R_GREEN = 2.5
ORDER_TOL = 0.5       # cho phep chong nhau 0.5 s giua 2 clip cung may (sai so)
CONS_TOL = 0.12
CLOCK_TOL = 8.0       # audio va gio da chinh lech qua 8 s -> coi cap audio la sai
CLOSE_GAPS = True     # bo khoang trong giua cac doan (cong tac "Gap lai")
REC_CAM = None        # chi so "may" cua file Recorder (None = khong co)


def accept(r):
    """Nguong hieu chinh tren du lieu that (08/11/2026): ratio cao thi chap nhan score thap hon."""
    s, ra = r["score"], r["ratio"]
    return (ra >= 2.5 and s >= 0.25) or (ra >= 2.0 and s >= 0.3) or (ra >= R_MIN and s >= S_MIN)


def out(o):
    print(json.dumps(o, ensure_ascii=False), flush=True)


def file_num(path):
    """So thu tu trong ten file: 'BAO HQ 0066.MP4' -> 66, 'DG6704.MP4' -> 6704."""
    m = re.findall(r"(\d+)", os.path.splitext(os.path.basename(path))[0])
    return int(m[-1]) if m else 0


def pow2(n):
    return 1 << int(np.ceil(np.log2(max(n, 2))))


class Clip:
    def __init__(self, cam, idx, path):
        self.cam, self.idx, self.path = cam, idx, path
        self.name = os.path.basename(path)
        self.num = file_num(path)
        self.feat = None          # (4, n)
        self.n = 0
        self.dur = 0.0
        self.cum = None
        self.err = ""
        self.ctime = None
        self._fft = {}

    def prep(self, FR):
        e = (self.feat.astype(np.float64) ** 2).sum(0)
        self.cum = np.concatenate([[0.0], np.cumsum(e)])
        self.n = self.feat.shape[1]
        if not self.dur:
            self.dur = self.n / FR

    def fft(self, N):
        f = self._fft.get(N)
        if f is None:
            if len(self._fft) > 3:
                self._fft.clear()
            f = np.fft.rfft(self.feat, N, axis=1).astype(np.complex64)
            self._fft[N] = f
        return f


def pair_corr(a: Clip, b: Clip, FR):
    """Tim lag (khung) sao cho b bat dau tai thoi diem a.start + lag. Chuan hoa theo doan chong."""
    ma, mb = a.n, b.n
    minov = int(min(MIN_OV_S * FR, ma, mb))
    if minov < 100:          # clip < 1 giay: bo
        return None
    N = pow2(ma + mb)
    c = np.fft.irfft((a.fft(N) * np.conj(b.fft(N))).sum(0), N)
    L0, L1 = -(mb - minov), ma - minov
    lags = np.arange(L0, L1 + 1)
    vals = c[lags % N]
    t0 = np.maximum(0, lags)                 # doan chong tren a: [t0, t1)
    t1 = np.minimum(ma, mb + lags)
    ea = a.cum[t1] - a.cum[t0]
    eb = b.cum[t1 - lags] - b.cum[t0 - lags]
    ncc = vals / np.sqrt(np.maximum(ea * eb, 1e-12))
    # phat nhe doan chong ngan (de khong bi dinh gia o 2 dau)
    ov = (t1 - t0) / float(min(ma, mb))
    ncc = ncc * np.minimum(1.0, 0.75 + 0.25 * ov / 0.5)
    k = int(np.argmax(ncc))
    peak = float(ncc[k])
    excl = np.abs(lags - lags[k]) > int(EXCL_S * FR)
    second = float(ncc[excl].max()) if excl.any() else 0.0
    frac = 0.0
    if 0 < k < len(ncc) - 1:
        x, y, z = ncc[k - 1], ncc[k], ncc[k + 1]
        den = x - 2 * y + z
        if den < 0:
            frac = float(np.clip(0.5 * (x - z) / den, -0.5, 0.5))
    return {"lag": (lags[k] + frac) / FR, "score": peak, "ratio": peak / max(second, 1e-3),
            "ov": float(t1[k] - t0[k]) / FR}


class Cluster:
    """Mot cum clip da khop voi nhau. pos = vi tri bat dau (giay) so voi goc cum."""

    def __init__(self, clip):
        self.members = {clip: 0.0}

    def valid(self, pos, max_hole=2):
        by = {}
        for c, p in pos.items():
            by.setdefault(c.cam, []).append((c.idx, p, c))
        for lst in by.values():
            lst.sort()
            for (i1, p1, c1), (i2, p2, c2) in zip(lst, lst[1:]):
                if p2 < p1 + c1.dur - ORDER_TOL:     # sai thu tu hoac chong nhau
                    return False
                if i2 - i1 - 1 > max_hole:           # bo qua qua nhieu clip o giua -> nghi khop sai
                    return False
        return True


def conf_of(c, k, best):
    r = best[c]
    if len(k.members) < 2:
        return "red"
    if r and r["score"] >= S_GREEN and r["ratio"] >= R_GREEN:
        return "green"
    return "lime"


def row(c, conf, rec, cluster, best):
    r = best[c]
    return {"cam": c.cam, "path": c.path, "name": c.name, "num": c.num, "dur": round(c.dur, 3),
            "cluster": cluster, "rec": round(rec, 4), "conf": conf,
            "score": round(r["score"], 3) if r else None,
            "ratio": round(r["ratio"], 2) if r else None, "note": c.err}


def compress(items):
    """items: [(start, dur, payload)] -> [(rec, payload)], bo moi khoang trong. Tra ve (list, tong do dai).
    CLOSE_GAPS = False: chi dua diem dau ve 0, giu nguyen khoang trong that."""
    items = sorted(items, key=lambda x: x[0])
    if not CLOSE_GAPS:
        if not items:
            return [], 0.0
        s0 = items[0][0]
        return [(s - s0, p) for s, d, p in items], max(s + d for s, d, _ in items) - s0
    merged = []
    for s, d, _ in items:
        e = s + d
        if merged and s <= merged[-1][1]:
            merged[-1][1] = max(merged[-1][1], e)
        else:
            merged.append([s, e])
    starts = [m[0] for m in merged]
    shift = []
    acc = merged[0][0] if merged else 0.0
    for k, (s, e) in enumerate(merged):
        if k:
            acc += s - merged[k - 1][1]
        shift.append(acc)
    import bisect
    outl = []
    for s, d, p in items:
        k = bisect.bisect_right(starts, s + 1e-6) - 1
        outl.append((s - shift[max(k, 0)], p))
    return outl, sum(e - s for s, e in merged)


def layout_filenum(cl_list, best, ncams):
    """Chi audio: sap cum theo so thu tu ten file, bo khoang trong."""
    key = {}
    for cam in range(ncams):
        anchors = sorted(((min(c.idx for c in k.members if c.cam == cam), key[id(k)])
                          for k in cl_list if id(k) in key and any(c.cam == cam for c in k.members)))
        for k in cl_list:
            if id(k) in key:
                continue
            mine = [c.idx for c in k.members if c.cam == cam]
            if not mine:
                continue
            i = min(mine)
            if not anchors:
                key[id(k)] = float(i)
                continue
            prev = [a for a in anchors if a[0] < i]
            nxt = [a for a in anchors if a[0] > i]
            if prev and nxt:
                (pi, pk), (ni, nk) = prev[-1], nxt[0]
                key[id(k)] = pk + (nk - pk) * (i - pi) / (ni - pi)
            elif prev:
                pi, pk = prev[-1]
                key[id(k)] = pk + (i - pi) * 1e-3 + 1e-6
            else:
                ni, nk = nxt[0]
                key[id(k)] = nk - (ni - i) * 1e-3 - 1e-6
    cl_list.sort(key=lambda k: key.get(id(k), 1e9))
    res, t_rec = [], 0.0
    for ci, k in enumerate(cl_list):
        base = min(k.members.values())
        placed, length = compress([(p - base, c.dur, c) for c, p in k.members.items()])
        for rec, c in placed:
            res.append(row(c, conf_of(c, k, best), t_rec + rec, ci, best))
        t_rec += length
    return res, t_rec


def layout_clock(cl_list, clips, best, ncams):
    """Audio truoc; clip khong khop audio dat theo gio may DA CHINH (do lech moi may do tu cac cap khop audio)."""
    multi = [k for k in cl_list if len(k.members) > 1]
    info = {}
    hyp = 0
    offs = {0: 0.0}
    # chon gia thuyet gio tao = luc bat dau (0) hay luc ket thuc (1), va do lech moi may so voi may 1
    best_h, best_spread, best_offs = 0, None, None
    for h in (0, 1):
        o, spread = {0: 0.0}, 0.0
        ok = True
        for cam in range(1, ncams):
            ds = []
            for k in multi:
                a = [c for c in k.members if c.cam == 0 and c.ctime]
                b = [c for c in k.members if c.cam == cam and c.ctime]
                for x in a:
                    for y in b:
                        tx = x.ctime - (x.dur if h else 0)
                        ty = y.ctime - (y.dur if h else 0)
                        ds.append((ty - tx) - (k.members[y] - k.members[x]))
            if len(ds) < 3:
                if cam == REC_CAM:      # Recorder thieu cap: khong dung gio cua Recorder, cac may quay van chinh duoc
                    continue
                ok = False
                break
            med = float(np.median(ds))
            o[cam] = med
            spread += float(np.median(np.abs(np.array(ds) - med)))
            info[f"cam{cam + 1}_lech_giay"] = round(med, 2)
            info[f"cam{cam + 1}_so_cap"] = len(ds)
        if ok and (best_spread is None or spread < best_spread):
            best_h, best_spread, best_offs = h, spread, o
    if best_offs is None:
        info["loi"] = "Không đủ cặp khớp audio để chỉnh giờ máy -> chỉ dùng audio"
        r, t = layout_filenum(cl_list, best, ncams)
        return r, t, info
    info["gio_tao_la"] = "lúc kết thúc quay" if best_h else "lúc bắt đầu quay"
    info["sai_so_giay"] = round(best_spread, 2)

    def clock(c):
        return c.ctime - (c.dur if best_h else 0) - best_offs.get(c.cam, 0.0)

    def has_clock(c):
        return bool(c.ctime) and c.cam in best_offs

    placed = []        # (abs_start, dur, (clip, cluster_id, conf))
    detached = []
    tail = []
    for ci, k in enumerate(cl_list):
        mem = list(k.members.items())
        withc = [clock(c) - p for c, p in mem if has_clock(c)]
        if not withc:
            for c, p in mem:
                tail.append((c, ci))
            continue
        anchor = float(np.median(withc))
        for c, p in mem:
            conf = conf_of(c, k, best)
            pos = anchor + p
            if conf == "red":
                conf = "yellow"           # dat theo gio da chinh
            elif has_clock(c) and abs((clock(c) - p) - anchor) > CLOCK_TOL:
                conf = "yellow"           # audio va gio lech qua xa -> nghi khop audio sai, dat theo gio
                pos = clock(c)
                detached.append(c.name)
            placed.append([pos, c.dur, (c, ci, conf)])
    # tranh chong nhau trong cung 1 may: day clip dat theo gio (vang) ra
    for cam in range(ncams):
        L = sorted((x for x in placed if x[2][0].cam == cam), key=lambda x: x[0])
        for a, b in zip(L, L[1:]):
            if b[0] < a[0] + a[1]:
                if b[2][2] == "yellow":
                    b[0] = a[0] + a[1]
                elif a[2][2] == "yellow":
                    a[0] = b[0] - a[1]
    info["tach_khoi_cum"] = detached
    lst, total = compress([(s, d, p) for s, d, p in placed])
    res = [row(c, conf, rec, ci, best) for rec, (c, ci, conf) in lst]
    for c, ci in tail:
        res.append(row(c, "red", total, ci, best))
        total += c.dur
    return res, total, info


def main():
    cfg = json.load(open(sys.argv[1], encoding="utf-8"))
    out_path = sys.argv[2]
    sys.path.insert(0, cfg.get("engine_dir") or os.path.dirname(os.path.abspath(__file__)))
    global S_MIN, R_MIN, S_GREEN, R_GREEN, CLOSE_GAPS, REC_CAM
    S_MIN = float(cfg.get("s_min", S_MIN)); R_MIN = float(cfg.get("r_min", R_MIN))
    S_GREEN = float(cfg.get("s_green", S_GREEN)); R_GREEN = float(cfg.get("r_green", R_GREEN))
    CLOSE_GAPS = bool(cfg.get("close_gaps", True))
    import sync_engine as se
    FR = se.FR

    cams = list(cfg["cams"])
    if cfg.get("recorder"):
        REC_CAM = len(cams)
        cams.append({"name": "Recorder", "files": cfg["recorder"]})
    clips = []
    for ci, cam in enumerate(cams):
        files = sorted(cam["files"], key=lambda p: (file_num(p), os.path.basename(p).lower()))
        for i, p in enumerate(files):
            clips.append(Clip(ci, i, p))
    total = len(clips)
    out({"type": "log", "msg": f"{len(cams) - (REC_CAM is not None)} máy" + (" + Recorder" if REC_CAM is not None else "") + f", {total} clip"})

    # 1. dac trung (song song, co cache)
    t_start = time.time()

    def load(c):
        try:
            info = se.probe(c.path)
            c.dur = info.get("duration") or 0.0
            c.ctime = info.get("creation") or info.get("mtime")
            if not info.get("has_audio"):
                c.err = "Không có audio"
                return c
            c.feat = se.get_features(c.path)
            c.prep(FR)
        except Exception as e:  # noqa
            c.err = f"Lỗi đọc: {e}"
        return c

    done = 0
    with ThreadPoolExecutor(max_workers=int(cfg.get("workers", 4))) as ex:
        for _ in ex.map(load, clips):
            done += 1
            if done % 5 == 0 or done == total:
                out({"type": "progress", "f": round(0.6 * done / total, 3), "msg": f"Đọc audio {done}/{total}"})
    out({"type": "log", "msg": f"Đọc audio xong sau {time.time() - t_start:.0f} giây"})

    good = [c for c in clips if c.feat is not None and c.n >= 100]

    # 2. so tung cap giua 2 may khac nhau
    edges = []
    allpairs = []
    pairs = [(a, b) for i, a in enumerate(good) for b in good[i + 1:] if a.cam != b.cam]
    t1 = time.time()
    for k, (a, b) in enumerate(pairs):
        r = pair_corr(a, b, FR)
        if r and r["score"] >= 0.2:
            allpairs.append([a.name, b.name, round(r["score"], 3), round(r["ratio"], 2), round(r["lag"], 3), round(r["ov"], 1)])
        if r and accept(r):
            edges.append((a, b, r))
        if k % 500 == 0:
            out({"type": "progress", "f": round(0.6 + 0.35 * k / max(len(pairs), 1), 3),
                 "msg": f"So khớp {k}/{len(pairs)} cặp"})
    out({"type": "log", "msg": f"So {len(pairs)} cặp sau {time.time() - t1:.0f} giây, {len(edges)} cặp đạt ngưỡng"})

    # 3. gop cum: cap chac nhat truoc, kiem tra thu tu trong tung may
    clus = {c: Cluster(c) for c in clips}
    best = {c: None for c in clips}        # cap tot nhat da dung cho clip
    edges.sort(key=lambda e: -(e[2]["score"] * min(e[2]["ratio"], 4.0)))
    accepted = rejected = 0
    for a, b, r in edges:
        ca, cb = clus[a], clus[b]
        if ca is cb:
            if abs(ca.members[b] - (ca.members[a] + r["lag"])) < CONS_TOL:
                for c in (a, b):
                    if best[c] is None or r["score"] > best[c]["score"]:
                        best[c] = r
            continue
        delta = ca.members[a] + r["lag"] - cb.members[b]
        merged = dict(ca.members)
        for c, p in cb.members.items():
            merged[c] = p + delta
        strong = r["score"] >= S_GREEN and r["ratio"] >= R_GREEN
        if not ca.valid(merged, max_hole=6 if strong else 1):
            rejected += 1
            continue
        accepted += 1
        ca.members = merged
        for c in cb.members:
            clus[c] = ca
        for c in (a, b):
            if best[c] is None or r["score"] > best[c]["score"]:
                best[c] = r
    out({"type": "log", "msg": f"Gộp {accepted} cặp, loại {rejected} cặp sai thứ tự"})

    cl_list = list({id(c): c for c in clus.values()}.values())
    if cfg.get("clock_fallback"):
        res_clips, t_rec, clock_info = layout_clock(cl_list, clips, best, len(cams))
        out({"type": "log", "msg": "Đồng hồ: " + json.dumps(clock_info, ensure_ascii=False)})
    else:
        res_clips, t_rec = layout_filenum(cl_list, best, len(cams))
        clock_info = None
    nmulti = sum(1 for k in cl_list if len(k.members) > 1)
    res_clips.sort(key=lambda r: r["rec"])
    summary = {
        "clips": total, "clusters": len(cl_list), "multi_clusters": nmulti,
        "green": sum(1 for r in res_clips if r["conf"] == "green"),
        "yellow": sum(1 for r in res_clips if r["conf"] == "yellow"),
        "lime": sum(1 for r in res_clips if r["conf"] == "lime"),
        "red": sum(1 for r in res_clips if r["conf"] == "red"),
        "total_sec": round(t_rec, 2),
    }
    summary["clock"] = clock_info
    summary["pairs_compared"] = len(pairs)
    summary["recorder_cam"] = REC_CAM
    json.dump({"cams": [c["name"] for c in cams], "summary": summary, "clips": res_clips, "pairs": allpairs},
              open(out_path, "w", encoding="utf-8"), ensure_ascii=False, indent=1)
    out({"type": "done", "summary": summary})


if __name__ == "__main__":
    main()
