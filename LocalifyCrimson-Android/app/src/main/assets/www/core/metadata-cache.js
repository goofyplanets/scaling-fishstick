const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const CACHE_VERSION = 2;
const CACHE_WRITE_INDENT = undefined;

function normalizePath(p) {
  return path.resolve(String(p || '')).replace(/\\/g, '/').toLowerCase();
}

function getStatKey(filePath) {
  try {
    const st = fs.statSync(filePath);
    return `${st.size}:${Math.round(st.mtimeMs)}`;
  } catch {
    return '';
  }
}

async function getStatKeyAsync(filePath) {
  try {
    const st = await fs.promises.stat(filePath);
    return `${st.size}:${Math.round(st.mtimeMs)}`;
  } catch {
    return '';
  }
}

function makeKey(filePath, statKey) {
  return crypto.createHash('sha1')
    .update(`${CACHE_VERSION}|${normalizePath(filePath)}|${statKey || getStatKey(filePath)}`)
    .digest('hex');
}

class MetadataCache {
  constructor(filePath) {
    this.filePath = filePath;
    this.data = new Map();
    this.loaded = false;
    this.dirty = false;
    this.savePromise = null;
    this.dirtyVersion = 0;
    this.clearRequested = false;
  }

  load() {
    if (this.loaded) return this;
    this.loaded = true;
    try {
      if (!fs.existsSync(this.filePath)) return this;
      const raw = JSON.parse(fs.readFileSync(this.filePath, 'utf8'));
      if (raw?.version !== CACHE_VERSION || !raw?.entries || typeof raw.entries !== 'object') return this;
      for (const [key, value] of Object.entries(raw.entries)) {
        if (value && typeof value === 'object') this.data.set(key, value);
      }
    } catch {
      this.data.clear();
    }
    return this;
  }

  get(filePath, statKey = getStatKey(filePath)) {
    this.load();
    if (!statKey) return null;
    return this.data.get(makeKey(filePath, statKey)) || null;
  }

  set(filePath, statKey, result) {
    this.load();
    if (!statKey || !result) return;
    this.clearRequested = false;
    this.data.set(makeKey(filePath, statKey), {
      savedAt: Date.now(),
      path: normalizePath(filePath),
      statKey,
      result
    });
    this.dirty = true;
    this.dirtyVersion++;
  }

  prune(maxEntries = 20000) {
    this.load();
    if (this.data.size <= maxEntries) return;
    const entries = [...this.data.entries()].sort((a, b) => Number(a[1]?.savedAt || 0) - Number(b[1]?.savedAt || 0));
    const remove = entries.slice(0, Math.max(0, entries.length - maxEntries));
    for (const [key] of remove) this.data.delete(key);
    this.dirty = true;
    this.dirtyVersion++;
  }

  save() {
    this.load();
    if (this.savePromise) return this.savePromise;
    if (!this.dirty) return Promise.resolve(true);
    const snapshotVersion = this.dirtyVersion;
    const snapshot = Object.fromEntries(this.data.entries());
    const payload = JSON.stringify({ version: CACHE_VERSION, entries: snapshot }, CACHE_WRITE_INDENT);
    this.savePromise = (async () => {
      try {
        await fs.promises.mkdir(path.dirname(this.filePath), { recursive: true });
        const tmp = `${this.filePath}.tmp`;
        await fs.promises.writeFile(tmp, payload, 'utf8');
        try {
          await fs.promises.rename(tmp, this.filePath);
        } catch (renameErr) {
          if (renameErr && (renameErr.code === 'EPERM' || renameErr.code === 'EACCES' || renameErr.code === 'EEXIST')) {
            await fs.promises.rm(this.filePath, { force: true });
            await fs.promises.rename(tmp, this.filePath);
          } else {
            throw renameErr;
          }
        }
        if (this.dirtyVersion === snapshotVersion) this.dirty = false;
        return true;
      } catch {
        try { await fs.promises.unlink(`${this.filePath}.tmp`); } catch {}
        return false;
      } finally {
        this.savePromise = null;
        if (this.clearRequested && this.dirtyVersion === snapshotVersion + 1) {
          this.clearRequested = false;
          this.dirty = false;
          try { await fs.promises.unlink(this.filePath); } catch {}
        } else {
          if (this.dirtyVersion !== snapshotVersion) this.dirty = true;
          if (this.dirty) void this.save();
        }
      }
    })();
    return this.savePromise;
  }

  clear() {
    this.data.clear();
    this.dirty = false;
    this.dirtyVersion++;
    this.clearRequested = true;
    try { if (fs.existsSync(this.filePath)) fs.unlinkSync(this.filePath); } catch {}
    return true;
  }

  stats() {
    this.load();
    let size = 0;
    try { size = fs.existsSync(this.filePath) ? fs.statSync(this.filePath).size : 0; } catch {}
    return { version: CACHE_VERSION, entries: this.data.size, bytes: size };
  }
}

module.exports = { MetadataCache, CACHE_VERSION, getStatKey, getStatKeyAsync, normalizePath };
