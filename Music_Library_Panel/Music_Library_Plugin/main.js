// Music Library panel for DaVinci Resolve Studio (Workflow Integration plugin).
const { app, BrowserWindow, ipcMain, dialog, shell } = require('electron');
const path = require('path');
const fs = require('fs');
const os = require('os');
const crypto = require('crypto');
const { spawn } = require('child_process');
const WorkflowIntegration = require('./WorkflowIntegration.node');

const PLUGIN_ID = 'com.musiclibrary.resolve.panel';
const DEFAULT_MUSIC_BIN = '02_music';
const DEFAULT_SFX_BIN = '03_sfx';

let resolveObj = null;

async function getResolve() {
    if (!resolveObj) {
        const ok = await WorkflowIntegration.Initialize(PLUGIN_ID);
        if (!ok) return null;
        resolveObj = await WorkflowIntegration.GetResolve();
    }
    return resolveObj;
}

async function getProject() {
    const resolve = await getResolve();
    if (!resolve) return null;
    const pm = await resolve.GetProjectManager();
    return pm ? await pm.GetCurrentProject() : null;
}

async function getTargetBin(mediaPool, binName = DEFAULT_MUSIC_BIN) {
    const root = await mediaPool.GetRootFolder();
    const subs = (await root.GetSubFolderList()) || [];
    for (const f of subs) {
        if ((await f.GetName()) === binName) return f;
    }
    return await mediaPool.AddSubFolder(root, binName);
}

// Tim / tao bin con theo duong dan thu muc (giong Explorer): 03_sfx/Whoosh/Big
async function getSubBin(mp, binName, sub) {
    let bin = await getTargetBin(mp, binName);
    for (const seg of (sub || '').split(/[\\/]/).filter(Boolean)) {
        if (!bin) return null;
        const subs = (await bin.GetSubFolderList()) || [];
        let next = null;
        for (const f of subs) { if ((await f.GetName()) === seg) { next = f; break; } }
        bin = next || (await mp.AddSubFolder(bin, seg));
    }
    return bin;
}

async function clipMap(bin) {
    const m = new Map();
    for (const c of ((await bin.GetClipList()) || [])) {
        const fp = await c.GetClipProperty('File Path');
        if (fp) m.set(fp.toLowerCase(), c);
    }
    return m;
}

// Dat In/Out cho clip trong Media Pool (frame tinh theo toc do timeline)
async function setRange(clip, e, fps) {
    if (e.inT == null && e.outT == null) return null;
    const endSec = e.outT != null ? e.outT : e.dur;
    if (!endSec) return null;
    const inF = Math.round((e.inT || 0) * fps);
    const outF = Math.round(endSec * fps) - (e.outT != null ? 0 : 1);
    if (outF <= inF) return null;
    let ok = await clip.SetMarkInOut(inF, outF, 'all');
    if (!ok) ok = await clip.SetMarkInOut(inF, outF, 'audio');
    return ok ? { inF, outF } : null;
}

// Import file vao Media Pool theo cay thu muc con, giu In/Out. Khong import trung file da co trong bin.
async function importEntries(project, entries, binName) {
    const mp = await project.GetMediaPool();
    const resolve = await getResolve();
    const storage = await resolve.GetMediaStorage();
    const fps = parseFloat(await project.GetSetting('timelineFrameRate')) || 24;
    const prev = await mp.GetCurrentFolder();
    const groups = new Map();
    for (const e of entries) { const k = e.sub || ''; if (!groups.has(k)) groups.set(k, []); groups.get(k).push(e); }
    const out = []; let failed = 0, ranged = 0;
    for (const [sub, list] of groups) {
        const bin = await getSubBin(mp, binName, sub);
        if (!bin) { failed += list.length; continue; }
        await mp.SetCurrentFolder(bin);
        const have = await clipMap(bin);
        const toImport = list.filter(e => !have.has(e.path.toLowerCase())).map(e => e.path);
        if (toImport.length) {
            const items = (await storage.AddItemListToMediaPool(toImport)) || [];
            if (items.length === toImport.length) items.forEach((it, i) => have.set(toImport[i].toLowerCase(), it));
            else (await clipMap(bin)).forEach((v, k) => have.set(k, v));
        }
        for (const e of list) {
            const clip = have.get(e.path.toLowerCase());
            if (!clip) { failed++; continue; }
            const range = await setRange(clip, e, fps);
            if (range) ranged++;
            out.push({ entry: e, clip, range });
        }
    }
    if (prev) await mp.SetCurrentFolder(prev);
    return { mp, out, failed, ranged };
}

// Quet toan bo Media Pool: duong dan file -> { clip, where }. where la duong dan bin, vd "02_music/Wedding/Slow".
// Clip nam trong bin dich (binName, ke ca bin con) duoc uu tien neu file co o nhieu cho.
async function poolIndex(mp, binName) {
    const idx = new Map();
    const walkBin = async (f, where, inTarget) => {
        for (const c of ((await f.GetClipList()) || [])) {
            const fp = await c.GetClipProperty('File Path');
            if (!fp) continue;
            const k = fp.toLowerCase();
            if (!idx.has(k) || (inTarget && !idx.get(k).inTarget)) idx.set(k, { clip: c, where: where || 'Master', inTarget });
        }
        for (const sf of ((await f.GetSubFolderList()) || [])) {
            const name = await sf.GetName();
            await walkBin(sf, where ? where + '/' + name : name, inTarget || (!where && name === binName));
        }
    };
    await walkBin(await mp.GetRootFolder(), '', false);
    return idx;
}

function existsMsg(dups) {
    if (dups.length === 1) return 'File đã tồn tại trong bin ' + dups[0].where + ' nên không import lại.';
    const bins = [...new Set(dups.map(d => d.where))];
    return dups.length + ' file đã tồn tại (bin ' + bins.slice(0, 3).join(', ') + (bins.length > 3 ? ', …' : '') + ') nên không import lại.';
}

async function addToPool(event, entries, binName = DEFAULT_MUSIC_BIN) {
    try {
        const project = await getProject();
        if (!project) return { ok: false, error: 'Chưa mở project nào trong Resolve.' };
        let list = (entries || []).map(e => typeof e === 'string' ? { path: e } : e);
        // File da co trong bin dich (ke ca bin con) hoac bat ky cho nao trong Media Pool thi khong import lai
        const idx = await poolIndex(await project.GetMediaPool(), binName);
        const dups = list.filter(e => idx.has(e.path.toLowerCase())).map(e => idx.get(e.path.toLowerCase()));
        list = list.filter(e => !idx.has(e.path.toLowerCase()));
        if (!list.length) return { ok: false, error: existsMsg(dups) };
        const r = await importEntries(project, list, binName);
        if (!r.out.length) return { ok: false, error: 'Không import được file nào. Kiểm tra file còn trong thư mục.' };
        const parts = [];
        if (r.ranged) parts.push(r.ranged + ' file giữ In/Out');
        if (r.failed) parts.push(r.failed + ' file lỗi');
        if (dups.length) parts.push(existsMsg(dups).replace(/\.$/, ''));
        return { ok: true, msg: dups.length ? 'Đã thêm ' + r.out.length + ' file vào Media Pool (bin ' + binName + ')' : undefined, note: parts.join(', ') };
    } catch (e) {
        return { ok: false, error: 'Lỗi: ' + e.message };
    }
}

