#!/usr/bin/env node
/**
 * protoarray compile <module> [--out <file>] [--format cjs|esm] [--runtime import|inline]
 *                              [--only <A,B>]
 *
 * Loads a module (CommonJS or ES), takes the protoarray schemas it exports and
 * writes the module @alexify/protoarray/standalone's toSource makes of them:
 * their generated code, for runtimes that forbid compiling source text. A
 * module whose export is one schema gives a module with that one as its
 * default export; otherwise the schemas keep their export names. `--only`
 * keeps the named ones. Without `--out` the source goes to stdout.
 */

const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { toSource } = require('../standalone.js');

const USAGE =
  'Usage: protoarray compile <module> [--out <file>] [--format cjs|esm] ' +
  '[--runtime import|inline] [--only <A,B>]';

const BRAND = Symbol.for('alexify.protoarray.brand');
const isSchema = (value) => value !== null && typeof value === 'object' && value[BRAND] === true;

const VALUED = new Set(['--out', '--format', '--runtime', '--only']);

const parseArgs = (argv) => {
  const [command, ...rest] = argv;
  if (command !== 'compile') throw new Error(USAGE);
  const options = {};
  const files = [];
  for (let i = 0; i < rest.length; i++) {
    const arg = rest[i];
    if (!arg.startsWith('--')) files.push(arg);
    else if (VALUED.has(arg) && i + 1 < rest.length) options[arg.slice(2)] = rest[++i];
    else throw new Error(`Unknown or incomplete option ${arg}\n${USAGE}`);
  }
  if (files.length !== 1) throw new Error(USAGE);
  return { file: files[0], ...options };
};

// CommonJS first; an ES module through import(), which require() cannot load
// on older Node.js versions.
const load = async (file) => {
  const full = path.resolve(file);
  try {
    return require(full);
  } catch (error) {
    if (error.code !== 'ERR_REQUIRE_ESM' && error.code !== 'ERR_REQUIRE_ASYNC_MODULE') throw error;
  }
  return import(pathToFileURL(full).href);
};

// The schemas a module exports: itself when it is one, its schemas by name
// otherwise (an ES module's default export when it has nothing else).
const schemasOf = (loaded, only) => {
  if (isSchema(loaded)) return loaded;
  const names = Object.keys(loaded).filter((name) => isSchema(loaded[name]));
  if (names.length === 1 && names[0] === 'default') return loaded.default;
  const chosen = only === undefined ? names : only.split(',');
  const out = {};
  for (const name of chosen) {
    if (!isSchema(loaded[name])) throw new Error(`The module exports no schema "${name}"`);
    out[name] = loaded[name];
  }
  if (Object.keys(out).length === 0) throw new Error('The module exports no schema');
  return out;
};

const main = async () => {
  const args = parseArgs(process.argv.slice(2));
  const schemas = schemasOf(await load(args.file), args.only);
  const source = toSource(schemas, { runtime: args.runtime, format: args.format });
  if (args.out === undefined) process.stdout.write(source);
  else fs.writeFileSync(args.out, source);
};

main().catch((error) => {
  process.stderr.write(`${error.message}\n`);
  process.exitCode = 1;
});
