const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { spawnSync } = require('node:child_process');
const { Schema } = require('../../index.js');
const { toBinary, fromBinary } = require('../../binary.js');
const { define } = require('../support/schema.js');

const ROOT = path.join(__dirname, '../..');
const CLI = path.join(ROOT, 'bin', 'protoarray.js');

const cli = (...args) =>
  spawnSync(process.execPath, [CLI, ...args], { cwd: ROOT, encoding: 'utf8' });

// An inline module runs on its own: no require, no new Function.
const runInline = (source) => {
  const context = vm.createContext({ btoa, atob }, { codeGeneration: { strings: false } });
  const module = { exports: {} };
  vm.runInContext(`(function (module) {${source}\n})`, context)(module);
  return module.exports;
};

test('CLI: compile writes the module of the schemas a module exports', () => {
  const all = cli('compile', 'tests/fixtures/schemas.js', '--runtime', 'inline');
  assert.strictEqual(all.status, 0, all.stderr);
  const { Address, User } = runInline(all.stdout);
  assert.deepStrictEqual(JSON.parse(JSON.stringify(Address.encode({ city: 'Kyiv' }))), ['Kyiv']);
  assert.strictEqual(
    User.stringify({ id: 1, name: 'A', home: { city: 'K' }, role: 'user' }),
    '[1,"A",["K"],null,1]',
  );
  // The fixture exports metaschema schemas: the module has the ids protoarray gives them.
  assert.strictEqual(User.id, Schema.from(require('../fixtures/schemas.js').User).id);
  const only = cli('compile', 'tests/fixtures/schemas.js', '--only', 'Address', '--format', 'esm');
  assert.strictEqual(only.status, 0, only.stderr);
  assert.match(only.stdout, /^export \{ S0 as Address \};$/m);
  assert.match(only.stdout, /^import \{ Schema \} from '@alexify\/protoarray';$/m);
  assert.doesNotMatch(only.stdout, /User/);
});

test('CLI: --out, an ES module and a single schema', () => {
  const dir = path.join(ROOT, 'tests', '.generated');
  fs.mkdirSync(dir, { recursive: true });
  const out = path.join(dir, 'cli.js');
  const written = cli('compile', 'tests/fixtures/schemas.mjs', '--out', out, '--runtime', 'inline');
  assert.strictEqual(written.status, 0, written.stderr);
  assert.strictEqual(written.stdout, '');
  const single = runInline(fs.readFileSync(out, 'utf8'));
  assert.strictEqual(single.stringify({ id: 1, at: new Date(2) }), '[1,2]');
  assert.strictEqual(single.toString(), define({ id: 'integer', at: 'date' }).toString());
});

test('CLI: protoarray schemas and the entities of a metaschema Model', () => {
  const dir = path.join(ROOT, 'tests', '.generated');
  fs.mkdirSync(dir, { recursive: true });
  const prelude = [
    "const ms = require('@alexify/metaschema');",
    "const { Schema } = require('../../index.js');",
    'const entities = new Map([',
    "  ['Point', { Struct: {}, x: 'integer', y: 'integer' }],",
    "  ['Path', { Struct: {}, points: { array: 'Point' } }],",
    ']);',
    'const model = new ms.Model({}, entities);',
    "const Tag = Schema.from({ name: 'string' }, { metaschema: ms, intern: true });",
  ];
  const file = path.join(dir, 'model.js');
  fs.writeFileSync(file, [...prelude, 'module.exports = { model, Tag };\n'].join('\n'));
  const result = cli('compile', file, '--runtime', 'inline');
  assert.strictEqual(result.status, 0, result.stderr);
  const { Point, Path, Tag } = runInline(result.stdout);
  assert.strictEqual(Point.stringify({ x: 1, y: 2 }), '[1,2]');
  assert.strictEqual(Path.stringify({ points: [{ x: 1, y: 2 }] }), '[[[1,2]]]');
  assert.strictEqual(Path.toString(), '{points:[@Point]}');
  // A protoarray schema keeps the options it was built with.
  assert.strictEqual(Tag.stringify({ name: 'a' }), '[["a"],[0]]');
  const twice = path.join(dir, 'twice.js');
  const source = [...prelude, 'module.exports = { model, Point: Tag };\n'].join('\n');
  fs.writeFileSync(twice, source);
  const clash = cli('compile', twice);
  assert.strictEqual(clash.status, 1);
  assert.strictEqual(clash.stderr, 'Two schemas are exported as "Point"\n');
});

