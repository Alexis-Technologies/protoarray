/**
 * Comparative benchmark: protoarray against JSON and the usual JavaScript
 * codecs, on the payload shapes in bench/compare/scenarios.js, plus the cold
 * start of each library.
 *
 * Run: pnpm bench:compare [--scenarios a,b] [--adapters x,y] [--no-cold-start]
 *                         [--cold-start-only] [--rounds n] [--round-ms ms] [--json] [--save]
 *
 * Every (library, scenario) pair runs in a fresh process; an adapter must
 * round-trip the scenario value before it is timed. A cold start is
 * `coldStartRuns` fresh processes per library that load it, build the schema
 * of the `single` scenario, encode the value once and decode it once.
 * `--save` merges what ran into bench/results/compare.json (a pair or a cold
 * start that did not run keeps its previous result), which `pnpm bench:report`
 * turns into the charts and tables of the docs and the README. msgpackr and
 * cbor-x run their pure JavaScript paths (their native extracts are not built
 * here), which is what a browser gets. Manual only, not part of CI; run it on
 * an otherwise idle machine.
 */

const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const zlib = require('node:zlib');

const { SCENARIOS } = require('./compare/scenarios.js');
const { ADAPTERS, plain } = require('./compare/adapters.js');
const { describeMachine } = require('./machine.js');

const ROOT = path.join(__dirname, '..');
const RESULTS = path.join(__dirname, 'results', 'compare.json');
const COLD_START_RUNS = 10;
const COLD_START_SCENARIO = 'single';
const GZIP_LEVEL = 6;
const BROTLI_QUALITY = 5;

