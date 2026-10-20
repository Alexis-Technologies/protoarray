/**
 * How the cost of a record grows with its width, per backend: the protocol of
 * the article's e5 stand. Each (backend, width) point runs in a fresh process:
 * 128 records of `n` fields (string, integer, boolean and number in turn) are
 * encoded and decoded in rotation, and the number is the median of five rounds
 * after a warm-up, so one object staying hot in the caches is not what is
 * measured.
 *
 * Run: pnpm bench:sweep [--widths 4,8,16] [--standalone] [--json] [--save]
 *
 * Prints ns per operation and per field for JSON (the keyed object), generated
 * code and closures (and the inline standalone module with `--standalone`),
 * the closures/codegen ratio, the step from one width to the next where the
 * widths are adjacent (127 → 128 is where a cliff would show), and the
 * least-squares fit `a + b·n` of each column. `--save` writes
 * bench/results/sweep.json. Manual only, not part of CI; the numbers are
 * machine-specific.
 */

const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const RESULTS = path.join(__dirname, 'results', 'sweep.json');
const WIDTHS = [4, 8, 16, 32, 48, 64, 96, 127, 128, 256];
const BACKENDS = ['json', 'codegen', 'closures'];
const RECORDS = 128;
const TYPES = ['string', 'integer', 'boolean', 'number'];
const WARMUP = 2_000;
const ROUNDS = 5;
const ROUND_MS = 300;
const BATCH = 64;

const args = process.argv.slice(2);
const option = (name) => {
  const at = args.indexOf(name);
  return at === -1 ? undefined : args[at + 1];
};

const keyOf = (i) => `f${String(i).padStart(5, '0')}`;
const definitionOf = (n) =>
  Object.fromEntries(Array.from({ length: n }, (_, i) => [keyOf(i), TYPES[i % 4]]));
const recordOf = (n, r) => {
  const out = {};
  for (let i = 0; i < n; i++) {
    const type = i % 4;
    let value;
    if (type === 0) value = `v${r}-${i}`;
    else if (type === 1) value = r * 1000 + i;
    else if (type === 2) value = ((r + i) & 1) === 0;
    else value = r + i / 8;
    out[keyOf(i)] = value;
  }
  return out;
};

// Ops/sec of `fn` over the inputs in rotation: the clock is read once per
// batch, so it costs a fraction of a nanosecond per call.
const measure = (fn, inputs) => {
  const count = inputs.length;
  let k = 0;
  const next = () => {
    const input = inputs[k];
    k = k + 1 === count ? 0 : k + 1;
    return input;
  };
  for (let i = 0; i < WARMUP; i++) fn(next());
  const samples = [];
  for (let round = 0; round < ROUNDS; round++) {
    let iterations = 0;
    const start = performance.now();
    while (performance.now() - start < ROUND_MS) {
      for (let j = 0; j < BATCH; j++) fn(next());
      iterations += BATCH;
    }
    samples.push((iterations / (performance.now() - start)) * 1000);
  }
  samples.sort((a, b) => a - b);
  return samples[Math.floor(ROUNDS / 2)];
};

// One point, in this process: the backend's encode and decode of `n` fields.
const point = (backend, n) => {
  const definition = definitionOf(n);
  const values = Array.from({ length: RECORDS }, (_, r) => recordOf(n, r));
  let encode;
  let decode;
  let label = backend;
  if (backend === 'json') {
    encode = (value) => JSON.stringify(value);
    decode = (text) => JSON.parse(text);
  } else {
    const metaschema = require('@alexify/metaschema');
    const { Schema } = require('../index.js');
    let schema = Schema.from(definition, { metaschema, codegen: backend === 'codegen' });
    if (backend === 'standalone') {
      const { toSource } = require('../standalone.js');
      const module = { exports: {} };
      const source = `(function (module) {${toSource(schema, { runtime: 'inline' })}\n})`;
      vm.runInThisContext(source)(module);
      schema = module.exports;
    }
    if (schema.backend !== backend) throw new Error(`Expected ${backend}, got ${schema.backend}`);
    label = schema.backend;
    encode = (value) => schema.stringify(value);
    decode = (text) => schema.parse(text);
  }
  const texts = values.map(encode);
  const check = JSON.stringify(decode(texts[1]));
  if (check !== JSON.stringify(values[1])) throw new Error(`${label} does not round-trip`);
  return {
    backend: label,
    n,
    bytes: texts[0].length,
    encode: measure(encode, values),
    decode: measure(decode, texts),
  };
};

