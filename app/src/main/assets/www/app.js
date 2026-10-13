const $ = (s) => document.querySelector(s);
const $$ = (s) => [...document.querySelectorAll(s)];
const UI_ICON_PATHS = {
  search: '<circle cx="11" cy="11" r="6.5"/><path d="m16 16 4.2 4.2"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  list: '<path d="M5 6h14M5 12h14M5 18h14"/><path d="M3.5 6h.01M3.5 12h.01M3.5 18h.01"/>',
  shuffle: '<path d="M4 7h3c3.5 0 4.5 10 10 10h3"/><path d="M17 5l3 2-3 2M17 15l3 2-3 2"/><path d="M4 17h3c1.2 0 2.1-1 2.8-2.2M14.2 9.2C15 8 16 7 20 7"/>',
  folder: '<path d="M3.5 7.5h6l1.7 2H20.5v8.5a2 2 0 0 1-2 2h-13a2 2 0 0 1-2-2z"/><path d="M3.5 9.5h17"/>',
  refresh: '<path d="M19 8a7 7 0 1 0 1 5"/><path d="M19 4v4h-4"/>',
  chevron: '<path d="m8 10 4 4 4-4"/>',
  close: '<path d="m7 7 10 10M17 7 7 17"/>',
  download: '<path d="M12 4v11M8 11l4 4 4-4"/><path d="M5 19h14"/>',
  play: '<path d="m9 6 9 6-9 6V6Z"/>',
  pause: '<path d="M8 6v12M16 6v12"/>',
  more: '<circle cx="6" cy="12" r="1" fill="currentColor" stroke="none"/><circle cx="12" cy="12" r="1" fill="currentColor" stroke="none"/><circle cx="18" cy="12" r="1" fill="currentColor" stroke="none"/>',
  trash: '<path d="M5 7h14M9 7V5h6v2M8 10v8M12 10v8M16 10v8"/><path d="M6 7l1 14h10l1-14"/>',
  music: '<path d="M9 18V6l10-2v12"/><circle cx="6.5" cy="18" r="2.5"/><circle cx="16.5" cy="16" r="2.5"/>',
  undo: '<path d="M9 8 5 12l4 4"/><path d="M6 12h8a5 5 0 0 1 5 5v1"/>',
  clock: '<circle cx="12" cy="12" r="8"/><path d="M12 8v5l3 2"/>',
  external: '<path d="M14 5h5v5M13 11l6-6"/><path d="M18 13v5a1.5 1.5 0 0 1-1.5 1.5h-11A1.5 1.5 0 0 1 4 18V7a1.5 1.5 0 0 1 1.5-1.5h5"/>',
};
function uiIcon(name, cls='') {
  return `<svg class="ui-icon ${cls}" viewBox="0 0 24 24" aria-hidden="true">${UI_ICON_PATHS[name] || UI_ICON_PATHS.music}</svg>`;
}


function readHistory() { try { return JSON.parse(localStorage.getItem('localify.history') || '[]').filter(x => x && x.id); } catch { return []; } }

const state = {
  library: [],
  playlists: [],
  currentIndex: -1,
  playback: [],
  playbackBase: [],
  playbackIndex: -1,
  playbackSource: 'library',
  sortKey: 'addedAt',
  sortDir: 'desc',
  libraryMode: 'tracks',
  currentAlbum: null,
  sidebarCollapsed: localStorage.getItem('localify.sidebarCollapsed') === '1',
  shuffle: false,
  repeat: false,
  search: '', genre: '',
  searchMode: localStorage.getItem('localify.searchMode') === 'online' ? 'online' : 'local',
  genreCollapsed: localStorage.getItem('localify.genreCollapsed') === '1',
  radioStations: [],
  radioLoading: false,
  radioCurrentStation: null,
  radioQuery: '',
  radioMode: localStorage.getItem('localify.radioMode') || 'all',
  radioOnlineResults: [],
  radioLocalResults: [],
  radioRecentLocalIds: [],
  radioOnlineLoading: false,
  radioAutoLoading: false,
  radioAutoReady: false,
  radioAutoStep: 0,
  radioAutoTotal: 0,
  radioAutoStage: '',
  radioScope: localStorage.getItem('localify.radioScope') || 'all',
  onlineSearchResults: [],
  onlineSearchLoading: false,
  currentView: 'home',
  currentPlaylist: null,
  coverDraft: '',
  settings: { closeToTray: true, startMinimized: false, trayEnabled: true, minimizeToTray: true, mediaKeys: true, notifications: true, onlineMetadata: true, renameFiles: false, moveFilesIntoPlaylists: true, musicFolder: '', ytDlpPath: 'yt-dlp', cookiesFile: '', proxy: '', downloadMode: 'mp3', gapless: true, uiDensity: 'normal', coverSize: 'medium', reduceMotion: false, compactPlayer: false, autoWatch: true },
  pendingConfirm: null,
  syncingLibrary: false,
  coverHydrationRunning: false,
  scanProgress: null,
  history: readHistory(),
  searchSuggestionsOpen: false,
  currentRemoteTrack: null,
  shuffleMode: 'off',
  providerConfig: { ytDlpPath:'yt-dlp', cookiesFile:'' },
  onlineSearchPromise: null,
  onlineSearchToken: 0,
  savedPlayback: null,
  restoringPlayback: false,
  downloadProgress: new Map(),
  selectedTrackIds: new Set(),
  queueRevision: 0,
  queueRenderedKey: '',
  userVolume: 0.8,
  queueHydrated: false,
  onlineCache: new Map(),
  streamCache: new Map(),
  lastPlayingDomId: '',
  playStats: new Map(),
  trackById: new Map(),
  indexById: new Map(),
  playlistById: new Map(),
  trackByPath: new Map(),
  onlineLibraryKeys: new Set(),
  libraryRevision: 0,
  derivedListCache: new Map(),
  searchCache: new Map(),
  recentCache: [],
  recentCacheRevision: -1,
  selectedCleanupRevision: -1,
  queueVirtualModel: null,
  duplicateHashes: new Map(),
};

const remoteStreamJobs = new Map();

const audio = $('#audio'); audio.volume = 0.8;
let gaplessTimer = null;
let playbackSaveTimer = null;
let lastPlaybackPersistAt = 0;
const sortCollator = new Intl.Collator('ru-RU', { sensitivity: 'base', numeric: true });
let progressFrame = 0;
let pendingProgressUpdate = false;

// Background audio visualizer. It lives on a canvas behind the UI and follows the
// same audio element that powers the player, so it does not affect playback controls.
const visualizer = {
  canvas: null,
  ctx: null,
  analyser: null,
  source: null,
  audioContext: null,
  freq: null,
  time: null,
  raf: 0,
  width: 0,
  height: 0,
  dpr: 1,
  resizeObserver: null,
  resize: null,
  running: false,
  reducedMotion: false,
};

function setupAudioVisualizer() {
  if (visualizer.canvas) return;
  const canvas = document.getElementById('audioVisualizer');
  if (!canvas) return;
  const ctx = canvas.getContext('2d', { alpha: true });
  if (!ctx) return;
  visualizer.canvas = canvas;
  visualizer.ctx = ctx;
  visualizer.reducedMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches || !!state.settings.reduceMotion;

  const resize = () => {
    const rect = canvas.getBoundingClientRect();
    visualizer.dpr = Math.min(window.devicePixelRatio || 1, 1.5);
    visualizer.width = Math.max(1, Math.floor(rect.width));
    visualizer.height = Math.max(1, Math.floor(rect.height));
    canvas.width = Math.floor(visualizer.width * visualizer.dpr);
    canvas.height = Math.floor(visualizer.height * visualizer.dpr);
    ctx.setTransform(visualizer.dpr, 0, 0, visualizer.dpr, 0, 0);
  };
  visualizer.resize = resize;
  visualizer.resizeObserver = new ResizeObserver(() => { if (visualizer.running) resize(); });
  window.addEventListener('resize', () => { if (visualizer.running) resize(); }, { passive: true });
}


function ensureAudioAnalyser() {
  // Android WebView can silence media routed through a suspended or origin-tainted
  // AudioContext. Keep Android audio on the direct HTMLMediaElement output path.
  if (document.documentElement.classList.contains('android-app')) return null;
  if (!visualizer.canvas) setupAudioVisualizer();
  if (visualizer.analyser) return visualizer.analyser;
  try {
    const AudioContextCtor = window.AudioContext || window.webkitAudioContext;
    if (!AudioContextCtor) return null;
    visualizer.audioContext = new AudioContextCtor();
    visualizer.source = visualizer.audioContext.createMediaElementSource(audio);
    visualizer.analyser = visualizer.audioContext.createAnalyser();
    visualizer.analyser.fftSize = 512;
    visualizer.analyser.minDecibels = -88;
    visualizer.analyser.maxDecibels = -18;
    visualizer.analyser.smoothingTimeConstant = 0.84;
    visualizer.source.connect(visualizer.analyser);
    visualizer.analyser.connect(visualizer.audioContext.destination);
    visualizer.freq = new Uint8Array(visualizer.analyser.frequencyBinCount);
    visualizer.time = new Uint8Array(visualizer.analyser.fftSize);
    return visualizer.analyser;
  } catch (err) {
    console.warn('Audio visualizer unavailable:', err);
    visualizer.analyser = null;
    return null;
  }
}

function drawAudioVisualizer() {
  const { ctx, width, height } = visualizer;
  if (!ctx || !width || !height) return;
  const playing = !audio.paused && !!audio.src;
  if (!playing) return;
  ctx.clearRect(0, 0, width, height);

  const analyser = visualizer.analyser;
  if (analyser && playing && visualizer.freq && visualizer.time) {
    analyser.getByteFrequencyData(visualizer.freq);
    analyser.getByteTimeDomainData(visualizer.time);
  }

  const mid = height * 0.52;
  const samples = visualizer.time?.length || 512;
  const amplitude = Math.min(height * 0.24, Math.max(8, height * 0.18));

  // Main waveform. It stays behind all DOM content; only a thin green trace is
  // intentionally visible through the translucent interface.
  ctx.save();
  ctx.beginPath();
  for (let i = 0; i < samples; i++) {
    const x = (i / (samples - 1)) * width;
    let value = 0;
    if (visualizer.time) value = (visualizer.time[i] - 128) / 128;
    const y = mid + value * amplitude;
    if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
  }
  ctx.strokeStyle = 'rgba(224,61,79, 0.42)';
  ctx.lineWidth = 1.7;
  ctx.shadowColor = 'rgba(219,53,74, 0.24)';
  ctx.shadowBlur = 7;
  ctx.stroke();
  ctx.restore();

  // A softer frequency silhouette gives the line more life without turning the
  // library into a visualizer panel.
  if (playing && visualizer.freq) {
    ctx.save();
    ctx.beginPath();
    const bars = Math.min(180, visualizer.freq.length);
    for (let i = 0; i < bars; i++) {
      const x = (i / (bars - 1)) * width;
      const f = visualizer.freq[Math.floor(i * visualizer.freq.length / bars)] / 255;
      const y = mid - f * height * 0.16;
      if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
    }
    ctx.strokeStyle = 'rgba(198,61,77, 0.08)';
    ctx.lineWidth = 1;
    ctx.stroke();
    ctx.restore();
  }
}

function startVisualizerLoop() {
  if (visualizer.running) return;
  visualizer.canvas?.classList.add('is-active');
  visualizer.resize?.();
  if (visualizer.resizeObserver && visualizer.canvas) visualizer.resizeObserver.observe(visualizer.canvas);
  visualizer.running = true;
  const frame = () => {
    if (!visualizer.running) return;
    drawAudioVisualizer();
    visualizer.raf = requestAnimationFrame(frame);
  };
  frame();
}
function stopVisualizerLoop() {
  visualizer.running = false;
  if (visualizer.resizeObserver) { try { visualizer.resizeObserver.disconnect(); } catch {} }
  if (visualizer.raf) cancelAnimationFrame(visualizer.raf);
  visualizer.raf = 0;
  visualizer.canvas?.classList.remove('is-active');
}
function persistPlaybackSession(force = false) {
  const now = Date.now();
  if (!force && now - lastPlaybackPersistAt < 5000) return;
  lastPlaybackPersistAt = now;
  const t = currentTrack();
  const prev = state.savedPlayback || {};
  window.localify.playback.saveSession({
    trackId: t?.id || prev.trackId || '', sourcePath: t?.sourcePath || t?.path || prev.sourcePath || '',
    position: t ? (Number.isFinite(audio.currentTime) ? audio.currentTime : 0) : (Number(prev.position) || 0),
    volume: Number.isFinite(audio.volume) ? audio.volume : (Number(prev.volume) || 0.8),
    queueIds: state.playback.map(x => x?.id).filter(Boolean), queueBaseIds: state.playbackBase.map(x => x?.id).filter(Boolean),
    queueIndex: state.playbackIndex, playbackSource: state.playbackSource || 'library', shuffleMode: state.shuffleMode || (state.shuffle ? 'normal' : 'off'), repeat: !!state.repeat, immediate: force
  });
}
function schedulePlaybackPersist() {
  clearTimeout(playbackSaveTimer);
  playbackSaveTimer = setTimeout(() => persistPlaybackSession(), 400);
}
window.addEventListener('pagehide', () => { try { persistPlaybackSession(true); void window.localify.playback.flushSession?.(); } catch {} });
window.addEventListener('beforeunload', () => { try { persistPlaybackSession(true); void window.localify.playback.flushSession?.(); } catch {} });
function queuePlaybackProgress() {
  if (pendingProgressUpdate) return;
  pendingProgressUpdate = true;
  progressFrame = requestAnimationFrame(() => {
    pendingProgressUpdate = false;
    updatePlaybackProgress();
  });
}


