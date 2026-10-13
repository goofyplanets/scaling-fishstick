const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const { normalizePath, statKeyAsync, collectAudioFilesAsync } = require('./library-utils');

async function exists(pathName) {
  if (!pathName) return false;
  try { await fs.promises.access(pathName); return true; } catch { return false; }
}


function playlistNameFromFolder(folderName) {
  const raw = String(folderName || '').trim();
  const match = raw.match(/\s*\[([A-Za-z0-9_-]{6,64})\]\s*$/);
  if (!match) return raw || 'Плейлист';
  return raw.slice(0, match.index).trim() || raw || 'Плейлист';
}

function stablePlaylistIdForFolder(folderPath, folderName, knownPlaylists) {
  const key = normalizePath(folderPath);
  const knownByPath = (knownPlaylists || []).find(p => normalizePath(p?.folderPath || '') === key);
  if (knownByPath?.id) return String(knownByPath.id);

  const suffix = String(folderName || '').match(/\[([A-Za-z0-9_-]{6,64})\]\s*$/)?.[1] || '';
  if (suffix) {
    const bySuffix = (knownPlaylists || []).find(p => String(p?.id || '').endsWith(suffix));
    if (bySuffix?.id) return String(bySuffix.id);
    const candidate = `pl_${suffix}`;
    const occupied = (knownPlaylists || []).some(p => p?.id === candidate && normalizePath(p?.folderPath || '') !== key);
    if (!occupied) return candidate;
  }

  return `pl_fs_${crypto.createHash('sha1').update(key).digest('hex').slice(0, 16)}`;
}

async function discoverPlaylistFolders(playlistRoot, knownPlaylists = []) {
  const discovered = [];
  if (!playlistRoot || !(await exists(playlistRoot))) return discovered;
  let entries = [];
  try { entries = await fs.promises.readdir(playlistRoot, { withFileTypes: true }); } catch { return discovered; }
  for (const entry of entries) {
    if (!entry.isDirectory() || entry.name.startsWith('.')) continue;
    const folderPath = path.join(playlistRoot, entry.name);
    const id = stablePlaylistIdForFolder(folderPath, entry.name, knownPlaylists);
    const existing = (knownPlaylists || []).find(p => String(p?.id || '') === id) || null;
    discovered.push({
      id,
      name: playlistNameFromFolder(entry.name),
      cover: existing?.cover || '',
      trackIds: Array.isArray(existing?.trackIds) ? existing.trackIds.slice() : [],
      folderPath
    });
  }
  return discovered;
}

// Сканирование и события файловой системы обогащают треки заведомо без интернета
// (onlineMetadata: false), поэтому в свежем результате обложки, найденной онлайн,
// просто нет — поля cover/remoteCover приходят пустыми. Если такие данные
// накладывать на трек из библиотеки как есть, уже показанная обложка стирается и
// трек остаётся без неё до следующего удачного онлайн-поиска. Поэтому пустые
// обложки из офлайн-разбора не затирают уже известные значения.
function keepKnownMetadata(known, fresh) {
  if (!known || !fresh) return fresh;
  if (!fresh.cover && known.cover) fresh.cover = known.cover;
  if (!fresh.remoteCover && known.remoteCover) fresh.remoteCover = known.remoteCover;
  const incomingSource = String(fresh.metadataSource || '').toLowerCase();
  const targetSource = String(known.metadataSource || '').toLowerCase();
  const offline = !incomingSource || ['tags','filename','local','offline'].includes(incomingSource);
  const remote = known.metadataOverride === true || ['musicbrainz','itunes','deezer','musicbrainz+coverart'].includes(targetSource) || Number(known.metadataConfidence || 0) >= 0.72;
  if (offline && remote) {
    for (const field of ['title','artist','album','albumArtist','genre','year','mbid']) {
      if (known[field] !== undefined && known[field] !== null && known[field] !== '') fresh[field] = known[field];
    }
    for (const field of ['metadataSource','metadataConfidence','metadataFieldConfidence']) {
      if (known[field] !== undefined) fresh[field] = known[field];
    }
  }
  return fresh;
}

async function buildStats(paths, concurrency = 16, onProgress = null) {
  const stats = new Map();
  let cursor = 0;
  let done = 0;
  async function worker() {
    while (true) {
      const index = cursor++;
      if (index >= paths.length) return;
      const filePath = paths[index];
      const key = normalizePath(filePath);
      const sig = await statKeyAsync(filePath);
      if (sig) stats.set(key, sig);
      done += 1;
      if (onProgress && (done === paths.length || done % 100 === 0)) onProgress({ done, total: paths.length });
    }
  }
  await Promise.all(Array.from({ length: Math.min(Math.max(1, concurrency), paths.length || 1) }, worker));
  return stats;
}

