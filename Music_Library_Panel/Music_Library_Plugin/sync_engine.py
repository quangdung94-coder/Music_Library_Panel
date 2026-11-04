# -*- coding: utf-8 -*-
"""
sync_engine.py - Bộ máy đồng bộ âm thanh chịu được tiếng máy quay bị vỡ (clipping).

Ý tưởng:
  * Không so sánh dạng sóng thô (thứ bị phá hỏng khi tiếng vỡ) mà so sánh
    "nhịp năng lượng" (onset / spectral flux) theo 4 dải tần. Khi tiếng bị
    clipping, biên độ bị bẹt nhưng THỜI ĐIỂM các âm tiết, tiếng vỗ tay, nhạc
    nổi lên vẫn giữ nguyên -> vẫn khớp được.
  * Bước 1: tìm thô trên toàn bộ file Audio Sync (độ phân giải 10 ms).
  * Bước 2: clip nào yếu -> dùng đồng hồ máy quay (creation_time) của các clip
    đã khớp chắc chắn để khoanh vùng tìm lại trong cửa sổ hẹp.
  * Bước 3: tinh chỉnh tới mức mẫu (0.125 ms) bằng GCC-PHAT, có che các mẫu
    bị clipping. Clip dài thì đo luôn độ trôi (drift) giữa 2 máy.

Chỉ cần: numpy + imageio-ffmpeg (tự mang theo ffmpeg.exe).
"""
from __future__ import annotations

import datetime as _dt
import hashlib
import os
import re
import subprocess
from concurrent.futures import ThreadPoolExecutor
from dataclasses import dataclass, field
from typing import Callable, Dict, List, Optional

import numpy as np

SR = 8000            # tần số lấy mẫu dùng để phân tích
HOP = 80             # 10 ms / khung
FR = SR / HOP        # 100 khung / giây
NFFT = 512
NBANDS = 24
NGROUPS = 4

AUDIO_EXTS = {".wav", ".bwf", ".mp3", ".aif", ".aiff", ".flac", ".m4a", ".ogg"}

_NOWIN = 0x08000000 if os.name == "nt" else 0   # CREATE_NO_WINDOW


# --------------------------------------------------------------------------- #
# ffmpeg helpers
# --------------------------------------------------------------------------- #
_FF = None


def ffmpeg_exe() -> str:
    global _FF
    if _FF:
        return _FF
    try:
        import imageio_ffmpeg
        _FF = imageio_ffmpeg.get_ffmpeg_exe()
    except Exception:
        _FF = "ffmpeg"
    return _FF


def _run(cmd: List[str]) -> subprocess.CompletedProcess:
    return subprocess.run(cmd, capture_output=True, creationflags=_NOWIN)


def probe(path: str) -> dict:
    """Đọc thông tin file bằng `ffmpeg -i` (không cần ffprobe)."""
    p = _run([ffmpeg_exe(), "-hide_banner", "-i", path])
    txt = p.stderr.decode("utf-8", "replace")
    info = {"path": path, "duration": 0.0, "creation": None, "acodec": None,
            "sr": None, "channels": None, "has_video": False, "has_audio": False}
    m = re.search(r"Duration:\s*(\d+):(\d+):(\d+(?:\.\d+)?)", txt)
    if m:
        info["duration"] = int(m.group(1)) * 3600 + int(m.group(2)) * 60 + float(m.group(3))
    m = re.search(r"creation_time\s*:\s*(\S+)", txt)
    if m:
        s = m.group(1).strip()
        try:
            d = _dt.datetime.fromisoformat(s.replace("Z", "+00:00"))
            if d.tzinfo is None:
                d = d.replace(tzinfo=_dt.timezone.utc)
            info["creation"] = d.timestamp()
        except Exception:
            pass
    m = re.search(r"Stream #[^:\n]+:\d+\S*: Audio: (\w+)[^\n]*?(\d+) Hz, ([^,\n]+)", txt)
    if m:
        info["has_audio"] = True
        info["acodec"] = m.group(1)
        info["sr"] = int(m.group(2))
        lay = m.group(3).strip()
        nch = {"mono": 1, "stereo": 2, "quad": 4}.get(lay)
        if nch is None:
            mm = re.match(r"(\d+)", lay)
            nch = int(mm.group(1)) if mm else 2
        info["channels"] = nch
    info["has_video"] = bool(re.search(r"Stream #[^\n]*: Video:", txt))
    try:
        info["mtime"] = os.path.getmtime(path)
    except OSError:
        info["mtime"] = None
    return info


