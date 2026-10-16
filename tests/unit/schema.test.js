const { test } = require('node:test');
const assert = require('node:assert');
const { Schema, SchemaDefinitionError } = require('../../index.js');
const { BACKENDS } = require('../support/backends.js');
const { ms, define, model } = require('../support/schema.js');

const CODEC = Symbol.for('alexify.protoarray.codec');
const BRAND = Symbol.for('alexify.metaschema.brand');

// A snapshot of one struct entity `T`, written by hand: what metaschema
// itself would never write, as protoarray may be handed it.
const snapshotOf = (fields, types = {}) => ({
  format: 1,
  root: 'T',
  types,
  entities: { T: { kind: 'struct', store: 'memory', fields } },
});

// A field of a snapshot.
const field = (type, more) => ({ type, required: true, ...more });
const struct = (fields, more) => field('schema', { schema: fields, ...more });

// protoarray's own SchemaDefinitionError, not metaschema's.
const invalid = (build, expected) => {
  assert.throws(build, (error) => {
    assert.ok(error instanceof SchemaDefinitionError, error.message);
    assert.ok(error instanceof TypeError);
    assert.strictEqual(error.name, 'SchemaDefinitionError');
    assert.strictEqual(error.code, expected.code);
    for (const key of ['field', 'message', 'schema']) {
      if (expected[key] !== undefined) assert.strictEqual(error[key], expected[key], key);
    }
    return true;
  });
};

// A snapshot of `T` with these fields, refused.
const refused = (fields, expected, options, types) =>
  invalid(() => new Schema(snapshotOf(fields, types), options), { schema: 'T', ...expected });

test('Schema: every spelling of a field resolves to a position', () => {
  const schema = define({
    a: 'string',
    'b?': 'number',
    c: '?boolean',
    d: { type: 'string', required: false },
    e: { array: 'string', required: false },
    f: { enum: ['x'] },
    g: ['number', { named: 'string' }],
    h: { i: 'string' },
    j: 'json',
    k: { type: 'enum', enum: ['y'], default: 'y' },
    l: { flags: ['z'] },
  });
  assert.deepStrictEqual(
    schema.keys,
    ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i', 'j', 'k', 'l'].filter((key) => key !== 'i'),
  );
  assert.strictEqual(
    schema.toString(),
    '{a:string,b:?number,c:?boolean,d:?string,e:?[string],f:enum(x),g:(number,string),h:{i:string},j:?json,k:?enum(y)="y",l:flags(z)}',
  );
});

test("Schema: metaschema's spellings of collections and tuple elements", () => {
  const schema = define({
    a: { type: 'schema', schema: { x: 'string' } },
    b: { set: 'number', required: false },
    c: { type: 'object', key: 'string', value: '?number' },
    d: { map: { number: 'string' } },
    // An element spelled like a collection is that collection.
    e: [{ array: 'number' }, { 'set?': 'string' }, { 'n?': 'integer' }],
  });
  assert.strictEqual(
    schema.toString(),
    '{a:{x:string},b:?set[number],c:object<?number>,d:map<number,string>,' +
      'e:([number],?set[string],?integer)}',
  );
  // A field that holds null as a value is never required; nullable is optional.
  assert.strictEqual(
    define({ n: 'null', j: 'json', s: { type: 'string', nullable: true } }).toString(),
    '{n:?null,j:?json,s:?string}',
  );
});

test('Schema: a snapshot is read from a metaschema Schema, a Model, a schema or as it is', () => {
  const source = ms.Schema.from({ a: 'number' });
  const fromSource = Schema.from(source);
  assert.strictEqual(fromSource.source, source);
  assert.strictEqual(fromSource.name, '');
  assert.strictEqual(new Schema('X', source).name, 'X');
  assert.strictEqual(fromSource.toString(), '{a:number}');
  // A Model has no root: the entity is named.
  const entities = new Map([
    ['A', { Struct: {}, m: 'string', b: 'B' }],
    ['B', { Struct: {}, n: 'number' }],
  ]);
  const Model = new ms.Model({}, entities);
  const A = Schema.from(Model, { entity: 'A' });
  assert.strictEqual(A.name, 'A');
  assert.strictEqual(A.source, null);
  assert.strictEqual(A.toString(), '{m:string,b:@B}');
  invalid(() => Schema.from(Model), {
    code: 'ERR_INVALID_OPTIONS',
    message: 'Name the entity to build: { entity }',
  });
  invalid(() => Schema.from(Model.toJSON()), { code: 'ERR_INVALID_OPTIONS' });
  // A schema built again: its own entity, or another one of its snapshot.
  assert.strictEqual(Schema.from(A).toString(), '{m:string,b:@B}');
  assert.strictEqual(Schema.from(A, { entity: 'B' }).toString(), '{n:number}');
  assert.strictEqual(Schema.from(A, { entity: 'B' }).name, 'B');
  // A snapshot, from its JSON text too.
  const text = JSON.stringify(Model.toJSON());
  assert.strictEqual(new Schema(JSON.parse(text), { entity: 'B' }).toString(), '{n:number}');
  // A metaschema-like function with a Schema is metaschema too.
  const injected = (definition) => definition;
  injected.Schema = ms.Schema;
  assert.strictEqual(
    Schema.from({ a: 'string' }, { metaschema: injected }).toString(),
    '{a:string}',
  );
});

