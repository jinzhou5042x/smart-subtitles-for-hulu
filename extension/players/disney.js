// Disney+ (the Hive player). Everything that depends on Disney's web player is in this file.
// Its facts were measured in live playback on 2026-10-09 and 2026-10-10; see
// docs/incidents/2026-10-06-subtitle-clock-drift.md before changing any of them.
(function (scope) {
  const P = scope.SubtitlePlayers, { deepFind } = P;

  // ---- Public player controls (read only) ----
  // Disney's timeline, as measured in live playback (2026-10-09): the accessible number
  // (aria-valuenow) is written once, as whole seconds, when the controls appear and then stays
  // frozen while the film plays; the progress bar's width is rewritten about four times a second
  // and matched the pause announcement's millisecond time within 25 ms. So the bar is the live
  // reading and the number only says where the bar must at least be.
  function timelineSample() {
    const slider = deepFind(document.querySelector('main-app-controls-overlay')?.shadowRoot, '[data-qa="progress-bar.seekableRange"]');
    if (!slider) return null;
    const rawNow = slider.getAttribute('aria-valuenow'), rawMax = slider.getAttribute('aria-valuemax');
    if (rawNow == null || rawMax == null || !rawNow.trim() || !rawMax.trim()) return null;
    const now = Number(rawNow), maximum = Number(rawMax);
    if (!Number.isFinite(now) || !Number.isFinite(maximum) || !(maximum > 0) || now < 0 || now > maximum) return null;
    const width = slider.querySelector?.('[data-qa="progress-bar.progress"]')?.style.width;
    const percent = typeof width === 'string' && /^\d+(?:\.\d+)?%$/.test(width.trim()) ? parseFloat(width) : NaN;
    const visual = percent * maximum / 100;
    // The number is no check on the bar: after a rewind it may still name the old place.
    const live = percent >= 0 && percent <= 100;
    // A reading is new when what it is read from has changed: the bar, or without one the number.
    return { maximum, live, time: live ? visual : now, signature: `${live ? width.trim() : now}|${maximum}` };
  }
  const pauseAnnouncement = () => document.querySelector('.text-to-speech-status')?.textContent || '';
  const controls = () => ({ sample: timelineSample()?.signature, pause: pauseAnnouncement() });
  function nudgeControls(video) {
    if (typeof MouseEvent !== 'function' || !video.dispatchEvent) return;
    const rect = video.getBoundingClientRect();
    video.dispatchEvent(new MouseEvent('mousemove', { bubbles: true, clientX: rect.left + rect.width / 2, clientY: rect.top + rect.height / 2 }));
  }

  const watcher = P.adWatcher(controls);
  const ads = new Proxy({}, { get: (_, key) => watcher.state[key], set: (_, key, value) => { watcher.state[key] = value; return true; } });

  // ---- Clock ----
  // The Hive player's media time runs ahead of the title's own timeline, and through inserted
  // ads, so subtitle time = media time − offset. The offset is learned only from the public
  // controls, per title and media source, and is in one of three phases:
  //   origin   no reading yet; the subtitle file's own origin stands in (Hive shows nothing)
  //   synced   learned, with a `precision`:
  //              exact   a pause announcement (milliseconds); kept as it is
  //              first   the first live bar reading; right after a seek the bar shows the
  //                      target while playback resumes slightly before it, so the next
  //                      reading during playback replaces this one
  //              bar     the live progress bar; a changed bar is seen up to one poll after it
  //                      was written, which can only make the offset look larger, so later
  //                      readings may lower it a little and never raise it
  //              second  the number alone (no usable bar): up to a second late
  //   waiting  void after an ad, a new source or a new route; only controls that have changed
  //            since then may set it again
  // A seek restarts the Hive media time (near 20 s, measured), so it voids the offset at once.
  // It can begin and end between two polls; the element's own event and media time running
  // backwards catch what the `seeking` flag misses.
  // Without a seek, a reading more than 1.5 s away from the offset is a discontinuity (an
  // inserted ad, a new presentation) and replaces it; from the bar, only once the next reading
  // agrees, so a pointer dragging the bar ahead of the picture does not move the subtitles.
  const hive = video => /^hivePlayer/.test(video.id || '');
  const clocks = new WeakMap(), listening = new WeakSet();
  let clockPage = null;
  class DisneyClock {
    constructor(key, origin) {
      this.key = key; this.offset = origin; this.phase = ads.generation > 0 ? 'waiting' : 'origin';
      this.generation = ads.generation; this.pause = ''; this.last = undefined; this.ignored = undefined; this.jump = null;
      this.media = undefined; this.sought = false; this.settled = 0;
      this.nudges = 0; this.nextNudge = 0;
    }
    get ready() { return this.phase === 'synced'; }
    expire() { this.phase = 'waiting'; }
    // What the controls show right now describes something else (the previous title or source).
    distrust() { const seen = controls(); this.ignored = seen.sample; this.pause = seen.pause; this.expire(); }
    sync(offset, precision) { this.offset = offset; this.phase = 'synced'; this.precision = precision; this.sought = false; this.jump = null; }
    seeked() { this.expire(); this.sought = true; this.settled = 0; this.nudges = 0; this.nextNudge = 0; }
    // A seek is settling: the bar is about to show the new place, so there is nothing to ask of the viewer yet.
    get settling() { return this.sought && (!this.settled || Date.now() - this.settled < 1500); }
    followAds() {
      if (this.generation === ads.generation) return;
      this.generation = ads.generation; this.nudges = 0; this.nextNudge = 0; this.expire();
    }
    // Asks the player to show its controls: at once, then after 1, 2, 4 ... up to 30 seconds,
    // for as long as there is no reading. A page that has just loaded may not answer yet.
    nudge(video) {
      const now = Date.now();
      if (now < this.nextNudge) return;
      this.nextNudge = now + Math.min(30000, 1000 * 2 ** this.nudges++); nudgeControls(video);
    }
    readPause(video) {
      const text = pauseAnnouncement(), match = /^Paused at (\d+)\.$/.exec(text);
      if (!video.paused || !match || text === this.pause || (this.phase === 'waiting' && text === ads.leftover.pause)) return false;
      this.sync(video.currentTime - Number(match[1]) / 1000, 'exact'); this.pause = text;
      // Ignore the old slider until it advances after this precise pause sample.
      this.ignored = timelineSample()?.signature;
      return true;
    }
    readTimeline(video, sample) {
      if (!sample) return;
      // After a seek the bar shows the new place by the time the seek ends (measured). One that
      // has not changed is still taken once it has stood for 0.4 s: paused, it will not change.
      const stood = this.phase === 'waiting' && this.sought && this.settled && Date.now() - this.settled >= 400;
      if ((sample.signature === this.last || sample.signature === this.ignored) && !stood) return;
      if (this.phase === 'waiting' && sample.signature === ads.leftover.sample) return;
      this.last = sample.signature; ads.maximum = sample.maximum;
      const offset = video.currentTime - sample.time, precision = sample.live ? 'bar' : 'second';
      if (this.phase !== 'synced') { this.sync(offset, sample.live ? 'first' : precision); return; }
      if (Math.abs(offset - this.offset) > 1.5) {
        const confirmed = !sample.live || (this.jump !== null && Math.abs(offset - this.jump) <= 0.3);
        this.jump = confirmed ? null : offset;
        if (confirmed) this.sync(offset, precision);
        return;
      }
      this.jump = null;
      if (!sample.live || this.precision === 'exact' || video.paused) return;
      if (this.precision === 'second' || this.precision === 'first' || (offset < this.offset && this.offset - offset <= 0.3)) this.sync(offset, 'bar');
    }
    time(video) {
      this.followAds();
      if (ads.active) return NaN;
      if (this.media !== undefined && video.currentTime < this.media - 0.3) this.seeked();
      this.media = video.currentTime;
      if (video.seeking) { this.seeked(); return NaN; }
      if (this.sought && !this.settled) this.settled = Date.now();
      if ((this.phase === 'waiting' || (hive(video) && !this.ready)) && !this.settling) this.nudge(video);
      const paused = this.readPause(video), sample = timelineSample();
      // A different duration may be an unrecognized ad timeline. Never adopt the shorter one.
      // When the first duration seen was itself an unrecognized pre-roll, the longer one that
      // follows is the episode and needs a fresh calibration.
      if (sample && ads.maximum && Math.abs(sample.maximum - ads.maximum) > 2) {
        this.expire();
        if (sample.maximum < ads.maximum) return NaN;
        ads.maximum = sample.maximum;
      }
      if (!paused) this.readTimeline(video, sample);
      if (this.phase === 'waiting' || (hive(video) && !this.ready)) return NaN;
      return video.currentTime - this.offset;
    }
  }
  function disneyClock(video, origin) {
    const key = location.pathname + '|' + (video.currentSrc || video.src || '');
    let clock = clocks.get(video);
    if (!clock || clock.key !== key) {
      // A reused element with a new source, or a new element on another route, can still sit
      // beside the previous title's controls.
      const replaced = !!clock || (clockPage !== null && clockPage !== location.pathname);
      clock = new DisneyClock(key, origin);
      if (replaced) clock.distrust();
      clocks.set(video, clock); clockPage = location.pathname;
    }
    if (!listening.has(video) && video.addEventListener) {
      listening.add(video); video.addEventListener('seeking', () => clocks.get(video)?.seeked());
    }
    // The overlay asks for the time before a subtitle file is selected; until a reading
    // replaces it, the offset follows the selected file's origin.
    if (clock.phase === 'origin') clock.offset = origin;
    return clock;
  }

  P.register({
    id: 'disney', name: 'Disney+', clockPolicy: 'disney-controls-v6',
    isWatchPage: () => /^\/(?:[a-z]{2}(?:-[a-z]{2,4})?\/)?(?:play|video)\/[^/]+\/?$/i.test(location.pathname),
    adBreak: () => watcher.observe(),
    // Only the length of the track's own complete playlist. The Hive element's duration is the
    // end of what it has buffered (133 s was seen on a 50-minute episode), and a single segment
    // of another track that happened to end there was once taken for the whole episode.
    titleSeconds: (video, track) => track?.duration || 0,
    subtitleTime(video, origin = 0) { watcher.observe(); return disneyClock(video, origin).time(video); },
    // True only while the clock needs a control or pause sample and could not get one by itself.
    // Seeks and ads also have no subtitle time for a moment, but nothing the viewer can do helps.
    awaitingClock(video) {
      if (video.seeking || watcher.observe()) return false;
      const clock = clocks.get(video);
      // Not before the clock's own request for the controls has gone unanswered once.
      return !!clock && !clock.settling && clock.nudges >= 2 && (clock.phase === 'waiting' || (hive(video) && !clock.ready));
    },
    clockState(video) {
      const clock = clocks.get(video), sample = timelineSample();
      return { mediaTime: video?.currentTime, phase: clock?.phase, precision: clock?.precision, offset: clock?.offset, requests: clock?.nudges, settling: clock?.settling, bar: sample?.time, barLive: sample?.live, timelineMaximum: sample?.maximum, elementDuration: video?.duration, ad: ads.active };
    },
  });
})(globalThis);
