/**
 * One (release, backend, scenario) triple of bench/releases.js in a fresh
 * process: the release is loaded from its tree (`index.js`), the scenario's
 * schema is built the way that release reads a definition (1.x its own
 * spelling of metaschema's, 2.x metaschema injected), the round trip is
 * checked, then `stringify`, `parse` and `Schema.from` are measured with the
 * comparison's harness; on the `binary` backend `toBinary` and `fromBinary`
 * of the release's `binary.js`, on generated code, and no `Schema.from`, which
 * is the text wire's. A scenario the release cannot express (a union before
 * 1.1, the binary wire before 2.1) prints `{ unsupported }`.
 *
 * Usage (spawned by bench/releases.js): node bench/compare/releases-worker.js '<json options>'
 */
const fs = require('node:fs');
const path = require('node:path');

const { measure } = require('./measure.js');
const { SCENARIOS } = require('./scenarios.js');
const { plain } = require('./adapters.js');

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

const main = () => {
  const options = JSON.parse(process.argv[2]);
  const scenario = SCENARIOS.find((item) => item.name === options.scenario);
  const { version } = require(path.join(options.src, 'package.json'));
  const { Schema } = require(path.join(options.src, 'index.js'));
  const definition = scenario.list
    ? { array: scenario.schema.definition }
    : scenario.schema.definition;
  const binary = options.backend === 'binary';
  if (binary && !fs.existsSync(path.join(options.src, 'binary.js'))) {
    process.stdout.write(`${JSON.stringify({ unsupported: 'no binary wire' })}\n`);
    return;
  }
  const settings = { ...scenario.schema.options, codegen: options.backend !== 'closures' };
  if (Number(version.split('.')[0]) >= 2) settings.metaschema = require('@alexify/metaschema');
  let schema;
  try {
    schema = Schema.from(definition, settings);
  } catch (error) {
    process.stdout.write(`${JSON.stringify({ unsupported: error.message })}\n`);
    return;
  }
  if (binary) {
    const { toBinary, fromBinary } = require(path.join(options.src, 'binary.js'));
    const bytes = toBinary(schema, scenario.value);
    if (canonical(plain(fromBinary(schema, bytes))) !== canonical(plain(scenario.value))) {
      throw new Error(`${version} does not round-trip ${scenario.name} on the binary wire`);
    }
    const measured = {
      encode: measure(() => toBinary(schema, scenario.value), options.method),
      decode: measure(() => fromBinary(schema, bytes), options.method),
    };
    process.stdout.write(`${JSON.stringify(measured)}\n`);
    return;
  }
  const wire = schema.stringify(scenario.value);
  const back = canonical(plain(schema.parse(wire)));
  if (back !== canonical(plain(scenario.value))) {
    throw new Error(`${version} does not round-trip ${scenario.name}`);
  }
  const result = {
    encode: measure(() => schema.stringify(scenario.value), options.method),
    decode: measure(() => schema.parse(wire), options.method),
    build: measure(() => Schema.from(definition, settings), { ...options.method, warmup: 50 }),
  };
  process.stdout.write(`${JSON.stringify(result)}\n`);
};

try {
  main();
} catch (error) {
  process.stderr.write(`${error?.stack ?? error}\n`);
  process.exitCode = 1;
}
