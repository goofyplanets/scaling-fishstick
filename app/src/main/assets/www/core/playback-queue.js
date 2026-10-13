class PlaybackQueue {
  static shuffle(items, firstId = null) {
    const pool = [...(items || [])];
    const first = firstId ? pool.find(t => t.id === firstId) : null;
    const rest = pool.filter(t => !first || t.id !== first.id);
    for (let i = rest.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [rest[i], rest[j]] = [rest[j], rest[i]];
    }
    return first ? [first, ...rest] : rest;
  }

  addNext(queue, track, currentIndex = 0) {
    const items = [...(queue || [])];
    const pos = Math.max(0, Math.min(items.length, Number(currentIndex) + 1));
    if (track) items.splice(pos, 0, track);
    return items;
  }

  remove(queue, id) {
    return (queue || []).filter(t => t?.id !== id);
  }

  build(base, { shuffle = false, currentId = null } = {}) {
    const source = [...(base || [])];
    const items = shuffle ? PlaybackQueue.shuffle(source, currentId) : source;
    if (!currentId) return { items, index: 0 };
    const indexById = new Map();
    for (let i = 0; i < items.length; i++) indexById.set(items[i]?.id, i);
    return { items, index: Math.max(0, indexById.get(currentId) ?? 0) };
  }
}

if (typeof window !== 'undefined') window.LocalifyPlaybackQueue = PlaybackQueue;
// Файл подключается и как обычный скрипт в рендерере, где `module` нет:
// без проверки страница получала Uncaught ReferenceError при загрузке.
if (typeof module !== 'undefined' && module.exports) module.exports = { PlaybackQueue };
