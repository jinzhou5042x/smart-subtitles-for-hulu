import test from 'node:test';
import assert from 'node:assert/strict';
import { collectTerms, degenerate, localGrammar, localPrompt, mergeUnits, outputBudget, parseLocalTranslation, planBatches, polishText, turns } from '../service/local-format.mjs';

const cue = (id, text, start, end = start + 1.5) => ({ id, text, start, end });

test('a sentence split across two cues is translated once and shown over both cues', () => {
  const cues = [cue('a', 'I have', 0, 1), cue('b', 'a craving for burgers.', 1.1, 2.5), cue('c', 'Bye.', 3)];
  const units = mergeUnits(cues);
  assert.deepEqual(units.map(u => u.text), ['I have a craving for burgers.', 'Bye.']);
  const result = parseLocalTranslation('[1] I have a craving for burgers. => 我突然很想吃汉堡。\n[2] Bye. => 再见。', units);
  assert.deepEqual(result.map(s => s.sourceIds), [['a', 'b'], ['c']]);
  assert.deepEqual([result[0].start, result[0].end], [0, 2.5]);
});

test('cues are not merged across long gaps, speaker changes, sound effects or finished sentences', () => {
  for (const second of [cue('b', 'a craving.', 3), cue('b', '-a craving. -What?', 1), cue('b', '(sighs)', 1)]) assert.equal(mergeUnits([cue('a', 'I have', 0, 1), second]).length, 2);
  assert.equal(mergeUnits([cue('a', 'I have one.', 0, 1), cue('b', 'Good.', 1)]).length, 2);
  assert.equal(mergeUnits([cue('a', 'One', 0, 1), cue('b', 'two', 1, 2), cue('c', 'three', 2, 3)]).length, 2);
});

