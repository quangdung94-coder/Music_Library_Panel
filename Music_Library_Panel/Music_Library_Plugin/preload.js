const { contextBridge, ipcRenderer } = require('electron/renderer');

contextBridge.exposeInMainWorld('musicAPI', {
    addToPool: (paths, binName) => ipcRenderer.invoke('music:addToPool', paths, binName),
    loadLibrary: () => ipcRenderer.invoke('lib:load'),
    saveLibrary: (lib) => ipcRenderer.invoke('lib:save', lib),
    scan: (dir, known) => ipcRenderer.invoke('lib:scan', dir, known),
    fileTimes: (paths) => ipcRenderer.invoke('lib:stat', paths),
    pickFolder: (title) => ipcRenderer.invoke('lib:pickFolder', title),
    dirExists: (d) => ipcRenderer.invoke('lib:exists', d),
    trash: (p) => ipcRenderer.invoke('lib:trash', p),
    readFile: (p) => ipcRenderer.invoke('lib:read', p),
    analyze: (paths) => ipcRenderer.invoke('lib:analyze', paths),
    onAnalysis: (cb) => ipcRenderer.on('analysis:item', (e, o) => cb(o)),
    addToTimeline: (path, binName) => ipcRenderer.invoke('music:addToTimeline', path, binName),
    syncRun: (cfg) => ipcRenderer.invoke('sync:run', cfg),
    syncCancel: () => ipcRenderer.invoke('sync:cancel'),
    syncPick: (kind) => ipcRenderer.invoke('sync:pick', kind),
    syncSelected: () => ipcRenderer.invoke('sync:selected'),
    syncApply: (payload) => ipcRenderer.invoke('sync:apply', payload),
    syncCsv: (rows) => ipcRenderer.invoke('sync:csv', rows),
    onSync: (cb) => ipcRenderer.on('sync:event', (e, o) => cb(o))
});
