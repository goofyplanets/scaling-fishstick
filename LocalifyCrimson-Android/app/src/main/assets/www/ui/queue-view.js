(function () {
  const QUEUE_ROW_HEIGHT = 60;

  window.updateQueueButton = function updateQueueButton() {
    const btn = $('#queueBtn');
    if (btn) btn.title = `Очередь: ${(state.playback || []).length} треков`;
  };

  window.openQueueDialog = function openQueueDialog() {
    renderQueueDialog();
    $('#queueDialog').showModal();
  };

  window.renderQueueDialog = function renderQueueDialog() {
    const list = state.playback || [];
    const root = $('#queueList');
    if (!root) return;
    const currentId = currentTrack()?.id || '';
    if (!list.length) {
      root.innerHTML = '<div class="empty queue-empty">Очередь пока пуста. Запустите воспроизведение трека.</div>';
      state.queueVirtualModel = null;
      bindQueueDrag('#queueList');
      return;
    }
    root.innerHTML = '<div class="queue-virtual-scroll"><div class="queue-virtual-spacer"></div><div class="queue-virtual-content"></div></div>';
    const scroller = root.querySelector('.queue-virtual-scroll');
    const spacer = root.querySelector('.queue-virtual-spacer');
    const content = root.querySelector('.queue-virtual-content');
    spacer.style.height = `${list.length * QUEUE_ROW_HEIGHT}px`;
    const model = { list, scroller, content, currentId, renderQueued: false };
    state.queueVirtualModel = model;
    const renderWindow = () => {
      const scrollTop = scroller.scrollTop;
      const viewport = scroller.clientHeight || 520;
      const start = Math.max(0, Math.floor(scrollTop / QUEUE_ROW_HEIGHT) - 6);
      const end = Math.min(list.length, Math.ceil((scrollTop + viewport) / QUEUE_ROW_HEIGHT) + 6);
      content.innerHTML = list.slice(start, end).map((t, i) => `<div class="queue-item ${t.id===currentId?'current':''}" data-queue-index="${start+i}" style="top:${(start+i)*QUEUE_ROW_HEIGHT}px">
        <span class="queue-index">${t.id===currentId?uiIcon('play','queue-playing'):String(start+i+1)}</span>
        <span class="queue-cover">${coverHtml(t.cover,'',t.remoteCover || '')}${t.cover||t.remoteCover?'':uiIcon('music')}</span>
        <span class="queue-copy"><b>${esc(t.title)}</b><small>${esc(t.artist || 'Неизвестный исполнитель')}</small></span>
        <span class="queue-time">${t.duration ? fmtTime(t.duration) : '—'}</span>
        <span class="queue-actions"><button type="button" class="queue-action" data-remove-queue="${start+i}" title="Убрать">×</button></span>
      </div>`).join('');
      $$('#queueList [data-remove-queue]').forEach(btn => btn.addEventListener('click', e => {
        e.stopPropagation();
        const idx=Number(btn.dataset.removeQueue);
        if(!Number.isFinite(idx)) return;
        const removed=list[idx];
        if(!removed) return;
        const removedCurrent=removed.id===(currentTrack()?.id||'');
        state.playback.splice(idx,1);
        // playbackBase — источник для rebuildPlaybackOrder(): без удаления из него
        // трек возвращался в очередь после переключения shuffle.
        state.playbackBase=(state.playbackBase||[]).filter(t=>t.id!==removed.id);
        if(!removedCurrent){
          // Индекс нужно пересчитать по id: иначе после удаления строки выше
          // текущей подсветка и next/prev указывали не на тот трек.
          const keepId=currentTrack()?.id||'';
          const kept=keepId?state.playback.findIndex(t=>t.id===keepId):-1;
          state.playbackIndex=kept>=0?kept:-1;
          saveQueueSnapshot(); renderQueueDialog(); updateQueueButton();
          return;
        }
        if(state.playback.length){
          state.playbackIndex=Math.min(idx,state.playback.length-1);
          saveQueueSnapshot(); renderQueueDialog(); updateQueueButton();
          void playCurrentPlayback();
          return;
        }
        // Очередь опустела: недостаточно очистить audio — иначе currentTrack()
        // всё ещё возвращает удалённый трек и сессия воспроизведения сохранит
        // его, воскресив очередь при следующем запуске.
        state.playbackIndex=-1;
        state.currentIndex=-1;
        state.currentRemoteTrack=null;
        saveQueueSnapshot(); renderQueueDialog(); updateQueueButton();
        audio.pause(); audio.removeAttribute('src'); updateNowPlaying(null);
      }));
      $$('#queueList [data-queue-index]').forEach(btn => btn.addEventListener('click', () => {
        const index = Number(btn.dataset.queueIndex);
        if (!Number.isFinite(index) || !list[index]) return;
        state.playbackIndex = index;
        playCurrentPlayback();
      }));
      // Клавиатура: строки очереди были недоступны с Tab, а перестановка
      // делалась только перетаскиванием мышью.
      $$('#queueList [data-queue-index]').forEach(row => {
        row.tabIndex = 0;
        row.addEventListener('keydown', e => {
          const index = Number(row.dataset.queueIndex);
          if (!Number.isFinite(index)) return;
          if (e.key === 'Enter') {
            e.preventDefault(); e.stopPropagation();
            if (list[index]) { state.playbackIndex = index; playCurrentPlayback(); }
            return;
          }
          if (!e.altKey) return;
          const target = e.key === 'ArrowUp' ? index - 1 : e.key === 'ArrowDown' ? index + 1 : -1;
          if (target < 0 || target >= list.length) return;
          e.preventDefault(); e.stopPropagation();
          reorderQueue(index, target);
          $(`#queueList [data-queue-index="${target}"]`)?.focus();
        });
      });
    };
    model.renderWindow = renderWindow;
    scroller.addEventListener('scroll', () => {
      if (model.renderQueued) return;
      model.renderQueued = true;
      requestAnimationFrame(() => { model.renderQueued = false; renderWindow(); });
    }, { passive: true });
    renderWindow();
    bindQueueDrag('#queueList');
  };
})();
