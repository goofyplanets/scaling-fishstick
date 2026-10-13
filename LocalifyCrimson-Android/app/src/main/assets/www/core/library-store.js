const fs = require('fs');
const path = require('path');

const SCHEMA_VERSION = 2;
const BACKUP_INTERVAL_MS = 30000;

class LibraryStore {
  constructor(filePath, { sanitize, onError } = {}) {
    this.filePath = filePath;
    this.sanitize = sanitize || (x => x);
    this.onError = typeof onError === 'function' ? onError : null;
    this.loaded = false;
    this.data = { schemaVersion: SCHEMA_VERSION, library: [], playlists: [] };
    this.writeTimer = null;
    this.writePromise = null;
    this.pendingResolve = [];
    this.lastBackupAt = 0;
    this.writeVersion = 0;
    this.retryTimer = null;
    this.retryCount = 0;
    this.lastError = null;
  }

  _sanitize(data) {
    const source = data && typeof data === 'object' ? data : {};
    const library = Array.isArray(source.library)
      ? source.library.filter(t => t && (!t.provider || t.provider === 'youtube'))
      : [];
    const ids = new Set(library.map(t => t.id));
    const playlists = Array.isArray(source.playlists)
      ? source.playlists.map(p => ({
          ...p,
          trackIds: Array.isArray(p.trackIds) ? p.trackIds.filter(id => ids.has(id)) : []
        }))
      : [];
    return { schemaVersion: SCHEMA_VERSION, library, playlists };
  }

  _backupCorruptFile() {
    try {
      if (!fs.existsSync(this.filePath)) return;
      const stamp = new Date().toISOString().replace(/[:.]/g, '-');
      fs.copyFileSync(this.filePath, `${this.filePath}.corrupt-${stamp}.bak`);
    } catch {}
  }

  load() {
    if (this.loaded) return this.data;
    this.loaded = true;
    try {
      if (!fs.existsSync(this.filePath)) return this.data;
      const raw = JSON.parse(fs.readFileSync(this.filePath, 'utf8'));
      this.data = this._sanitize(this._migrate(raw));
    } catch {
      this._backupCorruptFile();
      // Try the most recent backup before falling back to an empty library.
      try {
        const backup = `${this.filePath}.bak`;
        if (fs.existsSync(backup)) {
          const raw = JSON.parse(fs.readFileSync(backup, 'utf8'));
          this.data = this._sanitize(this._migrate(raw));
        }
      } catch {
        this.data = { schemaVersion: SCHEMA_VERSION, library: [], playlists: [] };
      }
    }
    return this.data;
  }

  _migrate(raw) {
    const source = raw && typeof raw === 'object' ? raw : {};
    const version = Number(source.schemaVersion || 1);
    // v1 had the same shape but no explicit schema version.
    if (version <= 1) return { ...source, schemaVersion: SCHEMA_VERSION };
    return source;
  }

  read() {
    return this.load();
  }

  write(data, { immediate = false } = {}) {
    this.data = this._sanitize(data);
    this.loaded = true;
    this.writeVersion += 1;
    const version = this.writeVersion;
    clearTimeout(this.writeTimer);
    if (immediate) return this.flush();
    this.writeTimer = setTimeout(() => { void this.flush(); }, 750);
    return new Promise(resolve => this.pendingResolve.push({ version, resolve }));
  }

  recoveryInfo() {
    const candidates = [];
    for (const file of [`${this.filePath}.bak`, ...this._corruptBackups()]) {
      try {
        if (!fs.existsSync(file)) continue;
        const raw = JSON.parse(fs.readFileSync(file, 'utf8'));
        if (!raw || typeof raw !== 'object') continue;
        candidates.push({ path: file, modifiedAt: fs.statSync(file).mtimeMs });
      } catch {}
    }
    candidates.sort((a, b) => b.modifiedAt - a.modifiedAt);
    return candidates;
  }

  _corruptBackups() {
    try {
      return fs.readdirSync(path.dirname(this.filePath))
        .filter(name => name.startsWith(path.basename(this.filePath) + '.corrupt-') && name.endsWith('.bak'))
        .map(name => path.join(path.dirname(this.filePath), name));
    } catch { return []; }
  }

  async restoreLatestBackup() {
    const candidates = this.recoveryInfo();
    if (!candidates.length) return false;
    try {
      const latest = candidates[0].path;
      const raw = JSON.parse(fs.readFileSync(latest, 'utf8'));
      this.data = this._sanitize(this._migrate(raw));
      this.loaded = true;
      await this.write(this.data, { immediate: true });
      return true;
    } catch { return false; }
  }

  async flush() {
    clearTimeout(this.writeTimer);
    this.writeTimer = null;
    if (this.writePromise) return this.writePromise;
    const snapshot = this.data;
    const version = this.writeVersion;
    this.writePromise = (async () => {
      let ok = false;
      let failure = null;
      try {
        await fs.promises.mkdir(path.dirname(this.filePath), { recursive: true });
        const tmp = `${this.filePath}.tmp`;
        await fs.promises.writeFile(tmp, JSON.stringify(snapshot), 'utf8');
        const shouldBackup = this.lastBackupAt === 0 || (Date.now() - this.lastBackupAt) >= BACKUP_INTERVAL_MS;
        if (shouldBackup) {
          try {
            await fs.promises.copyFile(this.filePath, `${this.filePath}.bak`);
            this.lastBackupAt = Date.now();
          } catch {}
        }
        // Node перезаписывает файл при rename и на Windows, поэтому удалять цель
        // заранее не нужно: падение между rm и rename оставляло бы библиотеку
        // только в .bak. rm остаётся лишь как обработка EPERM/EACCES.
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
        ok = true;
        this.lastError = null;
        this.retryCount = 0;
        return true;
      } catch (err) {
        failure = err;
        this.lastError = err;
        try { await fs.promises.unlink(`${this.filePath}.tmp`); } catch {}
        return false;
      } finally {
        const currentWaiters = this.pendingResolve.splice(0);
        currentWaiters.forEach(({ version: waiterVersion, resolve }) => {
          if (waiterVersion <= version) resolve(ok);
          else this.pendingResolve.push({ version: waiterVersion, resolve });
        });
        this.writePromise = null;
        if (this.writeVersion > version) {
          clearTimeout(this.writeTimer);
          this.writeTimer = setTimeout(() => { void this.flush(); }, 0);
        } else if (!ok && failure) {
          // Не теряем правки молча: сообщаем наверх и повторяем запись с
          // нарастающей паузой (занятый файл, антивирус, временный сбой диска).
          if (this.onError) { try { this.onError(failure); } catch {} }
          this.retryCount += 1;
          if (this.retryCount <= 5) {
            clearTimeout(this.retryTimer);
            this.retryTimer = setTimeout(() => { void this.flush(); }, Math.min(30000, 2000 * this.retryCount));
          }
        }
      }
    })();
    return this.writePromise;
  }

}

module.exports = { LibraryStore, SCHEMA_VERSION };
