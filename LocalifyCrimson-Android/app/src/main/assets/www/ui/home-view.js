(function () {
  function homeHistoryTracks(limit = 6) {
    const seen = new Set(); const result = [];
    for (const entry of state.history || []) {
      const id = String(entry?.id || ''); if (!id || seen.has(id)) continue;
      const track = findTrackById(id) || entry; if (!track) continue;
      seen.add(id); result.push(track); if (result.length >= limit) break;
    }
    return result;
  }
  function homeRecentTracks(limit = 6) {
    if (state.recentCacheRevision < 0) {
      const recent = [];
      for (const track of state.library) {
        if (recent.length < 8) { recent.push(track); recent.sort((a,b)=>(b.addedAt||0)-(a.addedAt||0)); continue; }
        if ((track.addedAt||0) <= (recent[recent.length-1].addedAt||0)) continue;
        recent[recent.length-1] = track; recent.sort((a,b)=>(b.addedAt||0)-(a.addedAt||0));
      }
      state.recentCache = recent; state.recentCacheRevision = state.libraryRevision;
    }
    return state.recentCache.slice(0, limit);
  }
  const cardGrid = (list, emptyText) => list.length ? list.map(trackCard).join('') : `<div class="empty home-empty">${esc(emptyText)}</div>`;
  const playlistGrid = (list, emptyText) => list.length ? list.map(playlistCard).join('') : `<div class="empty home-empty">${esc(emptyText)}</div>`;

  window.renderHome = function renderHome() {
    const resumeTrack = state.savedPlayback?.trackId ? findTrackById(state.savedPlayback.trackId) : null;
    const resumePosition = Math.max(0, Number(state.savedPlayback?.position || 0));
    const resumeDuration = Math.max(0, Number(resumeTrack?.duration || 0));
    const resumeCard = $('#homeResumeCard');
    if (resumeCard) {
      if (resumeTrack) {
        const progress = resumeDuration > 0 ? Math.min(100, Math.max(0, resumePosition / resumeDuration * 100)) : 0;
        resumeCard.innerHTML = `<div class="home-resume-cover">${coverHtml(resumeTrack.cover,'',resumeTrack.remoteCover || '')}${resumeTrack.cover||resumeTrack.remoteCover?'':uiIcon('music')}</div><div class="home-resume-copy"><div class="eyebrow">ПРОДОЛЖИТЬ ПРОСЛУШИВАНИЕ</div><h2>${esc(resumeTrack.title || 'Без названия')}</h2><p>${esc(resumeTrack.artist || 'Неизвестный исполнитель')}${resumeTrack.album ? ` · ${esc(resumeTrack.album)}` : ''}</p><div class="home-resume-meta"><span>${fmtTime(resumePosition)}${resumeDuration ? ` / ${fmtTime(resumeDuration)}` : ''}</span><span>${Math.round(progress)}%</span></div><div class="home-progress"><span style="width:${progress}%"></span></div><div class="home-resume-actions"><button type="button" class="primary" id="homeResumeBtn">Продолжить</button><button type="button" class="secondary" id="homeResumeLibraryBtn">Открыть библиотеку</button></div></div>`;
        $('#homeResumeBtn')?.addEventListener('click', () => {
          playTrackById(resumeTrack.id, 'library');
          const restore = () => { if (!Number.isFinite(audio.duration) || audio.duration <= 0) return; audio.currentTime = Math.min(resumePosition, Math.max(0, audio.duration - 0.1)); audio.removeEventListener('loadedmetadata', restore); };
          audio.addEventListener('loadedmetadata', restore); if (audio.readyState >= 1) restore();
        });
        $('#homeResumeLibraryBtn')?.addEventListener('click', () => setView('library'));
      } else {
        resumeCard.innerHTML = `<div class="home-resume-empty"><div class="home-stat-icon">${uiIcon('play')}</div><div><div class="eyebrow">НАЧНИТЕ С МУЗЫКИ</div><h2>Ваша библиотека пока пуста</h2><p>Добавьте музыку — Crimson запомнит последний трек и место остановки.</p><button type="button" class="primary" id="homeEmptyAddBtn">Добавить музыку</button></div></div>`;
        $('#homeEmptyAddBtn')?.addEventListener('click', addFiles);
      }
    }

    const total = state.library.length;
    const artists = new Set(state.library.map(t => String(t.artist || '').trim()).filter(Boolean)).size;
    const albums = new Set(state.library.map(t => String(t.album || '').trim()).filter(Boolean)).size;
    const stats = $('#homeStats');
    if (stats) stats.innerHTML = [['Треки', total], ['Исполнители', artists], ['Альбомы', albums], ['Плейлисты', state.playlists.length]].map(([label,value]) => `<div class="home-stat"><span>${esc(label)}</span><b>${Number(value).toLocaleString('ru-RU')}</b></div>`).join('');

    $('#homeHistoryGrid') && ($('#homeHistoryGrid').innerHTML = cardGrid(homeHistoryTracks(6), 'Здесь появятся треки, которые вы уже слушали.'));
    $('#homeAddedGrid') && ($('#homeAddedGrid').innerHTML = cardGrid(homeRecentTracks(6), 'После добавления музыки здесь появятся последние файлы.'));
    $('#homePlaylistGrid') && ($('#homePlaylistGrid').innerHTML = playlistGrid(state.playlists.slice(0, 6), 'Создайте первый плейлист.'));
    $$('#homeHistoryGrid .music-card[data-track], #homeAddedGrid .music-card[data-track]').forEach(el => el.addEventListener('dblclick', () => playTrackById(el.dataset.track)));
    $$('#homePlaylistGrid .music-card[data-playlist]').forEach(el => el.addEventListener('click', () => openPlaylist(el.dataset.playlist)));

    const quick = $('#homeQuickActions');
    if (quick) {
      quick.innerHTML = `<button type="button" class="home-quick" data-home-action="library"><span>${uiIcon('music')}</span><b>Вся музыка</b><small>${total.toLocaleString('ru-RU')} треков</small></button><button type="button" class="home-quick" data-home-action="shuffle"><span>${uiIcon('refresh')}</span><b>Случайный микс</b><small>${total ? 'Запустить случайную подборку' : 'Сначала добавьте музыку'}</small></button><button type="button" class="home-quick" data-home-action="history"><span>${uiIcon('clock')}</span><b>История</b><small>${state.history.length.toLocaleString('ru-RU')} записей</small></button><button type="button" class="home-quick" data-home-action="playlist"><span>${uiIcon('plus')}</span><b>Новый плейлист</b><small>Создать подборку</small></button>`;
      $$('#homeQuickActions [data-home-action]').forEach(btn => btn.addEventListener('click', () => {
        const action=btn.dataset.homeAction;
        if(action==='library') return setView('library');
        if(action==='history') return openHistoryDialog();
        if(action==='playlist') return openPlaylistDialog();
        if(!state.library.length) return toast('Сначала добавьте музыку');
        state.shuffleMode='normal'; state.shuffle=true; $('#shuffleBtn')?.classList.add('active');
        startPlayback(state.library, Math.floor(Math.random()*state.library.length), 'library');
      }));
    }
    const folder = $('#homeFolderLabel'); if (folder) folder.textContent = state.settings.musicFolder || 'Папка не выбрана';
  };
})();
