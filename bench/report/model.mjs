/**
 * Chart models for the benchmark results in bench/results/*.json and
 * bench/baseline.json: the one place that decides what a chart shows (rows,
 * order, grouping, scale, formatting). Two renderers read it: the docs
 * components (docs/.vitepress/theme/components/Bench*.vue, HTML bars) and the
 * README images (bench/report/svg.mjs). ESM so that Vite can import it; the
 * CommonJS report script loads it with import().
 *
 * A row's `tone` says how it is emphasized: `primary` for protoarray with
 * generated code, `secondary` for its other ways of running, none for the
 * rest. A model's `reference` draws a line at a value (JSON, or ×1).
 */

const trim = (value) => String(Number(value.toPrecision(3)));

/** 779878 → "780k", 16685662 → "16.7M", 1219 → "1,219". */
export const compact = (value) => {
  const abs = Math.abs(value);
  if (abs >= 1e6) return `${trim(value / 1e6)}M`;
  if (abs >= 1e4) return `${trim(value / 1e3)}k`;
  return Math.round(value).toLocaleString('en-US');
};

/** A full integer with thousands separators, for tables. */
export const grouped = (value) => Math.round(value).toLocaleString('en-US');

/** Three significant figures, thousands-separated: 779878 → "780,000". */
export const approx = (value) => {
  const digits = Math.max(0, Math.floor(Math.log10(Math.abs(value))) + 1 - 3);
  return (Math.round(value / 10 ** digits) * 10 ** digits).toLocaleString('en-US');
};

/** The time one call takes at `perSecond` calls a second. */
export const perCall = (perSecond) => {
  const seconds = 1 / perSecond;
  if (seconds >= 1e-3) return `${trim(seconds * 1e3)} ms`;
  if (seconds >= 1e-6) return `${trim(seconds * 1e6)} µs`;
  return `${trim(seconds * 1e9)} ns`;
};

/** 135 → "135 B", 140738 → "137.4 KB". */
export const bytes = (value) =>
  value < 1024 ? `${Math.round(value)} B` : `${(value / 1024).toFixed(1)} KB`;

export const formatValue = (value, unit) => {
  if (unit === 'ms') return `${value < 10 ? value.toFixed(1) : Math.round(value)} ms`;
  if (unit === 'KB') return `${value.toFixed(1)} KB`;
  if (unit === 'B') return bytes(value);
  if (unit === '×') return `×${value < 10 ? value.toFixed(2) : Math.round(value)}`;
  return compact(value);
};

// ─── Scales ─────────────────────────────────────────────────────────────────

const niceStep = (raw) => {
  const magnitude = 10 ** Math.floor(Math.log10(raw));
  const residual = raw / magnitude;
  const nice = residual <= 1 ? 1 : residual <= 2 ? 2 : residual <= 5 ? 5 : 10;
  return nice * magnitude;
};

const tickLabel = (value, unit) => {
  if (value === 0) return '0';
  if (unit === '×') return `×${trim(value)}`;
  if (unit === 'ms' || unit === 'KB') return `${trim(value)} ${unit}`;
  if (unit === 'B') return value < 1024 ? `${trim(value)} B` : `${trim(value / 1024)} KB`;
  return compact(value);
};

/**
 * `{ ticks: [{ value, label, at }], at(value) }`, where `at` maps a value to
 * 0..1 along the bar track. A linear scale starts at zero; a log scale spans
 * whole decades around the data (the bars then encode orders of magnitude,
 * which the subtitle says).
 */