async function addToTimeline(event, entry, binName = DEFAULT_MUSIC_BIN) {
    try {
        const project = await getProject();
        if (!project) return { ok: false, error: 'Chưa mở project nào trong Resolve.' };
        const timeline = await project.GetCurrentTimeline();
        if (!timeline) return { ok: false, error: 'Chưa mở timeline nào. Hãy mở một timeline rồi thử lại.' };
        const e = typeof entry === 'string' ? { path: entry } : entry;
        // File da co trong Media Pool (ke ca bin con cua binName) thi dung han, chi bao
        const mp = await project.GetMediaPool();
        const found = (await poolIndex(mp, binName)).get(e.path.toLowerCase());
        if (found) return { ok: false, error: 'File đã tồn tại trong bin ' + found.where + ' nên không import và không đặt vào timeline.' };
        const r = await importEntries(project, [e], binName);
        if (!r.out.length) return { ok: false, error: 'Không import được file. Kiểm tra file còn trong thư mục.' };
        const { clip, range } = r.out[0];
        let added = await mp.AppendToTimeline([range ? { mediaPoolItem: clip, startFrame: range.inF, endFrame: range.outF } : { mediaPoolItem: clip }]);
        let note = range ? 'đúng đoạn In/Out' : '';
        if ((!added || !added.length) && range) {
            added = await mp.AppendToTimeline([{ mediaPoolItem: clip }]);
            note = 'không đặt được In/Out nên đã đặt cả bài';
        }
        return added && added.length ? { ok: true, note } : { ok: false, error: 'Không đặt được vào timeline.' };
    } catch (err) {
        return { ok: false, error: 'Lỗi: ' + err.message };
    }
}

// ---- Thu vien nhac: luu o Documents\MusicPanel\library.json
const AUDIO_EXTS = ['.mp3', '.wav', '.aac', '.m4a', '.ogg', '.flac'];
const libFile = () => path.join(app.getPath('documents'), 'MusicPanel', 'library.json');

function loadLib() {
    try { return JSON.parse(fs.readFileSync(libFile(), 'utf8')); } catch (e) { return null; }
}
function saveLib(lib) {
    try {
        fs.mkdirSync(path.dirname(libFile()), { recursive: true });
        fs.writeFileSync(libFile(), JSON.stringify(lib));
        return { ok: true };
    } catch (e) { return { ok: false, error: 'Không lưu được thư viện: ' + e.message }; }
}
function cleanTitle(name) {
    return name.replace(/\.[^.]+$/, '')
        .replace(/^\(\d+\)\s*/, '')
        .replace(/\s*-\s*YouTube$/, '')
        .replace(/\s*[\(\[]\s*(official|lyric|audio|music video)[^\)\]]*[\)\]]/ig, '')
        .replace(/^[\s-]+|[\s-]+$/g, '') || name;
}
function walk(dir, out) {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
        if (e.name.startsWith('.')) continue; // bo qua file an cua macOS (._ten.mp3, .DS_Store)
        const p = path.join(dir, e.name);
        if (e.isDirectory()) walk(p, out);
        else if (AUDIO_EXTS.includes(path.extname(e.name).toLowerCase())) out.push(p);
    }
    return out;
}
function scanFolder(event, dir, known) {
    try {
        if (!fs.existsSync(dir)) return { ok: false, error: 'Không tìm thấy thư mục ' + dir };
        const have = new Set((known || []).map(p => p.toLowerCase()));
        const all = walk(dir, []);
        const found = new Set(all.map(p => p.toLowerCase()));
        const files = all.filter(p => !have.has(p.toLowerCase()))
            .map(p => ({ path: p, title: cleanTitle(path.basename(p)), ext: path.extname(p).toLowerCase() }));
        // muc trong danh sach khong con file (da xoa, hoac thuoc thu muc cu)
        const missing = (known || []).filter(p => p && !found.has(p.toLowerCase()) && !fs.existsSync(p));
        return { ok: true, files, missing };
    } catch (e) { return { ok: false, error: 'Lỗi quét: ' + e.message }; }
}

// ---- Phan tich BPM / nang luong bang Python (analyze_music.py)
function runPy(cmd, script, listFile) {
    return new Promise(resolve => {
        let buf = '', err = '', child;
        try {
            child = spawn(cmd[0], [...cmd.slice(1), '-u', script, listFile],
                { windowsHide: true, env: { ...process.env, PYTHONIOENCODING: 'utf-8' } });
        } catch (e) { return resolve({ spawnFailed: true }); }
        child.on('error', () => resolve({ spawnFailed: true }));
        child.stdout.on('data', d => {
            buf += d;
            let i;
            while ((i = buf.indexOf('\n')) >= 0) {
                const line = buf.slice(0, i).trim();
                buf = buf.slice(i + 1);
                if (line) { try { mainWindow.webContents.send('analysis:item', JSON.parse(line)); } catch (e) {} }
            }
        });
        child.stderr.on('data', d => { err += d; });
        child.on('close', code => resolve(code === 0 ? { ok: true }
            : isStoreStub(code, err) ? { spawnFailed: true }
            : { ok: false, error: 'Phân tích bị lỗi (có thể thiếu thư viện librosa): ' + err.trim().slice(-200) }));
    });
}
// Windows: may chua cai Python thi lenh "python" la lenh gia cua Microsoft Store (thoat ma 9009, bao "Python was not found")
const isStoreStub = (code, err) => process.platform === 'win32' &&
    (code === 9009 || /Microsoft Store|Python was not found|App execution aliases/i.test(err || ''));

function pythonCandidates() {
    const cands = [];
    try {
        const custom = fs.readFileSync(path.join(app.getPath('documents'), 'MusicPanel', 'python_path.txt'), 'utf8').trim();
        if (custom) cands.push([custom]);
    } catch (e) {}
    if (process.platform === 'win32') cands.push(['py', '-3'], ['python'], ['python3']);
    else cands.push(['/Library/Frameworks/Python.framework/Versions/Current/bin/python3'],
        ['/opt/homebrew/bin/python3'], ['/usr/local/bin/python3'], ['python3'], ['python']);
    return cands;
}