test('Schema: what is not a schema to read', () => {
  const expected = {
    code: 'ERR_SCHEMA_EXPECTED',
    message:
      'A metaschema Schema or Model, a snapshot, or a definition with { metaschema } expected',
  };
  for (const source of [
    { a: 'number' },
    null,
    undefined,
    1,
    'string',
    { format: 2, entities: {} },
  ]) {
    invalid(() => Schema.from(source), expected);
  }
  invalid(() => new Schema('T', { a: 'number' }), { ...expected, schema: 'T' });
  // The list of a schema has no snapshot: it is built at runtime.
  invalid(() => Schema.from(define({ a: 'number' }).list), expected);
  for (const source of [{ a: 'number' }, null, { format: 2, entities: {} }]) {
    invalid(() => Schema.fromModel(source), {
      code: 'ERR_SCHEMA_EXPECTED',
      message: 'A metaschema Model or a snapshot expected',
    });
  }
});

test('Schema: a snapshot of another format or without the entity', () => {
  const format = 'A snapshot of format 1 with entities is expected';
  // A metaschema that writes another format.
  const newer = { [BRAND]: 'Schema', toSnapshot: () => ({ format: 2, root: 'T' }) };
  invalid(() => Schema.from(newer), {
    code: 'ERR_INVALID_SNAPSHOT',
    message: format,
    schema: 'T',
    field: '',
  });
  const model2 = { [BRAND]: 'Model', toJSON: () => ({ format: 2, entities: { A: {} } }) };
  invalid(() => Schema.from(model2, { entity: 'A' }), { code: 'ERR_INVALID_SNAPSHOT' });
  invalid(() => Schema.fromModel(model2), { code: 'ERR_INVALID_SNAPSHOT', message: format });
  invalid(() => new Schema(snapshotOf({ a: field('string') }), { entity: 'Missing' }), {
    code: 'ERR_INVALID_SNAPSHOT',
    message: 'The snapshot has no entity "Missing"',
    schema: 'Missing',
  });
  invalid(() => new Schema({ format: 1, root: 'T', entities: { T: 5 } }), {
    code: 'ERR_INVALID_SNAPSHOT',
    message: 'The snapshot has no entity "T"',
  });
  // An inherited member is not an entity.
  invalid(() => new Schema({ format: 1, root: 'toString', entities: {} }), {
    code: 'ERR_INVALID_SNAPSHOT',
    message: 'The snapshot has no entity "toString"',
  });
});

test('Schema: a broken snapshot names the field', () => {
  const code = 'ERR_INVALID_SNAPSHOT';
  refused({ a: { required: true } }, { code, field: 'a', message: 'A field needs a type at "a"' });
  refused({ a: 'string' }, { code, field: 'a' });
  refused({ a: struct({ b: field(1) }) }, { code, field: 'a.b' });
  refused({ a: field('array') }, { code, field: 'a[]', message: 'A field needs a type at "a[]"' });
  refused({ s: struct(null) }, { code, field: 's', message: 'A struct needs its fields at "s"' });
  invalid(
    () => new Schema({ format: 1, root: 'T', entities: { T: { kind: 'struct', fields: 5 } } }),
    { code, field: '', message: 'A struct needs its fields' },
  );
  for (const reference of [{ one: '' }, { one: 5 }, { many: null }]) {
    refused(
      { r: field('X', reference) },
      { code, field: 'r', message: 'A reference needs a name at "r"' },
    );
  }
  // The keys a field had in older versions are read, and never reach the wire.
  const renamed = define({ n: { type: 'string', aliases: ['old', 'older'] } });
  assert.strictEqual(renamed.toString(), define({ n: 'string' }).toString());
  for (const aliases of ['old', [1], [''], ['a', 'a'], ['__proto__']]) {
    refused(
      { n: field('string', { aliases }) },
      { code, field: 'n', message: 'aliases is a list of unique keys at "n"' },
    );
  }
  const decimals = 'decimals is an integer from 0 to 15 on a number at "n"';
  for (const n of [-1, 16, 1.5, '2', null]) {
    refused({ n: field('number', { decimals: n }) }, { code, field: 'n', message: decimals });
  }
  refused({ n: field('string', { decimals: 2 }) }, { code, message: decimals });
  refused({ n: field('bigint', { decimals: 2 }) }, { code, message: decimals });
  refused(
    { m: field('map', { key: 'boolean', value: field('number') }) },
    { code, field: 'm', message: 'A map needs a key type at "m"' },
  );
  refused({ m: field('map', { value: field('number') }) }, { code, field: 'm' });
  refused(
    { o: field('object', { key: 'number', value: field('number') }) },
    { code, field: 'o', message: 'An object needs a key type at "o"' },
  );
  refused({ m: field('map', { key: 'string' }) }, { code, field: 'm{}' });
  refused({ t: field('tuple', { value: 'number' }) }, { code, field: 't' });
  refused(
    { t: field('tuple', { value: [field('number'), { type: 1 }] }) },
    { code, field: 't[1]' },
  );
  // metaschema writes an empty tuple; protoarray has no wire for it.
  invalid(() => define({ pair: [] }), {
    code,
    field: 'pair',
    message: 'A tuple needs a list of elements at "pair"',
  });
});