async function scanConfiguredFolder({ settings, store, audioExt, enrichTracks, coverCachePath, ensurePlaylistFolder, onProgress, fastStart = false }) {
  if (!settings.musicFolder || !(await exists(settings.musicFolder))) {
    return { tracks: [], playlistTracks: [], folder: settings.musicFolder || '', foundPaths: [], folderAvailable: false };
  }

  const playlistRoot = path.join(settings.musicFolder, 'Localify Playlists');
  const normalPaths = await collectAudioFilesAsync(
    settings.musicFolder,
    audioExt,
    settings.moveFilesIntoPlaylists === false ? '' : playlistRoot
  );
  const discoveredPlaylists = settings.moveFilesIntoPlaylists !== false
    ? await discoverPlaylistFolders(playlistRoot, store.playlists || [])
    : [];
  const discoveredById = new Map(discoveredPlaylists.map(p => [p.id, p]));
  const knownByPath = new Map();
  for (const t of (store.library || [])) {
    for (const p of [t?.sourcePath, t?.path]) if (p) knownByPath.set(normalizePath(p), t);
  }

  const playlistJobs = [];
  const knownPlaylistIds = new Set((store.playlists || []).map(p => p?.id).filter(Boolean));
  for (const pl of (settings.moveFilesIntoPlaylists !== false ? (store.playlists || []) : [])) {
    const discovered = discoveredById.get(pl.id);
    const folder = discovered?.folderPath || (pl.folderPath && await exists(pl.folderPath)
      ? pl.folderPath
      : ensurePlaylistFolder(pl.id, pl.name || 'Плейлист'));
    if (!folder || !(await exists(folder))) continue;
    const pfiles = await collectAudioFilesAsync(folder, audioExt);
    playlistJobs.push({ pl: { ...pl, folderPath: folder }, folder, pfiles });
  }
  // Existing folders that are not present in localify-library.json are real
  // playlists too. Recover them using a stable id so they stay editable after
  // restart and do not get duplicated by ensureFolders().
  if (settings.moveFilesIntoPlaylists !== false) {
    for (const discovered of discoveredPlaylists) {
      if (knownPlaylistIds.has(discovered.id)) continue;
      const pfiles = await collectAudioFilesAsync(discovered.folderPath, audioExt);
      playlistJobs.push({ pl: discovered, folder: discovered.folderPath, pfiles });
    }
  }

  const allPaths = [...new Set([...normalPaths, ...playlistJobs.flatMap(job => job.pfiles)])];
  onProgress?.({ phase: 'files', done: allPaths.length, total: allPaths.length });
  const statPaths = fastStart
    ? allPaths.filter(filePath => {
        const t = knownByPath.get(normalizePath(filePath));
        return !t || !t._statKey;
      })
    : allPaths;
  onProgress?.({ phase: 'stat', done: 0, total: statPaths.length, fastStart });
  const stats = await buildStats(statPaths, 16, info => onProgress?.({ phase: 'stat', ...info, fastStart }));
  const needsParse = filePath => {
    const t = knownByPath.get(normalizePath(filePath));
    const sig = stats.get(normalizePath(filePath));
    if (!t || !t._statKey) return true;
    if (!fastStart) return t._statKey !== sig;
    return false;
  };

  const parsePaths = allPaths.filter(needsParse);
  onProgress?.({ phase: 'parse', done: 0, total: parsePaths.length });
  const parsed = parsePaths.length
    ? await enrichTracks(parsePaths, { ...settings, onlineMetadata: false, renameFiles: false }, coverCachePath, info => onProgress?.({ phase: 'parse', ...info }))
    : [];
  const parsedByPath = new Map(parsed.map(t => [normalizePath(t.path || t.sourcePath), t]));

  const resolveTrack = fp => {
    const key = normalizePath(fp);
    const known = knownByPath.get(key);
    const track = parsedByPath.get(key) || known;
    if (!track) return null;
    const normalized = { ...track, id: track.id || track.path };
    // Переразобранный файл не должен терять обложку, найденную ранее онлайн.
    if (parsedByPath.has(key)) keepKnownMetadata(known, normalized);
    normalized._statKey = stats.get(key) || known?._statKey || '';
    knownByPath.set(key, normalized);
    return normalized;
  };

  const tracks = normalPaths.map(resolveTrack).filter(Boolean);
  const playlistTracks = [];
  const playlistScans = [];
  const foundPlaylistPaths = [];
  for (const { pl, folder, pfiles } of playlistJobs) {
    const scan = { playlistId: pl.id, folderPath: folder, trackIds: [] };
    for (const fp of pfiles) {
      foundPlaylistPaths.push(fp);
      const track = resolveTrack(fp);
      if (track) {
        playlistTracks.push({ playlistId: pl.id, folderPath: folder, track });
        scan.trackIds.push(track.id);
      }
    }
    playlistScans.push(scan);
  }

  const unique = new Map();
  for (const t of tracks) unique.set(normalizePath(t.path || t.sourcePath), t);
  for (const item of playlistTracks) {
    const key = normalizePath(item.track.path || item.track.sourcePath);
    if (!unique.has(key)) unique.set(key, item.track);
  }
  onProgress?.({ phase: 'done', done: allPaths.length, total: allPaths.length });
  return {
    tracks: [...unique.values()], playlistTracks, playlistScans,
    discoveredPlaylists: discoveredPlaylists.filter(p => !knownPlaylistIds.has(p.id)),
    folder: settings.musicFolder,
    foundPaths: [...normalPaths, ...foundPlaylistPaths], folderAvailable: true
  };
}


