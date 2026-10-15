const { test } = require('node:test');
const assert = require('node:assert');
const { Schema, SchemaDefinitionError } = require('../../index.js');
const { BACKENDS } = require('../support/backends.js');

const CODEC = Symbol.for('alexify.protoarray.codec');

const invalid = (definition, expected, options) => {
  assert.throws(
    () => new Schema('T', definition, options),
    (error) => {
      assert.ok(error instanceof SchemaDefinitionError);
      assert.ok(error instanceof TypeError);
      assert.strictEqual(error.name, 'SchemaDefinitionError');
      assert.strictEqual(error.code, expected.code);
      if (expected.field !== undefined) assert.strictEqual(error.field, expected.field);
      if (expected.message !== undefined) assert.strictEqual(error.message, expected.message);
      assert.strictEqual(error.schema, 'T');
      return true;
    },
  );
};

test('Schema: every spelling of a field resolves to a position', () => {
  const schema = Schema.from({
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
  const schema = Schema.from({
    a: { type: 'schema', schema: { x: 'string' } },
    b: { set: 'number', required: false },
    c: { type: 'object', key: 'string', value: '?number' },
    d: { map: { number: 'string' } },
    // An element named like a keyword, a type or a kind is a definition.
    e: [{ array: 'number' }, { 'set?': 'string' }, { Kind: 'string' }, { 'n?': 'integer' }],
  });
  assert.strictEqual(
    schema.toString(),
    '{a:{x:string},b:?set[number],c:object<?number>,d:map<number,string>,' +
      'e:([number],{set:?string},{Kind:string},?integer)}',
  );
  invalid({ e: [{ 'string?': 'x' }] }, { code: 'ERR_UNKNOWN_TYPE', field: 'e[0].string' });
});

test('Schema: definition errors name the field', () => {
  invalid(42, { code: 'ERR_INVALID_DEFINITION', message: 'Unexpected definition' });
  invalid(null, { code: 'ERR_INVALID_DEFINITION' });
  invalid(undefined, { code: 'ERR_INVALID_DEFINITION' });
  invalid({}, { code: 'ERR_INVALID_DEFINITION', message: 'An empty definition' });
  invalid({ Entity: {} }, { code: 'ERR_INVALID_DEFINITION', message: 'A struct needs fields' });
  invalid({ a: () => 1 }, { code: 'ERR_INVALID_DEFINITION', message: 'A struct needs fields' });
  invalid(
    { price: 'float' },
    { code: 'ERR_UNKNOWN_TYPE', field: 'price', message: 'Unknown type "float" at "price"' },
  );
  invalid({ price: '?float' }, { code: 'ERR_UNKNOWN_TYPE', field: 'price' });
  invalid({ nested: { price: 'float' } }, { code: 'ERR_UNKNOWN_TYPE', field: 'nested.price' });
  invalid({ list: { array: 'float' } }, { code: 'ERR_UNKNOWN_TYPE', field: 'list[]' });
  invalid(
    { list: { array: { deep: { array: 'float' } } } },
    { code: 'ERR_UNKNOWN_TYPE', field: 'list[].deep[]' },
  );
  invalid({ pair: ['number', 'float'] }, { code: 'ERR_UNKNOWN_TYPE', field: 'pair[1]' });
  invalid({ pair: [{ x: 'float' }] }, { code: 'ERR_UNKNOWN_TYPE', field: 'pair[0]' });
  invalid({ pair: [{ p: { x: 'float' } }] }, { code: 'ERR_UNKNOWN_TYPE', field: 'pair[0].p.x' });
  invalid(
    { pair: [] },
    { code: 'ERR_INVALID_DEFINITION', field: 'pair', message: 'An empty tuple at "pair"' },
  );
  invalid(
    { pair: { tuple: 'number' } },
    { code: 'ERR_INVALID_DEFINITION', message: 'A tuple needs a list of elements at "pair"' },
  );
  invalid(
    { m: { map: { boolean: 'number' } } },
    { code: 'ERR_INVALID_DEFINITION', message: 'A map needs { string | number: type } at "m"' },
  );
  invalid({ m: { map: 'number' } }, { code: 'ERR_INVALID_DEFINITION', field: 'm' });
  invalid({ m: { type: 'map', key: 'string' } }, { code: 'ERR_INVALID_DEFINITION', field: 'm' });
  invalid(
    { o: { object: { number: 'string' } } },
    { code: 'ERR_INVALID_DEFINITION', message: 'An object needs { string: type } at "o"' },
  );
  invalid({ m: { map: { string: 'float' } } }, { code: 'ERR_UNKNOWN_TYPE', field: 'm{}' });
  invalid(
    { integer: 'x', b: 'number' },
    { code: 'ERR_UNKNOWN_TYPE', message: 'A struct cannot start with the type name "integer"' },
  );
  invalid({ one: 'User', b: 'number' }, { code: 'ERR_UNKNOWN_TYPE' });
  invalid({ string: 'x' }, { code: 'ERR_UNKNOWN_TYPE' });
  invalid({ json: 'x', b: 'number' }, { code: 'ERR_UNKNOWN_TYPE' });
  invalid(
    { n: { type: 1 } },
    {
      code: 'ERR_INVALID_DEFINITION',
      message: 'The type must be a string; a struct starting with "type" needs a kind first at "n"',
    },
  );
  invalid({ n: { type: { enum: ['a'] }, id: 'string' } }, { code: 'ERR_INVALID_DEFINITION' });
  assert.deepStrictEqual(
    Schema.from({ n: { Struct: {}, type: { enum: ['a'] }, id: 'string' } }).decode([[0, 'x']]),
    { n: { type: 'a', id: 'x' } },
  );
  invalid({ n: { type: 'set' } }, { code: 'ERR_INVALID_DEFINITION', field: 'n[]' });
  invalid({ n: { type: 'integer', default: 1.5 } }, { code: 'ERR_INVALID_DEFINITION' });
  invalid(JSON.parse('{"__proto__":"string"}'), {
    code: 'ERR_RESERVED_KEY',
    field: '__proto__',
    message: 'Reserved key "__proto__" at "__proto__"',
  });
  invalid({ '__proto__?': 'string' }, { code: 'ERR_RESERVED_KEY' });
  invalid({ 1: 'string' }, { code: 'ERR_INTEGER_KEY', field: '1' });
  invalid({ a: 'string', '007': 'string' }, { code: 'ERR_INTEGER_KEY', field: '007' });
  invalid(
    { a: 'string', 'a?': 'number' },
    { code: 'ERR_INVALID_DEFINITION', message: 'Invalid key "a" at "a"' },
  );
  invalid({ '?': 'string' }, { code: 'ERR_INVALID_DEFINITION' });
  invalid(
    { ref: 'Missing' },
    {
      code: 'ERR_UNKNOWN_REFERENCE',
      field: 'ref',
      message: 'Unknown reference "Missing" at "ref"',
    },
  );
  invalid(
    { ref: 'Other' },
    { code: 'ERR_UNKNOWN_REFERENCE' },
    { schemas: { Other: { id: 'number' } } },
  );
});

test('Schema: enum, flags and default errors', () => {
  invalid(
    { role: { enum: [] } },
    {
      code: 'ERR_INVALID_ENUM',
      field: 'role',
      message: 'Expected unique strings or numbers at "role"',
    },
  );
  invalid({ role: { enum: 'admin' } }, { code: 'ERR_INVALID_ENUM' });
  invalid({ role: { enum: ['a', 'a'] } }, { code: 'ERR_INVALID_ENUM' });
  invalid({ role: { enum: [1, '1'] } }, { code: 'ERR_INVALID_ENUM' });
  invalid({ role: { enum: ['a', true] } }, { code: 'ERR_INVALID_ENUM' });
  invalid({ role: { enum: ['__proto__'] } }, { code: 'ERR_INVALID_ENUM' });
  invalid({ role: { type: 'enum', enum: [] } }, { code: 'ERR_INVALID_ENUM' });
  // An enum travels as an index, so its size is not limited the way flags are.
  const wide = Schema.from({ role: { enum: Array.from({ length: 40 }, (_, i) => i) } });
  assert.deepStrictEqual(wide.encode({ role: 39 }), [39]);
  assert.deepStrictEqual(wide.decode([39]), { role: 39 });
  invalid(
    { perms: { flags: [] } },
    {
      code: 'ERR_INVALID_FLAGS',
      field: 'perms',
      message: 'Expected unique names at "perms"',
    },
  );
  invalid({ perms: { flags: [1] } }, { code: 'ERR_INVALID_FLAGS' });
  assert.ok(Schema.from({ perms: { flags: Array.from({ length: 70 }, (_, i) => `f${i}`) } }));
  invalid({ perms: { flags: ['a', '__proto__'] } }, { code: 'ERR_INVALID_FLAGS' });
  const decimals = 'decimals is an integer from 0 to 15 on a number at "n"';
  for (const n of [-1, 16, 1.5, '2', null]) {
    invalid(
      { n: { type: 'number', decimals: n } },
      { code: 'ERR_INVALID_DEFINITION', message: decimals },
    );
  }
  invalid({ n: { type: 'string', decimals: 2 } }, { code: 'ERR_INVALID_DEFINITION', field: 'n' });
  invalid({ n: { type: 'bigint', decimals: 2 } }, { code: 'ERR_INVALID_DEFINITION' });
  invalid({ n: { enum: [1, 2], decimals: 2 } }, { code: 'ERR_INVALID_DEFINITION' });
  // The scale is part of the wire, so of the id; a default is a decoded value.
  const money = Schema.from({ n: { type: 'number', decimals: 2, default: 0.5 } });
  assert.strictEqual(money.toString(), '{n:?number(2)=0.5}');
  assert.notStrictEqual(money.id, Schema.from({ n: { type: 'number', default: 0.5 } }).id);
  assert.deepStrictEqual(money.decode([]), { n: 0.5 });
  invalid({ perms: { type: 'flags', flags: ['a', 'a'] } }, { code: 'ERR_INVALID_FLAGS' });
  invalid({ n: { type: 'number', default: {} } }, { code: 'ERR_INVALID_DEFINITION', field: 'n' });
  invalid({ n: { type: 'number', default: Infinity } }, { code: 'ERR_INVALID_DEFINITION' });
  invalid({ n: { type: 'date', default: 5 } }, { code: 'ERR_INVALID_DEFINITION' });
  invalid({ n: { type: 'bigint', default: '5' } }, { code: 'ERR_INVALID_DEFINITION' });
  invalid({ n: { type: 'flags', flags: ['a'], default: 1 } }, { code: 'ERR_INVALID_DEFINITION' });
  assert.deepStrictEqual(Schema.from({ n: { type: 'string', default: null } }).decode([]), {
    n: null,
  });
  assert.deepStrictEqual(
    Schema.from({ n: { array: 'string', required: false, default: 'x' } }).decode([]),
    {
      n: null,
    },
  );
});

test('Schema: option errors', () => {
  const options = [
    1,
    'x',
    { codegen: 'yes' },
    { validate: 1 },
    { validate: 'nope' },
    { validate: 'BOTH' },
    { validate: null },
    { sparse: 'x' },
    { layout: 'rowz' },
    { schemas: null },
    { schemas: 1 },
    { fingerprint: 'sha256' },
    { unknown: true },
  ];
  for (const value of options) invalid({ a: 'string' }, { code: 'ERR_INVALID_OPTIONS' }, value);
  invalid({ a: 'string' }, { code: 'ERR_INVALID_OPTIONS' }, { layout: 'flat' });
  invalid({ array: 'string' }, { code: 'ERR_INVALID_OPTIONS' }, { layout: 'columns' });
  invalid(['number'], { code: 'ERR_INVALID_OPTIONS' }, { sparse: true });
  invalid(
    { array: Schema.from({ a: 'number' }, { sparse: true }) },
    { code: 'ERR_INVALID_OPTIONS' },
    { layout: 'flat' },
  );
  invalid(
    { array: 'number' },
    { code: 'ERR_INVALID_OPTIONS', message: 'sparse needs a struct' },
    {
      sparse: true,
    },
  );
  const wide = {};
  for (let i = 0; i < 70; i++) wide[`f${i}`] = 'number';
  assert.strictEqual(Schema.from(wide, { sparse: true }).layout, 'sparse');
  assert.strictEqual(
    Schema.from({ a: 'string' }, { codegen: undefined, layout: undefined }).backend,
    'codegen',
  );
  assert.strictEqual(Schema.from({ a: 'string' }, null).backend, 'codegen');
  // Only own keys are options: a prototype member is not one.
  invalid({ a: 'string' }, { code: 'ERR_INVALID_OPTIONS' }, { constructor: true });
  invalid({ a: 'string' }, { code: 'ERR_INVALID_OPTIONS' }, { hasOwnProperty: true });
});

// `validate` picks the direction that is checked. The default checks the wire
// on decode and trusts the values given to encode, as 1.0 did; 'both' checks
// both, 'encode' only the values, false nothing but the structure.
for (const [backend, options] of BACKENDS) {
  test(`Schema (${backend}): validate modes`, () => {
    const definition = { id: 'number', tags: { array: 'string', required: false } };
    const modes = [
      [true, false, true],
      ['decode', false, true],
      ['encode', true, false],
      ['both', true, true],
      [false, false, false],
    ];
    for (const [mode, values, wire] of modes) {
      const label = String(mode);
      const schema = Schema.from(definition, { ...options, validate: mode });
      const bad = { id: 'x' };
      if (values) assert.throws(() => schema.encode(bad), { code: 'type', path: 'id' }, label);
      else assert.deepStrictEqual(schema.encode(bad), ['x'], label);
      if (wire) assert.throws(() => schema.decode(['x']), { code: 'type', path: 'id' }, label);
      else assert.deepStrictEqual(schema.decode(['x']), { id: 'x', tags: null }, label);
      // The shape is checked in every mode, and check() validates in every mode.
      assert.throws(() => schema.encode(5), { code: 'object' }, label);
      assert.throws(() => schema.decode('x'), { code: 'structure' }, label);
      assert.strictEqual(schema.check(bad).code, 'type', label);
      assert.strictEqual(schema.check({ id: 1 }), null, label);
      // The list inherits the mode.
      const rows = schema.list;
      if (values) assert.throws(() => rows.encode([bad]), { path: '[0].id' }, label);
      else assert.deepStrictEqual(rows.encode([bad]), [['x']], label);
      if (wire) assert.throws(() => rows.decode([['x']]), { path: '[0].id' }, label);
      else assert.deepStrictEqual(rows.decode([['x']]), [{ id: 'x', tags: null }], label);
    }
    // A schema by value or by name keeps its own mode inside another.
    const Inner = new Schema('Inner', { n: 'number' }, options);
    const Strict = new Schema('Strict', { n: 'number' }, { ...options, validate: 'both' });
    const Outer = Schema.from(
      { a: Inner, b: Strict, c: 'Inner' },
      { ...options, validate: 'both', schemas: { Inner } },
    );
    assert.deepStrictEqual(Outer.encode({ a: { n: 'x' }, b: { n: 1 }, c: { n: 'y' } }), [
      ['x'],
      [1],
      ['y'],
    ]);
    assert.throws(() => Outer.encode({ a: { n: 1 }, b: { n: 'x' }, c: { n: 1 } }), {
      code: 'type',
      path: 'b.n',
    });
    const Trusting = Schema.from({ b: Strict }, { ...options, validate: false });
    assert.throws(() => Trusting.encode({ b: { n: 'x' } }), { code: 'type', path: 'b.n' });
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
    const schema = Schema.from(definition, options);
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
  const generated = Schema.from({ id: 'number' }, { codegen: true })[CODEC];
  assert.match(generated.source, /function encode\(v\)/);
  assert.match(generated.source, /"id"/);
  assert.strictEqual(Schema.from({ id: 'number' }, { codegen: false })[CODEC].source, undefined);
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
    const schema = Schema.from({ id: 'number' });
    assert.strictEqual(schema.backend, 'closures');
    assert.deepStrictEqual(schema.decode([1]), { id: 1 });
    assert.strictEqual(schema.list.backend, 'closures');
    assert.throws(() => Schema.from({ id: 'number' }, { codegen: true }), EvalError);
    // The cause is kept, off the public surface, so a fallback can be told from a choice.
    assert.ok(schema[FALLBACK] instanceof EvalError);
    assert.strictEqual(schema[FALLBACK].message, 'refused');
    assert.strictEqual(schema.list[FALLBACK].message, 'refused');
    assert.ok(!Object.keys(schema).includes(FALLBACK));
  } finally {
    codegen.build = build;
  }
  assert.strictEqual(Schema.from({ id: 'number' })[FALLBACK], undefined);
  assert.strictEqual(Schema.from({ id: 'number' }, { codegen: false })[FALLBACK], undefined);
});
