const { test } = require('node:test');
const assert = require('node:assert');
const ms = require('@alexify/metaschema');
const { Schema, SchemaDefinitionError } = require('../../index.js');
const { SchemaRegistry } = require('../../registry.js');
const { fromMetaschema, fromModel, types, register } = require('../../metaschema.js');
const { normalize } = require('../support/backends.js');

const model = (entities, custom = {}) =>
  new ms.Model({ ...types, ...custom }, Object.entries(entities), null, { registry: 'isolated' });

test('Metaschema: the shared DSL translates type for type', () => {
  const definition = {
    a: 'string',
    'b?': 'number',
    c: '?integer',
    d: { type: 'number', default: 1 },
    e: { array: '?string' },
    f: { set: 'number' },
    g: { map: { string: 'date' } },
    h: { object: { string: 'number' } },
    i: { enum: ['x', 'y'], default: 'x' },
    j: ['number', { name: 'string' }, { 'opt?': 'boolean' }],
    k: { inner: 'string', deep: { n: 'bigint' } },
    l: 'json',
    m: 'any',
    n: 'null',
    o: { union: [{ t: { enum: ['p'] }, v: 'number' }, { t: { enum: ['q'] } }], discriminator: 't' },
    p: (record) => record.a,
    q: { type: 'string', aliases: ['old'] },
    r: { type: 'number', decimals: 2 },
    s: 'boolean',
    u: 'unknown',
    v: { schema: { type: 'string', x: 'number' } },
    w: { type: 'date', default: () => new Date() },
  };
  const source = ms.Schema.from(definition);
  const schema = fromMetaschema(source, { validate: 'both' });
  assert.strictEqual(
    schema.toString(),
    '{a:string,b:?number,c:?integer,d:?number=1,e:[?string],f:set[number],g:map<string,date>,' +
      'h:object<number>,i:?enum(x|y)="x",j:(number,string,?boolean),k:{inner:string,deep:{n:bigint}},' +
      'l:?json,m:?json,n:?null,o:union(t)[{t:enum(p),v:number}|{t:enum(q)}],q:string,' +
      'r:number(2),s:boolean,u:?json,v:{type:string,x:number},w:date}',
  );
  // Aliases are carried for Schema.resolve; they never reach the fingerprint.
  assert.deepStrictEqual(schema[Symbol.for('alexify.protoarray.plan')].fields[15].aliases, ['old']);
  const value = {
    a: 'A',
    c: 3,
    e: ['x', null],
    f: new Set([1]),
    g: new Map([['k', new Date(5)]]),
    h: { tea: 2 },
    j: [1, 'n', true],
    k: { inner: 'i', deep: { n: 5n } },
    l: { any: 1 },
    o: { t: 'p', v: 1 },
    q: 'q',
    r: 1.25,
    s: true,
    v: { type: 't', x: 1 },
    w: new Date(9),
  };
  const decoded = schema.decode(schema.encode(value));
  assert.deepStrictEqual(
    normalize(decoded),
    normalize({ ...value, b: null, d: 1, i: 'x', m: null, n: null, u: null }),
  );
  // The same value passes metaschema's own check.
  const result = source.check(decoded);
  assert.deepStrictEqual(result.errors, []);
  // A root that is a single type.
  assert.strictEqual(fromMetaschema(ms.Schema.from('?string')).toString(), '?string');
  assert.strictEqual(fromMetaschema(ms.Schema.from({ array: 'number' })).toString(), '[number]');
});

test('Metaschema: references as the storage view holds them', () => {
  const entities = model(
    {
      Company: { Entity: {}, name: 'string' },
      Address: { Struct: {}, city: 'string', zip: '?string' },
      Tree: { Struct: {}, label: 'string', kids: { many: 'Tree' } },
      User: {
        Entity: {},
        name: 'string',
        company: 'Company',
        home: 'Address',
        'work?': 'Address',
        'boss?': 'User',
        friends: { many: 'User' },
        embedded: { type: 'Company', embed: true },
        tree: 'Tree',
        pic: '?bytes',
        perms: { flags: ['read', 'write'] },
        salary: 'money',
        at: 'date',
      },
    },
    { money: { js: 'number' } },
  );
  const registry = fromModel(entities, { codegen: false });
  assert.ok(registry instanceof SchemaRegistry);
  assert.deepStrictEqual(
    [...registry].map((schema) => schema.name),
    ['Company', 'Address', 'Tree', 'User'],
  );
  const User = registry.find('User');
  assert.strictEqual(User.backend, 'closures');
  // A stored entity is its id, a memory kind (or `embed`) the record; the
  // stored kind's own id field comes last, as in metaschema.
  assert.strictEqual(
    User.toString(),
    '{name:string,company:string,home:@Address,work:?@Address,boss:?string,friends:[string],' +
      'embedded:@Company,tree:@Tree,pic:?bytes,perms:flags(read|write),salary:number,at:date,' +
      'userId:?string}',
  );
  assert.strictEqual(registry.find('Tree').toString(), '{label:string,kids:[@Tree]}');
  const value = {
    name: 'Alex',
    company: 'c1',
    home: { city: 'Kyiv' },
    friends: ['u2'],
    embedded: { name: 'Acme' },
    tree: { label: 'a', kids: [{ label: 'b', kids: [] }] },
    pic: new Uint8Array([1, 2]),
    perms: { read: true },
    salary: 10,
    at: new Date(7),
  };
  const decoded = User.decode(User.encode(value));
  assert.deepStrictEqual(entities.entities.get('User').check(decoded).errors, []);
  assert.deepStrictEqual(decoded.home, { city: 'Kyiv', zip: null });
  assert.deepStrictEqual(decoded.embedded, { name: 'Acme', companyId: null });
  assert.deepStrictEqual(decoded.perms, { read: true, write: false });
  // The same Model translated twice gives the same ids.
  assert.strictEqual(fromModel(entities).find('User').id, User.id);
});

