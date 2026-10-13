class MetadataPipeline {
  constructor({ getTracks, isEnabled, search, save, render, status, apply }) {
    this.getTracks = getTracks;
    this.isEnabled = isEnabled;
    this.search = search;
    this.save = save;
    this.render = render;
    this.status = status;
    this.apply = apply;
    this.running = false;
    this.list = [];
    this.cursor = 0;
    this.total = 0;
    this.done = 0;
  }

  candidates() {
    const tracks = this.getTracks();
    return tracks.filter(track => {
      if (!track?.path || track.provider || track.metadataOverride) return false;
      const sig = track._statKey || '';
      return !track.metadataCheckedAt || track.metadataStatKey !== sig || (!track.cover && !track.remoteCover);
    });
  }

  async run(reset = false) {
    if (!this.isEnabled()) return;
    const candidates = this.candidates();
    if (this.running) {
      const known = new Set(this.list.map(t => t.id));
      const extra = candidates.filter(t => !known.has(t.id));
      if (extra.length) { this.list.push(...extra); this.total += extra.length; this.status(); }
      return;
    }
    if (reset || !this.list.length) {
      this.list = candidates;
      this.cursor = 0;
      this.total = candidates.length;
      this.done = 0;
    }
    if (!this.list.length) { this.status(); return; }
    this.running = true;
    this.status();
    try {
      let pendingSave = null;
      let batchesSinceRender = 0;
      while (this.cursor < this.list.length) {
        const batch = this.list.slice(this.cursor, this.cursor + 4);
        this.cursor += batch.length;
        await Promise.all(batch.map(async track => {
          if (!this.getTracks().includes(track)) { this.done++; return; }
          try {
            const fresh = await this.search(track);
            const addedAt = track.addedAt, stableId = track.id;
            if (fresh) {
              if (this.apply) this.apply(track, fresh);
              else Object.assign(track, fresh);
              track.id = stableId;
              track.addedAt = addedAt || track.addedAt || Date.now();
            }
            track.metadataCheckedAt = Date.now();
            track.metadataStatKey = track._statKey || fresh?._statKey || '';
          } catch (error) {
            track.metadataCheckedAt = Date.now();
            track.metadataStatKey = track._statKey || '';
          }
          this.done++;
          this.status();
        }));
        // save() is already debounced; don't stall the rate-limited metadata queue
        // waiting for a disk flush after every four tracks.
        pendingSave = this.save();
        if (++batchesSinceRender >= 2 || this.cursor >= this.list.length) {
          batchesSinceRender = 0;
          if (this.render) this.render();
        }
      }
      if (pendingSave) await pendingSave;
    } finally {
      this.running = false;
      this.status();
      if (this.render) this.render();
    }
  }
}

if (typeof window !== 'undefined') window.LocalifyMetadataPipeline = MetadataPipeline;
if (typeof module !== 'undefined' && module.exports) module.exports = { MetadataPipeline };
