/* Android adapter for the Electron IPC facade used by Localify Crimson. */
(() => {
  'use strict';
  if (!window.LocalifyAndroid) return;
  window.__LOCALIFY_ANDROID__ = true;
  document.documentElement.classList.add('android-app');
  const native = window.LocalifyAndroid;
  let requestId = 0;
  const pending = new Map();
  function parse(raw, fallback = null) { try { return JSON.parse(raw); } catch { return fallback; } }
  function request(action) {
    return new Promise((resolve, reject) => {
      const id = ++requestId;
      pending.set(id, {resolve, reject});
      try { native.request(action, id); } catch (error) { pending.delete(id); reject(error); }
    });
  }
  function scan() {
    return new Promise((resolve, reject) => {
      const id = ++requestId; pending.set(id, {resolve, reject});
      try { native.scanLibraryFolder(id); } catch (error) { pending.delete(id); reject(error); }
    });
  }
  function nativePayloadRequest(method, payload) {
    return new Promise((resolve, reject) => {
      const id = ++requestId;
      pending.set(id, {resolve, reject});
      try {
        const fn = native[method];
        if (typeof fn !== 'function') throw new Error('Встроенный загрузчик недоступен в этой сборке');
        fn.call(native, JSON.stringify(payload || {}), id);
      } catch (error) {
        pending.delete(id);
        reject(error);
      }
    });
  }
  window.__localifyAndroidResolve = (id, serialized, error) => {
    const item = pending.get(Number(id)); if (!item) return;
    pending.delete(Number(id));
    if (error) { item.reject(new Error(String(error))); return; }
    item.resolve(parse(serialized, null));
  };
  const no = () => Promise.resolve(null);
  const none = () => {};
  const falsePromise = () => Promise.resolve(false);
  const config = () => parse(native.providerConfig(), {ytDlpPath:'Not available in Android build', cookiesFile:'', proxy:'', downloadMode:'m4a'});

  const localify = {
    loadState: () => Promise.resolve(parse(native.loadState(), {library:[],playlists:[]})),
    saveState: data => Promise.resolve(native.saveState(JSON.stringify(data || {}))),
    pickFiles: () => request('pickFiles'),
    pickFolder: () => request('pickFolder'),
    chooseLibraryFolder: () => request('chooseLibraryFolder'),
    scanLibraryFolder: () => scan(),
    scanLibraryChange: () => Promise.resolve({}),
    scanLibraryChanges: () => Promise.resolve([]),
    importDroppedFiles: () => Promise.resolve([]),
    importDroppedPaths: () => Promise.resolve([]),
    getPathForFile: () => '',
    pickImage: () => request('pickImage'),
    openLibraryFolder: () => Promise.resolve(native.openLibraryFolder() ? true : ''),
    onLibraryFolderChanged: none, onLibraryScanProgress: none, onSaveFailed: none,
    deleteFiles: paths => Promise.resolve(native.deleteFiles(JSON.stringify(paths || []))),
    hashLibraryFiles: paths => Promise.resolve(parse(native.hashLibraryFiles(JSON.stringify(paths || [])), {})),
    findMissingLibraryTracks: () => Promise.resolve(parse(native.findMissingLibraryTracks(), [])),
    recoveryInfo: () => Promise.resolve(parse(native.recoveryInfo(), [])),
    restoreBackup: () => Promise.resolve(native.restoreBackup()),
    getLibraryWatchStatus: () => Promise.resolve(parse(native.getLibraryWatchStatus(), {enabled:false,active:false,folder:''})),
    scanLibraryChange: () => Promise.resolve({}),
    settings: {
      get: () => Promise.resolve(parse(native.getSettings(), {})),
      save: data => Promise.resolve(native.saveSettings(JSON.stringify(data || {})))
    },
    playback: {
      updateState: data => native.updatePlayback(JSON.stringify(data || {})),
      nowPlaying: data => native.nowPlaying(JSON.stringify(data || {})),
      onMediaKey: callback => { window.__localifyMediaKey = action => { try { callback(action); } catch (e) { console.warn(e); } }; },
      loadSession: () => Promise.resolve(parse(native.getPlaybackSession(), null)),
      saveSession: data => native.savePlaybackSession(JSON.stringify(data || {})),
      flushSession: () => Promise.resolve(native.flushPlayback())
    },
    metadata: {
      search: track => Promise.resolve(parse(native.metadataSearch(JSON.stringify(track || {})), null)),
      refresh: track => Promise.resolve(parse(native.metadataSearch(JSON.stringify(track || {})), null)),
      stats: () => Promise.resolve(parse(native.metadataStats(), {})),
      clearCache: () => Promise.resolve({ok:native.clearMetadataCache()})
    },
    diagnostics: {
      logs: lines => Promise.resolve(native.getLogs(Number(lines) || 200)),
      clearLogs: () => Promise.resolve(native.clearLogs()),
      openLogs: () => Promise.resolve(native.logsDirectory()),
      report: () => Promise.resolve(native.diagnosticsReport())
    },
    reveal: () => Promise.resolve(false), openFolderPath: () => Promise.resolve(false),
    window: { minimize:none, toggleMaximize:() => Promise.resolve(false), close:() => {}, isMaximized:() => Promise.resolve(false), onStateChanged:none },
    radio: { search: payload => Promise.resolve(parse(native.radioSearch(JSON.stringify(payload || {})), [])), click: id => Promise.resolve(parse(native.radioClick(String(id || '')), null)) },
    providers: {
      getConfig: () => Promise.resolve(config()),
      saveConfig: data => Promise.resolve(native.saveProviderConfig(JSON.stringify(data || {}))),
      onlineSearch: async payload => {
        const request = payload || {};
        const query = String(request.query || '');
        const youtubeRequest = { ...request, limit: Math.min(6, Number(request.limit) || 6) };
        const itunesRequest = { ...request, limit: Math.min(8, Number(request.limit) || 8) };

        // Start YouTube immediately, but do not make the faster Apple previews wait
        // for Python/yt-dlp startup. The app merges YouTube results when they arrive.
        const youtubePromise = nativePayloadRequest('searchYtDlp', youtubeRequest)
          .then(value => Array.isArray(value) ? value : parse(value, []))
          .catch(error => {
            console.warn('YouTube search failed', error);
            return { __searchError: error?.message || String(error) };
          });

        const appleValue = await nativePayloadRequest('searchItunes', itunesRequest)
          .catch(error => {
            console.warn('iTunes preview search failed', error);
            return [];
          });
        const apple = Array.isArray(appleValue) ? appleValue : parse(appleValue, []);

        // Deliver the slower provider as a second batch. setTimeout lets the initial
        // iTunes-only result render first even when yt-dlp finishes at nearly the same time.
        youtubePromise.then(result => {
          setTimeout(() => {
            try {
              const callback = window.__localifyAndroidSearchUpdate;
              if (typeof callback === 'function') {
                if (result && !Array.isArray(result) && result.__searchError) {
                  callback({ query, results: [], error: result.__searchError });
                } else {
                  callback({ query, results: Array.isArray(result) ? result : [] });
                }
              }
            } catch (error) { console.warn('Could not merge YouTube search results', error); }
          }, 0);
        });

        const seen = new Set();
        return apple.filter(item => {
          const key = String(item?.provider + ':' + (item?.providerId || item?.sourceUrl || item?.title || '')).toLowerCase();
          if (!key || seen.has(key)) return false;
          seen.add(key);
          return true;
        });
      },
      openSource: url => Promise.resolve(native.openExternal(String(url || ''))),
      diagnostics: () => Promise.resolve(parse(native.providerDiagnostics(), {})),
      onDownloadProgress: callback => {
        window.__localifyAndroidDownloadProgress = data => {
          try { callback(typeof data === 'string' ? parse(data, {}) : (data || {})); }
          catch (error) { console.warn('Download progress callback failed', error); }
        };
      },
      downloadYtDlp: payload => nativePayloadRequest('downloadYtDlp', payload || {}),
      resolveYtDlp: payload => nativePayloadRequest('resolveYtDlp', payload || {}),
      updateYtDlp: () => Promise.reject(new Error('Автообновление встроенного yt-dlp пока не поддерживается; используется версия в APK.')),
      chooseYtDlp: () => Promise.resolve(''), chooseCookiesFile: () => Promise.resolve('')
    },
    playlists: {
      ensureFolders: () => Promise.resolve([]), createFolder: () => Promise.resolve(''), renameFolder: () => Promise.resolve(''),
      deleteFolder: () => Promise.resolve({}), moveTrack: () => Promise.reject(new Error('Физическое перемещение файлов отключено на Android.')),
      moveTrackOut: () => Promise.reject(new Error('Физическое перемещение файлов отключено на Android.')),
      moveExternalFiles: () => Promise.resolve([]), openFolder: () => Promise.resolve('')
    }
  };
  localify.providers.openSource = url => { try { return Promise.resolve(native.openExternal(String(url || ''))); } catch (e) { return Promise.reject(e); } };
  window.localify = localify;
})();
