(function (scope) {
  // TTML parallel timing with inherited body/div/p/span intervals.
  function parseTTML(xml) {
    const C = scope.SubtitleCore;
    const attribute = (node, name) => Array.from(node.attributes || []).find(a => a.localName === name || a.name === name)?.value;
    const root = xml.documentElement;
    const multiplier = (attribute(root, 'frameRateMultiplier') || '1 1').trim().split(/\s+/).map(Number);
    const nominalRate = Number(attribute(root, 'frameRate') || 30);
    const rate = nominalRate * multiplier[0] / multiplier[1];
    const subRate = Number(attribute(root, 'subFrameRate') || 1);
    const tickRate = Number(attribute(root, 'tickRate') || (attribute(root, 'frameRate') ? rate * subRate : 1));
    if (![rate, subRate, tickRate].every(n => Number.isFinite(n) && n > 0)) throw new Error('Invalid TTML clock rate');
    if (attribute(root, 'dropMode') && attribute(root, 'dropMode') !== 'nonDrop') throw new Error('Drop-frame TTML is not supported');
    const time = s => { const t = C.ttmlTime(s, rate, subRate, tickRate); if (!Number.isFinite(t)) throw new Error(`Unsupported TTML time: ${String(s).slice(0, 40)}`); return t; };
    function interval(node, parent) {
      if (attribute(node, 'timeContainer') === 'seq') throw new Error('Sequential TTML time containers are not supported');
      const b = attribute(node, 'begin'), e = attribute(node, 'end'), d = attribute(node, 'dur');
      const start = parent.start + (b ? time(b) : 0);
      const end = Math.min(parent.end, e ? parent.start + time(e) : Infinity, d ? start + time(d) : Infinity);
      return { start, end };
    }
    const result = [];
    function paragraph(node, bounds) {
      const leaves = [];
      function visit(n, range) {
        if (n.nodeType === 3 || n.nodeType === 4) {
          if (String(n.nodeValue || '').trim()) leaves.push({ ...range, text: n.nodeValue.replace(/[\r\n\t]+/g, ' ') });
          else if (n.nodeValue?.includes(' ')) leaves.push({ ...range, text: ' ' });
          return;
        }
        if (n.nodeType !== 1) return;
        const next = interval(n, range);
        if (n.localName === 'br') { leaves.push({ ...next, text: '\n' }); return; }
        for (const child of Array.from(n.childNodes || [])) visit(child, next);
      }
      for (const child of Array.from(node.childNodes || [])) visit(child, bounds);
      const boundaries = [...new Set(leaves.filter(l => l.text.trim()).flatMap(l => [l.start, l.end]).filter(Number.isFinite))].sort((a, b) => a - b);
      let previous;
      for (let i = 0; i < boundaries.length - 1; i++) {
        const start = boundaries[i], end = boundaries[i + 1];
        const text = C.clean(leaves.filter(l => l.start <= start && l.end > start).map(l => l.text).join(''));
        if (!text || end <= start || end - start > 120) continue;
        if (previous && previous.text === text && Math.abs(previous.end - start) < 0.001) {
          previous.end = end; previous.id = C.cue(previous.start, end, text).id;
        } else { previous = C.cue(start, end, text); result.push(previous); }
      }
    }
    function walk(node, parent) {
      if (node.nodeType !== 1 || node.localName === 'head') return;
      const range = interval(node, parent);
      if (node.localName === 'p') paragraph(node, range);
      else for (const child of Array.from(node.childNodes || [])) walk(child, range);
    }
    walk(root, { start: 0, end: Infinity });
    if (!result.length) throw new Error('No usable timed text found in the TTML');
    return [...new Map(result.map(c => [c.id, c])).values()].sort((a, b) => a.start - b.start);
  }
  scope.SubtitleTTML = { parseTTML };
})(globalThis);
