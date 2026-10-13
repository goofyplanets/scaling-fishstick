(function () {
  window.handleGlobalHotkeys = function handleGlobalHotkeys(e, searchInput=document.querySelector('#search')) {
    const target=e.target;
    const typing=target && (target.tagName==='INPUT'||target.tagName==='TEXTAREA'||target.isContentEditable);
    const closest = selector => (target && typeof target.closest==='function') ? target.closest(selector) : null;
    // Space принадлежит кнопкам и ссылкам, стрелки — спискам и ползункам.
    // Иначе после клика по «Играть» фокус остаётся на кнопке, и объявленные
    // стрелки «предыдущий/следующий» перестают работать.
    const spaceOwner = closest('button,a,select,summary,[role="button"],[role="tab"]');
    const arrowOwner = closest('select,input[type="range"]');
    const mod=e.ctrlKey||e.metaKey;
    if(mod){
      const key=e.key.toLowerCase();
      if(key==='k'){e.preventDefault();searchInput?.focus();searchInput?.select();return;}
      if(key==='l'){e.preventDefault();setView('library');return;}
      if(key==='p'){e.preventDefault();setView('playlists');return;}
      if(key===','){e.preventDefault();setView('settings');return;}
      if(key==='o'){e.preventDefault();void addFiles();return;}
      if(key==='n' && e.shiftKey){e.preventDefault();openPlaylistDialog();return;}
      if(key==='q'){e.preventDefault();openQueueDialog();return;}
      if(key==='e'){e.preventDefault();const t=currentTrack();if(t)openEditTrackDialog(t.id);return;}
      if(key==='r' && e.shiftKey){e.preventDefault();void syncConfiguredLibrary(true);return;}
      return;
    }
    if(e.altKey || typing) return;
    // Элемент (например, карточка альбома) уже обработал клавишу сам.
    if(e.defaultPrevented) return;
    if(spaceOwner && e.code==='Space') return;
    if(arrowOwner && (e.code==='ArrowUp' || e.code==='ArrowDown' || e.code==='ArrowLeft' || e.code==='ArrowRight')) return;
    if(e.code==='Space'){e.preventDefault();togglePlay();}
    else if(e.code==='ArrowRight' && audio.duration){e.preventDefault();audio.currentTime=Math.min(audio.duration,audio.currentTime+(e.shiftKey?10:5));}
    else if(e.code==='ArrowLeft' && audio.duration){e.preventDefault();audio.currentTime=Math.max(0,audio.currentTime-(e.shiftKey?10:5));}
    else if(e.code==='ArrowDown'){e.preventDefault();void next();}
    else if(e.code==='ArrowUp'){e.preventDefault();previous();}
    else if(e.key.toLowerCase()==='m'){e.preventDefault();audio.muted=!audio.muted;document.querySelector('#volumeMuteBtn')?.classList.toggle('muted',audio.muted);}
    else if(e.key.toLowerCase()==='c'){e.preventDefault();if(currentTrack()) addTrackToQueue(currentTrack());}
    else if(e.key.toLowerCase()==='j'){e.preventDefault();scrollToCurrentTrack();}
  };
})();
