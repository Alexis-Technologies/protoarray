/**
 * Zero-dependency ops/sec benchmark for protoarray's hot paths.
 *
 * Run: pnpm bench [filter] [--json] [--save] [--compare]
 *
 * An optional filter runs only the scenarios whose name contains it, e.g.
 * `pnpm bench decode`. `--json` prints the results as JSON, `--save` writes
 * them to bench/baseline.json, and `--compare` prints the change against
 * that baseline (numbers are machine-specific: compare on one machine, before
 * and after a change). Manual only, not part of CI. `pnpm bench:compare` is
 * the comparison against other libraries.
 *
 * Every protoarray scenario has its JSON reference next to it: the same value
 * through JSON.stringify/JSON.parse as a keyed object.
 */

const fs = require('node:fs');
const path = require('node:path');

const { Schema } = require('../index.js');
const {
  bench,
  FLAT_OBJECT,
  NESTED_OBJECT,
  RECORDS,
  SPARSE_OBJECT,
  TYPED_OBJECT,
} = require('./helpers.js');

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
    console.log(`${name.padEnd(60)} ${change.padStart(12)}`);
  }
};

const FLAT = { name: 'string', age: 'number', email: 'string', active: 'boolean' };
const NESTED = {
  id: 'number',
  name: { first: 'string', last: 'string' },
  address: { city: 'string', street: 'string', building: 'string' },
  tags: { array: 'string' },
  orders: { array: { sku: 'string', quantity: 'number', price: 'number' } },
};
const RECORD = {
  id: 'number',
  name: 'string',
  email: 'string',
  age: 'number',
  active: 'boolean',
  balance: 'number',
  role: 'string',
  createdAt: 'number',
  address: { city: 'string', street: 'string', zip: 'string' },
  tags: { array: 'string' },
};
const SPARSE = Object.fromEntries(Array.from({ length: 20 }, (_, i) => [`field${i}`, '?json']));
const TYPED = {
  id: 'number',
  active: 'boolean',
  verified: 'boolean',
  role: { enum: ['admin', 'editor', 'viewer', 'owner'] },
  status: { enum: ['pending', 'active', 'suspended'] },
  createdAt: 'date',
  perms: { flags: ['read', 'write', 'admin'] },
};

// Each entry: [label, schema definition, options, value, json reference value]
const pairs = (label, definition, options, value, reference = value) => {
  const codegen = Schema.from(definition, { ...options, codegen: true });
  const closures = Schema.from(definition, { ...options, codegen: false });
  const text = JSON.stringify(reference);
  const wire = codegen.stringify(value);
  return [
    [`${label}: JSON.stringify (keyed, reference)`, () => JSON.stringify(reference)],
    [`${label}: stringify (codegen)`, () => codegen.stringify(value)],
    [`${label}: stringify (closures)`, () => closures.stringify(value)],
    [`${label}: JSON.parse (keyed, reference)`, () => JSON.parse(text)],
    [`${label}: parse (codegen)`, () => codegen.parse(wire)],
    [`${label}: parse (closures)`, () => closures.parse(wire)],
  ];
};

const main = () => {
  if (!json) console.log(`Node ${process.version} | ${new Date().toISOString()}\n`);
  const rows = Schema.from({ array: RECORD });
  const flat = Schema.from({ array: RECORD }, { layout: 'flat' });
  const columns = Schema.from({ array: RECORD }, { layout: 'columns' });
  const recordsText = JSON.stringify(RECORDS);
  const wires = {
    rows: rows.stringify(RECORDS),
    flat: flat.stringify(RECORDS),
    columns: columns.stringify(RECORDS),
  };
  const scenarios = [
    ...pairs('flat object (4 fields)', FLAT, {}, FLAT_OBJECT),
    ...pairs('nested object', NESTED, {}, NESTED_OBJECT),
    ...pairs('sparse object (3 of 20)', SPARSE, { sparse: true }, SPARSE_OBJECT),
    ...pairs('typed object (enum, flags, date)', TYPED, {}, TYPED_OBJECT, {
      ...TYPED_OBJECT,
      createdAt: TYPED_OBJECT.createdAt.toISOString(),
    }),
    ['1000 records: JSON.stringify (keyed, reference)', () => JSON.stringify(RECORDS)],
    ['1000 records: stringify (rows)', () => rows.stringify(RECORDS)],
    ['1000 records: stringify (flat)', () => flat.stringify(RECORDS)],
    ['1000 records: stringify (columns)', () => columns.stringify(RECORDS)],
    ['1000 records: JSON.parse (keyed, reference)', () => JSON.parse(recordsText)],
    ['1000 records: parse (rows)', () => rows.parse(wires.rows)],
    ['1000 records: parse (flat)', () => flat.parse(wires.flat)],
    ['1000 records: parse (columns)', () => columns.parse(wires.columns)],
    ['Schema.from (nested definition, codegen)', () => Schema.from(NESTED)],
    ['Schema.from (nested definition, closures)', () => Schema.from(NESTED, { codegen: false })],
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