def decode(path: str, start: Optional[float] = None, dur: Optional[float] = None,
           sr: int = SR) -> np.ndarray:
    """Giải mã audio -> mono float32 ở `sr` Hz."""
    cmd = [ffmpeg_exe(), "-hide_banner", "-loglevel", "error", "-nostdin"]
    if start is not None and start > 0:
        cmd += ["-ss", f"{start:.6f}"]
    cmd += ["-i", path]
    if dur is not None:
        cmd += ["-t", f"{max(dur, 0.01):.6f}"]
    cmd += ["-vn", "-sn", "-dn", "-ac", "1", "-ar", str(sr), "-f", "f32le", "-"]
    p = _run(cmd)
    if p.returncode != 0 and not p.stdout:
        raise RuntimeError(f"Không giải mã được: {path}\n{p.stderr.decode('utf-8', 'replace')[-400:]}")
    return np.frombuffer(p.stdout, dtype=np.float32).copy()


# --------------------------------------------------------------------------- #
# Đặc trưng (feature)
# --------------------------------------------------------------------------- #
def _band_matrix() -> np.ndarray:
    freqs = np.fft.rfftfreq(NFFT, 1.0 / SR)
    edges = np.geomspace(120.0, 3800.0, NBANDS + 1)
    W = np.zeros((len(freqs), NBANDS), np.float32)
    for b in range(NBANDS):
        sel = (freqs >= edges[b]) & (freqs < edges[b + 1])
        if not sel.any():
            sel[np.argmin(np.abs(freqs - (edges[b] + edges[b + 1]) / 2))] = True
        W[sel, b] = 1.0
    return W


_W = _band_matrix()
_WIN = np.hanning(NFFT).astype(np.float32)


def log_bands(x: np.ndarray) -> np.ndarray:
    """Năng lượng log theo 24 dải, khung 10 ms. Trả về (n_frames, 24)."""
    if len(x) < NFFT:
        x = np.pad(x, (0, NFFT - len(x)))
    n = 1 + (len(x) - NFFT) // HOP
    sw = np.lib.stride_tricks.sliding_window_view(x, NFFT)[::HOP]
    out = np.empty((n, NBANDS), np.float32)
    B = 16384
    for i in range(0, n, B):
        fr = sw[i:i + B] * _WIN
        S = np.abs(np.fft.rfft(fr, axis=1)) ** 2
        out[i:i + B] = np.log10(S.astype(np.float32) @ _W + 1e-9)
    return out


