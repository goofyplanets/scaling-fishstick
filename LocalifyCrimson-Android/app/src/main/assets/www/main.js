const { app, BrowserWindow, dialog, ipcMain, shell, Tray, Menu, nativeImage, Notification, globalShortcut } = require('electron');

const APP_VERSION = require('../package.json').version;
const gotLock = app.requestSingleInstanceLock();
if (!gotLock) { app.quit(); }

const path = require('path');
const fs = require('fs');
const os = require('os');
const https = require('https');
const crypto = require('crypto');
const { AUDIO_EXT, buildFileUrl, enrichTracks, invalidateNearbyCoverCache, pruneCoverCache, clearCoverCache, referencedCoverPaths } = require('./metadata');
const { canonicalYoutubeKey, ytDlpDownload, ytDlpResolveStream, ytDlpSearch, getToolDiagnostics, cleanupStaleDownloadTempDirs, updateYtDlp } = require('./providers');
const { MetadataCache, getStatKeyAsync } = require('./core/metadata-cache');
const { TaskQueue } = require('./core/task-queue');
const { normalizePath, sanitizeFolderName, statKey, collectAudioFiles, collectAudioFilesAsync, safeMoveToFolder } = require('./core/library-utils');
const { LibraryStore } = require('./core/library-store');
const { scanConfiguredFolder: scanFolderWithIndex, scanLibraryChange: scanLibraryChangeWithIndex } = require('./core/library-scanner');
const { createPathGuard } = require('./core/path-guard');
const { FileLogger } = require('./core/file-logger');

// Логи main-процесса: файл в папке данных приложения + перехват необработанных
// ошибок, чтобы падение не оставалось без следов. console.error/warn дублируются
// в файл, поэтому уже существующие сообщения тоже попадают в отчёт.
function getLogDir() { return path.join(app.getPath('userData'), 'logs'); }
const fileLogger = new FileLogger(path.join(getLogDir(), 'main.log'));
for (const level of ['error', 'warn']) {
  const original = console[level].bind(console);
  console[level] = (...args) => {
    try {
      fileLogger.write(level, args.map(a => (a instanceof Error ? a.stack : (a && typeof a === 'object' ? JSON.stringify(a) : String(a)))).join(' '));
    } catch {}
    original(...args);
  };
}
process.on('uncaughtException', err => {
  try { fileLogger.error(`uncaughtException: ${err?.stack || err}`); } catch {}
  console.error(err);
});
process.on('unhandledRejection', reason => {
  try { fileLogger.error(`unhandledRejection: ${reason?.stack || reason}`); } catch {}
  console.error(reason);
});

// Main-process runtime state. Keep these declarations before any IPC handler can
// run so renderer events such as playback:state/nowPlaying cannot throw a
// ReferenceError during startup.
let mainWindow = null;
let tray = null;
let forceQuit = false;
let trayState = { title: 'Localify Crimson', artist: '', album: '', playing: false };
let registeredMediaKeys = false;
let folderWatch = null;
let folderWatchTimer = null;
let folderWatchChanges = new Map();
let folderWatchNeedsFullScan = false;
let playbackWriteTimer = null;
let playbackWritePromise = null;
let pendingPlaybackState = null;
let playbackWriteVersion = 0;
const ytDlpDownloadJobs = new Map();
// Не больше двух одновременных загрузок: иначе пять кликов запускали пять
// процессов yt-dlp, которые мешали друг другу и YouTube.
const downloadQueue = new TaskQueue({ concurrency: 2, name: 'downloads' });
const ytDlpResolveJobs = new Map();
const trustedImportPaths = new Set();
// Набор доверенных путей библиотеки перестраивался на каждую проверку (включая
// пакетное хеширование и перемещение файлов). Кэшируем его по версии записи.
let libraryPathCache = { version: -1, set: new Set() };
function getLibraryPathsCached() {
  const version = libraryStore.writeVersion;
  if (libraryPathCache.version !== version) {
    const set = new Set();
    for (const t of (safeReadStore().library || [])) {
      for (const p of [t?.path, t?.sourcePath]) if (p) set.add(normalizePath(p));
    }
    libraryPathCache = { version, set };
  }
  return libraryPathCache.set;
}
const pathGuard = createPathGuard({
  getMusicFolder: () => safeReadSettings().musicFolder || '',
  getUserData: () => app.getPath('userData'),
  getLibraryPaths: getLibraryPathsCached
});

