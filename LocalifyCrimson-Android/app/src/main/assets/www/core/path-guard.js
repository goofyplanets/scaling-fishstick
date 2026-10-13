const path = require('path');
const fs = require('fs');

function normalize(p) { return path.resolve(String(p || '')).replace(/\\/g, '/').toLowerCase(); }
function isInside(filePath, root) {
  if (!filePath || !root) return false;
  const p = normalize(filePath), r = normalize(root);
  return p === r || p.startsWith(`${r}/`);
}
function createPathGuard({ getMusicFolder, getUserData, getLibraryPaths }) {
  return {
    isTrusted(filePath) {
      if (typeof filePath !== 'string' || !filePath || !fs.existsSync(filePath)) return false;
      return isInside(filePath, getMusicFolder()) || isInside(filePath, getUserData()) || getLibraryPaths().has(normalize(filePath));
    },
    isTrustedAudio(filePath) {
      return this.isTrusted(filePath) && fs.statSync(filePath).isFile();
    },
    normalize
  };
}
module.exports = { createPathGuard, normalizePath: normalize, isInside };