async function analyzeFiles(event, paths, mode) {
    const listFile = path.join(os.tmpdir(), 'musicpanel_list.json');
    // mode "sfx": chi do nang luong, bo BPM va Highlight (nhanh hon nhieu)
    fs.writeFileSync(listFile, JSON.stringify({ mode: mode === 'sfx' ? 'sfx' : 'music', paths }));
    const script = path.join(__dirname, 'analyze_music.py');
    if (!fs.existsSync(script)) return { ok: false, error: 'Thiếu file analyze_music.py trong thư mục plugin.' };
    const cands = pythonCandidates();
    let last = null;
    for (const cmd of cands) {
        const r = await runPy(cmd, script, listFile);
        if (r.spawnFailed) continue;
        if (r.ok) return r;
        last = r;
        if (!/No module named|ModuleNotFoundError/.test(r.error || '')) return r;
    }
    return last || { ok: false, error: 'Không tìm thấy Python trên máy (chưa cài Python từ python.org). Xem mục 6 file LUU_Y.' };
}


// ================= SONG AM =================
// Tinh san 1000 diem song am. WAV/BWF (PCM) doc thang tu dia, khong gioi han dung luong.
// File khac (mp3, aac…) <= 80MB: gui file cho giao dien giai ma, giao dien gui lai diem song am de luu cache.
const WAVE_N = 1000;
const waveDir = () => path.join(app.getPath('documents'), 'MusicPanel', 'wave_cache');
function waveKey(p) {
    const st = fs.statSync(p);
    return crypto.createHash('md5').update('w1|' + path.resolve(p).toLowerCase() + '|' + st.size + '|' + Math.round(st.mtimeMs)).digest('hex');
}
function waveCacheFile(p) { return path.join(waveDir(), waveKey(p) + '.json'); }

// Doc header WAV: tim chunk fmt va data (bo qua bext, LIST… cua may ghi am)
function wavInfo(fd, size) {
    const h = Buffer.alloc(12);
    fs.readSync(fd, h, 0, 12, 0);
    if (h.toString('ascii', 0, 4) !== 'RIFF' || h.toString('ascii', 8, 12) !== 'WAVE') return null;
    let pos = 12, fmt = null;
    const ch = Buffer.alloc(8);
    while (pos + 8 <= size) {
        fs.readSync(fd, ch, 0, 8, pos);
        const id = ch.toString('ascii', 0, 4), len = ch.readUInt32LE(4);
        if (id === 'fmt ') {
            const f = Buffer.alloc(Math.min(len, 40));
            fs.readSync(fd, f, 0, f.length, pos + 8);
            let tag = f.readUInt16LE(0);
            if (tag === 0xFFFE && f.length >= 26) tag = f.readUInt16LE(24);   // WAVE_FORMAT_EXTENSIBLE
            fmt = { tag, chans: f.readUInt16LE(2), align: f.readUInt16LE(12), bits: f.readUInt16LE(14) };
        } else if (id === 'data' && fmt) {
            const dataLen = (len === 0xFFFFFFFF || pos + 8 + len > size) ? size - pos - 8 : len;
            return { ...fmt, start: pos + 8, len: dataLen };
        }
        pos += 8 + len + (len & 1);
    }
    return null;
}

async function wavPeaks(p) {
    const size = fs.statSync(p).size;
    const fd = fs.openSync(p, 'r');
    try {
        const w = wavInfo(fd, size);
        if (!w || !w.align || !w.len) return null;
        const pcm = w.tag === 1 && [16, 24, 32].includes(w.bits), flt = w.tag === 3 && w.bits === 32;
        if (!pcm && !flt) return null;
        const frames = Math.floor(w.len / w.align), bin = Math.max(1, frames / WAVE_N);
        const stride = Math.max(1, Math.floor(bin / 2000));            // moi o lay toi da ~2000 mau
        const rd = w.bits === 16 ? (b, o) => b.readInt16LE(o) / 32768
                 : w.bits === 24 ? (b, o) => b.readIntLE(o, 3) / 8388608
                 : flt ? (b, o) => b.readFloatLE(o) : (b, o) => b.readInt32LE(o) / 2147483648;
        const pk = new Float32Array(WAVE_N);
        const CH = w.align * 65536, buf = Buffer.alloc(CH);
        let frame = 0, mx = 1e-4;
        for (let off = 0; off < frames * w.align; off += CH) {
            const n = await new Promise((res, rej) => fs.read(fd, buf, 0, Math.min(CH, frames * w.align - off), w.start + off, (e, b) => e ? rej(e) : res(b)));
            const nf = Math.floor(n / w.align);
            let k = (stride - (frame % stride)) % stride;
            for (; k < nf; k += stride) {
                const v = Math.abs(rd(buf, k * w.align)), i = Math.min(WAVE_N - 1, Math.floor((frame + k) / bin));
                if (v > pk[i]) pk[i] = v;
            }
            frame += nf;
            if (!n) break;
        }
        for (let i = 0; i < WAVE_N; i++) { if (pk[i] > mx) mx = pk[i]; }
        return Array.from(pk, v => Math.round(v / mx * 1000) / 1000);
    } finally { fs.closeSync(fd); }
}

async function wavePeaks(event, p) {
    try {
        const cf = waveCacheFile(p);
        try { return { ok: true, peaks: JSON.parse(fs.readFileSync(cf, 'utf8')) }; } catch (e) {}
        let pk = null;
        if (/\.(wav|bwf)$/i.test(p)) { try { pk = await wavPeaks(p); } catch (e) { pk = null; } }
        if (pk) {
            try { fs.mkdirSync(waveDir(), { recursive: true }); fs.writeFileSync(cf, JSON.stringify(pk)); } catch (e) {}
            return { ok: true, peaks: pk };
        }
        if (fs.statSync(p).size > 80 * 1024 * 1024) return { ok: false, tooBig: true };
        return { ok: true, data: fs.readFileSync(p) };
    } catch (err) { return { ok: false }; }
}
function waveSave(event, p, pk) {
    try {
        if (!Array.isArray(pk) || pk.length !== WAVE_N) return false;
        fs.mkdirSync(waveDir(), { recursive: true });
        fs.writeFileSync(waveCacheFile(p), JSON.stringify(pk));
        return true;
    } catch (e) { return false; }
}

// ================= AUDIO SYNC =================
const SYNC_BIN = 'AUDIO_SYNC';
let syncChild = null;

function sendSync(o) { try { mainWindow.webContents.send('sync:event', o); } catch (e) {} }

function runSyncOnce(cmd, script, cfgFile) {
    return new Promise(resolve => {
        let buf = '', err = '', child, gotAny = false, finished = false;
        try {
            child = spawn(cmd[0], [...cmd.slice(1), '-u', script, cfgFile],
                { windowsHide: true, env: { ...process.env, PYTHONIOENCODING: 'utf-8' } });
        } catch (e) { return resolve({ spawnFailed: true }); }
        syncChild = child;
        child.on('error', () => resolve({ spawnFailed: true }));
        child.stdout.on('data', d => {
            buf += d;
            let i;
            while ((i = buf.indexOf('\n')) >= 0) {
                const line = buf.slice(0, i).trim();
                buf = buf.slice(i + 1);
                if (!line) continue;
                try { const o = JSON.parse(line); gotAny = true; if (o.type === 'done') finished = true; sendSync(o); } catch (e) {}
            }
        });
        child.stderr.on('data', d => { err += d; });
        child.on('close', code => {
            syncChild = null;
            if (finished) return resolve({ ok: true });
            if (child.killed) return resolve({ ok: false, cancelled: true });
            if (!gotAny && isStoreStub(code, err)) return resolve({ spawnFailed: true });
            const missing = /No module named|ModuleNotFoundError/.test(err);
            resolve({ ok: false, missing, error: (gotAny ? '' : 'Không chạy được Python. ') + err.trim().slice(-300) });
        });
    });
}