test('CLI: what it refuses', () => {
  const usage = /^Usage: protoarray compile <module>/m;
  // A wrong command line is exit code 2, a module that does not compile 1.
  for (const args of [[], ['build', 'x.js'], ['compile'], ['compile', 'a.js', 'b.js']]) {
    const result = cli(...args);
    assert.strictEqual(result.status, 2, args.join(' '));
    assert.match(result.stderr, usage);
  }
  for (const flag of ['--help', '-h']) {
    const help = cli(flag);
    assert.strictEqual(help.status, 0);
    assert.match(help.stdout, usage);
    assert.strictEqual(help.stderr, '');
  }
  const unknown = cli('compile', 'tests/fixtures/schemas.js', '--fast');
  assert.strictEqual(unknown.status, 2);
  assert.match(unknown.stderr, /^Unknown or incomplete option --fast/);
  // A flag takes no value: one given is another file.
  const valued = cli('compile', 'tests/fixtures/schemas.js', '--binary', 'true');
  assert.strictEqual(valued.status, 2);
  assert.match(valued.stderr, usage);
  const incomplete = cli('compile', 'tests/fixtures/schemas.js', '--out');
  assert.match(incomplete.stderr, /^Unknown or incomplete option --out/);
  const missing = cli('compile', 'tests/fixtures/schemas.js', '--only', 'Nope');
  assert.strictEqual(missing.status, 1);
  assert.strictEqual(missing.stderr, 'The module exports no schema "Nope"\n');
  const empty = cli('compile', 'tests/fixtures/empty.js');
  assert.strictEqual(empty.stderr, 'The module exports no schema\n');
  const bad = cli('compile', 'tests/fixtures/schemas.js', '--runtime', 'remote');
  assert.strictEqual(
    bad.stderr,
    'SchemaDefinitionError ERR_INVALID_OPTIONS: Invalid option "runtime": import or inline\n',
  );
  const absent = cli('compile', 'tests/fixtures/absent.js');
  assert.strictEqual(absent.status, 1);
  assert.match(absent.stderr, /Cannot find module/);
  // A module that does not load is reported with its file and line.
  const broken = cli('compile', 'README.md');
  assert.strictEqual(broken.status, 1);
  assert.match(broken.stderr, /README\.md:1/);
  assert.match(broken.stderr, /SyntaxError/);
  // The module it reads is never written over.
  const over = cli('compile', 'tests/fixtures/schemas.js', '--out', 'tests/fixtures/schemas.js');
  assert.strictEqual(over.status, 2);
  assert.match(over.stderr, /^--out names the module it reads/);
  // Without a command, the usage of every command; with one, its own.
  const all = cli();
  assert.match(all.stderr, /^ {7}protoarray snapshot <module>/m);
  assert.match(all.stderr, /^ {7}protoarray check <module> --against/m);
  const one = cli('snapshot');
  assert.match(
    one.stderr,
    /^Usage: protoarray snapshot <module> \[--only <A,B>\] \[--out <file>\]$/m,
  );
  assert.doesNotMatch(one.stderr, /compile/);
  // A flag of one command is no option of another.
  const flag = cli('snapshot', 'tests/fixtures/schemas.js', '--strict');
  assert.strictEqual(flag.status, 2);
  assert.match(flag.stderr, /^Unknown or incomplete option --strict/);
});

test('CLI: a Model as the whole module, names with spaces, --out in a new directory', () => {
  const dir = path.join(ROOT, 'tests', '.generated', 'model-only');
  fs.rmSync(dir, { recursive: true, force: true });
  fs.mkdirSync(path.join(ROOT, 'tests', '.generated'), { recursive: true });
  const file = path.join(ROOT, 'tests', '.generated', 'whole-model.js');
  fs.writeFileSync(
    file,
    [
      "const ms = require('@alexify/metaschema');",
      'module.exports = new ms.Model({}, new Map([',
      "  ['Point', { Struct: {}, x: 'integer' }],",
      "  ['Label', { Struct: {}, text: 'string' }],",
      ']));\n',
    ].join('\n'),
  );
  const out = path.join(dir, 'nested', 'module.js');
  const result = cli(
    'compile',
    file,
    '--only',
    ' Point , Label',
    '--runtime',
    'inline',
    '--out',
    out,
  );
  assert.strictEqual(result.status, 0, result.stderr);
  const { Point, Label } = runInline(fs.readFileSync(out, 'utf8'));
  assert.strictEqual(Point.stringify({ x: 1 }), '[1]');
  assert.strictEqual(Label.stringify({ text: 'a' }), '["a"]');
  // An error of a schema names its code, the schema and the field.
  const bad = path.join(ROOT, 'tests', '.generated', 'bad-model.js');
  fs.writeFileSync(
    bad,
    [
      "const { Schema } = require('../../index.js');",
      "const fields = { a: { type: 'nope' } };",
      "module.exports = { Odd: Schema.from({ format: 1, root: 'T', entities: { T: { fields } } }) };\n",
    ].join('\n'),
  );
  const failed = cli('compile', bad);
  assert.strictEqual(failed.status, 1);
  assert.strictEqual(
    failed.stderr,
    'SchemaDefinitionError ERR_UNKNOWN_TYPE: Unknown type "nope" at "a" (schema "T", field "a")\n',
  );
});

