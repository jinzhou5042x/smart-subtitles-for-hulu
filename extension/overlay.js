// The two subtitle lines over the picture. Knows nothing about players, tracks or translation:
// it is told where the picture is and what to show.
(function (scope) {
  const ID = 'hulu-context-subtitles';
  // onMove(fraction): the viewer dragged the lines; the position is a fraction of the picture
  // height, so it follows resizing and full screen.
  function createOverlay({ onMove = () => {} } = {}) {
    // Previous extension contexts (each reload or update of the extension) may have left overlays.
    for (const old of document.querySelectorAll('#' + ID)) old.remove();
    const host = document.createElement('div'); host.id = ID;
    const shadow = host.attachShadow({ mode: 'closed' });
    const style = document.createElement('style');
    // Each line sits on its own soft, blurred backing; the translation leads and the original follows
    // smaller and lighter. Padding and corners are in em, so they scale with the chosen size.
    style.textContent = `:host{all:initial;position:fixed;z-index:2147483646;pointer-events:none;display:none}*{box-sizing:border-box}
.wrap{position:absolute;inset:0;display:flex;align-items:center;justify-content:flex-end;flex-direction:column;padding:0 2% 5%;text-align:center;font-family:"Segoe UI Variable Text","Segoe UI",system-ui,-apple-system,"PingFang SC","Hiragino Sans","Microsoft YaHei UI","Microsoft YaHei","Noto Sans CJK SC",sans-serif;-webkit-font-smoothing:antialiased}
.line{display:flex;align-items:center;justify-content:center;text-align:center;max-width:none;width:max-content;flex-shrink:0;white-space:nowrap;unicode-bidi:plaintext;line-height:1.22;border-radius:.22em;padding:.1em .5em .14em;color:#fff;font-size:var(--subtitle-size,26px);font-weight:600;letter-spacing:.005em;background:rgba(10,12,16,.58);-webkit-backdrop-filter:blur(8px) saturate(1.2);backdrop-filter:blur(8px) saturate(1.2);box-shadow:0 .08em .5em rgba(0,0,0,.22),inset 0 0 0 1px rgba(255,255,255,.06);text-shadow:0 1px 2px rgba(0,0,0,.6);transition:box-shadow .15s}
.original{font-size:var(--original-size,18px);color:rgba(255,255,255,.88);margin-top:calc(var(--original-size,18px)*.3);font-weight:450;background:rgba(10,12,16,.42)}
.line:empty{display:none}.line{pointer-events:auto;cursor:grab;user-select:none;touch-action:none}
.dragging .line{cursor:grabbing;box-shadow:0 .08em .5em rgba(0,0,0,.22),inset 0 0 0 1px rgba(255,255,255,.06),0 0 0 2px rgba(47,194,125,.65)}
.badge{position:absolute;top:16px;left:16px;color:#fff;background:#101820b5;padding:6px 10px;border-radius:6px;font:12px system-ui}.badge:empty{display:none}`;
    const wrap = document.createElement('div'); wrap.className = 'wrap';
    // dir=auto with unicode-bidi:plaintext lays out right-to-left translations (Arabic, Hebrew, Persian) correctly.
    const translatedLine = document.createElement('div'); translatedLine.className = 'line'; translatedLine.dir = 'auto';
    const originalLine = document.createElement('div'); originalLine.className = 'line original'; originalLine.dir = 'ltr';
    const badge = document.createElement('div'); badge.className = 'badge';
    wrap.append(translatedLine, originalLine); shadow.append(style, wrap, badge);
    const clamp = value => Math.max(0, Math.min(0.85, Number(value) || 0));
    let drag = null, position = 0, last = null;
    // The lines can be dragged vertically. Events on them never reach the player, so dragging
    // does not pause or toggle full screen; the rest of the overlay stays click-through.
    for (const line of [translatedLine, originalLine]) {
      line.addEventListener('pointerdown', e => {
        if (e.button !== 0) return;
        e.preventDefault(); e.stopPropagation();
        drag = { y: e.clientY, from: position, at: position }; wrap.classList.add('dragging'); line.setPointerCapture(e.pointerId);
      });
      line.addEventListener('pointermove', e => {
        if (!drag) return;
        e.preventDefault(); e.stopPropagation();
        drag.at = clamp(drag.from + (drag.y - e.clientY) / Math.max(1, last?.rect.height || 1)); if (last) draw(last);
      });
      const end = e => {
        if (!drag) return;
        e.stopPropagation();
        position = drag.at; drag = null; wrap.classList.remove('dragging');
        if (last) draw(last);
        onMove(position);
      };
      line.addEventListener('pointerup', end); line.addEventListener('pointercancel', end);
      for (const type of ['click', 'dblclick', 'mousedown', 'mouseup', 'contextmenu']) line.addEventListener(type, e => e.stopPropagation());
    }
    const fitted = new WeakMap();
    function fitLine(element, text, size, width) {
      const singleLine = text.replace(/\s+/g, ' ').trim();
      const available = Math.max(1, Math.floor(width * 0.96));
      const key = JSON.stringify([singleLine, size, available]);
      if (fitted.get(element) === key) return;
      element.replaceChildren();
      element.style.transform = '';
      element.style.fontSize = `${size}px`;
      if (singleLine) {
        const ending = singleLine.match(/[\p{P}]+$/u)?.[0] || '';
        const body = singleLine.slice(0, singleLine.length - ending.length);
        const punctuation = document.createElement('span');
        // Keep punctuation visible, but align the text before it to the video center.
        element.append(document.createTextNode(body || singleLine));
        if (body && ending) { punctuation.textContent = ending; element.append(punctuation); }
        const natural = element.getBoundingClientRect().width;
        const tail = punctuation.getBoundingClientRect().width;
        if (natural + tail > available) element.style.fontSize = `${Math.max(1, Math.floor(size * Math.max(1, available - 20) / Math.max(1, natural + tail - 20) * 100) / 100)}px`;
        element.style.transform = `translateX(${punctuation.getBoundingClientRect().width / 2}px)`;
      }
      fitted.set(element, key);
    }
    // view: { parent, rect (the picture), fontSize, translated, original, notice }
    function draw(view) {
      last = view;
      const { parent, rect, fontSize } = view;
      host.style.setProperty('--subtitle-size', `${fontSize}px`);
      host.style.setProperty('--original-size', `${Math.round(fontSize * 0.7)}px`);
      if (parent && host.parentNode !== parent) parent.append(host);
      wrap.style.paddingBottom = `${Math.max(12, rect.height * 0.035) + (drag ? drag.at : position) * rect.height}px`;
      Object.assign(host.style, { display: 'block', left: rect.left + 'px', top: rect.top + 'px', width: rect.width + 'px', height: rect.height + 'px' });
      fitLine(translatedLine, view.translated || '', fontSize, rect.width);
      fitLine(originalLine, view.original || '', Math.round(fontSize * 0.7), rect.width);
      badge.textContent = view.notice || '';
    }
    return {
      draw,
      hide() { host.style.display = 'none'; },
      remove() { host.remove(); },
      // The stored position; ignored while the viewer is dragging.
      set position(value) { if (!drag) position = clamp(value); },
      // Read-only facts for inspection from the page; never read back by the extension.
      describe(facts) { for (const [key, value] of Object.entries(facts)) host.dataset[key] = value == null ? '' : String(value); }
    };
  }
  scope.SubtitleOverlay = { createOverlay };
})(globalThis);