test('Schema: a snapshot nested too deeply', () => {
  const message = (path) => `The schema is nested too deeply at "${path}"`;
  // Records in records.
  let fields = { a: field('string') };
  for (let i = 0; i < 70; i++) fields = { a: struct(fields) };
  const deep = Array.from({ length: 66 }, () => 'a').join('.');
  refused(fields, { code: 'ERR_INVALID_SNAPSHOT', field: deep, message: message(deep) });
  // Lists of lists.
  let list = field('string');
  for (let i = 0; i < 70; i++) list = field('array', { value: list });
  const items = `l${'[]'.repeat(65)}`;
  refused({ l: list }, { code: 'ERR_INVALID_SNAPSHOT', field: items, message: message(items) });
  // Schemas of one type, held as a field.
  let one = field('string');
  for (let i = 0; i < 70; i++) one = struct(one);
  refused({ s: one }, { code: 'ERR_INVALID_SNAPSHOT', field: 's', message: message('s') });
  // 64 levels are deep enough.
  let fine = { a: field('string') };
  for (let i = 0; i < 63; i++) fine = { a: struct(fine) };
  assert.ok(new Schema(snapshotOf(fine)));
});

test('Schema: a schema of one type held as a field keeps its own optionality', () => {
  const s = (inner) => new Schema(snapshotOf({ s: struct(inner) })).toString();
  assert.strictEqual(s(field('string')), '{s:string}');
  assert.strictEqual(s(field('string', { required: false })), '{s:?string}');
  assert.strictEqual(s(field('string', { nullable: true })), '{s:?string}');
  assert.strictEqual(s(field('array', { value: field('number') })), '{s:[number]}');
  assert.strictEqual(define({ s: define('?string').source }).toString(), '{s:?string}');
  // A root of one type: a scalar keeps its optionality, anything else is required.
  assert.strictEqual(define('?string').toString(), '?string');
  assert.strictEqual(define({ array: 'number' }).toString(), '[number]');
});

test('Schema: unknown and custom types', () => {
  const code = 'ERR_UNKNOWN_TYPE';
  refused(
    { price: field('float') },
    { code, field: 'price', message: 'Unknown type "float" at "price"' },
  );
  refused({ list: field('array', { value: field('float') }) }, { code, field: 'list[]' });
  refused({ m: field('object', { key: 'string', value: field('float') }) }, { code, field: 'm{}' });
  refused(
    { t: field('tuple', { value: [field('number'), field('float')] }) },
    { field: 't[1]', code },
  );
  refused({ toString: field('toString') }, { code, field: 'toString' });
  // An alias of a built-in type, down its chain, is that type.
  const types = { money: { js: 'cents' }, cents: { js: 'integer' }, bad: { js: 'float' } };
  assert.strictEqual(
    new Schema(snapshotOf({ m: field('money') }, types)).toString(),
    '{m:integer}',
  );
  const { A } = model(
    { A: { Struct: {}, m: 'protoarrayMoney' } },
    {},
    { protoarrayMoney: { js: 'number' } },
  );
  assert.strictEqual(A.toString(), '{m:number}');
  refused({ m: field('bad') }, { code, message: 'Unknown type "bad" at "m"' }, {}, types);
  refused(
    { m: field('a') },
    { code, message: 'Unknown type "a" at "m"' },
    {},
    {
      a: { js: 'b' },
      b: { js: 'a' },
    },
  );
  refused({ m: field('a') }, { code }, {}, { a: 'string' });
  const chain = {};
  for (let i = 0; i < 70; i++) chain[`t${i}`] = { js: `t${i + 1}` };
  chain.t70 = { js: 'number' };
  refused({ m: field('t0') }, { code, message: 'Unknown type "t0" at "m"' }, {}, chain);
  // Types that are not a record are no types.
  for (const table of [null, [], 'x']) {
    assert.strictEqual(
      new Schema(snapshotOf({ n: field('number') }, table)).toString(),
      '{n:number}',
    );
    refused({ m: field('money') }, { code }, {}, table);
  }
  // A type with a check of its own has the wire the `types` option gives it.
  const checked = { email: { kind: 'scalar', check: true, metadata: {} }, alias: { js: 'email' } };
  refused(
    { e: field('email') },
    {
      code,
      field: 'e',
      message: 'Type "email" checks values of its own: give it a wire type in "types" at "e"',
    },
    {},
    checked,
  );
  const typed = new Schema(snapshotOf({ e: field('email'), a: field('alias') }, checked), {
    types: { email: 'string' },
  });
  assert.strictEqual(typed.toString(), '{e:string,a:string}');
  assert.deepStrictEqual(typed.decode(['x', 'y']), { e: 'x', a: 'y' });
  assert.throws(() => typed.decode([1, 'y']), { code: 'type', path: 'e' });
});

