/**
 * Cross-library bundle sizes for the docs and the README: what a browser
 * program pays to send and read the `single` record of the comparison
 * (bench/compare/scenarios.js) with each library. Each entry imports what it
 * uses, builds the schema the way the library documents and exports a
 * `roundTrip` (encode, then decode); esbuild bundles it for the browser
 * (minified, tree-shaken, as scripts/size.js does for protoarray's own
 * entries), the bundle is loaded and must give the record back, and the
 * report gives min and min+gzip. Measuring the whole package instead would
 * charge a tree-shakable library for what a program never imports.
 *
 * JSON costs nothing and v8.serialize is Node only, so neither has a row.
 *
 * Run: pnpm size:compare [--save]   (--save writes bench/results/size.json)
 */
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { gzipSync } = require('node:zlib');
const esbuild = require('esbuild');

const { SCENARIOS } = require('../bench/compare/scenarios.js');
const { ADAPTERS } = require('../bench/compare/adapters.js');

const ROOT = path.join(__dirname, '..');
const OUT = path.join(ROOT, 'bench', 'results', 'size.json');
const SCENARIO = SCENARIOS.find((item) => item.name === 'single');
const USER = SCENARIO.schema;
const ROLES = USER.definition.role.enum;

const metaschema = require('@alexify/metaschema');
const { Schema } = require('../index.js');
const SNAPSHOT = Schema.from(USER.definition, { metaschema }).snapshot;

// The descriptor protoc-gen-es would embed in generated code.
const protobufEsDescriptor = () =>
  ADAPTERS['protobuf-es'].prepare({ ...SCENARIO, list: false }).descriptor;

const standaloneModule = () => {
  const { toSource } = require('../standalone.js');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'protoarray-size-'));
  const file = path.join(dir, 'user.js');
  fs.writeFileSync(
    file,
    toSource(Schema.from(USER.definition, { metaschema }), { runtime: 'inline' }),
  );
  return file;
};

const json = (value) => JSON.stringify(value);

const ENTRIES = [
  {
    id: 'protoarray-snapshot',
    note: 'the schema built from its snapshot: a client without metaschema',
    source: () => `import { Schema } from './browser.js';
const User = Schema.from(${json(SNAPSHOT)});
export const roundTrip = (value) => User.parse(User.stringify(value));`,
  },
  {
    id: 'protoarray',
    variant: 'codegen, metaschema definition',
    note: 'protoarray and @alexify/metaschema, which reads the definition and validates values',
    source: () => `import { Schema } from './browser.js';
import * as metaschema from '@alexify/metaschema';
const User = Schema.from(${json(USER.definition)}, { metaschema });
export const roundTrip = (value) => User.parse(User.stringify(value));`,
  },
  {
    id: 'protoarray-standalone',
    note: 'the module protoarray compile writes for this schema, with its inline runtime',
    source: () => `import User from ${json(standaloneModule())};
export const roundTrip = (value) => User.parse(User.stringify(value));`,
  },
  {
    id: 'protobufjs',
    variant: 'protobufjs/light, Root.fromJSON',
    note: 'reflection; static code from pbjs with protobufjs/minimal is smaller, plus the generated code',
    source: () => `import protobuf from 'protobufjs/light';
const User = protobuf.Root.fromJSON(${json(USER.proto)}).lookupType('User');
const options = { enums: String, longs: Number, defaults: true, arrays: true };
export const roundTrip = (value) =>
  User.toObject(User.decode(User.encode(User.fromObject(value)).finish()), options);`,
  },
  {
    id: 'protobuf-es',
    note: 'the runtime and the descriptor generated code embeds',
    source: () => `import { create, toBinary, fromBinary } from '@bufbuild/protobuf';
import { fileDesc } from '@bufbuild/protobuf/codegenv2';
const file = fileDesc(${json(protobufEsDescriptor())});
const User = file.messages.find((message) => message.name === 'User');
const ROLES = ${json(ROLES)};
const plain = (message) => {
  const { $typeName, ...rest } = message;
  for (const key of Object.keys(rest)) {
    const item = rest[key];
    if (Array.isArray(item)) rest[key] = item.map((x) => (typeof x === 'object' ? plain(x) : x));
    else if (item !== null && typeof item === 'object') rest[key] = plain(item);
  }
  return rest;
};
export const roundTrip = (value) => {
  const message = create(User, { ...value, role: ROLES.indexOf(value.role) });
  const back = plain(fromBinary(User, toBinary(User, message)));
  return { ...back, role: ROLES[back.role] };
};`,
  },
  {
    id: 'avsc',
    note: "avsc's browser build of types, with the buffer and util polyfills it requires",
    source: () => `import avro from 'avsc/etc/browser/avsc-types.js';
const User = avro.Type.forSchema(${json(USER.avro)});
export const roundTrip = (value) => User.fromBuffer(User.toBuffer(value));`,
  },
  {
    id: 'msgpackr-records',
    source: () => `import { Packr } from 'msgpackr';
const packr = new Packr({ useRecords: true, structures: [] });
export const roundTrip = (value) => packr.unpack(packr.pack(value));`,
  },
  {
    id: 'msgpack',
    source: () => `import { encode, decode } from '@msgpack/msgpack';
export const roundTrip = (value) => decode(encode(value));`,
  },
  {
    id: 'cbor-x',
    source: () => `import { Encoder } from 'cbor-x';
const encoder = new Encoder({ useRecords: true });
export const roundTrip = (value) => encoder.decode(encoder.encode(value));`,
  },
  {
    id: 'bson',
    source: () => `import { BSON } from 'bson';
export const roundTrip = (value) => BSON.deserialize(BSON.serialize(value));`,
  },
  {
    id: 'superjson',
    source: () => `import { stringify, parse } from 'superjson';
export const roundTrip = (value) => parse(stringify(value));`,
  },
  {
    id: 'devalue',
    source: () => `import { stringify, parse } from 'devalue';
export const roundTrip = (value) => parse(stringify(value));`,
  },
  {
    id: 'fast-json-stringify',
    note: 'encode only; JSON.parse decodes',
    source: () => `import fjs from 'fast-json-stringify';
const stringify = fjs(${json(USER.json)});
export const roundTrip = (value) => JSON.parse(stringify(value));`,
  },
];

