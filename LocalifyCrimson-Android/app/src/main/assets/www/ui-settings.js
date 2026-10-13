(function () {
  const $ = selector => document.querySelector(selector);
  const fields = [
    ['settingMinimizeToTray','minimizeToTray'], ['settingCloseToTray','closeToTray'],
    ['settingTrayEnabled','trayEnabled'], ['settingMediaKeys','mediaKeys'],
    ['settingNotifications','notifications'], ['settingStartMinimized','startMinimized'],
    ['settingOnlineMetadata','onlineMetadata'], ['settingRenameFiles','renameFiles'],
    ['settingMoveFilesIntoPlaylists','moveFilesIntoPlaylists'], ['settingAutoWatch','autoWatch'],
    ['settingGapless','gapless'], ['settingReduceMotion','reduceMotion'],
    ['settingCompactPlayer','compactPlayer']
  ];

  window.LocalifySettingsUI = {
    render(settings, providerConfig) {
      const folder = $('#musicFolderPath');
      if (folder) {
        folder.textContent = settings.musicFolder ? settings.musicFolder : 'Папка не выбрана';
        folder.title = settings.musicFolder || '';
      }
      for (const [id, key] of fields) {
        const el = $(`#${id}`);
        if (el) el.checked = key === 'onlineMetadata' ? settings[key] !== false : !!settings[key];
      }
      const ytdlp = $('#settingYtDlpPath');
      if (ytdlp) ytdlp.value = providerConfig?.ytDlpPath || settings.ytDlpPath || 'yt-dlp';
      const cookies = $('#settingCookiesFile');
      if (cookies) cookies.value = providerConfig?.cookiesFile || settings.cookiesFile || '';
      const proxy = $('#settingProxy');
      if (proxy) proxy.value = providerConfig?.proxy || settings.proxy || '';
      const downloadMode = $('#settingDownloadMode');
      if (downloadMode) downloadMode.value = providerConfig?.downloadMode || settings.downloadMode || 'mp3';
      const density = $('#settingUiDensity');
      if (density) density.value = settings.uiDensity || 'normal';
      const coverSize = $('#settingCoverSize');
      if (coverSize) coverSize.value = settings.coverSize || 'medium';
    },
    read(current) {
      const next = { ...current };
      for (const [id, key] of fields) {
        const el = $(`#${id}`);
        if (el) next[key] = !!el.checked;
      }
      const density = $('#settingUiDensity'); if (density) next.uiDensity = density.value || 'normal';
      const cover = $('#settingCoverSize'); if (cover) next.coverSize = cover.value || 'medium';
      return next;
    }
  };
})();