test('Schema: enum, flags and default errors', () => {
  const ENUM = { code: 'ERR_INVALID_ENUM', field: 'role' };
  // metaschema writes these; an enum travels as an index, so its values are unique.
  for (const values of [['a', 'a'], [1, '1'], ['a', true], ['__proto__']]) {
    invalid(() => define({ role: { enum: values } }), {
      ...ENUM,
      message: 'Expected unique strings or numbers at "role"',
    });
  }
  for (const values of [[], 'admin', [NaN], [Infinity], [null]]) {
    refused({ role: field('enum', { enum: values }) }, ENUM);
  }
  refused({ role: field('enum') }, ENUM);
  // An enum travels as an index, so its size is not limited the way flags are.
  const wide = define({ role: { enum: Array.from({ length: 40 }, (_, i) => i) } });
  assert.deepStrictEqual(wide.encode({ role: 39 }), [39]);
  assert.deepStrictEqual(wide.decode([39]), { role: 39 });
  const FLAGS = {
    code: 'ERR_INVALID_FLAGS',
    field: 'perms',
    message: 'Expected unique names at "perms"',
  };
  for (const names of [[], [1], ['a', '__proto__'], ['a', 'a'], 'a']) {
    refused({ perms: field('flags', { flags: names }) }, FLAGS);
  }
  assert.ok(define({ perms: { flags: Array.from({ length: 70 }, (_, i) => `f${i}`) } }));
  // The scale is part of the wire, so of the id; a default is a decoded value.
  const money = define({ n: { type: 'number', decimals: 2, default: 0.5 } });
  assert.strictEqual(money.toString(), '{n:?number(2)=0.5}');
  assert.notStrictEqual(money.id, define({ n: { type: 'number', default: 0.5 } }).id);
  assert.deepStrictEqual(money.decode([]), { n: 0.5 });
  assert.strictEqual(define({ n: { type: 'number', decimals: 0 } }).toString(), '{n:number(0)}');
  // An enum is its index, whatever else the snapshot says.
  const scaled = snapshotOf({ n: field('enum', { enum: [1, 2], decimals: 2 }) });
  assert.strictEqual(new Schema(scaled).toString(), '{n:enum(1|2)}');
});

// A default the wire has no use for (a factory, a value of no primitive
// type, a Date) stays metaschema's to apply: the field keeps its optionality.
test('Schema: defaults the wire carries', () => {
  const cases = [
    [{ type: 'number', default: 0 }, '?number=0'],
    [{ type: 'number', default: -0 }, '?number=0'],
    [{ type: 'string', default: 'x' }, '?string="x"'],
    [{ type: 'boolean', default: false }, '?boolean=false'],
    [{ type: 'json', default: 'x' }, '?json="x"'],
    [{ type: 'integer', default: 2 }, '?integer=2'],
    [{ type: 'integer', default: 1.5 }, 'integer'],
    [{ type: 'number', default: {} }, 'number'],
    [{ type: 'number', default: () => 1 }, 'number'],
    [{ type: 'number', default: Infinity }, 'number'],
    [{ type: 'number', default: NaN }, 'number'],
    [{ type: 'date', default: 5 }, 'date'],
    [{ type: 'bigint', default: 5n }, 'bigint'],
    [{ type: 'string', default: null }, 'string'],
    [{ array: 'string', required: false, default: 'x' }, '?[string]'],
  ];
  for (const [definition, text] of cases) {
    assert.strictEqual(define({ n: definition }).toString(), `{n:${text}}`, text);
  }
  assert.ok(Object.is(define({ n: { type: 'number', default: -0 } }).decode([]).n, 0));
  assert.deepStrictEqual(define({ n: { type: 'string', default: 'x' } }).decode([]), { n: 'x' });
  assert.throws(() => define({ n: { type: 'string', default: null } }).decode([]), {
    code: 'required',
  });
  assert.strictEqual(
    new Schema(snapshotOf({ n: field('number', { default: 'x' }) })).toString(),
    '{n:?number="x"}',
  );
});

test('Schema: union errors', () => {
  const u = (union, more) => field('union', { discriminator: 'k', union, ...more });
  const branch = (k, more) => struct({ k: field('enum', { enum: [k], ...more }) });
  invalid(() => define({ u: { union: [{ k: { enum: ['a'] } }] } }), {
    code: 'ERR_UNKNOWN_TYPE',
    field: 'u',
    message: 'A union needs a discriminator at "u"',
  });
  refused({ u: u([branch('a')], { discriminator: '' }) }, { code: 'ERR_UNKNOWN_TYPE' });
  refused({ u: u([branch('a')], { discriminator: 1 }) }, { code: 'ERR_UNKNOWN_TYPE' });
  const code = 'ERR_INVALID_UNION';
  for (const union of [[], 'x', undefined]) {
    refused(
      { u: u(union) },
      { code, field: 'u', message: 'A union needs at least one branch at "u"' },
    );
  }
  const message =
    'A branch must be a struct with the required enum "k" without a default at "u[1]"';
  const wrong = [
    field('string'),
    struct({ x: field('string') }),
    struct({ k: field('string') }),
    branch('b', { required: false }),
    branch('b', { default: 'b' }),
  ];
  for (const second of wrong) {
    refused({ u: u([branch('a'), second]) }, { code, field: 'u[1]', message });
  }
  refused(
    { u: u([branch('a'), branch('a')]) },
    { code, field: 'u', message: 'The values of the discriminator must be unique at "u"' },
  );
  // A sparse branch has no position for its tag.
  const definition = { u: { union: [{ k: { enum: ['a'] }, v: '?number' }], discriminator: 'k' } };
  invalid(() => define(definition, { sparse: ['u[0]'] }), { code, field: 'u[0]' });
  refused(
    { u: u([branch('a', {}), struct({ k: field('enum', { enum: [] }) })]) },
    {
      code: 'ERR_INVALID_ENUM',
      field: 'u[1].k',
    },
  );
});

