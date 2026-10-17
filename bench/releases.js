/**
 * Release over release: the scenarios of the comparison
 * (bench/compare/scenarios.js) through `stringify` and `parse` of one release
 * on both backends, and `Schema.from` of its definition, measured with
 * today's harness so every release is measured on one machine the same way.
 * A release is a tag checked out into a temporary directory (`git archive`):
 * protoarray has no dependencies, so its tree runs as it is.
 *
 * Run:
 *   node bench/releases.js                 # the current tree
 *   node bench/releases.js --ref v1.0.0    # a tag (or any commit)
 *   [--rounds n] [--round-ms ms]           # the timing of bench/compare/measure.js
 *
 * Each run merges its release into bench/results/releases.json. Manual only;
 * run it on an otherwise idle machine.
 */
const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { parseArgs } = require('node:util');

const { SCENARIOS } = require('./compare/scenarios.js');
const { METHOD } = require('./compare/measure.js');
const { describeMachine } = require('./machine.js');

const ROOT = path.join(__dirname, '..');
const OUT = path.join(__dirname, 'results', 'releases.json');
const BACKENDS = ['codegen', 'closures'];

const { values: args } = parseArgs({
  options: {
    ref: { type: 'string' },
    rounds: { type: 'string', default: String(METHOD.rounds) },
    'round-ms': { type: 'string', default: String(METHOD.roundMs) },
    'no-write': { type: 'boolean', default: false },
  },
});

const checkout = (ref) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), `protoarray-${ref}-`));
  const archive = execFileSync('git', ['archive', '--format=tar', ref], {
    cwd: ROOT,
    maxBuffer: 64 * 1024 * 1024,
  });
  execFileSync('tar', ['-x', '-C', dir], { input: archive });
  return dir;
};

const worker = (options) => {
  const file = path.join(__dirname, 'compare', 'releases-worker.js');
  try {
    const stdout = execFileSync(process.execPath, [file, JSON.stringify(options)], {
      cwd: ROOT,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    return JSON.parse(stdout.trim().split('\n').pop());
  } catch (error) {
    throw new Error(`releases-worker failed:\n${error.stderr || error.message}`, { cause: error });
  }
};

const writeResults = (entries, machine) => {
  let existing = { releases: [] };
  try {
    existing = JSON.parse(fs.readFileSync(OUT, 'utf8'));
  } catch {
    // the first run
  }
  const ids = new Set(entries.map((entry) => entry.id));
  const kept = existing.releases.filter((entry) => !ids.has(entry.id));
  // A tree that is no longer current (the next release was cut) is history.
  const current = entries.some((entry) => entry.current);
  if (current) {
    for (const entry of kept) entry.current = false;
  }
  const report = {
    generatedAt: new Date().toISOString(),
    machine,
    method,
    scenarios: SCENARIOS.map(({ name, title, description }) => ({ id: name, title, description })),
    releases: [...kept, ...entries],
  };
  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.writeFileSync(OUT, `${JSON.stringify(report, null, 2)}\n`);
  console.log(`\nWrote ${path.relative(ROOT, OUT)}`);
};

const method = { ...METHOD, rounds: Number(args.rounds), roundMs: Number(args['round-ms']) };

const format = (value) => Math.round(value).toLocaleString('en-US');

const main = () => {
  const src = args.ref ? checkout(args.ref) : ROOT;
  try {
    const { version } = JSON.parse(fs.readFileSync(path.join(src, 'package.json'), 'utf8'));
    const machine = describeMachine();
    console.log(`@alexify/protoarray ${version} (${args.ref ?? 'the current tree'})`);
    console.log(`${machine.cpu} · Node ${machine.node}`);
    const entries = [];
    for (const backend of BACKENDS) {
      const entry = {
        id: `${version}-${backend}`,
        version,
        backend,
        current: !args.ref,
        results: {},
      };
      console.log(`\n${version} · ${backend}`);
      for (const scenario of SCENARIOS) {
        const result = worker({ src, backend, scenario: scenario.name, method });
        if (result.unsupported) {
          console.log(`  ${scenario.title.padEnd(20)} not supported: ${result.unsupported}`);
          continue;
        }
        entry.results[scenario.name] = result;
        console.log(
          `  ${scenario.title.padEnd(20)} encode ${format(result.encode.median).padStart(11)}` +
            `  decode ${format(result.decode.median).padStart(11)}` +
            `  Schema.from ${format(result.build.median).padStart(9)} ops/s`,
        );
      }
      entries.push(entry);
    }
    if (!args['no-write']) writeResults(entries, machine);
  } finally {
    if (src !== ROOT) fs.rmSync(src, { recursive: true, force: true });
  }
};

main();
