const fs = require('fs');
const path = require('path');

// Файловый лог main-процесса: раньше логи жили только в localStorage
// рендерера и терялись вместе с профилем, поэтому сбои вроде «скачивание
// упало» нечем было подтвердить. Пишем синхронно (объём небольшой) и
// ограничиваем размер, чтобы папка не росла бесконечно.
class FileLogger {
  constructor(filePath, { maxBytes = 2 * 1024 * 1024, maxLines = 4000 } = {}) {
    this.filePath = filePath;
    this.maxBytes = maxBytes;
    this.maxLines = maxLines;
    this.ready = false;
  }

  _ensureDir() {
    if (this.ready) return;
    try { fs.mkdirSync(path.dirname(this.filePath), { recursive: true }); } catch {}
    this.ready = true;
  }

  _rotateIfNeeded() {
    try {
      const stat = fs.statSync(this.filePath);
      if (stat.size < this.maxBytes) return;
      fs.rmSync(`${this.filePath}.1`, { force: true });
      fs.renameSync(this.filePath, `${this.filePath}.1`);
    } catch {}
  }

  write(level, message) {
    this._ensureDir();
    const text = String(message ?? '').replace(/\s+$/, '');
    if (!text) return;
    const line = `${new Date().toISOString()} [${level}] ${text}\n`;
    try {
      this._rotateIfNeeded();
      fs.appendFileSync(this.filePath, line, 'utf8');
    } catch {}
  }

  info(message) { this.write('info', message); }
  warn(message) { this.write('warn', message); }
  error(message) { this.write('error', message); }

  tail(lines = 200) {
    try {
      const content = fs.existsSync(this.filePath) ? fs.readFileSync(this.filePath, 'utf8') : '';
      const all = content.split(/\r?\n/).filter(Boolean);
      return all.slice(-Math.max(1, Number(lines) || 200)).join('\n');
    } catch { return ''; }
  }

  stats() {
    try {
      const stat = fs.statSync(this.filePath);
      return { path: this.filePath, bytes: stat.size, modifiedAt: stat.mtimeMs };
    } catch { return { path: this.filePath, bytes: 0, modifiedAt: 0 }; }
  }

  clear() {
    try { fs.rmSync(this.filePath, { force: true }); return true; } catch { return false; }
  }
}

module.exports = { FileLogger };