const sizes = (wire) => {
  const buffer = Buffer.from(wire);
  return {
    raw: buffer.length,
    gzip: zlib.gzipSync(buffer, { level: GZIP_LEVEL }).length,
    brotli: zlib.brotliCompressSync(buffer, {
      params: { [zlib.constants.BROTLI_PARAM_QUALITY]: BROTLI_QUALITY },
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

const scenarioOf = (name) => SCENARIOS.find((item) => item.name === name);

const checkRoundTrip = (adapterId, scenario, codec, wire) => {
  const expected = canonical(plain(scenario.value));
  const actual = canonical(plain(codec.normalize(codec.decode(wire))));
  if (actual !== expected) {
    throw new Error(`${adapterId} does not round-trip ${scenario.name}:\n${actual}\n${expected}`);
  }
};

// Child mode: one pair, printed as JSON on stdout.
const runPair = (adapterId, scenarioName, prepared, method) => {
  const { measure } = require('./compare/measure.js');
  const adapter = ADAPTERS[adapterId];
  const scenario = scenarioOf(scenarioName);
  const codec = adapter.setup(scenario, adapter.load(prepared), prepared);
  const wire = codec.encode(scenario.value);
  checkRoundTrip(adapterId, scenario, codec, wire);
  const result = {
    encode: measure(() => codec.encode(scenario.value), method),
    decode: measure(() => codec.decode(wire), method),
    bytes: sizes(wire),
  };
  process.stdout.write(JSON.stringify(result));
};

// Child mode: one cold start. `process.hrtime`, because loading
// `node:perf_hooks` would be charged to nobody; the round trip is checked
// after the clock stops.
const runColdStart = (adapterId, scenarioName, prepared) => {
  const adapter = ADAPTERS[adapterId];
  const scenario = scenarioOf(scenarioName);
  const now = () => Number(process.hrtime.bigint()) / 1e6;
  const t0 = now();
  const lib = adapter.load(prepared);
  const t1 = now();
  const codec = adapter.setup(scenario, lib, prepared);
  const t2 = now();
  const wire = codec.encode(scenario.value);
  const t3 = now();
  codec.decode(wire);
  const t4 = now();
  checkRoundTrip(adapterId, scenario, codec, wire);
  const result = {
    load: t1 - t0,
    build: t2 - t1,
    encode: t3 - t2,
    decode: t4 - t3,
    total: t4 - t0,
  };
  process.stdout.write(JSON.stringify(result));
};

const parseArgs = () => {
  const args = process.argv.slice(2);
  const option = (name) => {
    const index = args.indexOf(name);
    return index === -1 ? null : args[index + 1];
  };
  const { METHOD } = require('./compare/measure.js');
  return {
    method: {
      ...METHOD,
      rounds: Number(option('--rounds') ?? METHOD.rounds),
      roundMs: Number(option('--round-ms') ?? METHOD.roundMs),
    },
    scenarios: option('--scenarios')?.split(',') ?? SCENARIOS.map((item) => item.name),
    adapters: option('--adapters')?.split(',') ?? Object.keys(ADAPTERS),
    coldStart: !args.includes('--no-cold-start'),
    pairs: !args.includes('--cold-start-only'),
    json: args.includes('--json'),
    save: args.includes('--save'),
  };
};

// The commit the numbers are of: a branch keeps the version of its last
// release until it makes the next one.
const commit = () => {
  try {
    const sha = execFileSync('git', ['rev-parse', '--short', 'HEAD'], { cwd: __dirname });
    return `+${String(sha).trim()}`;
  } catch {
    return '';
  }
};

// Read through the filesystem: some packages do not export their package.json.
const versionOf = (adapter) => {
  if (adapter.package === '@alexify/protoarray') return `${require('../package.json').version}`;
  if (adapter.package === null) return process.version.slice(1);
  const file = path.join(ROOT, 'node_modules', adapter.package, 'package.json');
  return JSON.parse(fs.readFileSync(file, 'utf8')).version;
};

const libraryOf = (id) => {
  const adapter = ADAPTERS[id];
  const library = {
    id,
    name: adapter.name,
    variant: adapter.variant,
    package: adapter.package ?? (id === 'json' ? 'JSON (built in)' : 'node:v8'),
    version: versionOf(adapter),
    family: adapter.family,
  };
  if (adapter.package === '@alexify/protoarray') library.commit = commit().slice(1);
  return library;
};

const child = (mode, adapterId, scenarioName, prepared, method) => {
  const output = execFileSync(
    process.execPath,
    [
      __filename,
      mode,
      adapterId,
      scenarioName,
      JSON.stringify(prepared ?? null),
      JSON.stringify(method ?? null),
    ],
    { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], maxBuffer: 16 * 1024 * 1024 },
  );
  return JSON.parse(output);
};

const withPrepared = (adapter, scenario, fn) => {
  const prepared = adapter.prepare ? adapter.prepare(scenario) : null;
  try {
    return fn(prepared);
  } finally {
    // A generated module lives in a directory of its own.
    if (prepared?.file) fs.rmSync(path.dirname(prepared.file), { recursive: true, force: true });
  }
};

const failure = (error) =>
  String(error.stderr || error.message)
    .trim()
    .split('\n')[0];

const format = (n) => Math.round(n).toLocaleString('en-US');

const printScenario = (scenario, results) => {
  console.log(`\n### ${scenario.name} — ${scenario.description}\n`);
  console.log('| Library | encode ops/s | decode ops/s | bytes | gzip | brotli |');
  console.log('| --- | ---: | ---: | ---: | ---: | ---: |');
  for (const [id, result] of Object.entries(results)) {
    const name = `${ADAPTERS[id].name} (${ADAPTERS[id].variant})`;
    if (result.error) {
      console.log(`| ${name} | error: ${result.error} | | | | |`);
      continue;
    }
    console.log(
      `| ${name} | ${format(result.encode.median)} ±${result.encode.spread}% | ` +
        `${format(result.decode.median)} ±${result.decode.spread}% | ${format(result.bytes.raw)} | ` +
        `${format(result.bytes.gzip)} | ${format(result.bytes.brotli)} |`,
    );
  }
};

const median = (values) => {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)];
};

const runColdStarts = (adapterIds) => {
  const scenario = scenarioOf(COLD_START_SCENARIO);
  const results = {};
  console.log(`\n### cold start — ${scenario.description}, ${COLD_START_RUNS} runs\n`);
  for (const id of adapterIds) {
    const adapter = ADAPTERS[id];
    if (adapter.coldStart === false || (adapter.only && !adapter.only(scenario))) continue;
    try {
      const runs = withPrepared(adapter, scenario, (prepared) =>
        Array.from({ length: COLD_START_RUNS }, () => child('--cold', id, scenario.name, prepared)),
      );
      const phases = {};
      for (const phase of ['load', 'build', 'encode', 'decode', 'total']) {
        phases[phase] = Number(median(runs.map((run) => run[phase])).toFixed(3));
      }
      results[id] = phases;
      console.log(
        `${`${adapter.name} (${adapter.variant})`.padEnd(48)} ${phases.total.toFixed(1).padStart(7)} ms` +
          `  load ${phases.load.toFixed(1)} · build ${phases.build.toFixed(1)} · ` +
          `encode ${phases.encode.toFixed(2)} · decode ${phases.decode.toFixed(2)}`,
      );
    } catch (error) {
      results[id] = { error: failure(error) };
      console.log(`${adapter.name} (${adapter.variant}): error: ${results[id].error}`);
    }
  }
  return results;
};

const readPrevious = () => {
  try {
    const previous = JSON.parse(fs.readFileSync(RESULTS, 'utf8'));
    return previous.libraries ? previous : null;
  } catch {
    return null;
  }
};

// What ran replaces what was there; the rest of the previous report stays.
const merge = (previous, report) => {
  if (!previous) return report;
  const libraries = new Map(previous.libraries.map((library) => [library.id, library]));
  for (const library of report.libraries) libraries.set(library.id, library);
  const scenarios = previous.scenarios.map((scenario) => ({ ...scenario }));
  for (const scenario of report.scenarios) {
    const index = scenarios.findIndex((item) => item.id === scenario.id);
    if (index === -1) scenarios.push(scenario);
    else scenarios[index].results = { ...scenarios[index].results, ...scenario.results };
  }
  const order = SCENARIOS.map((item) => item.name);
  scenarios.sort((a, b) => order.indexOf(a.id) - order.indexOf(b.id));
  const ids = Object.keys(ADAPTERS);
  return {
    ...report,
    libraries: [...libraries.values()]
      .filter((library) => ids.includes(library.id))
      .sort((a, b) => ids.indexOf(a.id) - ids.indexOf(b.id)),
    scenarios,
    coldStart: {
      ...report.coldStart,
      results: { ...previous.coldStart?.results, ...report.coldStart.results },
    },
  };
};

const main = () => {
  const options = parseArgs();
  const used = new Set();
  const report = {
    generatedAt: new Date().toISOString(),
    machine: describeMachine(),
    method: {
      ...options.method,
      coldStartRuns: COLD_START_RUNS,
      gzipLevel: GZIP_LEVEL,
      brotliQuality: BROTLI_QUALITY,
    },
    libraries: [],
    scenarios: [],
    coldStart: { scenario: COLD_START_SCENARIO, results: {} },
  };
  if (options.pairs) {
    for (const scenarioName of options.scenarios) {
      const scenario = scenarioOf(scenarioName);
      const results = {};
      for (const id of options.adapters) {
        const adapter = ADAPTERS[id];
        if (adapter.coldStartOnly || (adapter.only && !adapter.only(scenario))) continue;
        used.add(id);
        try {
          results[id] = withPrepared(adapter, scenario, (prepared) =>
            child('--pair', id, scenarioName, prepared, options.method),
          );
        } catch (error) {
          results[id] = { error: failure(error) };
        }
      }
      report.scenarios.push({
        id: scenario.name,
        title: scenario.title,
        description: scenario.description,
        results,
      });
      if (!options.json) printScenario(scenario, results);
    }
  }
  if (options.coldStart) {
    report.coldStart.results = runColdStarts(options.adapters);
    for (const id of Object.keys(report.coldStart.results)) used.add(id);
  }
  report.libraries = Object.keys(ADAPTERS)
    .filter((id) => used.has(id))
    .map(libraryOf);
  if (options.json) console.log(JSON.stringify(report, null, 2));
  if (options.save) {
    fs.mkdirSync(path.dirname(RESULTS), { recursive: true });
    fs.writeFileSync(RESULTS, `${JSON.stringify(merge(readPrevious(), report), null, 2)}\n`);
    if (!options.json) console.log(`\nSaved to ${path.relative(ROOT, RESULTS)}`);
  }
};

const [mode, adapterId, scenarioName, prepared, method] = process.argv.slice(2);
if (mode === '--pair') runPair(adapterId, scenarioName, JSON.parse(prepared), JSON.parse(method));
else if (mode === '--cold') runColdStart(adapterId, scenarioName, JSON.parse(prepared));
else main();