const bundle = async (entry) => {
  const result = await esbuild.build({
    stdin: { contents: entry.source(), resolveDir: ROOT, loader: 'js' },
    bundle: true,
    minify: true,
    format: 'esm',
    platform: 'browser',
    write: false,
    logLevel: 'silent',
  });
  return Buffer.from(result.outputFiles[0].contents);
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

// A bundle that does not give the record back measures nothing.
const verify = async (entry, buffer) => {
  const url = `data:text/javascript;base64,${buffer.toString('base64')}`;
  let roundTrip = null;
  try {
    roundTrip = (await import(url)).roundTrip;
  } catch (error) {
    throw new Error(`${entry.id}: the bundle does not load: ${error.message}`, { cause: error });
  }
  const back = JSON.parse(JSON.stringify(roundTrip(SCENARIO.value)));
  if (canonical(back) !== canonical(SCENARIO.value)) {
    throw new Error(`${entry.id}: the bundle does not round-trip the record:\n${canonical(back)}`);
  }
};

const versionOf = (name) => {
  const file =
    name === '@alexify/protoarray' ? 'package.json' : `node_modules/${name}/package.json`;
  return JSON.parse(fs.readFileSync(path.join(ROOT, file), 'utf8')).version;
};

const kb = (bytes) => `${(bytes / 1024).toFixed(1)} KB`;

const main = async () => {
  const rows = [];
  for (const entry of ENTRIES) {
    const buffer = await bundle(entry);
    await verify(entry, buffer);
    const adapter = ADAPTERS[entry.id];
    rows.push({
      id: entry.id,
      name: adapter.name,
      variant: entry.variant ?? adapter.variant,
      package: adapter.package,
      version: versionOf(adapter.package),
      family: adapter.family,
      min: buffer.length,
      gzip: gzipSync(buffer, { level: 9 }).length,
      ...(entry.note ? { note: entry.note } : {}),
    });
  }
  console.log('| Library | min | min+gzip |');
  console.log('| --- | ---: | ---: |');
  for (const row of rows) {
    console.log(`| ${row.name} · ${row.variant} | ${kb(row.min)} | ${kb(row.gzip)} |`);
  }
  if (process.argv.includes('--save')) {
    const report = {
      generatedAt: new Date().toISOString(),
      scenario: SCENARIO.name,
      libraries: rows,
    };
    fs.mkdirSync(path.dirname(OUT), { recursive: true });
    fs.writeFileSync(OUT, `${JSON.stringify(report, null, 2)}\n`);
    console.log(`\nWrote ${path.relative(ROOT, OUT)}`);
  }
};

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
