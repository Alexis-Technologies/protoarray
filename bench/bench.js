/**
 * Zero-dependency ops/sec benchmark for protoarray's hot paths.
 *
 * Run: pnpm bench [filter] [--json] [--save] [--compare]
 *
 * An optional filter runs only the scenarios whose name contains it, e.g.
 * `pnpm bench decode`. `--json` prints the results as JSON, `--save` writes
 * them to bench/baseline.json, and `--compare` prints the change against
 * that baseline (numbers are machine-specific: compare on one machine, before
 * and after a change). Every number is the median of five rounds and comes
 * with its spread, so a change inside the spread is noise. Manual only, not
 * part of CI. `pnpm bench:compare` is the comparison against other libraries.
 *
 * Every protoarray scenario has its JSON reference next to it: the same value
 * through JSON.stringify/JSON.parse as a keyed object.
 */

const { execFileSync } = require('node:child_process');
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

// A wrpc call packet, one branch of a union.
const PACKET = {
  union: [
    {
      Struct: {},
      type: { enum: ['call'] },
      id: 'string',
      method: 'string',
      args: { room: 'string', text: 'string' },
    },
    { Struct: {}, type: { enum: ['callback'] }, id: 'string', result: 'json' },
    { Struct: {}, type: { enum: ['event'] }, name: 'string', data: 'json' },
  ],
  discriminator: 'type',
};
const PACKET_OBJECT = {
  type: 'call',
  id: '1042',
  method: 'chat/send',
  args: { room: 'general', text: 'Hello, world' },
};
const MONEY = {
  price: { type: 'number', decimals: 2 },
  qty: 'number',
  total: { type: 'number', decimals: 2 },
};
const MONEY_OBJECT = { price: 19.99, qty: 3, total: 59.97 };
const BLOB = Uint8Array.from({ length: 1024 }, (_, i) => (i * 31) % 256);
// Past 31 slots: a sparse record of several segments, flags of several words.
const SPARSE70 = Object.fromEntries(Array.from({ length: 70 }, (_, i) => [`field${i}`, '?json']));
const SPARSE70_OBJECT = { field0: 'value', field35: 42, field69: true };
const WIDE_FLAGS = {
  id: 'number',
  perms: { flags: Array.from({ length: 70 }, (_, i) => `n${i}`) },
};
const WIDE_FLAGS_OBJECT = { id: 1, perms: { n1: true, n35: true, n69: true } };

// Each entry: [label, schema definition, options, value, json reference value].
// Encoding is measured as it is by default (the values trusted) and with
// `validate: 'both'` (the values checked), for both backends.
const pairs = (label, definition, options, value, reference = value) => {
  const codegen = Schema.from(definition, { ...options, codegen: true });
  const closures = Schema.from(definition, { ...options, codegen: false });
  const both = {
    codegen: Schema.from(definition, { ...options, codegen: true, validate: 'both' }),
    closures: Schema.from(definition, { ...options, codegen: false, validate: 'both' }),
  };
  const text = JSON.stringify(reference);
  const wire = codegen.stringify(value);
  return [
    [`${label}: JSON.stringify (keyed, reference)`, () => JSON.stringify(reference)],
    [`${label}: stringify (codegen)`, () => codegen.stringify(value)],
    [`${label}: stringify (codegen, validate: 'both')`, () => both.codegen.stringify(value)],
    [`${label}: stringify (closures)`, () => closures.stringify(value)],
    [`${label}: stringify (closures, validate: 'both')`, () => both.closures.stringify(value)],
    [`${label}: JSON.parse (keyed, reference)`, () => JSON.parse(text)],
    [`${label}: parse (codegen)`, () => codegen.parse(wire)],
    [`${label}: parse (closures)`, () => closures.parse(wire)],
  ];
};

// What building a schema costs where nothing is warm: a fresh process requires
// the package, compiles the schema and runs one round trip. The median of
// several processes, in milliseconds.
const COLD_RUNS = 15;
const coldStart = (label, definition, options, value) => {
  const script = `
    const t0 = performance.now();
    const { Schema } = require(${JSON.stringify(path.join(__dirname, '..', 'index.js'))});
    const t1 = performance.now();
    const schema = Schema.from(${JSON.stringify(definition)}, ${JSON.stringify(options)});
    const t2 = performance.now();
    schema.decode(schema.encode(${JSON.stringify(value)}));
    const t3 = performance.now();
    process.stdout.write(JSON.stringify([t1 - t0, t2 - t1, t3 - t2]));
  `;
  const runs = [];
  for (let i = 0; i < COLD_RUNS; i++) {
    const output = execFileSync(process.execPath, ['-e', script], { encoding: 'utf8' });
    runs.push(JSON.parse(output));
  }
  const median = (index) => {
    const sorted = runs.map((run) => run[index]).sort((a, b) => a - b);
    return sorted[Math.floor(COLD_RUNS / 2)];
  };
  const result = { name: label, requireMs: median(0), buildMs: median(1), firstCallMs: median(2) };
  if (!json) {
    const ms = (n) => `${n.toFixed(2)} ms`.padStart(10);
    console.log(
      `${label.padEnd(44)} ${ms(result.requireMs)} ${ms(result.buildMs)} ${ms(result.firstCallMs)}`,
    );
  }
  return result;
};

