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

const vm = require('node:vm');
const metaschema = require('@alexify/metaschema');
const { Schema } = require('../index.js');
const { resolve } = require('../resolve.js');
const { toSource } = require('../standalone.js');
const { parseItems } = require('../stream.js');
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

// The definitions are metaschema's, read with metaschema injected.
const from = (definition, options) => Schema.from(definition, { metaschema, ...options });

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
const SPARSE = Object.fromEntries(Array.from({ length: 20 }, (_, i) => [`field${i}`, '?any']));
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
const SPARSE70 = Object.fromEntries(Array.from({ length: 70 }, (_, i) => [`field${i}`, '?any']));
const SPARSE70_OBJECT = { field0: 'value', field35: 42, field69: true };
const WIDE_FLAGS = {
  id: 'number',
  perms: { flags: Array.from({ length: 70 }, (_, i) => `n${i}`) },
};
const WIDE_FLAGS_OBJECT = { id: 1, perms: { n1: true, n35: true, n69: true } };
// A record of 128 fields of the types that travel as they are: past 127 keys
// V8 keeps an object parsed from JSON in dictionary mode, which is where the
// closures backend's template used to fall off a cliff.
const WIDE_TYPES = ['string', 'integer', 'boolean', 'number'];
const WIDE128 = Object.fromEntries(
  Array.from({ length: 128 }, (_, i) => [`f${String(i).padStart(5, '0')}`, WIDE_TYPES[i % 4]]),
);
const WIDE128_OBJECT = Object.fromEntries(
  Object.keys(WIDE128).map((key, i) => {
    const type = i % 4;
    return [key, type === 0 ? `v${i}` : type === 1 ? i : type === 2 ? (i & 1) === 0 : i / 8];
  }),
);
// A record of converted types only: where `stringify: 'auto'` writes the text itself.
const CONVERTED = {
  id: 'integer',
  createdAt: 'date',
  active: 'boolean',
  role: { enum: ['admin', 'editor', 'viewer', 'owner'] },
  perms: { flags: ['read', 'write', 'admin'] },
};
const CONVERTED_OBJECT = {
  id: 7,
  createdAt: new Date(1700000000000),
  active: true,
  role: 'editor',
  perms: { read: true, admin: true },
};
// The same records with an integer id written as differences and the role
// interned, in columns.
const COMPACT_RECORD = { ...RECORD, id: 'integer' };
const COMPACT = { layout: 'columns', delta: ['[].id'], intern: ['[].role'] };

// An inline standalone module of a schema, loaded as a runtime without code
// generation would load it (here code generation is allowed, but the module
// does not use it).
const standalone = (schema) => {
  const module = { exports: {} };
  const load = vm.runInThisContext(
    `(function (module) {${toSource(schema, { runtime: 'inline' })}\n})`,
  );
  load(module);
  return module.exports;
};

// An async scenario: ops/sec as the median of five rounds, after a warm-up,
// each round as many runs as fill `budget` milliseconds (a run being slow, a
// fixed count of them made the spread of a round ±17%).
const benchAsync = async (name, fn, budget = 250) => {
  const warmed = performance.now();
  let count = 0;
  while (performance.now() - warmed < budget) {
    await fn();
    count += 1;
  }
  const samples = [];
  for (let round = 0; round < 5; round++) {
    const start = performance.now();
    for (let i = 0; i < count; i++) await fn();
    samples.push((count / (performance.now() - start)) * 1000);
  }
  samples.sort((a, b) => a - b);
  const opsPerSec = Math.round(samples[2]);
  const spread = Math.round(((samples[4] - samples[0]) / opsPerSec) * 100);
  if (!json) {
    console.log(
      `${name.padEnd(60)} ${opsPerSec.toLocaleString('en-US').padStart(12)} ops/sec  ±${spread}%`,
    );
  }
  return { name, opsPerSec, spread };
};

// Each entry: [label, schema definition, options, value, json reference value].
// Encoding is measured as it is (the values trusted) and after metaschema's
// check of the same schema (the values checked), for both backends.
const pairs = (label, definition, options, value, reference = value) => {
  const codegen = from(definition, { ...options, codegen: true });
  const closures = from(definition, { ...options, codegen: false });
  const checked = (schema) => () => {
    if (!schema.source.check(value).valid) throw new TypeError('invalid value');
    return schema.stringify(value);
  };
  const text = JSON.stringify(reference);
  const wire = codegen.stringify(value);
  return [
    [`${label}: JSON.stringify (keyed, reference)`, () => JSON.stringify(reference)],
    [`${label}: stringify (codegen)`, () => codegen.stringify(value)],
    [`${label}: check (metaschema) + stringify (codegen)`, checked(codegen)],
    [`${label}: stringify (closures)`, () => closures.stringify(value)],
    [`${label}: check (metaschema) + stringify (closures)`, checked(closures)],
    [`${label}: JSON.parse (keyed, reference)`, () => JSON.parse(text)],
    [`${label}: parse (codegen)`, () => codegen.parse(wire)],
    [`${label}: parse (closures)`, () => closures.parse(wire)],
  ];
};

