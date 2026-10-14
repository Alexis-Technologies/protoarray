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
  invalid(
    { pair: ['number', { x: 'string', y: 'string' }] },
    {
      code: 'ERR_INVALID_DEFINITION',
      field: 'pair[1]',
      message: 'Tuple elements must be scalar types at "pair[1]"',
    },
  );
  invalid(
    { pair: [{ x: 'number' }, ['number']] },
    { code: 'ERR_INVALID_DEFINITION', field: 'pair[1]' },
  );
  invalid({ pair: [{ p: { x: 'number' } }] }, { code: 'ERR_INVALID_DEFINITION', field: 'pair[0]' });
  invalid(
    { pair: [] },
    { code: 'ERR_INVALID_DEFINITION', field: 'pair', message: 'An empty tuple at "pair"' },
  );
  invalid(
    { map: { string: 'number' } },
    { code: 'ERR_UNKNOWN_TYPE', message: 'A struct cannot start with the type name "map"' },
  );
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
  invalid({ n: { type: 'set' } }, { code: 'ERR_UNKNOWN_TYPE' });
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
      message: 'Expected up to 31 unique names at "perms"',
    },
  );
  invalid({ perms: { flags: [1] } }, { code: 'ERR_INVALID_FLAGS' });
  invalid(
    { perms: { flags: Array.from({ length: 32 }, (_, i) => `f${i}`) } },
    { code: 'ERR_INVALID_FLAGS' },
  );
  invalid({ perms: { flags: ['a', '__proto__'] } }, { code: 'ERR_INVALID_FLAGS' });
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
  const wide = {};
  for (let i = 0; i < 32; i++) wide[`f${i}`] = 'number';
  invalid(wide, { code: 'ERR_INVALID_OPTIONS' }, { sparse: true });
  assert.strictEqual(Schema.from(wide).keys.length, 32);
  assert.strictEqual(
    Schema.from({ a: 'string' }, { codegen: undefined, layout: undefined }).backend,
    'codegen',
  );
  assert.strictEqual(Schema.from({ a: 'string' }, null).backend, 'codegen');
});

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
  try {
    const schema = Schema.from({ id: 'number' });
    assert.strictEqual(schema.backend, 'closures');
    assert.deepStrictEqual(schema.decode([1]), { id: 1 });
    assert.strictEqual(schema.list.backend, 'closures');
    assert.throws(() => Schema.from({ id: 'number' }, { codegen: true }), EvalError);
  } finally {
    codegen.build = build;
  }
});