async function syncRun(event, cfg) {
    const script = path.join(__dirname, 'sync_runner.py');
    if (!fs.existsSync(script) || !fs.existsSync(path.join(__dirname, 'sync_engine.py')))
        return { ok: false, error: 'Thiếu file sync_runner.py hoặc sync_engine.py trong thư mục plugin.' };
    const cfgFile = path.join(os.tmpdir(), 'audiosync_cfg.json');
    fs.writeFileSync(cfgFile, JSON.stringify(cfg));
    let last = null;
    for (const cmd of pythonCandidates()) {
        const r = await runSyncOnce(cmd, script, cfgFile);
        if (r.spawnFailed) continue;
        if (r.ok || r.cancelled) return r;
        last = r;
        if (!r.missing) return r;
    }
    if (last) return { ok: false, error: 'Thiếu thư viện Python. Hãy chạy: pip install numpy imageio-ffmpeg' };
    return { ok: false, error: 'Không tìm thấy Python trên máy. Cần cài Python (xem file LUU_Y).' };
}

function syncCancel() { if (syncChild) { try { syncChild.kill(); } catch (e) {} } return true; }

async function syncPick(event, kind) {
    const filters = kind === 'audio'
        ? [{ name: 'Audio', extensions: ['wav', 'bwf', 'mp3', 'aif', 'aiff', 'flac', 'm4a', 'ogg'] }]
        : [{ name: 'Video', extensions: ['mp4', 'mov', 'mxf', 'mts', 'm2ts', 'avi', 'mkv', 'braw', 'r3d'] }];
    const r = await dialog.showOpenDialog(mainWindow, {
        title: kind === 'audio' ? 'Chọn file Recorder (tiếng chuẩn)' : 'Chọn clip máy quay',
        properties: ['openFile', 'multiSelections'], filters: [...filters, { name: 'Tất cả', extensions: ['*'] }]
    });
    return r.canceled ? [] : r.filePaths;
}

// Lay cac clip dang chon trong Media Pool cua Resolve
async function syncSelected() {
    try {
        const project = await getProject();
        if (!project) return { ok: false, error: 'Chưa mở project nào trong Resolve.' };
        const mp = await project.GetMediaPool();
        const sel = (await mp.GetSelectedClips()) || [];
        const paths = [];
        for (const c of sel) {
            const fp = await c.GetClipProperty('File Path');
            if (fp) paths.push(fp);
        }
        if (!paths.length) return { ok: false, error: 'Chưa chọn clip nào trong Media Pool (bấm chọn clip rồi thử lại).' };
        return { ok: true, paths };
    } catch (e) { return { ok: false, error: 'Lỗi: ' + e.message }; }
}

async function findClipDeep(folder, filePath) {
    const low = filePath.toLowerCase();
    for (const c of ((await folder.GetClipList()) || [])) {
        const fp = await c.GetClipProperty('File Path');
        if (fp && fp.toLowerCase() === low) return c;
    }
    for (const f of ((await folder.GetSubFolderList()) || [])) {
        const r = await findClipDeep(f, filePath);
        if (r) return r;
    }
    return null;
}

// Tao timeline: clip may quay o track video 1, file Audio Sync dat dung vi tri o track audio rieng
async function syncApply(event, payload) {
    try {
        const project = await getProject();
        if (!project) return { ok: false, error: 'Chưa mở project nào trong Resolve.' };
        const mp = await project.GetMediaPool();
        const resolve = await getResolve();
        const storage = await resolve.GetMediaStorage();
        const fps = parseFloat(await project.GetSetting('timelineFrameRate')) || 24;
        const keepCam = !!(payload && payload.keepCamAudio);
        const rows = ((payload && payload.rows) || []).filter(r => r.offset != null && r.ref)
            .sort((a, b) => (a.cam_time || 0) - (b.cam_time || 0) || a.name.localeCompare(b.name));
        if (!rows.length) return { ok: false, error: 'Chưa có clip nào được sync để đặt vào timeline.' };

        const root = await mp.GetRootFolder();
        const prev = await mp.GetCurrentFolder();
        const bin = await getTargetBin(mp, SYNC_BIN);
        const itemOf = async p => {
            let it = await findClipDeep(root, p);
            if (!it) {
                await mp.SetCurrentFolder(bin);
                const got = (await storage.AddItemListToMediaPool([p])) || [];
                it = got[0] || (await findClipDeep(bin, p));
            }
            return it;
        };

        const tl = await mp.CreateEmptyTimeline('AUDIO_SYNC_' + (payload.stamp || Date.now()));
        if (!tl) return { ok: false, error: 'Không tạo được timeline (có thể trùng tên, thử lại).' };
        await project.SetCurrentTimeline(tl);
        let ok = await tl.AddTrack('audio', 'stereo');
        if (!ok) ok = await tl.AddTrack('audio');
        const audioTrack = ok ? 2 : 1;
        const base = (await tl.GetStartFrame()) || 0;

        let pos = base, placed = 0, skipped = 0;
        const refItems = new Map();
        for (const r of rows) {
            const cam = await itemOf(r.path);
            if (!cam) { skipped++; continue; }
            let ref = refItems.get(r.ref);
            if (!ref) { ref = await itemOf(r.ref); if (ref) refItems.set(r.ref, ref); }
            // Dat NGUYEN clip (startFrame 0, endFrame = Frames, khong tinh) de In/Out trong Media Pool khong cat clip (bai hoc 08/11)
            let camFrames = parseInt(await cam.GetClipProperty('Frames'), 10);
            if (!(camFrames > 0)) camFrames = Math.max(1, Math.round((r.duration || 1) * (parseFloat(await cam.GetClipProperty('FPS')) || fps)));
            const cinfo = { mediaPoolItem: cam, startFrame: 0, endFrame: camFrames, recordFrame: pos, trackIndex: 1 };
            if (!keepCam) cinfo.mediaType = 1;
            const added = await mp.AppendToTimeline([cinfo]);
            if (!added || !added.length) { skipped++; continue; }
            // Do dai thuc tren timeline (frame timeline), lay tu item vua dat. Dung GetDuration, khong dung GetEnd (da do ben VideoAI)
            let len = 0;
            try { len = await added[0].GetDuration(); } catch (e) {}
            if (!(len > 0)) len = Math.max(1, Math.round((r.duration || 1) * fps));
            if (ref) {
                let off = r.offset;                       // giay trong file Audio Sync ung voi giay 0 cua clip
                let rec = pos, refLen = len;
                if (off < 0) { const sh = Math.round(-off * fps); rec += sh; refLen -= sh; off = 0; }
                const sf = Math.round(off * fps);
                // File audio: startFrame/endFrame theo frame timeline, endFrame khong tinh
                if (refLen > 0) await mp.AppendToTimeline([{ mediaPoolItem: ref, mediaType: 2, trackIndex: audioTrack,
                    startFrame: sf, endFrame: sf + refLen, recordFrame: rec }]);
            }
            placed++;
            pos += len;
        }
        if (prev) await mp.SetCurrentFolder(prev);
        const note = placed + ' clip đã đặt vào timeline' + (skipped ? ', ' + skipped + ' clip lỗi' : '');
        return placed ? { ok: true, note } : { ok: false, error: 'Không đặt được clip nào vào timeline.' };
    } catch (e) { return { ok: false, error: 'Lỗi: ' + e.message }; }
}