function isInside(root, target) {
  const r = normalizePath(root);
  const t = normalizePath(target);
  return t === r || t.startsWith(r + '/');
}

async function scanLibraryChange({ settings, store, audioExt, enrichTracks, coverCachePath, ensurePlaylistFolder, eventType, filename }) {
  const root = settings.musicFolder || '';
  if (!root || !filename) return { fullScan: true };
  const raw = String(filename);
  const target = path.isAbsolute(raw) ? raw : path.join(root, raw);
  if (!isInside(root, target)) return { fullScan: true };

  const playlistRoot = path.join(root, 'Localify Playlists');
  const playlistRecords = [];
  for (const pl of (settings.moveFilesIntoPlaylists !== false ? (store.playlists || []) : [])) {
    const folder = pl.folderPath && await exists(pl.folderPath)
      ? pl.folderPath
      : ensurePlaylistFolder(pl.id, pl.name || 'Плейлист');
    if (folder) playlistRecords.push({ id: pl.id, folder });
  }

  let existsTarget = false;
  let isDirectory = false;
  try {
    const st = await fs.promises.stat(target);
    existsTarget = true;
    isDirectory = st.isDirectory();
  } catch {}

  if (!existsTarget) {
    return { tracks: [], removedPaths: [target], playlistAssignments: [], fullScan: false };
  }

  let paths = [];
  // Служебные каталоги (.localify-ytdlp-* и другие скрытые) не относятся к
  // библиотеке: обход по файлу внутри них иначе добавлял промежуточный файл.
  if (path.dirname(String(target)).split(/[\\/]/).some(segment => segment.startsWith('.'))) {
    return { tracks: [], removedPaths: [], playlistAssignments: [], fullScan: false };
  }
  if (isDirectory) {
    paths = await collectAudioFilesAsync(target, audioExt);
  } else if (audioExt.has(path.extname(target).toLowerCase())) {
    paths = [target];
  } else if (eventType === 'rename') {
    // Directory/file metadata outside supported extensions is irrelevant to the library.
    return { tracks: [], removedPaths: [], playlistAssignments: [], fullScan: false };
  }
  paths = [...new Set(paths)];
  if (!paths.length) return { tracks: [], removedPaths: [], playlistAssignments: [], fullScan: false };

  const tracks = await enrichTracks(paths, { ...settings, onlineMetadata: false, renameFiles: false }, coverCachePath);
  // Одиночное изменение файла (переименование, правка тегов, копирование) тоже
  // разбирается без интернета: сохраняем уже известную обложку.
  const knownByPath = new Map();
  for (const t of (store?.library || [])) {
    for (const p of [t?.sourcePath, t?.path]) if (p) knownByPath.set(normalizePath(p), t);
  }
  for (const track of tracks) keepKnownMetadata(knownByPath.get(normalizePath(track.path || track.sourcePath)), track);
  const assignments = [];
  for (const track of tracks) {
    const trackPath = track?.path || track?.sourcePath || '';
    const folderMatch = playlistRecords
      .filter(item => isInside(item.folder, trackPath))
      .sort((a,b) => normalizePath(b.folder).length - normalizePath(a.folder).length)[0];
    if (folderMatch) assignments.push({ playlistId: folderMatch.id, trackId: track.id, action: 'add' });
    else {
      for (const item of playlistRecords) assignments.push({ playlistId: item.id, trackId: track.id, action: 'remove' });
    }
  }
  return { tracks, removedPaths: [], playlistAssignments: assignments, fullScan: false };
}

module.exports = { scanConfiguredFolder, scanLibraryChange };