test('Schema: keys a struct cannot have', () => {
  invalid(() => define(JSON.parse('{"__proto__":"string"}')), {
    code: 'ERR_RESERVED_KEY',
    field: '__proto__',
    message: 'Reserved key "__proto__" at "__proto__"',
  });
  invalid(() => define({ a: JSON.parse('{"__proto__":"string"}') }), {
    code: 'ERR_RESERVED_KEY',
    field: 'a.__proto__',
  });
  invalid(() => define({ 1: 'string' }), {
    code: 'ERR_INTEGER_KEY',
    field: '1',
    message: 'Integer-like key "1": JavaScript orders it first at "1"',
  });
  invalid(() => define({ a: 'string', '007': 'string' }), {
    code: 'ERR_INTEGER_KEY',
    field: '007',
  });
  invalid(() => define({ '': 'string' }), {
    code: 'ERR_INVALID_DEFINITION',
    field: '',
    message: 'Invalid key ""',
  });
  invalid(() => define({ a: { '': 'string' } }), {
    code: 'ERR_INVALID_DEFINITION',
    field: 'a.',
    message: 'Invalid key "" at "a."',
  });
  // A struct needs a position: calculated fields have none.
  invalid(() => define({ Struct: {} }), {
    code: 'ERR_INVALID_DEFINITION',
    field: '',
    message: 'A struct needs fields',
  });
  invalid(() => define({ a: () => 1 }), { code: 'ERR_INVALID_DEFINITION' });
  invalid(() => define({ a: { b: () => 1 } }), {
    code: 'ERR_INVALID_DEFINITION',
    message: 'A struct needs fields at "a"',
  });
  // A calculated field is skipped; a stored kind adds its id.
  assert.strictEqual(define({ a: 'number', b: () => 1 }).toString(), '{a:number}');
  assert.strictEqual(define({ Entity: {}, a: 'number' }).toString(), '{a:number,id:?string}');
});

test('Schema: references by name', () => {
  const code = 'ERR_UNKNOWN_REFERENCE';
  invalid(() => define({ ref: 'Missing' }), {
    code,
    field: 'ref',
    message: 'Unknown reference "Missing" at "ref"',
  });
  invalid(() => define({ ref: 'Missing' }, { references: 'embed' }), { code, field: 'ref' });
  invalid(() => define({ ref: { many: 'Missing' } }), { code, field: 'ref' });
  assert.strictEqual(define({ ref: 'Missing' }, { references: 'id' }).toString(), '{ref:string}');
  // A stored kind travels as its id; any other as the record, unless told otherwise.
  const entities = {
    Stored: { Entity: {}, x: 'string' },
    Plain: { Struct: {}, n: 'number' },
    A: {
      Struct: {},
      s: { one: 'Stored' },
      ss: { many: 'Stored' },
      se: { one: 'Stored', embed: true },
      p: { one: 'Plain' },
      pp: { many: 'Plain' },
      pi: { one: 'Plain', embed: false },
    },
  };
  assert.strictEqual(
    model(entities).A.toString(),
    '{s:string,ss:[string],se:@Stored,p:@Plain,pp:[@Plain],pi:string}',
  );
  assert.strictEqual(
    model(entities, { references: 'embed' }).A.toString(),
    '{s:@Stored,ss:[@Stored],se:@Stored,p:@Plain,pp:[@Plain],pi:@Plain}',
  );
  assert.strictEqual(
    model(entities, { references: 'id' }).A.toString(),
    '{s:string,ss:[string],se:string,p:string,pp:[string],pi:string}',
  );
  // Entities that reach each other are built once each, through their slots.
  const { Left, Right } = model({
    Left: { Struct: {}, n: 'number', right: '?Right' },
    Right: { Struct: {}, left: '?Left' },
  });
  assert.strictEqual(Left.toString(), '{n:number,right:?@Right}');
  assert.strictEqual(Right.toString(), '{left:?@Left}');
  assert.deepStrictEqual(Left.encode({ n: 1, right: { left: { n: 2 } } }), [1, [[2]]]);
  assert.deepStrictEqual(Right.decode([[1, [[2]]]]), {
    left: { n: 1, right: { left: { n: 2, right: null } } },
  });
  // The id of a reference is a string slot of its own, by path.
  const interned = model(entities, { entities: { A: { intern: ['s', 'ss[]'] } } }).A;
  assert.strictEqual(
    interned.toString(),
    '{s:string*,ss:[string*],se:@Stored,p:@Plain,pp:[@Plain],pi:string}',
  );
});

