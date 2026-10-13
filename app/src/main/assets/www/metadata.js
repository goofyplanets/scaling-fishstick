const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { pathToFileURL, fileURLToPath } = require('url');
const { parseFile } = require('music-metadata');

const AUDIO_EXT = new Set(['.mp3','.flac','.wav','.m4a','.aac','.ogg','.opus','.wma']);
const IMAGE_EXT = new Set(['.jpg','.jpeg','.png','.webp']);
const APP_VERSION = (() => { try { return require('../package.json').version; } catch { return 'dev'; } })();
const USER_AGENT = `LocalifyCrimson/${APP_VERSION} (desktop music player)`;

const nearbyCoverCache = new Map();
const onlineMetadataCache = new Map();
const artworkCache = new Map();
const coverUrlCache = new Map();
const coverDownloadJobs = new Map();
const embeddedCoverJobs = new Map();
const CACHE_LIMIT = 4000;
const COVER_CACHE_LIMIT = 4000;
const COVER_CACHE_TTL_MS = 30000;

function boundedSet(cache, key, value, limit = CACHE_LIMIT) {
  cache.set(key, value);
  if (cache.size > limit) {
    const drop = Math.max(1, Math.floor(limit * 0.15));
    let i = 0;
    for (const oldKey of cache.keys()) {
      cache.delete(oldKey);
      if (++i >= drop) break;
    }
  }
}

async function memoizedAsync(cache, key, loader, limit = CACHE_LIMIT) {
  if (cache.has(key)) return cache.get(key);
  const promise = Promise.resolve().then(loader);
  boundedSet(cache, key, promise, limit);
  try {
    return await promise;
  } catch (error) {
    if (cache.get(key) === promise) cache.delete(key);
    throw error;
  }
}