export const createScale = (values, kind, unit) => {
  const max = Math.max(...values);
  if (kind === 'log') {
    const min = Math.min(...values.filter((value) => value > 0));
    const lo = Math.floor(Math.log10(min));
    const hi = Math.max(lo + 1, Math.ceil(Math.log10(max)));
    const at = (value) => (Math.log10(Math.max(value, 10 ** lo)) - lo) / (hi - lo);
    const ticks = [];
    for (let exp = lo; exp <= hi; exp++) {
      ticks.push({ value: 10 ** exp, label: tickLabel(10 ** exp, unit), at: at(10 ** exp) });
    }
    return { kind, at, ticks };
  }
  const step = niceStep(max / 4);
  const top = Math.ceil(max / step) * step;
  const at = (value) => value / top;
  const ticks = [];
  for (let value = 0; value <= top + step / 2; value += step) {
    ticks.push({ value, label: tickLabel(value, unit), at: at(value) });
  }
  return { kind, at, ticks };
};

// ─── Captions ───────────────────────────────────────────────────────────────

const day = (iso) => iso.slice(0, 10);

export const machineCaption = (machine) =>
  [machine.cpu, `${machine.cores} cores`, `Node ${machine.node}`].join(' · ');

const rounds = (method) => `median of ${method.rounds} × ${method.roundMs} ms rounds`;

export const compareCaption = (compare) =>
  `${machineCaption(compare.machine)} · ${rounds(compare.method)}, ` +
  `each library and scenario in a fresh process · ${day(compare.generatedAt)}`;

export const coldStartCaption = (compare) =>
  `${machineCaption(compare.machine)} · ${day(compare.generatedAt)}`;

export const releasesCaption = (releases) =>
  `${machineCaption(releases.machine)} · ${rounds(releases.method)}, ` +
  `each release, backend and scenario in a fresh process · ${day(releases.generatedAt)}`;

export const engineCaption = (baseline) =>
  `pnpm bench, bench/baseline.json · Node ${baseline.node} · ${day(baseline.date)}`;

// ─── Cross-library comparison ───────────────────────────────────────────────

const OWN = '@alexify/protoarray';

// The variant a chart puts forward: generated code in the speed charts; in
// the cold start and the bundle size, protoarray alone (a schema from its
// snapshot), which is what a client loads.
const toneOf = (library, primary) =>
  library.id === primary ? 'primary' : library.package === OWN ? 'secondary' : undefined;

const libraryRow = (library, value, extra, primary = 'protoarray') => ({
  id: library.id,
  label: library.name,
  sublabel: library.variant,
  value,
  tone: toneOf(library, primary),
  ...extra,
});

const CLIENT = 'protoarray-snapshot';

const versionNote = (library) =>
  library.package === OWN
    ? `${OWN}@${library.version}${library.commit ? ` (${library.commit})` : ''}`
    : library.package.includes(' ') || library.package.startsWith('node:')
      ? `${library.package}, Node ${library.version}`
      : `${library.package}@${library.version}`;

const FAMILY = { text: 'writes JSON text', binary: 'writes bytes' };

const roundTrip = (result) => 1 / (1 / result.encode.median + 1 / result.decode.median);

export const METRICS = [
  {
    id: 'roundtrip',
    label: 'round trip',
    title: 'Round trip',
    unit: 'ops/s',
    higher: true,
    what: 'Encode one payload and decode it, payloads a second',
    value: roundTrip,
  },
  {
    id: 'encode',
    label: 'encode',
    title: 'Encode',
    unit: 'ops/s',
    higher: true,
    what: 'The value to text or bytes, ops/s',
    value: (result) => result.encode.median,
    samples: (result) => result.encode,
  },
  {
    id: 'decode',
    label: 'decode',
    title: 'Decode',
    unit: 'ops/s',
    higher: true,
    what: 'Text or bytes back to the value, ops/s',
    value: (result) => result.decode.median,
    samples: (result) => result.decode,
  },
  {
    id: 'bytes',
    label: 'payload size',
    title: 'Bytes',
    unit: 'B',
    higher: false,
    what: 'The payload as sent, before compression',
    value: (result) => result.bytes.raw,
  },
  {
    id: 'gzip',
    label: 'payload after gzip',
    title: 'gzip',
    unit: 'B',
    higher: false,
    what: 'The payload after gzip',
    value: (result) => result.bytes.gzip,
  },
  {
    id: 'brotli',
    label: 'payload after brotli',
    title: 'brotli',
    unit: 'B',
    higher: false,
    what: 'The payload after brotli',
    value: (result) => result.bytes.brotli,
  },
];

