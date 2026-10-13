const fs = require('fs');
const path = require('path');
const { spawn, spawnSync } = require('child_process');
const APP_VERSION = (() => { try { return require('../package.json').version; } catch { return 'dev'; } })();

const USER_AGENT = `LocalifyCrimson/${APP_VERSION} (+desktop music player)`;

function clean(v) { return String(v || '').trim(); }
function norm(v) { return clean(v).toLocaleLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g,''); }
function similarity(a,b){
  const aa=norm(a), bb=norm(b); if(!aa||!bb)return 0; if(aa===bb)return 1;
  const as=new Set(aa.split(/\s+/)), bs=new Set(bb.split(/\s+/));
  let inter=0; for(const x of as) if(bs.has(x)) inter++;
  return inter / Math.max(1, new Set([...as,...bs]).size);
}

function normalizeYoutubeArtist(value='') {
  return norm(value)
    .replace(/\s*[-|•]\s*(official\s*)?topic$/i, '')
    .replace(/\s*(vevo|official)$/i, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function normalizeYoutubeTitle(value='') {
  let text = norm(value).replace(/\s+/g, ' ').trim();
  // Strip presentation-only labels while keeping meaningful versions such as
  // live/remix/acoustic/karaoke/slowed/cover as distinct tracks.
  text = text
    .replace(/\[(?:official\s+)?(?:music\s+)?video\]/gi, ' ')
    .replace(/\[(?:official\s+)?audio\]/gi, ' ')
    .replace(/\((?:official\s+)?(?:music\s+)?video\)/gi, ' ')
    .replace(/\((?:official\s+)?audio\)/gi, ' ')
    .replace(/\b(?:official\s+music\s+video|official\s+video|official\s+audio|lyric\s+video|lyrics?|visualizer|audio|video|hd|hq|4k|1080p|720p)\b/gi, ' ')
    .replace(/[-|•]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return text;
}

function canonicalYoutubeKey(track={}) {
  const artist = normalizeYoutubeArtist(track.artist || track.channel || track.uploader || '');
  const title = normalizeYoutubeTitle(track.title || '');
  if (!title) return '';
  return artist && artist !== 'youtube' ? `${artist}::${title}` : title;
}

function youtubeCandidateQuality(track={}) {
  const text = norm(track.title || '').replace(/\s+/g, ' ').trim();
  let score = 0;
  if (/\bofficial\s+audio\b/.test(text)) score += 5;
  if (/\btopic\b/.test(text)) score += 3;
  if (/\bofficial\s+music\s+video\b/.test(text)) score += 3;
  if (/\baudio\b/.test(text)) score += 1;
  if (/\blyrics?\b/.test(text)) score -= 1;
  if (/\blive\b/.test(text)) score -= 2;
  if (/\bcover\b/.test(text)) score -= 2;
  if (/\bkaraoke\b/.test(text)) score -= 3;
  return score;
}

function dedupeYoutubeResults(results, localLibrary=[], limit=12) {
  const localKeys = new Set((localLibrary || []).map(canonicalYoutubeKey).filter(Boolean));
  const chosen = new Map();
  for (let index = 0; index < (results || []).length; index++) {
    const item = results[index];
    const key = canonicalYoutubeKey(item) || String(item?.providerId || item?.sourceUrl || `result:${index}`);
    if (localKeys.has(key)) continue;
    const wrapped = { item, index, score: youtubeCandidateQuality(item) };
    const previous = chosen.get(key);
    if (!previous || wrapped.score > previous.score || (wrapped.score === previous.score && index < previous.index)) {
      chosen.set(key, wrapped);
    }
  }
  return [...chosen.values()]
    .sort((a,b) => a.index - b.index)
    .map(x => x.item)
    .slice(0, Math.max(1, Number(limit) || 12));
}


function sanitizeFileStem(value) {
  return clean(value)
    .replace(/[<>:"/\\|?*\x00-\x1F]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/[. ]+$/, '') || 'Track';
}

function runProcess(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    const { onProgress, ...spawnOptions } = options || {};
    const child = spawn(command, args, { ...spawnOptions, windowsHide: true });
    const handleProgress = (chunk) => {
      if (typeof onProgress !== 'function') return;
      const text = chunk.toString();
      const matches = text.match(/(\d+(?:\.\d+)?)%/g);
      if (!matches?.length) return;
      const raw = matches[matches.length - 1].replace('%','');
      const percent = Math.max(0, Math.min(100, Number(raw)));
      if (Number.isFinite(percent)) onProgress(percent);
    };
    let stdout = '';
    let stderr = '';
    child.stdout?.on('data', chunk => { stdout += chunk.toString(); handleProgress(chunk); });
    child.stderr?.on('data', chunk => { stderr += chunk.toString(); handleProgress(chunk); });
    child.on('error', err => reject(err));
    child.on('close', code => {
      if (code === 0) return resolve({ stdout, stderr });
      const detail = (stderr || stdout).trim().split(/\r?\n/).filter(Boolean).slice(-10).join('\n');
      const err = new Error(`yt-dlp завершился с кодом ${code}${detail ? `: ${detail}` : ''}`);
      err.code = code;
      err.stdout = stdout;
      err.stderr = stderr;
      err.ytDlp = true;
      reject(err);
    });
  });
}

function commandAvailable(command, args=['--version']) {
  try {
    const result = spawnSync(command, args, { windowsHide: true, encoding: 'utf8', timeout: 5000 });
    return result.status === 0;
  } catch { return false; }
}

let runtimeCache;
function detectJsRuntimeArgs() {
  if (runtimeCache !== undefined) return runtimeCache;
  // Current yt-dlp uses an external JS runtime for YouTube challenge solving.
  // Prefer Deno when available; fall back to Node 22+.
  try {
    const deno = spawnSync('deno', ['--version'], { windowsHide: true, encoding: 'utf8', timeout: 5000 });
    if (deno.status === 0 && /^deno\s+\d+\.\d+/i.test(String(deno.stdout || ''))) {
      const m = String(deno.stdout || '').match(/^deno\s+(\d+)\.(\d+)/i);
      if (m && (Number(m[1]) > 2 || (Number(m[1]) === 2 && Number(m[2]) >= 3))) {
        return runtimeCache = ['--js-runtimes', 'deno'];
      }
    }
  } catch {}
  try {
    const node = spawnSync('node', ['--version'], { windowsHide: true, encoding: 'utf8', timeout: 5000 });
    if (node.status === 0) {
      const m = String(node.stdout || '').trim().match(/^v(\d+)/i);
      if (m && Number(m[1]) >= 22) return runtimeCache = ['--js-runtimes', 'node'];
    }
  } catch {}
  return runtimeCache = [];
}

const ytdlpVersionCache = new Map();
async function getYtDlpVersion(executable) {
  const key = String(executable || 'yt-dlp');
  if (ytdlpVersionCache.has(key)) return ytdlpVersionCache.get(key);
  try {
    const result = await runProcess(key, ['--version']);
    const version = String(result.stdout || '').trim().split(/\r?\n/)[0];
    ytdlpVersionCache.set(key, version);
    return version;
  } catch {
    ytdlpVersionCache.set(key, '');
    return '';
  }
}
function invalidateYtDlpVersion(executable) {
  ytdlpVersionCache.delete(String(executable || 'yt-dlp'));
}

// YouTube ломает старые сборки yt-dlp каждые несколько недель, поэтому версию
// сравниваем с последним релизом на GitHub и умеем обновляться из приложения.
async function getLatestYtDlpVersion() {
  try {
    const res = await fetch('https://api.github.com/repos/yt-dlp/yt-dlp/releases/latest', {
      headers: { 'User-Agent': USER_AGENT, Accept: 'application/vnd.github+json' },
      signal: AbortSignal.timeout(8000)
    });
    if (!res.ok) return '';
    const data = await res.json();
    return String(data?.tag_name || '').trim();
  } catch { return ''; }
}

async function updateYtDlp(executable = 'yt-dlp') {
  const exe = executable || 'yt-dlp';
  try {
    const result = await runProcess(exe, ['-U']);
    invalidateYtDlpVersion(exe);
    const detail = String(`${result.stdout || ''}\n${result.stderr || ''}`).trim().split(/\r?\n/).filter(Boolean).slice(-3).join(' ');
    return { ok: true, message: detail || 'yt-dlp обновлён', version: await getYtDlpVersion(exe) };
  } catch (err) {
    invalidateYtDlpVersion(exe);
    const detail = String(err?.message || err || '').trim().split(/\r?\n/).filter(Boolean).slice(-3).join(' ');
    return { ok: false, message: detail || 'Не удалось обновить yt-dlp' };
  }
}

function findFfmpegPath(ytDlpExecutable) {
  const candidates = [];
  const resolved = ytDlpExecutable ? resolveExecutable(ytDlpExecutable) : '';
  if (resolved && path.isAbsolute(resolved)) {
    candidates.push(path.join(path.dirname(resolved), process.platform === 'win32' ? 'ffmpeg.exe' : 'ffmpeg'));
  }
  candidates.push(process.platform === 'win32' ? 'ffmpeg.exe' : 'ffmpeg');
  for (const candidate of candidates) {
    const found = resolveExecutable(candidate);
    if (found) return found;
  }
  return '';
}

async function remoteEjsArgs(executable) {
  const runtime = detectJsRuntimeArgs();
  if (!runtime.length) return [];
  // Official executables bundle EJS. For pip/third-party installations, newer
  // yt-dlp can fetch EJS from GitHub when explicitly permitted.
  const version = await getYtDlpVersion(executable);
  const m = version.match(/^(\d{4})\.(\d{2})\.(\d{2})$/);
  if (m && Number(m[1]) >= 2025) return [...runtime, '--remote-components', 'ejs:github'];
  return runtime;
}

function ytDlpArgsBase(proxy='', options={}, extraArgs=[]) {
  const args = [
    '--no-playlist', '--no-warnings', '--socket-timeout', '20',
    '--retries', '3', '--extractor-retries', '3'
  ];
  if (proxy) args.push('--proxy', proxy);
  // An explicitly provided cookies.txt is the most reliable source on Windows:
  // it needs neither a browser profile nor DPAPI/App-Bound decryption.
  const cookiesFile = resolveCookiesFile(options?.cookiesFile);
  if (cookiesFile) args.push('--cookies', cookiesFile);
  const browser = cookiesFile ? '' : clean(options?.cookiesFromBrowser);
  if (browser && /^[a-z0-9_:-]+$/i.test(browser)) args.push('--cookies-from-browser', browser);
  const ua = clean(options?.userAgent);
  if (ua) args.push('--user-agent', ua);
  const extractorArgs = clean(options?.extractorArgs);
  if (extractorArgs) args.push('--extractor-args', extractorArgs);
  if (Array.isArray(extraArgs) && extraArgs.length) args.push(...extraArgs);
  return args;
}

function isYoutube403(err) {
  const text = String(err?.message || err?.stderr || err || '');
  return /HTTP Error 403|403 Forbidden|unable to download video data/i.test(text);
}
function isYoutubeBotChallenge(err) {
  const text = String(err?.message || err?.stderr || err || '');
  return /sign in to confirm|not a bot|captcha|challenge|PO Token|botguard|javascript challenge|only images are available/i.test(text);
}
function isMissingBrowserCookies(err) {
  const text = String(err?.message || err?.stderr || err || '');
  return /could not find .*cookies? database|could not find .*cookies? file|failed to find .*cookies?|cookies? database.*not found|could not access .*cookies?/i.test(text);
}
// Chrome/Edge 127+ encrypt their cookie store with App-Bound Encryption, which
// yt-dlp cannot unwrap; the only visible symptom is "Failed to decrypt with
// DPAPI" (https://github.com/yt-dlp/yt-dlp/issues/10927).
function isUndecryptableBrowserCookies(err) {
  const text = String(err?.message || err?.stderr || err || '');
  return /failed to decrypt with dpapi|dpapi|app-bound encryption|failed to decrypt|decrypt.*cookies?|cookies?.*decrypt/i.test(text);
}
function isBrowserCookiesUnusable(err) {
  return isMissingBrowserCookies(err) || isUndecryptableBrowserCookies(err);
}

const BROWSER_COOKIE_PROFILE_DIRS = {
  chrome: ['LOCALAPPDATA', 'Google', 'Chrome', 'User Data'],
  edge: ['LOCALAPPDATA', 'Microsoft', 'Edge', 'User Data'],
  firefox: ['APPDATA', 'Mozilla', 'Firefox', 'Profiles']
};
// Cookie sources that already proved unusable in this run. Remembering them
// stops every later search/download from paying for the same failure again.
const unusableCookieSources = new Map();
function browserCookieProfilePath(browser) {
  const parts = BROWSER_COOKIE_PROFILE_DIRS[browser];
  if (!parts) return '';
  const root = process.env[parts[0]] || '';
  if (!root) return '';
  const candidate = path.join(root, ...parts.slice(1));
  try { return fs.existsSync(candidate) ? candidate : ''; } catch { return ''; }
}
function cookieSourceState(browser) {
  const known = unusableCookieSources.get(browser);
  if (known) return known;
  return browserCookieProfilePath(browser) ? 'profile-found' : 'profile-missing';
}
function describeCookieSourceState(state) {
  if (state === 'dpapi') return 'не удалось расшифровать (DPAPI / App-Bound Encryption)';
  if (state === 'unreadable') return 'cookies недоступны';
  if (state === 'profile-missing') return 'профиль браузера не найден';
  return 'профиль найден, расшифровка ещё не проверялась';
}
function resolveCookiesFile(value) {
  const file = clean(value);
  if (!file) return '';
  try { return fs.statSync(file).isFile() ? file : ''; } catch { return ''; }
}
function youtubeCookieNote(cookieFailures = []) {
  if (!cookieFailures.length) return '';
  return `Браузерные cookies: ${cookieFailures.map(f => `${f.browser} — ${describeCookieSourceState(f.reason)}`).join('; ')}.`;
}
function buildYoutubeHint(err, cookieFailures = []) {
  const note = youtubeCookieNote(cookieFailures);
  const advice = 'Рабочие варианты: войдите в YouTube в Firefox (yt-dlp читает его cookies напрямую) или экспортируйте cookies в файл cookies.txt (расширение «Get cookies.txt LOCALLY») и укажите его в «Настройки → YouTube и yt-dlp».';
  if (isYoutubeBotChallenge(err)) {
    return `YouTube требует подтвердить вход («Sign in to confirm you're not a bot»).${note ? ` ${note}` : ''} ${advice}`;
  }
  if (isYoutube403(err)) {
    return `YouTube отклонил выдачу файла (403).${note ? ` ${note}` : ''} ${advice}`;
  }
  if (note) {
    return `Crimson не смог использовать браузерные cookies. ${note} ${advice}`;
  }
  return '';
}
function isTransientYoutubeError(err) {
  const text = String(err?.message || err?.stderr || err || '');
  return /the page needs to be reloaded|requested format is not available|some formats may be missing|unable to extract|nsig extraction failed|player response|timed out|connection reset|temporarily unavailable/i.test(text);
}
function isDnsError(err) {
  const text = String(err?.message || err?.stderr || err || '');
  return /getaddrinfo failed|ENOTFOUND|Temporary failure in name resolution|Could not resolve host/i.test(text);
}

function youtubeStrategies({ includeCookies=false } = {}) {
  const out = [
    { id:'default', label:'стандартный режим YouTube', extra:[] },
    { id:'android_vr', label:'совместимый клиент Android VR', extra:['--extractor-args','youtube:player_client=android_vr'] },
    { id:'web_embedded', label:'совместимый встроенный клиент YouTube', extra:['--extractor-args','youtube:player_client=web_embedded'] },
    { id:'web_safari', label:'HLS-клиент YouTube', extra:['--extractor-args','youtube:player_client=web_safari'] }
  ];
  if (includeCookies) {
    for (const browser of ['chrome','edge','firefox']) {
      out.push({ id:`cookies_${browser}`, browser, label:`браузерные cookies (${browser})`, extra:['--cookies-from-browser', browser] });
    }
  }
  return out;
}

async function getYtArgs(executable, proxy, options, strategy) {
  const base = ytDlpArgsBase(proxy, options, strategy?.extra || []);
  const runtime = await remoteEjsArgs(executable);
  return [...base, ...runtime];
}

// Стратегия, которая уже сработала, ставится первой: иначе каждая загрузка
// заново перебирает клиентов, которых YouTube только что отклонил (≈3 с на
// попытку, ~10 с на загрузку).
let preferredStrategyId = '';
function orderStrategiesByPreference(attempts) {
  if (!preferredStrategyId) return attempts;
  const index = attempts.findIndex(item => item.id === preferredStrategyId);
  if (index <= 0) return attempts;
  const [preferred] = attempts.splice(index, 1);
  attempts.unshift(preferred);
  // Порядок остальных сохраняем: если «любимая» стратегия перестанет работать,
  // перебор идёт как раньше.
  return attempts;
}
function setPreferredStrategy(id) { preferredStrategyId = String(id || ''); }
function getPreferredStrategy() { return preferredStrategyId; }

async function runYoutubeWithFallback(executable, buildArgs, options={}, { browserCookies = true } = {}) {
  const attempts = orderStrategiesByPreference(youtubeStrategies({ includeCookies: browserCookies }));
  const cookieFailures = [];
  let lastErr = null;
  let lastMeaningfulErr = null;
  for (let i = 0; i < attempts.length; i++) {
    const strategy = attempts[i];
    if (strategy.browser) {
      // Skip cookie sources that are already known to be unusable, and check the
      // profile on disk before spawning yt-dlp for a source that cannot work.
      const known = unusableCookieSources.get(strategy.browser);
      if (known) {
        cookieFailures.push({ browser: strategy.browser, reason: known });
        continue;
      }
      if (!browserCookieProfilePath(strategy.browser)) {
        unusableCookieSources.set(strategy.browser, 'profile-missing');
        cookieFailures.push({ browser: strategy.browser, reason: 'profile-missing' });
        continue;
      }
    }
    let failure = null;
    for (let tryIndex = 0; tryIndex < 2; tryIndex++) {
      try {
        const args = await buildArgs(strategy);
        const result = await runProcess(executable || 'yt-dlp', args, options);
        setPreferredStrategy(strategy.id);
        return result;
      } catch (err) {
        failure = err;
        // «The page needs to be reloaded» и подобные ответы YouTube проходят
        // сами: повторяем ту же стратегию один раз, прежде чем менять клиента.
        if (tryIndex === 0 && !strategy.browser && isTransientYoutubeError(err)) {
          await new Promise(resolve => setTimeout(resolve, 700));
          continue;
        }
        break;
      }
    }
    const err = failure;
    {
      // Browser cookies are only an optional fallback: a missing profile, a
      // missing cookies database or a store that cannot be decrypted (DPAPI /
      // App-Bound Encryption) must disable that one source, never abort the
      // whole chain with a misleading final error.
      if (strategy.browser && isBrowserCookiesUnusable(err)) {
        const reason = isUndecryptableBrowserCookies(err) ? 'dpapi' : 'unreadable';
        unusableCookieSources.set(strategy.browser, reason);
        cookieFailures.push({ browser: strategy.browser, reason });
        continue;
      }
      lastErr = err;
      lastMeaningfulErr = err;
      const recoverable = isYoutube403(err) || isYoutubeBotChallenge(err) || isTransientYoutubeError(err);
      if (!recoverable) throw err;
      if (i < attempts.length - 1) continue;
    }
  }
  const finalErr = lastMeaningfulErr || lastErr || new Error('yt-dlp не смог обработать видео YouTube');
  finalErr.cookieFailures = cookieFailures;
  const hint = buildYoutubeHint(finalErr, cookieFailures);
  if (hint) finalErr.youtubeHint = hint;
  throw finalErr;
}


async function ytDlpSearch(query, executable='yt-dlp', proxy='', limit=12, ytOptions={}, localLibrary=[]) {
  const q = clean(query);
  if (!q) return [];
  const safeLimit = Math.min(20, Math.max(1, Number(limit) || 12));
  // Fetch extra candidates because duplicates and tracks already in the local
  // library are filtered out before the user sees the results.
  const searchLimit = Math.min(30, Math.max(safeLimit * 3, 15));
  const search = `ytsearch${searchLimit}:${q}`;
  let result;
  try {
    result = await runYoutubeWithFallback(executable || 'yt-dlp',
      async (strategy) => [search, ...await getYtArgs(executable || 'yt-dlp', proxy, ytOptions, strategy), '--skip-download', '--flat-playlist', '--dump-single-json', '--ignore-errors'],
      {},
      { browserCookies: !resolveCookiesFile(ytOptions?.cookiesFile) });
  } catch (err) {
    if (err?.code === 'ENOENT') throw new Error('yt-dlp не найден. Укажите полный путь к yt-dlp.exe в настройках.');
    if (isDnsError(err)) throw new Error('yt-dlp не может разрешить адрес YouTube. Проверьте интернет/DNS.');
    if (err?.youtubeHint) throw new Error(err.youtubeHint);
    throw err;
  }
  let data = null;
  try { data = JSON.parse(String(result?.stdout || '').trim()); } catch {}
  const entries = Array.isArray(data?.entries) ? data.entries : (data?.id ? [data] : []);
  const mapped = entries.filter(Boolean).map((item) => {
    const id = String(item.id || '');
    const title = clean(item.title) || 'Без названия';
    const artist = clean(item.channel || item.uploader || item.uploader_id) || 'YouTube';
    const webpage = item.webpage_url || (id ? `https://www.youtube.com/watch?v=${encodeURIComponent(id)}` : '');
    return {
      provider: 'youtube', providerId: id || webpage || `${artist}::${title}`,
      title, artist, album: '', duration: Number(item.duration || 0),
      cover: item.thumbnail || (id ? `https://i.ytimg.com/vi/${encodeURIComponent(id)}/hqdefault.jpg` : ''),
      streamUrl: '', previewUrl: '', downloadAllowed: true,
      sourceUrl: webpage, popularity: Number(item.view_count || 0), tags: [],
      license: '', attribution: 'Найдено через YouTube / yt-dlp'
    };
  }).filter(item => item.sourceUrl);
  return dedupeYoutubeResults(mapped, localLibrary, safeLimit);
}

async function ytDlpResolveStream(candidate, executable='yt-dlp', proxy='', ytOptions={}) {
  if (!candidate?.title || !candidate?.artist) throw new Error('Для воспроизведения нужны название и исполнитель');
  // Only trust a direct URL when the candidate itself came from YouTube; otherwise resolve through YouTube search.
  const sourceUrl = clean(candidate.sourceUrl);
  let directUrl = '';
  try {
    const host = new URL(sourceUrl).hostname.toLowerCase();
    if (candidate.provider === 'youtube' && /(^|\.)youtube\.com$|(^|\.)youtu\.be$/.test(host)) directUrl = sourceUrl;
  } catch {}
  const search = directUrl || `ytsearch1:${candidate.artist} - ${candidate.title}`;
  let result;
  try {
    result = await runYoutubeWithFallback(executable || 'yt-dlp',
      async (strategy) => [search, ...await getYtArgs(executable || 'yt-dlp', proxy, ytOptions, strategy), '--get-url', '-f', 'bestaudio[acodec!=none]/bestaudio/best'],
      {},
      { browserCookies: !resolveCookiesFile(ytOptions?.cookiesFile) });
  } catch (err) {
    if (err?.code === 'ENOENT') throw new Error('yt-dlp не найден. Укажите полный путь к yt-dlp.exe в настройках.');
    if (isDnsError(err)) throw new Error('yt-dlp не может разрешить адрес YouTube. Проверьте интернет/DNS.');
    if (err?.youtubeHint) throw new Error(err.youtubeHint);
    throw err;
  }
  const urls = String(result?.stdout || '').trim().split(/\r?\n/).map(s=>s.trim()).filter(Boolean);
  const url = urls.reverse().find(s => /^https?:\/\//i.test(s));
  if (!url) {
    const detail = String(result?.stderr || '').trim().split(/\r?\n/).filter(Boolean).slice(-4).join('\n');
    const raw=detail || '';
    if (/Sign in to confirm you're not a bot|not a bot|captcha|cookies-from-browser/i.test(raw)) {
      throw new Error('YouTube отклонил выдачу потока. Crimson уже попробовал несколько клиентов и браузерные cookies. Обновите yt-dlp до актуальной версии; при необходимости установите Deno 2.3+ или Node 22+ для решения JavaScript-проверок YouTube.');
    }
    throw new Error(`yt-dlp не смог получить поток${detail ? `: ${detail}` : ''}`);
  }
  return { url, resolvedAt: Date.now() };
}

function cleanupDownloadArtifacts(folder, stem, tempDir='') {
  const names = [
    `${stem}.mp3.temp`,
    `${stem}.temp`,
    `${stem}.mp3.part`,
    `${stem}.part`,
    `${stem}.webm.part`,
    `${stem}.m4a.part`,
    `${stem}.opus.part`,
    `${stem}.mp3.ytdl`
  ];
  for (const name of names) {
    try {
      const p = path.join(folder, name);
      if (fs.existsSync(p) && fs.statSync(p).isFile()) fs.rmSync(p, { force: true });
    } catch {}
  }
  if (tempDir) {
    try { fs.rmSync(tempDir, { recursive: true, force: true }); } catch {}
  }
}

function isDownloadTempDirName(name) { return /^\.localify-ytdlp-/i.test(String(name || '')); }

async function removeDirWithRetry(target, attempts = 3, delayMs = 200) {
  for (let attempt = 1; attempt <= attempts; attempt++) {
    try { fs.rmSync(target, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 }); return true; }
    catch { if (attempt < attempts) await new Promise(resolve => setTimeout(resolve, delayMs)); }
  }
  return false;
}

// Временные папки yt-dlp остаются в «Localify Downloads», если приложение
// закрыли во время загрузки или Windows не сразу отдала дескриптор. Убирать их
// безопасно только когда ни одна загрузка не выполняется (см. main.js).
async function cleanupStaleDownloadTempDirs(destinationRoot) {
  const folder = path.join(String(destinationRoot || ''), 'Localify Downloads');
  let entries = [];
  try { entries = fs.readdirSync(folder, { withFileTypes: true }); } catch { return 0; }
  let removed = 0;
  for (const entry of entries) {
    if (!entry.isDirectory() || !isDownloadTempDirName(entry.name)) continue;
    if (await removeDirWithRetry(path.join(folder, entry.name))) removed++;
    else console.warn('[clean] не удалось удалить временную папку загрузки:', entry.name);
  }
  return removed;
}

async function ytDlpDownload(candidate, destinationRoot, executable='yt-dlp', proxy='', onProgress=null, ytOptions={}) {
  if (!candidate?.title || !candidate?.artist) throw new Error('Для скачивания нужны название и исполнитель');
  const folder=path.join(destinationRoot,'Localify Downloads');
  fs.mkdirSync(folder,{recursive:true});
  const base=sanitizeFileStem(`${candidate.artist} - ${candidate.title}`);
  let targetBase=path.join(folder,base), index=2;
  while(fs.existsSync(`${targetBase}.mp3`)) targetBase=path.join(folder,`${base} (${index++})`);

  // Clean leftovers from an interrupted post-processing step so *.temp files
  // are never mistaken for a second copy of the song.
  cleanupDownloadArtifacts(folder, path.basename(targetBase));

  // Keep yt-dlp's temporary download/post-processing files outside the music
  // folder. This prevents visible *.temp files next to the final MP3.
  const tempDir=fs.mkdtempSync(path.join(folder,'.localify-ytdlp-'));
  // Every retry gets its own temp dir; keep the full list so a failed download
  // never leaves .localify-ytdlp-* folders behind.
  const attemptTempDirs=new Set([tempDir]);

  // Direct URLs are used only for YouTube candidates.
  const sourceUrl = clean(candidate.sourceUrl);
  let directSource = '';
  try {
    const host = new URL(sourceUrl).hostname.toLowerCase();
    if (candidate.provider === 'youtube' && /(^|\.)youtube\.com$|(^|\.)youtu\.be$/.test(host)) directSource = sourceUrl;
  } catch {}
  const source = directSource || `ytsearch1:${candidate.artist} - ${candidate.title}`;
  // Имя выходного файла берём из targetBase: цикл выше уже подобрал
  // свободное «Исполнитель - Трек (2)», иначе загрузка перезаписала бы
  // существующий файл с тем же именем.
  const outputStem = path.basename(targetBase);
  // «MP3» требует FFmpeg: без него шаги --extract-audio/--embed-thumbnail
  // валят загрузку целиком. В этом случае сохраняем исходный поток (m4a/opus),
  // а не отдаём пользователю ошибку «ffmpeg not found».
  const requestedMode = clean(ytOptions?.downloadMode) === 'original' ? 'original' : 'mp3';
  const ffmpegPath = requestedMode === 'mp3' ? findFfmpegPath(executable) : '';
  const audioOnly = requestedMode === 'original' || !ffmpegPath;
  const audioFallback = requestedMode === 'mp3' && !ffmpegPath;
  const outputExtensions = audioOnly ? new Set(['.m4a','.webm','.opus','.ogg','.aac','.mp3','.wav','.flac']) : new Set(['.mp3']);
  const postProcessArgs = audioOnly
    ? ['-f','bestaudio[acodec!=none]/bestaudio/best']
    : ['--extract-audio','--audio-format','mp3','--audio-quality','0','--embed-metadata','--embed-thumbnail','--convert-thumbnails','jpg','--ffmpeg-location',ffmpegPath];
  let result;
  let lastDownloadError = null;
  // Windows/Defender can briefly lock the temporary MP3 while yt-dlp/FFmpeg
  // is trying to rename it. Retry the whole yt-dlp operation with a fresh
  // temporary directory instead of making the user press Download again.
  const maxAttempts = 3;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const attemptTempDir = attempt === 1 ? tempDir : fs.mkdtempSync(path.join(folder,'.localify-ytdlp-'));
    attemptTempDirs.add(attemptTempDir);
    try {
      result = await runYoutubeWithFallback(executable || 'yt-dlp',
        async (strategy) => [
          source,
          ...await getYtArgs(executable || 'yt-dlp', proxy, ytOptions, strategy),
          '--fragment-retries','10',
          ...postProcessArgs,
          '--paths',`home:${folder}`, '--paths',`temp:${attemptTempDir}`,
          '--output',`${outputStem}.%(ext)s`
        ],
        { cwd: folder, onProgress },
        { browserCookies: !resolveCookiesFile(ytOptions?.cookiesFile) });
      lastDownloadError = null;
      await removeDirWithRetry(attemptTempDir);
      break;
    } catch(err) {
      lastDownloadError = err;
      const raw = String(err?.message || err?.stderr || err || '');
      const accessDenied = process.platform === 'win32' && (/WinError\s*5|Access is denied|Отказано в доступе/i.test(raw) || Number(err?.code) === 5);
      await removeDirWithRetry(attemptTempDir);
      if (!accessDenied || attempt >= maxAttempts) break;
      const delay = 500 * attempt;
      onProgress?.(Math.max(1, Math.min(96, 18 + attempt * 5)));
      await new Promise(resolve => setTimeout(resolve, delay));
    }
  }
  if (lastDownloadError) {
    cleanupDownloadArtifacts(folder, path.basename(targetBase));
    for (const dir of attemptTempDirs) await removeDirWithRetry(dir);
    const err = lastDownloadError;
    if(err?.code==='ENOENT') throw new Error('yt-dlp не найден. Укажите полный путь к yt-dlp.exe в настройках или добавьте yt-dlp в PATH.');
    if(isDnsError(err)) throw new Error('yt-dlp не может разрешить адрес YouTube. Проверьте интернет/DNS.');
    const raw = String(err?.message || err?.stderr || err || '');
    if(process.platform === 'win32' && (/WinError\s*5|Access is denied|Отказано в доступе/i.test(raw) || Number(err?.code) === 5)) {
      throw new Error('Windows заблокировала временный MP3 во время обработки. Crimson автоматически повторил скачивание 3 раза, но файл всё ещё был занят.');
    }
    if(err?.youtubeHint) throw new Error(err.youtubeHint);
    if(isYoutubeBotChallenge(err)) {
      throw new Error('YouTube отклонил запрос после нескольких способов подключения. Обновите yt-dlp до актуальной версии; для современных проверок YouTube также может потребоваться Deno 2.3+ или Node 22+.');
    }
    throw new Error(raw || 'Не удалось скачать трек через yt-dlp');
  }

  const expected=path.join(folder,`${outputStem}.mp3`);
  let file=(outputExtensions.has('.mp3') && fs.existsSync(expected)) ? expected : '';
  if(!file){
    // Fallback только для точного имени этого трека («Трек» или «Трек (2)»):
    // иначе «Artist - Song Live.mp3» мог быть выдан за результат этой загрузки.
    const stemPattern = new RegExp(`^${outputStem.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?: \\(\\d+\\))?$`, 'i');
    const matches=fs.readdirSync(folder)
      .filter(n=>{
        const ext=path.extname(n).toLowerCase();
        return outputExtensions.has(ext) && stemPattern.test(n.slice(0, -ext.length));
      })
      .map(n=>path.join(folder,n))
      .filter(n=>{ try{ return fs.statSync(n).mtimeMs>=Date.now()-5*60*1000; }catch{ return false; } })
      .sort((a,b)=>fs.statSync(b).mtimeMs-fs.statSync(a).mtimeMs);
    file=matches[0]||'';
  }
  cleanupDownloadArtifacts(folder, path.basename(targetBase));
  for (const dir of attemptTempDirs) await removeDirWithRetry(dir);

  if(!file||!fs.existsSync(file)){
    const detail=(result?.stderr||result?.stdout||'').trim().split(/\r?\n/).filter(Boolean).slice(-4).join('\n');
    if (/Sign in to confirm you're not a bot|not a bot|captcha|cookies-from-browser/i.test(detail)) {
      throw new Error('YouTube отклонил загрузку. Crimson уже попробовал несколько клиентов и браузерные cookies. Обновите yt-dlp до актуальной версии; для современных проверок YouTube также может потребоваться Deno 2.3+ или Node 22+.');
    }
    throw new Error(`${audioOnly ? 'yt-dlp не создал аудиофайл' : 'yt-dlp не создал MP3'}${detail?`: ${detail}`:''}`);
  }
  return {
    path:file,title:candidate.title,artist:candidate.artist,album:candidate.album||'',
    sourceUrl:candidate.sourceUrl||'',provider:candidate.provider||'youtube',
    // Превью ролика возвращается вместе с файлом: без FFmpeg миниатюра не
    // встраивается в теги, а онлайн-поиск для ролика с YouTube обычно ничего не
    // находит, поэтому обложку иначе взять неоткуда.
    cover:clean(candidate.cover),
    format:path.extname(file).slice(1).toLowerCase(),
    audioFallback
  };
}


function resolveExecutable(command) {
  const value = clean(command || '');
  if (!value) return '';
  if (path.isAbsolute(value) || value.includes('/') || value.includes('\\')) {
    try { return fs.existsSync(value) ? value : ''; } catch { return ''; }
  }
  try {
    const lookup = process.platform === 'win32' ? 'where' : 'which';
    const result = spawnSync(lookup, [value], { windowsHide: true, encoding: 'utf8', timeout: 5000 });
    if (result.status === 0) return String(result.stdout || '').split(/\r?\n/).map(clean).find(Boolean) || '';
  } catch {}
  return commandAvailable(value) ? value : '';
}

async function getToolDiagnostics(ytdlpExecutable = 'yt-dlp', ytOptions = {}) {
  const ytDlp = resolveExecutable(ytdlpExecutable);
  const ffmpeg = findFfmpegPath(ytdlpExecutable);
  const [ytVersion, ffVersion, latestVersion] = await Promise.all([
    ytDlp ? getYtDlpVersion(ytDlp) : Promise.resolve(''),
    ffmpeg ? runProcess(ffmpeg, ['-version']).then(r => String(r.stdout || '').split(/\r?\n/)[0] || '').catch(() => '') : Promise.resolve(''),
    ytDlp ? getLatestYtDlpVersion() : Promise.resolve('')
  ]);
  const runtime = detectJsRuntimeArgs();
  const cookieSources = {};
  for (const browser of Object.keys(BROWSER_COOKIE_PROFILE_DIRS)) {
    const state = cookieSourceState(browser);
    cookieSources[browser] = { state, label: describeCookieSourceState(state) };
  }
  return {
    ytDlp: {
      available: !!ytDlp, path: ytDlp, version: ytVersion, latestVersion,
      updateAvailable: !!(ytVersion && latestVersion && ytVersion !== latestVersion)
    },
    ffmpeg: { available: !!ffmpeg, path: ffmpeg, version: ffVersion },
    jsRuntime: runtime[1] || '',
    cookies: { sources: cookieSources, file: resolveCookiesFile(ytOptions?.cookiesFile) },
    download: {
      mode: clean(ytOptions?.downloadMode) === 'original' ? 'original' : 'mp3',
      proxy: clean(ytOptions?.proxy || ''),
      preferredStrategy: getPreferredStrategy()
    },
    readyForSearch: !!ytDlp,
    readyForMp3: !!ytDlp && !!ffmpeg
  };
}

module.exports = {
  canonicalYoutubeKey, ytDlpDownload, ytDlpResolveStream, ytDlpSearch, getToolDiagnostics,
  cleanupStaleDownloadTempDirs, getLatestYtDlpVersion, updateYtDlp, invalidateYtDlpVersion,
  findFfmpegPath, getPreferredStrategy
};
