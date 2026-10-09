/**
 * Zero-dependency ops/sec benchmark for protoarray's hot paths.
 *
 * Run: pnpm bench [filter] [--json] [--save] [--compare]
 *
 * An optional filter runs only the scenarios whose name contains it, e.g.
 * `pnpm bench parse`. `--json` prints the results as JSON, `--save` writes
 * them to bench/baseline.json, and `--compare` prints the change against
 * that baseline (numbers are machine-specific: compare on one machine, before
 * and after a change). Manual only, not part of CI.
 *
 * Until encode/decode are implemented, the scenarios are the reference points
 * protoarray competes with: JSON over a keyed object and over the same values
 * as a positional array.
 */

const fs = require('node:fs');
const path = require('node:path');

const { bench, FLAT_OBJECT, FLAT_ARRAY, NESTED_OBJECT, NESTED_ARRAY } = require('./helpers.js');

const BASELINE = path.join(__dirname, 'baseline.json');

const args = process.argv.slice(2);
const flags = new Set(args.filter((arg) => arg.startsWith('--')));
const filter = args.find((arg) => !arg.startsWith('--')) || '';
const json = flags.has('--json');

const percent = (current, base) => {
  const delta = ((current - base) / base) * 100;
  const sign = delta >= 0 ? '+' : '';
  return `${sign}${delta.toFixed(1)}%`;
};

const compare = (results) => {
  if (!fs.existsSync(BASELINE)) {
    console.error(`No baseline at ${BASELINE}; run with --save first`);
    process.exitCode = 1;
    return;
  }
  const baseline = JSON.parse(fs.readFileSync(BASELINE, 'utf8'));
  const base = new Map(baseline.results.map((row) => [row.name, row.opsPerSec]));
  console.log(`\nAgainst baseline from ${baseline.date} (${baseline.node}):`);
  for (const { name, opsPerSec } of results) {
    const before = base.get(name);
    const change = before ? percent(opsPerSec, before) : 'no baseline';
    console.log(`${name.padEnd(52)} ${change.padStart(12)}`);
  }
};

const main = () => {
  if (!json) console.log(`Node ${process.version} | ${new Date().toISOString()}\n`);
  const flatObjectJson = JSON.stringify(FLAT_OBJECT);
  const flatArrayJson = JSON.stringify(FLAT_ARRAY);
  const nestedObjectJson = JSON.stringify(NESTED_OBJECT);
  const nestedArrayJson = JSON.stringify(NESTED_ARRAY);

  const scenarios = [
    ['JSON.stringify — flat object (4 fields)', () => JSON.stringify(FLAT_OBJECT)],
    ['JSON.stringify — flat positional array', () => JSON.stringify(FLAT_ARRAY)],
    ['JSON.parse — flat object (4 fields)', () => JSON.parse(flatObjectJson)],
    ['JSON.parse — flat positional array', () => JSON.parse(flatArrayJson)],
    ['JSON.stringify — nested object', () => JSON.stringify(NESTED_OBJECT)],
    ['JSON.stringify — nested positional array', () => JSON.stringify(NESTED_ARRAY)],
    ['JSON.parse — nested object', () => JSON.parse(nestedObjectJson)],
    ['JSON.parse — nested positional array', () => JSON.parse(nestedArrayJson)],
  ];

  const results = [];
  for (const [name, fn] of scenarios) {
    if (name.includes(filter)) results.push(bench(name, fn, { quiet: json }));
  }
  if (json) console.log(JSON.stringify(results, null, 2));
  if (flags.has('--save')) {
    const snapshot = { node: process.version, date: new Date().toISOString(), results };
    fs.writeFileSync(BASELINE, `${JSON.stringify(snapshot, null, 2)}\n`);
    if (!json) console.log(`\nSaved ${results.length} results to ${BASELINE}`);
  }
  if (flags.has('--compare')) compare(results);
};

main();
