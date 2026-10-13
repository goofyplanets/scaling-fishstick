(function () {
  'use strict';

  function uid(prefix = 'id') {
    return `${prefix}_${Date.now()}_${Math.random().toString(16).slice(2)}`;
  }

  function esc(text = '') {
    return String(text).replace(/[&<>"']/g, m => ({
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      '"': '&quot;',
      "'": '&#039;'
    }[m]));
  }

  function fmtTime(sec) {
    if (!Number.isFinite(sec)) return '0:00';
    const s = Math.floor(sec % 60).toString().padStart(2, '0');
    return `${Math.floor(sec / 60)}:${s}`;
  }

  function pluralRu(value, one, few, many) {
    const n = Math.abs(Number(value) || 0);
    const mod10 = n % 10, mod100 = n % 100;
    return n % 1 === 0 && mod10 === 1 && mod100 !== 11 ? one : (mod10 >= 2 && mod10 <= 4 && !(mod100 >= 12 && mod100 <= 14) ? few : many);
  }

  function fmtCount(value, one, few, many) {
    const n = Number(value) || 0;
    return `${n} ${pluralRu(n, one, few, many)}`;
  }

  function fmtDate(ts) {
    if (!ts) return '—';
    const d = new Date(ts);
    if (Number.isNaN(d.getTime())) return '—';
    return d.toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit', year: 'numeric' });
  }

  function coverHtml(url, cls = '', remote = '') {
    const src = url || remote;
    if (!src) return '';
    const fallback = remote && remote !== src ? ` data-cover-fallback="${esc(remote)}"` : '';
    return `<img class="${esc(cls)}" src="${esc(src)}" alt="" loading="lazy" decoding="async"${fallback}>`;
  }

  // Сканирование и события файловой системы разбирают треки заведомо без интернета
  // (onlineMetadata: false), поэтому в свежих данных обложки может не быть вовсе.
  // Наложение таких данных как есть стирало уже найденную обложку: трек оставался
  // с заглушкой до следующего удачного онлайн-поиска, а без него — навсегда.
  // Пустые cover/remoteCover больше не затирают уже известные значения.
  const OFFLINE_METADATA_SOURCES = new Set(['', 'tags', 'filename', 'local', 'offline']);
  const PROTECTED_METADATA_FIELDS = ['title', 'artist', 'album', 'albumArtist', 'genre', 'year', 'mbid'];
  const REMOTE_METADATA_SOURCES = new Set(['musicbrainz', 'itunes', 'deezer', 'musicbrainz+coverart']);

  function mergeTrackData(target, incoming, { keepCover = true, protectOnline = true } = {}) {
    if (!target || !incoming) return target;
    if (keepCover) {
      if (!incoming.cover && target.cover) incoming.cover = target.cover;
      if (!incoming.remoteCover && target.remoteCover) incoming.remoteCover = target.remoteCover;
    }
    const incomingSource = String(incoming.metadataSource || '').toLowerCase();
    const targetSource = String(target.metadataSource || '').toLowerCase();
    const incomingOffline = OFFLINE_METADATA_SOURCES.has(incomingSource);
    const targetRemote = target.metadataOverride === true || REMOTE_METADATA_SOURCES.has(targetSource) || Number(target.metadataConfidence || 0) >= 0.72;
    if (protectOnline && incomingOffline && targetRemote) {
      for (const field of PROTECTED_METADATA_FIELDS) {
        if (target[field] !== undefined && target[field] !== null && target[field] !== '') incoming[field] = target[field];
      }
      for (const field of ['metadataSource', 'metadataConfidence', 'metadataFieldConfidence']) {
        if (target[field] !== undefined) incoming[field] = target[field];
      }
    }
    return Object.assign(target, incoming);
  }

  function normalizeSearchText(value = '') {
    return String(value || '')
      .toLocaleLowerCase('ru-RU')
      .replace(/ё/g, 'е')
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[^\p{L}\p{N}]+/gu, ' ')
      .trim();
  }

  function setDerived(track, key, value) {
    Object.defineProperty(track, key, { value, writable: true, configurable: true, enumerable: false });
  }

  function rebuildTrackSearchIndex(track) {
    if (!track) return track;
    setDerived(track, '_searchTitle', normalizeSearchText(track.title));
    setDerived(track, '_searchArtist', normalizeSearchText(track.artist));
    setDerived(track, '_searchAlbum', normalizeSearchText(track.album));
    setDerived(track, '_searchPath', normalizeSearchText(track.path || track.sourcePath || ''));
    setDerived(track, '_searchIndex', [
      track._searchTitle,
      track._searchArtist,
      track._searchAlbum,
      track._searchPath
    ].filter(Boolean).join(' '));
    setDerived(track, '_sortTitle', String(track.title || '').toLocaleLowerCase('ru-RU'));
    setDerived(track, '_sortAlbum', String(track.album || '').toLocaleLowerCase('ru-RU'));
    return track;
  }

  function invalidateTrackSearchIndex(track) {
    if (track) {
      delete track._searchIndex;
      delete track._searchTitle;
      delete track._searchArtist;
      delete track._searchAlbum;
      delete track._searchPath;
      delete track._sortTitle;
      delete track._sortAlbum;
    }
    return rebuildTrackSearchIndex(track);
  }

  window.LocalifyAppUtils = Object.freeze({
    uid,
    esc,
    fmtTime,
    fmtDate,
    pluralRu,
    fmtCount,
    coverHtml,
    mergeTrackData,
    normalizeSearchText,
    rebuildTrackSearchIndex,
    invalidateTrackSearchIndex
  });
}());