test('CLI: a module of one schema, one that waits at its top, one that throws a string', () => {
  const dir = path.join(ROOT, 'tests', '.generated');
  fs.mkdirSync(dir, { recursive: true });
  const write = (name, lines) => {
    const file = path.join(dir, name);
    fs.writeFileSync(file, `${lines.join('\n')}\n`);
    return file;
  };
  const one = write('one.js', [
    "const ms = require('@alexify/metaschema');",
    "const { Schema } = require('../../index.js');",
    "module.exports = Schema.from({ n: 'integer' }, { metaschema: ms });",
  ]);
  const single = cli('compile', one, '--runtime', 'inline');
  assert.strictEqual(single.status, 0, single.stderr);
  assert.strictEqual(runInline(single.stdout).stringify({ n: 1 }), '[1]');
  // An ES module with a top-level await is never one require() loads.
  const waiting = write('waiting.mjs', [
    "import ms from '@alexify/metaschema';",
    'await Promise.resolve();',
    "export const Point = ms.Schema.from({ x: 'integer' });",
  ]);
  const awaited = cli('compile', waiting, '--runtime', 'inline');
  assert.strictEqual(awaited.status, 0, awaited.stderr);
  assert.strictEqual(runInline(awaited.stdout).Point.stringify({ x: 2 }), '[2]');
  const throwing = write('throwing.js', ["throw 'not an error';"]);
  const thrown = cli('compile', throwing);
  assert.strictEqual(thrown.status, 1);
  assert.strictEqual(thrown.stderr, 'not an error\n');
});

