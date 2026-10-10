// One title's translation: asks the local service for it, follows its progress and holds the
// lines by subtitle id. No DOM; `send` reaches the extension's background worker.
//
// The only states are the ones the popup shows: nothing yet, working, complete, interrupted and
// retrying by itself, paused on something only the viewer can clear, or waiting for a
// translator's setup. Everything asynchronous belongs to an `epoch`:
// anything that changes what is being translated (another track, another translator, another
// title, a retry) starts a new epoch, and answers that arrive for an old one are dropped.
(function (scope) {
  class TranslationSession {
    constructor({ send, wait = ms => new Promise(resolve => setTimeout(resolve, ms)), now = Date.now, id = () => crypto.randomUUID() }) {
      Object.assign(this, { send, wait, now, id });
      this.cues = []; this.lines = new Map(); this.epoch = id(); this.clear();
    }
    clear() { this.lines.clear(); this.episode = null; this.cursor = 0; this.busy = false; this.complete = false; this.retryAt = 0; this.error = ''; this.awaiting = ''; this.redo = ''; this.stopped = ''; this.interrupted = ''; this.attempts = 0; }
    // Ends the current epoch and tells the service this page no longer needs its work.
    cancel() { const old = this.epoch; this.epoch = this.id(); this.busy = false; Promise.resolve(this.send({ type: 'cancel', epoch: old })).catch(() => {}); }
    reset() { this.cancel(); this.clear(); }
    // Another track: everything known so far belonged to the old one.
    use(cues) { this.reset(); this.cues = cues; }
    retry() { this.error = ''; this.interrupted = ''; this.attempts = 0; this.retryAt = 0; }
    // Translates a finished title again. The screen starts empty and fills as the new lines
    // arrive. The service keeps the old record until the new one is complete, so if this stops,
    // the old lines are fetched back (see `run`) and `stopped` says why.
    again() {
      if (!this.complete || !this.cues.length) return false;
      this.cancel(); this.clear(); this.redo = this.id();
      return true;
    }
    get working() { return !!this.episode && ['queued', 'running'].includes(this.episode.status); }
    get translated() { return this.lines.size; }
    apply(result) {
      if ((result.completedCues || 0) > (this.episode?.completedCues || 0)) this.attempts = 0;
      this.episode = result; this.interrupted = '';
      for (const segment of result.segments || []) for (const id of segment.sourceIds) this.lines.set(id, segment);
      this.cursor = result.cursor;
      this.complete = result.status === 'done' && this.cursor === result.segmentCount && this.lines.size === this.cues.length;
      if (this.complete) this.redo = '';
    }
    // Called on every tick; does nothing unless there is something to ask for.
    async run({ session, title }) {
      if (!this.cues.length || this.busy || this.complete || this.now() < this.retryAt) return;
      const epoch = this.epoch, stale = () => epoch !== this.epoch;
      this.busy = true;
      try {
        const first = await this.send({ type: 'prepareEpisode', request: { session, epoch, title, cues: this.cues, context: [], ...(this.redo ? { redo: this.redo } : {}) } });
        if (stale()) return;
        // A translator that still needs setting up: no request was made; ask again shortly.
        this.awaiting = first.status === 'awaiting-key' ? 'key' : '';
        if (this.awaiting) { this.error = ''; this.retryAt = this.now() + 2000; return; }
        this.apply(first); this.error = '';
        while (!this.complete) {
          if (['error', 'cancelled'].includes(this.episode.status)) throw Object.assign(new Error(this.episode.error || 'Episode translation cancelled'), { needsUser: !!this.episode.needsUser });
          await this.wait(1000);
          if (stale()) return;
          let result = await this.send({ type: 'episodeProgress', id: this.episode.id, after: this.cursor });
          if (stale()) return;
          // The finished text may differ from the streamed lines: read all of it again.
          if (result.status === 'done' && this.episode.status !== 'done' && this.cursor > 0) {
            result = await this.send({ type: 'episodeProgress', id: this.episode.id, after: 0 });
            if (stale()) return;
            this.lines.clear();
          }
          this.apply(result);
        }
      } catch (e) {
        if (stale()) return;
        this.awaiting = '';
        if (e.needsUser) {
          // Only the viewer can clear this (an account, a quota, a key). It is shown with Retry,
          // and asked again every two minutes in case it has cleared by itself. A second
          // translation gives way to the first instead: the stored record is fetched back.
          if (this.redo) { this.clear(); this.stopped = e.message; }
          else { this.error = e.message; this.attempts = 0; this.retryAt = this.now() + 120000; }
        } else {
          // Everything else is retried without asking: after 5 s, 15 s, 45 s, then every 2 min.
          // The service kept every validated minute, so each try starts where the last one ended.
          this.interrupted = e.message; this.retryAt = this.now() + Math.min(120000, 5000 * 3 ** Math.min(this.attempts++, 5));
        }
      }
      finally { if (!stale()) this.busy = false; }
    }
  }
  scope.SubtitleSession = { TranslationSession };
})(globalThis);
