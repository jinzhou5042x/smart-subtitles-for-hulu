import test from 'node:test';
import assert from 'node:assert/strict';
import '../extension/core.js';
import '../extension/ttml.js';
const text = nodeValue => ({ nodeType: 3, nodeValue });
const element = (localName, attrs = {}, childNodes = []) => ({ nodeType: 1, localName, attributes: Object.entries(attrs).map(([name, value]) => ({ name, localName: name.split(':').at(-1), value })), childNodes });
const parse = documentElement => globalThis.SubtitleTTML.parseTTML({ documentElement });
test('TTML reads nested timed spans in paragraphs without begin/end', () => {
  const root = element('tt', {}, [element('body', {}, [element('div', {}, [element('p', {}, [
    element('span', { begin: '1s', end: '3s' }, [text('Hello'), element('br'), text('there.')]),
    element('span', { begin: '4s', end: '6s' }, [text('Goodbye.')])
  ])])])]);
  const cues = parse(root); assert.equal(cues.length, 2); assert.equal(cues[0].text, 'Hello\nthere.'); assert.equal(cues[1].start, 4);
});
test('TTML inherits parent intervals and reads namespaced timing attributes', () => {
  const root = element('tt', { 'ttp:frameRate': '30' }, [element('body', { begin: '10s', end: '30s' }, [element('div', {}, [
    element('p', { 'tt:begin': '00:00:01:15', 'tt:dur': '2s' }, [element('span', {}, [text('Inherited timing')])])
  ])])]);
  const [cue] = parse(root); assert.equal(cue.start, 11.5); assert.equal(cue.end, 13.5);
});
test('TTML rejects unsupported timing rather than displaying incorrect subtitles', () => {
  assert.throws(() => parse(element('tt', {}, [element('body', { timeContainer: 'seq' })])));
  assert.throws(() => parse(element('tt', {}, [element('body', {}, [element('p', {}, [text('Untimed')])])])));
});
