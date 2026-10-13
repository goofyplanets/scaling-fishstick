class TaskQueue {
  constructor({ concurrency = 1, minStartInterval = 0, name = 'queue' } = {}) {
    this.concurrency = Math.max(1, Number(concurrency) || 1);
    this.minStartInterval = Math.max(0, Number(minStartInterval) || 0);
    this.name = name;
    this.active = 0;
    this.lastStartedAt = 0;
    this.rateGate = Promise.resolve();
    this.waiting = [];
    this.waitingCursor = 0;
    this.jobs = new Map();
    this.id = 0;
  }

  enqueue(key, task) {
    const jobKey = String(key || `${this.name}:${++this.id}`);
    if (this.jobs.has(jobKey)) return this.jobs.get(jobKey);
    const promise = new Promise((resolve, reject) => {
      this.waiting.push({ key: jobKey, task, resolve, reject });
      this._drain();
    }).finally(() => this.jobs.delete(jobKey));
    this.jobs.set(jobKey, promise);
    return promise;
  }

  async _waitRateLimit() {
    if (!this.minStartInterval) return;
    const previous = this.rateGate;
    let release;
    this.rateGate = new Promise(resolve => { release = resolve; });
    await previous;
    try {
      const diff = Date.now() - this.lastStartedAt;
      if (diff < this.minStartInterval) await new Promise(resolve => setTimeout(resolve, this.minStartInterval - diff));
      this.lastStartedAt = Date.now();
    } finally {
      release();
    }
  }

  _drain() {
    while (this.active < this.concurrency && this.waitingCursor < this.waiting.length) {
      const item = this.waiting[this.waitingCursor++];
      if (this.waitingCursor > 256 && this.waitingCursor * 2 >= this.waiting.length) { this.waiting = this.waiting.slice(this.waitingCursor); this.waitingCursor = 0; }
      this.active += 1;
      void (async () => {
        try {
          if (this.minStartInterval) await this._waitRateLimit();
          item.resolve(await item.task());
        } catch (error) {
          item.reject(error);
        } finally {
          this.active -= 1;
          this._drain();
        }
      })();
    }
  }

  get size() { return Math.max(0, this.waiting.length - this.waitingCursor) + this.active; }
  get pending() { return Math.max(0, this.waiting.length - this.waitingCursor); }
}

module.exports = { TaskQueue };