// What building a schema costs where nothing is warm: a fresh process requires
// the package (and metaschema, to read a definition), builds the schema and
// runs one round trip. From a snapshot, protoarray needs nothing else: what a
// client given its schemas by a server or a build step does. The median of
// several processes, in milliseconds.
const COLD_RUNS = 15;
const coldStart = (label, definition, options, value, fromSnapshot = false) => {
  const entry = JSON.stringify(path.join(__dirname, '..', 'index.js'));
  const snapshot = JSON.stringify(from(definition).snapshot);
  const build = fromSnapshot
    ? `Schema.from(${snapshot}, ${JSON.stringify(options)})`
    : `Schema.from(${JSON.stringify(definition)}, { ...${JSON.stringify(options)}, metaschema })`;
  const script = `
    const t0 = performance.now();
    const { Schema } = require(${entry});
    ${fromSnapshot ? '' : "const metaschema = require('@alexify/metaschema');"}
    const t1 = performance.now();
    const schema = ${build};
    const t2 = performance.now();
    schema.decode(schema.encode(${JSON.stringify(value)}));
    const t3 = performance.now();
    process.stdout.write(JSON.stringify([t1 - t0, t2 - t1, t3 - t2]));
  `;
  const runs = [];
  for (let i = 0; i < COLD_RUNS; i++) {
    const output = execFileSync(process.execPath, ['-e', script], {
      encoding: 'utf8',
      cwd: path.join(__dirname, '..'),
    });
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

const main = async () => {
  if (!json) console.log(`Node ${process.version} | ${new Date().toISOString()}\n`);
  const rows = from({ array: RECORD });
  const trusting = { flat: from(FLAT, { validate: false }) };
  const native = from(NESTED);
  const blob = from({ id: 'number', data: 'bytes' });
  const blobClosures = from({ id: 'number', data: 'bytes' }, { codegen: false });
  trusting.blob = from({ id: 'number', data: 'bytes' }, { validate: false });
  const blobText = blob.stringify({ id: 1, data: BLOB });
  const blobKeyed = JSON.stringify({ id: 1, data: Buffer.from(BLOB).toString('base64') });
  const flat = from({ array: RECORD }, { layout: 'flat' });
  const columns = from({ array: RECORD }, { layout: 'columns' });
  const recordsText = JSON.stringify(RECORDS);
  // The text builder: by default for converted types, on request for any.
  const text = {
    converted: from(CONVERTED),
    convertedNative: from(CONVERTED, { stringify: 'native' }),
    nestedBuilder: from(NESTED, { stringify: 'builder' }),
    typedBuilder: from(TYPED, { stringify: 'builder' }),
  };
  // Another version of the flat record: a renamed field, a new one with a default.
  const flatV1 = from(FLAT);
  const flatV2 = from({
    name: 'string',
    years: { type: 'number', aliases: ['age'] },
    email: 'string',
    active: 'boolean',
    plan: { type: 'string', default: 'free' },
  });
  const resolved = resolve(flatV1, flatV2);
  const flatText = flatV1.stringify(FLAT_OBJECT);
  const compact = from({ array: COMPACT_RECORD }, COMPACT);
  const compactText = compact.stringify(RECORDS);
  const inline = { nested: standalone(from(NESTED)) };
  const nestedSnapshot = JSON.parse(JSON.stringify(from(NESTED).snapshot));
  const nestedText = from(NESTED).stringify(NESTED_OBJECT);
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
    ...pairs('wide object (128 fields)', WIDE128, {}, WIDE128_OBJECT),
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
    // The builder's text is read once, as sending it would: a string built by
    // concatenation is flattened then, which a fair comparison has to count.
    [
      'converted record: stringify + read (codegen, stringify: auto, the builder)',
      () => text.converted.stringify(CONVERTED_OBJECT).charCodeAt(1),
    ],
    [
      'converted record: stringify + read (codegen, stringify: native)',
      () => text.convertedNative.stringify(CONVERTED_OBJECT).charCodeAt(1),
    ],
    [
      'nested object: stringify + read (codegen, stringify: builder)',
      () => text.nestedBuilder.stringify(NESTED_OBJECT).charCodeAt(1),
    ],
    [
      'nested object: stringify + read (codegen, stringify: native)',
      () => native.stringify(NESTED_OBJECT).charCodeAt(1),
    ],
    [
      'typed object (enum, flags, date): stringify + read (codegen, stringify: builder)',
      () => text.typedBuilder.stringify(TYPED_OBJECT).charCodeAt(1),
    ],
    ['resolved (renamed, defaulted): parse (codegen)', () => resolved.parse(flatText)],
    [
      'resolved (renamed, defaulted): stringify (codegen)',
      () => resolved.stringify(resolved.parse(flatText)),
    ],
    ['1000 records: stringify (columns, delta + intern)', () => compact.stringify(RECORDS)],
    ['1000 records: parse (columns, delta + intern)', () => compact.parse(compactText)],
    ['nested object: stringify (standalone, inline)', () => inline.nested.stringify(NESTED_OBJECT)],
    ['nested object: parse (standalone, inline)', () => inline.nested.parse(nestedText)],
    ['Schema.from (nested definition, codegen)', () => from(NESTED)],
    ['Schema.from (nested definition, closures)', () => from(NESTED, { codegen: false })],
    ['Schema.from (nested snapshot, codegen)', () => Schema.from(nestedSnapshot)],
  ];

  const results = [];
  for (const [name, fn] of scenarios) {
    if (name.includes(filter)) results.push(bench(name, fn, { quiet: json }));
  }
  // The array of a collection read item by item while it arrives, against
  // parsing it whole: the price of not holding the text.
  const streamed = [
    [
      '1000 records: parseItems (stream, 64 KB chunks)',
      async () => {
        const chunks = [];
        for (let i = 0; i < wires.rows.length; i += 65536) {
          chunks.push(wires.rows.slice(i, i + 65536));
        }
        for await (const item of parseItems(rows, chunks)) if (item === null) break;
      },
    ],
    ['1000 records: parse (rows, whole text)', async () => rows.parse(wires.rows)],
  ];
  for (const [name, fn] of streamed) {
    if (name.includes(filter)) results.push(await benchAsync(name, fn));
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
      coldStart('nested object (snapshot, codegen)', NESTED, {}, NESTED_OBJECT, true),
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