test('Schema: options by path', () => {
  const options = (definition, value, expected) =>
    invalid(() => define(definition, value), { code: 'ERR_INVALID_OPTIONS', ...expected });
  options(
    { n: 'number' },
    { intern: ['n'] },
    { field: 'n', message: 'Option "intern" takes a string at "n"' },
  );
  options(
    { s: 'string' },
    { delta: ['s'] },
    {
      field: 's',
      message:
        'Option "delta" takes an integer, a number, a date or decimals, or a list of them at "s"',
    },
  );
  options({ s: { set: 'integer' } }, { delta: ['s'] }, { field: 's' });
  options({ s: { array: 'string' } }, { delta: ['s'] }, { field: 's' });
  options(
    { a: { array: 'number' } },
    { sparse: ['a'] },
    {
      field: 'a',
      message: 'Option "sparse" takes a struct at "a"',
    },
  );
  options(
    { array: 'number' },
    { sparse: true },
    {
      field: '',
      message: 'Option "sparse" takes a struct',
    },
  );
  options(['number'], { sparse: true }, { field: '' });
  options(
    { a: 'number' },
    { layout: { a: 'flat' } },
    {
      field: 'a',
      message: 'Option "layout" "flat" takes an array of records at "a"',
    },
  );
  options(
    { a: 'string' },
    { layout: 'flat' },
    {
      field: '',
      message: 'Option "layout" "flat" takes an array of records',
    },
  );
  options({ array: 'string' }, { layout: 'columns' }, { field: '' });
  options({ array: { a: '?number' } }, { sparse: ['[]'], layout: 'flat' }, { field: '' });
  for (const option of ['intern', 'delta', 'sparse']) {
    options(
      { a: 'integer' },
      { [option]: ['b'] },
      {
        field: 'b',
        message: `Option "${option}" names no place of the schema at "b"`,
      },
    );
  }
  options(
    { a: 'number' },
    { layout: { b: 'flat' } },
    {
      field: 'b',
      message: 'Option "layout" names no place of the schema at "b"',
    },
  );
  options({ a: { b: 'string' } }, { intern: ['b'] }, { field: 'b' });
  options({ a: { b: 'string' } }, { intern: ['a.b', 'a.b.c'] }, { field: 'a.b.c' });
  // Every path syntax of the errors names a place.
  const definition = {
    a: { b: 'string' },
    list: { array: 'integer' },
    m: { map: { string: 'string' } },
    t: ['string', 'date'],
    u: { union: [{ k: { enum: ['x'] }, f: 'string' }], discriminator: 'k' },
    rows: { array: { at: 'date', tag: 'string' } },
  };
  const placed = define(definition, {
    intern: ['a.b', 'm{}', 't[0]', 'u[0].f', 'rows[].tag'],
    delta: ['list', 't[1]', 'rows[].at'],
    sparse: ['a'],
    layout: { rows: 'columns', list: 'rows' },
  });
  assert.strictEqual(
    placed.toString(),
    '{a:sparse{b:string*},list:~[integer],m:map<string,string*>,t:(string*,date~),' +
      'u:union(k)[{k:enum(x),f:string*}],rows:columns[{at:date~,tag:string*}]}',
  );
  // intern: true interns every string, a reference's id included.
  assert.strictEqual(
    define({ a: 'string', b: { array: '?string' }, n: 'number' }, { intern: true }).toString(),
    '{a:string*,b:[?string*],n:number}',
  );
  assert.strictEqual(define('integer', { delta: [''] }).toString(), 'integer~');
  assert.strictEqual(define({ a: '?number' }, { sparse: [''] }).layout, 'sparse');
  assert.strictEqual(define({ array: { a: 'number' } }, { layout: 'rows' }).layout, 'rows');
  assert.strictEqual(define({ array: { a: 'number' } }, { layout: { '': 'flat' } }).layout, 'flat');
});

test('Schema: option errors', () => {
  const values = [
    1,
    'x',
    true,
    { codegen: 'yes' },
    { codegen: null },
    { validate: 1 },
    { validate: 'both' },
    { validate: 'decode' },
    { validate: null },
    { sparse: 'x' },
    { sparse: [1] },
    { intern: 'x' },
    { intern: ['a', 2] },
    { delta: true },
    { delta: 'a' },
    { stringify: 'fast' },
    { compiled: {} },
    { layout: 'rowz' },
    { layout: { a: 'nope' } },
    { layout: { a: 1 } },
    { layout: null },
    { fingerprint: 'sha256' },
    { references: 'link' },
    { types: { email: 'float' } },
    { types: { email: 1 } },
    { types: [] },
    { types: null },
    { entity: 1 },
    { entities: null },
    { entities: { A: 1 } },
    { entities: [] },
    { metaschema: {} },
    { metaschema: null },
    { metaschema: { Schema: 1 } },
    { schemas: {} },
    { unknown: true },
    // Only own keys are options: a prototype member is not one.
    { constructor: true },
    { hasOwnProperty: true },
  ];
  const source = define({ a: 'string' }).source;
  for (const value of values) {
    invalid(() => new Schema('T', source, value), { code: 'ERR_INVALID_OPTIONS', schema: 'T' });
  }
  invalid(() => new Schema('T', source, 1), {
    code: 'ERR_INVALID_OPTIONS',
    message: 'Invalid options: expected an object',
  });
  invalid(() => new Schema('T', source, { validate: 'both' }), {
    code: 'ERR_INVALID_OPTIONS',
    message: 'Invalid option "validate"',
  });
  // An option given as undefined is not given.
  assert.strictEqual(
    define({ a: 'string' }, { codegen: undefined, layout: undefined }).backend,
    'codegen',
  );
  assert.strictEqual(Schema.from(source, null).backend, 'codegen');
  const wide = {};
  for (let i = 0; i < 70; i++) wide[`f${i}`] = 'number';
  assert.strictEqual(define(wide, { sparse: true }).layout, 'sparse');
});