test('CLI: snapshot writes a baseline and check compares a module with it', () => {
  const dir = path.join(ROOT, 'tests', '.generated', 'evolution');
  fs.rmSync(dir, { recursive: true, force: true });
  const fixture = (version) => path.join('tests', 'fixtures', 'evolution', `${version}.js`);
  const v1 = path.join(dir, 'v1.json');
  const written = cli('snapshot', fixture('v1'), '--out', v1);
  assert.strictEqual(written.status, 0, written.stderr);
  assert.strictEqual(written.stdout, '');
  const { baseline } = require('../../evolve.js');
  const { Schema: Definition } = require('@alexify/metaschema');
  const User = require('../fixtures/evolution/v1.js').User;
  assert.deepStrictEqual(
    JSON.parse(fs.readFileSync(v1, 'utf8')),
    JSON.parse(JSON.stringify(baseline({ User: Schema.from(User) }))),
  );
  assert.ok(User instanceof Definition);
  // Without --out, the baseline goes to stdout; --only keeps the named schemas.
  const printed = cli('snapshot', fixture('v4'), '--only', 'User,Address');
  assert.strictEqual(printed.status, 0, printed.stderr);
  assert.deepStrictEqual(Object.keys(JSON.parse(printed.stdout).schemas), ['User', 'Address']);
  // V2 keeps every position; V3 appends an enum value, a warning --strict fails on.
  const two = cli('check', fixture('v2'), '--against', v1);
  assert.strictEqual(two.status, 0, two.stderr);
  assert.strictEqual(two.stdout, '1 schema checked: no problems; compatible\n');
  const three = cli('check', fixture('v3'), '--against', v1);
  assert.strictEqual(three.status, 0, three.stderr);
  assert.strictEqual(
    three.stdout,
    'warning  User.role: Enum value "guest" appended: deploy decoders before encoders (appended)\n' +
      '1 schema checked: 1 warning; compatible\n',
  );
  const strict = cli('check', fixture('v3'), '--against', v1, '--strict');
  assert.strictEqual(strict.status, 1);
  assert.match(strict.stdout, /1 warning; incompatible\n$/);
  // V4 breaks the rules, and brings two schemas the baseline does not have.
  const four = cli('check', fixture('v4'), '--against', v1);
  assert.strictEqual(four.status, 1);
  assert.strictEqual(
    four.stdout,
    [
      'error    User.id: Type changed: integer → number (type)',
      'info     User.name: Field "fullName" is now "name" (renamed)',
      'error    User.role: Enum value "guest" inserted before "admin", which moves (inserted)',
      'error    User.role: Enum value "admin" moved from position 0 to 2 (moved)',
      'info     Address: "Address" is not in the baseline: nothing to compare (appended)',
      'info     Contact: "Contact" is not in the baseline: nothing to compare (appended)',
      '3 schemas checked: 3 errors, 3 info; incompatible',
      '',
    ].join('\n'),
  );
  const json = cli('check', fixture('v4'), '--against', v1, '--json');
  assert.strictEqual(json.status, 1);
  const result = JSON.parse(json.stdout);
  assert.strictEqual(result.ok, false);
  assert.deepStrictEqual(Object.keys(result.schemas), ['User', 'Address', 'Contact']);
  assert.strictEqual(result.schemas.User.ok, false);
  assert.strictEqual(result.schemas.User.problems.length, 4);
  assert.deepStrictEqual(result.schemas.Address, {
    ok: true,
    problems: [
      {
        path: '',
        rule: 'appended',
        severity: 'info',
        message: '"Address" is not in the baseline: nothing to compare',
      },
    ],
  });
  // --only names the pairs to check.
  const only = cli('check', fixture('v4'), '--against', v1, '--only', 'Address', '--json');
  assert.strictEqual(only.status, 0, only.stderr);
  assert.deepStrictEqual(Object.keys(JSON.parse(only.stdout).schemas), ['Address']);
  // A schema the module no longer exports is a warning, which --strict fails on.
  const v4 = path.join(dir, 'v4.json');
  assert.strictEqual(cli('snapshot', fixture('v4'), '--out', v4).status, 0);
  const gone = cli('check', fixture('v2'), '--against', v4, '--only', 'Address,Contact');
  assert.strictEqual(gone.status, 0, gone.stderr);
  assert.strictEqual(
    gone.stdout,
    'warning  Address: The module no longer exports "Address" (removed)\n' +
      'warning  Contact: The module no longer exports "Contact" (removed)\n' +
      '2 schemas checked: 2 warnings; compatible\n',
  );
  const goneStrict = cli('check', fixture('v2'), '--against', v4, '--strict', '--json');
  assert.strictEqual(goneStrict.status, 1);
  assert.strictEqual(JSON.parse(goneStrict.stdout).schemas.Address.ok, false);
  const nowhere = cli('check', fixture('v2'), '--against', v4, '--only', 'User, Nope');
  assert.strictEqual(nowhere.status, 1);
  assert.strictEqual(nowhere.stderr, 'Neither the module nor the baseline has a schema "Nope"\n');
  // A path with brackets follows the name without a dot.
  const list = path.join(dir, 'list.js');
  fs.writeFileSync(
    list,
    [
      "const ms = require('@alexify/metaschema');",
      "module.exports = ms.Schema.from({ array: { v: 'string' } });",
      '',
    ].join('\n'),
  );
  const listed = path.join(dir, 'list.json');
  assert.strictEqual(cli('snapshot', list, '--out', listed).status, 0);
  fs.writeFileSync(
    list,
    [
      "const ms = require('@alexify/metaschema');",
      "module.exports = ms.Schema.from({ array: { v: 'integer' } });",
      '',
    ].join('\n'),
  );
  const items = cli('check', list, '--against', listed);
  assert.strictEqual(items.status, 1);
  assert.match(items.stdout, /^error {4}default\[\]\.v: Type changed: string → integer \(type\)$/m);
});