const metricOf = (id) => METRICS.find((metric) => metric.id === id) ?? METRICS[0];

/** The scenarios of the comparison: what the tabs show. */
export const compareScenarios = (compare) =>
  compare.scenarios.map(({ id, title, description }) => ({ id, title, description }));

const sentence = (text) => text.charAt(0).toUpperCase() + text.slice(1);

const ok = (result) => result !== undefined && result.error === undefined;

export const compareModel = (compare, scenarioId, metricId = 'roundtrip', scale = 'linear') => {
  const scenario =
    compare.scenarios.find((candidate) => candidate.id === scenarioId) ?? compare.scenarios[0];
  const metric = metricOf(metricId);
  const json = scenario.results.json;
  const reference = ok(json) ? metric.value(json) : undefined;
  const relative = (value) => {
    if (reference === undefined) return null;
    if (metric.higher) return `×${(value / reference).toFixed(2)} the speed of JSON`;
    return `${Math.round((value / reference) * 100)}% of the JSON bytes`;
  };
  const rows = compare.libraries
    .filter((library) => ok(scenario.results[library.id]))
    .map((library) => {
      const result = scenario.results[library.id];
      const value = metric.value(result);
      const samples = metric.samples?.(result);
      const details = [
        metric.unit === 'B' ? `${grouped(value)} bytes` : `${grouped(value)} ops/s`,
        metric.unit === 'B' ? null : `${perCall(value)} per payload`,
        library.id === 'json' ? null : relative(value),
        samples ? `rounds ${compact(samples.min)} – ${compact(samples.max)}` : null,
        `${versionNote(library)}, ${FAMILY[library.family]}`,
      ].filter(Boolean);
      return libraryRow(library, value, { details });
    })
    .sort((a, b) => (metric.higher ? b.value - a.value : a.value - b.value));
  const missing = compare.libraries.filter(
    (library) => library.package !== OWN && !ok(scenario.results[library.id]),
  );
  const note = missing.length
    ? ` Not run here: ${missing.map((library) => library.name).join(', ')}.`
    : '';
  const axis = scale === 'log' ? 'log scale' : 'linear scale';
  const better = metric.higher ? 'higher is better' : 'lower is better';
  return {
    id: `compare-${scenario.id}-${metric.id}`,
    title: `${scenario.title}: ${metric.label}`,
    subtitle:
      `${sentence(scenario.description)}. ${metric.what}, ${axis}, ${better}.` +
      `${reference === undefined ? '' : ' The line marks JSON.'}${note}`,
    unit: metric.unit,
    scale,
    reference,
    groups: [{ id: 'all', label: null, rows }],
  };
};

export const coldStartModel = (compare) => {
  const ms = (value) => `${value < 1 ? value.toFixed(2) : value.toFixed(1)} ms`;
  const results = compare.coldStart.results;
  const rows = compare.libraries
    .filter((library) => ok(results[library.id]))
    .map((library) => {
      const phases = results[library.id];
      return libraryRow(
        library,
        phases.total,
        {
          details: [
            `${ms(phases.total)} in total`,
            `load ${ms(phases.load)} · build ${ms(phases.build)}`,
            `first encode ${ms(phases.encode)} · first decode ${ms(phases.decode)}`,
            versionNote(library),
          ],
        },
        CLIENT,
      );
    })
    .sort((a, b) => a.value - b.value);
  return {
    id: 'coldstart',
    title: 'Cold start',
    subtitle:
      'Load the library, build the schema of one record, encode it and decode it once: a ' +
      `fresh process, median of ${compare.method.coldStartRuns} runs. Lower is better.`,
    unit: 'ms',
    scale: 'linear',
    groups: [{ id: 'all', label: null, rows }],
  };
};