function getStorePath() { return path.join(app.getPath('userData'), 'localify-library.json'); }
function getSettingsPath() { return path.join(app.getPath('userData'), 'localify-settings.json'); }
function getMetadataCachePath() { return path.join(app.getPath('userData'), 'localify-metadata-cache.json'); }
function getCoverCachePath() { return path.join(app.getPath('userData'), 'cover-cache'); }
function getProviderSecretsPath(){ return path.join(app.getPath('userData'), 'localify-provider-secrets.json'); }
function getPlaybackStatePath(){ return path.join(app.getPath('userData'), 'localify-playback.json'); }
function safeReadPlaybackState(){
  try {
    const p=getPlaybackStatePath();
    if(!fs.existsSync(p)) return { trackId:'', sourcePath:'', position:0, volume:0.8, updatedAt:0 };
    return { trackId:'', sourcePath:'', position:0, volume:0.8, wasPlaying:false, updatedAt:0, ...JSON.parse(fs.readFileSync(p,'utf8')) };
  } catch { return { trackId:'', sourcePath:'', position:0, volume:0.8, queueIds:[], queueBaseIds:[], queueIndex:-1, playbackSource:'library', shuffleMode:'off', repeat:false, updatedAt:0 }; }
}
async function atomicWriteJsonAsync(filePath, data, { backup = false } = {}) {
  try {
    await fs.promises.mkdir(path.dirname(filePath), { recursive: true });
    const tmp = `${filePath}.tmp`;
    await fs.promises.writeFile(tmp, JSON.stringify(data), 'utf8');
    if (backup) { try { await fs.promises.copyFile(filePath, `${filePath}.bak`); } catch {} }
    // rename перезаписывает существующий файл и на Windows; предварительное
    // удаление цели открывало окно, в котором при падении файла не было вовсе.
    try {
      await fs.promises.rename(tmp, filePath);
    } catch (renameErr) {
      if (renameErr && (renameErr.code === 'EPERM' || renameErr.code === 'EACCES' || renameErr.code === 'EEXIST')) {
        await fs.promises.rm(filePath, { force: true });
        await fs.promises.rename(tmp, filePath);
      } else {
        throw renameErr;
      }
    }
    return true;
  } catch {
    try { await fs.promises.unlink(`${filePath}.tmp`); } catch {}
    return false;
  }
}
function safeWritePlaybackState(data) {
  pendingPlaybackState = data;
  playbackWriteVersion += 1;
  const version = playbackWriteVersion;
  clearTimeout(playbackWriteTimer);
  playbackWriteTimer = setTimeout(() => { void flushPlaybackState(version); }, 1800);
  return true;
}
async function flushPlaybackState(version = playbackWriteVersion) {
  clearTimeout(playbackWriteTimer);
  playbackWriteTimer = null;
  if (!pendingPlaybackState) return true;
  if (playbackWritePromise) return playbackWritePromise;
  const payload = pendingPlaybackState;
  const payloadVersion = version;
  playbackWritePromise = atomicWriteJsonAsync(getPlaybackStatePath(), payload, { backup: false });
  try {
    return await playbackWritePromise;
  } finally {
    playbackWritePromise = null;
    if (playbackWriteVersion > payloadVersion && pendingPlaybackState) {
      playbackWriteTimer = setTimeout(() => { void flushPlaybackState(playbackWriteVersion); }, 0);
    } else if (playbackWriteVersion === payloadVersion) {
      pendingPlaybackState = null;
    }
  }
}
function readProviderSecrets(){ return {}; }
function writeProviderSecrets(){ return true; }
function getPlaylistRoot(){ const settings=safeReadSettings(); return path.join(settings.musicFolder && fs.existsSync(settings.musicFolder) ? settings.musicFolder : app.getPath('music'), 'Localify Playlists'); }
function ensurePlaylistFolder(id,name){ const root=getPlaylistRoot(); fs.mkdirSync(root,{recursive:true}); let base=`${sanitizeFolderName(name)} [${String(id).slice(-8)}]`; let folder=path.join(root,base); fs.mkdirSync(folder,{recursive:true}); return folder; }
const DEFAULT_SETTINGS = {
  closeToTray: true,
  startMinimized: false,
  trayEnabled: true,
  minimizeToTray: true,
  mediaKeys: true,
  notifications: true,
  onlineMetadata: true,
  renameFiles: false,
  moveFilesIntoPlaylists: true,
  musicFolder: '',
  ytDlpPath: 'yt-dlp',
  cookiesFile: '',
  proxy: '',
  downloadMode: 'mp3',
  gapless: true,
  uiDensity: 'normal',
  coverSize: 'medium',
  reduceMotion: false,
  autoWatch: true
};
function atomicWriteJson(filePath, data){
  try {
    fs.mkdirSync(path.dirname(filePath), { recursive:true });
    const tmp=`${filePath}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(data, null, 2), 'utf8');
    try { fs.copyFileSync(filePath, `${filePath}.bak`); } catch {}
    try {
      fs.renameSync(tmp, filePath);
    } catch (renameErr) {
      if (renameErr && (renameErr.code === 'EPERM' || renameErr.code === 'EACCES' || renameErr.code === 'EEXIST')) {
        try { fs.rmSync(filePath, { force: true }); } catch {}
        fs.renameSync(tmp, filePath);
      } else {
        throw renameErr;
      }
    }
    return true;
  } catch {
    try { if(fs.existsSync(`${filePath}.tmp`)) fs.unlinkSync(`${filePath}.tmp`); } catch {}
    return false;
  }
}
function normalizeSettings(raw){
  const source = raw && typeof raw === 'object' ? raw : {};
  const next = { ...DEFAULT_SETTINGS };
  for (const key of Object.keys(DEFAULT_SETTINGS)) {
    if (Object.prototype.hasOwnProperty.call(source, key)) next[key] = source[key];
  }
  next.ytDlpPath = String(next.ytDlpPath || 'yt-dlp').trim() || 'yt-dlp';
  next.cookiesFile = String(next.cookiesFile || '').trim();
  next.proxy = String(next.proxy || '').trim();
  next.downloadMode = next.downloadMode === 'original' ? 'original' : 'mp3';
  next.musicFolder = String(next.musicFolder || '');
  next.autoWatch = next.autoWatch !== false;
  next.compactPlayer = next.compactPlayer === true;
  return next;
}
// Настройки читаются на горячих путях (наблюдение за папкой, проверка путей,
// свёртывание окна), поэтому распарсенный файл кэшируется, а копия выдаётся
// вызывающему: правки «на месте» не должны попадать в кэш.
let settingsCache = null;
function safeReadSettings() {
  if (settingsCache) return { ...settingsCache };
  try {
    const p=getSettingsPath();
    if(!fs.existsSync(p)) return { ...(settingsCache = { ...DEFAULT_SETTINGS }) };
    settingsCache = normalizeSettings(JSON.parse(fs.readFileSync(p,'utf8')));
  } catch { settingsCache = { ...DEFAULT_SETTINGS }; }
  return { ...settingsCache };
}
function safeWriteSettings(data) { settingsCache = null; return atomicWriteJson(getSettingsPath(), normalizeSettings(data)); }

const metadataCache = new MetadataCache(getMetadataCachePath());
const metadataQueue = new TaskQueue({ concurrency: 2, minStartInterval: 1100, name: 'metadata' });
const metadataJobs = new Map();
let metadataCacheSaveTimer = null;
function scheduleMetadataCacheSave() {
  clearTimeout(metadataCacheSaveTimer);
  metadataCacheSaveTimer = setTimeout(() => {
    metadataCache.prune(20000);
    metadataCache.save();
    metadataCacheSaveTimer = null;
  }, 1500);
}
function getAppIcon() { return nativeImage.createFromPath(path.join(__dirname, '..', 'assets', 'icon.png')); }
function rebuildTrayMenu() {
  if (!tray) return;
  const label = trayState.artist ? `${trayState.title}${trayState.artist ? ` — ${trayState.artist}` : ''}` : 'Ничего не играет';
  tray.setToolTip(trayState.artist ? `${trayState.title} — ${trayState.artist}` : 'Localify Crimson');
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: 'Открыть Crimson', click: () => { mainWindow?.show(); mainWindow?.focus(); } },
    { type: 'separator' },
    { label, enabled: false },
    { label: trayState.playing ? 'Пауза' : 'Воспроизвести', enabled: !!trayState.title && trayState.title !== 'Localify Crimson', click: () => sendToRenderer('media-key', 'play-pause') },
    { label: 'Предыдущий трек', click: () => sendToRenderer('media-key', 'previous') },
    { label: 'Следующий трек', click: () => sendToRenderer('media-key', 'next') },
    { type: 'separator' },
    { label: 'Выход', click: () => { forceQuit = true; app.quit(); } }
  ]));
}
function createTray() {
  if (tray || !safeReadSettings().trayEnabled) return;
  const icon = getAppIcon();
  tray = new Tray(icon.resize({ width: 20, height: 20 }));
  tray.setToolTip('Localify Crimson');
  rebuildTrayMenu();
  tray.on('double-click', () => { mainWindow?.show(); mainWindow?.focus(); });
}
function destroyTray() { if (tray) { tray.destroy(); tray = null; } }
function registerMediaKeys() {
  if (registeredMediaKeys || !safeReadSettings().mediaKeys) return;
  const keys = [
    ['MediaPlayPause', 'play-pause'],
    ['MediaNextTrack', 'next'],
    ['MediaPreviousTrack', 'previous']
  ];
  keys.forEach(([accelerator, action]) => {
    try { globalShortcut.register(accelerator, () => sendToRenderer('media-key', action)); } catch {}
  });
  registeredMediaKeys = true;
}
function unregisterMediaKeys() {
  try { globalShortcut.unregisterAll(); } catch {}
  registeredMediaKeys = false;
}
const libraryStore = new LibraryStore(getStorePath(), {
  onError: (err) => {
    const message = String(err?.message || err || 'неизвестная ошибка');
    console.error('[library] не удалось сохранить библиотеку:', message);
    // Ошибку записи нельзя глотать: иначе правки пользователя тихо исчезают.
    sendToRenderer('library:saveFailed', { message, code: String(err?.code || '') });
  }
});
function safeReadStore() { return libraryStore.read(); }
function safeWriteStore(data, options = {}) { return libraryStore.write(data, options); }

if (gotLock) {
  app.on('second-instance', () => {
    if (!mainWindow) return;
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.show();
    mainWindow.focus();
  });
}

let rendererReloads = 0;
function sendToRenderer(channel, payload) {
  try {
    if (!mainWindow || mainWindow.isDestroyed() || mainWindow.webContents.isDestroyed()) return false;
    mainWindow.webContents.send(channel, payload);
    return true;
  } catch { return false; }
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1440, height: 920, minWidth: 760, minHeight: 560,
    backgroundColor: '#0e0508', title: 'Localify Crimson', frame: false, icon: path.join(__dirname, '..', 'assets', 'icon.ico'),
    autoHideMenuBar: true,
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, sandbox: true }
  });
  mainWindow.loadFile(path.join(__dirname, 'index.html'));
  const settings = safeReadSettings();
  mainWindow.setTitle('Localify Crimson');
  if (settings.startMinimized) mainWindow.hide();
  mainWindow.on('minimize', () => { if (safeReadSettings().minimizeToTray) setTimeout(() => mainWindow?.hide(), 0); });
  const notifyWindowState = () => sendToRenderer('window:stateChanged', !!mainWindow?.isMaximized());
  mainWindow.on('maximize', notifyWindowState);
  mainWindow.on('unmaximize', notifyWindowState);
  mainWindow.on('close', (event) => {
    if (!forceQuit && safeReadSettings().closeToTray) { event.preventDefault(); mainWindow.hide(); }
  });
  // Ссылку нельзя держать на уничтоженное окно: иначе рассылки из таймеров
  // (наблюдение за папкой, прогресс загрузок) бросают исключение в main-процессе.
  mainWindow.on('closed', () => { mainWindow = null; });
  mainWindow.webContents.on('render-process-gone', (_e, details) => {
    console.error('[window] рендерер завершился:', details?.reason, details?.exitCode);
    if (details?.reason === 'clean-exit') return;
    // Восстанавливаем интерфейс, но не зацикливаемся на повторных падениях.
    if (rendererReloads < 2) {
      rendererReloads += 1;
      setTimeout(() => { try { if (mainWindow && !mainWindow.isDestroyed()) mainWindow.reload(); } catch {} }, 500);
    }
  });
  mainWindow.webContents.on('unresponsive', () => console.error('[window] рендерер не отвечает'));
  // Интерфейс не должен никуда уходить: без этого перетаскивание html-файла на
  // окно или случайная ссылка заменяли документ, сохраняя доступ к preload API.
  mainWindow.webContents.on('will-navigate', (event, url) => {
    const current = (() => { try { return mainWindow?.webContents.getURL() || ''; } catch { return ''; } })();
    if (url !== current) {
      event.preventDefault();
      console.warn('[window] навигация заблокирована:', url);
    }
  });
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//i.test(url)) void shell.openExternal(url);
    return { action: 'deny' };
  });
  try {
    const clipboardPermissions = new Set(['clipboard-sanitized-write', 'clipboard-read']);
    mainWindow.webContents.session.setPermissionRequestHandler((_wc, permission, callback) => {
      const allowed = clipboardPermissions.has(permission);
      if (!allowed) console.warn('[window] запрос разрешения отклонён:', permission);
      callback(allowed);
    });
  } catch {}
}


function stopFolderWatch() {
  if (folderWatch) { try { folderWatch.close(); } catch {} folderWatch = null; }
  if (folderWatchTimer) { clearTimeout(folderWatchTimer); folderWatchTimer = null; }
  folderWatchChanges.clear();
  folderWatchNeedsFullScan = false;
}
function startFolderWatch(folder) {
  stopFolderWatch();
  if (!folder || !fs.existsSync(folder)) return;
  try {
    folderWatch = fs.watch(folder, { recursive: true }, (eventType, filename) => {
      const changed = filename ? String(filename) : '';
      if (/\.(tmp|part|download)$/i.test(changed)) return;
      // Служебные каталоги (.localify-ytdlp-* и любые скрытые) — не библиотека:
      // иначе промежуточный файл загрузки попадал в список изменений.
      if (changed && changed.split(/[\\/]/).some(segment => segment.startsWith('.'))) return;
      if (!changed) {
        folderWatchNeedsFullScan = true;
      } else {
        const key = normalizePath(path.isAbsolute(changed) ? changed : path.join(folder, changed));
        folderWatchChanges.set(key, { eventType: String(eventType || 'rename'), filename: changed });
        try { invalidateNearbyCoverCache(path.dirname(path.isAbsolute(changed) ? changed : path.join(folder, changed))); } catch {}
      }
      clearTimeout(folderWatchTimer);
      folderWatchTimer = setTimeout(() => {
        const changes = [...folderWatchChanges.values()];
        const fullScan = folderWatchNeedsFullScan;
        folderWatchChanges.clear();
        folderWatchNeedsFullScan = false;
        if (fullScan || changes.length) {
          sendToRenderer('library:folderChanged', { changes, fullScan });
        }
      }, 300);
    });
  } catch {}
}
function normalizeLibraryTrack(track) {
  return { ...track, id: track.id || track.path };
}
function emitLibraryScanProgress(payload) {
  try { sendToRenderer('library:scanProgress', payload || {}); } catch {}
}
async function scanConfiguredFolder(options = {}) {
  const settings = safeReadSettings();
  return scanFolderWithIndex({
    settings,
    store: safeReadStore(),
    audioExt: AUDIO_EXT,
    enrichTracks,
    coverCachePath: getCoverCachePath(),
    ensurePlaylistFolder,
    onProgress: emitLibraryScanProgress,
    fastStart: options?.fastStart === true
  });
}


function cachedCoverIsMissing(result) {
  const cover = typeof result?.cover === 'string' ? result.cover : '';
  if (!cover || !/^file:/i.test(cover)) return false;
  try {
    const { fileURLToPath } = require('url');
    return !fs.existsSync(fileURLToPath(cover));
  } catch { return true; }
}

async function metadataCacheEntry(filePath, sig = '') {
  const actualSig = sig || await getStatKeyAsync(filePath);
  const cached = actualSig ? metadataCache.get(filePath, actualSig) : null;
  if (!cached || !cached.result) return null;
  if (cachedCoverIsMissing(cached.result)) return null;
  return { ...cached.result, _statKey: actualSig, metadataCachedAt: cached.savedAt || 0 };
}
async function enqueueMetadataSearch(filePath, settings, force = false) {
  const sig = await getStatKeyAsync(filePath);
  if (!sig) return null;
  const cacheKey = `${normalizePath(filePath)}::${sig}`;
  if (!force) {
    const cached = await metadataCacheEntry(filePath, sig);
    if (cached) return cached;
  }
  if (metadataJobs.has(cacheKey)) return metadataJobs.get(cacheKey);
  const job = metadataQueue.enqueue(cacheKey, async () => {
    if (!force) {
      const cached = await metadataCacheEntry(filePath, sig);
      if (cached) return cached;
    }
    const [result] = await enrichTracks([filePath], { ...settings, onlineMetadata: true, renameFiles: settings.renameFiles === true }, getCoverCachePath());
    if (!result) return null;
    const finalSig = await getStatKeyAsync(result.path || filePath) || sig;
    const cleanResult = { ...result, _statKey: finalSig, metadataCachedAt: Date.now() };
    metadataCache.set(filePath, sig, cleanResult);
    if (result.path && normalizePath(result.path) !== normalizePath(filePath)) metadataCache.set(result.path, finalSig, cleanResult);
    scheduleMetadataCacheSave();
    return cleanResult;
  }).finally(() => metadataJobs.delete(cacheKey));
  metadataJobs.set(cacheKey, job);
  return job;
}
function getPlaylistMode(settings = safeReadSettings()) { return settings.moveFilesIntoPlaylists !== false ? 'physical' : 'virtual'; }

// cookies.txt is the only cookie source that always works on Windows: Chrome
// and Edge encrypt their store with App-Bound Encryption, so yt-dlp cannot read
// them (DPAPI error). A file the user picked wins; otherwise cookies.txt in the
// app data folder is picked up automatically.
function getYtOptions(settings = safeReadSettings()) {
  const candidates = [
    String(settings.cookiesFile || '').trim(),
    path.join(app.getPath('userData'), 'cookies.txt')
  ].filter(Boolean);
  for (const candidate of candidates) {
    try {
      if (fs.statSync(candidate).isFile()) {
        return { cookiesFile: candidate, downloadMode: settings.downloadMode === 'original' ? 'original' : 'mp3', proxy: String(settings.proxy || '').trim() };
      }
    } catch {}
  }
  return { cookiesFile: '', downloadMode: settings.downloadMode === 'original' ? 'original' : 'mp3', proxy: String(settings.proxy || '').trim() };
}

ipcMain.handle('providers:getConfig', () => {
  const settings=safeReadSettings();
  return { ytDlpPath: settings.ytDlpPath || 'yt-dlp', cookiesFile: settings.cookiesFile || '', proxy: settings.proxy || '', downloadMode: settings.downloadMode === 'original' ? 'original' : 'mp3' };
});
ipcMain.handle('providers:diagnostics', async () => {
  const settings = safeReadSettings();
  return getToolDiagnostics(settings.ytDlpPath || 'yt-dlp', getYtOptions(settings));
});
ipcMain.handle('providers:chooseYtDlp', async () => {
  const result = await dialog.showOpenDialog(mainWindow, { title: 'Выберите yt-dlp', properties: ['openFile'], filters: [{ name: 'yt-dlp', extensions: process.platform === 'win32' ? ['exe'] : [''] }] });
  return result.canceled ? '' : (result.filePaths[0] || '');
});
ipcMain.handle('providers:chooseCookiesFile', async () => {
  const result = await dialog.showOpenDialog(mainWindow, { title: 'Выберите файл cookies.txt', properties: ['openFile'], filters: [{ name: 'cookies.txt', extensions: ['txt'] }, { name: 'Все файлы', extensions: ['*'] }] });
  return result.canceled ? '' : (result.filePaths[0] || '');
});
ipcMain.handle('providers:saveConfig', (_e, data) => {
  const settings=safeReadSettings();
  settings.ytDlpPath=String(data?.ytDlpPath||'yt-dlp').trim() || 'yt-dlp';
  if (data && Object.prototype.hasOwnProperty.call(data, 'cookiesFile')) settings.cookiesFile=String(data.cookiesFile||'').trim();
  if (data && Object.prototype.hasOwnProperty.call(data, 'proxy')) settings.proxy=String(data.proxy||'').trim();
  if (data && Object.prototype.hasOwnProperty.call(data, 'downloadMode')) settings.downloadMode=data.downloadMode === 'original' ? 'original' : 'mp3';
  safeWriteSettings(settings);
  return { ytDlpPath:settings.ytDlpPath, cookiesFile:settings.cookiesFile || '', proxy:settings.proxy || '', downloadMode:settings.downloadMode };
});
ipcMain.handle('providers:updateYtDlp', async () => {
  const settings = safeReadSettings();
  const result = await updateYtDlp(settings.ytDlpPath || 'yt-dlp');
  fileLogger.info(`yt-dlp update: ok=${result.ok} version=${result.version || '—'} ${result.message || ''}`);
  return result;
});

ipcMain.handle('diagnostics:logs', (_e, lines) => fileLogger.tail(Number(lines) || 200));
ipcMain.handle('diagnostics:clearLogs', () => fileLogger.clear());
ipcMain.handle('diagnostics:openLogs', async () => {
  const dir = getLogDir();
  try { fs.mkdirSync(dir, { recursive: true }); } catch {}
  await shell.openPath(dir);
  return dir;
});
ipcMain.handle('diagnostics:report', async () => {
  const settings = safeReadSettings();
  let tools = null;
  try { tools = await getToolDiagnostics(settings.ytDlpPath || 'yt-dlp', getYtOptions(settings)); } catch {}
  const store = safeReadStore();
  const lines = [
    `Localify Crimson ${APP_VERSION}`,
    `Electron ${process.versions.electron}, Node ${process.versions.node}, Chromium ${process.versions.chrome}`,
    `Система: ${process.platform} ${process.arch} (${os.release()})`,
    `Папка данных: ${app.getPath('userData')}`,
    `Музыкальная папка: ${settings.musicFolder || 'не выбрана'}`,
    `Плейлистов: ${(store.playlists || []).length}, треков: ${(store.library || []).length}`,
    `yt-dlp: ${tools?.ytDlp?.version || 'не найден'} (${tools?.ytDlp?.path || '—'})${tools?.ytDlp?.updateAvailable ? `, доступна ${tools.ytDlp.latestVersion}` : ''}`,
    `FFmpeg: ${tools?.ffmpeg?.available ? tools.ffmpeg.version : 'не найден'}`,
    `JS runtime: ${tools?.jsRuntime || 'не найден'}`,
    `cookies: файл ${tools?.cookies?.file || '—'}; ${Object.entries(tools?.cookies?.sources || {}).map(([browser, info]) => `${browser}: ${info.state}`).join(', ')}`,
    `Скачивание: режим ${tools?.download?.mode || '—'}, прокси ${tools?.download?.proxy || '—'}, запомненная стратегия ${tools?.download?.preferredStrategy || '—'}`,
    '',
    '--- последние записи лога ---',
    fileLogger.tail(120) || '(лог пуст)'
  ];
  return lines.join('\n');
});
function findExistingDownloadedTrack(candidate, root) {
  const targetKey = canonicalYoutubeKey(candidate);
  if (!targetKey) return '';
  const store = safeReadStore();
  for (const track of (store.library || [])) {
    if (canonicalYoutubeKey(track) !== targetKey) continue;
    const existingPath = track.sourcePath || track.path || '';
    if (existingPath && fs.existsSync(existingPath)) return existingPath;
  }
  const folder = path.join(root, 'Localify Downloads');
  if (!fs.existsSync(folder)) return '';
  const safeStem = String(`${candidate.artist || 'Unknown'} - ${candidate.title || 'Track'}`)
    .replace(/[<>:"/\\|?*\x00-\x1F]/g, ' ')
    .replace(/\s+/g, ' ').trim().replace(/[. ]+$/, '');
  if (!safeStem) return '';
  const escaped = safeStem.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const re = new RegExp(`^${escaped}(?: \\((\\d+)\\))?\\.(?:mp3|m4a|webm|opus|wav|flac)$`, 'i');
  try {
    const match = fs.readdirSync(folder).find(name => re.test(name));
    return match ? path.join(folder, match) : '';
  } catch { return ''; }
}

function getMusicRoot(settings = safeReadSettings()) {
  return settings.musicFolder && fs.existsSync(settings.musicFolder) ? settings.musicFolder : app.getPath('music');
}
// Брошенные папки .localify-ytdlp-* убираются, когда ни одна загрузка не идёт:
// при старте приложения и перед первой загрузкой новой серии.
function sweepStaleDownloadTempDirs(reason) {
  const root = getMusicRoot();
  void cleanupStaleDownloadTempDirs(root).then(removed => {
    if (removed) console.log(`[yt-dlp] удалено временных папок (${reason}): ${removed}`);
  }).catch(() => {});
}

async function downloadYtDlpOnce(candidate) {
  const settings=safeReadSettings();
  const root=getMusicRoot(settings);
  const existing=findExistingDownloadedTrack(candidate, root);
  if(existing) return { path: existing, title:candidate.title, artist:candidate.artist, album:candidate.album||'', sourceUrl:candidate.sourceUrl||'', provider:candidate.provider||'youtube', cover:candidate.cover||'', duplicate:true };
  const key=`${normalizePath(root)}::${canonicalYoutubeKey(candidate)}`;
  if (ytDlpDownloadJobs.has(key)) return ytDlpDownloadJobs.get(key);
  if (!ytDlpDownloadJobs.size) sweepStaleDownloadTempDirs('перед загрузкой');
  const ytOptions = getYtOptions(settings);
  const startedAt = Date.now();
  fileLogger.info(`download start: ${candidate.artist} - ${candidate.title} (режим ${ytOptions.downloadMode}${ytOptions.proxy ? `, прокси ${ytOptions.proxy}` : ''})`);
  const job = downloadQueue.enqueue(key, () => ytDlpDownload(
    candidate,
    root,
    settings.ytDlpPath || 'yt-dlp',
    ytOptions.proxy || '',
    (percent) => {
      sendToRenderer('providers:downloadProgress', {
        key: String(candidate?.providerId || `${candidate?.artist||''}::${candidate?.title||''}`),
        percent,
        status: percent >= 100 ? 'done' : 'downloading'
      });
    },
    ytOptions
  )).then(result => {
    fileLogger.info(`download ok: ${result?.path} (${result?.format || '?'}, ${((Date.now() - startedAt) / 1000).toFixed(1)} с${result?.audioFallback ? ', без FFmpeg' : ''})`);
    return result;
  }).catch(err => {
    fileLogger.error(`download failed: ${candidate.artist} - ${candidate.title}: ${err?.message || err}`);
    throw err;
  }).finally(() => ytDlpDownloadJobs.delete(key));
  ytDlpDownloadJobs.set(key, job);
  return job;
}


const RADIO_BROWSER_SERVERS = ['de1.api.radio-browser.info','nl1.api.radio-browser.info','fr1.api.radio-browser.info','at1.api.radio-browser.info'];
function radioBrowserRequest(server, pathname){
  return new Promise((resolve,reject)=>{
    const req=https.get({hostname:server,path:pathname,headers:{'User-Agent':`LocalifyCrimson/${APP_VERSION} (internet radio)`,'Accept':'application/json'}},res=>{
      let body='';
      res.setEncoding('utf8');
      res.on('data',chunk=>{body+=chunk; if(body.length>5_000_000){req.destroy(new Error('Radio response too large'));}});
      res.on('end',()=>{
        if(res.statusCode && res.statusCode>=400){reject(new Error(`Radio API ${res.statusCode}`));return;}
        try{resolve(JSON.parse(body||'null'));}catch(err){reject(err);}
      });
    });
    req.setTimeout(9000,()=>req.destroy(new Error('Radio API timeout')));
    req.on('error',reject);
  });
}
async function radioBrowserRequestWithFallback(pathname){
  let lastError=null;
  for(const server of RADIO_BROWSER_SERVERS){
    try{return await radioBrowserRequest(server,pathname);}catch(err){lastError=err;}
  }
  throw lastError || new Error('Radio API unavailable');
}

ipcMain.handle('radio:search', async (_e,payload)=>{
  const query=String(payload?.query||'').trim();
  const limit=Math.max(1,Math.min(50,Number(payload?.limit)||30));
  const params=new URLSearchParams({limit:String(limit),hidebroken:'true',order:'clickcount',reverse:'true'});
  if(query) params.set('name',query);
  const endpoint=query ? `/json/stations/search?${params.toString()}` : `/json/stations/topclick?${params.toString()}`;
  const rows=await radioBrowserRequestWithFallback(endpoint);
  return (Array.isArray(rows)?rows:[]).filter(x=>x && (x.url_resolved||x.url)).map(x=>({
    stationuuid:String(x.stationuuid||''), name:String(x.name||'').trim(), country:String(x.country||''), countrycode:String(x.countrycode||''), language:String(x.language||''), tags:String(x.tags||''), codec:String(x.codec||''), bitrate:Number(x.bitrate)||0, favicon:String(x.favicon||''), homepage:String(x.homepage||''), url:String(x.url||''), url_resolved:String(x.url_resolved||x.url||''), votes:Number(x.votes)||0, clickcount:Number(x.clickcount)||0
  }));
});
ipcMain.handle('radio:click', async (_e,stationuuid)=>{
  const id=String(stationuuid||'').trim();
  if(!id) return false;
  try{ await radioBrowserRequestWithFallback(`/json/url/${encodeURIComponent(id)}`); }catch{}
  return true;
});

ipcMain.handle('providers:downloadYtDlp', async (_e, candidate) => downloadYtDlpOnce(candidate));
ipcMain.handle('providers:resolveYtDlp', async (_e, candidate) => {
  const settings=safeReadSettings();
  const ytOptions=getYtOptions(settings);
  return ytDlpResolveStream(candidate, settings.ytDlpPath || 'yt-dlp', ytOptions.proxy || '', ytOptions);
});
ipcMain.handle('providers:onlineSearch', async (_e, payload) => {
  const settings=safeReadSettings();
  const localLibrary=Array.isArray(payload?.localLibrary)?payload.localLibrary:[];
  const ytOptions=getYtOptions(settings);
  return ytDlpSearch(String(payload?.query || ''), settings.ytDlpPath || 'yt-dlp', ytOptions.proxy || '', Number(payload?.limit || 12), ytOptions, localLibrary);
});
ipcMain.handle('providers:openSource', async (_e, url) => {
  const target=String(url||'').trim();
  if(!/^https?:\/\//i.test(target)) throw new Error('Некорректная ссылка источника');
  await shell.openExternal(target);
  return true;
});
ipcMain.handle('library:load', () => {
  const store = safeReadStore();
  let changed = false;
  for (const track of (store.library || [])) {
    for (const key of ['cover']) {
      if (cachedCoverIsMissing(track)) { track[key] = ''; delete track.metadataCheckedAt; delete track.metadataStatKey; changed = true; }
    }
  }
  if (changed) { try { safeWriteStore(store); } catch {} }
  return store;
});
ipcMain.handle('settings:get', () => safeReadSettings());
ipcMain.handle('playback:loadSession', () => safeReadPlaybackState());
ipcMain.on('playback:saveSession', (_e, data) => {
  const next = data && typeof data === 'object' ? data : {};
  const queueIds = Array.isArray(next.queueIds) ? next.queueIds.map(x => String(x || '')).filter(Boolean).slice(0, 2000) : [];
  const queueBaseIds = Array.isArray(next.queueBaseIds) ? next.queueBaseIds.map(x => String(x || '')).filter(Boolean).slice(0, 2000) : [];
  const normalized = {
    trackId: String(next.trackId || ''),
    sourcePath: String(next.sourcePath || ''),
    position: Math.max(0, Number(next.position) || 0),
    volume: Math.min(1, Math.max(0, Number(next.volume) ?? 0.8)),
    queueIds,
    queueBaseIds,
    queueIndex: Math.max(-1, Number.isFinite(Number(next.queueIndex)) ? Number(next.queueIndex) : -1),
    playbackSource: String(next.playbackSource || 'library'),
    shuffleMode: ['off','normal'].includes(next.shuffleMode) ? next.shuffleMode : 'off',
    repeat: !!next.repeat,
    updatedAt: Date.now()
  };
  if (next.immediate) {
    pendingPlaybackState = normalized;
    playbackWriteVersion += 1;
    void flushPlaybackState(playbackWriteVersion);
  } else {
    safeWritePlaybackState(normalized);
  }
});
ipcMain.handle('playback:flush', async () => flushPlaybackState());
ipcMain.handle('settings:save', (_e, data) => {
  const next = normalizeSettings({ ...safeReadSettings(), ...(data || {}) });
  if (!next.trayEnabled) { next.closeToTray = false; next.minimizeToTray = false; }
  const ok = safeWriteSettings(next);
  if (mainWindow) mainWindow.setTitle('Localify Crimson');
  if (tray) tray.setToolTip('Localify Crimson');
  if (next.trayEnabled) createTray(); else destroyTray();
  unregisterMediaKeys();
  if (next.mediaKeys) registerMediaKeys();
  if (next.autoWatch && next.musicFolder) startFolderWatch(next.musicFolder); else stopFolderWatch();
  return ok;
});
ipcMain.handle('library:save', (_e, data) => {
  const payload = data && typeof data === 'object' ? { ...data } : {};
  payload.library = Array.isArray(payload.library) ? payload.library.map(track => {
    const clean = track && typeof track === 'object' ? { ...track } : track;
    if (clean && typeof clean === 'object') { delete clean.replayGainTrack; delete clean.replayGainAlbum; delete clean.crossfade; }
    return clean;
  }) : [];
  return safeWriteStore(payload);
});
ipcMain.handle('library:recoveryInfo', () => safeReadStore() && libraryStore.recoveryInfo().map(x => ({ modifiedAt: x.modifiedAt })));
ipcMain.handle('library:restoreBackup', () => libraryStore.restoreLatestBackup());
// Файлы дубликатов отправляются в корзину, а не удаляются навсегда: путь
// проверяется тем же guard'ом, что и остальные файловые операции.
ipcMain.handle('library:deleteFiles', async (_e, paths) => {
  const list = Array.isArray(paths) ? paths.filter(p => typeof p === 'string' && p).slice(0, 500) : [];
  const removed = [];
  const failed = [];
  for (const filePath of list) {
    try {
      if (!pathGuard.isTrusted(filePath)) { failed.push({ path: filePath, reason: 'Недоверенный путь' }); continue; }
      if (!fs.existsSync(filePath)) { removed.push(filePath); continue; }
      await shell.trashItem(filePath);
      removed.push(filePath);
    } catch (err) {
      failed.push({ path: filePath, reason: String(err?.message || err) });
    }
  }
  fileLogger.info(`deleteFiles: в корзину ${removed.length}, ошибок ${failed.length}`);
  return { removed, failed };
});
ipcMain.handle('library:hashFiles', async (_e, paths) => {  const list = Array.isArray(paths) ? paths.filter(p => typeof p === 'string' && p).slice(0, 400) : [];
  const out = {};
  for (const filePath of list) {
    try {
      if (!fs.existsSync(filePath) || !pathGuard.isTrusted(filePath)) continue;
      const hash = crypto.createHash('sha256');
      await new Promise((resolve, reject) => {
        const stream = fs.createReadStream(filePath, { highWaterMark: 1024 * 1024 });
        stream.on('data', chunk => hash.update(chunk));
        stream.on('error', reject);
        stream.on('end', resolve);
      });
      out[normalizePath(filePath)] = hash.digest('hex');
    } catch {}
  }
  return out;
});
ipcMain.handle('library:findMissing', () => {
  const store = safeReadStore();
  return (store.library || []).filter(t => { const p = t.sourcePath || t.path; return !!p && !fs.existsSync(p); }).map(t => ({ id: t.id, path: t.path, sourcePath: t.sourcePath }));
});

ipcMain.handle('playlists:ensureFolders', (_e, items) => {
  if (getPlaylistMode() === 'virtual') return {};
  const out={}; for(const item of (Array.isArray(items)?items:[])){ if(!item?.id) continue; out[item.id]=ensurePlaylistFolder(item.id,item.name||'Плейлист'); } return out;
});
ipcMain.handle('playlists:createFolder', (_e, {id,name}) => getPlaylistMode() === 'virtual' ? '' : ensurePlaylistFolder(id,name));
ipcMain.handle('playlists:renameFolder', (_e, {id,name}) => {
  if (getPlaylistMode() === 'virtual') return '';
  const settings=safeReadSettings(); const root=path.join(settings.musicFolder && fs.existsSync(settings.musicFolder)?settings.musicFolder:app.getPath('music'),'Localify Playlists'); fs.mkdirSync(root,{recursive:true});
  const suffix=`[${String(id).slice(-8)}]`; const target=path.join(root,`${sanitizeFolderName(name)} ${suffix}`);
  const store=safeReadStore(); const p=(store.playlists||[]).find(x=>x.id===id); const old=p?.folderPath;
  if(old && fs.existsSync(old) && normalizePath(old)!==normalizePath(target)) { try{ fs.renameSync(old,target); return target; }catch{} }
  fs.mkdirSync(target,{recursive:true}); return target;
});
ipcMain.handle('playlists:deleteFolder', (_e,id) => {
  if (getPlaylistMode() === 'virtual') return { ok: true, moves: [] };
  const store=safeReadStore(); const p=(store.playlists||[]).find(x=>x.id===id); const folder=p?.folderPath || ensurePlaylistFolder(id,p?.name||'Плейлист');
  const settings=safeReadSettings(); const root=settings.musicFolder && fs.existsSync(settings.musicFolder) ? settings.musicFolder : app.getPath('music');
  const moves=[];
  if(fs.existsSync(folder)){
    for(const src of collectAudioFiles(folder, AUDIO_EXT)){ try{ const dest=safeMoveToFolder(src,root); moves.push({oldPath:src,newPath:dest,url:buildFileUrl(dest)}); }catch{} }
    try{ fs.rmSync(folder,{recursive:true,force:true}); }catch{}
  }
  return {ok:true,moves};
});
ipcMain.handle('playlists:moveTrack', (_e,{filePath,playlistId}) => { if(typeof filePath!=='string'||!filePath||!fs.existsSync(filePath)||!fs.statSync(filePath).isFile()||!AUDIO_EXT.has(path.extname(filePath).toLowerCase())) throw new Error('Недопустимый аудиофайл'); if(!pathGuard.isTrusted(filePath) && !trustedImportPaths.has(normalizePath(filePath))) throw new Error('Недоверенный путь к файлу'); if(!playlistId) throw new Error('Недопустимый плейлист'); if (getPlaylistMode() === 'virtual') return {path:filePath,sourcePath:filePath,url:buildFileUrl(filePath),virtual:true}; const store=safeReadStore(); const p=(store.playlists||[]).find(x=>x.id===playlistId); if(!p) throw new Error('Плейлист не найден'); const folder=ensurePlaylistFolder(playlistId,p.name||'Плейлист'); const dest=safeMoveToFolder(filePath,folder); return {path:dest,sourcePath:dest,url:buildFileUrl(dest)}; });
ipcMain.handle('playlists:moveTrackOut', (_e,{filePath,playlistId}) => { if(typeof filePath!=='string'||!filePath||!fs.existsSync(filePath)||!fs.statSync(filePath).isFile()||!AUDIO_EXT.has(path.extname(filePath).toLowerCase())) throw new Error('Недопустимый аудиофайл'); if(!pathGuard.isTrusted(filePath) && !trustedImportPaths.has(normalizePath(filePath))) throw new Error('Недоверенный путь к файлу'); if (getPlaylistMode() === 'virtual') return {path:filePath,sourcePath:filePath,url:buildFileUrl(filePath),virtual:true}; const store=safeReadStore(); const p=(store.playlists||[]).find(x=>x.id===playlistId); if(!p) throw new Error('Плейлист не найден'); const settings=safeReadSettings(); const root=settings.musicFolder && fs.existsSync(settings.musicFolder) ? settings.musicFolder : app.getPath('music'); const dest=safeMoveToFolder(filePath,root); return {path:dest,sourcePath:dest,url:buildFileUrl(dest)}; });
ipcMain.handle('playlists:moveExternalFiles', (_e,{paths,playlistId}) => { if (getPlaylistMode() === 'virtual') return Array.isArray(paths) ? paths.filter(p=>typeof p==='string' && fs.existsSync(p) && (trustedImportPaths.has(normalizePath(p)) || pathGuard.isTrusted(p))) : []; const store=safeReadStore(); const p=(store.playlists||[]).find(x=>x.id===playlistId); const folder=ensurePlaylistFolder(playlistId,p?.name||'Плейлист'); const out=[]; for(const src of (Array.isArray(paths)?paths:[])){ try{ if(!trustedImportPaths.has(normalizePath(src)) && !pathGuard.isTrusted(src)) continue; out.push(safeMoveToFolder(src,folder)); }catch{} } return out; });
ipcMain.handle('playlists:openFolder', async (_e,id) => { if (getPlaylistMode() === 'virtual') return ''; const store=safeReadStore(); const p=(store.playlists||[]).find(x=>x.id===id); const folder=ensurePlaylistFolder(id,p?.name||'Плейлист'); if(fs.existsSync(folder)) await shell.openPath(folder); return folder; });
ipcMain.handle('library:chooseFolder', async () => {
  const result = await dialog.showOpenDialog(mainWindow, { title: 'Выберите основную папку с музыкой', properties: ['openDirectory'] });
  if (result.canceled || !result.filePaths[0]) return null;
  const folder = result.filePaths[0];
  const settings = safeReadSettings();
  settings.musicFolder = folder;
  safeWriteSettings(settings);
  if (settings.autoWatch !== false) startFolderWatch(folder);
  return scanFolderWithIndex({
    settings, store: safeReadStore(), audioExt: AUDIO_EXT, enrichTracks,
    coverCachePath: getCoverCachePath(), ensurePlaylistFolder, onProgress: emitLibraryScanProgress
  }).then(scan => ({ ...scan, folder }));
});
ipcMain.handle('library:scanFolder', async (_e, options) => scanConfiguredFolder(options || {}));
ipcMain.handle('library:scanChange', async (_e, payload) => {
  const settings = safeReadSettings();
  return scanLibraryChangeWithIndex({
    settings, store: safeReadStore(), audioExt: AUDIO_EXT, enrichTracks,
    coverCachePath: getCoverCachePath(), ensurePlaylistFolder,
    eventType: payload?.eventType, filename: payload?.filename
  });
});
ipcMain.handle('library:scanChanges', async (_e, changes) => {
  const list = Array.isArray(changes) ? changes : [];
  const results = [];
  for (const change of list) {
    results.push(await scanLibraryChangeWithIndex({
      settings: safeReadSettings(), store: safeReadStore(), audioExt: AUDIO_EXT, enrichTracks,
      coverCachePath: getCoverCachePath(), ensurePlaylistFolder,
      eventType: change?.eventType, filename: change?.filename
    }));
  }
  return results;
});
ipcMain.handle('library:openFolder', async () => { const folder = safeReadSettings().musicFolder; if (folder && fs.existsSync(folder)) await shell.openPath(folder); return folder || ''; });
ipcMain.handle('library:watchStatus', () => ({ enabled: safeReadSettings().autoWatch !== false, active: !!folderWatch, folder: safeReadSettings().musicFolder || '' }));

ipcMain.handle('dialog:files', async () => {
  const result = await dialog.showOpenDialog(mainWindow, { title: 'Добавить музыку', properties: ['openFile', 'multiSelections'], filters: [{ name: 'Аудио', extensions: [...AUDIO_EXT].map(x => x.slice(1)) }] });
  if (result.canceled) return [];
  const settings = safeReadSettings();
  result.filePaths.forEach(p => trustedImportPaths.add(normalizePath(p)));
  return enrichTracks(result.filePaths, { ...settings, onlineMetadata: false, renameFiles: false }, getCoverCachePath());
});
ipcMain.handle('dialog:filesFromPaths', async (_e, paths) => {
  const settings = safeReadSettings();
  const safePaths = Array.isArray(paths) ? paths.filter(p => typeof p === 'string' && fs.existsSync(p) && fs.statSync(p).isFile() && AUDIO_EXT.has(path.extname(p).toLowerCase())) : [];
  safePaths.forEach(p => trustedImportPaths.add(normalizePath(p)));
  return enrichTracks([...new Set(safePaths)], { ...settings, onlineMetadata: false, renameFiles: false }, getCoverCachePath());
});
ipcMain.handle('dialog:paths', async (_e, paths) => {
  const settings = safeReadSettings();
  const expanded = [];
  for (const value of (Array.isArray(paths) ? paths : [])) {
    if (typeof value !== 'string' || !value || !fs.existsSync(value)) continue;
    try {
      const stat = fs.statSync(value);
      if (stat.isFile()) {
        if (AUDIO_EXT.has(path.extname(value).toLowerCase())) expanded.push(value);
      } else if (stat.isDirectory()) {
        expanded.push(...await collectAudioFilesAsync(value, AUDIO_EXT));
      }
    } catch {}
  }
  const uniqueExpanded = [...new Set(expanded)];
  uniqueExpanded.forEach(p => trustedImportPaths.add(normalizePath(p)));
  return enrichTracks(uniqueExpanded, { ...settings, onlineMetadata: false, renameFiles: false }, getCoverCachePath());
});
ipcMain.handle('dialog:folder', async () => {
  const result = await dialog.showOpenDialog(mainWindow, { title: 'Выберите папку с музыкой', properties: ['openDirectory'] });
  if (result.canceled || !result.filePaths[0]) return [];
  const settings = safeReadSettings();
  const files = await collectAudioFilesAsync(result.filePaths[0], AUDIO_EXT);
  files.forEach(p => trustedImportPaths.add(normalizePath(p)));
  return enrichTracks(files, { ...settings, onlineMetadata: false, renameFiles: false }, getCoverCachePath());
});
// Единая проверка для путей, которые приходят из рендерера: доверенная папка
// (или импортированный файл), реальный аудиофайл. Пути от metadata:search и
// metadata:refresh раньше проверялись только на существование, хотя при
// включённом переименовании metadata.js может переименовать этот файл.
function isTrustedAudioFile(filePath) {
  if (typeof filePath !== 'string' || !filePath) return false;
  if (!AUDIO_EXT.has(path.extname(filePath).toLowerCase())) return false;
  try { if (!fs.statSync(filePath).isFile()) return false; } catch { return false; }
  return pathGuard.isTrusted(filePath) || trustedImportPaths.has(normalizePath(filePath));
}

ipcMain.handle('metadata:search', async (_e, track) => {
  const filePath = String(track?.path || track?.sourcePath || '');
  if (!isTrustedAudioFile(filePath)) return null;
  const settings = safeReadSettings();
  const result = await enqueueMetadataSearch(filePath, { onlineMetadata: true, renameFiles: settings.renameFiles === true });
  return result || null;
});
ipcMain.handle('metadata:refresh', async (_e, track) => {
  const filePath = String(track?.path || track?.sourcePath || '');
  if (!isTrustedAudioFile(filePath)) return null;
  const settings = safeReadSettings();
  const result = await enqueueMetadataSearch(filePath, { onlineMetadata: true, renameFiles: settings.renameFiles === true }, true);
  return result || null;
});
ipcMain.handle('metadata:stats', () => metadataCache.stats());
ipcMain.handle('metadata:clearCache', async () => {
  const ok = metadataCache.clear();
  // Кнопка называется «очистить кэш метаданных», поэтому обложки тоже убираем:
  // иначе папка cover-cache оставалась нетронутой и росла бесконечно.
  let coversRemoved = 0;
  try { coversRemoved = await clearCoverCache(getCoverCachePath()); } catch {}
  // Ссылки на удалённые файлы остаются в библиотеке, поэтому рендерер получает
  // префикс каталога кэша и сбрасывает такие обложки: иначе трек показывал бы
  // пустой квадрат, а повторный поиск для него не запускался.
  const coverCacheUrlPrefix = `${buildFileUrl(getCoverCachePath()).replace(/\/+$/, '')}/`;
  return { ok, coversRemoved, coverCacheUrlPrefix, ...metadataCache.stats() };
});
ipcMain.handle('dialog:image', async () => {
  const result = await dialog.showOpenDialog(mainWindow, { title: 'Выберите обложку', properties: ['openFile'], filters: [{ name: 'Изображения', extensions: ['jpg', 'jpeg', 'png', 'webp'] }] });
  if (result.canceled) return '';
  return buildFileUrl(result.filePaths[0]);
});
ipcMain.handle('shell:show', (_e, p) => {
  if (!pathGuard.isTrusted(p)) return false;
  shell.showItemInFolder(p);
  return true;
});
ipcMain.handle('shell:openFolder', async (_e, p) => {
  if (!pathGuard.isTrusted(p)) return false;
  const folder = fs.statSync(p).isDirectory() ? p : path.dirname(p);
  const error = await shell.openPath(folder);
  return !error;
});
ipcMain.handle('window:minimize', () => mainWindow?.minimize());
ipcMain.handle('window:toggleMaximize', () => { if (!mainWindow) return false; if (mainWindow.isMaximized()) mainWindow.unmaximize(); else mainWindow.maximize(); return mainWindow.isMaximized(); });
ipcMain.handle('window:close', () => mainWindow?.close());
ipcMain.handle('window:isMaximized', () => !!mainWindow?.isMaximized());
ipcMain.on('playback:state', (_e, payload) => {
  trayState = { ...trayState, ...(payload || {}) };
  rebuildTrayMenu();
});
ipcMain.on('playback:nowPlaying', (_e, payload) => {
  trayState = { ...trayState, ...(payload || {}) };
  rebuildTrayMenu();
  const settings = safeReadSettings();
  if (!settings.notifications || !payload?.title || !Notification.isSupported()) return;
  try {
    const n = new Notification({
      title: payload.title,
      body: [payload.artist, payload.album].filter(Boolean).join(' • '),
      icon: path.join(__dirname, '..', 'assets', 'icon.png'),
      silent: true
    });
    n.on('click', () => { mainWindow?.show(); mainWindow?.focus(); });
    n.show();
  } catch {}
});

app.whenReady().then(() => {
  if (!gotLock) return;
  fileLogger.info(`startup: Localify Crimson ${APP_VERSION}, Electron ${process.versions.electron}, ${process.platform} ${process.arch}`);
  app.setAppUserModelId('com.localify.player');
  createWindow();
  const initialSettings = safeReadSettings();
  if (initialSettings.autoWatch !== false && initialSettings.musicFolder) startFolderWatch(initialSettings.musicFolder);
  createTray();
  registerMediaKeys();
  sweepStaleDownloadTempDirs('при запуске');
  void pruneCoverCache(getCoverCachePath(), { keep: referencedCoverPaths(safeReadStore().library) }).then(removed => {
    if (removed) console.log(`[cover-cache] удалено старых обложек: ${removed}`);
  }).catch(() => {});
  app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
});
app.on('window-all-closed', () => { if (process.platform !== 'darwin' && !safeReadSettings().closeToTray) app.quit(); });
let shutdownFlushStarted = false;
app.on('before-quit', (event) => {
  forceQuit = true;
  stopFolderWatch(); destroyTray(); unregisterMediaKeys(); clearTimeout(metadataCacheSaveTimer);
  if (shutdownFlushStarted) return;
  shutdownFlushStarted = true;
  // Последние правки библиотеки, кэша метаданных и позиции воспроизведения
  // должны попасть на диск: дебаунсы 0.75–1.8 с иначе теряли их при выходе.
  event.preventDefault();
  const timeout = new Promise(resolve => setTimeout(resolve, 3000));
  Promise.race([
    Promise.allSettled([libraryStore.flush(), metadataCache.save(), flushPlaybackState()]),
    timeout
  ]).finally(() => { try { app.exit(0); } catch { app.quit(); } });
});
