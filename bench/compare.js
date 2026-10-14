/**
 * Comparative benchmark: protoarray against JSON and the usual JavaScript
 * codecs, on the payload shapes in bench/compare/scenarios.js.
 *
 * Run: pnpm bench:compare [--scenarios a,b] [--adapters x,y] [--json] [--save]
 *
 * Every (library, scenario) pair runs in a fresh process; an adapter must
 * round-trip the scenario value before it is timed. `--save` writes
 * bench/results/compare.json. msgpackr and cbor-x run their pure JavaScript
 * paths (their native extracts are not built here), which is what a browser
 * gets. Manual only, not part of CI.
 */

const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const zlib = require('node:zlib');
const { performance } = require('node:perf_hooks');

const { SCENARIOS } = require('./compare/scenarios.js');
const { ADAPTERS, plain } = require('./compare/adapters.js');

const RESULTS = path.join(__dirname, 'results', 'compare.json');
const MEASURE_MS = 400;
const ROUNDS = 5;

const measure = (fn) => {
  for (let i = 0; i < 500; i++) fn();
  const samples = [];
  for (let round = 0; round < ROUNDS; round++) {
    let iterations = 0;
    const start = performance.now();
    while (performance.now() - start < MEASURE_MS) {
      fn();
      iterations++;
    }
    samples.push((iterations / (performance.now() - start)) * 1000);
  }
  samples.sort((a, b) => a - b);
  return Math.round(samples[Math.floor(samples.length / 2)]);
};

const sizes = (wire) => {
  const buffer = typeof wire === 'string' ? Buffer.from(wire) : Buffer.from(wire);
  return {
    raw: buffer.length,
    gzip: zlib.gzipSync(buffer, { level: 6 }).length,
    brotli: zlib.brotliCompressSync(buffer, {
      params: { [zlib.constants.BROTLI_PARAM_QUALITY]: 5 },
    }).length,
  };
};

// Key order is not part of the comparison: protobufjs lists repeated fields first.
const canonical = (value) =>
  JSON.stringify(value, (key, item) =>
    item !== null && typeof item === 'object' && !Array.isArray(item)
      ? Object.fromEntries(
          Object.keys(item)
            .sort()
            .map((name) => [name, item[name]]),
        )
      : item,
  );

// Child mode: one pair, printed as JSON on stdout.
const runPair = (adapterId, scenarioName) => {
  const scenario = SCENARIOS.find((item) => item.name === scenarioName);
  const codec = ADAPTERS[adapterId].setup(scenario);
  const wire = codec.encode(scenario.value);
  const expected = canonical(plain(scenario.value));
  const actual = canonical(plain(codec.normalize(codec.decode(wire))));
  if (actual !== expected) {
    throw new Error(`${adapterId} does not round-trip ${scenarioName}:\n${actual}\n${expected}`);
  }
  const result = {
    encode: measure(() => codec.encode(scenario.value)),
    decode: measure(() => codec.decode(wire)),
    bytes: sizes(wire),
  };
  process.stdout.write(JSON.stringify(result));
};

const parseArgs = () => {
  const args = process.argv.slice(2);
  const option = (name) => {
    const index = args.indexOf(name);
    return index === -1 ? null : args[index + 1];
  };
  return {
    scenarios: option('--scenarios')?.split(',') ?? SCENARIOS.map((item) => item.name),
    adapters: option('--adapters')?.split(',') ?? Object.keys(ADAPTERS),
    json: args.includes('--json'),
    save: args.includes('--save'),
  };
};

// Read through the filesystem: some packages do not export their package.json.
const versionOf = (id) => {
  if (id.startsWith('protoarray')) return require('../package.json').version;
  if (id === 'json') return process.version;
  const name = id === 'msgpack' ? '@msgpack/msgpack' : id.replace('-records', '');
  const file = path.join(__dirname, '..', 'node_modules', name, 'package.json');
  return JSON.parse(fs.readFileSync(file, 'utf8')).version;
};

const format = (n) => n.toLocaleString('en-US');

const main = () => {
  const options = parseArgs();
  const report = {
    date: new Date().toISOString(),
    node: process.version,
    v8: process.versions.v8,
    cpu: require('node:os').cpus()[0].model,
    scenarios: [],
  };
  for (const scenarioName of options.scenarios) {
    const scenario = SCENARIOS.find((item) => item.name === scenarioName);
    const rows = [];
    for (const adapterId of options.adapters) {
      const adapter = ADAPTERS[adapterId];
      if (adapter.only && !adapter.only(scenario)) continue;
      let result;
      try {
        const output = execFileSync(
          process.execPath,
          [__filename, '--pair', adapterId, scenarioName],
          {
            encoding: 'utf8',
            stdio: ['ignore', 'pipe', 'pipe'],
          },
        );
        result = {
          id: adapterId,
          name: adapter.name,
          version: versionOf(adapterId),
          ...JSON.parse(output),
        };
      } catch (error) {
        result = {
          id: adapterId,
          name: adapter.name,
          version: versionOf(adapterId),
          error: String(error.stderr || error.message).split('\n')[0],
        };
      }
      rows.push(result);
    }
    report.scenarios.push({
      name: scenario.name,
      description: scenario.description,
      results: rows,
    });
    if (options.json) continue;
    console.log(`\n### ${scenario.name} — ${scenario.description}\n`);
    console.log('| Library | encode ops/s | decode ops/s | bytes | gzip | brotli |');
    console.log('| --- | ---: | ---: | ---: | ---: | ---: |');
    const json = rows.find((row) => row.id === 'json');
    for (const row of rows) {
      if (row.error) {
        console.log(`| ${row.name} | error: ${row.error} | | | | |`);
        continue;
      }
      const rel = (value, base) => (json && !json.error ? ` (×${(value / base).toFixed(2)})` : '');
      console.log(
        `| ${row.name} | ${format(row.encode)}${rel(row.encode, json.encode)} | ${format(row.decode)}${rel(row.decode, json.decode)} | ${format(row.bytes.raw)} | ${format(row.bytes.gzip)} | ${format(row.bytes.brotli)} |`,
      );
    }
  }
  if (options.json) console.log(JSON.stringify(report, null, 2));
  if (options.save) {
    fs.mkdirSync(path.dirname(RESULTS), { recursive: true });
    fs.writeFileSync(RESULTS, `${JSON.stringify(report, null, 2)}\n`);
    if (!options.json) console.log(`\nSaved to ${RESULTS}`);
  }
};

if (process.argv[2] === '--pair') runPair(process.argv[3], process.argv[4]);
else main();
