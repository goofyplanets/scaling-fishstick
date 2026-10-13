const { contextBridge, ipcRenderer, webUtils } = require('electron');

contextBridge.exposeInMainWorld('localify', {
  loadState: () => ipcRenderer.invoke('library:load'),
  saveState: (data) => ipcRenderer.invoke('library:save', data),
  pickFiles: () => ipcRenderer.invoke('dialog:files'),
  importDroppedFiles: (paths) => ipcRenderer.invoke('dialog:filesFromPaths', paths),
  importDroppedPaths: (paths) => ipcRenderer.invoke('dialog:paths', paths),
  getPathForFile: (file) => { try { return webUtils.getPathForFile(file); } catch { return file?.path || ''; } },
  pickFolder: () => ipcRenderer.invoke('dialog:folder'),
  chooseLibraryFolder: () => ipcRenderer.invoke('library:chooseFolder'),
  scanLibraryFolder: (options = {}) => ipcRenderer.invoke('library:scanFolder', options),
  scanLibraryChange: (payload) => ipcRenderer.invoke('library:scanChange', payload),
  scanLibraryChanges: (payload) => ipcRenderer.invoke('library:scanChanges', payload),
    findMissingLibraryTracks: () => ipcRenderer.invoke('library:findMissing'),
  hashLibraryFiles: (paths) => ipcRenderer.invoke('library:hashFiles', paths),
  recoveryInfo: () => ipcRenderer.invoke('library:recoveryInfo'),
  restoreBackup: () => ipcRenderer.invoke('library:restoreBackup'),
  openLibraryFolder: () => ipcRenderer.invoke('library:openFolder'),
  onLibraryFolderChanged: (cb) => ipcRenderer.on('library:folderChanged', (_e, payload) => cb(payload || {})),
  onLibraryScanProgress: (cb) => ipcRenderer.on('library:scanProgress', (_e, payload) => cb(payload || {})),
  onSaveFailed: (cb) => ipcRenderer.on('library:saveFailed', (_e, payload) => cb(payload || {})),
  deleteFiles: (paths) => ipcRenderer.invoke('library:deleteFiles', paths),
  getLibraryWatchStatus: () => ipcRenderer.invoke('library:watchStatus'),
  pickImage: () => ipcRenderer.invoke('dialog:image'),
  metadata: {
    search: (track) => ipcRenderer.invoke('metadata:search', track),
    refresh: (track) => ipcRenderer.invoke('metadata:refresh', track),
    stats: () => ipcRenderer.invoke('metadata:stats'),
    clearCache: () => ipcRenderer.invoke('metadata:clearCache')
  },
  diagnostics: {
    logs: (lines) => ipcRenderer.invoke('diagnostics:logs', lines),
    clearLogs: () => ipcRenderer.invoke('diagnostics:clearLogs'),
    openLogs: () => ipcRenderer.invoke('diagnostics:openLogs'),
    report: () => ipcRenderer.invoke('diagnostics:report')
  },
  reveal: (p) => ipcRenderer.invoke('shell:show', p),
  openFolderPath: (p) => ipcRenderer.invoke('shell:openFolder', p),
  window: {
    minimize: () => ipcRenderer.invoke('window:minimize'),
    toggleMaximize: () => ipcRenderer.invoke('window:toggleMaximize'),
    close: () => ipcRenderer.invoke('window:close'),
    isMaximized: () => ipcRenderer.invoke('window:isMaximized'),
    onStateChanged: (cb) => ipcRenderer.on('window:stateChanged', (_e, maximized) => cb(!!maximized))
  },
  settings: { get: () => ipcRenderer.invoke('settings:get'), save: (data) => ipcRenderer.invoke('settings:save', data) },
  playback: {
    updateState: (data) => ipcRenderer.send('playback:state', data),
    nowPlaying: (data) => ipcRenderer.send('playback:nowPlaying', data),
    onMediaKey: (cb) => ipcRenderer.on('media-key', (_e, action) => cb(action)),
    loadSession: () => ipcRenderer.invoke('playback:loadSession'),
    saveSession: (data) => ipcRenderer.send('playback:saveSession', data),
    flushSession: () => ipcRenderer.invoke('playback:flush')
  },
  radio: { search: (payload) => ipcRenderer.invoke('radio:search', payload), click: (stationuuid) => ipcRenderer.invoke('radio:click', stationuuid) },
  providers: {
    getConfig: () => ipcRenderer.invoke('providers:getConfig'),
    saveConfig: (data) => ipcRenderer.invoke('providers:saveConfig', data),
    downloadYtDlp: (candidate) => ipcRenderer.invoke('providers:downloadYtDlp', candidate),
    resolveYtDlp: (candidate) => ipcRenderer.invoke('providers:resolveYtDlp', candidate),
    onlineSearch: (payload) => ipcRenderer.invoke('providers:onlineSearch', payload),
    openSource: (url) => ipcRenderer.invoke('providers:openSource', url),
    diagnostics: () => ipcRenderer.invoke('providers:diagnostics'),
    updateYtDlp: () => ipcRenderer.invoke('providers:updateYtDlp'),
    chooseYtDlp: () => ipcRenderer.invoke('providers:chooseYtDlp'),
    chooseCookiesFile: () => ipcRenderer.invoke('providers:chooseCookiesFile'),
    onDownloadProgress: (cb) => ipcRenderer.on('providers:downloadProgress', (_e, data) => cb(data))
  },
  playlists: {
    ensureFolders: (items) => ipcRenderer.invoke('playlists:ensureFolders', items),
    createFolder: (id, name) => ipcRenderer.invoke('playlists:createFolder', { id, name }),
    renameFolder: (id, name) => ipcRenderer.invoke('playlists:renameFolder', { id, name }),
    deleteFolder: (id) => ipcRenderer.invoke('playlists:deleteFolder', id),
    moveTrack: (filePath, playlistId) => ipcRenderer.invoke('playlists:moveTrack', { filePath, playlistId }),
    moveTrackOut: (filePath, playlistId) => ipcRenderer.invoke('playlists:moveTrackOut', { filePath, playlistId }),
    moveExternalFiles: (paths, playlistId) => ipcRenderer.invoke('playlists:moveExternalFiles', { paths, playlistId }),
    openFolder: (id) => ipcRenderer.invoke('playlists:openFolder', id)
  }
});