async function syncCsv(event, rows) {
    const def = path.join(app.getPath('documents'), 'MusicPanel', 'audio_sync_' + Date.now() + '.csv');
    const r = await dialog.showSaveDialog(mainWindow, { title: 'Lưu bảng kết quả', defaultPath: def, filters: [{ name: 'CSV', extensions: ['csv'] }] });
    if (r.canceled || !r.filePath) return { ok: false, cancelled: true };
    const q = v => '"' + String(v == null ? '' : v).replace(/"/g, '""') + '"';
    const lines = [['file_may_quay', 'file_audio_sync', 'vi_tri_tc', 'offset_giay', 'trang_thai', 'do_troi_ms', 'ghi_chu'].join(',')];
    for (const x of rows) lines.push([x.path, x.ref, x.tc, x.offset, x.status, x.drift_ms, x.note].map(q).join(','));
    try { fs.mkdirSync(path.dirname(r.filePath), { recursive: true }); fs.writeFileSync(r.filePath, '﻿' + lines.join('\r\n')); return { ok: true, file: r.filePath }; }
    catch (e) { return { ok: false, error: e.message }; }
}
// ================= HET AUDIO SYNC =================

// ================= MULTICAM: NHIEU MAY QUAY =================
const MC_COLORS = { green: 'Green', lime: 'Lime', yellow: 'Yellow', red: 'Orange', tc: 'Green' };
const MC_REC_COLOR = 'Teal', MC_REC_LOW_COLOR = 'Navy';
const MC_VIDEO_EXTS = ['.mp4', '.mov', '.mxf', '.mts', '.m2ts', '.avi', '.mkv', '.braw', '.r3d'];
// Dau Tilt cua hang tren trong luoi 2x2 (+1: Tilt duong dua khung len tren). Da thu tren Resolve that.
const MC_TILT_TOP = 1;
// Luoi chia man hinh theo so may: 2 may 2x1, 3-4 may 2x2, 5-6 may 3x2, 7-9 may 3x3
function mcGrid(n) { return n <= 2 ? [2, 1] : n <= 4 ? [2, 2] : n <= 6 ? [3, 2] : [3, 3]; }
let mcChild = null;

function sendMc(o) { try { mainWindow.webContents.send('mc:event', o); } catch (e) {} }

function runMcOnce(cmd, script, cfgFile, outFile) {
    return new Promise(resolve => {
        let buf = '', err = '', child, finished = false;
        try {
            child = spawn(cmd[0], [...cmd.slice(1), '-u', script, cfgFile, outFile],
                { windowsHide: true, env: { ...process.env, PYTHONIOENCODING: 'utf-8' } });
        } catch (e) { return resolve({ spawnFailed: true }); }
        mcChild = child;
        child.on('error', () => resolve({ spawnFailed: true }));
        child.stdout.on('data', d => {
            buf += d;
            let i;
            while ((i = buf.indexOf('\n')) >= 0) {
                const line = buf.slice(0, i).trim();
                buf = buf.slice(i + 1);
                if (!line) continue;
                try { const o = JSON.parse(line); if (o.type === 'done') finished = true; sendMc(o); } catch (e) {}
            }
        });
        child.stderr.on('data', d => { err += d; });
        child.on('close', code => {
            mcChild = null;
            if (finished) return resolve({ ok: true });
            if (child.killed) return resolve({ ok: false, cancelled: true });
            if (isStoreStub(code, err)) return resolve({ spawnFailed: true });
            const missing = /No module named|ModuleNotFoundError/.test(err);
            resolve({ ok: false, missing, error: err.trim().slice(-300) || 'Python dừng giữa chừng.' });
        });
    });
}

// Sync bang audio: chay multicam_sync.py, doc file ket qua
async function mcRun(event, cfg) {
    const script = path.join(__dirname, 'multicam_sync.py');
    if (!fs.existsSync(script) || !fs.existsSync(path.join(__dirname, 'sync_engine.py')))
        return { ok: false, error: 'Thiếu file multicam_sync.py hoặc sync_engine.py trong thư mục plugin.' };
    const cfgFile = path.join(os.tmpdir(), 'multicam_cfg.json');
    const outFile = path.join(os.tmpdir(), 'multicam_res.json');
    try { fs.unlinkSync(outFile); } catch (e) {}
    fs.writeFileSync(cfgFile, JSON.stringify({ ...cfg, engine_dir: __dirname }));
    let last = null;
    for (const cmd of pythonCandidates()) {
        const r = await runMcOnce(cmd, script, cfgFile, outFile);
        if (r.spawnFailed) continue;
        if (r.cancelled) return r;
        if (r.ok) {
            try { return { ok: true, data: JSON.parse(fs.readFileSync(outFile, 'utf8')) }; }
            catch (e) { return { ok: false, error: 'Không đọc được kết quả: ' + e.message }; }
        }
        last = r;
        if (!r.missing) return r;
    }
    if (last) return { ok: false, error: 'Thiếu thư viện Python. Hãy chạy: pip install numpy imageio-ffmpeg' };
    return { ok: false, error: 'Không tìm thấy Python trên máy. Cần cài Python (xem file LUU_Y).' };
}

function mcCancel() { if (mcChild) { try { mcChild.kill(); } catch (e) {} } return true; }

async function findFolderPath(folder, id, trail) {
    const here = [...trail, await folder.GetName()];
    if ((await folder.GetUniqueId()) === id) return here;
    for (const sf of ((await folder.GetSubFolderList()) || [])) {
        const r = await findFolderPath(sf, id, here);
        if (r) return r;
    }
    return null;
}

async function findFolderByName(folder, name) {
    for (const sf of ((await folder.GetSubFolderList()) || [])) {
        if ((await sf.GetName()) === name) return sf;
    }
    for (const sf of ((await folder.GetSubFolderList()) || [])) {
        const r = await findFolderByName(sf, name);
        if (r) return r;
    }
    return null;
}

// Lay moi clip trong bin dang mo cua Media Pool. deep = lay ca bin con (sub = duong dan bin con).
async function mcBin(event, opts) {
    try {
        const project = await getProject();
        if (!project) return { ok: false, error: 'Chưa mở project nào trong Resolve.' };
        const mp = await project.GetMediaPool();
        const folder = await mp.GetCurrentFolder();
        if (!folder) return { ok: false, error: 'Chưa mở bin nào trong Media Pool.' };
        const items = [];
        const collect = async (f, sub) => {
            for (const c of ((await f.GetClipList()) || [])) {
                const fp = await c.GetClipProperty('File Path');
                if (fp) items.push({ path: fp, sub, video: MC_VIDEO_EXTS.includes(path.extname(fp).toLowerCase()) });
            }
            if (opts && opts.deep) {
                for (const sf of ((await f.GetSubFolderList()) || [])) await collect(sf, (sub ? sub + '/' : '') + (await sf.GetName()));
            }
        };
        await collect(folder, '');
        let trail = null;
        try { trail = await findFolderPath(await mp.GetRootFolder(), await folder.GetUniqueId(), []); } catch (e) {}
        const name = await folder.GetName();
        const names = trail ? trail.slice(1) : [name];         // bo "Master"
        if (!items.length) return { ok: false, error: 'Bin "' + name + '" chưa có clip nào.' };
        return { ok: true, items, bin: name, binPath: names.join(' / '), parent: names.length > 1 ? names[names.length - 2] : name };
    } catch (e) { return { ok: false, error: 'Lỗi: ' + e.message }; }
}

function tcToSec(tc, fps) {
    const m = /(\d+)[:;](\d+)[:;](\d+)[:;.](\d+)/.exec(tc || '');
    if (!m) return null;
    return (+m[1]) * 3600 + (+m[2]) * 60 + (+m[3]) + (+m[4]) / Math.max(1, Math.round(fps));
}

// Import cac file chua co trong Media Pool vao bin AUDIO_SYNC. Tra ve chi muc duong dan -> clip.
async function mcPoolItems(project, paths) {
    const mp = await project.GetMediaPool();
    let idx = await poolIndex(mp, SYNC_BIN);
    const missing = [...new Set(paths)].filter(p => !idx.has(p.toLowerCase()));
    if (missing.length) {
        const resolve = await getResolve();
        const storage = await resolve.GetMediaStorage();
        const prev = await mp.GetCurrentFolder();
        await mp.SetCurrentFolder(await getTargetBin(mp, SYNC_BIN));
        await storage.AddItemListToMediaPool(missing);
        if (prev) await mp.SetCurrentFolder(prev);
        idx = await poolIndex(mp, SYNC_BIN);
    }
    const clips = new Map();
    for (const [k, v] of idx) clips.set(k, v.clip);
    return { mp, idx: clips };
}

// Bo khoang trong: items [{start, dur}] -> gan .rec; tra ve tong do dai. gaps=false: chi dua diem dau ve 0.
function mcCompress(items, gaps) {
    items.sort((a, b) => a.start - b.start);
    if (!items.length) return 0;
    if (!gaps) {
        const s0 = items[0].start;
        items.forEach(x => { x.rec = x.start - s0; });
        return Math.max(...items.map(x => x.start + x.dur)) - s0;
    }
    let acc = 0, end = null, seg = -1;
    for (const x of items) {
        if (end === null || x.start > end) { acc += end === null ? x.start : x.start - end; seg++; }
        x.rec = x.start - acc; x.cluster = seg;
        end = end === null ? x.start + x.dur : Math.max(end, x.start + x.dur);
    }
    return items.reduce((m, x) => Math.max(m, x.rec + x.dur), 0);
}

// Sync bang timecode: doc Start TC cua tung clip, khong phan tich audio
async function mcTc(event, p) {
    try {
        const project = await getProject();
        if (!project) return { ok: false, error: 'Chưa mở project nào trong Resolve.' };
        const tlFps = parseFloat(await project.GetSetting('timelineFrameRate')) || 25;
        const groups = [...(p.cams || [])];
        if (p.recorder && p.recorder.length) groups.push(p.recorder);
        const { idx } = await mcPoolItems(project, groups.flat());
        const items = [], bad = [];
        for (let cam = 0; cam < groups.length; cam++) {
            for (const fp of groups[cam]) {
                const clip = idx.get(fp.toLowerCase());
                const name = path.basename(fp);
                if (!clip) { bad.push(name); continue; }
                const fps = parseFloat(await clip.GetClipProperty('FPS')) || tlFps;
                const start = tcToSec(await clip.GetClipProperty('Start TC'), fps);
                const frames = parseInt(await clip.GetClipProperty('Frames'), 10);
                const dur = frames > 0 ? frames / fps : tcToSec(await clip.GetClipProperty('Duration'), fps);
                if (start == null || !dur) { bad.push(name); continue; }
                items.push({ cam, path: fp, name, dur, start, conf: 'tc', score: null, ratio: null, note: '' });
            }
        }
        if (!items.length) return { ok: false, error: 'Không đọc được Start TC của clip nào.' };
        const total = mcCompress(items, p.gaps !== false);
        items.forEach(x => { if (x.cluster == null) x.cluster = 0; delete x.start; });
        items.sort((a, b) => a.rec - b.rec || a.cam - b.cam);
        const summary = { clips: items.length, tc: items.length, total_sec: total, bad,
            recorder_cam: p.recorder && p.recorder.length ? p.cams.length : null };
        return { ok: true, data: { summary, clips: items } };
    } catch (e) { return { ok: false, error: 'Lỗi: ' + e.message }; }
}

// Dung timeline multicam. Bai hoc 08/11: luon dat nguyen clip (startFrame 0, endFrame = Frames, endFrame khong tinh),
// khe 1-2 frame do lam tron thi don lai, chong len clip truoc cung track thi day sang sau.
async function mcBuild(event, p) {
    try {
        const project = await getProject();
        if (!project) return { ok: false, error: 'Chưa mở project nào trong Resolve.' };
        const fps = parseFloat(await project.GetSetting('timelineFrameRate')) || 25;
        const W = parseInt(await project.GetSetting('timelineResolutionWidth'), 10) || 1920;
        const H = parseInt(await project.GetSetting('timelineResolutionHeight'), 10) || 1080;
        const name = String(p.name || '').trim();
        if (!name) return { ok: false, error: 'Chưa đặt tên timeline.' };
        const ntl = (await project.GetTimelineCount()) || 0;
        for (let i = 1; i <= ntl; i++) {
            const t = await project.GetTimelineByIndex(i);
            if (t && (await t.GetName()) === name) return { ok: false, error: 'Đã có timeline tên "' + name + '". Đặt tên khác để không ghi đè.' };
        }
        const nv = p.camNames.length;
        const recCam = p.hasRec ? nv : -1;
        const recLow = (p.hasRec && p.withLow && p.recLow) || {};      // ban thuong -> ban -12dB
        const lowOn = Object.keys(recLow).length > 0;
        const rows = (p.rows || []).slice().sort((a, b) => a.rec - b.rec || a.cam - b.cam);
        const { mp, idx } = await mcPoolItems(project, [...rows.map(r => r.path), ...Object.values(recLow)]);

        const prev = await mp.GetCurrentFolder();
        const dest = (p.bin && (await findFolderByName(await mp.GetRootFolder(), p.bin))) || prev;
        if (dest) await mp.SetCurrentFolder(dest);
        const tl = await mp.CreateEmptyTimeline(name);
        if (prev) await mp.SetCurrentFolder(prev);
        if (!tl) return { ok: false, error: 'Không tạo được timeline "' + name + '".' };
        await project.SetCurrentTimeline(tl);

        // Recorder ban thuong ngay sau track audio cua may quay (2 may: A3), ban -12dB o track ke tiep (A4)
        const recTrack = nv + 1, lowTrack = nv + 2;
        const nAudio = nv + (p.hasRec ? 1 : 0) + (lowOn ? 1 : 0);
        while (((await tl.GetTrackCount('video')) || 0) < nv) { if (!(await tl.AddTrack('video'))) break; }
        while (((await tl.GetTrackCount('audio')) || 0) < nAudio) {
            if (!(await tl.AddTrack('audio', 'stereo')) && !(await tl.AddTrack('audio'))) break;
        }
        for (let i = 0; i < nv; i++) {
            await tl.SetTrackName('video', i + 1, p.camNames[i]);
            await tl.SetTrackName('audio', i + 1, p.camNames[i]);
        }
        if (p.hasRec) await tl.SetTrackName('audio', recTrack, 'Recorder');
        if (lowOn) await tl.SetTrackName('audio', lowTrack, 'Recorder -12dB');

        // vi tri khi chia man hinh: 2 may trai/phai, 3-4 may 2x2, 5-6 may 3x2, 7-9 may 3x3 (giu ti le khung hinh)
        // Cong thuc cho 2 va 4 may cho dung so da thu tren Resolve that (Pan +-W/4, Tilt +-H/4, Zoom 0.5)
        const place = cam => {
            if (!p.split || nv < 2) return null;
            const [cols, rowsN] = mcGrid(nv), z = 1 / Math.max(cols, rowsN);
            const col = cam % cols, row = Math.floor(cam / cols);
            const pan = (col - (cols - 1) / 2) * W / cols;
            const tilt = ((rowsN - 1) / 2 - row) * MC_TILT_TOP * H / rowsN;
            return { ZoomX: z, ZoomY: z, Pan: pan, Tilt: tilt };
        };

        const base = (await tl.GetStartFrame()) || 0;
        const trackEnd = {}, placed = [], colors = {};
        let shift = 0, cover = base, skipped = 0, pushed = 0, closed = 0;
        // dat 1 clip (hoac 1 doan Recorder) vao track, tra ve cac TimelineItem
        const put = async (info, key, color, isRec, cam) => {
            if (trackEnd[key] != null && info.recordFrame < trackEnd[key]) { pushed++; info.recordFrame = trackEnd[key]; }
            const items = (await mp.AppendToTimeline([info])) || [];
            let start = null, end = info.recordFrame;
            for (const it of items) {
                const s = await it.GetStart(), d = await it.GetDuration();
                if (start === null || s < start) start = s;
                end = Math.max(end, s + d);
                await it.SetClipColor(color);
                const tt = await it.GetTrackTypeAndIndex();
                const tf = !isRec && tt && tt[0] === 'video' ? place(cam) : null;
                if (tf) for (const k of Object.keys(tf)) await it.SetProperty(k, tf[k]);
            }
            if (items.length) { trackEnd[key] = end; colors[color] = (colors[color] || 0) + 1; }
            return items.length ? { start, end } : null;
        };
        // Luot 1: clip may quay. Ghi lai do dich (shift) sau moi lan don khe de luot 2 dat Recorder dung cho.
        const shifts = [[-Infinity, 0]];
        for (const r of rows.filter(x => x.cam !== recCam)) {
            const clip = idx.get(r.path.toLowerCase());
            if (!clip) { skipped++; continue; }
            const want = base + Math.round(r.rec * fps);
            let rf = want + shift;
            if (p.gaps && rf > cover && rf - cover <= 2) { closed++; shift -= rf - cover; rf = cover; shifts.push([want, shift]); }
            let endFrame = parseInt(await clip.GetClipProperty('Frames'), 10);
            if (!(endFrame > 0)) endFrame = Math.max(1, Math.round((r.dur || 1) * (parseFloat(await clip.GetClipProperty('FPS')) || fps)));
            const info = { mediaPoolItem: clip, startFrame: 0, endFrame, trackIndex: r.cam + 1, recordFrame: rf };
            const got = await put(info, 'v' + (r.cam + 1), MC_COLORS[r.conf] || 'Orange', false, r.cam);
            if (!got) { skipped++; continue; }
            cover = Math.max(cover, got.end);
            placed.push({ start: got.start, end: got.end, cluster: r.cluster, conf: r.conf, rec: false, want, trim: 0 });
        }
        // Luot 2: doan Recorder, cat gon trong cac doan co may quay (khong lan sang khoang trong da bo,
        // khong day lui doan sau: cham doan truoc thi cat bot dau doan de tieng khong lech hinh).
        const vu = [];
        for (const [s, t] of placed.map(x => [x.start, x.end]).sort((a, b) => a[0] - b[0])) {
            if (vu.length && s <= vu[vu.length - 1][1]) vu[vu.length - 1][1] = Math.max(vu[vu.length - 1][1], t); else vu.push([s, t]);
        }
        let trimmed = 0;
        for (const r of rows.filter(x => x.cam === recCam)) {
            const clip = idx.get(r.path.toLowerCase());
            if (!clip) { skipped++; continue; }
            const want = base + Math.round(r.rec * fps);
            const sh = shifts.filter(([w]) => w <= want).pop()[1];
            // File audio: Frames rong; startFrame/endFrame tinh theo frame TIMELINE, endFrame khong tinh (do tren Resolve 08/11)
            let rf = want + sh, sf = Math.round((r.src_in || 0) * fps);
            let end = rf + Math.max(1, Math.round((r.rec + r.dur) * fps) - Math.round(r.rec * fps));
            const u = vu.find(([s, t]) => rf < t && end > s);
            if (!u) { skipped++; continue; }
            const lo = p.gaps ? Math.max(rf, u[0], trackEnd['a' + recTrack] ?? -Infinity) : Math.max(rf, trackEnd['a' + recTrack] ?? -Infinity);
            end = p.gaps ? Math.min(end, u[1]) : end;
            if (lo !== rf || end !== rf + Math.round((r.rec + r.dur) * fps) - Math.round(r.rec * fps)) trimmed++;
            if (end - lo < 1) continue;
            sf += lo - rf;
            const info = { mediaPoolItem: clip, startFrame: sf, endFrame: sf + (end - lo), trackIndex: recTrack, recordFrame: lo, mediaType: 2 };
            const got = await put(info, 'a' + recTrack, MC_REC_COLOR, true, r.cam);
            if (!got) { skipped++; continue; }
            if (lowOn && recLow[r.path]) {
                const low = idx.get(recLow[r.path].toLowerCase());
                if (low) await put({ ...info, mediaPoolItem: low, trackIndex: lowTrack }, 'a' + lowTrack, MC_REC_LOW_COLOR, true, r.cam);
            }
            placed.push({ start: got.start, end: got.end, cluster: r.cluster, conf: r.conf, rec: true, want, trim: lo - rf });
        }

        // kiem tra: khoang trong, cum khop audio bi lech, Recorder lan sang doan khong co may quay
        const iv = placed.map(x => [x.start, x.end]).sort((a, b) => a[0] - b[0]);
        let holes = 0, e = iv.length ? iv[0][1] : 0;
        for (const [s, t] of iv.slice(1)) { if (s > e) holes++; e = Math.max(e, t); }
        // Cac clip khop audio cung cum va dang phat cung luc phai giu dung khoang cach da tinh (lech <= 2 frame).
        // Chi so clip chong nhau: khi don khe, ca hinh va Recorder phia sau cung dich nen tieng van khop hinh.
        const synced = placed.filter(x => x.conf === 'green' || x.conf === 'lime').map(x => ({ ...x, dev: x.start - x.want - x.trim }));
        const offSet = new Set();
        for (let i = 0; i < synced.length; i++) for (let j = i + 1; j < synced.length; j++) {
            const a = synced[i], b = synced[j];
            if (a.cluster === b.cluster && a.start < b.end && b.start < a.end && Math.abs(a.dev - b.dev) > 2) offSet.add(a.cluster);
        }
        const offCl = offSet.size;
        const recs = placed.filter(x => x.rec);
        const recOut = p.gaps ? recs.filter(x => !vu.some(([s, t]) => x.start >= s && x.end <= t)).length : 0;
        const minutes = iv.length ? (e - iv[0][0]) / fps / 60 : 0;
        const stats = { clips: placed.length - recs.length, recPieces: recs.length, recOut, skipped, colors, holes, offClusters: offCl,
            minutes: Math.round(minutes * 10) / 10, closed, pushed, recTrimmed: trimmed };
        const note = stats.clips + ' clip' + (recs.length ? ' + ' + recs.length + ' đoạn Recorder' : '') + ', dài ' + stats.minutes.toFixed(1) + ' phút, '
            + holes + ' khoảng trống, ' + offCl + ' cụm khớp audio bị lệch' + (recs.length ? ', ' + recOut + ' đoạn Recorder lấn ra ngoài' : '')
            + (skipped ? ', ' + skipped + ' clip lỗi' : '');
        return placed.length ? { ok: true, note, stats, name } : { ok: false, error: 'Không đặt được clip nào vào timeline.' };
    } catch (e) { return { ok: false, error: 'Lỗi: ' + e.message }; }
}

async function mcCsv(event, rows) {
    const def = path.join(app.getPath('documents'), 'MusicPanel', 'multicam_' + Date.now() + '.csv');
    const r = await dialog.showSaveDialog(mainWindow, { title: 'Lưu bảng kết quả', defaultPath: def, filters: [{ name: 'CSV', extensions: ['csv'] }] });
    if (r.canceled || !r.filePath) return { ok: false, cancelled: true };
    const q = v => '"' + String(v == null ? '' : v).replace(/"/g, '""') + '"';
    const lines = [['file', 'may', 'cum', 'vi_tri_giay', 'mau', 'do_khop', 'ti_le_dinh', 'ghi_chu'].join(',')];
    for (const x of rows) lines.push([x.path, x.camName, x.cluster, x.rec, x.conf, x.score, x.ratio, x.note].map(q).join(','));
    try { fs.mkdirSync(path.dirname(r.filePath), { recursive: true }); fs.writeFileSync(r.filePath, '﻿' + lines.join('\r\n')); return { ok: true, file: r.filePath }; }
    catch (e) { return { ok: false, error: e.message }; }
}
// ================= HET MULTICAM =================

let mainWindow;
function createWindow() {
    mainWindow = new BrowserWindow({
        width: 1200,
        height: 780,
        autoHideMenuBar: true,
        webPreferences: { preload: path.join(__dirname, 'preload.js') }
    });
    mainWindow.on('close', () => app.quit());
    mainWindow.loadFile('index.html');
}

app.whenReady().then(() => {
    ipcMain.handle('music:addToPool', (e, paths, binName) => addToPool(e, paths, binName));
    ipcMain.handle('music:addToTimeline', (e, filePath, binName) => addToTimeline(e, filePath, binName));
    ipcMain.handle('lib:load', () => loadLib());
    ipcMain.handle('lib:save', (e, lib) => saveLib(lib));
    ipcMain.handle('lib:scan', scanFolder);
    ipcMain.handle('lib:analyze', analyzeFiles);
    ipcMain.handle('lib:exists', (e, d) => fs.existsSync(d));
    ipcMain.handle('lib:peaks', wavePeaks);
    ipcMain.handle('lib:savePeaks', waveSave);
    ipcMain.handle('lib:pickFolder', async (e, title = 'Chọn thư mục') => {
        const r = await dialog.showOpenDialog(mainWindow, { title, properties: ['openDirectory'] });
        return r.canceled || !r.filePaths.length ? null : r.filePaths[0];
    });
    ipcMain.handle('lib:trash', async (e, p) => {
        try { if (fs.existsSync(p)) await shell.trashItem(p); return { ok: true }; }
        catch (err) { return { ok: false, error: 'Không xóa được file: ' + err.message }; }
    });
    ipcMain.handle('sync:run', syncRun);
    ipcMain.handle('sync:cancel', syncCancel);
    ipcMain.handle('sync:pick', syncPick);
    ipcMain.handle('sync:selected', syncSelected);
    ipcMain.handle('sync:apply', syncApply);
    ipcMain.handle('sync:csv', syncCsv);
    ipcMain.handle('mc:run', mcRun);
    ipcMain.handle('mc:cancel', mcCancel);
    ipcMain.handle('mc:bin', mcBin);
    ipcMain.handle('mc:tc', mcTc);
    ipcMain.handle('mc:build', mcBuild);
    ipcMain.handle('mc:csv', mcCsv);
    createWindow();
});

app.on('window-all-closed', () => {
    try { WorkflowIntegration.CleanUp(); } catch (e) {}
    app.quit();
});