test('Metaschema: what has no positional form is an error', () => {
  const weird = { kind: 'scalar', construct() {}, checkType: () => null };
  const entities = model({ Thing: { Struct: {}, n: 'weird' } }, { weird });
  assert.throws(() => fromModel(entities), {
    code: 'ERR_UNKNOWN_TYPE',
    message: 'Unknown type "weird" at "n"',
  });
  const root = model({ Weird: 'weird' }, { weird }).entities.get('Weird');
  assert.throws(() => fromMetaschema(root), {
    code: 'ERR_UNKNOWN_TYPE',
    message: 'Unknown type "weird"',
  });
  const plain = ms.Schema.from({ u: { union: ['string', 'number'] } });
  assert.throws(() => fromMetaschema(plain), { code: 'ERR_UNKNOWN_TYPE' });
  // A reference with nothing to resolve it against.
  assert.throws(() => fromMetaschema(ms.Schema.from({ c: 'Company' })), {
    code: 'ERR_UNKNOWN_REFERENCE',
    message: 'Unknown reference "Company" at "c"',
  });
  // Two memory kinds embedding each other have no order to be built in.
  const cycle = model({
    A: { Struct: {}, b: '?B' },
    B: { Struct: {}, a: '?A' },
  });
  assert.throws(
    () => fromModel(cycle),
    (error) => {
      assert.ok(error instanceof SchemaDefinitionError);
      assert.strictEqual(error.code, 'ERR_UNKNOWN_REFERENCE');
      return true;
    },
  );
  for (const bad of [{}, null, Schema.from({ a: 'string' })]) {
    assert.throws(() => fromMetaschema(bad), { code: 'ERR_SCHEMA_EXPECTED' });
    assert.throws(() => fromModel(bad), { code: 'ERR_SCHEMA_EXPECTED' });
  }
});

test('Metaschema: the custom types table', () => {
  const entities = model({ Doc: { Struct: {}, data: 'bytes', perms: { flags: ['r', 'w'] } } });
  // Registering the same table again is accepted.
  assert.ok(model({ Other: { Struct: {}, data: 'bytes' } }));
  assert.ok(new ms.Model(types, [], null, {}));
  assert.ok(new ms.Model(types, [], null, {}));
  const Doc = entities.entities.get('Doc');
  assert.strictEqual(Doc.check({ data: new Uint8Array(1), perms: { r: true } }).valid, true);
  assert.strictEqual(Doc.check({ data: [1], perms: {} }).valid, false);
  for (const perms of [null, [], { x: true }, { r: 1 }, 'r']) {
    assert.strictEqual(Doc.check({ data: new Uint8Array(1), perms }).valid, false);
  }
});

test('Metaschema: register() lets a metaschema Schema stand in a definition', () => {
  const Address = ms.Schema.from({ city: 'string' });
  assert.throws(() => Schema.from(Address), {
    code: 'ERR_UNKNOWN_TYPE',
    message: "A metaschema Schema needs register() from '@alexify/protoarray/metaschema'",
  });
  assert.throws(() => SchemaRegistry.from(model({})), { code: 'ERR_UNKNOWN_TYPE' });
  register();
  register();
  assert.strictEqual(Schema.from(Address, { codegen: false }).toString(), '{city:string}');
  assert.deepStrictEqual(Schema.from({ home: Address }).decode([['Kyiv']]), {
    home: { city: 'Kyiv' },
  });
  const registry = SchemaRegistry.from(model({ A: { Struct: {}, x: 'number' } }));
  assert.strictEqual(registry.find('A').toString(), '{x:number}');
});