test('CLI: what check refuses', () => {
  const dir = path.join(ROOT, 'tests', '.generated', 'evolution');
  fs.mkdirSync(dir, { recursive: true });
  const fixture = path.join('tests', 'fixtures', 'evolution', 'v1.js');
  const usage = /^Usage: protoarray check <module> --against <baseline\.json>/m;
  // No baseline named: the command line is wrong.
  const missing = cli('check', fixture);
  assert.strictEqual(missing.status, 2);
  assert.match(missing.stderr, /^check needs --against <baseline\.json>$/m);
  assert.match(missing.stderr, usage);
  // A baseline that cannot be read, is not JSON, or does not rebuild: exit 1.
  const absent = cli('check', fixture, '--against', path.join(dir, 'absent.json'));
  assert.strictEqual(absent.status, 1);
  assert.match(absent.stderr, /^Cannot read the baseline .*absent\.json: ENOENT/);
  const text = path.join(dir, 'text.json');
  fs.writeFileSync(text, 'not json');
  const invalid = cli('check', fixture, '--against', text);
  assert.strictEqual(invalid.status, 1);
  assert.match(invalid.stderr, /^The baseline .*text\.json is not JSON: /);
  const v1 = path.join(dir, 'forged.json');
  assert.strictEqual(cli('snapshot', fixture, '--out', v1).status, 0);
  const forged = JSON.parse(fs.readFileSync(v1, 'utf8'));
  forged.schemas.User.canonical = '{}';
  fs.writeFileSync(v1, JSON.stringify(forged));
  const stale = cli('check', fixture, '--against', v1);
  assert.strictEqual(stale.status, 1);
  assert.strictEqual(
    stale.stderr,
    'SchemaDefinitionError ERR_INVALID_SNAPSHOT: The baseline does not rebuild to its canonical ' +
      'form: write it again (schema "User")\n',
  );
  // The module is checked before the baseline is read.
  const none = cli('check', 'tests/fixtures/empty.js', '--against', v1);
  assert.strictEqual(none.status, 1);
  assert.strictEqual(none.stderr, 'The module exports no schema\n');
});

test('CLI: --binary writes the binary wire next to the text codec', () => {
  const { Address, User } = require('../fixtures/schemas.js');
  const reference = { Address: Schema.from(Address), User: Schema.from(User) };
  const user = { id: 1, name: 'A', home: { city: 'K' }, role: 'user' };
  const inline = cli('compile', 'tests/fixtures/schemas.js', '--runtime', 'inline', '--binary');
  assert.strictEqual(inline.status, 0, inline.stderr);
  const copies = runInline(inline.stdout);
  const bytes = copies.User.toBinary(user);
  assert.deepStrictEqual(Array.from(bytes), Array.from(toBinary(reference.User, user)));
  assert.deepStrictEqual(
    JSON.parse(JSON.stringify(copies.User.fromBinary(bytes))),
    JSON.parse(JSON.stringify(fromBinary(reference.User, bytes))),
  );
  assert.deepStrictEqual(
    Array.from(copies.Address.toBinary({ city: 'K' })),
    Array.from(toBinary(reference.Address, { city: 'K' })),
  );
  // The text wire is still there.
  assert.strictEqual(copies.User.stringify(user), '[1,"A",["K"],null,1]');
  // Without the flag a module carries no bytes.
  const text = cli('compile', 'tests/fixtures/schemas.js', '--runtime', 'inline');
  assert.strictEqual(text.status, 0, text.stderr);
  assert.strictEqual(runInline(text.stdout).User.toBinary, undefined);
  // An import module carries it in the compiled option, the ES format too.
  const imported = cli('compile', 'tests/fixtures/schemas.js', '--binary', '--format', 'esm');
  assert.strictEqual(imported.status, 0, imported.stderr);
  assert.strictEqual(imported.stdout.match(/binary:\(function/g).length, 2);
  assert.match(imported.stdout, /^R\.check\(2\);$/m);
  // A schema with no binary form is refused, named with its field.
  const dir = path.join(ROOT, 'tests', '.generated');
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, 'interned.js');
  fs.writeFileSync(
    file,
    [
      "const ms = require('@alexify/metaschema');",
      "const { Schema } = require('../../index.js');",
      "const Tag = new Schema('Tag', { name: 'string' }, { metaschema: ms, intern: true });",
      'module.exports = { Tag };\n',
    ].join('\n'),
  );
  const refused = cli('compile', file, '--binary');
  assert.strictEqual(refused.status, 1);
  assert.strictEqual(
    refused.stderr,
    'SchemaDefinitionError ERR_NO_BINARY_FORM: The binary wire has no form for an interned ' +
      'string at "name" (schema "Tag", field "name")\n',
  );
  assert.strictEqual(cli('compile', file).status, 0);
});