const { uid, esc, fmtTime, fmtDate, pluralRu, fmtCount, coverHtml, mergeTrackData, normalizeSearchText, rebuildTrackSearchIndex, invalidateTrackSearchIndex } = window.LocalifyAppUtils || {};
function setDerivedValue(target, key, value) {
  Object.defineProperty(target, key, { value, writable: true, configurable: true, enumerable: false });
}
function syncTrackIndexPaths(track) {
  if (!track?.id) return;
  const previous = Array.isArray(track._indexedPathKeys) ? track._indexedPathKeys : [];
  for (const key of previous) if (state.trackByPath.get(key) === track) state.trackByPath.delete(key);
  const next = [];
  for (const p of [track.sourcePath, track.path]) {
    const key = normalizeFsPath(p || '');
    if (key && !next.includes(key)) { state.trackByPath.set(key, track); next.push(key); }
  }
  setDerivedValue(track, '_indexedPathKeys', next);
}
function syncTrackOnlineKey(track) {
  if (!track?.id) return;
  const previous = track._onlineLibraryKey || '';
  if (previous) state.onlineLibraryKeys.delete(previous);
  const next = canonicalOnlineTrackKey(track);
  if (next) state.onlineLibraryKeys.add(next);
  setDerivedValue(track, '_onlineLibraryKey', next);
}
function rebuildPlaylistIndex() {
  state.playlistById.clear();
  for (const playlist of state.playlists) if (playlist?.id) state.playlistById.set(playlist.id, playlist);
}
function clearDerivedCaches() {
  state.derivedListCache.clear();
  state.searchCache.clear();
  state.recentCacheRevision = -1;
  state.selectedCleanupRevision = -1;
}
function rebuildLibraryIndexes() {
  state.trackById.clear();
  state.indexById.clear();
  state.trackByPath.clear();
  state.onlineLibraryKeys.clear();
  rebuildPlaylistIndex();
  state.library.forEach((track, index) => {
    if (!track?.id) return;
    state.trackById.set(track.id, track);
    state.indexById.set(track.id, index);
    syncTrackIndexPaths(track);
    rebuildTrackSearchIndex(track);
    syncTrackOnlineKey(track);
  });
  state.libraryRevision++;
  clearDerivedCaches();
}
function indexTrack(track, index = state.library.indexOf(track)) {
  if (!track?.id) return;
  state.trackById.set(track.id, track);
  if (index >= 0) state.indexById.set(track.id, index);
  syncTrackIndexPaths(track);
  rebuildTrackSearchIndex(track);
  syncTrackOnlineKey(track);
}
function removeTrackFromIndexes(track) {
  if (!track?.id) return;
  state.trackById.delete(track.id);
  const index = state.indexById.get(track.id);
  state.indexById.delete(track.id);
  const pathKeys = Array.isArray(track._indexedPathKeys) ? track._indexedPathKeys : [];
  for (const key of pathKeys) if (state.trackByPath.get(key) === track) state.trackByPath.delete(key);
  const onlineKey = track._onlineLibraryKey || '';
  if (onlineKey) state.onlineLibraryKeys.delete(onlineKey);
  return typeof index === 'number' ? index : -1;
}
function reindexLibraryPositionsFrom(startIndex = 0) {
  const start = Math.max(0, Number(startIndex) || 0);
  for (let i = start; i < state.library.length; i++) {
    const track = state.library[i];
    if (track?.id) state.indexById.set(track.id, i);
  }
}
function touchLibrary({ reindex = false, track = null, structure = false } = {}) {
  if (reindex) rebuildLibraryIndexes();
  else {
    if (track) { indexTrack(track, findLibraryIndexById(track.id)); }
    state.libraryRevision++;
    clearDerivedCaches();
    if (!structure) state.recentCacheRevision = state.libraryRevision;
  }
  if (structure) rebuildPlaylistIndex();
}
function findTrackById(id) { return id ? state.trackById.get(id) || null : null; }
function findLibraryIndexById(id) { return id ? (state.indexById.get(id) ?? -1) : -1; }
function findPlaylistById(id) { return id ? state.playlistById.get(id) || null : null; }
function findTrackByPath(p) { return state.trackByPath.get(normalizeFsPath(p || '')) || null; }
function canonicalOnlineTrackKey(track={}) {
  let title = normalizeSearchText(track.title || '')
    .replace(/\[(?:official\s+)?(?:music\s+)?video\]/g, ' ')
    .replace(/\[(?:official\s+)?audio\]/g, ' ')
    .replace(/\((?:official\s+)?(?:music\s+)?video\)/g, ' ')
    .replace(/\((?:official\s+)?audio\)/g, ' ')
    .replace(/\b(?:official\s+music\s+video|official\s+video|official\s+audio|lyric\s+video|lyrics?|visualizer|audio|video|hd|hq|4k|1080p|720p)\b/g, ' ')
    .replace(/[-|•]+/g, ' ').replace(/\s+/g, ' ').trim();
  const artist = normalizeSearchText(track.artist || '')
    .replace(/\s*[-|•]\s*(?:official\s*)?topic$/g, '')
    .replace(/\s*(?:vevo|official)$/g, '')
    .replace(/\s+/g, ' ').trim();
  if(!title) return '';
  return artist && artist !== 'youtube' ? `${artist}::${title}` : title;
}
function getOnlineCache(key) {
  const value = state.onlineCache.get(key);
  if (!value) return null;
  state.onlineCache.delete(key); state.onlineCache.set(key, value);
  return value;
}
function setOnlineCache(key, value) {
  state.onlineCache.delete(key); state.onlineCache.set(key, value);
  while (state.onlineCache.size > 50) state.onlineCache.delete(state.onlineCache.keys().next().value);
}
function filterOnlineResults(results) {
  const localKeys = state.onlineLibraryKeys;
  const seen = new Set();
  return (results || []).filter(track => {
    const key = canonicalOnlineTrackKey(track) || `${track?.provider || 'remote'}:${track?.providerId || track?.sourceUrl || ''}`;
    if(localKeys.has(key) || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}
function filterLibrary(query) {
  const normalized = normalizeSearchText(query);
  if (!normalized) return state.library;
  const cacheKey = `${state.libraryRevision}|${normalized}`;
  const cached = state.searchCache.get(cacheKey);
  if (cached) {
    state.searchCache.delete(cacheKey); state.searchCache.set(cacheKey, cached);
    return cached;
  }
  const tokens = normalized.split(/\s+/).filter(Boolean);
  const result = state.library.filter(track => {
    if (!track._searchIndex) rebuildTrackSearchIndex(track);
    return tokens.every(token => track._searchIndex.includes(token));
  });
  state.searchCache.set(cacheKey, result);
  if (state.searchCache.size > 8) state.searchCache.delete(state.searchCache.keys().next().value);
  return result;
}
function scoreSearchTrack(track, tokens, normalized) {
  if (!track._searchIndex) rebuildTrackSearchIndex(track);
  if (!tokens.every(token => track._searchIndex.includes(token))) return null;
  const title = track._searchTitle, artist = track._searchArtist, album = track._searchAlbum;
  let score = 0;
  for (const token of tokens) {
    if (title.startsWith(token)) score += 10; else if (title.includes(token)) score += 6;
    if (artist.startsWith(token)) score += 7; else if (artist.includes(token)) score += 4;
    if (album.startsWith(token)) score += 5; else if (album.includes(token)) score += 2;
  }
  if (title === normalized) score += 25;
  return score;
}
function searchLibrary(query, limit = Infinity) {
  const normalized = normalizeSearchText(query);
  if (!normalized) return state.library;
  const tokens = normalized.split(/\s+/).filter(Boolean);
  if (limit !== Infinity) {
    const best = [];
    for (const track of state.library) {
      const score = scoreSearchTrack(track, tokens, normalized);
      if (score == null) continue;
      const item = { track, score };
      let pos = best.length;
      while (pos > 0) {
        const prev = best[pos - 1];
        if (prev.score > score) break;
        if (prev.score === score && sortCollator.compare(prev.track.title || '', track.title || '') <= 0) break;
        pos--;
      }
      best.splice(pos, 0, item);
      if (best.length > limit) best.pop();
    }
    return best.map(x => x.track);
  }
  return filterLibrary(query);
}
function sortTracks(list) {
  const dir = state.sortDir === 'asc' ? 1 : -1;
  return [...list].sort((a,b)=>{
    let av, bv;
    if(state.sortKey==='title'){ if(!a._sortTitle) rebuildTrackSearchIndex(a); if(!b._sortTitle) rebuildTrackSearchIndex(b); av=a._sortTitle; bv=b._sortTitle; }
    else if(state.sortKey==='album'){ if(!a._sortAlbum) rebuildTrackSearchIndex(a); if(!b._sortAlbum) rebuildTrackSearchIndex(b); av=a._sortAlbum; bv=b._sortAlbum; }
    else if(state.sortKey==='duration'){ av=Number(a.duration)||0; bv=Number(b.duration)||0; }
    else { av=Number(a.addedAt)||0; bv=Number(b.addedAt)||0; }
    if(av<bv) return -1*dir; if(av>bv) return 1*dir; return sortCollator.compare(a.id||'', b.id||'')*dir;
  });
}
function normalizeGenreValue(value) {
  const raw = String(value || '').trim().toLowerCase().replace(/[–—]/g, '-').replace(/\s+/g, ' ');
  if (!raw) return '';
  // These values are generic container labels rather than useful genres.
  // Some ID3 tags and online catalogs use "Music" when no real genre is known.
  if (/^(music|musical|unknown|unknown genre|genre|other|misc|miscellaneous|general)$/.test(raw)) return '';
  if (/^(hip[- ]?hop|hip[- ]?hop\/rap|rap)$/.test(raw)) return 'hip-hop';
  if (/^(электронная музыка|electro\s*\/\s*dance|electronic\s*\/\s*dance|electro dance|electronic dance|electro[- ]?dance|edm|electro|electronic|electronica|электро|dance|танцевальная музыка)$/.test(raw)) return 'electronic';
  if (/^(alternative|alt rock)$/.test(raw)) return 'alternative';
  if (/^(rock|hard rock|indie rock)$/.test(raw)) return 'rock';
  if (/^(pop|pop music)$/.test(raw)) return 'pop';
  if (/^(metal|heavy metal)$/.test(raw)) return 'metal';
  if (raw === 'jazz') return 'jazz';
  if (/^(classical|classical music)$/.test(raw)) return 'classical';
  return raw;
}
function getTrackGenre(track) { return normalizeGenreValue(track?.genre || track?.tags?.genre || ''); }
function getSortedVisibleTracks({ query = state.search } = {}) {
  const normalized = normalizeSearchText(query);
  const genre = normalizeGenreValue(state.genre);
  const key = `${state.libraryRevision}|${state.sortKey}|${state.sortDir}|${normalized}|${genre}`;
  const cached = state.derivedListCache.get(key);
  if (cached) {
    state.derivedListCache.delete(key); state.derivedListCache.set(key, cached);
    return cached;
  }
  let list = filterLibrary(query);
  if (genre) list = list.filter(t => getTrackGenre(t) === genre);
  const sorted = sortTracks(list);
  state.derivedListCache.set(key, sorted);
  if (state.derivedListCache.size > 6) state.derivedListCache.delete(state.derivedListCache.keys().next().value);
  return sorted;
}
function visibleTracks() { return filterLibrary(state.search); }
let librarySaveTimer = null;
let librarySaveVersion = 0;
let librarySaveInFlight = false;
const librarySaveWaiters = new Map();
let librarySaveFailureAt = 0;
function notifyLibrarySaveFailure(detail = ''){
  const now = Date.now();
  if (now - librarySaveFailureAt < 15000) return;
  librarySaveFailureAt = now;
  toast(`Не удалось сохранить библиотеку${detail ? `: ${detail}` : ''}. Проверьте права на папку данных и свободное место на диске.`);
}
async function flushSave() {
  clearTimeout(librarySaveTimer); librarySaveTimer = null;
  if (librarySaveInFlight) return;
  librarySaveInFlight = true;
  const version = librarySaveVersion;
  const payload = { library: state.library, playlists: state.playlists };
  let ok = false;
  try {
    ok = await window.localify.saveState(payload);
    if (ok === false) notifyLibrarySaveFailure('');
  } catch (err) {
    console.error(err);
    notifyLibrarySaveFailure(String(err?.message || ''));
  } finally {
    librarySaveInFlight = false;
    const waiters = librarySaveWaiters.get(version) || [];
    librarySaveWaiters.delete(version);
    waiters.forEach(resolve => resolve(ok));
    if (librarySaveVersion > version) {
      clearTimeout(librarySaveTimer);
      librarySaveTimer = setTimeout(() => void flushSave(), 0);
    }
  }
}
function save(immediate = false) {
  const version = ++librarySaveVersion;
  const promise = new Promise(resolve => {
    const list = librarySaveWaiters.get(version) || [];
    list.push(resolve); librarySaveWaiters.set(version, list);
  });
  clearTimeout(librarySaveTimer);
  librarySaveTimer = setTimeout(() => void flushSave(), immediate ? 0 : 750);
  return promise;
}
function saveNow() { librarySaveVersion++; return flushSave(); }
function toast(msg, type = '') {
  const el = $('#toast'), message = $('#toastMessage');
  if (!el) return;
  const text = String(msg || '');
  const inferred = type || (/не удалось|ошиб|не найден|некоррект|невозможно|failed|error/i.test(text) ? 'error' : (/сохран|добав|создан|обнов|удалён|удалена|перемещ|скопирован|скачан|готов/i.test(text) ? 'success' : 'info'));
  if (message) message.textContent = text; else el.textContent = text;
  el.classList.remove('toast-error','toast-success','toast-info','show');
  el.classList.add(`toast-${inferred}`,'show');
  el.setAttribute('aria-live', inferred === 'error' ? 'assertive' : 'polite');
  clearTimeout(window.__toast);
  window.__toast = setTimeout(() => el.classList.remove('show'), 4200);
}
function toastSuccess(msg){ toast(msg,'success'); }
function toastError(msg){ toast(msg,'error'); }



function loadPlayStatsFromLibrary() {
  let stored = {};
  try { stored = JSON.parse(localStorage.getItem('localify.playStats') || '{}') || {}; } catch {}
  for (const track of state.library) {
    const id = String(track?.id || '');
    if (!id) continue;
    const legacy = {
      playCount: Number(track.playCount || 0),
      lastPlayedAt: Number(track.lastPlayedAt || 0),
      skipCount: Number(track.skipCount || 0),
    };
    const current = stored[id] || {};
    const merged = {
      playCount: Math.max(legacy.playCount, Number(current.playCount || 0)),
      lastPlayedAt: Math.max(legacy.lastPlayedAt, Number(current.lastPlayedAt || 0)),
      skipCount: Math.max(legacy.skipCount, Number(current.skipCount || 0)),
    };
    if (merged.playCount || merged.lastPlayedAt || merged.skipCount) state.playStats.set(id, merged);
    delete track.playCount; delete track.lastPlayedAt; delete track.skipCount;
  }
  persistPlayStats(true);
}
function persistPlayStats(immediate = false) {
  clearTimeout(window.__playStatsSaveTimer);
  const write = () => {
    try { localStorage.setItem('localify.playStats', JSON.stringify(Object.fromEntries(state.playStats))); } catch {}
  };
  if (immediate) write(); else window.__playStatsSaveTimer = setTimeout(write, 1200);
}
function getPlayStats(track) { return track?.id ? (state.playStats.get(track.id) || { playCount: 0, lastPlayedAt: 0, skipCount: 0 }) : { playCount: 0, lastPlayedAt: 0, skipCount: 0 }; }
function markTrackPlayed(track) {
  if (!track?.id || track.provider) return;
  const current = getPlayStats(track);
  const stats = { ...current, playCount: current.playCount + 1, lastPlayedAt: Date.now() };
  state.playStats.set(track.id, stats);
  persistPlayStats();
}
function markTrackSkipped(track) {
  if (!track?.id || track.provider) return;
  const stats = { ...getPlayStats(track), skipCount: getPlayStats(track).skipCount + 1 };
  state.playStats.set(track.id, stats);
  persistPlayStats();
}

function currentTrack() { return state.currentRemoteTrack || (state.currentIndex >= 0 ? state.library[state.currentIndex] || null : null); }
async function init() {
  const saved = await window.localify.loadState();
  try { state.savedPlayback = await window.localify.playback.loadSession(); } catch { state.savedPlayback = null; }
  state.library = (saved.library || []).map(normalizeTrack);
  loadPlayStatsFromLibrary();
  rebuildLibraryIndexes();
  restoreQueueSnapshot();
  restorePersistentPlaybackQueue();
  state.playlists = (saved.playlists || []).map(p => ({ ...(p || {}) }));
  state.settings = await window.localify.settings.get();
  try { state.providerConfig = await window.localify.providers.getConfig(); } catch {}
  applySettings();
  applyBranding();
  applySidebar();
  updateSearchModeUI();
  if(state.queueHydrated && (state.playback.length||0)>0 && ['normal','off'].includes(state.queueHydrated.mode||'')){ state.shuffleMode=state.queueHydrated.mode; state.shuffle=state.shuffleMode==='normal'; }
  renderAll();
  updateShuffleUI();
  $('#repeatBtn').style.color = state.repeat ? 'var(--accent)' : '';
  updateQueueButton();
  save();
  restorePlaybackSession();
  setTimeout(() => { void syncConfiguredLibrary(false, { fastStart: true }); }, 50);
  if(state.settings.onlineMetadata) setTimeout(() => scheduleMetadataHydration(true), 1200);
  setTimeout(() => refreshProviderDiagnostics(false), 700);
}

function bind() {
function trapDialogFocus(dialog, event) {
  if (!dialog?.open || event.key !== 'Tab') return;
  const focusable = [...dialog.querySelectorAll('button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])')].filter(el => el.offsetParent !== null);
  if (!focusable.length) return;
  const first = focusable[0], last = focusable[focusable.length - 1];
  if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
  else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
}
function setupDialogAccessibility() {
  const proto = window.HTMLDialogElement?.prototype;
  if (proto && !proto.__localifyFocusPatched) {
    const nativeShowModal = proto.showModal;
    proto.showModal = function (...args) {
      this.__localifyRestoreFocus = document.activeElement;
      return nativeShowModal.apply(this, args);
    };
    Object.defineProperty(proto, '__localifyFocusPatched', { value: true });
  }
  $$('dialog').forEach(dialog => {
    dialog.addEventListener('close', () => {
      const restore = dialog.__localifyRestoreFocus;
      dialog.__localifyRestoreFocus = null;
      if (restore && document.contains(restore) && typeof restore.focus === 'function') setTimeout(() => restore.focus(), 0);
    });
    dialog.addEventListener('keydown', e => trapDialogFocus(dialog, e));
  });
}

  $$('.nav-item').forEach(b => b.addEventListener('click', () => setView(b.dataset.view)));
  $('#genreToggle')?.addEventListener('click', () => setGenreCollapsed(!state.genreCollapsed));
  $('#radioSearchBtn')?.addEventListener('click', () => runRadioSearch($('#radioSearch')?.value || ''));
  $('#radioPlayBtn')?.addEventListener('click', startRadioMix);
  $('#radioRefreshBtn')?.addEventListener('click', async () => {
    const input=$('#radioSearch');
    if(input) input.value='';
    state.radioQuery='';
    state.radioAutoReady=false;
    state.radioOnlineResults=[];
    renderRadio();
    if(radioSourceTracks().length) await buildAutoRadioMix();
    else toast(state.radioScope==='all' ? 'Добавьте музыку в библиотеку для построения радио' : 'В выбранном плейлисте нет локальных треков');
  });
  $('#radioSearch')?.addEventListener('input', e => { state.radioQuery=e.currentTarget.value || ''; renderRadio(); });
  $('#radioSearch')?.addEventListener('keydown', e => { if(e.key==='Enter'){ e.preventDefault(); runRadioSearch(e.currentTarget.value || ''); } });
  $$('#radioSourceTabs [data-radio-mode]').forEach(btn => btn.addEventListener('click', () => {
    state.radioMode=btn.dataset.radioMode || 'all';
    localStorage.setItem('localify.radioMode', state.radioMode);
    renderRadio();
    // The Online tab is intentionally driven by the local collection.
    // No manual query is needed: the current radio scope (whole library or
    // selected playlist) becomes the taste profile for online discovery.
    if(state.radioMode==='online' && !state.radioQuery && !state.radioAutoReady && !state.radioAutoLoading && radioSourceTracks().length){
      void buildAutoRadioMix();
    }
  }));
  $('#radioScope')?.addEventListener('change', e => { state.radioScope=e.currentTarget.value || 'all'; localStorage.setItem('localify.radioScope', state.radioScope); state.radioAutoReady=false; state.radioOnlineResults=[]; state.radioLocalResults=[]; renderRadio(); });
  const searchInput = $('#search');
  $('#searchModeLocal')?.addEventListener('click', () => setSearchMode('local'));
  $('#searchModeOnline')?.addEventListener('click', () => setSearchMode('online'));
  searchInput.addEventListener('input', e => {
    state.search = e.target.value;
    clearTimeout(window.__searchRender);
    window.__searchRender = setTimeout(() => {
      if (state.searchMode === 'online') {
        renderSearchSuggestions();
      } else {
        renderSearchSuggestions();
        if (state.search.trim() && state.currentView !== 'library') setView('library');
        else { renderLibrary(); refreshPlayingStates(); }
      }
    }, 80);
  });
  searchInput.addEventListener('focus', () => { if (state.search.trim()) renderSearchSuggestions(); });
  document.addEventListener('click', e => { if (!e.target.closest('.search')) closeSearchSuggestions(); });
  document.addEventListener('error', e => {
    const img=e.target;
    if(!(img instanceof HTMLImageElement)) return;
    const brokenSrc = img.currentSrc || img.src || '';
    const markBrokenCover = () => {
      let changed = false;
      for (const track of state.library) {
        if (!track) continue;
        let trackChanged = false;
        if (track.cover && track.cover === brokenSrc) { track.cover = ''; changed = true; trackChanged = true; }
        if (track.remoteCover && track.remoteCover === brokenSrc) { track.remoteCover = ''; changed = true; trackChanged = true; }
        if (trackChanged && !track.cover && !track.remoteCover) {
          delete track.metadataCheckedAt;
          delete track.metadataStatKey;
        }
      }
      if (changed) {
        save();
        if (state.settings.onlineMetadata) setTimeout(() => scheduleMetadataHydration(true), 60);
      }
    };
    const fallback=img.dataset.coverFallback;
    if(fallback){
      markBrokenCover();
      delete img.dataset.coverFallback;
      img.src=fallback;
      return;
    }
    markBrokenCover();
    // Запасного адреса нет или он тоже не открылся: вместо пустого квадрата
    // показываем ту же заглушку, что и у трека без обложки. Так «пропавшая»
    // обложка (удалённый файл кэша, обрезанная загрузка) видна сразу.
    if(img.dataset.coverFailed) return;
    if(!img.closest('.row-cover,.card-cover,.queue-cover,.search-result-cover,.album-cover,.album-detail-cover,.duplicate-cover,.online-cover,.radio-logo,.mini-cover,.home-resume-cover,.popover-cover,.side-playlist-cover,.playlist-detail-cover')) return;
    img.dataset.coverFailed='1';
    img.classList.add('cover-broken');
    const holder=img.parentElement;
    if(holder && !holder.querySelector('.ui-icon')) holder.insertAdjacentHTML('afterbegin', uiIcon('music'));
  }, true);
  searchInput.addEventListener('keydown', e => {
    if (e.key === 'Enter' && state.search.trim()) {
      e.preventDefault();
      closeSearchSuggestions();
      searchInput.blur();
      if (state.searchMode === 'online') void runOnlineSearch(state.search, true);
      else setView('library');
    }
    if (e.key === 'Escape') {
      e.preventDefault();
      searchInput.value = '';
      state.search = '';
      closeSearchSuggestions();
      if (state.searchMode === 'online') renderOnlineSearch();
      else renderLibrary();
    }
  });
  document.addEventListener('keydown', e => handleGlobalHotkeys(e, searchInput));
  window.localify.playback.onMediaKey?.(action => {
    if (action === 'play-pause') togglePlay();
    else if (action === 'next') next();
    else if (action === 'previous') previous();
  });
  window.localify.providers.onDownloadProgress?.(data => updateDownloadProgress(data));
  $('#queueBtn').addEventListener('click', openQueueDialog);
  $('#topAddBtn')?.addEventListener('click', addFiles);
  $('#topQueueBtn')?.addEventListener('click', openQueueDialog);
  $('#topFolderBtn')?.addEventListener('click', async () => { const p = await window.localify.openLibraryFolder(); if(!p) toast('Папка библиотеки не выбрана'); });
  $('#toastClose')?.addEventListener('click', () => { const el=$('#toast'); clearTimeout(window.__toast); el?.classList.remove('show'); });
  $('#queueClose').addEventListener('click', () => $('#queueDialog').close());
  $('#historyBtn').addEventListener('click', openHistoryDialog);
  $('#historyClose').addEventListener('click', () => $('#historyDialog').close());
  $('#historyClear').addEventListener('click', clearHistory);
  $('#searchSuggestions').addEventListener('mousedown', e => e.preventDefault());
    $('#heroAddBtn').addEventListener('click', addFiles);
  $('#homeHistoryBtn')?.addEventListener('click', openHistoryDialog);
  $('#homeLibraryBtn2')?.addEventListener('click', () => setView('library'));
  $('#homePlaylistsBtn')?.addEventListener('click', () => setView('playlists'));
  $('#homeScanBtn')?.addEventListener('click', () => syncConfiguredLibrary(true));
  $('#libraryPlayBtn').addEventListener('click', playLibrary);
  $$('#libraryView [data-library-mode]').forEach(btn => btn.addEventListener('click', () => { state.libraryMode = btn.dataset.libraryMode || 'tracks'; state.currentAlbum = null; renderLibrary(); }));
  $('#saveProviderConfig')?.addEventListener('click', saveProviderConfig);
  $('#checkProviderConfig')?.addEventListener('click', () => refreshProviderDiagnostics(true));
  $('#chooseYtDlp')?.addEventListener('click', chooseYtDlp);
  $('#chooseCookiesFile')?.addEventListener('click', chooseCookiesFile);
  $('#openLogsDir')?.addEventListener('click', openLogsDir);
  $('#copyDiagnostics')?.addEventListener('click', copyDiagnostics);
  $('#clearLogs')?.addEventListener('click', clearLogs);
  $('#updateYtDlp')?.addEventListener('click', updateYtDlpFromUI);
  $('#clearMetadataCache')?.addEventListener('click', clearMetadataCache);
  $('#searchClear')?.addEventListener('click', () => { $('#search').value=''; state.search=''; closeSearchSuggestions(); renderAll(); $('#search').focus(); });
  $('#onlineSearchRetry')?.addEventListener('click', () => { if (state.search.trim()) void runOnlineSearch(state.search, true); });
  $('#sidebarToggle').addEventListener('click', toggleSidebar);
  $('#mobileNavToggle')?.addEventListener('click', () => setMobileSidebarOpen(!document.body.classList.contains('mobile-sidebar-open')));
  $('#mobileSearchToggle')?.addEventListener('click', () => setMobileSearchOpen(true));
  $('#mobileSearchClose')?.addEventListener('click', () => setMobileSearchOpen(false));
  $('.sidebar .nav-item').forEach(btn => btn.addEventListener('click', closeMobileSidebar));
  document.addEventListener('click', e => {
    if (document.body.classList.contains('mobile-sidebar-open') && !e.target.closest('.sidebar') && !e.target.closest('#mobileNavToggle')) closeMobileSidebar();
  }, true);
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape' && document.body.classList.contains('mobile-sidebar-open')) closeMobileSidebar();
    if (e.key === 'Escape' && document.body.classList.contains('mobile-search-open')) setMobileSearchOpen(false);
  });
  $('#chooseMusicFolder').addEventListener('click', chooseAndSetMusicFolder);
  $('#rescanMusicFolder').addEventListener('click', () => syncConfiguredLibrary(true));
  $('#openMusicFolder').addEventListener('click', async () => { const p = await window.localify.openLibraryFolder(); if(!p) toast('Папка библиотеки не выбрана'); });
  window.localify.onLibraryFolderChanged(payload => syncConfiguredLibrary(false, payload));
  window.localify.onLibraryScanProgress?.(payload => updateLibraryScanProgress(payload || {}));
  window.localify.onSaveFailed?.(payload => notifyLibrarySaveFailure(String(payload?.message || '')));
  $('#newPlaylistBtn').addEventListener('click', openPlaylistDialog);
  $('#addPlaylistSide').addEventListener('click', openPlaylistDialog);
  $('#openDuplicates')?.addEventListener('click', openDuplicateDialog);
  $('#duplicatesRefresh')?.addEventListener('click', refreshDuplicateDialog);
  $('#duplicatesKeepBest')?.addEventListener('click', () => void resolveAllDuplicates(false));
  $('#duplicatesTrashCopies')?.addEventListener('click', () => void resolveAllDuplicates(true));
  $('#duplicatesClose')?.addEventListener('click', () => $('#duplicatesDialog')?.close());
  setupDialogAccessibility();
  setupAudioVisualizer();
  $('#playBtn').addEventListener('click', togglePlay);
  $('#prevBtn').addEventListener('click', previous);
  $('#nextBtn').addEventListener('click', next);
  $('#shuffleBtn').addEventListener('click', toggleShuffleMode);
  $('#repeatBtn').addEventListener('click', () => { state.repeat = !state.repeat; $('#repeatBtn').style.color = state.repeat ? 'var(--accent)' : ''; saveQueueSnapshot(); });
  $('#settingMinimizeToTray').addEventListener('change', saveSettingsFromUI);
  $('#settingCloseToTray').addEventListener('change', saveSettingsFromUI);
  $('#settingTrayEnabled').addEventListener('change', saveSettingsFromUI);
  $('#settingMediaKeys').addEventListener('change', saveSettingsFromUI);
  $('#settingNotifications').addEventListener('change', saveSettingsFromUI);
  $('#settingStartMinimized').addEventListener('change', saveSettingsFromUI);
  $('#settingOnlineMetadata').addEventListener('change', saveSettingsFromUI);
  $('#settingRenameFiles').addEventListener('change', saveSettingsFromUI);
  $('#settingMoveFilesIntoPlaylists')?.addEventListener('change', saveSettingsFromUI);
  ['settingGapless','settingUiDensity','settingCoverSize','settingReduceMotion','settingAutoWatch'].forEach(id => $(`#${id}`)?.addEventListener('change', saveSettingsFromUI));
  $('#bulkEditBtn')?.addEventListener('click', openBulkEditDialog);
  $('#bulkEditClose')?.addEventListener('click', () => $('#bulkEditDialog')?.close());
  $('#bulkEditSubmit')?.addEventListener('click', e => { e.preventDefault(); void saveBulkEdits(); });
  // Keyboard shortcuts are handled centrally by handleGlobalHotkeys.
  setupGlobalFileDrop();
  $('#restoreLibraryBackup')?.addEventListener('click', async () => {
    if (!confirm('Восстановить последнюю резервную копию библиотеки? Текущая библиотека будет заменена.')) return;
    try {
      const ok = await window.localify.restoreBackup();
      if (!ok) { toast('Резервная копия не найдена'); return; }
      const restored = await window.localify.loadState();
      state.library = (restored.library || []).map(normalizeTrack);
      loadPlayStatsFromLibrary();
      rebuildLibraryIndexes();
      state.playlists = restored.playlists || [];
      rebuildPlaylistIndex();
      state.selectedTrackIds.clear();
      state.currentPlaylist = null;
      renderAll();
      toast('Библиотека восстановлена');
    } catch (err) { console.error(err); toast('Не удалось восстановить библиотеку'); }
  });
  $('#resetSettings').addEventListener('click', async () => {
    const ok = await showConfirm({ title: 'Сбросить настройки?', text: 'Вернутся стандартные значения интерфейса, трея и YouTube. Музыка, плейлисты и библиотека останутся на месте.' });
    if (!ok) return;
    metadataPipeline.running = false; metadataPipeline.list = []; metadataPipeline.cursor = 0; metadataPipeline.total = 0; metadataPipeline.done = 0; const musicFolder=state.settings.musicFolder||''; state.settings = { closeToTray: true, startMinimized: false, trayEnabled: true, minimizeToTray: true, mediaKeys: true, notifications: true, onlineMetadata: true, renameFiles: false, moveFilesIntoPlaylists: true, musicFolder, ytDlpPath: state.providerConfig.ytDlpPath || 'yt-dlp', cookiesFile: state.providerConfig.cookiesFile || '', proxy: state.providerConfig.proxy || '', downloadMode: state.providerConfig.downloadMode || 'mp3', gapless: true, uiDensity: 'normal', coverSize: 'medium', reduceMotion: false, compactPlayer: false, autoWatch: true }; state.providerConfig = { ytDlpPath: state.providerConfig.ytDlpPath || 'yt-dlp', cookiesFile: state.providerConfig.cookiesFile || '', proxy: state.providerConfig.proxy || '', downloadMode: state.providerConfig.downloadMode || 'mp3' }; await window.localify.settings.save(state.settings); applySettings(); toast('Настройки сброшены');
  });
  $('#winMin').addEventListener('click', () => window.localify.window.minimize());
  $('#winMax').addEventListener('click', async () => { await window.localify.window.toggleMaximize(); updateWindowMaxButton(await window.localify.window.isMaximized()); });
  $('#winClose').addEventListener('click', () => window.localify.window.close());
  window.localify.window.onStateChanged?.(updateWindowMaxButton);
  window.localify.window.isMaximized().then(updateWindowMaxButton).catch(() => {});
  const updateVolumeUI = value => { const n = Math.round(Math.min(1, Math.max(0, Number(value) || 0)) * 100); const el = $('#volumePercent'); if (el) el.textContent = `${n}%`; const vol = $('#volume'); if (vol) { vol.style.setProperty('--value', `${n}%`); vol.setAttribute('aria-valuetext', `${n}%`); } };
    $('#volume').addEventListener('input', e => { state.userVolume = Number(e.target.value); audio.volume = state.userVolume; updateVolumeUI(state.userVolume); schedulePlaybackPersist(); });
  $('#volume').addEventListener('change', schedulePlaybackPersist);
  $('#volume').addEventListener('wheel', e => { e.preventDefault(); const delta=e.deltaY<0?0.02:-0.02; state.userVolume=Math.min(1,Math.max(0,state.userVolume+delta)); audio.volume=state.userVolume; $('#volume').value=state.userVolume; updateVolumeUI(state.userVolume); schedulePlaybackPersist(); }, {passive:false});
  $('#nowTitle')?.addEventListener('click', () => scrollToCurrentTrack());
  $('#compactModeBtn')?.addEventListener('click', () => void toggleCompactPlayer());
  $('#seekbar').style.setProperty('--value','0%'); updateVolumeUI(state.userVolume ?? 0.8);
  $('#downloadNowBtn')?.addEventListener('click', downloadCurrentRemoteTrack);
  $('#volumeMuteBtn').addEventListener('click', () => { audio.muted = !audio.muted; $('#volumeMuteBtn').classList.toggle('muted', audio.muted); });
  $('#seekbar').addEventListener('input', e => {
    if (audio.duration) audio.currentTime = Number(e.target.value) / 100 * audio.duration;
    queuePlaybackProgress();
  });
  $('#chooseCover').addEventListener('click', async () => { state.coverDraft = await window.localify.pickImage(); if (state.coverDraft) $('#coverPreview').innerHTML = coverHtml(state.coverDraft); });
  $('#createPlaylistSubmit').addEventListener('click', e => { e.preventDefault(); createPlaylist(); });
  $('#editPlaylistCoverBtn').addEventListener('click', async () => { state.coverDraft = await window.localify.pickImage(); if (state.coverDraft) $('#editPlaylistCoverPreview').innerHTML = coverHtml(state.coverDraft); });
  $('#editPlaylistSubmit').addEventListener('click', e => { e.preventDefault(); savePlaylistEdits(); });
  $('#editTrackSubmit')?.addEventListener('click', e => { e.preventDefault(); saveTrackEdits(); });
  $('#editTrackClose')?.addEventListener('click', () => $('#editTrackDialog')?.close());
  $('#deletePlaylistBtn').addEventListener('click', e => { e.preventDefault(); deletePlaylist(state.editingPlaylistId); });
  audio.addEventListener('timeupdate', queuePlaybackProgress);
  audio.addEventListener('seeking', queuePlaybackProgress);
  audio.addEventListener('seeked', queuePlaybackProgress);
  audio.addEventListener('loadedmetadata', updatePlaybackProgress);
  audio.addEventListener('play', () => {
    const analyser = ensureAudioAnalyser();
    analyser && visualizer.audioContext?.state === 'suspended' && visualizer.audioContext.resume().catch(() => {});
    startVisualizerLoop();
    syncPlayButton(true); refreshPlayingStates(); window.localify.playback.updateState({ title: currentTrack()?.title || 'Localify Crimson', artist: currentTrack()?.artist || '', playing: true }); schedulePlaybackPersist();
  });
  audio.addEventListener('pause', () => { stopVisualizerLoop(); syncPlayButton(false); refreshPlayingStates(); window.localify.playback.updateState({ playing: false }); persistPlaybackSession(true); });
  audio.addEventListener('error', () => {
    // Ссылка на поток YouTube могла устареть или отдать 403: один раз за трек
    // сбрасываем кэш и получаем свежую ссылку вместо тишины.
    const track = state.currentRemoteTrack;
    if (document.documentElement.classList.contains('android-app') && (!track || track.provider !== 'youtube')) {
      console.warn('Android audio playback error', {code: audio.error?.code, message: audio.error?.message, source: audio.currentSrc});
      toast(track?.provider && track.provider !== 'youtube'
        ? 'Не удалось загрузить онлайн-превью. Проверьте подключение к интернету.'
        : 'Не удалось открыть аудиофайл. Попробуйте MP3, M4A или WAV.');
      syncPlayButton(false);
      return;
    }
    if (!track || track._streamRetried) return;
    track._streamRetried = true;
    const key = `${track.provider}:${track.providerId||track.title+'::'+track.artist}`;
    state.streamCache.delete(key);
    track.streamUrl = '';
    track._streamResolvedAt = 0;
    void ensureRemoteStream(track, true).then(url => {
      if (!url || currentTrack() !== track) return;
      audio.src = url;
      audio.play().then(() => syncPlayButton(true)).catch(() => {});
    }).catch(() => {});
  });
  audio.addEventListener('timeupdate', queuePlaybackProgress);
  audio.addEventListener('ended', () => { stopVisualizerLoop(); persistPlaybackSession(); if (state.repeat) { audio.currentTime = 0; audio.volume=state.userVolume; audio.play().catch(()=>{}); return; } clearTimeout(gaplessTimer); const advance = () => { gaplessTimer = null; void next(); }; if (state.settings.gapless === false) gaplessTimer = setTimeout(advance, 120); else advance(); });
  window.addEventListener('beforeunload', () => persistPlaybackSession(true));
}

function renderSettings() {
  window.LocalifySettingsUI?.render(state.settings, state.providerConfig);
  updateMetadataQueueStatus();
}

function applyBranding(){
  document.title = 'Localify Crimson';
}
function applySettings() {
  document.body.dataset.density = state.settings.uiDensity || 'normal';
  document.body.dataset.coverSize = state.settings.coverSize || 'medium';
  document.body.classList.toggle('reduce-motion', state.settings.reduceMotion === true);
  // Канва-визуализатор читал флаг один раз при инициализации, до загрузки
  // настроек, поэтому «меньше анимаций» его не останавливало.
  if (visualizer) visualizer.reducedMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches || state.settings.reduceMotion === true;
  applyCompactPlayer();
  renderSettings();
}
function applyCompactPlayer(){
  const enabled = state.settings.compactPlayer === true;
  document.body.classList.toggle('compact-player', enabled);
  const btn = $('#compactModeBtn');
  if (btn) {
    btn.classList.toggle('active', enabled);
    btn.setAttribute('aria-pressed', String(enabled));
    btn.title = enabled ? 'Обычный режим' : 'Компактный режим (мини-плеер)';
  }
}
async function toggleCompactPlayer(){
  state.settings.compactPlayer = state.settings.compactPlayer !== true;
  applyCompactPlayer();
  try { await window.localify.settings.save(state.settings); } catch (err) { console.error(err); }
  toast(state.settings.compactPlayer ? 'Компактный режим включён' : 'Обычный режим');
}
// Переход к текущему треку: раньше клик по названию просто открывал библиотеку,
// а нужный трек мог остаться за пределами видимой области виртуального списка.
function scrollToCurrentTrack(){
  const track = currentTrack();
  if (!track) { toast('Ничего не воспроизводится'); return; }
  if (state.currentView !== 'library') setView('library');
  if (state.libraryMode !== 'tracks') { state.libraryMode = 'tracks'; renderLibrary(); }
  const index = getSortedVisibleTracks().findIndex(t => t.id === track.id);
  if (index < 0) { toast('Текущий трек не виден в списке библиотеки'); return; }
  const model = virtualTables.get('trackTable');
  if (model?.scroller) {
    const rowHeight = virtualRowHeight();
    model.scroller.scrollTop = Math.max(0, (index - 4) * rowHeight);
    model.renderWindow?.();
  }
  refreshPlayingStates();
}

function updateWindowMaxButton(maximized) {
  const btn = $('#winMax');
  if (!btn) return;
  const isMax = !!maximized;
  btn.dataset.maximized = isMax ? 'true' : 'false';
  btn.title = isMax ? 'Восстановить' : 'Развернуть';
  btn.setAttribute('aria-label', isMax ? 'Восстановить' : 'Развернуть');
  btn.innerHTML = isMax
    ? '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 7h9v9"/><path d="M7 9v8h8"/></svg>'
    : '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="6.5" y="6.5" width="11" height="11" rx="1.2"/></svg>';
}
async function saveSettingsFromUI() {
  const previousPlaylistMode = state.settings.moveFilesIntoPlaylists !== false;
  state.settings = { ...state.settings, ...(window.LocalifySettingsUI?.read(state.settings) || {}) };
  await window.localify.settings.save(state.settings);
  applySettings();
  applyBranding();
  if(previousPlaylistMode !== state.settings.moveFilesIntoPlaylists && state.settings.musicFolder) void syncConfiguredLibrary(true);
  toast('Настройки сохранены');
}

async function saveProviderConfig(showToast=true){
  const data={
    ytDlpPath:$('#settingYtDlpPath')?.value.trim()||'yt-dlp',
    cookiesFile:$('#settingCookiesFile')?.value.trim()||'',
    proxy:$('#settingProxy')?.value.trim()||'',
    downloadMode:$('#settingDownloadMode')?.value||'mp3'
  };
  try{
    const saved=await window.localify.providers.saveConfig(data);
    state.providerConfig=await window.localify.providers.getConfig();
    state.settings.ytDlpPath=data.ytDlpPath;
    state.settings.cookiesFile=data.cookiesFile;
    state.settings.proxy=data.proxy;
    state.settings.downloadMode=data.downloadMode;
    renderSettings();
    if(showToast) toast('API-настройки сохранены');
    return true;
  }catch(err){ console.error(err); toast('Не удалось сохранить API-настройки'); return false; }
}
async function refreshProviderDiagnostics(showToast=false){
  const el=$('#providerStatus'); const runtime=$('#providerRuntime');
  if(el) el.textContent='Проверяю yt-dlp и FFmpeg…';
  try{
    const d=await window.localify.providers.diagnostics();
    const cookieRows=Object.entries(d.cookies?.sources||{}).map(([browser,info])=>{
      const bad=info.state!=='profile-found';
      return `<div class="tool-status ${bad?'bad':'ok'}"><b>${bad?'×':'✓'} cookies ${esc(browser)}</b><span>${esc(info.label)}</span></div>`;
    }).join('');
    if(el) el.innerHTML=`<div class="tool-status ${d.ytDlp.available?'ok':'bad'}"><b>${d.ytDlp.available?'✓':'×'} yt-dlp</b><span>${esc(d.ytDlp.version||'не найден')}${d.ytDlp.updateAvailable?` → доступна ${esc(d.ytDlp.latestVersion)}`:''}${d.ytDlp.path?` · ${esc(d.ytDlp.path)}`:''}</span></div><div class="tool-status ${d.ffmpeg.available?'ok':'bad'}"><b>${d.ffmpeg.available?'✓':'×'} FFmpeg</b><span>${d.ffmpeg.available?'доступен для MP3':'не найден — треки сохранятся без перекодирования'}</span></div>${cookieRows}`;
    if(runtime) runtime.textContent=d.jsRuntime ? `JS runtime: ${d.jsRuntime}` : 'JS runtime для дополнительных проверок YouTube не найден: современные проверки YouTube могут не проходить.';
    const cookieHint=$('#providerCookies');
    if(cookieHint) cookieHint.textContent=d.cookies?.file?`Используется файл cookies: ${d.cookies.file}`:'Chrome и Edge шифруют cookies через App-Bound Encryption, поэтому yt-dlp не может их прочитать (ошибка DPAPI). Надёжнее всего Firefox или файл cookies.txt.';
    const updateBtn=$('#updateYtDlp');
    if(updateBtn) updateBtn.textContent = d.ytDlp?.updateAvailable ? `Обновить yt-dlp до ${d.ytDlp.latestVersion}` : 'Обновить yt-dlp';
    if(showToast) toast(d.readyForMp3?'yt-dlp и FFmpeg готовы':'Проверка завершена');
    return d;
  }catch(err){ console.error(err); if(el) el.textContent='Не удалось проверить инструменты'; if(showToast) toast('Не удалось проверить yt-dlp/FFmpeg'); return null; }
}
async function chooseYtDlp(){ const value=await window.localify.providers.chooseYtDlp(); if(!value) return; $('#settingYtDlpPath').value=value; await saveProviderConfig(false); await refreshProviderDiagnostics(true); }
async function chooseCookiesFile(){ const value=await window.localify.providers.chooseCookiesFile(); if(!value) return; $('#settingCookiesFile').value=value; await saveProviderConfig(false); await refreshProviderDiagnostics(true); toast('Файл cookies сохранён'); }
async function refreshLogsPreview(){
  try{
    const text=await window.localify.diagnostics?.logs(40);
    const el=$('#logsPreview');
    if(el) el.textContent=text||'Лог пока пуст.';
  }catch(err){ console.error(err); }
}
async function openLogsDir(){ try{ const dir=await window.localify.diagnostics.openLogs(); toast(`Логи: ${dir}`); }catch(err){ console.error(err); toast('Не удалось открыть папку логов'); } }
async function copyDiagnostics(){
  let report='';
  try{ report=await window.localify.diagnostics.report(); }
  catch(err){ console.error(err); toast('Не удалось собрать отчёт'); return; }
  try{ await navigator.clipboard.writeText(report); toast('Отчёт скопирован в буфер обмена'); }
  catch(err){ console.error(err); const el=$('#logsPreview'); if(el) el.textContent=report; toast('Буфер обмена недоступен: отчёт показан ниже'); }
}
async function clearLogs(){ try{ const ok=await window.localify.diagnostics.clearLogs(); toast(ok?'Логи очищены':'Не удалось очистить логи'); }catch(err){ console.error(err); toast('Не удалось очистить логи'); } await refreshLogsPreview(); }
async function updateYtDlpFromUI(){
  const btn=$('#updateYtDlp');
  const original=btn?.textContent||'Обновить yt-dlp';
  if(btn){ btn.disabled=true; btn.textContent='Обновляю yt-dlp…'; }
  try{
    const result=await window.localify.providers.updateYtDlp();
    if(result?.ok) toast(`yt-dlp: ${result.version||'версия обновлена'}`);
    else toast(`Не удалось обновить yt-dlp: ${String(result?.message||'').slice(0,160)}`);
  }catch(err){ console.error(err); toast('Не удалось обновить yt-dlp'); }
  finally{ if(btn) btn.disabled=false; }
  await refreshProviderDiagnostics(false);
  if(btn) btn.textContent=original;
}
async function clearMetadataCache(){ try{ const result=await window.localify.metadata.clearCache(); if(result?.ok){ const coverPrefix=String(result?.coverCacheUrlPrefix||''); state.library.forEach(t=>{ if(coverPrefix && typeof t.cover==='string' && t.cover.startsWith(coverPrefix)) t.cover=''; delete t.metadataCheckedAt; delete t.metadataStatKey; }); touchLibrary(); metadataPipeline.running=false; metadataPipeline.list=[]; metadataPipeline.cursor=0; metadataPipeline.total=0; metadataPipeline.done=0; updateMetadataQueueStatus(); renderSettings(); renderAll(); void save(); toast('Кэш метаданных очищен'); if(state.settings.onlineMetadata) setTimeout(() => scheduleMetadataHydration(true), 350); } }catch(err){ console.error(err); toast('Не удалось очистить кэш метаданных'); } }
function usesPhysicalPlaylists(){ return !window.__LOCALIFY_ANDROID__ && state.settings.moveFilesIntoPlaylists !== false; }

function playlistIdsForTrack(trackId){
  return state.playlists.filter(p => (p.trackIds || []).includes(trackId)).map(p => p.id);
}
// Кэш ссылок на потоки раньше рос без предела: каждая разрешённая ссылка
// оставалась в Map навсегда. Держим только последние записи.
const STREAM_CACHE_LIMIT = 200;
function cacheStreamUrl(key,url,at){
  state.streamCache.set(key,{url,at});
  if(state.streamCache.size<=STREAM_CACHE_LIMIT) return;
  const oldest=[...state.streamCache.entries()].sort((a,b)=>Number(a[1]?.at||0)-Number(b[1]?.at||0));
  for(const [oldKey] of oldest.slice(0,state.streamCache.size-STREAM_CACHE_LIMIT)) state.streamCache.delete(oldKey);
}
async function ensureRemoteStream(track,silent=false){
  if(!track || track.provider!=='youtube') return track?.streamUrl||'';
  // Ссылки googlevideo живут около шести часов, поэтому короткий кэш заставлял
  // заново запускать yt-dlp при каждом возврате к треку.
  if(track.streamUrl && track._streamResolvedAt && Date.now()-track._streamResolvedAt<45*60*1000) return track.streamUrl;
  const key=`${track.provider}:${track.providerId||track.title+'::'+track.artist}`;
  const cached=state.streamCache.get(key);
  if(cached && Date.now()-cached.at<40*60*1000){ track.streamUrl=cached.url; track._streamResolvedAt=cached.at; return cached.url; }
  if(remoteStreamJobs.has(key)) return remoteStreamJobs.get(key);
  const job=(async()=>{
    try{
      const result=await window.localify.providers.resolveYtDlp({title:track.title,artist:track.artist,album:track.album,sourceUrl:track.sourceUrl,provider:'youtube'});
      if(!result?.url) throw new Error('Не удалось получить поток');
      track.streamUrl=result.url; track._streamResolvedAt=Date.now();
      cacheStreamUrl(key,result.url,track._streamResolvedAt);
      return track.streamUrl;
    }catch(err){ if(!silent) toast(err?.message||'Не удалось подготовить поток YouTube'); throw err; }
    finally{ remoteStreamJobs.delete(key); }
  })();
  remoteStreamJobs.set(key,job);
  return job;
}

async function playRemoteTrack(track){
  if(!track) return;
  try{
    if(!track.streamUrl) await ensureRemoteStream(track);
    if(!track.streamUrl) throw new Error('Не удалось получить аудиопоток');
    state.currentRemoteTrack=track;
    const existingIndex=state.playback.findIndex(t=>t.providerId===track.providerId && t.provider===track.provider);
    if(existingIndex<0){ state.playback.push(track); state.playbackIndex=state.playback.length-1; }
    else state.playbackIndex=existingIndex;
    state.playbackBase=[...state.playback];
    state.playbackSource='onlineSearch';
    updateQueueButton();
    await playCurrentPlayback();
  }catch(err){ console.error(err); toast(err?.message||'Не удалось воспроизвести трек YouTube'); }
}
function downloadKey(track){ return String(track?.providerId || `${track?.artist||''}::${track?.title||''}`); }
function progressMarkup(percent){
  const p=Math.max(0,Math.min(100,Math.round(Number(percent)||0)));
  if(p>=100) return '<span class="download-progress done" aria-label="Скачано" title="Скачано">✓</span>';
  return `<span class="download-progress" style="--progress:${p * 3.6}deg" aria-label="Скачивание ${p}%" title="Скачивание ${p}%"><span>${p}%</span></span>`;
}
function updateDownloadProgress(data){
  const key=String(data?.key||''); if(!key) return;
  const p=Math.max(0,Math.min(100,Number(data?.percent)||0));
  state.downloadProgress.set(key,p);
  $$('[data-download-track]').filter(el=>el.dataset.downloadTrack===key).forEach(btn=>{
    btn.innerHTML=progressMarkup(p); btn.classList.add('is-downloading');
  });
  const current=currentTrack();
  if(current && downloadKey(current)===key){
    const b=$('#downloadNowBtn'); if(b && p<100){ b.innerHTML=progressMarkup(p); b.classList.add('is-downloading'); }
    if(p>=100){ b.innerHTML='<span class="download-progress done" aria-hidden="true">✓</span>'; b.classList.remove('is-downloading'); }
  }
}
function resetDownloadButtonVisual(track){
  const b=$('#downloadNowBtn'); if(!b) return;
  const p=state.downloadProgress.get(downloadKey(track));
  if(Number.isFinite(p) && p>0 && p<100){ b.innerHTML=progressMarkup(p); b.classList.add('is-downloading'); return; }
  if(track?.downloadedPath){ b.innerHTML='<span class="download-progress done" aria-hidden="true">✓</span>'; b.classList.remove('is-downloading'); return; }
  b.innerHTML='<span class="download-glyph" aria-hidden="true"><svg viewBox="0 0 24 24"><path d="M12 4v10m0 0 4-4m-4 4-4-4M5 20h14"/></svg></span>'; b.classList.remove('is-downloading');
}
// Скачанный через yt-dlp трек часто приходит без встроенной картинки (FFmpeg не
// найден, YouTube не отдал превью), а онлайн-поиск для ролика с YouTube почти
// никогда не находит релиз — трек оставался в библиотеке без обложки. Миниатюра,
// которую Crimson уже показывал в результатах поиска, сохраняется вместе с треком.
function applyDownloadedCover(result){
  const filePath=String(result?.path||''); const cover=String(result?.cover||'');
  if(!filePath || !/^https?:\/\//i.test(cover)) return false;
  const track=findTrackByPath(filePath);
  if(!track || track.cover) return false;
  track.remoteCover=cover;
  invalidateTrackSearchIndex(track);
  touchLibrary({ track });
  void save();
  renderAll();
  return true;
}
async function downloadRecommendation(track){
  if(!track || !track.artist || !track.title) return;
  if(window.__LOCALIFY_ANDROID__){ toast('В Android-версии доступны онлайн-превью. Скачивание через yt-dlp не входит в эту сборку.'); return; }
  const key=downloadKey(track); state.downloadProgress.set(key,0); updateDownloadProgress({key,percent:0});
  try { const result=await window.localify.providers.downloadYtDlp(track); track.downloadedPath=result?.path||''; state.downloadProgress.set(key,100); updateDownloadProgress({key,percent:100,status:'done'}); toast(result?.duplicate ? 'Такой трек уже есть в библиотеке' : (result?.audioFallback ? `FFmpeg не найден: трек сохранён в ${String(result?.format||'m4a').toUpperCase()} без перекодирования` : 'Трек скачан через yt-dlp в «Localify Downloads»')); await syncConfiguredLibrary(true); applyDownloadedCover(result); state.onlineCache.clear(); updateDownloadButton(); }
  catch(err){ console.error(err); state.downloadProgress.delete(key); updateDownloadButton(); toast(err?.message||'Не удалось скачать трек через yt-dlp'); }
}
async function downloadCurrentRemoteTrack(){
  const track=currentTrack();
  if(!track || !track.artist || !track.title) { toast('Текущий трек нельзя скачать'); return; }
  if(track.downloadedPath){ toast('Трек уже скачан'); return; }
  await downloadRecommendation(track);
}
function updateDownloadButton(){
  const b=$('#downloadNowBtn'); if(!b)return;
  const t=currentTrack(); const remoteProvider = t?.provider==='youtube'; const enabled=!!t && remoteProvider && t.downloadAllowed===true && !t.downloadedPath;
  b.disabled=!enabled; b.classList.toggle('active', enabled); b.title = t?.downloadedPath ? 'Трек уже скачан' : (enabled ? 'Скачать текущий трек' : 'Скачивание недоступно');
  b.setAttribute('aria-label',b.title); resetDownloadButtonVisual(t);
}
function toggleShuffleMode(){
  if(state.shuffleMode==='off'){
    state.shuffleMode='normal'; state.shuffle=true;
    rebuildPlaybackOrder(true);
    toast('Перемешивание включено');
  } else {
    state.shuffleMode='off'; state.shuffle=false;
    rebuildPlaybackOrder(true);
    toast('Перемешивание выключено');
  }
  updateShuffleUI(); updateQueueButton();
}


function setGenreCollapsed(collapsed){
  state.genreCollapsed=!!collapsed;
  localStorage.setItem('localify.genreCollapsed', state.genreCollapsed ? '1' : '0');
  const section=$('.genre-section');
  const btn=$('#genreToggle');
  section?.classList.toggle('genre-collapsed', state.genreCollapsed);
  if(btn){ btn.setAttribute('aria-expanded', state.genreCollapsed ? 'false' : 'true'); btn.title=state.genreCollapsed?'Развернуть жанры':'Свернуть жанры'; btn.setAttribute('aria-label',btn.title); btn.textContent=state.genreCollapsed?'⌄':'⌃'; }
}

const RADIO_SEED_COUNT = 12;
const RADIO_ONLINE_TARGET = 28;
const RADIO_LOCAL_TARGET = 28;

function radioScopeLabel(){
  if(state.radioScope==='all') return 'Вся моя музыка';
  const p=findPlaylistById(state.radioScope);
  return p ? `Плейлист: ${p.name}` : 'Вся моя музыка';
}
function radioSourceTracks(){
  if(state.radioScope==='all') return [...state.library];
  const p=findPlaylistById(state.radioScope);
  if(!p) return [...state.library];
  const ids=new Set(p.trackIds||[]);
  return state.library.filter(t=>ids.has(t.id));
}
function radioLocalTrackList(){
  const q=String(state.radioQuery||'').trim();
  const source=radioSourceTracks();
  if(!q) return source.sort((a,b)=>(Number(b.addedAt)||0)-(Number(a.addedAt)||0));
  const needle=q.toLocaleLowerCase();
  return source.filter(t=>[t.title,t.artist,t.album,t.genre].filter(Boolean).some(v=>String(v).toLocaleLowerCase().includes(needle)));
}
function radioShuffle(list){
  const a=[...list]; for(let i=a.length-1;i>0;i--){const j=Math.floor(Math.random()*(i+1));[a[i],a[j]]=[a[j],a[i]];} return a;
}
function radioPickLocalTracks(source, count){
  const unique=[];
  const seen=new Set();
  for(const t of source){
    const key=String(t?.id||`${t?.path||''}|${t?.title||''}|${t?.artist||''}`);
    if(!key || seen.has(key)) continue;
    seen.add(key);
    unique.push(t);
  }
  const recent=new Set(state.radioRecentLocalIds||[]);
  const fresh=radioShuffle(unique.filter(t=>!recent.has(String(t.id))));
  const fallback=radioShuffle(unique.filter(t=>recent.has(String(t.id))));
  const picked=[...fresh,...fallback].slice(0, Math.min(count, unique.length));
  state.radioRecentLocalIds=picked.map(t=>String(t.id));
  return picked;
}
function radioSeeds(){
  const source=radioSourceTracks();
  return radioShuffle(source).slice(0, Math.min(RADIO_SEED_COUNT, source.length));
}
function radioSeedQueries(seeds){
  // Online recommendations are built from the actual local library, not from
  // a manually entered online query. Use concrete local tracks first, then
  // broaden with artists/genres so the result follows the user's collection.
  const queries=[];
  const clean=(v)=>String(v||'').trim();
  for(const seed of radioShuffle(seeds).slice(0,5)){
    const artist=clean(seed.artist), title=clean(seed.title);
    if(artist && title) queries.push(`${artist} ${title} similar music`);
    else if(artist) queries.push(`${artist} similar music`);
    else if(title) queries.push(`${title} similar music`);
  }
  const artists=[...new Set(seeds.map(t=>clean(t.artist)).filter(Boolean))];
  const genres=[...new Set(seeds.map(t=>clean(t.genre)).filter(g=>g && !/^music$/i.test(g) && !/^(unknown|other|misc)/i.test(g)))];
  for(const artist of radioShuffle(artists).slice(0,2)) queries.push(`${artist} similar artists music`);
  for(const genre of radioShuffle(genres).slice(0,2)) queries.push(`${genre} music similar artists`);
  return [...new Set(queries)].slice(0,8);
}
async function buildAutoRadioMix(){
  const source=radioSourceTracks();
  if(!source.length){ toast(state.radioScope==='all' ? 'Добавьте хотя бы несколько локальных треков для построения радио' : 'В выбранном плейлисте нет локальных треков'); return []; }
  if(state.radioAutoLoading) return state.radioOnlineResults||[];
  state.radioAutoLoading=true; state.radioAutoReady=false; state.radioOnlineResults=[]; state.radioQuery=''; state.radioAutoStep=0; state.radioAutoStage='Выбираю характер музыки'; renderRadio();
  try{
    const seeds=radioSeeds();
    state.radioLocalResults=radioPickLocalTracks(source, RADIO_LOCAL_TARGET);
    const queries=radioSeedQueries(seeds);
    state.radioAutoTotal=Math.max(queries.length,1);
    const found=[];
    const seen=new Set(state.onlineLibraryKeys||[]);
    renderRadio();
    for(const q of queries){
      if(found.length>=RADIO_ONLINE_TARGET) break;
      state.radioAutoStep++;
      state.radioAutoStage=`Ищу похожую музыку (${state.radioAutoStep}/${state.radioAutoTotal})`;
      renderRadio();
      try{
        const results=await window.localify.providers.onlineSearch({
          query:q, limit:Math.min(10, RADIO_ONLINE_TARGET-found.length),
          localLibrary:source.map(t=>({title:t.title,artist:t.artist,provider:t.provider,providerId:t.providerId}))
        });
        for(const item of filterOnlineResults(results||[])){
          const key=canonicalOnlineTrackKey(item)||`${item?.provider||'remote'}:${item?.providerId||item?.sourceUrl||item?.title}`;
          if(seen.has(key)) continue;
          seen.add(key); found.push({...item,id:item.id||`remote:youtube:${item.providerId||item.sourceUrl||item.title}`});
          if(found.length>=RADIO_ONLINE_TARGET) break;
        }
      }catch(err){ console.warn('Radio query failed:',q,err); }
    }
    state.radioAutoStage='Формирую очередь'; state.radioAutoStep=state.radioAutoTotal; renderRadio();
    state.radioOnlineResults=radioShuffle(found).slice(0,RADIO_ONLINE_TARGET);
    state.radioAutoReady=state.radioOnlineResults.length>0;
    if(!state.radioAutoReady) toast('Не удалось найти онлайн-треки. Проверьте yt-dlp и интернет-соединение.');
    return state.radioOnlineResults;
  } finally { state.radioAutoLoading=false; state.radioAutoStage=''; renderRadio(); }
}
function radioLocalCard(track){
  const id=esc(track.id);
  const playing=currentTrack()?.id===track.id && !audio.paused;
  const cover=coverHtml(track.cover,'',track.remoteCover||'');
  const meta=[track.artist||'Неизвестный исполнитель',track.album||'Локальная библиотека'].join(' · ');
  return `<article class="radio-card ${playing?'playing':''}"><div class="radio-logo">${cover || uiIcon('music')}</div><div class="radio-copy"><span class="radio-provider">Моя музыка</span><b title="${esc(track.title||'Без названия')}">${esc(track.title||'Без названия')}</b><small title="${esc(meta)}">${esc(meta)}</small><div class="radio-tags">${esc(track.genre||'Локальный трек')}</div></div><button class="radio-play" type="button" data-radio-local-play="${id}" aria-label="${playing?'Пауза':'Воспроизвести'}" title="${playing?'Пауза':'Воспроизвести'}">${playing?'<svg viewBox="0 0 24 24"><rect x="7" y="5" width="3.5" height="14" rx="1.2"/><rect x="13.5" y="5" width="3.5" height="14" rx="1.2"/></svg>':'<svg viewBox="0 0 24 24"><path d="M8.5 5.2 18 12l-9.5 6.8V5.2Z"/></svg>'}</button></article>`;
}
function radioOnlineCard(track,index){
  const playing=(currentTrack()?.provider===track.provider || (!window.__LOCALIFY_ANDROID__ && currentTrack()?.provider==='youtube')) && currentTrack()?.providerId===track.providerId && !audio.paused;
  return `<article class="radio-card radio-card-online ${playing?'playing':''}"><div class="radio-logo">${coverHtml(track.cover) || uiIcon('play')}</div><div class="radio-copy"><span class="radio-provider">${track.provider==='itunes'?'iTunes Preview':'YouTube'}</span><b title="${esc(track.title||'Без названия')}">${esc(track.title||'Без названия')}</b><small title="${esc(track.artist||'YouTube')}">${esc(track.artist||'YouTube')}${track.duration?` · ${fmtTime(track.duration)}`:''}</small><div class="radio-tags">Онлайн · ${esc(libraryMatchLabel(track))}</div><div class="radio-online-actions"><button type="button" class="primary small-btn" data-radio-online-play="${index}">${uiIcon(playing?'pause':'play')} ${playing?'Пауза':'Слушать'}</button><button type="button" class="secondary small-btn" data-radio-online-download="${index}">${uiIcon('download')} Скачать</button></div></div></article>`;
}
function renderRadio(){
  const root=$('#radioGrid'); if(!root)return;
  const q=String(state.radioQuery||'').trim();
  const local=state.radioMode==='online' ? [] : (!q && state.radioAutoReady && state.radioLocalResults.length ? [...state.radioLocalResults] : radioLocalTrackList());
  const online=state.radioMode==='local' ? [] : (state.radioOnlineResults||[]);
  const status=$('#radioStatus');
  if(status){
    if(state.radioAutoLoading){
      const total=state.radioAutoTotal||1, step=Math.min(state.radioAutoStep||0,total);
      status.innerHTML=`<span class="radio-status-main">${esc(state.radioAutoStage||'Подбираю музыку…')}</span><span class="radio-status-sub">Основа: ${esc(radioScopeLabel())} · ${step}/${total} · найдено онлайн: ${state.radioOnlineResults.length}</span><span class="radio-progress"><i style="width:${Math.max(6,Math.round(step/total*100))}%"></i></span>`;
    } else if(state.radioOnlineLoading) status.textContent='Ищу музыку онлайн…';
    else if(q) status.textContent=`Моя музыка: ${local.length} · Онлайн: ${online.length}`;
    else if(state.radioAutoReady) status.textContent=`Онлайн-подборка готова на основе «${radioScopeLabel()}» · ${fmtCount(state.radioOnlineResults.length,'трек','трека','треков')}`;
    else status.textContent=`Онлайн-подборка будет собрана автоматически на основе «${radioScopeLabel()}»: ${fmtCount(RADIO_SEED_COUNT,'случайный локальный трек','случайных локальных трека','случайных локальных треков')} определят музыкальный профиль.`;
  }
  const scope=$('#radioScope');
  if(scope){
    const current=state.radioScope;
    scope.innerHTML=`<option value="all">Вся моя музыка (${state.library.length})</option>`+state.playlists.map(p=>{const count=(p.trackIds||[]).filter(id=>state.trackById.has(id)).length;return `<option value="${esc(p.id)}">${esc(p.name)} (${count})</option>`}).join('');
    scope.value=state.playlists.some(p=>p.id===current)?current:'all';
    if(scope.value!==state.radioScope){state.radioScope='all';localStorage.setItem('localify.radioScope','all');}
    scope.disabled=state.radioAutoLoading;
  }
  $$('#radioSourceTabs [data-radio-mode]').forEach(btn=>btn.classList.toggle('active',btn.dataset.radioMode===state.radioMode));
  const play=$('#radioPlayBtn');
  if(play){
    const canBuildAuto=!q && radioSourceTracks().length>0;
    play.disabled=state.radioAutoLoading || !(local.length||online.length||canBuildAuto);
    play.innerHTML=state.radioAutoLoading ? '<span class="radio-spinner"></span> Подбираю музыку…' : uiIcon('play') + ' Запустить радио';
    play.classList.toggle('is-loading',state.radioAutoLoading);
  }
  if(state.radioOnlineLoading){ root.innerHTML=`<div class="radio-section-label">ОНЛАЙН</div><div class="radio-empty">Ищу через YouTube / yt-dlp…</div>`; return; }
  const parts=[];
  if(local.length) parts.push(`<div class="radio-section-label">МОЯ МУЗЫКА <span>${local.length}</span></div>${local.slice(0,100).map(radioLocalCard).join('')}`);
  if(online.length) parts.push(`<div class="radio-section-label">ОНЛАЙН <span>${online.length}</span></div>${online.slice(0,30).map((t,i)=>radioOnlineCard(t,i)).join('')}`);
  root.innerHTML=parts.length ? parts.join('') : `<div class="radio-empty">${q?'Ничего не найдено. Попробуйте другое название, исполнителя или альбом.':'Добавьте музыку в библиотеку или введите запрос для поиска онлайн.'}</div>`;
  $$('#radioGrid [data-radio-local-play]').forEach(btn=>btn.addEventListener('click',()=>{
    const list=radioLocalTrackList(); const idx=list.findIndex(t=>String(t.id)===String(btn.dataset.radioLocalPlay)); if(idx>=0) startPlayback(list,idx,'radio');
  }));
  $$('#radioGrid [data-radio-online-play]').forEach(btn=>btn.addEventListener('click',()=>{
    const track=state.radioOnlineResults[Number(btn.dataset.radioOnlinePlay)]; if(track) playRemoteTrack(track);
  }));
  $$('#radioGrid [data-radio-online-download]').forEach(btn=>btn.addEventListener('click',()=>{
    const track=state.radioOnlineResults[Number(btn.dataset.radioOnlineDownload)]; if(track) downloadRecommendation(track);
  }));
}
async function runRadioSearch(query=''){
  state.radioQuery=String(query||'').trim();
  const q=state.radioQuery;
  state.radioOnlineResults=[];
  if(q && state.radioMode!=='local'){
    state.radioOnlineLoading=true; renderRadio();
    try{
      const cacheKey=`radio::${q.toLocaleLowerCase()}::18`;
      const cached=getOnlineCache(cacheKey);
      if(cached && Date.now()-cached.at<5*60*1000) state.radioOnlineResults=filterOnlineResults(cached.results).map(t=>({...t,id:t.id||`remote:youtube:${t.providerId||t.sourceUrl||t.title}`}));
      else {
        const results=await window.localify.providers.onlineSearch({query:q,limit:18,localLibrary:state.library.map(t=>({title:t.title,artist:t.artist,provider:t.provider,providerId:t.providerId}))});
        state.radioOnlineResults=filterOnlineResults(results||[]).map(t=>({...t,id:t.id||`remote:youtube:${t.providerId||t.sourceUrl||t.title}`}));
        setOnlineCache(cacheKey,{at:Date.now(),results:state.radioOnlineResults});
      }
    }catch(err){ console.error(err); toast(err?.message||'Не удалось выполнить онлайн-поиск'); }
    finally{ state.radioOnlineLoading=false; }
  }
  renderRadio();
  if(state.currentView!=='radio') setView('radio');
}
async function startRadioMix(){
  // With no manual search the radio is an automatic hybrid: it samples a small
  // part of the local library to infer the user's taste, discovers online tracks,
  // then shuffles both sources into one queue.
  if(!state.radioQuery){
    if(!state.radioAutoReady || !state.radioOnlineResults.length) await buildAutoRadioMix();
    const source=radioSourceTracks();
    const local=(state.radioLocalResults?.length ? [...state.radioLocalResults] : radioPickLocalTracks(source, RADIO_LOCAL_TARGET)).filter((t,i,a)=>a.findIndex(x=>x.id===t.id)===i).slice(0,RADIO_LOCAL_TARGET);
    const online=radioShuffle(state.radioOnlineResults||[]).filter((t,i,a)=>a.findIndex(x=>(x.id||x.providerId||x.sourceUrl) === (t.id||t.providerId||t.sourceUrl))===i).slice(0,RADIO_ONLINE_TARGET);
    const list=radioShuffle([...local,...online]);
    if(!list.length){ toast('Нет треков для радио'); return; }
    const chosen=list[0];
    const built=playbackQueue.build(list,{shuffle:true,currentId:chosen.id});
    state.playbackSource='radio'; state.playbackBase=[...list]; state.playback=built.items; state.playbackIndex=built.index;
    state.shuffleMode='normal'; state.shuffle=true;
    updateShuffleUI(); updateQueueButton();
    playCurrentPlayback();
    toast(`Авторадио: ${local.length} локальных + ${online.length} онлайн`);
    return;
  }
  const local=state.radioMode==='online' ? [] : radioLocalTrackList();
  const online=(state.radioMode==='local' ? [] : (state.radioOnlineResults||[]));
  const localUnique=local.filter((t,i,a)=>a.findIndex(x=>x.id===t.id)===i);
  const onlineUnique=online.filter((t,i,a)=>a.findIndex(x=>(x.id||x.providerId||x.sourceUrl)===(t.id||t.providerId||t.sourceUrl))===i);
  const list=radioShuffle([...localUnique,...onlineUnique]);
  if(!list.length){ toast('Нет треков для радио'); return; }
  const chosen=list[0];
  const built=playbackQueue.build(list,{shuffle:true,currentId:chosen.id});
  state.playbackSource='radio'; state.playbackBase=[...list]; state.playback=built.items; state.playbackIndex=built.index;
  state.shuffleMode='normal'; state.shuffle=true;
  updateShuffleUI(); updateQueueButton(); playCurrentPlayback();
  toast(`Радио: ${fmtCount(list.length,'трек','трека','треков')}${online.length?' · включая онлайн':''}`);
}

function setView(view) {
  state.currentView = view;
  $$('.nav-item').forEach(b => { const active = b.dataset.view === view; b.classList.toggle('active', active); if (active) b.setAttribute('aria-current', 'page'); else b.removeAttribute('aria-current'); });
  $$('.view').forEach(v => v.classList.remove('active-view'));
  $(`#${view}View`).classList.add('active-view');
  renderAll();
  if (view === 'settings') { renderSettings(); void refreshLogsPreview(); }
  if (view === 'radio') renderRadio();
}

async function addFiles() {
  const tracks = await window.localify.pickFiles();
  addTracks(tracks);
}
async function addFolder() {
  const tracks = await window.localify.pickFolder();
  addTracks(tracks);
}
async function chooseAndSetMusicFolder(){
  let result;
  try { result = await window.localify.chooseLibraryFolder(); } catch (err) { console.error(err); toast('Не удалось открыть папку библиотеки'); return; }
  if(!result) return;
  state.settings.musicFolder = result.folder;
  await window.localify.settings.save(state.settings);
  await applyLibraryScanResult(result, true);
}
function normalizeTrack(track){ const next={ ...track, id: track?.id || uid('trk'), addedAt: track?.addedAt || Date.now(), sourcePath: track?.sourcePath || track?.path || '', path: track?.path || track?.sourcePath || '' }; delete next.liked; delete next.replayGainTrack; delete next.replayGainAlbum; delete next.crossfade; return rebuildTrackSearchIndex(next); }
async function addTracks(tracks, notify = true){
  if(!Array.isArray(tracks) || !tracks.length) return 0;
  let added = 0;
  const known = state.trackByPath;
  for(const t of tracks){
    const key = normalizeFsPath(t.sourcePath || t.path || '');
    if(key && known.has(key)) continue;
    const normalized = normalizeTrack(t);
    state.library.push(normalized);
    indexTrack(normalized, state.library.length - 1);
    added++;
  }
  if(added) { touchLibrary({ structure: true }); save(); if(state.settings.onlineMetadata) scheduleMetadataHydration(true); }
  if(notify) renderAll();
  return added;
}
async function applyLibraryScanResult(result, notify=true){
  if (result && result.folderAvailable === false) { if (notify) toast('Не удалось открыть музыкальную папку — библиотека сохранена'); return; }
  if(!result) return;
  state.settings.musicFolder = result.folder || state.settings.musicFolder;

  let playlistStructureChanged = false;
  for (const discovered of (result.discoveredPlaylists || [])) {
    if (!discovered?.id) continue;
    const existing = state.playlists.find(p => p.id === discovered.id)
      || state.playlists.find(p => normalizeFsPath(p.folderPath || '') === normalizeFsPath(discovered.folderPath || ''));
    if (existing) {
      existing.folderPath = discovered.folderPath || existing.folderPath || '';
      existing.name = discovered.name || existing.name || 'Плейлист';
      if (!existing.cover && discovered.cover) existing.cover = discovered.cover;
    } else {
      state.playlists.push({ id: discovered.id, name: discovered.name || 'Плейлист', cover: discovered.cover || '', trackIds: [], folderPath: discovered.folderPath || '' });
      playlistStructureChanged = true;
    }
  }
  if (playlistStructureChanged) rebuildPlaylistIndex();
  const byPath = new Map(state.trackByPath);

  let added = 0;
  for(const raw of (result.tracks || [])){
    const normalized = normalizeTrack(raw);
    const key = normalizeFsPath(normalized.sourcePath || normalized.path || '');
    const existing = key ? byPath.get(key) : null;
    if(existing){
      const stableId = existing.id;
      const addedAt = existing.addedAt || normalized.addedAt || Date.now();
      const manual = existing.metadataOverride === true ? { title: existing.title, artist: existing.artist, album: existing.album, year: existing.year } : null;
      const merged = mergeTrackData(existing, normalized);
      merged.id = stableId || merged.id;
      merged.addedAt = addedAt;
      if(manual){ Object.assign(merged, manual); merged.metadataSource = 'manual'; merged.metadataOverride = true; }
      rebuildTrackSearchIndex(merged);
      byPath.set(key, merged);
    } else {
      state.library.push(normalized);
      if(key) byPath.set(key, normalized);
      added++;
    }
  }
  const scannedPlaylistIds = new Map((result.playlistScans || []).map(scan => [scan.playlistId, new Set(scan.trackIds || [])]));
  for(const scan of (result.playlistScans || [])){
    const p = findPlaylistById(scan.playlistId);
    if(p){ p.folderPath = scan.folderPath || p.folderPath || ''; p.trackIds = [...new Set(scan.trackIds || [])]; }
  }
  for(const item of (result.playlistTracks || [])){
    const itemPath = normalizeFsPath(item.track?.sourcePath || item.track?.path || '');
    let t = itemPath ? byPath.get(itemPath) : null;
    if(!t && item.track){
      t = normalizeTrack(item.track);
      state.library.push(t);
      if(itemPath) byPath.set(itemPath, t);
    }
    const p = findPlaylistById(item.playlistId);
    if(p && t){
      p.trackIds ||= [];
      if(!p.trackIds.includes(t.id)) p.trackIds.push(t.id);
      p.folderPath = item.folderPath || p.folderPath || '';
    }
  }
  // The filesystem is the source of truth for playlist membership when a playlist
  // folder was successfully scanned. Empty folders therefore correctly clear stale IDs.
  for(const p of state.playlists){
    const scanned = scannedPlaylistIds.get(p.id);
    if(scanned) p.trackIds = (p.trackIds || []).filter(id => scanned.has(id));
  }
  const currentPaths = new Set((result.foundPaths || []).filter(Boolean).map(normalizeFsPath));
  const configuredRoot = normalizeFsPath(state.settings.musicFolder || '');
  const playlistRoot = normalizeFsPath((state.settings.musicFolder ? `${state.settings.musicFolder}/Localify Playlists` : ''));
  const removedIds = new Set();
  state.library = state.library.filter(t => {
    const path = normalizeFsPath(t.sourcePath || t.path || '');
    if(!path || !configuredRoot) return true;
    const underConfigured = path === configuredRoot || path.startsWith(configuredRoot + '/');
    const underPlaylist = playlistRoot && (path === playlistRoot || path.startsWith(playlistRoot + '/'));
    if((underConfigured || underPlaylist) && !currentPaths.has(path)){ removedIds.add(t.id); return false; }
    return true;
  });
  if(removedIds.size){
    const removedCurrent = removedIds.has(currentTrack()?.id);
    state.playback = state.playback.filter(t => !removedIds.has(t.id));
    if(removedCurrent){ state.currentIndex=-1; state.currentRemoteTrack=null; audio.pause(); audio.removeAttribute('src'); updateNowPlaying(null); }
    repairPlaybackIndex(removedCurrent);
  }
  if (state.playbackBase.length) {
    const baseIds = state.playbackBase.map(t => t.id);
    const queueIds = state.playback.map(t => t.id);
    state.playbackBase = baseIds.map(id => findTrackById(id)).filter(Boolean);
    state.playback = queueIds.map(id => findTrackById(id)).filter(Boolean);
    state.playbackIndex = Math.max(0, Math.min(state.playback.length - 1, state.playbackIndex));
  }
  rebuildLibraryIndexes();
  save(); renderAll(); if (notify) toast(removedIds.size ? `Синхронизация: удалено ${fmtCount(removedIds.size,'трек','трека','треков')}` : `Библиотека синхронизирована: ${fmtCount(state.library.length,'трек','трека','треков')}`);
  if(added && state.settings.onlineMetadata) setTimeout(() => scheduleMetadataHydration(true), 200);
}

function normalizeFsPath(p) { return String(p || '').replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase(); }
async function applyLibraryChangeResult(result, notify = false, persist = true) {
  if (!result || result.fullScan) return applyLibraryScanResult(result, notify);
  const removed = new Set((result.removedPaths || []).filter(Boolean).map(normalizeFsPath));
  let structureChanged = false;
  const removedIds = new Set();
  const removedKeys = [...removed];
  let minRemovedIndex = Number.POSITIVE_INFINITY;
  if (removed.size) {
    const survivors = [];
    for (const track of state.library) {
      const key = normalizeFsPath(track?.sourcePath || track?.path || '');
      const isRemoved = key && removedKeys.some(pathKey => key === pathKey || key.startsWith(pathKey + '/'));
      if (isRemoved) {
        const idx = removeTrackFromIndexes(track);
        if (idx >= 0) minRemovedIndex = Math.min(minRemovedIndex, idx);
        removedIds.add(track.id); structureChanged = true;
      } else survivors.push(track);
    }
    if (structureChanged) state.library = survivors;
    if (removedIds.size) {
      const removedCurrent = removedIds.has(currentTrack()?.id);
      state.playback = state.playback.filter(t => !removedIds.has(t.id));
      state.playbackBase = state.playbackBase.filter(t => !removedIds.has(t.id));
      if (removedCurrent) { state.currentIndex = -1; state.currentRemoteTrack = null; audio.pause(); audio.removeAttribute('src'); updateNowPlaying(null); }
      repairPlaybackIndex(removedCurrent);
      for (const playlist of state.playlists) playlist.trackIds = (playlist.trackIds || []).filter(id => !removedIds.has(id));
      if (minRemovedIndex < Number.POSITIVE_INFINITY) reindexLibraryPositionsFrom(minRemovedIndex);
    }
  }
  let added = 0, changed = 0;
  for (const raw of (result.tracks || [])) {
    const incoming = normalizeTrack(raw);
    const key = normalizeFsPath(incoming.sourcePath || incoming.path || '');
    const existing = key ? findTrackByPath(key) : findTrackById(incoming.id);
    if (existing) {
      const stableId = existing.id;
      const addedAt = existing.addedAt || incoming.addedAt || Date.now();
      const manual = existing.metadataOverride === true ? { title: existing.title, artist: existing.artist, album: existing.album, year: existing.year } : null;
      mergeTrackData(existing, incoming);
      existing.id = stableId;
      existing.addedAt = addedAt;
      if (manual) { Object.assign(existing, manual); existing.metadataSource = 'manual'; existing.metadataOverride = true; }
      invalidateTrackSearchIndex(existing);
      indexTrack(existing, findLibraryIndexById(existing.id));
      changed++;
    } else {
      state.library.push(incoming);
      indexTrack(incoming, state.library.length - 1);
      added++; structureChanged = true;
    }
  }
  if (removed.size || added || changed) {
    state.libraryRevision++;
    clearDerivedCaches();
  }
  for (const assignment of (result.playlistAssignments || [])) {
    const playlist = state.playlists.find(p => p.id === assignment.playlistId);
    if (!playlist) continue;
    playlist.trackIds ||= [];
    if (assignment.action === 'remove') playlist.trackIds = playlist.trackIds.filter(id => id !== assignment.trackId);
    else if (!playlist.trackIds.includes(assignment.trackId)) playlist.trackIds.push(assignment.trackId);
  }
  if (removed.size || added || changed) {
    if (persist) save();
    if (persist) renderAll();
    if (added && state.settings.onlineMetadata) scheduleMetadataHydration(true);
  }
  if (notify && (removed.size || added || changed)) toast(`Библиотека обновлена: +${added}, изменено ${changed}, удалено ${removed.size}`);
}
function updateLibraryScanProgress(payload = {}) {
  state.scanProgress = payload.phase || state.scanProgress;
  const el = $('#libraryScanStatus');
  if (!el) return;
  if (payload.done && payload.phase !== 'done') {
    const phase = payload.phase === 'stat' ? 'Проверяю изменения' : (payload.phase === 'parse' ? 'Разбираю новые файлы' : 'Сканирую библиотеку');
    el.textContent = `${phase} ${payload.done}/${payload.total || payload.done}`;
    el.hidden = false;
    return;
  }
  if (payload.phase === 'done') {
    el.textContent = 'Библиотека актуальна';
    el.hidden = false;
    clearTimeout(window.__scanStatusHide);
    window.__scanStatusHide = setTimeout(() => { el.hidden = true; }, 1800);
    return;
  }
  el.textContent = 'Сканирование библиотеки…';
  el.hidden = false;
}

async function syncConfiguredLibrary(notify = true, change = null) {
  if (state.syncingLibrary) return;
  if (!state.settings.musicFolder) { if (notify) toast('Сначала выберите музыкальную папку'); return; }
  state.syncingLibrary = true;
  updateLibraryScanProgress({ phase: 'start' });
  try {
    if (change?.fullScan || (!change?.changes?.length && !change?.filename)) {
      const result = await window.localify.scanLibraryFolder({ fastStart: change?.fastStart === true });
      await applyLibraryScanResult(result, notify);
      return;
    }
    const changes = Array.isArray(change?.changes) ? change.changes : (change?.filename ? [change] : []);
    if (changes.length > 1 && window.localify.scanLibraryChanges) {
      const deltas = await window.localify.scanLibraryChanges(changes);
      let changedCount = 0;
      for (const delta of deltas || []) {
        await applyLibraryChangeResult(delta, false, false);
        changedCount++;
      }
      if (changedCount) { save(); if (notify) renderAll(); }
      if (changedCount && notify) toast(`Библиотека обновлена: обработано изменений ${changedCount}`);
    } else if (changes.length) {
      for (const single of changes) {
        const delta = await window.localify.scanLibraryChange(single);
        if (delta?.fullScan) {
          const result = await window.localify.scanLibraryFolder();
          await applyLibraryScanResult(result, notify);
          break;
        }
        await applyLibraryChangeResult(delta, false, false);
      }
      save();
      if (notify) renderAll();
    }
  }
  catch (err) { console.error('Library sync failed:', err); if (notify) toast('Не удалось обновить библиотеку'); }
  finally { state.syncingLibrary = false; if (!state.scanProgress) updateLibraryScanProgress({ phase: 'done', done: state.library.length, total: state.library.length }); }
}
async function refreshTrackMetadata(id) {
  const track=findTrackById(id); if(!track)return; const filePath=track.path||track.sourcePath||''; if(!filePath){toast('У трека нет пути к файлу');return;}
  toast('Обновляю метаданные…');
  try{ const fresh=await (window.localify.metadata.refresh?window.localify.metadata.refresh(track):window.localify.metadata.search(track)); if(!fresh){toastError('Не удалось найти метаданные');return;} const addedAt=track.addedAt; mergeTrackData(track,fresh); Object.assign(track,{metadataCheckedAt:Date.now(),metadataStatKey:track._statKey||fresh._statKey||'',metadataOverride:false}); track.id=id; track.addedAt=addedAt||track.addedAt||Date.now(); invalidateTrackSearchIndex(track); touchLibrary({ track }); await save(); renderAll(); toastSuccess('Метаданные обновлены'); }
  catch(err){console.error('Metadata refresh failed:',err);toast('Не удалось обновить метаданные');}
}
const metadataPipeline = new window.LocalifyMetadataPipeline({
  getTracks: () => state.library,
  isEnabled: () => state.settings.onlineMetadata !== false,
  search: track => window.localify.metadata.search(track),
  save,
  render: () => { if(['library','home','playlists'].includes(state.currentView)) renderCurrentView(); },
  status: () => {
    const el = $('#metadataQueueStatus');
    if (!el) return;
    if (!state.settings.onlineMetadata) { el.textContent = 'Онлайн-обогащение отключено'; return; }
    if (metadataPipeline.running) { el.textContent = `Обработка метаданных: ${metadataPipeline.done}/${metadataPipeline.total}`; return; }
    el.textContent = metadataPipeline.total ? `Готово: ${metadataPipeline.done}/${metadataPipeline.total}` : 'Очередь метаданных пуста';
  },
  apply: (track, fresh) => {
    const stableId = track.id, addedAt = track.addedAt;
    const cleanFresh = { ...fresh }; delete cleanFresh.replayGainTrack; delete cleanFresh.replayGainAlbum; delete cleanFresh.crossfade; mergeTrackData(track, cleanFresh);
    track.id = stableId;
    track.addedAt = addedAt || track.addedAt || Date.now();
    invalidateTrackSearchIndex(track);
    touchLibrary({ track });
  }
});
function metadataCandidates(){ return metadataPipeline.candidates(); }
function updateMetadataQueueStatus(){ metadataPipeline.status(); }
function scheduleMetadataHydration(reset=false){ void metadataPipeline.run(reset); }
async function hydrateMissingCovers(){ scheduleMetadataHydration(false); }

function trackHeader() {
  const sortAttr = key => state.sortKey === key ? (state.sortDir === 'asc' ? 'ascending' : 'descending') : 'none';
  return `<div class="track track-header" role="row">
    <div class="track-head-index">#</div>
    <button type="button" class="track-head-btn ${state.sortKey==='title'?'active':''}" data-sort-key="title" aria-sort="${sortAttr('title')}" aria-label="Название, сортировка">Название<span class="sort-arrow">${state.sortKey==='title'?(state.sortDir==='asc'?'↑':'↓'):''}</span></button>
    <button type="button" class="track-head-btn ${state.sortKey==='album'?'active':''}" data-sort-key="album" aria-sort="${sortAttr('album')}" aria-label="Альбом, сортировка">Альбом<span class="sort-arrow">${state.sortKey==='album'?(state.sortDir==='asc'?'↑':'↓'):''}</span></button>
    <button type="button" class="track-head-btn ${state.sortKey==='addedAt'?'active':''}" data-sort-key="addedAt" aria-sort="${sortAttr('addedAt')}" aria-label="Дата добавления, сортировка">Дата добавления<span class="sort-arrow">${state.sortKey==='addedAt'?(state.sortDir==='asc'?'↑':'↓'):''}</span></button>
    <button type="button" class="track-head-btn duration-head ${state.sortKey==='duration'?'active':''}" data-sort-key="duration" aria-sort="${sortAttr('duration')}" aria-label="Длительность, сортировка" title="Сортировать по длительности"><span class="duration-label"><svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="8"/><path d="M12 8v5l3 2"/></svg></span><span class="sort-arrow">${state.sortKey==='duration'?(state.sortDir==='asc'?'↑':'↓'):''}</span></button>
    <div></div>
  </div>`;
}
function newTrackRow(track, index, context = {}) {
  const inPlaylist = !!context.playlistId;
  const playAction = '';
  const action = inPlaylist
    ? `${playAction}<button class="track-delete" data-remove-playlist="${esc(context.playlistId)}" data-remove-track="${esc(track.id)}" title="Убрать из плейлиста">${uiIcon('trash')}</button>`
    : `${playAction}<button class="track-delete" data-delete="${esc(track.id)}" title="Удалить из библиотеки">${uiIcon('trash')}</button>`;
  const source = context.playbackSource || (context.playlistId ? context.playlistId : 'library');
  const isPlaying = currentTrack()?.id === track.id && !audio.paused;
  const selected = state.selectedTrackIds.has(track.id);
  return `<div class="track ${isPlaying ? 'is-playing' : ''} ${selected ? 'selected' : ''}" data-id="${esc(track.id)}" data-playback-source="${esc(source)}" draggable="true">
    <div class="track-num"><span class="track-index">${index + 1}</span><span class="playing-eq" aria-hidden="true"><i></i><i></i><i></i></span></div>
    <div class="track-title"><div class="row-cover">${coverHtml(track.cover,'',track.remoteCover || '')}${track.cover||track.remoteCover?'':uiIcon('music')}</div><div class="track-copy"><b>${esc(track.title)}</b><small>${esc(track.artist || 'Неизвестный исполнитель')}</small></div></div>
    <div class="track-album">${esc(track.album || 'Локальная библиотека')}</div>
    <div class="track-added">${fmtDate(track.addedAt)}</div>
    <div class="track-duration">${track.duration ? fmtTime(track.duration) : '—'}</div>
    <div class="track-actions"><button class="track-refresh" data-refresh="${esc(track.id)}" title="Обновить метаданные">${uiIcon('refresh')}</button><button class="track-menu" data-menu="${esc(track.id)}" title="Добавить в плейлист">${uiIcon('more')}</button>${action}</div>
  </div>`;
}
function sortTracks(list) {
  const dir = state.sortDir === 'asc' ? 1 : -1;
  return [...list].sort((a,b)=>{
    let av, bv;
    if(state.sortKey==='title'){ if(!a._sortTitle) rebuildTrackSearchIndex(a); if(!b._sortTitle) rebuildTrackSearchIndex(b); av=a._sortTitle; bv=b._sortTitle; }
    else if(state.sortKey==='album'){ if(!a._sortAlbum) rebuildTrackSearchIndex(a); if(!b._sortAlbum) rebuildTrackSearchIndex(b); av=a._sortAlbum; bv=b._sortAlbum; }
    else if(state.sortKey==='duration'){ av=Number(a.duration)||0; bv=Number(b.duration)||0; }
    else { av=Number(a.addedAt)||0; bv=Number(b.addedAt)||0; }
    if(av<bv) return -1*dir; if(av>bv) return 1*dir; return sortCollator.compare(a.id||'', b.id||'')*dir;
  });
}
function playLibrary() {
  const tracks = state.search ? filterLibrary(state.search) : state.library;
  if (!tracks.length) { toast('В библиотеке нет треков'); return; }
  const index = state.shuffle ? Math.floor(Math.random() * tracks.length) : 0;
  startPlayback(tracks, index, 'library');
}
const VIRTUAL_ROW_HEIGHTS = { compact: 46, normal: 58, comfortable: 70 };
// Высота виртуальной строки должна совпадать с CSS (features.css), иначе
// «Плотность интерфейса» не меняет число треков на экране.
function virtualRowHeight() { return VIRTUAL_ROW_HEIGHTS[state.settings?.uiDensity] || VIRTUAL_ROW_HEIGHTS.normal; }
const virtualTables = new Map();
function renderVirtualTable(container, list, context = {}) {
  const header = trackHeader();
  const emptyText = 'Ничего не найдено. Измените запрос или добавьте музыку в библиотеку.';
  // Список перерисовывается при выборе трека, обновлении метаданных и смене
  // статуса воспроизведения. Без сохранения scrollTop пользователя каждый раз
  // выбрасывало бы в начало списка.
  const previousScrollTop = container.querySelector('.virtual-scroll')?.scrollTop || 0;
  if (!list.length) { container.innerHTML = header + `<div class=\"empty\">${emptyText}</div>`; return; }
  container.innerHTML = `${header}<div class=\"virtual-scroll\"><div class=\"virtual-spacer\"></div><div class=\"virtual-content\"></div></div>`;
  const scroller = container.querySelector('.virtual-scroll');
  const spacer = container.querySelector('.virtual-spacer');
  const content = container.querySelector('.virtual-content');
  const rowHeight = virtualRowHeight();
  spacer.style.height = `${list.length * rowHeight}px`;
  if (previousScrollTop > 0) scroller.scrollTop = previousScrollTop;
  const key = container.id;
  const model = { list, context, scroller, content, renderQueued: false };
  virtualTables.set(key, model);
  const renderWindow = () => {
    const scrollTop = scroller.scrollTop;
    const viewport = scroller.clientHeight || 500;
    const start = Math.max(0, Math.floor(scrollTop / rowHeight) - 8);
    const end = Math.min(list.length, Math.ceil((scrollTop + viewport) / rowHeight) + 8);
    const html = list.slice(start, end).map((t, i) => {
      const row = newTrackRow(t, start + i, context);
      return row.replace('<div class=\"track ', `<div class=\"track virtual-row `).replace('draggable=\"true\"', `draggable=\"true\" style=\"top:${(start+i)*rowHeight}px\"`);
    }).join('');
    content.innerHTML = html;
    bindTrackActions(`#${key} .virtual-content`);
  };
  const onScroll = () => { if (model.renderQueued) return; model.renderQueued=true; requestAnimationFrame(()=>{ model.renderQueued=false; renderWindow(); }); };
  scroller.addEventListener('scroll', onScroll, { passive:true });
  model.renderWindow = renderWindow;
  model.onScroll = onScroll;
  renderWindow();
  bindSortHeaders(`#${key}`);
}
function albumKey(track){ const artist=normalizeSearchText(track?.albumArtist||track?.artist||''); const album=normalizeSearchText(track?.album||''); return album?`${artist}::${album}`:''; }
function getAlbums(query=''){ const groups=new Map(),needle=normalizeSearchText(query); for(const t of state.library){const key=albumKey(t); if(!key)continue; if(needle&&! [t.album,t.albumArtist,t.artist].some(v=>normalizeSearchText(v||'').includes(needle)))continue; if(!groups.has(key))groups.set(key,{key,album:t.album||'Локальная библиотека',artist:t.albumArtist||t.artist||'Неизвестный исполнитель',year:Number(t.year)||0,cover:t.cover||'',remoteCover:t.remoteCover||'',tracks:[]}); const g=groups.get(key); g.tracks.push(t); if(!g.cover&&t.cover)g.cover=t.cover; if(!g.remoteCover&&t.remoteCover)g.remoteCover=t.remoteCover; if(!g.year&&t.year)g.year=Number(t.year)||0;} return [...groups.values()].sort((a,b)=>sortCollator.compare(a.artist,b.artist)||sortCollator.compare(a.album,b.album)); }
function sortedAlbumTracks(album){ return [...album.tracks].sort((a,b)=>{const an=Number(a.trackNo)||9999,bn=Number(b.trackNo)||9999;return an!==bn?an-bn:sortCollator.compare(a.title||'',b.title||'');}); }
function albumCard(album){return `<article class="album-card" data-album-key="${esc(album.key)}" tabindex="0"><div class="album-cover">${coverHtml(album.cover,'',album.remoteCover||'')||uiIcon('music')}</div><div class="album-card-copy"><b>${esc(album.album)}</b><small>${esc(album.artist)}</small><span>${fmtCount(album.tracks.length,'трек','трека','треков')}${album.year?` · ${album.year}`:''}</span></div></article>`;}
function renderAlbums(){
  const grid=$('#albumGrid'),detail=$('#albumDetail');
  if(!grid||!detail)return;
  const all=getAlbums(''),albums=getAlbums(state.search),summary=$('#albumBrowserSummary');
  if(summary)summary.textContent=state.search?`${fmtCount(albums.length,'альбом','альбома','альбомов')} · поиск «${state.search}»`:`${fmtCount(albums.length,'альбом','альбома','альбомов')}`;
  if(state.currentAlbum){
    const albumIndex=all.findIndex(a=>a.key===state.currentAlbum),album=albumIndex>=0?all[albumIndex]:null;
    if(album){
      const tracks=sortedAlbumTracks(album),prev=albumIndex>0?all[albumIndex-1]:null,nextAlbum=albumIndex<all.length-1?all[albumIndex+1]:null;
      grid.hidden=true; detail.hidden=false;
      detail.innerHTML=`<div class="album-detail-head"><div class="album-detail-toolbar"><button type="button" class="secondary small-btn" id="albumBackBtn">${uiIcon('chevron')} Все альбомы</button><div class="album-nav-actions"><button type="button" class="secondary icon-text-btn" id="albumPrevBtn" ${prev?'':'disabled'} aria-label="Предыдущий альбом">← Предыдущий</button><button type="button" class="secondary icon-text-btn" id="albumNextBtn" ${nextAlbum?'':'disabled'} aria-label="Следующий альбом">Следующий →</button></div></div><div class="album-detail-main"><div class="album-detail-cover">${coverHtml(album.cover,'',album.remoteCover||'')||uiIcon('music')}</div><div><div class="eyebrow">АЛЬБОМ ${albumIndex+1} ИЗ ${all.length}</div><h2>${esc(album.album)}</h2><p>${esc(album.artist)}${album.year?` · ${album.year}`:''} · ${fmtCount(tracks.length,'трек','трека','треков')}</p><div class="page-actions"><button type="button" class="primary" id="albumPlayBtn">${uiIcon('play')} Воспроизвести</button><button type="button" class="secondary" id="albumShuffleBtn">${uiIcon('shuffle')} Перемешать</button></div></div></div></div><div id="albumTrackTable" class="track-table"></div>`;
      $('#albumBackBtn')?.addEventListener('click',()=>{state.currentAlbum=null;renderAlbums();});
      $('#albumPrevBtn')?.addEventListener('click',()=>{if(prev){state.currentAlbum=prev.key;renderAlbums();}});
      $('#albumNextBtn')?.addEventListener('click',()=>{if(nextAlbum){state.currentAlbum=nextAlbum.key;renderAlbums();}});
      $('#albumPlayBtn')?.addEventListener('click',()=>playCollection(tracks,'library'));
      $('#albumShuffleBtn')?.addEventListener('click',()=>{const previousShuffle=state.shuffle;state.shuffle=true;playCollection(tracks,'library');state.shuffle=previousShuffle;});
      renderVirtualTable($('#albumTrackTable'),tracks,{playbackSource:'library'});
      return;
    }
    state.currentAlbum=null;
  }
  detail.hidden=true; grid.hidden=false;
  grid.innerHTML=albums.length?albums.map(albumCard).join(''):'<div class="empty album-empty">Альбомов не найдено.</div>';
  $$( '#albumGrid [data-album-key]' ).forEach(card=>{
    const open=()=>{state.currentAlbum=card.dataset.albumKey;renderAlbums();};
    card.addEventListener('click',open);
    card.addEventListener('dblclick',()=>{const album=all.find(a=>a.key===card.dataset.albumKey);if(album)playCollection(sortedAlbumTracks(album),'library');});
    card.addEventListener('keydown',e=>{if(e.key==='Enter'){e.preventDefault();open();}else if(e.key===' '){e.preventDefault();const album=all.find(a=>a.key===card.dataset.albumKey);if(album)playCollection(sortedAlbumTracks(album),'library');}});
  });
}
function renderLibrarySelectionBar(){
  const btn=$('#bulkEditBtn');
  if(!btn)return;
  const count=state.selectedTrackIds.size;
  btn.hidden=count===0;
  btn.textContent=count?`Изменить выбранные (${count})`:'Изменить выбранные';
}
function renderLibrary() {
  if(state.selectedCleanupRevision!==state.libraryRevision){for(const id of [...state.selectedTrackIds])if(!state.trackById.has(id))state.selectedTrackIds.delete(id);state.selectedCleanupRevision=state.libraryRevision;}
  const list=getSortedVisibleTracks(), albumCount=getAlbums('').length;
  $('#librarySub').textContent=`${fmtCount(state.library.length,'трек','трека','треков')} · ${fmtCount(albumCount,'альбом','альбома','альбомов')}`;
  $('#librarySummary').textContent=state.search?`по запросу «${state.search}»`:''; $('#trackCountSide').textContent=String(state.library.length); $('#trackCountSide').title=`Общее количество треков: ${state.library.length}`;
  $('#trackModePanel')?.toggleAttribute('hidden',state.libraryMode!=='tracks'); $('#albumModePanel')?.toggleAttribute('hidden',state.libraryMode!=='albums'); $$('#libraryView [data-library-mode]').forEach(btn=>btn.classList.toggle('active',btn.dataset.libraryMode===state.libraryMode));
  if(state.libraryMode==='albums')renderAlbums(); else {renderVirtualTable($('#trackTable'),list);renderLibrarySelectionBar();}
}
function bindSortHeaders(root) {
  $$(root + ' [data-sort-key]').forEach(btn => btn.addEventListener('click', e => {
    e.preventDefault();
    const key = btn.dataset.sortKey;
    if (state.sortKey === key) state.sortDir = state.sortDir === 'asc' ? 'desc' : 'asc';
    else { state.sortKey = key; state.sortDir = key === 'addedAt' ? 'desc' : 'asc'; }
    renderLibrary();
    if (state.currentView === 'playlists' && state.currentPlaylist) renderPlaylistDetail();
  }));
}
function bindTrackActions(root) {
  $$(root + ' [data-id]').forEach(row => {
    row.addEventListener('click', e => {
      if ((e.ctrlKey || e.metaKey) && row.closest('#trackTable')) {
        e.preventDefault();
        const id=row.dataset.id;
        if(state.selectedTrackIds.has(id)) state.selectedTrackIds.delete(id); else state.selectedTrackIds.add(id);
        renderLibrarySelectionBar(); renderVirtualTable(document.querySelector('#trackTable'), getSortedVisibleTracks());
      }
    });
    row.addEventListener('dblclick', () => playTrackById(row.dataset.id, row.dataset.playbackSource || 'library'));
    row.addEventListener('dragstart', e => { e.dataTransfer.setData('text/plain', row.dataset.id); e.dataTransfer.effectAllowed='copy'; row.classList.add('dragging'); });
    row.addEventListener('dragend', () => row.classList.remove('dragging'));
  });
  $$(root + ' [data-menu]').forEach(btn => btn.addEventListener('click', e => { e.stopPropagation(); openTrackMenu(btn.dataset.menu, btn); }));
  $$(root + ' [data-refresh]').forEach(btn => btn.addEventListener('click', e => { e.stopPropagation(); refreshTrackMetadata(btn.dataset.refresh); }));
  $$(root + ' [data-play-track]').forEach(btn => btn.addEventListener('click', e => { e.stopPropagation(); const source=btn.dataset.playSource || 'library'; playTrackById(btn.dataset.playTrack, source); }));
  $$(root + ' [data-delete]').forEach(btn => btn.addEventListener('click', e => { e.stopPropagation(); removeFromLibrary(btn.dataset.delete); }));
  $$(root + ' [data-remove-playlist]').forEach(btn => btn.addEventListener('click', e => { e.stopPropagation(); removeFromPlaylist(btn.dataset.removePlaylist, btn.dataset.removeTrack); }));
}

function setSearchMode(mode){
  state.searchMode = mode === 'online' ? 'online' : 'local';
  localStorage.setItem('localify.searchMode', state.searchMode);
  updateSearchModeUI();
  closeSearchSuggestions();
  if(state.searchMode === 'online' && state.search.trim()) void runOnlineSearch(state.search, false);
  else if(state.searchMode === 'local') { if(state.search.trim()) setView('library'); else renderLibrary(); }
}
function updateSearchModeUI(){
  const local=$('#searchModeLocal'), online=$('#searchModeOnline');
  local?.classList.toggle('active',state.searchMode==='local');
  online?.classList.toggle('active',state.searchMode==='online');
  if(local) local.title='Искать в моей музыке';
  if(online) online.title='Искать онлайн через yt-dlp';
  const input=$('#search');
  if(input) input.placeholder=state.searchMode==='online'?'Найти трек или исполнителя онлайн…':'Что хотите послушать?';
}
function renderSearchSuggestions(){
  const box = $('#searchSuggestions');
  if (!box) return;
  const q = state.search.trim();
  if (!q) { closeSearchSuggestions(); return; }
  if(state.searchMode === 'online'){
    box.innerHTML='<div class="search-group-label">ОНЛАЙН</div><div class="search-empty">Нажмите Enter, чтобы искать на YouTube через yt-dlp</div>';
    box.hidden=false; state.searchSuggestionsOpen=true; return;
  }
  const tracks = searchLibrary(q, 7);
  const artists = [...new Set(tracks.map(t => t.artist).filter(Boolean))].slice(0,3);
  const albums = [...new Set(tracks.map(t => t.album).filter(Boolean))].slice(0,3);
  const chunks = [];
  if (tracks.length) chunks.push(`<div class="search-group-label">Треки</div>${tracks.map(t=>`<button type="button" class="search-result" data-search-track="${esc(t.id)}"><span class="search-result-cover">${coverHtml(t.cover,'',t.remoteCover||'')}${t.cover||t.remoteCover?'':uiIcon('music')}</span><span><b>${esc(t.title)}</b><small>${esc(t.artist||'Неизвестный исполнитель')}</small></span></button>`).join('')}`);
  if (artists.length) chunks.push(`<div class="search-group-label">Исполнители</div>${artists.map(a=>`<button type="button" class="search-chip" data-search-value="${esc(a)}">${esc(a)}</button>`).join('')}`);
  if (albums.length) chunks.push(`<div class="search-group-label">Альбомы</div>${albums.map(a=>`<button type="button" class="search-chip" data-search-value="${esc(a)}">${esc(a)}</button>`).join('')}`);
  box.innerHTML = chunks.length ? chunks.join('') : '<div class="search-empty">Ничего не найдено</div>';
  box.hidden = false; state.searchSuggestionsOpen=true;
  $$('#searchSuggestions [data-search-track]').forEach(btn => btn.addEventListener('click', () => { closeSearchSuggestions(); setView('library'); playTrackById(btn.dataset.searchTrack,'library'); }));
  $$('#searchSuggestions [data-search-value]').forEach(btn => btn.addEventListener('click', () => { $('#search').value=btn.dataset.searchValue; state.search=btn.dataset.searchValue; closeSearchSuggestions(); setView('library'); }));
}
async function runOnlineSearch(query=state.search, openView=true){
  const q=String(query||'').trim(); if(!q) return [];
  // Токен запроса: медленный старый ответ не должен перезаписывать результаты
  // более нового поиска (status-строка уже показывает новый запрос).
  const token=(state.onlineSearchToken=(state.onlineSearchToken||0)+1);
  state.search=q; state.onlineSearchLoading=true; state.onlineSearchResults=[];
  if(openView && state.currentView!=='onlineSearch') setView('onlineSearch'); else renderOnlineSearch();
  try{
    const cacheKey=`${q.toLocaleLowerCase()}::12`;
    const cached=getOnlineCache(cacheKey);
    if(cached && Date.now()-cached.at<5*60*1000){
      if(token===state.onlineSearchToken) state.onlineSearchResults=filterOnlineResults(cached.results);
      return state.onlineSearchResults;
    }
    const results=await window.localify.providers.onlineSearch({query:q,limit:12,localLibrary:state.library.map(t=>({title:t.title,artist:t.artist,provider:t.provider,providerId:t.providerId}))});
    if(token!==state.onlineSearchToken) return state.onlineSearchResults;
    const filtered=filterOnlineResults(results||[]);
    setOnlineCache(cacheKey,{at:Date.now(),results:filtered});
    state.onlineSearchResults=filtered;
    return state.onlineSearchResults;
  }catch(err){
    if(token===state.onlineSearchToken){ console.error(err); toast(err?.message||'Не удалось выполнить онлайн-поиск'); }
    return [];
  }
  finally{ if(token===state.onlineSearchToken){ state.onlineSearchLoading=false; renderOnlineSearch(); } }
}
function renderOnlineSearch(){
  const box=$('#onlineSearchResults'); if(!box) return;
  const q=state.search.trim();
  const status=$('#onlineSearchStatus');
  if(status) status.textContent=state.onlineSearchLoading ? (window.__LOCALIFY_ANDROID__ ? `Ищу музыкальные превью для «${q}»…` : `Ищу «${q}» на YouTube…`) : (q ? `Результаты для «${q}»` : 'Введите запрос в поиске выше');
  if(state.onlineSearchLoading){ box.innerHTML=`<div class="empty online-loading">${window.__LOCALIFY_ANDROID__?'Поиск музыкальных превью…':'Поиск через yt-dlp…'}</div>`; return; }
  const list=state.onlineSearchResults||[];
  box.innerHTML=list.length ? list.map((c,i)=>`<article class="online-card"><div class="online-cover">${coverHtml(c.cover) || uiIcon('play')}</div><div class="online-copy"><div class="remote-provider">${c.provider==='itunes'?'iTunes Preview':'YouTube'}</div><h3>${esc(c.title)}</h3><p>${esc(c.artist)}${c.duration?` · ${fmtTime(c.duration)}`:''}</p><div class="library-match">${esc(libraryMatchLabel(c))}</div><small>${esc(c.sourceUrl||'')}</small><div class="remote-actions"><button type="button" class="primary small-btn" data-online-play="${i}">${uiIcon('play')} Слушать</button><button type="button" class="secondary small-btn" data-online-download="${i}" data-download-track="${esc(downloadKey(c))}">${uiIcon('download')} Скачать</button><button type="button" class="secondary small-btn" data-online-source="${i}">${uiIcon('external')} ${c.provider==='itunes'?'Открыть страницу':'Открыть YouTube'}</button></div></div></article>`).join('') : `<div class="empty">${q?'Ничего не найдено. Проверьте yt-dlp и интернет-соединение.':'Введите запрос для онлайн-поиска.'}</div>`;
  box.onclick=async e=>{
    const btn=e.target.closest('[data-online-play],[data-online-download],[data-online-source]'); if(!btn)return;
    const i=Number(btn.dataset.onlinePlay??btn.dataset.onlineDownload??btn.dataset.onlineSource); const track=state.onlineSearchResults[i]; if(!track)return;
    if(btn.dataset.onlinePlay!==undefined) return playRemoteTrack(track);
    if(btn.dataset.onlineDownload!==undefined) return downloadRecommendation(track);
    try{ await window.localify.providers.openSource(track.sourceUrl); }catch(err){ console.error(err); toast('Не удалось открыть YouTube'); }
  };
}
function closeSearchSuggestions(){ const box=$('#searchSuggestions'); if(box){ box.hidden=true; state.searchSuggestionsOpen=false; } }
function updatePlaybackProgress(){
  const duration = Number(audio.duration)||0; const current = Number(audio.currentTime)||0; const pct = duration ? current/duration*100 : 0;
  for (const [inputId, elapsedId, durationId] of [['seekbar','elapsed','duration']]) {
    const input=$(`#${inputId}`), elapsed=$(`#${elapsedId}`), dur=$(`#${durationId}`);
    if(input){ input.value=String(pct); input.style.setProperty('--value',`${pct}%`); input.style.setProperty('--seek-progress',`${pct}%`); }
    if(elapsed) elapsed.textContent=fmtTime(current);
    if(dur) dur.textContent=fmtTime(duration);
  }
}
function addHistory(track){
  if(!track) return;
  const entry={ id: track.id || `${track.provider||'local'}:${track.providerId||track.title}`, playedAt: Date.now(), title:track.title||'', artist:track.artist||'', album:track.album||'', cover:track.cover||'', remoteCover:track.remoteCover||'', provider:track.provider||'', providerId:track.providerId||'', streamUrl:track.streamUrl||'', sourceUrl:track.sourceUrl||'' };
  state.history=[entry,...state.history].slice(0,500);
  localStorage.setItem('localify.history',JSON.stringify(state.history));
}
function historyDayLabel(ts){ const d=new Date(ts), n=new Date(), y=new Date(Date.now()-86400000); const same=(a,b)=>a.getFullYear()===b.getFullYear()&&a.getMonth()===b.getMonth()&&a.getDate()===b.getDate(); if(same(d,n)) return 'Сегодня'; if(same(d,y)) return 'Вчера'; return d.toLocaleDateString('ru-RU',{day:'2-digit',month:'long',year:'numeric'}); }
function libraryMatchLabel(track){
  const title=normalizeSearchText(track?.title||'');
  const artist=normalizeSearchText(track?.artist||'');
  if(!title) return '';
  const exact=state.library.find(t=>!t.provider && normalizeSearchText(t.title||'')===title && (!artist || normalizeSearchText(t.artist||'')===artist));
  if(exact) return '✓ Есть в моей музыке';
  const similar=state.library.find(t=>!t.provider && (normalizeSearchText(t.title||'')===title || (artist && normalizeSearchText(t.artist||'')===artist && (normalizeSearchText(t.title||'').includes(title)||title.includes(normalizeSearchText(t.title||''))))));
  return similar ? '≈ Есть похожий трек в моей музыке' : 'Не найдено в моей музыке';
}
function duplicateIdentity(track){const artist=normalizeSearchText(track?.artist||''),title=normalizeSearchText(track?.title||'');return title?`${artist}::${title}`:'';}
function duplicateQuality(track){const ext=String(track?.container||track?.path||track?.sourcePath||'').split('.').pop().toLowerCase();const lossless=track?.lossless===true||['flac','wav','alac','aiff','ape','wv'].includes(ext);const bitrate=Number(track?.bitrate)||0,sampleRate=Number(track?.sampleRate)||0;return{lossless,bitrate,sampleRate,format:ext||'audio',score:(lossless?100000:0)+Math.min(bitrate,1500)*10+sampleRate/10};}
function getDuplicateGroups(){const groups=new Map();for(const track of state.library){if(!track||track.provider)continue;const key=duplicateIdentity(track);if(!key)continue;if(!groups.has(key))groups.set(key,[]);groups.get(key).push(track);}return [...groups.values()].filter(items=>{if(items.length<2)return false;const ds=items.map(t=>Number(t.duration)).filter(v=>Number.isFinite(v)&&v>0);return ds.length<2||Math.max(...ds)-Math.min(...ds)<=3;}).sort((a,b)=>sortCollator.compare(a[0]?.artist||'',b[0]?.artist||'')||sortCollator.compare(a[0]?.title||'',b[0]?.title||''));}
function duplicateKind(group){const hashes=group.map(t=>state.duplicateHashes.get(normalizeFsPath(t.path||t.sourcePath||''))).filter(Boolean);if(hashes.length>=2&&new Set(hashes).size===1)return'Точная копия · одинаковое содержимое';return group.some(t=>duplicateQuality(t).lossless)&&group.some(t=>!duplicateQuality(t).lossless)?'Одинаковая запись · разные качества':'Вероятный дубликат';}
function renderDuplicateDialog(){const list=$('#duplicatesList'),summary=$('#duplicateSummary');if(!list)return;const groups=getDuplicateGroups(),files=groups.reduce((sum,g)=>sum+g.length,0);if(summary)summary.textContent=groups.length?`Найдено групп: ${groups.length} · файлов: ${files}`:`Дубликатов не найдено · файлов в библиотеке: ${state.library.length}`;if(!groups.length){list.innerHTML='<div class="empty">Потенциальных дубликатов не найдено.</div>';return;}list.innerHTML=groups.map(group=>{const sorted=[...group].sort((a,b)=>duplicateQuality(b).score-duplicateQuality(a).score);return `<section class="duplicate-group"><div class="duplicate-group-head"><div><b>${esc(group[0]?.title||'Без названия')}</b><small>${esc(group[0]?.artist||'Неизвестный исполнитель')} · ${esc(duplicateKind(group))}</small></div><span>${group.length} файла</span></div>${sorted.map((t,i)=>{const q=duplicateQuality(t),filePath=t.path||t.sourcePath||'',label=i===0?'Лучшее качество':`${q.lossless?'Lossless':'Lossy'}${q.bitrate?` · ${Math.round(q.bitrate/1000)} kb/s`:''}`;return `<div class="duplicate-item ${i===0?'duplicate-preferred':''}"><span class="duplicate-cover">${coverHtml(t.cover,'',t.remoteCover||'')||uiIcon('music')}</span><span class="duplicate-copy"><b>${esc(t.title||'Без названия')} ${i===0?'<em>рекомендуемый</em>':''}</b><small title="${esc(filePath)}">${esc(filePath||'Путь к файлу недоступен')}</small></span><span class="duplicate-quality">${esc(label)}</span><span class="duplicate-duration">${fmtTime(Number(t.duration)||0)}</span><button type="button" class="secondary small-btn duplicate-reveal" data-duplicate-path="${esc(filePath)}" ${filePath?'':'disabled'} title="Показать файл в папке">${uiIcon('folder')}</button></div>`;}).join('')}</section>`;}).join('');$$('#duplicatesList [data-duplicate-path]').forEach(btn=>btn.addEventListener('click',async()=>{const filePath=btn.dataset.duplicatePath||'';if(!filePath)return;try{const ok=await window.localify.reveal(filePath);if(ok===false)toast('Файл не найден на диске');}catch{toast('Не удалось открыть расположение файла');}}));enhanceDuplicateGroupActions();}

// Действия над дубликатами: раньше диалог умел только показать файл в папке,
// и «оставить лучший» приходилось делать руками для каждой группы.
function bestDuplicate(group){return [...(group||[])].sort((a,b)=>duplicateQuality(b).score-duplicateQuality(a).score)[0]||null;}

function enhanceDuplicateGroupActions(){
  const groups=getDuplicateGroups();
  $$('#duplicatesList .duplicate-group').forEach((section,index)=>{
    const group=groups[index];
    if(!group||section.querySelector('.duplicate-group-actions'))return;
    const actions=document.createElement('div');
    actions.className='duplicate-group-actions';
    actions.innerHTML=`<button type="button" class="secondary small-btn" data-duplicate-keep="${index}">Оставить лучшее</button><button type="button" class="secondary small-btn" data-duplicate-trash="${index}">Лишние в корзину</button>`;
    (section.querySelector('.duplicate-group-head')||section).appendChild(actions);
    actions.querySelector('[data-duplicate-keep]')?.addEventListener('click',()=>void resolveDuplicateGroup(index,false));
    actions.querySelector('[data-duplicate-trash]')?.addEventListener('click',()=>void resolveDuplicateGroup(index,true));
  });
}

function removeTracksFromLibraryByIds(ids){
  const idSet=new Set((ids||[]).filter(Boolean));
  if(!idSet.size)return 0;
  const removedCurrent=idSet.has(currentTrack()?.id);
  let removed=0;
  state.library=state.library.filter(track=>{
    if(!track||!idSet.has(track.id))return true;
    removed++;
    return false;
  });
  for(const playlist of state.playlists)playlist.trackIds=(playlist.trackIds||[]).filter(id=>!idSet.has(id));
  state.playback=state.playback.filter(t=>!idSet.has(t.id));
  state.playbackBase=state.playbackBase.filter(t=>!idSet.has(t.id));
  if(removedCurrent){state.currentIndex=-1;state.currentRemoteTrack=null;audio.pause();audio.removeAttribute('src');updateNowPlaying(null);}
  repairPlaybackIndex(removedCurrent);
  rebuildLibraryIndexes();
  return removed;
}

async function applyDuplicateResolution(copies,toTrash,summary=''){
  const ids=copies.map(t=>t.id).filter(Boolean);
  const paths=copies.map(t=>t.path||t.sourcePath||'').filter(Boolean);
  let trashFailed=0;
  if(toTrash&&paths.length){
    try{
      const result=await window.localify.deleteFiles?.(paths);
      trashFailed=(result?.failed||[]).length;
    }catch(err){console.error(err);trashFailed=paths.length;}
  }
  removeTracksFromLibraryByIds(ids);
  await save();
  renderAll();
  renderDuplicateDialog();
  const parts=[`Убрано из библиотеки: ${ids.length}`];
  if(toTrash)parts.push(trashFailed?`в корзину не попало файлов: ${trashFailed}`:'файлы отправлены в корзину');
  toast(`${summary||''}${parts.join(' · ')}`.trim());
  return {removed:ids.length,trashFailed};
}

async function resolveDuplicateGroup(index,toTrash){
  const group=getDuplicateGroups()[index];
  if(!group||group.length<2)return;
  const keep=bestDuplicate(group);
  const copies=group.filter(t=>t.id!==keep.id);
  if(!copies.length)return;
  const quality=duplicateQuality(keep);
  const preview=copies.map(t=>t.path||t.sourcePath||t.title||'файл').slice(0,3).join('\n');
  const ok=await showConfirm({
    title:toTrash?'Отправить копии в корзину?':'Убрать копии из библиотеки?',
    text:`Останется «${keep.title||'Без названия'}» (${quality.format}${quality.bitrate?`, ${Math.round(quality.bitrate/1000)} kb/s`:''}). ${toTrash?'Файлы-копии переместятся в корзину Windows.':'Файлы на диске останутся на месте.'}\n\n${preview}${copies.length>3?`\n…и ещё ${copies.length-3}`:''}`
  });
  if(!ok)return;
  await applyDuplicateResolution(copies,toTrash);
}

async function resolveAllDuplicates(toTrash){
  const groups=getDuplicateGroups();
  if(!groups.length){toast('Дубликатов не найдено');return;}
  const copies=[];
  for(const group of groups){
    const keep=bestDuplicate(group);
    for(const track of group)if(track.id!==keep?.id)copies.push(track);
  }
  if(!copies.length){toast('Лишних копий нет');return;}
  const ok=await showConfirm({
    title:toTrash?'Отправить все копии в корзину?':'Убрать все копии из библиотеки?',
    text:`Групп: ${groups.length}, файлов-копий: ${copies.length}. ${toTrash?'Файлы переместятся в корзину Windows, лучший по качеству в каждой группе останется.':'Файлы на диске не тронуты — изменится только библиотека.'}`
  });
  if(!ok)return;
  await applyDuplicateResolution(copies,toTrash,`Групп: ${groups.length}. `);
}
async function prepareDuplicateHashes(){ try { const groups=getDuplicateGroups(); const paths=groups.flat().map(t=>t.path||t.sourcePath||'').filter(Boolean); const hashes=await window.localify.hashLibraryFiles?.(paths); state.duplicateHashes=new Map(Object.entries(hashes||{})); } catch {} renderDuplicateDialog(); }
function openDuplicateDialog(){ $('#duplicatesDialog')?.showModal(); renderDuplicateDialog(); void prepareDuplicateHashes(); }
async function refreshDuplicateDialog(){
  const btn=$('#duplicatesRefresh');
  if(btn) btn.disabled=true;
  try{
    if(state.settings.musicFolder) await syncConfiguredLibrary(true);
    renderAll(); await prepareDuplicateHashes();
    toast('Дубликаты обновлены');
  }catch(err){ console.error(err); renderDuplicateDialog(); toast('Не удалось обновить дубликаты'); }
  finally{ if(btn) btn.disabled=false; }
}

function openHistoryDialog(){ renderHistory(); $('#queueDialog')?.close(); $('#historyDialog').showModal(); }
function renderHistory(){
  const list=$('#historyList'); if(!list) return;
  const groups=new Map(); for(const h of state.history){ const label=historyDayLabel(h.playedAt); if(!groups.has(label))groups.set(label,[]); groups.get(label).push(h); }
  const html=[]; for(const [label,items] of groups){ html.push(`<div class="history-group-label">${esc(label)}</div>`); for(const h of items){ const t=findTrackById(h.id)||h; html.push(`<button type="button" class="history-item" data-history-id="${esc(String(h.id||''))}"><span class="queue-cover">${coverHtml(t.cover,'',t.remoteCover||'')}${t.cover||t.remoteCover?'':uiIcon('music')}</span><span class="queue-copy"><b>${esc(t.title||'Без названия')}</b><small>${esc(t.artist||'Неизвестный исполнитель')}${t.album?` · ${esc(t.album)}`:''}</small></span><span class="history-date">${new Date(h.playedAt).toLocaleTimeString('ru-RU',{hour:'2-digit',minute:'2-digit'})}</span></button>`); } }
  list.innerHTML=html.length?html.join(''):'<div class="empty queue-empty">История пока пуста.</div>';
  $$('#historyList [data-history-id]').forEach(btn=>btn.addEventListener('click',()=>{ const h=state.history.find(x=>String(x.id)===String(btn.dataset.historyId)); if(!h)return; if(h.provider && h.streamUrl) startPlayback([{...h}],0,'history'); else playTrackById(btn.dataset.historyId,'library'); $('#historyDialog').close(); }));
}
async function clearHistory(){
  if(!state.history.length){ toast('История уже пуста'); return; }
  const ok = await showConfirm({ title: 'Очистить историю?', text: `Будет удалено записей: ${state.history.length}. Библиотека и файлы не пострадают.` });
  if(!ok) return;
  state.history=[]; localStorage.removeItem('localify.history'); renderHistory(); toast('История очищена');
}
function reorderQueue(from, to){
  if(from===to || from<0 || to<0 || from>=state.playback.length || to>=state.playback.length) return;
  const currentId=currentTrack()?.id; const [moved]=state.playback.splice(from,1); state.playback.splice(to,0,moved);
  state.playbackBase=[...state.playback]; state.playbackIndex=Math.max(0,state.playback.findIndex(t=>t.id===currentId));
  saveQueueSnapshot(); updateQueueButton(); if($('#queueDialog')?.open) renderQueueDialog();
}
function bindQueueDrag(root){
  const zone=$(root); if(!zone || zone.__queueDragBound) return;
  zone.__queueDragBound=true;
  let dragIndex=-1;
  zone.addEventListener('dragstart', e => {
    const btn=e.target.closest('[data-queue-index]'); if(!btn || !zone.contains(btn)) return;
    btn.draggable=true; dragIndex=Number(btn.dataset.queueIndex); btn.classList.add('dragging');
    if(e.dataTransfer) { e.dataTransfer.setData('text/plain', btn.dataset.queueIndex || ''); e.dataTransfer.effectAllowed='move'; }
  });
  zone.addEventListener('dragend', e => {
    const btn=e.target.closest('[data-queue-index]'); if(btn) btn.classList.remove('dragging');
    zone.querySelectorAll('.queue-drop-target').forEach(el=>el.classList.remove('queue-drop-target'));
    dragIndex=-1;
  });
  zone.addEventListener('dragover', e => {
    const btn=e.target.closest('[data-queue-index]');
    if(dragIndex>=0 && btn && zone.contains(btn)) { e.preventDefault(); btn.classList.add('queue-drop-target'); if(e.dataTransfer) e.dataTransfer.dropEffect='move'; return; }
    if(e.dataTransfer?.types?.includes('text/plain')) { e.preventDefault(); zone.classList.add('queue-drop-zone'); if(e.dataTransfer) e.dataTransfer.dropEffect='copy'; }
  });
  zone.addEventListener('dragleave', e => {
    const btn=e.target.closest('[data-queue-index]'); if(btn) btn.classList.remove('queue-drop-target');
    if(!zone.contains(e.relatedTarget)) zone.classList.remove('queue-drop-zone');
  });
  zone.addEventListener('drop', e => {
    const btn=e.target.closest('[data-queue-index]');
    if(btn && dragIndex>=0 && zone.contains(btn)) {
      e.preventDefault(); btn.classList.remove('queue-drop-target'); zone.classList.remove('queue-drop-zone');
      reorderQueue(dragIndex, Number(btn.dataset.queueIndex)); dragIndex=-1; return;
    }
    e.preventDefault(); zone.classList.remove('queue-drop-zone');
    const id=e.dataTransfer?.getData('text/plain') || '';
    const track=id ? findTrackById(id) : null;
    if(track && dragIndex<0) addTrackToQueue(track);
    dragIndex=-1;
  });
}

function showConfirm({ title, text, confirmLabel = 'Удалить', danger = true }) {
  return new Promise(resolve => {
    const dialog = $('#confirmDialog');
    $('#confirmTitle').textContent = title;
    $('#confirmText').textContent = text;
    $('#confirmOk').textContent = confirmLabel;
    $('#confirmOk').classList.toggle('danger-btn', danger);
    dialog.returnValue = '';
    const cleanup = () => { $('#confirmCancel').onclick = null; $('#confirmOk').onclick = null; };
    $('#confirmCancel').onclick = () => { cleanup(); dialog.close('cancel'); resolve(false); };
    $('#confirmOk').onclick = () => { cleanup(); dialog.close('ok'); resolve(true); };
    dialog.addEventListener('cancel', () => { cleanup(); resolve(false); }, { once:true });
    dialog.showModal();
  });
}

async function removeFromLibrary(id){
  const track = findTrackById(id); if(!track) return;
  const ok = await showConfirm({ title: `Удалить «${track.title}»?`, text: 'Трек исчезнет из библиотеки и плейлистов. Сам аудиофайл на диске останется нетронутым.' });
  if(!ok) return;
  // Удаление играющего трека должно останавливать звук: иначе плеер продолжает
  // играть файл, которого больше нет в библиотеке, а «сейчас играет» уже врёт.
  const wasCurrent = currentTrack()?.id === id;
  const removedIndex = findLibraryIndexById(id);
  state.library = state.library.filter(t => t.id !== id);
  state.playlists.forEach(p => { p.trackIds = (p.trackIds || []).filter(x => x !== id); });
  removeTrackFromIndexes(track);
  reindexLibraryPositionsFrom(removedIndex);
  state.libraryRevision++;
  clearDerivedCaches();
  state.playback = state.playback.filter(t => t.id !== id); state.playbackBase = state.playbackBase.filter(t => t.id !== id);
  if (state.currentIndex > removedIndex) state.currentIndex -= 1;
  else if (state.currentIndex === removedIndex) state.currentIndex = Math.min(removedIndex, state.library.length - 1);
  if (state.currentIndex >= state.library.length) state.currentIndex = state.library.length - 1;
  if (wasCurrent) {
    state.currentIndex = -1;
    state.currentRemoteTrack = null;
    audio.pause();
    audio.removeAttribute('src');
    updateNowPlaying(null);
  }
  repairPlaybackIndex(wasCurrent);
  save(); renderAll(); toast('Трек удалён из библиотеки');
}

async function removeFromPlaylist(playlistId,trackId){
  const p=state.playlists.find(x=>x.id===playlistId),track=findTrackById(trackId);if(!p||!track)return;
  if(usesPhysicalPlaylists()){try{const moved=await window.localify.playlists.moveTrackOut(track.path||track.sourcePath,playlistId);if(moved?.path){const wasPlaying=currentTrack()?.id===track.id&&!audio.paused;track.path=moved.path;track.sourcePath=moved.path;track.url=moved.url||track.url;invalidateTrackSearchIndex(track);touchLibrary({ track });if(wasPlaying){const pos=audio.currentTime||0;audio.src=track.url;audio.currentTime=pos;audio.play().catch(()=>{});}}}catch(err){console.error(err);toast('Не удалось убрать трек из папки');return;}}
  p.trackIds=(p.trackIds||[]).filter(x=>x!==trackId);save();renderAll();if(state.currentPlaylist===playlistId)renderPlaylistDetail();toast(`Убран из «${p.name}»`);
}

async function addTrackToPlaylist(trackId, playlistId) {
  const track = findTrackById(trackId);
  const playlist = findPlaylistById(playlistId);
  if (!track || !playlist) return false;
  playlist.trackIds ||= [];
  if (playlist.trackIds.includes(track.id)) { toast('Трек уже есть в плейлисте'); return false; }
  await moveTrackToPlaylistFolder(trackId, playlistId);
  return true;
}
function addTrackToQueue(track){
  if(!track)return;if(state.playback.some(t=>t.id===track.id)){toast('Трек уже в очереди');return;}state.playback.push(track);if(!state.playbackBase.length)state.playbackBase=[...state.playback];if(state.playbackIndex<0)state.playbackIndex=0;saveQueueSnapshot();updateQueueButton();if($('#queueDialog')?.open)renderQueueDialog();toast('Трек добавлен в очередь');
}
function openTrackMenu(id,anchor){
  const track=findTrackById(id);if(!track)return;document.querySelector('.track-popover')?.remove();const pop=document.createElement('div');pop.className='track-popover track-context-menu';
  const items=[['play','▶  Воспроизвести'],['next','⏭  Воспроизвести следующим'],['queue','＋  Добавить в очередь'],['album','💿  Открыть альбом'],['artist','◉  Показать исполнителя'],['playlist','＋  Добавить в плейлист'],['edit','✎  Редактировать метаданные'],['refresh','↻  Найти метаданные'],['reveal','📁  Показать файл'],['folder','↗  Открыть папку'],['path','⌘  Копировать путь'],['delete','×  Удалить из библиотеки']];
  pop.innerHTML=`<div class="track-popover-title">${esc(track.title)}</div>${items.map(([key,label])=>`<button type="button" data-action="${key}" class="${key==='delete'?'danger-item':''}">${label}</button>`).join('')}`;document.body.appendChild(pop);
  const r=anchor.getBoundingClientRect();pop.style.left=Math.min(window.innerWidth-pop.offsetWidth-12,Math.max(12,r.right-pop.offsetWidth))+'px';pop.style.top=Math.min(window.innerHeight-pop.offsetHeight-12,Math.max(12,r.bottom+6))+'px';
  pop.querySelectorAll('[data-action]').forEach(btn=>btn.addEventListener('click',async()=>{const action=btn.dataset.action;pop.remove();if(action==='play')return playTrackById(track.id,'library');if(action==='next'){if(!state.playback.length)startPlayback([track],0,'library');else{const idx=Math.max(0,state.playbackIndex)+1;state.playback.splice(idx,0,track);if(!state.playbackBase.some(x=>x.id===track.id))state.playbackBase.push(track);saveQueueSnapshot();updateQueueButton();toast('Добавлено следующим');}return;}if(action==='queue')return addTrackToQueue(track);if(action==='album'){const key=albumKey(track);if(key){state.libraryMode='albums';state.currentAlbum=key;setView('library');}return;}if(action==='artist'){state.search=track.albumArtist||track.artist||'';state.libraryMode='tracks';setView('library');$('#search').value=state.search;return;}if(action==='playlist')return openPlaylistChooser(track.id,anchor);if(action==='edit')return openEditTrackDialog(track.id);if(action==='refresh')return refreshTrackMetadata(track.id);if(action==='reveal'){try{const ok=await window.localify.reveal(track.path||track.sourcePath||'');if(ok===false)toast('Файл не найден на диске');}catch{toast('Не удалось показать файл');}return;}if(action==='folder'){try{const ok=await window.localify.openFolderPath(track.path||track.sourcePath||'');if(ok===false)toast('Папка не найдена');}catch{toast('Не удалось открыть папку');}return;}if(action==='path'){try{await navigator.clipboard.writeText(track.path||track.sourcePath||'');toast('Путь скопирован');}catch{toast('Не удалось скопировать путь');}return;}if(action==='delete')return removeFromLibrary(track.id);}));
  setTimeout(()=>{const close=e=>{if(!pop.contains(e.target)&&e.target!==anchor){pop.remove();document.removeEventListener('mousedown',close);}};document.addEventListener('mousedown',close);},0);
}
function openPlaylistChooser(trackId,anchor){if(!state.playlists.length){toast('Сначала создайте плейлист');openPlaylistDialog();return;}document.querySelector('.track-popover')?.remove();const pop=document.createElement('div');pop.className='track-popover';pop.innerHTML=`<div class="track-popover-title">Добавить в плейлист</div>${state.playlists.map(p=>`<button type="button" data-pl="${esc(p.id)}"><span class="popover-cover">${coverHtml(p.cover)}</span><span>${esc(p.name)}</span></button>`).join('')}`;document.body.appendChild(pop);const r=anchor.getBoundingClientRect();pop.style.left=Math.min(window.innerWidth-pop.offsetWidth-12,Math.max(12,r.right-pop.offsetWidth))+'px';pop.style.top=Math.min(window.innerHeight-pop.offsetHeight-12,Math.max(12,r.bottom+6))+'px';pop.querySelectorAll('[data-pl]').forEach(b=>b.addEventListener('click',async()=>{await addTrackToPlaylist(trackId,b.dataset.pl);pop.remove();}));}
function openEditTrackDialog(id){const track=findTrackById(id);if(!track||!$('#editTrackDialog'))return;state.editingTrackId=id;$('#editTrackTitle').value=track.title||'';$('#editTrackArtist').value=track.artist||'';$('#editTrackAlbum').value=track.album||'';$('#editTrackYear').value=track.year||'';$('#editTrackHint').textContent='Изменения сохраняются в библиотеке Crimson; исходные ID3/FLAC-теги файла не перезаписываются.';$('#editTrackDialog').showModal();setTimeout(()=>$('#editTrackTitle').focus(),50);}
async function saveTrackEdits(){const track=findTrackById(state.editingTrackId);if(!track)return;Object.assign(track,{title:$('#editTrackTitle').value.trim()||'Без названия',artist:$('#editTrackArtist').value.trim()||'Неизвестный исполнитель',album:$('#editTrackAlbum').value.trim()||'Локальная библиотека',year:Number($('#editTrackYear').value)||null,metadataSource:'manual',metadataConfidence:1,metadataOverride:true,metadataCheckedAt:Date.now(),metadataStatKey:track._statKey||''});invalidateTrackSearchIndex(track);touchLibrary({track});await save();renderAll();$('#editTrackDialog').close();toast('Метаданные сохранены');}

function openBulkEditDialog(){
  const ids=[...state.selectedTrackIds];
  if(!ids.length){toast('Сначала выберите треки через Ctrl/⌘ + клик');return;}
  $('#bulkEditCount').textContent=`Выбрано треков: ${ids.length}`;
  ['Title','Artist','Album','Year'].forEach(k=>{ const cb=$(`#bulkApply${k}`); const input=$(`#bulk${k}`); if(cb) cb.checked=false; if(input) input.value=''; });
  $('#bulkEditDialog')?.showModal();
}
async function saveBulkEdits(){
  const ids=new Set(state.selectedTrackIds); const tracks=state.library.filter(t=>ids.has(t.id));
  if(!tracks.length)return;
  const fields=[
    ['bulkApplyTitle','bulkTitle','title',v=>v||'Без названия'],
    ['bulkApplyArtist','bulkArtist','artist',v=>v||'Неизвестный исполнитель'],
    ['bulkApplyAlbum','bulkAlbum','album',v=>v||'Локальная библиотека'],
    ['bulkApplyYear','bulkYear','year',v=>v?Number(v):null]
  ];
  for(const [cbId,inputId,key,normalize] of fields){
    if(!$(`#${cbId}`)?.checked)continue;
    const value=normalize($(`#${inputId}`)?.value.trim());
    for(const t of tracks){ t[key]=value; t.metadataSource='manual'; t.metadataConfidence=1; t.metadataOverride=true; t.metadataCheckedAt=Date.now(); t.metadataStatKey=t._statKey||''; invalidateTrackSearchIndex(t); }
  }
  for (const t of tracks) { touchLibrary({ track: t }); }
  await save(); state.selectedTrackIds.clear(); $('#bulkEditDialog')?.close(); renderAll(); toast(`Обновлено треков: ${tracks.length}`);
}

function trackCard(t) { return `<article class="music-card" data-track="${esc(t.id)}"><div class="card-cover">${coverHtml(t.cover,'',t.remoteCover || '')}${t.cover||t.remoteCover?'':uiIcon('music')}</div><h4>${esc(t.title)}</h4><p>${esc(t.artist)}</p></article>`; }
function playlistCard(p) { return `<article class="music-card playlist-card" data-playlist="${esc(p.id)}" data-drop-playlist="${esc(p.id)}" title="Открыть плейлист"><button type="button" class="folder-edit" data-playlist-edit="${esc(p.id)}" aria-label="Настроить плейлист" title="Настроить плейлист">${uiIcon('settings')}</button><div class="card-cover playlist-cover">${coverHtml(p.cover)}${p.cover?'':uiIcon('music')}</div><div class="playlist-card-copy"><h4>${esc(p.name)}</h4><p>${fmtCount((p.trackIds||[]).length,'трек','трека','треков')}</p>${p.folderPath?`<small title="${esc(p.folderPath)}">${esc(p.folderPath)}</small>`:''}</div></article>`; }
function renderPlaylists() {
  $('#playlistGrid').innerHTML = state.playlists.length ? state.playlists.map(playlistCard).join('') : '<div class="empty">Создайте первый плейлист и дайте ему обложку.</div>';
  $$('#playlistGrid [data-playlist-edit]').forEach(btn => btn.addEventListener('click', e => { e.stopPropagation(); void openEditPlaylistDialog(btn.dataset.playlistEdit); }));
  $$('#playlistGrid .music-card').forEach(el => {
    el.addEventListener('click', () => openPlaylist(el.dataset.playlist));
    bindPlaylistDropTarget(el, el.dataset.dropPlaylist);
  });
}
function renderSidebar(){
  const totalEl = $('#trackCountSide');
  if (totalEl) { totalEl.textContent = String(state.library.length); totalEl.title = `Общее количество треков: ${state.library.length}`; }
  setGenreCollapsed(state.genreCollapsed);
  const genreRoot = $('#sidebarGenres');
  if (genreRoot) {
    const counts = new Map();
    for (const t of state.library) {
      const raw = String(t.genre || t.tags?.genre || '').trim();
      const key = normalizeGenreValue(raw);
      if (!key) continue;
      counts.set(key, { name: raw || key, count: (counts.get(key)?.count || 0) + 1 });
    }
    const genreLabels = { 'hip-hop': 'Hip-Hop/Rap', 'electronic': 'Electronic', alternative: 'Alternative', rock: 'Rock', pop: 'Pop', metal: 'Metal', jazz: 'Jazz', classical: 'Classical', music: 'Music' };
    const entries = [...counts.entries()].sort((a,b) => b[1].count - a[1].count || sortCollator.compare(a[1].name, b[1].name));
    const activeAll = !normalizeGenreValue(state.genre);
    genreRoot.innerHTML = `<button type="button" class="genre-item ${activeAll ? 'active' : ''}" data-genre="" title="Вся музыка">${uiIcon('music','genre-svg')}<span class="genre-name">Вся музыка</span><span class="genre-count">${state.library.length}</span></button>` + entries.slice(0, 8).map(([key, info]) => `<button type="button" class="genre-item ${normalizeGenreValue(state.genre) === key ? 'active' : ''}" data-genre="${esc(key)}" title="${esc(genreLabels[key] || info.name)}">${uiIcon('music','genre-svg')}<span class="genre-name">${esc(genreLabels[key] || info.name)}</span><span class="genre-count">${info.count}</span></button>`).join('');
    $$('#sidebarGenres .genre-item').forEach(btn => btn.addEventListener('click', () => { state.genre = normalizeGenreValue(btn.dataset.genre || ''); setView('library'); }));
  }
  $('#sidebarPlaylists').innerHTML = state.playlists.length
    ? state.playlists.slice(0,12).map(p => `<button class="playlist-drop" data-side-playlist="${esc(p.id)}" title="${esc(p.name)}"><span class="side-playlist-cover folder-glyph">${coverHtml(p.cover)}${p.cover?'':'<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 7.5A2.5 2.5 0 0 1 5.5 5H10l2 2h6.5A2.5 2.5 0 0 1 21 9.5V17a2.5 2.5 0 0 1-2 2H5a2.5 2.5 0 0 1-2-2V7.5Z"/></svg>'}</span><span class="side-playlist-name">${esc(p.name)}</span></button>`).join('')
    : '<span class="side-empty">Пока пусто</span>';
  $$('#sidebarPlaylists .playlist-drop').forEach(b => { b.addEventListener('click', () => openPlaylist(b.dataset.sidePlaylist)); bindPlaylistDropTarget(b, b.dataset.sidePlaylist); });
}
async function bindPlaylistDropTarget(el, playlistId){
  el.addEventListener('dragover', e => { e.preventDefault(); el.classList.add('drop-target'); e.dataTransfer.dropEffect = 'copy'; });
  el.addEventListener('dragleave', e => { if (!el.contains(e.relatedTarget)) el.classList.remove('drop-target'); });
  el.addEventListener('drop', async e => {
    e.preventDefault(); el.classList.remove('drop-target');
    const id = e.dataTransfer.getData('text/plain');
    if (id) { moveTrackToPlaylistFolder(id, playlistId); return; }
    const paths = [...(e.dataTransfer.files || [])].map(f => f.path).filter(Boolean);
    if (!paths.length) { toast('Не удалось получить файлы'); return; }
    toast('Добавляю треки…');
    try {
      const p = findPlaylistById(playlistId);
      if (!p) return;
      const sourcePaths=usesPhysicalPlaylists()?await window.localify.playlists.moveExternalFiles(paths,playlistId):paths;
      const tracks=await window.localify.importDroppedFiles(sourcePaths||[]);
      let added = 0;
      for (const t of tracks) {
        const count = await addTracks([t], false);
        const existing = findTrackByPath(t.sourcePath || t.path);
        if(existing){ p.trackIds ||= []; if(!p.trackIds.includes(existing.id)){ p.trackIds.push(existing.id); added++; } } else if(count){ p.trackIds ||= []; p.trackIds.push(t.id); added++; }
      }
      save(); renderAll(); toast(`${added} ${added===1?'трек добавлен':`${fmtCount(added,'трек добавлен','трека добавлено','треков добавлено')}`} в «${p.name}»`);
      if(tracks.length && state.settings.onlineMetadata) scheduleMetadataHydration(true);
    } catch(err) { console.error(err); toast('Не удалось добавить файлы'); }
  });
}

function setupGlobalFileDrop(){const surface=$('.main');if(!surface)return;let depth=0;surface.addEventListener('dragenter',e=>{if([...e.dataTransfer.types].includes('Files')){depth++;surface.classList.add('file-drop-active');}});surface.addEventListener('dragleave',e=>{if([...e.dataTransfer.types].includes('Files')){depth=Math.max(0,depth-1);if(!depth)surface.classList.remove('file-drop-active');}});surface.addEventListener('dragover',e=>{if([...e.dataTransfer.types].includes('Files')){e.preventDefault();e.dataTransfer.dropEffect='copy';}});surface.addEventListener('drop',async e=>{if(![...e.dataTransfer.types].includes('Files'))return;e.preventDefault();depth=0;surface.classList.remove('file-drop-active');const paths=[...(e.dataTransfer.files||[])].map(f=>window.localify.getPathForFile?window.localify.getPathForFile(f):(f.path||'')).filter(Boolean);if(!paths.length)return;try{const tracks=await (window.localify.importDroppedPaths?window.localify.importDroppedPaths(paths):window.localify.importDroppedFiles(paths));const before=state.library.length;await addTracks(tracks);if(state.settings.onlineMetadata)scheduleMetadataHydration(true);toast(`Добавлено: ${Math.max(0,state.library.length-before)} трек.`);}catch(err){console.error(err);toast('Не удалось добавить файлы');}});}

function setMobileSidebarOpen(open) {
  const shouldOpen = !!open;
  if (shouldOpen) document.body.classList.remove('mobile-search-open');
  document.body.classList.toggle('mobile-sidebar-open', shouldOpen);
  const button = $('#mobileNavToggle');
  if (button) { button.setAttribute('aria-expanded', shouldOpen ? 'true' : 'false'); button.setAttribute('aria-label', shouldOpen ? 'Закрыть боковую панель' : 'Открыть боковую панель'); }
}
function closeMobileSidebar() { setMobileSidebarOpen(false); }
function setMobileSearchOpen(open) {
  const shouldOpen = !!open;
  if (shouldOpen) document.body.classList.remove('mobile-sidebar-open');
  document.body.classList.toggle('mobile-search-open', shouldOpen);
  if (shouldOpen) {
    const input = $('#search');
    window.setTimeout(() => { try { input?.focus({ preventScroll: true }); } catch { input?.focus(); } }, 40);
  } else { closeSearchSuggestions(); $('#search')?.blur(); }
}

function applySidebar(){
  document.body.classList.toggle('sidebar-collapsed', !!state.sidebarCollapsed);
  const btn = $('#sidebarToggle');
  if (!btn) return;
  const expanded = !state.sidebarCollapsed;
  btn.setAttribute('aria-label', expanded ? 'Свернуть меню' : 'Развернуть меню');
  btn.setAttribute('aria-expanded', expanded ? 'true' : 'false');
  btn.title = expanded ? 'Свернуть меню' : 'Развернуть меню';
  btn.innerHTML = state.sidebarCollapsed
    ? '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m10 6 6 6-6 6"/></svg>'
    : '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m14 6-6 6 6 6"/></svg>';
}
function toggleSidebar(){ state.sidebarCollapsed=!state.sidebarCollapsed; localStorage.setItem('localify.sidebarCollapsed', state.sidebarCollapsed ? '1':'0'); applySidebar(); }
function renderCurrentView() {
  switch (state.currentView) {
    case 'home': window.renderHome?.(); break;
    case 'library': renderLibrary(); break;
    case 'onlineSearch': renderOnlineSearch(); break;
    case 'radio': renderRadio(); break;
    case 'playlists':
      if (state.currentPlaylist) renderPlaylistDetail(); else renderPlaylists();
      break;
    case 'settings': renderSettings(); break;
  }
}
function renderAll() {
  renderSidebar();
  renderCurrentView();
  updateSearchModeUI();
}

function openPlaylist(id) {
  const p = state.playlists.find(x => x.id === id); if (!p) return;
  state.currentPlaylist = id;
  setView('playlists');
  renderPlaylistDetail();
}

function renderPlaylistDetail(){
  const p = findPlaylistById(state.currentPlaylist); if (!p) return;
  const tracks = sortTracks((p.trackIds||[]).map(id => findTrackById(id)).filter(Boolean));
  $('#playlistGrid').innerHTML = `<div class="playlist-detail"><div class="playlist-detail-head"><div class="playlist-detail-cover">${coverHtml(p.cover)||uiIcon('music')}</div><div><div class="eyebrow">ПЛЕЙЛИСТ</div><h1>${esc(p.name)}</h1><p>${fmtCount(tracks.length,'трек','трека','треков')}</p></div><div class="page-actions"><button class="secondary" id="backToPlaylists">← Плейлисты</button><button class="secondary" id="playlistEdit">Настроить</button><button class="primary" id="playlistPlay">▶ Play</button></div></div><div id="playlistTrackTable" class="track-table"></div></div>`;
  $('#playlistPlay')?.addEventListener('click',()=>playCollection(tracks,p.id));
  $('#playlistEdit')?.addEventListener('click',()=>openEditPlaylistDialog(p.id));
  $('#backToPlaylists')?.addEventListener('click',()=>{state.currentPlaylist=null;renderAll();});
  if (tracks.length) renderVirtualTable($('#playlistTrackTable'), tracks, {playlistId:p.id});
  else $('#playlistTrackTable').innerHTML = trackHeader() + '<div class="empty playlist-drop-empty"><b>Пустой плейлист</b><span>Перетащите сюда трек или файл.</span></div>';
}

function openPlaylistDialog() { state.coverDraft=''; $('#playlistName').value=''; $('#coverPreview').innerHTML='♪'; $('#playlistDialog').showModal(); setTimeout(()=>$('#playlistName').focus(),50); }
async function openEditPlaylistDialog(id){ const p=state.playlists.find(x=>x.id===id); if(!p) return; state.editingPlaylistId=id; state.coverDraft=p.cover||''; if(usesPhysicalPlaylists()) p.folderPath=p.folderPath||await window.localify.playlists.createFolder(p.id,p.name); $('#editPlaylistName').value=p.name||''; $('#editPlaylistCoverPreview').innerHTML=p.cover?coverHtml(p.cover):'♫'; $('#editPlaylistFolderPath').textContent=usesPhysicalPlaylists()?(p.folderPath?`Папка: ${p.folderPath}`:''):'Виртуальный плейлист — файлы не перемещаются'; $('#editPlaylistDialog').showModal(); setTimeout(()=>$('#editPlaylistName').focus(),50); }
async function savePlaylistEdits(){ const p=state.playlists.find(x=>x.id===state.editingPlaylistId); if(!p) return; const name=$('#editPlaylistName').value.trim(); if(!name){toast('Введите название');return} if(usesPhysicalPlaylists()){ const folderPath=await window.localify.playlists.renameFolder(p.id,name); p.folderPath=folderPath||p.folderPath; } p.name=name; p.cover=state.coverDraft||''; rebuildPlaylistIndex(); save(); $('#editPlaylistDialog').close(); renderAll(); if(state.currentPlaylist===p.id) renderPlaylistDetail(); toast('Плейлист обновлён'); }
async function createPlaylist() { const name=$('#playlistName').value.trim(); if(!name){toast('Введите название');return} const p={id:uid('pl'),name,cover:state.coverDraft,trackIds:[]}; p.folderPath=usesPhysicalPlaylists()?await window.localify.playlists.createFolder(p.id,p.name):''; state.playlists.push(p); rebuildPlaylistIndex(); save(); $('#playlistDialog').close(); renderAll(); toast(usesPhysicalPlaylists()?'Плейлист создан':'Виртуальный плейлист создан'); }

async function deletePlaylist(id){
  const p=state.playlists.find(x=>x.id===id);if(!p)return;
  const ok=await showConfirm({title:`Удалить «${p.name}»?`,text:usesPhysicalPlaylists()?'Папка будет удалена, а музыка из неё будет возвращена в корень вашей музыкальной папки.':'Плейлист будет удалён, файлы музыки останутся на месте.',confirmLabel:usesPhysicalPlaylists()?'Удалить папку':'Удалить плейлист'});if(!ok)return;
  if(usesPhysicalPlaylists()){try{const result=await window.localify.playlists.deleteFolder(p.id);for(const move of(result?.moves||[])){const t=findTrackByPath(move.oldPath);if(t){t.path=move.newPath;t.sourcePath=move.newPath;t.url=move.url||t.url;invalidateTrackSearchIndex(t);}}rebuildLibraryIndexes();}catch(err){console.error(err);toast('Не удалось удалить папку плейлиста');return;}}
  state.playlists=state.playlists.filter(x=>x.id!==id); rebuildPlaylistIndex();if(state.currentPlaylist===id)state.currentPlaylist=null;if(state.playbackSource===id){state.playback=[];state.playbackBase=[];state.playbackSource='library';state.playbackIndex=-1;}await save();$('#editPlaylistDialog').close();renderAll();toast('Плейлист удалён');
}

async function moveTrackToPlaylistFolder(trackId,playlistId){
  const track=findTrackById(trackId),p=state.playlists.find(x=>x.id===playlistId);if(!track||!p)return;p.trackIds||=[];if(p.trackIds.includes(track.id)){toast('Трек уже есть в плейлисте');return;}
  if(!usesPhysicalPlaylists()){p.trackIds.push(track.id);await save();renderAll();toast(`Добавлен в «${p.name}»`);return;}
  try{const moved=await window.localify.playlists.moveTrack(track.path||track.sourcePath,playlistId);if(!moved?.path)throw new Error('move failed');const wasPlaying=currentTrack()?.id===track.id&&!audio.paused;const pos=audio.currentTime||0;track.path=moved.path;track.sourcePath=moved.path;track.url=moved.url||track.url;p.trackIds.push(track.id);invalidateTrackSearchIndex(track);indexTrack(track, findLibraryIndexById(track.id));state.libraryRevision++;clearDerivedCaches();if(wasPlaying){audio.src=track.url;audio.currentTime=pos;audio.play().catch(()=>{});}await save();renderAll();toast(`Трек перемещён в «${p.name}»`);}catch(err){console.error(err);toast('Не удалось переместить трек');}
}

function sourceTracks() {
  if (state.playbackSource && state.playbackSource !== 'library') {
    const p = findPlaylistById(state.playbackSource);
    if (p) {
      return (p.trackIds || []).map(id => findTrackById(id)).filter(Boolean);
    }
  }
  return [...state.library];
}
const playbackQueue = new window.LocalifyPlaybackQueue();
function shuffleTracks(tracks, firstId = null) { return window.LocalifyPlaybackQueue.shuffle(tracks, firstId); }
function rebuildPlaybackOrder(keepCurrent = true) {
  const tracks = state.playbackBase.length ? [...state.playbackBase] : sourceTracks();
  const currentId = keepCurrent ? currentTrack()?.id : null;
  const built = playbackQueue.build(tracks, { shuffle: state.shuffle, currentId });
  state.playback = built.items;
  state.playbackIndex = built.index;
  updateQueueButton();
}

// Удаление треков не должно ломать курсор очереди: иначе playbackIndex остаётся
// за пределами массива, next() упирается в конец и «Следующий» перестаёт играть.
function repairPlaybackIndex(removedCurrent = false) {
  if (!state.playback.length) { state.playbackIndex = -1; return; }
  const keepId = currentTrack()?.id || '';
  const kept = keepId ? state.playback.findIndex(t => t.id === keepId) : -1;
  if (kept >= 0) { state.playbackIndex = kept; return; }
  // Текущего трека в очереди больше нет: курсор сбрасываем, чтобы next()
  // начал с первого элемента, а не «застрял» на последнем.
  state.playbackIndex = removedCurrent ? -1 : Math.max(0, Math.min(state.playback.length - 1, state.playbackIndex));
}

function playCollection(tracks, source = 'library') {
  if (!tracks.length) { toast('Нет треков для воспроизведения'); return; }
  const index = state.shuffle ? Math.floor(Math.random() * tracks.length) : 0;
  startPlayback(tracks, index, source);
}
function startPlayback(tracks, index = 0, source = 'library') {
  if (!tracks.length) return;
  state.playbackSource = source;
  state.playbackBase = [...tracks];
  const chosen = tracks[index] || tracks[0];
  const built = playbackQueue.build(tracks, { shuffle: state.shuffle, currentId: chosen.id });
  state.playback = built.items;
  state.playbackIndex = built.index;
  updateQueueButton();
  playCurrentPlayback();
}
function playTrackById(id, source = 'library') {
  const fallback = findTrackById(id);
  if (!fallback) return;
  if (source === 'library' && !state.search) {
    const idx = findLibraryIndexById(id);
    if (idx >= 0) return startPlayback(state.library, idx, source);
    return;
  }
  const tracks = source === 'library' ? filterLibrary(state.search) : sourceTracks();
  const idx = tracks.findIndex(t => t.id === id);
  startPlayback(idx >= 0 ? tracks : [fallback], idx >= 0 ? idx : 0, source);
}
async function playCurrentPlayback() {
  logLocalify('playback', {index: state.playbackIndex, id: currentTrack()?.id});
  const track=state.playback[state.playbackIndex];
  if(!track) return;
  const token=uid('play');
  state._playToken=token;
  // Отменяем отложенное восстановление позиции из сессии прошлого запуска.
  state.playbackRestoreToken=(state.playbackRestoreToken||0)+1;
  state.currentIndex=findLibraryIndexById(track.id);
  state.currentRemoteTrack=state.currentIndex>=0?null:track;

  if(track.provider==='youtube' && !track.streamUrl){
    syncPlayButton(false);
    updateNowPlaying(track);
    try{
      await ensureRemoteStream(track);
      if(state._playToken!==token || currentTrack()!==track) return;
    }catch{
      if(state._playToken===token && currentTrack()===track){
        toast('Онлайн-трек временно недоступен. Продолжаем воспроизведение.');
        state.currentRemoteTrack=null;
        void next();
      }
      return;
    }
  }

  const source=track.url||track.streamUrl||'';
  if(!source){ toast('У трека нет доступного потока'); void next(); return; }
  audio.src=source;
  audio.currentTime=0;
  state.userVolume=Number.isFinite(state.userVolume)?state.userVolume:audio.volume;
  audio.volume=state.userVolume;
  updateNowPlaying(track);
  window.localify.playback.nowPlaying({title:track.title||'Без названия',artist:track.artist||'',album:track.album||''});
  const p=audio.play();
  if(p?.then) p.then(()=>syncPlayButton(true)).catch(()=>syncPlayButton(false));
  markTrackPlayed(track);
  addHistory(track);
  saveQueueSnapshot();
  refreshPlayingStates();
  updateDownloadButton();
  updateQueueButton();
  if($('#queueDialog')?.open) renderQueueDialog();
}
function saveQueueSnapshot(){
  state.queueRevision++;
  try{ localStorage.setItem('localify.queue',JSON.stringify({playback:state.playback,playbackBase:state.playbackBase,playbackIndex:state.playbackIndex,mode:state.shuffleMode,repeat:!!state.repeat,source:state.playbackSource,savedAt:Date.now()})); }catch{}
  persistPlaybackSession();
}
function restoreQueueSnapshot(){
  try{ const raw=JSON.parse(localStorage.getItem('localify.queue')||'null'); if(!raw?.playback?.length || Date.now()-Number(raw.savedAt)>30*86400000) return; state.playback=raw.playback.map(t=>findTrackById(t.id)||t).filter(Boolean); state.playbackBase=(raw.playbackBase||raw.playback).map(t=>findTrackById(t.id)||t).filter(Boolean); state.playbackIndex=Math.max(0,Math.min(state.playback.length-1,Number(raw.playbackIndex)||0)); state.playbackSource=raw.source||'library'; state.repeat=!!raw.repeat; state.queueHydrated={mode:['normal','off'].includes(raw.mode)?raw.mode:'off'}; }catch{}
}
function restorePersistentPlaybackQueue(){
  const saved=state.savedPlayback; if(!saved?.queueIds?.length) return;
  const resolveIds=ids=>ids.map(id=>findTrackById(id)).filter(Boolean); const playback=resolveIds(saved.queueIds); const base=resolveIds(saved.queueBaseIds||saved.queueIds); if(!playback.length)return;
  state.playback=playback; state.playbackBase=base.length?base:[...playback]; state.playbackIndex=Math.max(0,Math.min(state.playback.length-1,Number(saved.queueIndex)||0));
  state.playbackSource=saved.playbackSource||'library'; state.shuffleMode=['normal','off'].includes(saved.shuffleMode)?saved.shuffleMode:'off'; state.shuffle=state.shuffleMode==='normal'; state.repeat=!!saved.repeat;
}
function startQueue(tracks, index = 0) { startPlayback(tracks, index, 'library'); }

function restorePlaybackSession(){
  const saved=state.savedPlayback;
  if(!saved) return;
  const volume=Number(saved.volume);
  if(Number.isFinite(volume)) {
    state.userVolume=Math.min(1,Math.max(0,volume));
    audio.volume=state.userVolume;
    const vol=$('#volume');
    if(vol){ vol.value=audio.volume; const pct=$('#volumePercent'); if(pct) pct.textContent=`${Math.round(audio.volume*100)}%`; vol.style.setProperty('--value', `${audio.volume*100}%`); vol.setAttribute('aria-valuetext', `${Math.round(audio.volume*100)}%`); }
  }
  const trackId=String(saved.trackId||'');
  const sourcePath=normalizeFsPath(saved.sourcePath||'');
  let track=trackId ? findTrackById(trackId) : null;
  if(!track && sourcePath) track=findTrackByPath(sourcePath);
  // Remote stream URLs can expire between app launches, so only restore local tracks reliably.
  if(!track || track.provider) return;
  const idx=findLibraryIndexById(track.id);
  if(idx<0) return;
  if(!state.playback.length){ state.playbackSource='library'; state.playbackBase=[track]; state.playback=[track]; state.playbackIndex=0; }
  else { const savedIdx=state.playback.findIndex(x=>x.id===track.id); if(savedIdx>=0) state.playbackIndex=savedIdx; }
  state.currentIndex=idx;
  state.currentRemoteTrack=null;
  state.restoringPlayback=true;
  audio.src=track.url||'';
  // Если пользователь запустит другой трек до загрузки метаданных, обработчик
  // не должен применить сохранённую позицию к новому треку.
  const restoreToken=(state.playbackRestoreToken=(state.playbackRestoreToken||0)+1);
  const restorePos=()=>{
    if(state.playbackRestoreToken!==restoreToken) return;
    const pos=Math.max(0,Number(saved.position)||0);
    if(Number.isFinite(audio.duration) && audio.duration>0) audio.currentTime=Math.min(pos,Math.max(0,audio.duration-0.1));
    else audio.currentTime=pos;
    state.restoringPlayback=false;
    updateNowPlaying(track);
    updateQueueButton();
    refreshPlayingStates();
    // The previous playing/paused state is intentionally not persisted.
    // Restore the last track and position, but always leave playback paused.
    syncPlayButton(false);
    persistPlaybackSession();
  };
  audio.addEventListener('loadedmetadata', restorePos, {once:true});
  updateNowPlaying(track);
  refreshPlayingStates();
}

function togglePlay() {
  if (!audio.src) {
    // Пустой плеер после удаления трека не должен молча заменять очередь всей
    // библиотекой: сначала продолжаем текущую очередь, затем выбранный трек.
    const queued = state.playback[state.playbackIndex] || state.playback[0];
    if (queued) { state.playbackIndex = state.playback.indexOf(queued); void playCurrentPlayback(); return; }
    const selected = state.currentIndex >= 0 ? state.library[state.currentIndex] : null;
    if (selected) { playTrackById(selected.id); return; }
    if (state.library[0]) playTrackById(state.library[0].id);
    return;
  }
  if (audio.paused) audio.play().then(()=>syncPlayButton(true)).catch(()=>toast('Не удалось воспроизвести трек')); else audio.pause();
}
function markEarlySkip(){
  const track=state.currentIndex>=0 ? state.library[state.currentIndex] : null;
  if(!track || !audio.duration || !Number.isFinite(audio.currentTime)) return;
  const threshold=Math.min(20,Math.max(8,audio.duration*0.30));
  if(audio.currentTime < threshold){ markTrackSkipped(track); }
}
async function next() {
  markEarlySkip();
  if (!state.playback.length) { if (state.library.length) startPlayback(state.library, 0, 'library'); return; }
  state.playbackIndex += 1;
  if (state.playbackIndex >= state.playback.length) {
    if (state.repeat) state.playbackIndex = 0;
    else { state.playbackIndex = state.playback.length - 1; syncPlayButton(false); return; }
  }
  playCurrentPlayback();
}

function previous() {
  if (audio.currentTime > 5) { audio.currentTime = 0; return; }
  if (!state.playback.length) return;
  state.playbackIndex = Math.max(0, state.playbackIndex - 1);
  playCurrentPlayback();
}
function logLocalify(event, data={}) { try { window.LocalifyLogger?.write(event, data); } catch {} }

function updateShuffleUI(){
  const mode=state.shuffleMode || (state.shuffle ? 'normal' : 'off');
  state.shuffleMode=mode; state.shuffle=mode!=='off';
  const b=$('#shuffleBtn'); if(b){ b.classList.toggle('active',state.shuffle); b.style.color=state.shuffle?'var(--accent)':''; b.title=state.shuffle?'Перемешивание включено':'Перемешивание выключено'; b.setAttribute('aria-label',b.title); }
}

function syncPlayButton(playing) {
  const icon = playing
    ? '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="7" y="5" width="3.5" height="14" rx="1.2"/><rect x="13.5" y="5" width="3.5" height="14" rx="1.2"/></svg>'
    : '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8.5 5.2 18 12l-9.5 6.8V5.2Z"/></svg>';
  const btn = $('#playBtn');
  if (btn) {
    btn.innerHTML = icon;
    btn.setAttribute('aria-label', playing ? 'Пауза' : 'Воспроизвести');
    btn.setAttribute('title', playing ? 'Пауза' : 'Воспроизвести');
    btn.classList.toggle('is-playing', playing);
  }
}
function updateNowPlaying(t){
  $('#nowTitle').textContent=t?.title || 'Ничего не играет'; $('#nowArtist').textContent=t?.artist || 'Выберите трек'; $('#nowAlbum').textContent=t?.album || ''; $('#miniCover').innerHTML=coverHtml(t?.cover,'',t?.remoteCover || '') || uiIcon('music');
}
function refreshPlayingStates() {
  const id=currentTrack()?.id||'';
  const playing=!audio.paused && !!audio.src;
  if(state.lastPlayingDomId && state.lastPlayingDomId!==id){ const prev=document.querySelector(`.track[data-id=\"${CSS.escape(state.lastPlayingDomId)}\"]`); prev?.classList.remove('is-playing'); }
  const row=id?document.querySelector(`.track[data-id=\"${CSS.escape(id)}\"]`):null;
  row?.classList.toggle('is-playing',playing);
  if(!playing && row) row.classList.remove('is-playing');
  state.lastPlayingDomId=playing?id:'';
}

// Bind the entire UI immediately. Library/settings/provider IPC can fail or be slow during startup;
// the interface must remain clickable even while data initialization is still in progress.
bind();
init().catch(err => {
  console.error('Crimson init failed:', err);
  try {
    state.settings = { ...state.settings };
    applySettings(); applyBranding(); applySidebar(); updateSearchModeUI(); renderAll(); updateQueueButton();
    toast('Интерфейс запущен; данные будут загружены позже');
  } catch(fallbackErr) { console.error('Crimson startup fallback failed:', fallbackErr); }
});
