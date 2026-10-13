const fs = require('fs');
const path = require('path');

function normalizePath(p) { return path.resolve(String(p || '')).replace(/\\/g, '/').toLowerCase(); }
function sanitizeFolderName(name) {
  const cleaned = String(name || 'Плейлист')
    .replace(/[<>:"/\\|?*\x00-\x1F]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/[. ]+$/, '');
  return cleaned || 'Плейлист';
}
function statKey(filePath) {
  try {
    const st = fs.statSync(filePath);
    return `${st.size}:${Math.round(st.mtimeMs)}`;
  } catch { return ''; }
}

async function statKeyAsync(filePath) {
  try {
    const st = await fs.promises.stat(filePath);
    return `${st.size}:${Math.round(st.mtimeMs)}`;
  } catch { return ''; }
}

function collectAudioFiles(root, audioExt, excludedRoot = '') {
  const out = [];
  const excluded = excludedRoot ? normalizePath(excludedRoot) : '';
  if (!root || !fs.existsSync(root)) return out;
  // Iterative traversal avoids deep recursive call stacks on large music folders.
  const stack = [root];
  while (stack.length) {
    const dir = stack.pop();
    let entries = [];
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { continue; }
    for (const entry of entries) {
      const full = path.join(dir, entry.name);
      const key = normalizePath(full);
      if (entry.isDirectory()) {
        // Служебные каталоги (например, .localify-ytdlp-* от загрузок) не часть
        // музыкальной библиотеки, поэтому обход в них не заходит.
        if (entry.name.startsWith('.')) continue;
        if (!(excluded && (key === excluded || key.startsWith(excluded + '/')))) stack.push(full);
      } else if (audioExt.has(path.extname(entry.name).toLowerCase())) {
        out.push(full);
      }
    }
  }
  return out;
}

async function collectAudioFilesAsync(root, audioExt, excludedRoot = '', { concurrency = 8 } = {}) {
  const out = [];
  const excluded = excludedRoot ? normalizePath(excludedRoot) : '';
  if (!root) return out;
  try {
    const rootStat = await fs.promises.stat(root);
    if (!rootStat.isDirectory()) return out;
  } catch { return out; }

  const queue = [root];
  let active = 0;
  let settled = false;
  const workerCount = Math.max(1, Math.min(Number(concurrency) || 8, 16));

  return await new Promise(resolve => {
    const pump = () => {
      if (settled) return;
      while (active < workerCount && queue.length) {
        const dir = queue.pop();
        active += 1;
        fs.promises.readdir(dir, { withFileTypes: true })
          .then(entries => {
            for (const entry of entries) {
              const full = path.join(dir, entry.name);
              const key = normalizePath(full);
              if (entry.isDirectory()) {
                if (entry.name.startsWith('.')) continue;
                if (!(excluded && (key === excluded || key.startsWith(excluded + '/')))) queue.push(full);
              } else if (entry.isFile() && audioExt.has(path.extname(entry.name).toLowerCase())) {
                out.push(full);
              }
            }
          })
          .catch(() => {})
          .finally(() => {
            active -= 1;
            if (!active && !queue.length) {
              settled = true;
              resolve(out);
              return;
            }
            pump();
          });
      }
      if (!active && !queue.length && !settled) {
        settled = true;
        resolve(out);
      }
    };
    pump();
  });
}

function safeMoveToFolder(src, dstFolder) {
  if (!src || !fs.existsSync(src)) throw new Error('Source file missing');
  fs.mkdirSync(dstFolder, { recursive: true });
  const ext = path.extname(src), stem = path.basename(src, ext);
  let dest = path.join(dstFolder, path.basename(src)), i = 2;
  while (fs.existsSync(dest)) dest = path.join(dstFolder, `${stem} (${i++})${ext}`);
  try {
    fs.renameSync(src, dest);
  } catch (err) {
    // Другой диск (EXDEV) и занятые файлы (EPERM/EBUSY) раньше приводили к
    // «Не удалось переместить трек»: переносим копированием с сохранением даты.
    if (!['EXDEV', 'EPERM', 'EACCES', 'EBUSY'].includes(err?.code)) throw err;
    fs.copyFileSync(src, dest);
    try {
      const stat = fs.statSync(src);
      fs.utimesSync(dest, stat.atime, stat.mtime);
    } catch {}
    try {
      fs.rmSync(src, { force: true });
    } catch (removeErr) {
      console.warn('[move] файл скопирован, но исходный удалить не удалось:', src, removeErr?.code || removeErr?.message);
    }
  }
  return dest;
}

module.exports = { normalizePath, sanitizeFolderName, statKey, statKeyAsync, collectAudioFiles, collectAudioFilesAsync, safeMoveToFolder };