export const sizeModel = (size) => {
  const kb = (value) => `${(value / 1024).toFixed(1)} KB`;
  const rows = size.libraries
    .map((library) =>
      libraryRow(
        library,
        library.gzip / 1024,
        {
          details: [
            `${kb(library.gzip)} min+gzip`,
            `${kb(library.min)} minified`,
            versionNote(library),
            ...(library.note ? [library.note] : []),
          ],
        },
        CLIENT,
      ),
    )
    .sort((a, b) => a.value - b.value);
  return {
    id: 'size',
    title: 'Bundle size',
    subtitle:
      'A browser bundle that builds the schema of one record, encodes it and decodes it ' +
      '(esbuild, minified, tree-shaken), min+gzip. Lower is better.',
    unit: 'KB',
    scale: 'linear',
    groups: [{ id: 'all', label: null, rows }],
  };
};

// ─── Release over release ───────────────────────────────────────────────────

const versionKey = (version) => {
  const [major, minor, patch] = version.split('.').map(Number);
  return major * 1e4 + minor * 1e2 + patch;
};

const BACKEND = { codegen: 'Generated code', closures: 'Closures, no eval' };
const BACKENDS = ['codegen', 'closures'];

/** Releases oldest first. */
export const releaseList = (releases, backend) =>
  releases.releases
    .filter((entry) => entry.backend === backend)
    .sort((a, b) => versionKey(a.version) - versionKey(b.version));

const BUILD = { id: 'build', title: 'Schema.from' };

/** The tabs: the comparison's scenarios, and building the record's schema. */
export const releaseScenarios = (releases) => [
  ...releases.scenarios.map(({ id, title }) => ({ id, title })),
  BUILD,
];

const OPS = [
  { id: 'encode', label: 'encode', tone: 'primary' },
  { id: 'decode', label: 'decode', tone: 'secondary' },
];

export const releaseModel = (releases, scenarioId) => {
  const build = scenarioId === BUILD.id;
  const scenario = build
    ? releases.scenarios[0]
    : (releases.scenarios.find((candidate) => candidate.id === scenarioId) ??
      releases.scenarios[0]);
  const groups = [];
  for (const backend of BACKENDS) {
    const rows = [];
    for (const entry of releaseList(releases, backend)) {
      const result = entry.results[scenario.id];
      if (!result) continue;
      const sublabel = entry.current ? 'this release' : null;
      if (build) {
        rows.push({
          id: entry.id,
          label: entry.version,
          sublabel,
          value: result.build.median,
          tone: entry.current ? 'primary' : undefined,
          details: [
            `${grouped(result.build.median)} schemas/s`,
            `${perCall(result.build.median)} per schema`,
          ],
        });
        continue;
      }
      rows.push({
        id: entry.id,
        label: entry.version,
        sublabel,
        value: Math.max(result.encode.median, result.decode.median),
        bars: OPS.map((op) => ({ value: result[op.id].median, tone: op.tone })),
        details: OPS.map(
          (op) =>
            `${op.label} ${grouped(result[op.id].median)} ops/s · ${perCall(result[op.id].median)}`,
        ),
      });
    }
    if (rows.length) groups.push({ id: backend, label: BACKEND[backend], rows });
  }
  return {
    id: `releases-${build ? 'build' : scenario.id}`,
    title: build
      ? `Schema.from of one record, release over release`
      : `${scenario.title}, release over release`,
    subtitle: build
      ? 'Building the schema from its definition (2.x: metaschema reads it first), schemas/s, ' +
        'linear scale, higher is better.'
      : `${sentence(scenario.description)}. stringify and parse, ops/s, linear scale, higher is better.`,
    unit: 'ops/s',
    scale: 'linear',
    legend: build ? undefined : OPS,
    groups,
  };
};