def _movmean(x: np.ndarray, w: int) -> np.ndarray:
    n = len(x)
    c = np.concatenate([[0.0], np.cumsum(x, dtype=np.float64)])
    idx = np.arange(n)
    i0 = np.clip(idx - w // 2, 0, n)
    i1 = np.clip(idx + w // 2 + 1, 0, n)
    return ((c[i1] - c[i0]) / np.maximum(i1 - i0, 1)).astype(np.float32)


def _normalize(d: np.ndarray) -> np.ndarray:
    d = d - _movmean(d, 101)
    sd = np.sqrt(np.maximum(_movmean(d * d, 301), 0))
    pos = sd[sd > 0]
    floor = float(np.median(pos)) * 0.5 if len(pos) else 1.0
    d = d / np.maximum(sd, max(floor, 1e-6))
    return np.clip(d, -4.0, 8.0).astype(np.float32)


def onset_features(lb: np.ndarray) -> np.ndarray:
    """Spectral flux theo 4 nhóm dải, đã chuẩn hoá cục bộ. Trả về (4, n)."""
    d = np.diff(lb, axis=0, prepend=lb[:1])
    d = np.maximum(d, 0)
    per = NBANDS // NGROUPS
    feats = []
    for g in range(NGROUPS):
        feats.append(_normalize(d[:, g * per:(g + 1) * per].sum(1)))
    return np.stack(feats)


# --------------------------------------------------------------------------- #
# Cache đặc trưng trên đĩa (khỏi giải mã lại file 2 tiếng)
# --------------------------------------------------------------------------- #
def cache_dir() -> str:
    base = os.environ.get("LOCALAPPDATA") or os.path.expanduser("~/.cache")
    d = os.path.join(base, "AudioSync", "cache")
    os.makedirs(d, exist_ok=True)
    return d


def _cache_key(path: str) -> str:
    st = os.stat(path)
    raw = f"v2|{os.path.abspath(path)}|{st.st_size}|{int(st.st_mtime)}"
    return hashlib.md5(raw.encode("utf-8")).hexdigest()


def get_features(path: str, use_cache: bool = True) -> np.ndarray:
    fn = os.path.join(cache_dir(), _cache_key(path) + ".npy") if use_cache else None
    if fn and os.path.exists(fn):
        try:
            return np.load(fn)
        except Exception:
            pass
    x = decode(path)
    f = onset_features(log_bands(x))
    del x
    if fn:
        try:
            np.save(fn, f)
        except Exception:
            pass
    return f


# --------------------------------------------------------------------------- #
# Tìm kiếm tương quan
# --------------------------------------------------------------------------- #
def _pow2(n: int) -> int:
    return 1 << int(np.ceil(np.log2(max(n, 2))))


class RefTrack:
    """Một file Audio Sync đã phân tích."""

    def __init__(self, path: str, feat: np.ndarray, info: dict):
        self.path = path
        self.name = os.path.basename(path)
        self.feat = feat
        self.info = info
        self.n = feat.shape[1]
        self.duration = info.get("duration") or self.n / FR
        e = (feat.astype(np.float64) ** 2).sum(0)
        self.cum = np.concatenate([[0.0], np.cumsum(e)])
        self._fft: Dict[int, np.ndarray] = {}

    def fft(self, N: int) -> np.ndarray:
        if N not in self._fft:
            if len(self._fft) > 2:
                self._fft.clear()
            self._fft[N] = np.fft.rfft(self.feat, N, axis=1).astype(np.complex64)
        return self._fft[N]


def correlate(cam: np.ndarray, ref: RefTrack, lo: Optional[float] = None,
              hi: Optional[float] = None) -> Optional[dict]:
    """
    Tìm vị trí cam trong ref. Trả về offset (giây) = thời điểm trong file Audio Sync
    ứng với giây 0 của clip máy quay. lo/hi (giây) để giới hạn vùng tìm.
    """
    m = cam.shape[1]
    n = ref.n
    if m < 50 or n < 50:
        return None
    minov = min(m, 500)
    N = _pow2(n + m)
    R = ref.fft(N)
    C = np.fft.rfft(cam, N, axis=1)
    c = np.fft.irfft((R * np.conj(C)).sum(0), N)

    L0, L1 = -(m - minov), n - minov
    if lo is not None:
        L0 = max(L0, int(np.floor(lo * FR)))
    if hi is not None:
        L1 = min(L1, int(np.ceil(hi * FR)))
    if L1 - L0 < 3:
        return None
    lags = np.arange(L0, L1 + 1)
    vals = c[lags % N]
    ce = np.concatenate([[0.0], np.cumsum((cam.astype(np.float64) ** 2).sum(0))])
    t0 = np.maximum(0, -lags)
    t1 = np.minimum(m, n - lags)
    re_ = ref.cum[t1 + lags] - ref.cum[t0 + lags]
    ncc = vals / np.sqrt(ce[-1] * np.maximum(re_, 1e-9))

    k = int(np.argmax(ncc))
    peak = float(ncc[k])
    excl = np.abs(lags - lags[k]) > 100          # bỏ ±1 s quanh đỉnh
    second = float(ncc[excl].max()) if excl.any() else 0.0
    frac = 0.0
    if 0 < k < len(ncc) - 1:
        a, b, cc = ncc[k - 1], ncc[k], ncc[k + 1]
        den = a - 2 * b + cc
        if den < 0:
            frac = float(np.clip(0.5 * (a - cc) / den, -0.5, 0.5))
    return {"offset": (lags[k] + frac) / FR, "score": peak,
            "ratio": peak / max(second, 1e-3)}


def _gcc(cam_path: str, ref_path: str, off: float, t0: float, win: float,
         maxlag: float) -> Optional[tuple]:
    """GCC-PHAT trên đoạn [t0, t0+win] của clip. Trả về (offset_mới, z)."""
    cam = decode(cam_path, start=t0, dur=win)
    rs = off + t0 - maxlag
    ref = decode(ref_path, start=max(rs, 0.0), dur=win + 2 * maxlag)
    if rs < 0:
        ref = np.concatenate([np.zeros(int(round(-rs * SR)), np.float32), ref])
    if len(cam) < SR or len(ref) < SR:
        return None
    # che các mẫu bị clipping (vỡ tiếng) để không làm nhiễu pha
    pk = np.max(np.abs(cam))
    if pk > 0:
        bad = np.abs(cam) > 0.92 * pk
        if bad.mean() < 0.3:
            bad = np.convolve(bad.astype(np.float32), np.ones(5, np.float32), "same") > 0
            cam = np.where(bad, 0.0, cam).astype(np.float32)
    N = _pow2(len(cam) + len(ref))
    X = np.fft.rfft(cam, N)
    Y = np.fft.rfft(ref, N)
    G = Y * np.conj(X)
    G /= np.abs(G) + 1e-12
    f = np.fft.rfftfreq(N, 1.0 / SR)
    G[(f < 150) | (f > 3500)] = 0
    r = np.fft.irfft(G, N)
    L = int(round(2 * maxlag * SR))
    seg = r[:L + 1]
    k = int(np.argmax(seg))
    noise = np.delete(seg, np.arange(max(0, k - 40), min(len(seg), k + 41)))
    if len(noise) < 10:
        noise = r[L + 1:L + 4001]
    z = (seg[k] - np.median(noise)) / (np.std(noise) + 1e-12)
    frac = 0.0
    if 0 < k < len(seg) - 1:
        a, b, c = seg[k - 1], seg[k], seg[k + 1]
        den = a - 2 * b + c
        if den < 0:
            frac = float(np.clip(0.5 * (a - c) / den, -0.5, 0.5))
    return off + (k + frac) / SR - maxlag, float(z)


# --------------------------------------------------------------------------- #
# Kết quả
# --------------------------------------------------------------------------- #
OK = "OK"
OK_CLOCK = "OK (đồng hồ)"
CHECK = "KIỂM TRA"
ESTIMATE = "ƯỚC LƯỢNG"
FAIL = "CHƯA SYNC"


@dataclass
class ClipResult:
    path: str
    name: str
    duration: float = 0.0
    cam_time: Optional[float] = None      # creation_time (epoch)
    group: str = ""                       # thư mục = 1 máy quay/1 thẻ
    ref: Optional[str] = None             # path file Audio Sync
    offset: Optional[float] = None        # giây trong file Audio Sync ứng với giây 0 của clip
    score: float = 0.0
    ratio: float = 0.0
    status: str = FAIL
    refined: bool = False
    gcc_z: float = 0.0
    drift_ms: Optional[float] = None
    note: str = ""
    feat: Optional[np.ndarray] = field(default=None, repr=False)


@dataclass
class Settings:
    thr_score: float = 0.08     # độ tương quan tối thiểu
    thr_ratio: float = 1.50     # đỉnh 1 / đỉnh 2
    window: float = 180.0       # ± giây khi tìm lại theo đồng hồ
    thr_score_clock: float = 0.06
    thr_ratio_clock: float = 1.15
    thr_gcc: float = 8.0        # độ nổi đỉnh GCC-PHAT để xác nhận clip khó
    refine: bool = True
    drift: bool = True
    workers: int = 3


# --------------------------------------------------------------------------- #
# Engine
# --------------------------------------------------------------------------- #
class SyncEngine:
    def __init__(self, log: Callable[[str], None] = print,
                 progress: Callable[[float, str], None] = lambda f, m: None):
        self.log = log
        self.progress = progress
        self.refs: Dict[str, RefTrack] = {}
        self.cancel = False

    # ---- nạp ----
    def load_ref(self, path: str) -> RefTrack:
        key = os.path.abspath(path)
        if key in self.refs:
            return self.refs[key]
        info = probe(path)
        self.log(f"Đọc file Audio Sync: {os.path.basename(path)} ({info['duration'] / 60:.1f} phút)…")
        feat = get_features(path)
        r = RefTrack(path, feat, info)
        self.refs[key] = r
        return r

    def _load_cam(self, path: str) -> ClipResult:
        info = probe(path)
        res = ClipResult(path=path, name=os.path.basename(path),
                         duration=info["duration"],
                         cam_time=info["creation"] or info.get("mtime"),
                         group=os.path.dirname(os.path.abspath(path)))
        if not info["has_audio"]:
            res.note = "Clip không có audio"
            return res
        res.feat = get_features(path)
        if not res.duration:
            res.duration = res.feat.shape[1] / FR
        return res

    # ---- chính ----
    def analyze(self, ref_paths: List[str], cam_paths: List[str],
                st: Settings = Settings()) -> List[ClipResult]:
        self.cancel = False
        refs = []
        for i, p in enumerate(ref_paths):
            self.progress(0.02 + 0.18 * i / max(len(ref_paths), 1), f"Phân tích Audio Sync {i + 1}/{len(ref_paths)}")
            refs.append(self.load_ref(p))
        if not refs:
            raise RuntimeError("Chưa có file Audio Sync nào.")

        # 1. đọc đặc trưng các clip (song song)
        results: List[ClipResult] = [None] * len(cam_paths)
        done = 0
        with ThreadPoolExecutor(max_workers=max(1, st.workers)) as ex:
            futs = {ex.submit(self._load_cam, p): i for i, p in enumerate(cam_paths)}
            for fu in futs:
                i = futs[fu]
                try:
                    results[i] = fu.result()
                except Exception as e:  # noqa
                    results[i] = ClipResult(path=cam_paths[i], name=os.path.basename(cam_paths[i]),
                                            note=f"Lỗi đọc: {e}")
                done += 1
                self.progress(0.2 + 0.35 * done / len(cam_paths), f"Đọc clip {done}/{len(cam_paths)}")
                if self.cancel:
                    raise RuntimeError("Đã huỷ")

        # 2. tìm toàn cục
        for i, r in enumerate(results):
            self.progress(0.55 + 0.15 * i / len(results), f"So khớp {r.name}")
            if r.feat is None:
                continue
            best = None
            for ref in refs:
                m = correlate(r.feat, ref)
                if m and (best is None or m["score"] > best[1]["score"]):
                    best = (ref, m)
            if best:
                ref, m = best
                r.ref, r.offset, r.score, r.ratio = ref.path, m["offset"], m["score"], m["ratio"]
                if m["score"] >= st.thr_score and m["ratio"] >= st.thr_ratio:
                    r.status = OK
                elif m["ratio"] >= 1.12 and self._verify(r) >= st.thr_gcc:
                    r.status = OK
                    r.note = "Xác nhận bằng GCC-PHAT"
                else:
                    r.status = FAIL
                    r.note = "Tương quan yếu"
            if self.cancel:
                raise RuntimeError("Đã huỷ")

        # 3. pass 2 theo đồng hồ máy quay
        self.progress(0.72, "Dùng đồng hồ máy quay cho clip khó…")
        self._clock_pass(results, refs, st)

        # 4. tinh chỉnh + drift
        if st.refine:
            todo = [r for r in results if r.status in (OK, OK_CLOCK, CHECK) and r.offset is not None]
            for i, r in enumerate(todo):
                self.progress(0.78 + 0.2 * i / max(len(todo), 1), f"Tinh chỉnh {r.name}")
                try:
                    self._refine(r, st)
                except Exception as e:  # noqa
                    r.note = (r.note + f"; lỗi tinh chỉnh: {e}").strip("; ")
                if self.cancel:
                    raise RuntimeError("Đã huỷ")

        for r in results:
            r.feat = None
        self.progress(1.0, "Xong")
        return results

    # ---- pass 2 ----
    def _clock_pass(self, results: List[ClipResult], refs: List[RefTrack], st: Settings):
        by_path = {r.path: r for r in refs}
        groups: Dict[str, List[ClipResult]] = {}
        for r in results:
            if r.cam_time is not None:
                groups.setdefault(r.group, []).append(r)

        for g, clips in groups.items():
            anchors = [c for c in clips if c.status == OK]
            if not anchors:
                continue
            # 2 giả thuyết: creation_time = lúc BẮT ĐẦU hay KẾT THÚC quay
            best_h, best_spread = 0, None
            for h in (0, 1):
                per_ref: Dict[str, list] = {}
                for a in anchors:
                    t = a.cam_time - (a.duration if h else 0)
                    per_ref.setdefault(a.ref, []).append(t - a.offset)
                spread = 0.0
                for v in per_ref.values():
                    if len(v) > 1:
                        spread += float(np.median(np.abs(np.array(v) - np.median(v))))
                if best_spread is None or spread < best_spread:
                    best_h, best_spread = h, spread
            base: Dict[str, float] = {}       # thời điểm (theo đồng hồ máy quay) file Audio Sync bắt đầu
            per_ref = {}
            for a in anchors:
                t = a.cam_time - (a.duration if best_h else 0)
                per_ref.setdefault(a.ref, []).append(t - a.offset)
            for k, v in per_ref.items():
                base[k] = float(np.median(v))

            # anchor lệch nhiều so với số đông -> nghi ngờ
            for a in anchors:
                if len(per_ref[a.ref]) >= 3:
                    t = a.cam_time - (a.duration if best_h else 0)
                    if abs((t - a.offset) - base[a.ref]) > 30 and a.ratio < 3:
                        a.status = CHECK
                        a.note = "Lệch so với đồng hồ máy quay"

            for c in clips:
                if c.status != FAIL or c.feat is None:
                    continue
                t = c.cam_time - (c.duration if best_h else 0)
                cand = None
                for rp, b in base.items():
                    pred = t - b
                    ref = by_path[rp]
                    m = correlate(c.feat, ref, pred - st.window, pred + st.window)
                    if m and (cand is None or m["score"] > cand[2]["score"]):
                        cand = (rp, pred, m)
                if cand is None:
                    continue
                rp, pred, m = cand
                c.ref, c.offset, c.score, c.ratio = rp, m["offset"], m["score"], m["ratio"]
                plausible = m["score"] >= st.thr_score_clock and m["ratio"] >= st.thr_ratio_clock
                if self._verify(c) >= st.thr_gcc or (plausible and m["ratio"] >= 1.3 and c.duration >= 15):
                    c.status = OK_CLOCK
                    c.note = "Tìm lại trong vùng đồng hồ máy quay"
                elif plausible:
                    c.status = CHECK
                    c.note = "Khớp yếu trong vùng đồng hồ máy quay - nghe lại"
                else:
                    c.ref, c.offset, c.score, c.ratio = rp, pred, m["score"], m["ratio"]
                    c.status = ESTIMATE
                    c.note = "Đặt theo đồng hồ máy quay, cần chỉnh tay"

    # ---- tinh chỉnh ----
    def _verify(self, r: ClipResult) -> float:
        """GCC-PHAT quanh offset hiện tại. Nếu đỉnh rõ thì cập nhật offset. Trả về z."""
        if r.refined:
            return r.gcc_z
        try:
            win, t0 = self._best_window(r)
            g = _gcc(r.path, r.ref, r.offset, t0, win, maxlag=0.08)
        except Exception:
            g = None
        if g:
            r.gcc_z = g[1]
            if g[1] >= 7.0:
                r.offset = g[0]
                r.refined = True
        return r.gcc_z

    def _best_window(self, r: ClipResult):
        # chọn đoạn 20 s "nhiều âm thanh" nhất trong clip
        win = min(20.0, max(r.duration - 0.2, 1.0))
        e = None
        if r.feat is not None:
            act = np.maximum(r.feat, 0).sum(0)
            w = int(win * FR)
            if len(act) > w:
                c = np.concatenate([[0], np.cumsum(act)])
                s = c[w:] - c[:-w]
                e = int(np.argmax(s)) / FR
        t0 = e if e is not None else max(0.0, r.duration / 2 - win / 2)
        return win, t0

    def _refine(self, r: ClipResult, st: Settings):
        self._verify(r)

        if st.drift and r.duration >= 300:
            w2 = 20.0
            a = _gcc(r.path, r.ref, r.offset, 5.0, w2, 0.15)
            b = _gcc(r.path, r.ref, r.offset, r.duration - w2 - 5.0, w2, 0.15)
            if a and b and a[1] >= 7 and b[1] >= 7:
                ta, tb = 5.0 + w2 / 2, r.duration - 5.0 - w2 / 2
                r.drift_ms = (b[0] - a[0]) * 1000.0
                slope = (b[0] - a[0]) / (tb - ta)
                # đặt theo giữa clip -> sai số lớn nhất chỉ còn 1/2 độ trôi
                r.offset = a[0] + slope * (r.duration / 2 - ta)
                r.refined = True


def fmt_tc(sec: Optional[float]) -> str:
    if sec is None:
        return ""
    s = "-" if sec < 0 else ""
    sec = abs(sec)
    h = int(sec // 3600)
    m = int(sec % 3600 // 60)
    return f"{s}{h:02d}:{m:02d}:{sec % 60:06.3f}"