const child = (backend, n) => {
  const output = execFileSync(process.execPath, [__filename, '--child', backend, String(n)], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'inherit'],
  });
  return JSON.parse(output);
};

// The least-squares line through (n, ns) and how well it fits.
const fit = (points) => {
  const m = points.length;
  let sx = 0;
  let sy = 0;
  let sxx = 0;
  let sxy = 0;
  for (const [x, y] of points) {
    sx += x;
    sy += y;
    sxx += x * x;
    sxy += x * y;
  }
  const b = (m * sxy - sx * sy) / (m * sxx - sx * sx);
  const a = (sy - b * sx) / m;
  const mean = sy / m;
  let total = 0;
  let residual = 0;
  for (const [x, y] of points) {
    total += (y - mean) ** 2;
    residual += (y - (a + b * x)) ** 2;
  }
  return { a, b, r2: total === 0 ? 1 : 1 - residual / total };
};

const ns = (ops) => 1e9 / ops;
const cell = (text, width = 26) => String(text).padStart(width);

const report = (widths, backends, points) => {
  const at = (backend, n) => points.find((p) => p.backend === backend && p.n === n);
  const fits = {};
  for (const op of ['decode', 'encode']) {
    console.log(`\n${op}: ns per operation (ns per field)`);
    console.log(
      cell('fields', 8) + backends.map((b) => cell(b)).join('') + cell('closures/codegen', 18),
    );
    fits[op] = {};
    for (const n of widths) {
      const row = backends.map((backend) => {
        const p = at(backend, n);
        return cell(`${ns(p[op]).toFixed(0)} (${(ns(p[op]) / n).toFixed(1)})`);
      });
      const ratio = ns(at('closures', n)[op]) / ns(at('codegen', n)[op]);
      console.log(cell(n, 8) + row.join('') + cell(`×${ratio.toFixed(2)}`, 18));
    }
    const line = backends.map((backend) => {
      const f = fit(widths.map((n) => [n, ns(at(backend, n)[op])]));
      fits[op][backend] = f;
      return cell(`${f.a.toFixed(0)} + ${f.b.toFixed(1)}·n  R²=${f.r2.toFixed(3)}`, 26);
    });
    console.log(`\n${cell('fit', 8)}${line.join('')}`);
    for (let i = 1; i < widths.length; i++) {
      if (widths[i] !== widths[i - 1] + 1) continue;
      const steps = backends.map((backend) => {
        const ratio = ns(at(backend, widths[i])[op]) / ns(at(backend, widths[i - 1])[op]);
        return cell(`×${ratio.toFixed(2)}`);
      });
      console.log(cell(`${widths[i - 1]}→${widths[i]}`, 8) + steps.join(''));
    }
  }
  return fits;
};

const main = () => {
  if (args[0] === '--child') {
    process.stdout.write(JSON.stringify(point(args[1], Number(args[2]))));
    return;
  }
  const widths = (option('--widths') ?? WIDTHS.join(','))
    .split(',')
    .map(Number)
    .filter((n) => Number.isInteger(n) && n > 0);
  const backends = args.includes('--standalone') ? [...BACKENDS, 'standalone'] : BACKENDS;
  const json = args.includes('--json');
  const points = [];
  for (const n of widths) {
    for (const backend of backends) {
      const p = child(backend, n);
      points.push(p);
      if (!json) {
        process.stderr.write(
          `${backend.padEnd(11)} n=${String(n).padEnd(4)} ` +
            `encode ${ns(p.encode).toFixed(0).padStart(7)} ns  decode ${ns(p.decode).toFixed(0).padStart(7)} ns\n`,
        );
      }
    }
  }
  const fits = json ? null : report(widths, backends, points);
  const snapshot = {
    node: process.version,
    date: new Date().toISOString(),
    records: RECORDS,
    widths,
    backends,
    points,
    fits: fits ?? undefined,
  };
  if (json) console.log(JSON.stringify(snapshot, null, 2));
  if (args.includes('--save')) {
    fs.writeFileSync(RESULTS, `${JSON.stringify(snapshot, null, 2)}\n`);
    if (!json) console.log(`\nSaved ${points.length} points to ${RESULTS}`);
  }
};

main();