const main = () => {
  if (!json) console.log(`Node ${process.version} | ${new Date().toISOString()}\n`);
  const rows = Schema.from({ array: RECORD });
  const trusting = { flat: Schema.from(FLAT, { validate: false }) };
  const checked = {
    nested: Schema.from(NESTED),
    nestedClosures: Schema.from(NESTED, { codegen: false }),
    packet: Schema.from(PACKET),
    packetClosures: Schema.from(PACKET, { codegen: false }),
  };
  const blob = Schema.from({ id: 'number', data: 'bytes' });
  const blobClosures = Schema.from({ id: 'number', data: 'bytes' }, { codegen: false });
  trusting.blob = Schema.from({ id: 'number', data: 'bytes' }, { validate: false });
  const blobText = blob.stringify({ id: 1, data: BLOB });
  const blobKeyed = JSON.stringify({ id: 1, data: Buffer.from(BLOB).toString('base64') });
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
    ...pairs('packet (union)', PACKET, {}, PACKET_OBJECT),
    ...pairs('money (decimals)', MONEY, {}, MONEY_OBJECT),
    ...pairs('sparse object (3 of 70)', SPARSE70, { sparse: true }, SPARSE70_OBJECT),
    ...pairs('wide flags (70 names)', WIDE_FLAGS, {}, WIDE_FLAGS_OBJECT),
    // check() runs the checking codec, compiled once: a validation that never throws.
    ['nested object: check (codegen)', () => checked.nested.check(NESTED_OBJECT)],
    ['nested object: check (closures)', () => checked.nestedClosures.check(NESTED_OBJECT)],
    ['packet (union): check (codegen)', () => checked.packet.check(PACKET_OBJECT)],
    ['packet (union): check (closures)', () => checked.packetClosures.check(PACKET_OBJECT)],
    // JSON has no bytes: the reference converts with Buffer as an application would.
    [
      'bytes (1 KB): JSON.stringify + base64 (reference)',
      () => JSON.stringify({ id: 1, data: Buffer.from(BLOB).toString('base64') }),
    ],
    ['bytes (1 KB): stringify (codegen)', () => blob.stringify({ id: 1, data: BLOB })],
    ['bytes (1 KB): stringify (closures)', () => blobClosures.stringify({ id: 1, data: BLOB })],
    [
      'bytes (1 KB): JSON.parse + base64 (reference)',
      () => {
        const value = JSON.parse(blobKeyed);
        value.data = Buffer.from(value.data, 'base64');
        return value;
      },
    ],
    ['bytes (1 KB): parse (codegen)', () => blob.parse(blobText)],
    ['bytes (1 KB): parse (closures)', () => blobClosures.parse(blobText)],
    ['bytes (1 KB): parse (codegen, validate: false)', () => trusting.blob.parse(blobText)],
    // The control: by default an encode is the trusting one.
    [
      'flat object (4 fields): stringify (codegen, validate: false)',
      () => trusting.flat.stringify(FLAT_OBJECT),
    ],
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
  const cold = [];
  if ('cold start'.includes(filter) || filter === '') {
    if (!json) {
      console.log(`\nCold start (fresh process, median of ${COLD_RUNS}):`);
      console.log(
        `${''.padEnd(44)} ${'require'.padStart(10)} ${'build'.padStart(10)} ${'first call'.padStart(10)}`,
      );
    }
    cold.push(
      coldStart('nested object (codegen)', NESTED, {}, NESTED_OBJECT),
      coldStart('nested object (closures)', NESTED, { codegen: false }, NESTED_OBJECT),
      coldStart('packet (union, codegen)', PACKET, {}, PACKET_OBJECT),
      coldStart('sparse object (70 fields, codegen)', SPARSE70, { sparse: true }, SPARSE70_OBJECT),
    );
  }
  if (json) console.log(JSON.stringify({ results, coldStart: cold }, null, 2));
  if (flags.has('--save')) {
    const snapshot = {
      node: process.version,
      date: new Date().toISOString(),
      results,
      coldStart: cold,
    };
    fs.writeFileSync(BASELINE, `${JSON.stringify(snapshot, null, 2)}\n`);
    if (!json) console.log(`\nSaved ${results.length} results to ${BASELINE}`);
  }
  if (flags.has('--compare')) compare(results);
};

main();