function normalizePath(p) { return p.replace(/\\/g, '/'); }
function buildFileUrl(p) { return pathToFileURL(path.resolve(p)).href; }
function cleanText(v) { return String(v || '').replace(/\s+/g, ' ').trim(); }
function cleanGenre(v) { const value = cleanText(v); return /^(music|musical|unknown|unknown genre|genre|other|misc|miscellaneous|general)$/i.test(value) ? '' : value; }
function splitArtistTitle(text) {
  const raw = cleanText(text).replace(/[_]+/g, ' ');
  const match = raw.match(/^(.+?)\s*[–—-]\s*(.+)$/);
  if (!match) return { artist: '', title: raw || 'Без названия' };
  return { artist: cleanText(match[1]), title: cleanText(match[2]) || 'Без названия' };
}
function titleFromFile(filePath) {
  return splitArtistTitle(path.basename(filePath, path.extname(filePath)).replace(/[_]+/g, ' ').replace(/\s{2,}/g, ' '));
}
function slug(s) {
  return cleanText(s).toLowerCase().normalize('NFKD').replace(/[\u0300-\u036f]/g,'').replace(/[^a-z0-9а-яё]+/gi,' ').trim();
}
function similarity(a, b) {
  const aa = slug(a), bb = slug(b);
  if (!aa || !bb) return 0;
  if (aa === bb) return 1;
  if (aa.includes(bb) || bb.includes(aa)) return 0.86;
  const sa = new Set(aa.split(' ')); const sb = new Set(bb.split(' '));
  const inter = [...sa].filter(x => sb.has(x)).length;
  return inter / Math.max(sa.size, sb.size, 1);
}
function sanitizeName(name) {
  return cleanText(name).replace(/[<>:"/\\|?*\x00-\x1F]/g, '').replace(/[. ]+$/g, '').slice(0, 170) || 'Без названия';
}
async function findNearbyCover(filePath) {
  const folder = path.dirname(filePath);
  const folderKey = normalizePath(folder).toLowerCase();
  const base = path.basename(filePath, path.extname(filePath)).toLowerCase();
  const now = Date.now();
  let entry = nearbyCoverCache.get(folderKey);
  if (!entry || now - entry.checkedAt > COVER_CACHE_TTL_MS) {
    try {
      const files = await fs.promises.readdir(folder);
      entry = {
        checkedAt: now,
        files: files.filter(f => IMAGE_EXT.has(path.extname(f).toLowerCase())),
        generic: ''
      };
      entry.generic = entry.files.find(f => /^(cover|folder|front|album)/i.test(f)) || '';
      boundedSet(nearbyCoverCache, folderKey, entry, COVER_CACHE_LIMIT);
    } catch {
      nearbyCoverCache.delete(folderKey);
      return '';
    }
  }
  const exact = entry.files.find(f => path.basename(f, path.extname(f)).toLowerCase() === base);
  if (exact) return buildFileUrl(path.join(folder, exact));
  if (entry.generic) return buildFileUrl(path.join(folder, entry.generic));
  return '';
}
function invalidateNearbyCoverCache(folder = '') {
  if (!folder) { nearbyCoverCache.clear(); return; }
  nearbyCoverCache.delete(normalizePath(folder).toLowerCase());
}

async function uniqueTarget(dir, base, ext, original) {
  let target = path.join(dir, `${base}${ext}`);
  if (normalizePath(target) === normalizePath(original)) return target;
  let i = 1;
  while (true) {
    try { await fs.promises.access(target); } catch { break; }
    target = path.join(dir, `${base} (${i++})${ext}`);
  }
  return target;
}

async function readLocalMetadata(filePath, { skipCovers = false } = {}) {
  const fallback = titleFromFile(filePath);
  try {
    const metadata = await parseFile(filePath, { duration: true, skipCovers: !!skipCovers });
    const common = metadata.common || {};
    const embedded = common.picture?.[0];
    const taggedTitle = cleanText(common.title);
    const taggedArtist = cleanText(common.artist || common.artists?.[0]);
    const parsedTitle = taggedTitle && !taggedArtist ? splitArtistTitle(taggedTitle) : { artist: '', title: taggedTitle };
    return {
      title: parsedTitle.title || fallback.title,
      artist: taggedArtist || parsedTitle.artist || fallback.artist || 'Неизвестный исполнитель',
      album: cleanText(common.album) || 'Локальная библиотека',
      albumArtist: cleanText(common.albumartist || common.albumArtist || common.albumartists?.[0] || taggedArtist) || taggedArtist || 'Неизвестный исполнитель',
      genre: Array.isArray(common.genre) ? cleanGenre(common.genre[0]) : cleanGenre(common.genre),
      year: common.year || null,
      trackNo: common.track?.no || null,
      duration: Number(metadata.format?.duration || 0),
      bitrate: Number(metadata.format?.bitrate || 0),
      sampleRate: Number(metadata.format?.sampleRate || 0),
      bitsPerSample: Number(metadata.format?.bitsPerSample || 0),
      codec: cleanText(metadata.format?.codec || metadata.format?.container || ''),
      container: cleanText(metadata.format?.container || path.extname(filePath).slice(1)),
      lossless: /^(flac|alac|wav|aiff|ape|wv)$/i.test(String(metadata.format?.container || path.extname(filePath).slice(1))) || Number(metadata.format?.lossless) === 1,
      picture: embedded ? { format: embedded.format || 'image/jpeg', data: embedded.data } : null,
      source: 'tags'
    };
  } catch {
    return { title: fallback.title, artist: fallback.artist || 'Неизвестный исполнитель', album: 'Локальная библиотека', albumArtist: fallback.artist || 'Неизвестный исполнитель', duration: 0, bitrate: 0, sampleRate: 0, bitsPerSample: 0, codec: '', container: path.extname(filePath).slice(1), lossless: false, trackNo: null, source: 'filename' };
  }
}

// Сетевые вызовы метаданных раньше могли висеть бесконечно и блокировали
// воркер очереди: у radio-browser таймаут и лимит размера уже были, здесь — нет.
const NETWORK_TIMEOUT_MS = 12000;
const MAX_COVER_BYTES = 12 * 1024 * 1024;
function fetchWithTimeout(url, options = {}) {
  return fetch(url, { ...options, signal: AbortSignal.timeout(NETWORK_TIMEOUT_MS) });
}
function isResponseTooLarge(res) {
  const declared = Number(res.headers?.get('content-length') || 0);
  return declared > MAX_COVER_BYTES;
}

async function mbFetch(url) {
  const res = await fetchWithTimeout(url, { headers: { 'User-Agent': USER_AGENT, 'Accept': 'application/json' } });
  if (!res.ok) throw new Error(`MusicBrainz HTTP ${res.status}`);
  return res.json();
}
function escapeLucene(text) { return String(text || '').replace(/([\\+\-!(){}\[\]^"~*?:\/])/g, '\\$1'); }
async function searchMusicBrainz(title, artist) {
  const cacheKey = `${cleanText(artist).toLowerCase()}::${cleanText(title).toLowerCase()}`;
  return memoizedAsync(onlineMetadataCache, `mb:${cacheKey}`, async () => {
    const q = artist && artist !== 'Неизвестный исполнитель'
      ? `recording:"${escapeLucene(title)}" AND artist:"${escapeLucene(artist)}"`
      : `recording:"${escapeLucene(title)}"`;
    const url = `https://musicbrainz.org/ws/2/recording/?query=${encodeURIComponent(q)}&fmt=json&limit=5&inc=artists+releases+tags`;
    const data = await mbFetch(url);
    const recordings = data.recordings || [];
    let best = null;
    for (const rec of recordings) {
      const recArtist = (rec['artist-credit'] || []).map(x => x.name || x.artist?.name).filter(Boolean).join(', ');
      const release = (rec.releases || []).find(r => r['release-group']?.id) || rec.releases?.[0];
      const score = (Number(rec.score || 0) / 100) * 0.55 + similarity(title, rec.title) * 0.3 + (artist ? similarity(artist, recArtist) : 0.5) * 0.15;
      if (!best || score > best.score) best = { score, recording: rec, artist: recArtist, release };
    }
    if (!best || best.score < 0.72) return null;
    const rec = best.recording;
    const releaseGroupId = best.release?.['release-group']?.id || null;
    const tags = Array.isArray(rec.tags) ? [...rec.tags].sort((a,b) => Number(b.count || 0) - Number(a.count || 0)) : [];
    const genre = cleanGenre(tags[0]?.name || '');
    return {
      confidence: best.score,
      title: cleanText(rec.title) || title,
      artist: cleanText(best.artist) || artist || 'Неизвестный исполнитель',
      album: cleanText(best.release?.title) || 'Локальная библиотека',
      releaseGroupId,
      genre,
      releaseId: best.release?.id || null,
      mbid: rec.id,
    };
  });
}

async function searchITunes(title, artist) {
  const term = cleanText([artist && artist !== 'Неизвестный исполнитель' ? artist : '', title].filter(Boolean).join(' '));
  if (!term) return null;
  const cacheKey = `${cleanText(artist).toLowerCase()}::${cleanText(title).toLowerCase()}`;
  return memoizedAsync(artworkCache, `itunes:${cacheKey}`, async () => {
    const locales = ['RU','US'];
    let best = null;
    for (const country of locales) {
      const url = `https://itunes.apple.com/search?term=${encodeURIComponent(term)}&media=music&entity=song&limit=10&country=${country}`;
      try {
        const data = await mbFetch(url);
        for (const item of (data.results || [])) {
          const score = similarity(title, item.trackName) * 0.55 + (artist && artist !== 'Неизвестный исполнитель' ? similarity(artist, item.artistName) : 0.45) * 0.45;
          if (!best || score > best.score) best = { score, item };
        }
        if (best && best.score >= 0.86) break;
      } catch {}
    }
    if (!best || best.score < 0.52) return null;
    const item = best.item;
    const art = String(item.artworkUrl100 || item.artworkUrl60 || '').replace(/\d+x\d+bb\.jpg$/i, '1000x1000bb.jpg');
    return { confidence: best.score, title: cleanText(item.trackName) || title, artist: cleanText(item.artistName) || artist || 'Неизвестный исполнитель', album: cleanText(item.collectionName) || 'Локальная библиотека', genre: cleanGenre(item.primaryGenreName || ''), coverUrl: art, source: 'itunes' };
  });
}

async function searchDeezer(title, artist) {
  const term = cleanText([artist && artist !== 'Неизвестный исполнитель' ? artist : '', title].filter(Boolean).join(' '));
  if (!term) return null;
  const cacheKey = `${cleanText(artist).toLowerCase()}::${cleanText(title).toLowerCase()}`;
  return memoizedAsync(artworkCache, `deezer:${cacheKey}`, async () => {
    const url = `https://api.deezer.com/search?q=${encodeURIComponent(term)}&limit=10`;
    const res = await fetchWithTimeout(url, { headers: { 'User-Agent': USER_AGENT, 'Accept': 'application/json' } });
    if (!res.ok) throw new Error(`Deezer HTTP ${res.status}`);
    const data = await res.json();
    let best = null;
    for (const item of (data.data || [])) {
      const itemArtist = item.artist?.name || '';
      const itemTitle = item.title || '';
      const score = similarity(title, itemTitle) * 0.58 + (artist && artist !== 'Неизвестный исполнитель' ? similarity(artist, itemArtist) : 0.42) * 0.42;
      if (!best || score > best.score) best = { score, item };
    }
    if (!best || best.score < 0.5) return null;
    return { confidence: best.score, title: cleanText(best.item.title) || title, artist: cleanText(best.item.artist?.name) || artist || 'Неизвестный исполнитель', album: cleanText(best.item.album?.title) || 'Локальная библиотека', coverUrl: best.item.album?.cover_xl || best.item.album?.cover_big || '', source: 'deezer' };
  });
}

async function searchArtwork(title, artist) {
  try { const iTunes = await searchITunes(title, artist); if (iTunes?.coverUrl) return iTunes; } catch {}
  try { const deezer = await searchDeezer(title, artist); if (deezer?.coverUrl) return deezer; } catch {}
  return null;
}

async function coverUrlFor(result) {
  if (!result) return '';
  const cacheKey = result.releaseId || result.releaseGroupId || result.mbid || '';
  if (!cacheKey) return '';
  return memoizedAsync(coverUrlCache, `cover:${cacheKey}`, async () => {
    const candidates = [];
    if (result.releaseId) candidates.push(`https://coverartarchive.org/release/${result.releaseId}/front-500`);
    if (result.releaseGroupId) candidates.push(`https://coverartarchive.org/release-group/${result.releaseGroupId}/front-500`);
    for (const url of candidates) {
      try {
        const res = await fetchWithTimeout(url, { method: 'GET', redirect: 'follow', headers: { 'User-Agent': USER_AGENT } });
        if (res.ok) return url;
      } catch {}
    }
    return '';
  });
}


async function downloadCover(url, cacheDir, key) {
  if (!url) return '';
  const jobKey = `${url}::${key}`;
  if (coverDownloadJobs.has(jobKey)) return coverDownloadJobs.get(jobKey);
  const job = (async () => {
    await fs.promises.mkdir(cacheDir, { recursive: true });
    const file = path.join(cacheDir, `${crypto.createHash('sha1').update(key).digest('hex')}.jpg`);
    try { const st = await fs.promises.stat(file); if (st.size > 0) return buildFileUrl(file); } catch {}
    try {
      const res = await fetchWithTimeout(url, { headers: { 'User-Agent': USER_AGENT } });
      if (!res.ok) return '';
      if (isResponseTooLarge(res)) return '';
      const buf = Buffer.from(await res.arrayBuffer());
      if (buf.length < 1000 || buf.length > MAX_COVER_BYTES) return '';
      await fs.promises.writeFile(file, buf);
      return buildFileUrl(file);
    } catch { return ''; }
  })().finally(() => coverDownloadJobs.delete(jobKey));
  coverDownloadJobs.set(jobKey, job);
  return job;
}

// Обложки складываются в cover-cache навсегда: без ограничения по размеру
// папка росла бесконечно, а очистка кэша метаданных её не трогала.
async function listCoverCacheFiles(cacheDir) {
  let entries = [];
  try { entries = await fs.promises.readdir(cacheDir); } catch { return []; }
  const files = [];
  for (const name of entries) {
    try {
      const full = path.join(cacheDir, name);
      const st = await fs.promises.stat(full);
      if (st.isFile()) files.push({ full, size: st.size, at: st.mtimeMs });
    } catch {}
  }
  return files;
}

// Пути к файлам обложек, на которые ссылается библиотека. Нужны, чтобы очистка
// кэша не удаляла картинку, которую приложение прямо сейчас показывает: ссылка
// оставалась в библиотеке, файла больше не было, и трек навсегда оставался без
// обложки (повторный поиск не запускался — поле cover непустое).
function referencedCoverPaths(tracks) {
  const keep = new Set();
  for (const track of (tracks || [])) {
    const url = typeof track?.cover === 'string' ? track.cover : '';
    if (!url.startsWith('file:')) continue;
    try { keep.add(normalizePath(fileURLToPath(url))); } catch {}
  }
  return keep;
}

async function pruneCoverCache(cacheDir, { maxBytes = 300 * 1024 * 1024, keep = null } = {}) {
  const files = await listCoverCacheFiles(cacheDir);
  let total = files.reduce((sum, f) => sum + f.size, 0);
  if (total <= maxBytes) return 0;
  let removed = 0;
  for (const file of files.sort((a, b) => a.at - b.at)) {
    if (total <= maxBytes) break;
    if (keep && keep.has(normalizePath(file.full))) continue;
    try { await fs.promises.unlink(file.full); total -= file.size; removed++; } catch {}
  }
  return removed;
}

async function clearCoverCache(cacheDir) {
  const files = await listCoverCacheFiles(cacheDir);
  let removed = 0;
  for (const file of files) {
    try { await fs.promises.unlink(file.full); removed++; } catch {}
  }
  return removed;
}

async function saveEmbeddedCover(picture, cacheDir) {
  if (!picture?.data?.length) return '';
  const dataHash = crypto.createHash('sha1').update(picture.data).digest('hex');
  if (embeddedCoverJobs.has(dataHash)) return embeddedCoverJobs.get(dataHash);
  const job = (async () => {
    try {
      await fs.promises.mkdir(cacheDir, { recursive: true });
      const ext = picture.format?.includes('png') ? 'png' : picture.format?.includes('webp') ? 'webp' : 'jpg';
      const file = path.join(cacheDir, `${dataHash}-embedded.${ext}`);
      try { await fs.promises.access(file); } catch { await fs.promises.writeFile(file, picture.data); }
      return buildFileUrl(file);
    } catch { return ''; }
  })().finally(() => embeddedCoverJobs.delete(dataHash));
  embeddedCoverJobs.set(dataHash, job);
  return job;
}

async function enrichTrack(filePath, settings, cacheDir, waitNextRequest) {
  const nearbyCover = await findNearbyCover(filePath);
  const local = await readLocalMetadata(filePath, { skipCovers: !!nearbyCover });
  let title = local.title, artist = local.artist, album = local.album, genre = local.genre || '';
  let cover = nearbyCover || await saveEmbeddedCover(local.picture, cacheDir);
  let online = null;
  let remoteCover = '';
  if (settings.onlineMetadata) {
    try {
      await waitNextRequest();
      online = await searchMusicBrainz(title, artist);
    } catch {}
    if (online) {
      title = online.title || title;
      artist = online.artist || artist;
      album = online.album || album;
      genre = online.genre || genre;
      remoteCover = await coverUrlFor(online);
    }
    if (!cover && !remoteCover) {
      try {
        await waitNextRequest();
        const artwork = await searchArtwork(title, artist);
        if (artwork) {
          remoteCover = artwork.coverUrl || '';
          // Only replace metadata from the fallback when MusicBrainz did not produce a confident result.
          if (!online || online.confidence < 0.82) {
            online = artwork;
            title = artwork.title || title;
            artist = artwork.artist || artist;
            album = artwork.album || album;
            genre = artwork.genre || genre;
          }
        }
      } catch {}
    }
    if (!cover && remoteCover) {
      cover = await downloadCover(remoteCover, cacheDir, online?.releaseGroupId || online?.releaseId || online?.mbid || `${artist}-${title}`);
    }
  }
  let finalPath = filePath;
  if (settings.renameFiles && online && online.confidence >= 0.82) {
    const ext = path.extname(filePath);
    const base = sanitizeName(`${artist} - ${title}`);
    const target = await uniqueTarget(path.dirname(filePath), base, ext, filePath);
    if (normalizePath(target) !== normalizePath(filePath)) {
      try { await fs.promises.rename(filePath, target); finalPath = target; invalidateNearbyCoverCache(path.dirname(filePath)); invalidateNearbyCoverCache(path.dirname(target)); } catch {}
    }
  }
  const localConfidence = local.source === 'tags' ? 1 : 0.45;
  const onlineConfidence = Number(online?.confidence || 0);
  const metadataFieldConfidence = {
    title: Math.max(localConfidence, onlineConfidence),
    artist: Math.max(localConfidence, onlineConfidence),
    album: Math.max(localConfidence, onlineConfidence),
    cover: local.picture ? 1 : (cover ? Math.max(0.7, onlineConfidence) : 0)
  };
  return {
    id: normalizePath(finalPath),
    sourcePath: filePath,
    path: finalPath,
    url: buildFileUrl(finalPath),
    title, artist, album, albumArtist: local.albumArtist || artist, genre, duration: local.duration || 0,
    bitrate: Number(local.bitrate) || 0, sampleRate: Number(local.sampleRate) || 0, bitsPerSample: Number(local.bitsPerSample) || 0,
    codec: local.codec || '', container: local.container || path.extname(finalPath).slice(1), lossless: !!local.lossless,
    trackNo: local.trackNo || null, cover, remoteCover,
    metadataSource: online?.source || (online ? 'musicbrainz' : local.source),
    metadataConfidence: onlineConfidence,
    metadataFieldConfidence,
    mbid: online?.mbid || null
  };
}

async function enrichTracks(paths, settings, cacheDir, onProgress = null) {
  const list = Array.from(new Set((paths || []).filter(Boolean)));
  if (!list.length) return [];

  // Local metadata parsing is independent per file, so bounded concurrency makes
  // large library scans substantially faster without creating an unbounded I/O burst.
  // Keep online metadata sequential because the services are rate-limited.
  const concurrency = settings.onlineMetadata ? 2 : 6;
  let last = 0;
  let rateGate = Promise.resolve();
  const waitNextRequest = async () => {
    const previous = rateGate;
    let release;
    rateGate = new Promise(resolve => { release = resolve; });
    await previous;
    try {
      const diff = Date.now() - last;
      if (diff < 1100) await new Promise(r => setTimeout(r, 1100 - diff));
      last = Date.now();
    } finally {
      release();
    }
  };
  const out = new Array(list.length);
  let cursor = 0;
  let done = 0;
  async function worker() {
    while (true) {
      const index = cursor++;
      if (index >= list.length) return;
      out[index] = await enrichTrack(list[index], settings, cacheDir, waitNextRequest);
      done += 1;
      if (onProgress && (done === list.length || done % 25 === 0)) onProgress({ done, total: list.length });
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, list.length) }, worker));
  return out.filter(Boolean);
}
module.exports = { AUDIO_EXT, IMAGE_EXT, buildFileUrl, enrichTracks, readLocalMetadata, invalidateNearbyCoverCache, pruneCoverCache, clearCoverCache, referencedCoverPaths };