test('Schema: options of a model', () => {
  const entities = { A: { Struct: {}, b: 'B' }, B: { Struct: {}, n: 'number', s: 'string' } };
  const Model = new ms.Model({}, new Map(Object.entries(entities)));
  const settings = {
    sparse: true,
    layout: 'flat',
    intern: true,
    delta: ['n'],
    entity: 'A',
    compiled: { canonical: 'x', codec: { encode() {}, decode() {} } },
    metaschema: ms,
  };
  for (const key of Object.keys(settings)) {
    invalid(() => Schema.fromModel(Model, { [key]: settings[key] }), {
      code: 'ERR_INVALID_OPTIONS',
      message: `Option "${key}" names one schema: give it in "entities"`,
      schema: '',
    });
  }
  invalid(() => Schema.fromModel(Model, { validate: 'both' }), { code: 'ERR_INVALID_OPTIONS' });
  // Each entity in its order, with the shared options and its own.
  const built = Schema.fromModel(Model, {
    codegen: false,
    entities: { B: { sparse: true, intern: ['s'] } },
  });
  assert.strictEqual(Object.getPrototypeOf(built), null);
  assert.deepStrictEqual(Object.keys(built), ['B', 'A']);
  assert.strictEqual(built.A.backend, 'closures');
  assert.strictEqual(built.B.toString(), 'sparse{n:number,s:string*}');
  assert.deepStrictEqual(built.A.encode({ b: { n: 1, s: 'x' } }), [['x'], [[3, 1, 0]]]);
  assert.deepStrictEqual(built.A.decode([['x'], [[3, 1, 0]]]), { b: { n: 1, s: 'x' } });
  // The snapshot itself, or a Model, the same.
  const again = Schema.fromModel(Model.toJSON(), { entities: { B: { sparse: true } } });
  assert.strictEqual(again.B.toString(), 'sparse{n:number,s:string}');
  assert.strictEqual(Schema.fromModel(Model).A.toString(), '{b:@B}');
});

// `validate` is about the wire only: decode checks it unless told to trust
// it, and encode always trusts the values (checking them is metaschema's).
for (const [backend, options] of BACKENDS) {
  test(`Schema (${backend}): validate checks the wire on decode`, () => {
    const definition = { id: 'number', tags: { array: 'string', required: false } };
    for (const validate of [true, false]) {
      const label = String(validate);
      const schema = define(definition, { ...options, validate });
      const bad = { id: 'x' };
      assert.deepStrictEqual(schema.encode(bad), ['x'], label);
      if (validate) assert.throws(() => schema.decode(['x']), { code: 'type', path: 'id' }, label);
      else assert.deepStrictEqual(schema.decode(['x']), { id: 'x', tags: null }, label);
      // The shape is checked either way.
      assert.throws(() => schema.encode(5), { code: 'object' }, label);
      assert.throws(() => schema.decode('x'), { code: 'structure' }, label);
      // The list inherits the mode.
      const rows = schema.list;
      assert.deepStrictEqual(rows.encode([bad]), [['x']], label);
      if (validate) assert.throws(() => rows.decode([['x']]), { path: '[0].id' }, label);
      else assert.deepStrictEqual(rows.decode([['x']]), [{ id: 'x', tags: null }], label);
    }
    // An entity reached by name keeps its own mode inside another.
    const { Outer } = model(
      { Inner: { Struct: {}, n: 'number' }, Outer: { Struct: {}, a: 'Inner', b: { n: 'number' } } },
      { ...options, validate: false, entities: { Inner: { validate: true } } },
    );
    assert.throws(() => Outer.decode([['x'], [1]]), { code: 'type', path: 'a.n' });
    assert.deepStrictEqual(Outer.decode([[1], ['y']]), { a: { n: 1 }, b: { n: 'y' } });
  });
}

// The list of a root scalar holds that scalar, with its optionality, item by
// item.
for (const [backend, options] of BACKENDS) {
  test(`Schema (${backend}): the list of a root scalar`, () => {
    const Optional = define('?string', options).list;
    assert.strictEqual(Optional.toString(), '[?string]');
    assert.strictEqual(Optional.backend, backend);
    assert.deepStrictEqual(Optional.encode(['a', null]), ['a', null]);
    assert.deepStrictEqual(Optional.decode(['a', null]), ['a', null]);
    const Required = define('string', options).list;
    assert.strictEqual(Required.toString(), '[string]');
    assert.throws(() => Required.decode(['a', null]), { code: 'type', path: '[1]' });
    const Dates = define('date', options).list;
    assert.deepStrictEqual(Dates.encode([new Date(5)]), [5]);
    assert.deepStrictEqual(Dates.decode([5]), [new Date(5)]);
  });
}

