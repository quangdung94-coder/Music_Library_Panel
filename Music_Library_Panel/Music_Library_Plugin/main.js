// Music Library panel for DaVinci Resolve Studio (Workflow Integration plugin).
const { app, BrowserWindow, ipcMain, dialog, shell } = require('electron');
const path = require('path');
const fs = require('fs');
const os = require('os');
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

async function findClip(bin, filePath) {
    const clips = (await bin.GetClipList()) || [];
    for (const c of clips) {
        const fp = await c.GetClipProperty('File Path');
        if (fp && fp.toLowerCase() === filePath.toLowerCase()) return c;
    }
    return null;
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
        const files = walk(dir, []).filter(p => !have.has(p.toLowerCase()))
            .map(p => ({ path: p, title: cleanTitle(path.basename(p)), ext: path.extname(p).toLowerCase() }));
        return { ok: true, files };
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
            : { ok: false, error: 'Phân tích bị lỗi (có thể thiếu thư viện librosa): ' + err.trim().slice(-200) }));
    });
}
function pythonCandidates() {
    const cands = [];
    try {
        const custom = fs.readFileSync(path.join(app.getPath('documents'), 'MusicPanel', 'python_path.txt'), 'utf8').trim();
        if (custom) cands.push([custom]);
    } catch (e) {}
    if (process.platform === 'win32') cands.push(['python'], ['py', '-3'], ['python3']);
    else cands.push(['/Library/Frameworks/Python.framework/Versions/Current/bin/python3'],
        ['/opt/homebrew/bin/python3'], ['/usr/local/bin/python3'], ['python3'], ['python']);
    return cands;
}

async function analyzeFiles(event, paths) {
    const listFile = path.join(os.tmpdir(), 'musicpanel_list.json');
    fs.writeFileSync(listFile, JSON.stringify(paths));
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
    return last || { ok: false, error: 'Không tìm thấy Python trên máy. Cần cài Python và thư viện librosa.' };
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
        title: kind === 'audio' ? 'Chọn file Audio Sync (tiếng chuẩn)' : 'Chọn clip máy quay',
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
            const len = Math.max(1, Math.round((r.duration || 1) * fps));
            const cinfo = { mediaPoolItem: cam, recordFrame: pos, trackIndex: 1 };
            if (!keepCam) cinfo.mediaType = 1;
            const added = await mp.AppendToTimeline([cinfo]);
            if (!added || !added.length) { skipped++; continue; }
            if (ref) {
                let off = r.offset;                       // giay trong file Audio Sync ung voi giay 0 cua clip
                let rec = pos;
                if (off < 0) { rec += Math.round(-off * fps); off = 0; }
                const sf = Math.round(off * fps);
                await mp.AppendToTimeline([{ mediaPoolItem: ref, mediaType: 2, trackIndex: audioTrack,
                    startFrame: sf, endFrame: sf + len - 1, recordFrame: rec }]);
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
    ipcMain.handle('lib:read', (e, p) => {
        try {
            if (fs.statSync(p).size > 80 * 1024 * 1024) return { ok: false, tooBig: true };
            return { ok: true, data: fs.readFileSync(p) };
        } catch (err) { return { ok: false }; }
    });
    ipcMain.handle('lib:pickFolder', async (e, title = 'Chọn thư mục') => {
        const r = await dialog.showOpenDialog(mainWindow, { title, properties: ['openDirectory'] });
        return r.canceled || !r.filePaths.length ? null : r.filePaths[0];
    });
    ipcMain.handle('lib:trash', async (e, p) => {
        try { if (fs.existsSync(p)) await shell.trashItem(p); return { ok: true }; }
        catch (err) { return { ok: false, error: 'Không xóa được file: ' + err.message }; }
    });
    ipcMain.handle('lib:stat', (e, paths) => {
        const out = {};
        for (const p of paths) {
            try { const s = fs.statSync(p); out[p] = Math.round(s.birthtimeMs || s.mtimeMs); } catch (err) {}
        }
        return out;
    });
    ipcMain.handle('sync:run', syncRun);
    ipcMain.handle('sync:cancel', syncCancel);
    ipcMain.handle('sync:pick', syncPick);
    ipcMain.handle('sync:selected', syncSelected);
    ipcMain.handle('sync:apply', syncApply);
    ipcMain.handle('sync:csv', syncCsv);
    createWindow();
});

app.on('window-all-closed', () => {
    try { WorkflowIntegration.CleanUp(); } catch (e) {}
    app.quit();
});