/** The current tree against the oldest release with the scenario, both backends. */
export const speedupModel = (releases) => {
  const groups = [];
  let current = null;
  for (const backend of BACKENDS) {
    const list = releaseList(releases, backend);
    const now = list.find((entry) => entry.current) ?? list[list.length - 1];
    if (!now) continue;
    current = now;
    const rows = [];
    for (const scenario of releases.scenarios) {
      const base = list.find((entry) => entry !== now && entry.results[scenario.id]);
      const result = now.results[scenario.id];
      if (!base || !result) continue;
      const before = base.results[scenario.id];
      const ratios = OPS.map((op) => result[op.id].median / before[op.id].median);
      rows.push({
        id: `${backend}-${scenario.id}`,
        label: scenario.title,
        sublabel: `against ${base.version}`,
        value: Math.max(...ratios),
        bars: OPS.map((op, i) => ({ value: ratios[i], tone: op.tone })),
        details: OPS.map(
          (op, i) =>
            `${op.label} ×${ratios[i].toFixed(2)}: ${grouped(before[op.id].median)} → ` +
            `${grouped(result[op.id].median)} ops/s`,
        ),
      });
    }
    if (rows.length) groups.push({ id: backend, label: BACKEND[backend], rows });
  }
  return {
    id: 'speedup',
    title: `protoarray ${current?.version ?? ''} against its first releases`,
    subtitle:
      'How many times as fast, scenario by scenario, against the oldest release that has it ' +
      '(1 = as fast; unions came in 1.1). Higher is better.',
    unit: '×',
    scale: 'linear',
    reference: 1,
    legend: OPS,
    groups,
  };
};

// ─── protoarray's own hot paths ─────────────────────────────────────────────

// The scenarios of `pnpm bench` the engine chart pairs up, by the prefix of
// their names there.
const ENGINE = [
  { prefix: 'flat object (4 fields)', label: 'Flat object', sublabel: '4 fields' },
  { prefix: 'nested object', label: 'Nested object', sublabel: 'records, a list of orders' },
  { prefix: 'sparse object (3 of 20)', label: 'Sparse object', sublabel: '3 of 20 fields' },
  { prefix: 'sparse object (3 of 70)', label: 'Wide sparse object', sublabel: '3 of 70 fields' },
  {
    prefix: 'typed object (enum, flags, date)',
    label: 'Typed object',
    sublabel: 'enum, flags, date',
  },
  { prefix: 'packet (union)', label: 'Tagged union', sublabel: 'a wrpc packet' },
  { prefix: 'money (decimals)', label: 'Money', sublabel: 'decimals' },
  { prefix: 'wide flags (70 names)', label: 'Wide flags', sublabel: '70 names' },
  { prefix: 'wide object (128 fields)', label: 'Wide object', sublabel: '128 fields' },
  { prefix: 'bytes (1 KB)', label: 'Bytes', sublabel: '1 KB, base64' },
];

const ENGINE_BARS = [
  { id: 'json', label: 'JSON, keyed object', tone: undefined },
  { id: 'codegen', label: 'generated code', tone: 'primary' },
  { id: 'closures', label: 'closures', tone: 'secondary' },
];

export const ENGINE_OPS = [
  { id: 'stringify', title: 'Encode' },
  { id: 'parse', title: 'Decode' },
];

