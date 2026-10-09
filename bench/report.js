/**
 * Renders bench/results/compare.json into the tables between the
 * `<!-- bench:compare:start -->` / `<!-- bench:compare:end -->` markers of
 * README.md and docs/guide/benchmarks.md. Run after `pnpm bench:compare --save`.
 */

const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const RESULTS = path.join(__dirname, 'results', 'compare.json');
const TARGETS = ['README.md', 'docs/guide/benchmarks.md'];

const format = (n) => n.toLocaleString('en-US');

const render = (report, { scenarios, full }) => {
  const lines = [];
  for (const scenario of report.scenarios) {
    if (!scenarios.includes(scenario.name)) continue;
    const json = scenario.results.find((row) => row.id === 'json');
    lines.push(`**${scenario.name}** — ${scenario.description}`, '');
    lines.push('| Library | encode ops/s | decode ops/s | bytes | gzip | brotli |');
    lines.push('| --- | ---: | ---: | ---: | ---: | ---: |');
    for (const row of scenario.results) {
      const shown =
        full || ['json', 'protoarray', 'protobufjs', 'msgpackr-records', 'avsc'].includes(row.id);
      if (!shown) continue;
      if (row.error) {
        lines.push(`| ${row.name} | error | | | | |`);
        continue;
      }
      const rel = (value, base) => (json && !json.error ? ` (×${(value / base).toFixed(2)})` : '');
      lines.push(
        `| ${row.name} | ${format(row.encode)}${rel(row.encode, json.encode)} | ` +
          `${format(row.decode)}${rel(row.decode, json.decode)} | ${format(row.bytes.raw)} | ` +
          `${format(row.bytes.gzip)} | ${format(row.bytes.brotli)} |`,
      );
    }
    lines.push('');
  }
  lines.push(
    `_Node ${report.node} (V8 ${report.v8}), ${report.cpu}, ${report.date.slice(0, 10)}. Median of 5 runs; ` +
      'bytes are the wire size of one payload (binary formats before any text encoding), gzip at level 6, brotli at quality 5._',
  );
  return lines.join('\n');
};

const main = () => {
  const report = JSON.parse(fs.readFileSync(RESULTS, 'utf8'));
  for (const target of TARGETS) {
    const file = path.join(ROOT, target);
    const source = fs.readFileSync(file, 'utf8');
    const start = '<!-- bench:compare:start -->';
    const end = '<!-- bench:compare:end -->';
    const from = source.indexOf(start);
    const to = source.indexOf(end);
    if (from === -1 || to === -1) throw new Error(`${target} has no bench:compare markers`);
    const full = target.startsWith('docs/');
    const scenarios = full ? report.scenarios.map((item) => item.name) : ['single', 'records'];
    const table = render(report, { scenarios, full });
    const next = `${source.slice(0, from + start.length)}\n\n${table}\n\n${source.slice(to)}`;
    fs.writeFileSync(file, next);
    console.log(`Updated ${target}`);
  }
};

main();