// Definition content reaches generated source only through JSON.stringify:
// keys, enum values and defaults that would break a string literal or name a
// prototype member must compile and round-trip, in both backends.
for (const [backend, options] of BACKENDS) {
  test(`Schema (${backend}): hostile keys, enum values and defaults`, () => {
    // Line and paragraph separators are built at runtime: the formatter would
    // unescape them in a literal, and the linter rightly rejects the result.
    const LS = String.fromCharCode(0x2028);
    const PS = String.fromCharCode(0x2029);
    const keys = [
      'a"b',
      'c\\d',
      `e${LS}f`,
      // oxlint-disable-next-line no-template-curly-in-string
      '${x}',
      'g*/h',
      'i\nj',
      'k\ud800',
      'constructor',
      'hasOwnProperty',
      'toString',
    ];
    const definition = {};
    for (const key of keys) definition[key] = 'string';
    definition.role = { enum: ['x"y', 'z\\w', PS] };
    definition.note = { type: 'string', default: `q"\\${LS}` };
    const schema = define(definition, options);
    const value = { role: PS };
    for (const key of keys) value[key] = key;
    const wire = schema.encode(value);
    assert.deepStrictEqual(wire, [...keys, 2]);
    const decoded = schema.decode(wire);
    assert.deepStrictEqual(Object.keys(decoded), [...keys, 'role', 'note']);
    for (const key of keys) assert.strictEqual(decoded[key], key);
    assert.strictEqual(decoded.role, PS);
    assert.strictEqual(decoded.note, `q"\\${LS}`);
    assert.strictEqual(Object.getPrototypeOf(decoded), Object.prototype);
    assert.ok(Object.hasOwn(decoded, 'toString'));
    assert.strictEqual({}.polluted, undefined);
    assert.throws(() => schema.decode(keys.map(() => 1)), { code: 'type', path: keys[0] });
    assert.throws(() => schema.decode([...keys, 9]), {
      code: 'enum',
      message: `Field "role" is not of enum: x"y, z\\w, ${PS}`,
    });
  });
}

test('Schema: the generated source is reachable through the codec symbol', () => {
  const generated = define({ id: 'number' }, { codegen: true })[CODEC];
  assert.match(generated.source, /function encode\(v\)/);
  assert.match(generated.source, /"id"/);
  assert.strictEqual(define({ id: 'number' }, { codegen: false })[CODEC].source, undefined);
});

// The probe proves that source text compiles; if one schema's function is
// still rejected, the automatic choice falls back to closures.
test('Schema: a failing code generation falls back to closures unless the backend is forced', () => {
  const codegen = require('../../src/codegen.js');
  const { build } = codegen;
  codegen.build = () => {
    throw new EvalError('refused');
  };
  const FALLBACK = Symbol.for('alexify.protoarray.fallback');
  try {
    const schema = define({ id: 'number' });
    assert.strictEqual(schema.backend, 'closures');
    assert.deepStrictEqual(schema.decode([1]), { id: 1 });
    assert.strictEqual(schema.list.backend, 'closures');
    assert.throws(() => define({ id: 'number' }, { codegen: true }), EvalError);
    // The cause is kept, off the public surface, so a fallback can be told from a choice.
    assert.ok(schema[FALLBACK] instanceof EvalError);
    assert.strictEqual(schema[FALLBACK].message, 'refused');
    assert.strictEqual(schema.list[FALLBACK].message, 'refused');
    assert.ok(!Object.keys(schema).includes(FALLBACK));
  } finally {
    codegen.build = build;
  }
  assert.strictEqual(define({ id: 'number' })[FALLBACK], undefined);
  assert.strictEqual(define({ id: 'number' }, { codegen: false })[FALLBACK], undefined);
});

test('Schema: fromModel reads what a Model writes as a snapshot', () => {
  const brand = Symbol.for('alexify.metaschema.brand');
  const broken = { [brand]: 'Model', toJSON: () => ({ format: 2 }) };
  assert.throws(() => Schema.fromModel(broken), {
    code: 'ERR_INVALID_SNAPSHOT',
    message: 'A snapshot of format 1 with entities is expected',
  });
  assert.throws(() => Schema.fromModel({ format: 2 }), { code: 'ERR_SCHEMA_EXPECTED' });
});

// A snapshot may come from a peer: whatever it holds, reading it throws
// nothing but SchemaDefinitionError. Seeded mutations of real snapshots, at
// every depth: a key dropped, a value replaced by another kind of value.
test('Schema: a mutated snapshot throws nothing but SchemaDefinitionError', () => {
  const { generate, prng } = require('../support/generate.js');
  const random = prng(7);
  const ODD = [null, 0, -1, 1.5, '', 'x', 'User', true, [], {}, [1], { type: 'nope' }, '__proto__'];
  const places = (value, out = []) => {
    if (value !== null && typeof value === 'object') {
      out.push(value);
      for (const key of Object.keys(value)) places(value[key], out);
    }
    return out;
  };
  let read = 0;
  let rejected = 0;
  for (let seed = 1; seed <= 60; seed++) {
    const { definition, options } = generate(seed);
    const text = JSON.stringify(define(definition, options).snapshot);
    for (let round = 0; round < 40; round++) {
      const copy = JSON.parse(text);
      const targets = places(copy);
      for (let i = 0; i < 3; i++) {
        const target = targets[Math.floor(random() * targets.length)];
        const keys = Object.keys(target);
        if (keys.length === 0) continue;
        const key = keys[Math.floor(random() * keys.length)];
        if (random() < 0.3) delete target[key];
        else target[key] = ODD[Math.floor(random() * ODD.length)];
      }
      try {
        assert.ok(new Schema(copy) instanceof Schema);
        read++;
      } catch (error) {
        assert.ok(error instanceof SchemaDefinitionError, `${seed}/${round}: ${error.stack}`);
        rejected++;
      }
    }
  }
  assert.ok(read > 0 && rejected > 0, `${read} read, ${rejected} rejected`);
});