/** `pnpm bench` (bench/baseline.json): a row per shape, a bar per backend and JSON's. */
export const engineModel = (baseline, op = 'stringify') => {
  const byName = new Map(baseline.results.map((row) => [row.name, row.opsPerSec]));
  const native = op === 'stringify' ? 'JSON.stringify' : 'JSON.parse';
  const rows = [];
  for (const shape of ENGINE) {
    const json =
      byName.get(`${shape.prefix}: ${native} (keyed, reference)`) ??
      byName.get(`${shape.prefix}: ${native} + base64 (reference)`);
    const codegen = byName.get(`${shape.prefix}: ${op} (codegen)`);
    const closures = byName.get(`${shape.prefix}: ${op} (closures)`);
    if (json === undefined || codegen === undefined || closures === undefined) continue;
    const values = { json, codegen, closures };
    rows.push({
      id: shape.prefix,
      label: shape.label,
      sublabel: shape.sublabel,
      value: Math.max(json, codegen, closures),
      bars: ENGINE_BARS.map((bar) => ({ value: values[bar.id], tone: bar.tone })),
      details: [
        ...ENGINE_BARS.map((bar) => `${bar.label} ${grouped(values[bar.id])} ops/s`),
        `generated code ×${(codegen / json).toFixed(2)} the speed of JSON, ` +
          `closures ×${(closures / json).toFixed(2)}`,
      ],
    });
  }
  const verb = op === 'stringify' ? 'stringify against JSON.stringify' : 'parse against JSON.parse';
  return {
    id: `engine-${op}`,
    title: `protoarray on its two backends: ${op === 'stringify' ? 'encode' : 'decode'}`,
    subtitle: `pnpm bench: ${verb} of the keyed object, ops/s, log scale, higher is better.`,
    unit: 'ops/s',
    scale: 'log',
    legend: ENGINE_BARS,
    groups: [{ id: 'all', label: null, rows }],
  };
};

const LAYOUTS = [
  {
    id: 'json',
    label: 'JSON',
    sublabel: 'keyed objects',
    names: ['JSON.stringify (keyed, reference)', 'JSON.parse (keyed, reference)'],
  },
  {
    id: 'rows',
    label: 'rows',
    sublabel: 'an array of arrays, the default',
    names: ['stringify (rows)', 'parse (rows)'],
  },
  {
    id: 'flat',
    label: 'flat',
    sublabel: 'one array, a fixed stride',
    names: ['stringify (flat)', 'parse (flat)'],
  },
  {
    id: 'columns',
    label: 'columns',
    sublabel: 'an array per field',
    names: ['stringify (columns)', 'parse (columns)'],
  },
  {
    id: 'compact',
    label: 'columns, delta + intern',
    sublabel: 'ids as differences, cities and tags interned',
    names: ['stringify (columns, delta + intern)', 'parse (columns, delta + intern)'],
  },
];

/** The layouts of a list of a thousand records (`pnpm bench`). */
export const layoutsModel = (baseline) => {
  const byName = new Map(baseline.results.map((row) => [row.name, row.opsPerSec]));
  const rows = [];
  for (const layout of LAYOUTS) {
    const values = layout.names.map((name) => byName.get(`1000 records: ${name}`));
    if (values.includes(undefined)) continue;
    rows.push({
      id: layout.id,
      label: layout.label,
      sublabel: layout.sublabel,
      value: Math.max(...values),
      tone: layout.id === 'json' ? undefined : 'primary',
      bars: OPS.map((op, i) => ({
        value: values[i],
        tone: layout.id === 'json' ? undefined : op.tone,
      })),
      details: OPS.map(
        (op, i) => `${op.label} ${grouped(values[i])} lists/s · ${perCall(values[i])}`,
      ),
    });
  }
  return {
    id: 'layouts',
    title: 'Layouts of a list of a thousand records',
    subtitle: 'pnpm bench, generated code: lists a second, linear scale, higher is better.',
    unit: 'ops/s',
    scale: 'linear',
    legend: OPS,
    groups: [{ id: 'all', label: null, rows }],
  };
};

/** The bars of a row: one, unless the row compares several. */
export const barsOf = (row) => row.bars ?? [{ value: row.value, tone: row.tone }];

export const allValues = (model) => [
  ...model.groups.flatMap((group) =>
    group.rows.flatMap((row) => barsOf(row).map((bar) => bar.value)),
  ),
  ...(model.reference === undefined ? [] : [model.reference]),
];

export const allRows = (model) => model.groups.flatMap((group) => group.rows);
