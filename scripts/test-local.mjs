import { readFile, writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { loadConfig, root } from '../service/config.mjs';
import { LocalTranslator } from '../service/local.mjs';

const config = await loadConfig();
await mkdir(path.join(root, 'data/evaluation'), { recursive: true });
config.localEvaluationCapture = text => writeFile(path.join(root, 'data/evaluation/local-last-output.txt'), text);
const translator = new LocalTranslator(config);
const testLines = [
  "I'm going on stage in five minutes.", "Break a leg!", "Thanks. I needed that.",
  "Oh, great. Another meeting that could've been an email.",
  "You're pulling my leg, right?", "No. The boss really threw me under the bus.",
  "Let's not jump the gun. We don't know the whole story.",
  "Fine. But don't throw her under the bus just to save your own skin.",
  "He didn't say she stole the money.", "He said she borrowed it. Big difference.",
  "You had me at hello."
];
let cues = testLines.map((text, i) => ({ id: String(i + 1), start: i * 5, end: i * 5 + 4, text }));
const sourceFile = process.argv[2];
if (sourceFile) { const episode = JSON.parse(await readFile(path.resolve(sourceFile), 'utf8')); cues = episode.sourceCues.slice(0, Number(process.argv[3]) || undefined); }
const request = { provider: 'local', session: 'local-evaluation', client: 'local-evaluation', epoch: String(Date.now()), target: 'zh-CN', title: sourceFile ? 'Subtitle evaluation' : 'Dialogue and idiom check', context: [], cues };
const controller = new AbortController();
process.on('SIGINT', () => controller.abort());
const started = Date.now(); let printed = 0, retries = 0;
try {
  const segments = await translator.translate(request, controller.signal, ({partialSegments, ...progress}) => { if (progress.phase === 'local_retrying') retries++; if (Date.now() - printed > 10000) { printed = Date.now(); console.log(JSON.stringify({ ...progress, elapsedSeconds: Math.round((Date.now() - started) / 1000) })); } });
  // One comparison per translated segment; a sentence merged from two cues shows both sources.
  const byId = new Map(cues.map(c => [c.id, c]));
  const result = { model: 'Hy-MT2-7B-Q8_0', elapsedSeconds: (Date.now() - started) / 1000, count: cues.length, segments: segments.length, retries, comparisons: segments.map(s => ({ start: s.start, end: s.end, source: s.sourceIds.map(id => byId.get(id).text).join(' / '), translation: s.text })) };
  await mkdir(path.join(root, 'data/evaluation'), { recursive: true });
  const file = path.join(root, `data/evaluation/local-${sourceFile ? 'episode' : 'idioms'}-${cues.length}.json`);
  await writeFile(file, JSON.stringify(result, null, 2));
  console.log(JSON.stringify({ file, elapsedSeconds: result.elapsedSeconds, count: result.count, examples: result.comparisons.slice(0, 12) }, null, 2));
} finally { translator.close(); }