test('speaker dashes, bracket labels, sound effects and music notes are fixed by the grammar', () => {
  assert.deepEqual(turns('-Hey! -[music fades]'), ['Hey!', '[music fades]']);
  assert.equal(turns('forward-thinking - really'), null);
  const grammar = localGrammar([cue('a', '-Hey!\n-[music fades]', 0), cue('b', '[woman] Hey, Markie.', 2), cue('c', '♪ ♪', 4), cue('d', '(choking)', 6)], { choking: '呛咳' });
  // Brackets keep the source style; post-processing makes them full-width.
  assert.match(grammar, /b1 ::= "-" d24 ws "-" "\[" inner "\]"/);
  assert.match(grammar, /d24 ::= dfirst drest\{0,24\}/); assert.match(grammar, /drest ::= \[\^.*—–\/-\]/);
  assert.match(grammar, /e1 ::= .* b1 nl e2/); assert.match(grammar, /nl ::= "\\n" "\\n"\?/);
  assert.match(grammar, /b2 ::= "\[" inner "\]" ws t\d+/);
  assert.match(grammar, /b3 ::= "♪" ws "♪"/);
  assert.match(grammar, /b4 ::= "\(呛咳\)"/);
  // Undashed lines cannot gain a speaker dash; markup, "=" and full-width look-alikes are excluded.
  assert.match(grammar, /\nfirst ::= \[\^ .*<>=#\*【】（）\(\).*\\uFF0D-\\uFF19.*—–-\]/);
  assert.match(grammar, /rest ::= \[\^.*\\uFF20-\\uFF5E\]/);
  assert.match(grammar, /t32 ::= first rest\{0,32\}/); assert.ok(grammar.includes('=#*【】'));
  assert.equal(outputBudget(10, [cue('a', 'Hi.', 0)]), 10 + 32 + 64);
});

test('post-processing applies the name table, uses full-width brackets and remembers sound translations', () => {
  const sounds = {};
  assert.equal(polishText('BEN（通过电脑）：哇。', 'BEN (over computer): Wow.', { terms: { Ben: '本' }, sounds }), '本（通过电脑）：哇。');
  assert.equal(sounds['over computer'], '通过电脑');
  assert.equal(polishText('(叹气)好吧。', '(sighs) Fine.', { sounds }), '（叹气）好吧。');
  assert.equal(polishText('-[女人]再见。', '-[woman] Bye.', { sounds }), '-（女人）再见。');
  assert.equal(sounds.woman, '女人');
  assert.equal(polishText('-（犬吠声） -好吧。', '-[barks] -Okay.'), '-（犬吠声）-好吧。');
  assert.equal(polishText('[woman] Adiós.', '[woman] Bye.', { wide: false }), '[woman] Adiós.');
  assert.equal(polishText('Benjamin来了', 'Benjamin is here', { terms: { Ben: '本' } }), 'Benjamin来了');
  assert.equal(polishText('Ben is here', 'Ben is here', { terms: { Ben: 'Benito' } }), 'Ben is here');
});

test('parsing learns bracket translations only after the whole batch validates', () => {
  const cues = [cue('a', '(sighs)', 0), cue('b', 'Okay.', 2)];
  const sounds = {};
  assert.throws(() => parseLocalTranslation('[1] (sighs) => （叹气）\n[2] Wrong. => 好。', cues, { sounds }), /does not match the source/);
  assert.deepEqual(sounds, {});
  parseLocalTranslation('[1] (sighs) => （叹气）\n[2] Okay. => 好。', cues, { sounds });
  assert.equal(sounds.sighs, '叹气');
  assert.throws(() => parseLocalTranslation('[1] (sighs) => （叹气）\n[2] Okay. => 好。．．．．', cues), /repeated characters/);
  assert.equal(parseLocalTranslation('[1] (sighs) => （叹气）\n[2] Okay. => 好吧……', cues)[1].text, '好吧……');
});

test('recurring names and speaker labels are collected, sentence-initial words are not', () => {
  const cues = ['BEN (over computer): Wow.', 'So great to see you, Ben.', 'Hello, everyone.', 'Ask Ben.', '-Hello. -TERRANCE: David.', 'At Ultima Robotix, we listen.', 'Welcome to Ultima Robotix.', 'Hey Elsie, play.', 'Elsie, next.']
    .map((text, i) => cue(String(i), text, i * 2));
  const terms = collectTerms(cues);
  assert.ok(terms.includes('Ben')); assert.ok(terms.includes('TERRANCE')); assert.ok(terms.includes('Ultima Robotix')); assert.ok(terms.includes('Elsie'));
  assert.ok(!terms.includes('Hello')); assert.ok(!terms.includes('So')); assert.ok(!terms.includes('Welcome'));
});

test('batches prefer to end where a sentence ends', () => {
  const cues = ['One.', 'Two.', 'Three', 'four', 'five.', 'Six', 'seven'].map((text, i) => cue(String(i), text, i * 2));
  assert.deepEqual(planBatches(cues, 0, 6), [{ start: 0, end: 5 }, { start: 5, end: 7 }]);
  assert.deepEqual(planBatches(cues, 2, 6), [{ start: 2, end: 7 }]);
});

test('prompt carries names, previous translations and following lines as plain reference text', () => {
  const prompt = localPrompt({ target: 'zh-CN', title: 'Show', glossary: { Ben: '本' }, cues: [cue('a', 'Hi.', 0)], batchContext: { before: [{ source: 'Hey.', translation: '嘿。' }], after: ['Bye.'] } });
  assert.match(prompt, /Ben translates to 本/); assert.match(prompt, /Hey\. => 嘿。/); assert.match(prompt, /Following lines:\nBye\./); assert.match(prompt, /\[1\] Hi\.$/);
});

test('padding and a speaker line far longer than its source are flagged as degenerate', () => {
  assert.equal(degenerate('好。．．．．', 'Okay.'), 'repeated characters');
  assert.equal(degenerate('-（马基）呃……那是谁，你女朋友吗？调整说明：将语气词处理为口语 -你女朋友吗？', '-[Markie] Uh... -Who\'s that, your girlfriend?'), 'translation too long');
  assert.equal(degenerate('-（马基）呃……-那是谁，你女朋友吗？', '-[Markie] Uh... -Who\'s that, your girlfriend?'), '');
  assert.equal(degenerate('你知道吗？这个国家每三个人里就有一个是独居的。', 'Did you know that one in three people in this country live alone?'), '');
  const cues = [cue('a', 'Okay.', 0)];
  assert.throws(() => parseLocalTranslation('[1] Okay. => 好。．．．．', cues), e => e.soft === true);
  assert.equal(parseLocalTranslation('[1] Okay. => 好。．．．．', cues, { lenient: true })[0].text, '好。．．．．');
});
