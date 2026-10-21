const { test } = require('node:test');
const assert = require('node:assert');
const { Schema } = require('../../index.js');
const { compatible, baseline, restore, register } = require('../../evolve.js');
const { resolve } = require('../../resolve.js');
const { ms, define, named, model } = require('../support/schema.js');
const { version } = require('../../package.json');

const SIGNATURE = Symbol.for('alexify.protoarray.signature');

// 40 optional fields: a canonical form longer than a message shows.
const WIDE = {};
for (let i = 0; i < 40; i++) WIDE[`field${i}`] = '?number';

// The four versions of the evolution guide: V1 to V3 follow the rules, V4
// breaks them (a widened type, a rename, reordered enum values, a default).
const V1 = named('User', { id: 'integer', fullName: 'string', role: { enum: ['admin', 'user'] } });
const V2 = named('User', {
  id: 'integer',
  fullName: 'string',
  role: { enum: ['admin', 'user'] },
  email: '?string',
});
const V3 = named('User', {
  id: 'integer',
  fullName: 'string',
  role: { enum: ['admin', 'user', 'guest'] },
  email: '?string',
  score: { type: 'number', default: 0 },
});
const V4 = named('User', {
  id: 'number',
  name: { type: 'string', aliases: ['fullName'] },
  role: { enum: ['guest', 'user', 'admin'] },
  email: { type: 'string', default: '' },
  score: { type: 'number', default: 0 },
});

// The problems of a comparison as `[path, rule, severity]`, and their messages.
const found = (previous, next, options) => {
  const { ok, problems } = compatible(previous, next, options);
  const list = problems.map((problem) => [problem.path, problem.rule, problem.severity]);
  return { ok, list, messages: problems.map((problem) => problem.message) };
};

test('Evolve: the versions of the guide', () => {
  assert.deepStrictEqual(compatible(V1, V2), { ok: true, problems: [] });
  assert.deepStrictEqual(compatible(V1, V1), { ok: true, problems: [] });
  // An enum value appended: decoders go first. A field with a default: nothing.
  const grown = compatible(V2, V3);
  assert.strictEqual(grown.ok, true);
  assert.deepStrictEqual(grown.problems, [
    {
      path: 'role',
      rule: 'appended',
      severity: 'warning',
      message: 'Enum value "guest" appended: deploy decoders before encoders',
      previous: 'enum(admin|user)',
      next: 'enum(admin|user|guest)',
    },
  ]);
  assert.strictEqual(compatible(V2, V3, { strict: true }).ok, false);
  assert.strictEqual(compatible(V2, V3, { strict: false }).ok, true);
  const broken = found(V3, V4);
  assert.strictEqual(broken.ok, false);
  assert.deepStrictEqual(broken.list, [
    ['id', 'type', 'error'],
    ['name', 'renamed', 'info'],
    ['role', 'moved', 'error'],
    ['role', 'moved', 'error'],
    ['email', 'default', 'warning'],
  ]);
  assert.deepStrictEqual(broken.messages, [
    'Type changed: integer → number',
    'Field "fullName" is now "name"',
    'Enum value "admin" moved from position 0 to 2',
    'Enum value "guest" moved from position 2 to 0',
    'Default added (""): an empty slot in older payloads decodes as it',
  ]);
  // Every problem carries the canonical forms of the two nodes.
  const [widened] = compatible(V3, V4).problems;
  assert.deepStrictEqual([widened.previous, widened.next], ['integer', 'number']);
  const { list, messages } = found(V1, V4);
  assert.deepStrictEqual(list.slice(2), [
    ['role', 'inserted', 'error'],
    ['role', 'moved', 'error'],
  ]);
  assert.strictEqual(messages[2], 'Enum value "guest" inserted before "admin", which moves');
});

test('Evolve: fields inserted, swapped, removed and renamed', () => {
  const abc = define({ a: 'string', b: 'string', c: 'string' });
  const inserted = found(abc, define({ a: 'string', x: 'string', b: 'string', c: 'string' }));
  assert.deepStrictEqual(inserted.list, [['x', 'inserted', 'error']]);
  assert.deepStrictEqual(inserted.messages, [
    'Field "x" inserted at position 1: "b" and "c" move further',
  ]);
  const [problem] = compatible(
    abc,
    define({ a: 'string', x: 'number', b: 'string', c: 'string' }),
  ).problems;
  assert.strictEqual(problem.previous, undefined);
  assert.strictEqual(problem.next, 'number');
  const swapped = found(abc, define({ a: 'string', c: 'string', b: 'string' }));
  assert.deepStrictEqual(swapped.list, [['b', 'moved', 'error']]);
  assert.deepStrictEqual(swapped.messages, ['Field "b" moved from position 1 to 2']);
  const reversed = found(abc, define({ c: 'string', b: 'string', a: 'string' }));
  assert.deepStrictEqual(reversed.messages, [
    'Field "a" moved from position 0 to 2',
    'Field "c" moved from position 2 to 0',
  ]);
  // A field that moved is skipped where it stands on the other side.
  const abcd = define({ a: 'string', b: 'string', c: 'string', d: 'string' });
  const middle = found(abcd, define({ a: 'string', c: 'string', b: 'string', d: 'string' }));
  assert.deepStrictEqual(middle.messages, ['Field "b" moved from position 1 to 2']);
  const removed = found(abc, define({ a: 'string', c: 'string' }));
  assert.deepStrictEqual(removed.list, [['b', 'removed', 'error']]);
  assert.deepStrictEqual(removed.messages, [
    'Field "b" removed from position 1: "c" moves up; keep the slot of a retired field, as ?any',
  ]);
  const shorter = found(abc, define({ a: 'string', b: 'string' }));
  assert.deepStrictEqual(shorter.messages, [
    'Field "c" removed from position 2; keep the slot of a retired field, as ?any',
  ]);
  // A key that changes where neither key is anywhere else is a rename.
  const renamed = found(abc, define({ a: 'string', bee: 'string', c: 'string' }));
  assert.deepStrictEqual(renamed.list, [['bee', 'renamed', 'info']]);
  assert.strictEqual(renamed.ok, true);
  // A rename with a type change is both.
  const retyped = found(abc, define({ a: 'string', bee: 'number', c: 'string' }));
  assert.deepStrictEqual(retyped.list, [
    ['bee', 'renamed', 'info'],
    ['bee', 'type', 'error'],
  ]);
  // A shift the walk cannot explain is an error, never a rename: here "a" is
  // gone and "b" moved up; "c" to "x" at the same place of the rest is a rename.
  const shifted = found(abc, define({ b: 'string', x: 'string' }));
  assert.deepStrictEqual(shifted.list, [
    ['a', 'removed', 'error'],
    ['x', 'renamed', 'info'],
  ]);
  // After an insertion the walk realigns: one change, one problem.
  const realigned = found(abc, define({ z: 'string', a: 'string', b: 'string', y: 'string' }));
  assert.deepStrictEqual(realigned.list, [
    ['z', 'inserted', 'error'],
    ['y', 'renamed', 'info'],
  ]);
  const mixed = found(
    define({ a: 'string', b: 'string', c: 'string', d: 'string' }),
    define({
      c: 'string',
      b: 'string',
    }),
  );
  assert.deepStrictEqual(mixed.messages, [
    'Field "a" removed from position 0: "b" and "c" move up; keep the slot of a retired field, as ?any',
    'Field "c" moved from position 2 to 0',
    'Field "d" removed from position 3; keep the slot of a retired field, as ?any',
  ]);
});

test("Evolve: rule 8, a stored kind's id moves when a field is appended", () => {
  const entity = (fields) => model({ User: { Entity: {}, ...fields } }).User;
  const one = entity({ name: 'string' });
  assert.strictEqual(one.toString(), '{name:string,userId:?string}');
  const moved = found(one, entity({ name: 'string', email: '?string' }));
  assert.deepStrictEqual(moved.list, [['email', 'inserted', 'error']]);
  assert.deepStrictEqual(moved.messages, [
    'Field "email" inserted at position 1: "userId" moves further ' +
      '(rule 8: declare "userId" in the definition and append after it)',
  ]);
  // Declared in the definition, the id keeps its place.
  const kept = entity({ name: 'string', userId: '?string' });
  assert.deepStrictEqual(
    compatible(kept, entity({ name: 'string', userId: '?string', email: '?string' })),
    {
      ok: true,
      problems: [],
    },
  );
  // The hint is for an id only.
  const plain = found(
    define({ name: 'string', tail: '?string' }),
    define({ name: 'string', x: '?string', tail: '?string' }),
  );
  assert.deepStrictEqual(plain.messages, [
    'Field "x" inserted at position 1: "tail" moves further',
  ]);
});

test('Evolve: required, optional, retired and defaults', () => {
  const base = define({ a: 'string', b: '?string', n: { type: 'number', default: 1 } });
  const required = found(base, define({ a: 'string', b: 'string', n: 'number', c: 'string' }));
  assert.deepStrictEqual(required.list, [
    ['b', 'required', 'error'],
    ['n', 'required', 'error'],
    ['n', 'default', 'warning'],
    ['c', 'required', 'error'],
  ]);
  assert.deepStrictEqual(required.messages, [
    'Required now, where older payloads may send null',
    'Required now, where older payloads may send null',
    'Default removed (1): an empty slot in older payloads decodes as null',
    'Field "c" appended as required without a default: older payloads do not have it',
  ]);
  const relaxed = found(
    base,
    define({
      a: '?string',
      b: '?string',
      n: { type: 'number', default: 2 },
      c: '?string',
      d: 'json',
    }),
  );
  assert.strictEqual(relaxed.ok, true);
  assert.deepStrictEqual(relaxed.list, [
    ['a', 'optional', 'warning'],
    ['n', 'default', 'warning'],
  ]);
  assert.strictEqual(
    relaxed.messages[0],
    'Optional now: older validating readers refuse the null this version may write; deploy ' +
      'readers before writers',
  );
  assert.strictEqual(
    relaxed.messages[1],
    'Default changed from 1 to 2: an empty slot in older payloads decodes differently',
  );
  // A field with a default is optional: appended, it is no problem.
  const defaulted = found(
    base,
    define({
      a: 'string',
      b: '?string',
      n: { type: 'number', default: 1 },
      s: { type: 'string', default: '' },
    }),
  );
  assert.deepStrictEqual(defaulted.list, []);
  // Retired as ?any (anything is read as is), or as null (a warning).
  const any = found(base, define({ a: '?any', b: 'json', n: 'unknown' }));
  assert.deepStrictEqual(any.list, [
    ['a', 'retired', 'warning'],
    ['b', 'retired', 'warning'],
    ['n', 'retired', 'warning'],
  ]);
  assert.strictEqual(
    any.messages[0],
    'Retired as ?any: whatever older writers send is read as is, and older validating readers ' +
      'hold the slot to its type; deploy readers before writers',
  );
  // A warning: the newer writer may send what an older validating reader refuses.
  assert.strictEqual(any.ok, true);
  assert.strictEqual(
    found(base, define({ a: '?any', b: 'json', n: 'unknown' }), { strict: true }).ok,
    false,
  );
  const nulled = found(
    base,
    define({ a: 'null', b: '?string', n: { type: 'number', default: 1 } }),
  );
  assert.deepStrictEqual(nulled.list, [['a', 'retired', 'warning']]);
  assert.strictEqual(nulled.ok, true);
  assert.strictEqual(
    found(base, define({ a: 'null', b: '?string', n: { type: 'number', default: 1 } }), {
      strict: true,
    }).ok,
    false,
  );
  // A retired slot taken for a value again is a type change (and a required
  // one where it was never required); null to any is a retirement.
  const reused = found(define({ a: '?any', b: 'null' }), define({ a: 'string', b: '?any' }));
  assert.deepStrictEqual(reused.list, [
    ['a', 'required', 'error'],
    ['a', 'type', 'error'],
    ['b', 'retired', 'warning'],
  ]);
  assert.strictEqual(reused.messages[1], 'Type changed: json → string');
  assert.deepStrictEqual(found(define({ a: 'null' }), define({ a: 'null' })).list, []);
});

test('Evolve: types and the wire', () => {
  const widened = found(
    define({ a: 'integer', b: 'string', c: { type: 'number', decimals: 2 } }),
    define({ a: 'number', b: { enum: ['x'] }, c: { type: 'number', decimals: 3 } }),
  );
  assert.deepStrictEqual(widened.list, [
    ['a', 'type', 'error'],
    ['b', 'type', 'error'],
    ['c', 'type', 'error'],
  ]);
  assert.deepStrictEqual(widened.messages, [
    'Type changed: integer → number',
    'Type changed: string → enum(x)',
    'Type changed: number(2) → number(3)',
  ]);
  const scalar = define({ a: 'string' });
  const record = define({ a: { b: 'string' } });
  assert.deepStrictEqual(found(scalar, record).messages, ['Type changed: string → {b:string}']);
  assert.deepStrictEqual(found(record, scalar).list, [['a', 'type', 'error']]);
  // The markers of the wire are not the type: switching them is the wire rule.
  const plain = define({ a: 'string', ids: { array: 'integer' }, at: 'date' });
  const interned = define(
    { a: 'string', ids: { array: 'integer' }, at: 'date' },
    { intern: ['a'] },
  );
  const deltas = define({ a: 'string', ids: { array: 'integer' }, at: 'date' }, { delta: ['ids'] });
  assert.deepStrictEqual(found(plain, interned).list, [['a', 'wire', 'error']]);
  assert.deepStrictEqual(found(interned, plain).messages, [
    'The wire changed: intern switched off',
  ]);
  assert.deepStrictEqual(found(plain, deltas).messages, ['The wire changed: delta switched on']);
  assert.deepStrictEqual(found(deltas, plain).messages, ['The wire changed: delta switched off']);
  assert.deepStrictEqual(found(deltas, deltas).list, []);
  const [problem] = compatible(plain, deltas).problems;
  assert.deepStrictEqual([problem.previous, problem.next], ['[integer]', '~[integer]']);
  // A list of differences keeps its item under watch.
  const dates = define({ a: 'string', ids: { array: 'date' }, at: 'date' }, { delta: ['ids'] });
  assert.deepStrictEqual(found(deltas, dates).list, [['ids[]', 'type', 'error']]);
  // A column of differences, and a sparse record.
  const columns = define(
    { rows: { array: { id: 'integer', v: 'number' } } },
    { layout: { rows: 'columns' } },
  );
  const delta = define(
    { rows: { array: { id: 'integer', v: 'number' } } },
    { layout: { rows: 'columns' }, delta: ['rows[].id'] },
  );
  assert.deepStrictEqual(found(columns, delta).list, [['rows[].id', 'wire', 'error']]);
  assert.deepStrictEqual(
    found(define({ a: 'string' }), define({ a: 'string' }, { sparse: true })).messages,
    ['The wire changed: sparse switched on'],
  );
  const sparse = found(define({ a: 'string' }, { sparse: true }), define({ a: 'string' }));
  assert.deepStrictEqual(sparse.list, [['', 'wire', 'error']]);
  assert.strictEqual(sparse.messages[0], 'The wire changed: sparse switched off');
});

test('Evolve: collections, layouts and dictionaries', () => {
  const rows = define({ items: { array: { sku: 'string', qty: '?number' } } });
  const flat = define(
    { items: { array: { sku: 'string', qty: '?number' } } },
    { layout: { items: 'flat' } },
  );
  assert.deepStrictEqual(found(rows, flat).messages, ['The wire changed: layout rows → flat']);
  // A flat record changes its stride with every field, optional too.
  const wider = define(
    { items: { array: { sku: 'string', qty: '?number', note: '?string' } } },
    { layout: { items: 'flat' } },
  );
  const widened = found(flat, wider);
  assert.deepStrictEqual(widened.list, [['items', 'flat', 'error']]);
  assert.strictEqual(
    widened.messages[0],
    'A flat record has 3 fields instead of 2: the stride of the collection changed',
  );
  // A column appended is fine; a row collection grows like a record.
  const cols = (fields) => define({ array: fields }, { layout: 'columns' });
  assert.deepStrictEqual(
    compatible(cols({ id: 'integer' }), cols({ id: 'integer', v: '?number' })),
    { ok: true, problems: [] },
  );
  assert.deepStrictEqual(
    found(rows, define({ items: { array: { sku: 'string', qty: '?number', note: '?string' } } }))
      .list,
    [],
  );
  assert.deepStrictEqual(
    found(rows, define({ items: { array: { sku: 'integer', qty: '?number' } } })).list,
    [['items[].sku', 'type', 'error']],
  );
  // A Set for an array is another type, with the same items.
  const set = found(define({ tags: { array: 'string' } }), define({ tags: { set: 'string' } }));
  assert.deepStrictEqual(set.messages, ['Type changed: [string] → set[string]']);
  // Items and values that become required, under their paths.
  const loose = define({
    list: { array: '?string' },
    dict: { object: { string: '?number' } },
    map: { map: { string: '?number' } },
  });
  const tight = define({
    list: { array: 'string' },
    dict: { object: { string: 'number' } },
    map: { map: { string: 'number' } },
  });
  assert.deepStrictEqual(found(loose, tight).list, [
    ['list[]', 'required', 'error'],
    ['dict{}', 'required', 'error'],
    ['map{}', 'required', 'error'],
  ]);
  const keyed = found(
    tight,
    define({
      list: { array: 'string' },
      dict: { object: { string: 'number' } },
      map: { map: { number: 'number' } },
    }),
  );
  assert.deepStrictEqual(keyed.messages, ['Type changed: map<string,number> → map<number,number>']);
  assert.deepStrictEqual(
    found(
      tight,
      define({
        list: { array: 'string' },
        dict: { object: { string: 'string' } },
        map: { map: { string: 'number' } },
      }),
    ).list,
    [['dict{}', 'type', 'error']],
  );
});

test('Evolve: enums, flags and unions', () => {
  const flags = (names) => define({ perms: { flags: names } });
  const grown = found(flags(['read', 'write']), flags(['read', 'write', 'admin']));
  assert.deepStrictEqual(grown.list, [['perms', 'appended', 'warning']]);
  assert.strictEqual(grown.messages[0], 'Flag "admin" appended: deploy decoders before encoders');
  assert.deepStrictEqual(found(flags(['read', 'write']), flags(['read', 'all'])).messages, [
    'Flag "write" is now "all"',
  ]);
  assert.deepStrictEqual(found(flags(['read', 'write']), flags(['write'])).messages, [
    'Flag "read" removed: "write" moves up',
  ]);
  const numbers = found(define({ e: { enum: [1, 2] } }), define({ e: { enum: [1, '2', 3] } }));
  assert.deepStrictEqual(numbers.messages, [
    'Enum value 2 is now "2"',
    'Enum value 3 appended: deploy decoders before encoders',
  ]);
  const union = (branches, key = 'kind') =>
    define({ packet: { union: branches, discriminator: key } });
  const call = { kind: { enum: ['call'] }, args: { array: 'string' } };
  const event = { kind: { enum: ['event', 'signal'] }, name: 'string' };
  const two = union([call, event]);
  // A branch appended is its values appended.
  const added = found(two, union([call, event, { kind: { enum: ['ping'] } }]));
  assert.deepStrictEqual(added.list, [['packet', 'appended', 'warning']]);
  assert.strictEqual(
    added.messages[0],
    'Union value "ping" appended: deploy decoders before encoders',
  );
  // A value into any branch but the last moves every later tag.
  const inserted = found(
    two,
    union([{ kind: { enum: ['call', 'cast'] }, args: { array: 'string' } }, event]),
  );
  assert.deepStrictEqual(inserted.list, [['packet', 'inserted', 'error']]);
  assert.strictEqual(
    inserted.messages[0],
    'Union value "cast" inserted before "event", which moves',
  );
  // The branches compare as records, under the branch's index.
  const changed = found(
    two,
    union([
      { kind: { enum: ['call'] }, args: { array: 'integer' } },
      { ...event, at: '?date' },
    ]),
  );
  assert.deepStrictEqual(changed.list, [['packet[0].args[]', 'type', 'error']]);
  assert.deepStrictEqual(
    found(two, union([call, { kind: { enum: ['event', 'signal'] }, name: 'string', at: 'date' }]))
      .list,
    [['packet[1].at', 'required', 'error']],
  );
  // A branch whose values all went has nothing to compare with; one split in
  // two compares with both.
  assert.deepStrictEqual(found(two, union([call])).list, [
    ['packet', 'removed', 'error'],
    ['packet', 'removed', 'error'],
  ]);
  const split = union([
    call,
    { kind: { enum: ['event'] }, name: 'string' },
    { kind: { enum: ['signal'] }, name: 'string', x: 'number' },
  ]);
  assert.deepStrictEqual(found(two, split).list, [['packet[2].x', 'required', 'error']]);
  // The discriminator is the union's.
  const { kind: callKind, ...callRest } = call;
  const { kind: eventKind, ...eventRest } = event;
  const renamed = found(
    two,
    union(
      [
        { tag: callKind, ...callRest },
        { tag: eventKind, ...eventRest },
      ],
      'tag',
    ),
  );
  assert.deepStrictEqual(renamed.list, [['packet', 'type', 'error']]);
  assert.strictEqual(renamed.messages[0], 'The union discriminates on "tag" instead of "kind"');
});

test('Evolve: tuples and root scalars', () => {
  const pair = define({ pair: { tuple: ['string', '?number'] } });
  assert.deepStrictEqual(
    found(pair, define({ pair: { tuple: ['string', '?number', '?boolean'] } })).list,
    [],
  );
  const longer = found(pair, define({ pair: { tuple: ['string', 'number', 'boolean'] } }));
  assert.deepStrictEqual(longer.list, [
    ['pair[1]', 'required', 'error'],
    ['pair[2]', 'required', 'error'],
  ]);
  assert.strictEqual(
    longer.messages[1],
    'Element appended as required without a default: older payloads do not have it',
  );
  const shorter = found(pair, define({ pair: { tuple: ['integer'] } }));
  assert.deepStrictEqual(shorter.list, [
    ['pair[0]', 'type', 'error'],
    ['pair[1]', 'removed', 'error'],
  ]);
  assert.strictEqual(shorter.messages[1], 'Element 1 removed');
  assert.deepStrictEqual(
    found(
      define({ pair: { tuple: ['string', { tuple: ['number'] }] } }),
      define({ pair: { tuple: ['string', { tuple: ['string'] }] } }),
    ).list,
    [['pair[1][0]', 'type', 'error']],
  );
  // A root scalar keeps its own optionality.
  assert.deepStrictEqual(found(define('string'), define('?string')).list, [
    ['', 'optional', 'warning'],
  ]);
  assert.deepStrictEqual(found(define('?string'), define('string')).list, [
    ['', 'required', 'error'],
  ]);
  assert.deepStrictEqual(found(define('string'), define('integer')).messages, [
    'Type changed: string → integer',
  ]);
  assert.deepStrictEqual(found(define('string'), define({ array: 'string' })).list, [
    ['', 'type', 'error'],
  ]);
  assert.deepStrictEqual(found(define({ array: 'string' }), define({ array: 'integer' })).list, [
    ['[]', 'type', 'error'],
  ]);
});

test('Evolve: references, recursion and entities renamed', () => {
  const entities = (address, rest = {}) =>
    model({ Address: { Struct: {}, ...address }, User: { Struct: {}, home: 'Address', ...rest } });
  const one = entities({ city: 'string' });
  const two = entities({ city: 'string', zip: '?string' });
  assert.deepStrictEqual(compatible(one.User, two.User), { ok: true, problems: [] });
  // What changed in the entity is reported where it is reached, once.
  const changed = entities({ city: 'integer' }, { work: '?Address' });
  assert.deepStrictEqual(found(one.User, changed.User).list, [['home.city', 'type', 'error']]);
  const renamed = model({
    Location: { Struct: {}, city: 'string' },
    User: { Struct: {}, home: 'Location' },
  });
  const moved = found(one.User, renamed.User);
  assert.deepStrictEqual(moved.list, [['home', 'renamed', 'info']]);
  assert.strictEqual(moved.messages[0], 'Entity "Address" is now "Location"');
  assert.deepStrictEqual(compatible(one.User, renamed.User).problems[0].previous, '@Address');
  // A record that becomes an id (a stored kind), or the reverse.
  const stored = model({
    Address: { Entity: {}, city: 'string' },
    User: { Struct: {}, home: 'Address' },
  });
  assert.deepStrictEqual(found(one.User, stored.User).messages, [
    'Type changed: @Address → string',
  ]);
  assert.deepStrictEqual(found(stored.User, one.User).messages, [
    'Type changed: string → @Address',
  ]);
  // A recursion compares once per pair of plans.
  const tree = (extra) => named('Tree', { v: 'number', kids: { array: 'Tree' }, ...extra });
  assert.deepStrictEqual(compatible(tree({}), tree({ x: '?string' })), { ok: true, problems: [] });
  assert.deepStrictEqual(found(tree({}), tree({ x: 'string' })).list, [['x', 'required', 'error']]);
  // An alias (an entity whose root is a reference) stands for the entity.
  const alias = (city) =>
    model({
      Address: { Struct: {}, city },
      Home: { Struct: {}, home: 'Address' },
      Place: { type: 'Home' },
    });
  assert.deepStrictEqual(found(alias('string').Place, alias('integer').Place).list, [
    ['home.city', 'type', 'error'],
  ]);
  // A reference to a scalar entity keeps the entity's own optionality.
  const scalarEntity = (type) => model({ Name: { type }, User: { Struct: {}, name: 'Name' } });
  assert.deepStrictEqual(found(scalarEntity('string').User, scalarEntity('?string').User).list, [
    ['name', 'optional', 'warning'],
  ]);
});

test('Evolve: a field that moved is compared where it stands, a record in place is a reference', () => {
  // The inner changes of a moved field are reported too.
  const before = define({ y: { p: 'string', q: 'number' }, a: 'string', b: 'string' });
  const after = define({ a: 'string', b: 'string', y: { p: 'number', q: 'number' } });
  const moved = found(before, after);
  assert.deepStrictEqual(moved.list, [
    ['y', 'moved', 'error'],
    ['y.p', 'type', 'error'],
  ]);
  // A record written in place and one reached by a reference are the same
  // wire: the referenced schema's own form, in place.
  const { User: byRef } = model({
    Address: { Struct: {}, city: 'string' },
    User: { Struct: {}, home: 'Address' },
  });
  const inline = define({ home: { city: 'string' } });
  const referenced = found(inline, byRef);
  assert.deepStrictEqual(referenced.list, [['home', 'renamed', 'info']]);
  assert.deepStrictEqual(referenced.messages, [
    'A reference to "Address" now, written in place before',
  ]);
  assert.strictEqual(referenced.ok, true);
  const [problem] = compatible(inline, byRef).problems;
  assert.deepStrictEqual([problem.previous, problem.next], ['{city:string}', '@Address']);
  assert.deepStrictEqual(found(byRef, inline).messages, [
    'Written in place now, a reference to "Address" before',
  ]);
  // What differs inside is still a problem, and another kind a change of type.
  assert.deepStrictEqual(found(define({ home: { city: 'number' } }), byRef).list, [
    ['home', 'renamed', 'info'],
    ['home.city', 'type', 'error'],
  ]);
  assert.deepStrictEqual(found(define({ home: 'string' }), byRef).messages, [
    'Type changed: string → @Address',
  ]);
  // The branches of a union reordered: one move; two versions in mutual
  // recursion compare once per pair and end.
  const packets = (first, second) =>
    define({
      p: {
        union: [
          { Struct: {}, kind: { enum: [first] }, a: 'string' },
          { Struct: {}, kind: { enum: [second] }, a: 'string' },
        ],
        discriminator: 'kind',
      },
    });
  assert.deepStrictEqual(found(packets('x', 'y'), packets('y', 'x')).list, [
    ['p', 'moved', 'error'],
  ]);
  const mutual = (extra) =>
    model({
      A: { Struct: {}, b: '?B', ...extra },
      B: { Struct: {}, a: '?A' },
    }).A;
  assert.deepStrictEqual(found(mutual({}), mutual({ x: '?string' })).list, []);
  assert.deepStrictEqual(found(mutual({}), mutual({ x: 'string' })).list, [
    ['x', 'required', 'error'],
  ]);
});

test('Evolve: versions hashed with different fingerprints are told apart', () => {
  const narrow = define({ a: 'string' });
  const wide = define({ a: 'string' }, { fingerprint: 'fnv1a64' });
  const told = found(narrow, wide);
  assert.deepStrictEqual(told.list, [['', 'fingerprint', 'info']]);
  assert.strictEqual(told.ok, true);
  assert.deepStrictEqual(told.messages, [
    'The id is computed with fnv1a64 instead of fnv1a32: the ids of the two versions are not comparable',
  ]);
  const own = (signature) => `x${signature.length}`;
  assert.deepStrictEqual(found(narrow, define({ a: 'string' }, { fingerprint: own })).messages, [
    'The id is computed with a function of its own instead of fnv1a32: the ids of the two versions are not comparable',
  ]);
  assert.deepStrictEqual(
    found(
      define({ a: 'string' }, { fingerprint: own }),
      define({ a: 'string' }, { fingerprint: own }),
    ).list,
    [],
  );
  // Before the problems of the plans, which it does not change.
  assert.deepStrictEqual(found(narrow, define({ a: 'number' }, { fingerprint: 'fnv1a64' })).list, [
    ['', 'fingerprint', 'info'],
    ['a', 'type', 'error'],
  ]);
});

test('Evolve: a wide enum compares in its time, and its problems carry the enum once', () => {
  const values = (keep) =>
    Array.from({ length: 20000 }, (_, i) => `v${i}`).filter((_, i) => keep(i));
  const big = define({ e: { enum: values(() => true) } });
  const less = define({ e: { enum: values((i) => i % 50 !== 0) } });
  const started = performance.now();
  const { ok, problems } = compatible(big, less);
  const took = performance.now() - started;
  assert.ok(took < 1000, `${took} ms`);
  assert.strictEqual(ok, false);
  assert.strictEqual(problems.length, 400);
  assert.ok(JSON.stringify(problems).length < 2 ** 20);
  // The enum prints with the first problem of the place; a message names
  // five values and counts the rest.
  assert.match(problems[0].previous, /^enum\(v0\|v1\|/);
  assert.strictEqual(problems[1].previous, undefined);
  assert.strictEqual(problems[1].next, undefined);
  assert.match(
    problems[0].message,
    /^Enum value "v0" removed: "v1", "v2", "v3", "v4", "v5" and 19595 more move up$/,
  );
  // A struct's message likewise.
  const fields = (n, extra = {}) => ({
    ...extra,
    ...Object.fromEntries(Array.from({ length: n }, (_, i) => [`f${i}`, 'string'])),
  });
  const inserted = found(define(fields(8)), define(fields(8, { z: 'string' })));
  assert.deepStrictEqual(inserted.messages, [
    'Field "z" inserted at position 0: "f0", "f1", "f2", "f3", "f4" and 3 more move further',
  ]);
});

test('Evolve: the rules of the code, the typings and the guide are one list', () => {
  const fs = require('node:fs');
  const path = require('node:path');
  const { RULES } = require('../../src/evolve.js');
  const root = path.join(__dirname, '..', '..');
  const source = fs.readFileSync(path.join(root, 'src', 'evolve.js'), 'utf8');
  const used = new Set();
  const calls = /(?:report|once)\((?:[\w.]+|[\w.]+\([^()]*\)|`[^`]*`),\s*'(\w+)'/g;
  for (const match of source.matchAll(calls)) used.add(match[1]);
  for (const match of source.matchAll(/rule: '(\w+)'/g)) used.add(match[1]);
  assert.deepStrictEqual([...used].sort(), Object.keys(RULES).sort());
  const typings = fs.readFileSync(path.join(root, 'evolve.d.ts'), 'utf8');
  const union = typings.match(/export type Rule =([^;]+);/)[1].match(/'(\w+)'/g);
  assert.deepStrictEqual(
    union.map((quoted) => quoted.slice(1, -1)).sort(),
    Object.keys(RULES).sort(),
  );
  const guide = fs.readFileSync(path.join(root, 'docs', 'guide', 'evolution.md'), 'utf8');
  const table = Object.fromEntries(
    [...guide.matchAll(/^\| `(\w+)` \| (error|warning|info) \|/gm)].map((row) => [row[1], row[2]]),
  );
  assert.deepStrictEqual(table, { ...RULES });
});

test('Evolve: what cannot be compared', () => {
  for (const [previous, next] of [
    [1, V1],
    [V1, null],
    [{}, V2],
  ]) {
    assert.throws(() => compatible(previous, next), {
      code: 'ERR_SCHEMA_EXPECTED',
      message: 'Schema instance expected',
    });
  }
  const resolved = resolve(V1, V2);
  for (const [previous, next] of [
    [resolved, V2],
    [V1, resolved],
  ]) {
    assert.throws(() => compatible(previous, next), {
      code: 'ERR_SCHEMA_EXPECTED',
      message: 'A resolved schema is no version to compare: give its writer or its reader',
    });
  }
  assert.throws(() => compatible(V1, V2, 1), {
    code: 'ERR_INVALID_OPTIONS',
    message: 'Invalid options: expected an object',
  });
  assert.throws(() => compatible(V1, V2, { aliases: {} }), {
    code: 'ERR_INVALID_OPTIONS',
    message: 'Invalid option "aliases"',
  });
  assert.throws(() => compatible(V1, V2, { strict: 1 }), {
    code: 'ERR_INVALID_OPTIONS',
    message: 'Invalid option "strict"',
  });
  assert.deepStrictEqual(compatible(V1, V2, { strict: undefined }), { ok: true, problems: [] });
  // A chain of references too long for the stack is an error, not a RangeError.
  const chain = (extra) => {
    const entities = {};
    for (let i = 0; i < 10000; i++) {
      entities[`E${i}`] = {
        fields: { n: { type: `E${i + 1}`, one: `E${i + 1}`, required: false } },
      };
    }
    entities.E10000 = { fields: { v: { type: 'number' }, ...extra } };
    return Schema.from({ format: 1, root: 'E0', entities }, { codegen: false });
  };
  assert.throws(() => compatible(chain({}), chain({ w: { type: 'string', required: false } })), {
    code: 'ERR_INCOMPATIBLE',
    message: 'The schemas are nested too deeply to compare',
  });
  // Another error of the walk passes through as it is.
  const PLAN = Symbol.for('alexify.protoarray.plan');
  const odd = define({ a: 'string' });
  const fake = Object.create(odd);
  Object.defineProperty(fake, 'toString', { value: () => '{b:string}' });
  Object.defineProperty(fake, PLAN, {
    value: {
      kind: 'struct',
      sparse: false,
      get fields() {
        throw new TypeError('not a plan');
      },
    },
  });
  assert.throws(() => compatible(odd, fake), { message: 'not a plan' });
});

test('Evolve: a baseline writes the schemas as JSON and restore builds them again', () => {
  const schemas = model(
    {
      Address: { Struct: {}, city: 'string', zip: '?string' },
      User: { Entity: {}, name: 'string', home: 'Address', items: { array: { sku: 'string' } } },
    },
    {
      references: 'embed',
      entities: {
        Address: { intern: ['city'] },
        User: { sparse: true, layout: { items: 'columns' } },
      },
    },
  );
  const written = baseline({ User: schemas.User, Address: schemas.Address, Ping: V1 });
  const text = JSON.stringify(written);
  const parsed = JSON.parse(text);
  // One snapshot for the two entities of the model, another for V1; the names
  // sorted, so the file does not change when the exports are reordered.
  assert.strictEqual(parsed.format, 1);
  assert.strictEqual(parsed.generator, `@alexify/protoarray@${version}`);
  assert.strictEqual(parsed.snapshots.length, 2);
  assert.deepStrictEqual(Object.keys(parsed.schemas), ['Address', 'Ping', 'User']);
  assert.deepStrictEqual(parsed.schemas.User, {
    snapshot: 0,
    entity: 'User',
    options: {
      sparse: true,
      layout: { items: 'columns' },
      intern: false,
      delta: [],
      references: 'embed',
      types: {},
      fingerprint: 'fnv1a32',
      entities: {
        Address: {
          sparse: false,
          layout: 'rows',
          intern: ['city'],
          delta: [],
          references: 'embed',
          types: {},
          fingerprint: 'fnv1a32',
        },
      },
    },
    canonical: schemas.User.toString(),
    signature: schemas.User[SIGNATURE],
    id: schemas.User.id,
  });
  assert.strictEqual(parsed.schemas.Address.snapshot, 0);
  assert.deepStrictEqual(parsed.schemas.Ping, {
    snapshot: 1,
    entity: 'User',
    options: {
      sparse: false,
      layout: 'rows',
      intern: false,
      delta: [],
      references: 'kind',
      types: {},
      fingerprint: 'fnv1a32',
      entities: {},
    },
    canonical: V1.toString(),
    signature: V1.toString(),
    id: V1.id,
  });
  const restored = restore(parsed);
  assert.deepStrictEqual(Object.keys(restored), ['Address', 'Ping', 'User']);
  for (const name of Object.keys(restored)) {
    const original = { User: schemas.User, Address: schemas.Address, Ping: V1 }[name];
    assert.strictEqual(restored[name].toString(), original.toString());
    assert.strictEqual(restored[name].id, original.id);
    assert.strictEqual(restored[name].name, name);
    assert.deepStrictEqual(compatible(original, restored[name]), { ok: true, problems: [] });
  }
  // The restored schemas work: the wire is the original's.
  const user = { name: 'A', home: { city: 'K', zip: null }, items: [{ sku: 'x' }], userId: '1' };
  assert.deepStrictEqual(restored.User.encode(user), schemas.User.encode(user));
  // An anonymous schema has the entity '' of its snapshot.
  const anonymous = define({ n: 'integer' }, { delta: [] });
  const entry = baseline({ one: anonymous }).schemas.one;
  assert.strictEqual(entry.entity, '');
  assert.strictEqual(restore(baseline({ one: anonymous })).one.toString(), '{n:integer}');
  // The baseline writes the wire options of the snapshot's custom types too.
  const typed = Schema.from(
    {
      format: 1,
      root: 'T',
      types: { money: { kind: 'scalar' } },
      entities: { T: { fields: { m: { type: 'money' } } } },
    },
    { types: { money: 'number' } },
  );
  const copy = restore(baseline({ T: typed })).T;
  assert.strictEqual(copy.toString(), '{m:number}');
});

test('Evolve: a baseline with a fingerprint of its own, and what restore refuses', () => {
  const sha = (signature) => `x${signature.length}`;
  const custom = define({ a: 'string' }, { fingerprint: sha });
  const written = JSON.parse(JSON.stringify(baseline({ A: custom })));
  // A function cannot travel: null says so, and the id is recorded, not checked.
  assert.strictEqual(written.schemas.A.options.fingerprint, null);
  assert.strictEqual(written.schemas.A.id, 'x10');
  const restored = restore(written);
  assert.strictEqual(restored.A.toString(), '{a:string}');
  assert.notStrictEqual(restored.A.id, 'x10');
  // The entities a schema reaches carry theirs the same way.
  const entities = model(
    { Address: { Struct: {}, city: 'string' }, User: { Struct: {}, home: 'Address' } },
    { fingerprint: sha },
  );
  const reached = JSON.parse(JSON.stringify(baseline({ User: entities.User })));
  assert.strictEqual(reached.schemas.User.options.entities.Address.fingerprint, null);
  assert.strictEqual(restore(reached).User.toString(), '{home:@Address}');
  // The default fingerprint is named too, and the id is checked.
  const plain = JSON.parse(JSON.stringify(baseline({ A: define({ a: 'string' }) })));
  assert.strictEqual(plain.schemas.A.options.fingerprint, 'fnv1a32');
  assert.strictEqual(restore(plain).A.id, define({ a: 'string' }).id);
  const forged = (change) => {
    const copy = JSON.parse(JSON.stringify(plain));
    change(copy);
    return copy;
  };
  // What differs is named with both values, so a baseline another version
  // wrote is told from a schema that changed before anyone writes it again.
  const mismatch = (what, was, now) => ({
    code: 'ERR_INVALID_SNAPSHOT',
    message:
      `The entry "A" rebuilds to another ${what} than it was written with (written: ${was}, ` +
      `now: ${now}): another version of protoarray wrote the baseline, or it was edited; ` +
      'compare the versions before writing it again',
    schema: 'A',
  });
  assert.throws(
    () => restore(forged((copy) => (copy.schemas.A.canonical = '{a:number}'))),
    mismatch('canonical form', '{a:number}', '{a:string}'),
  );
  assert.throws(
    () => restore(forged((copy) => (copy.schemas.A.id = '00000000'))),
    mismatch('id', '00000000', plain.schemas.A.id),
  );
  assert.throws(
    () => restore(forged((copy) => (copy.schemas.A.signature = '{a:string};B={}'))),
    mismatch('signature', '{a:string};B={}', '{a:string}'),
  );
  // A long form is cut in the message.
  const wide = JSON.parse(JSON.stringify(baseline({ W: define(WIDE) })));
  assert.throws(
    () => restore(forged((copy) => (copy.schemas.A.canonical = wide.schemas.W.canonical))),
    {
      message: new RegExp(
        `written: ${wide.schemas.W.canonical.slice(0, 120).replaceAll('?', '\\?')}…, now`,
      ),
    },
  );
  // A baseline written by hand may leave the entities out.
  const bare = forged((copy) => delete copy.schemas.A.options.entities);
  assert.strictEqual(restore(bare).A.id, plain.schemas.A.id);
  // A fingerprint by a name protoarray does not know is the schema's refusal.
  assert.throws(() => restore(forged((copy) => (copy.schemas.A.options.fingerprint = 'sha1'))), {
    code: 'ERR_INVALID_OPTIONS',
  });
  for (const [source, message] of [
    [null, 'A baseline of format 1 with snapshots and schemas expected'],
    [
      { format: 2, snapshots: [], schemas: {} },
      'A baseline of format 1 with snapshots and schemas expected',
    ],
    [
      { format: 1, snapshots: {}, schemas: {} },
      'A baseline of format 1 with snapshots and schemas expected',
    ],
    [
      { format: 1, snapshots: [], schemas: [] },
      'A baseline of format 1 with snapshots and schemas expected',
    ],
    [
      { format: 1, snapshots: [], schemas: { A: 1 } },
      'The entry "A" of the baseline is incomplete',
    ],
    [
      forged((copy) => (copy.schemas.A.options.fingerprint = 1)),
      'The entry "A" of the baseline is incomplete',
    ],
    [forged((copy) => delete copy.schemas.A.id), 'The entry "A" of the baseline is incomplete'],
    [
      forged((copy) => delete copy.schemas.A.signature),
      'The entry "A" of the baseline is incomplete',
    ],
    [
      { format: 1, generator: 1, snapshots: [], schemas: {} },
      'A baseline of format 1 with snapshots and schemas expected',
    ],
    [
      forged((copy) => (copy.schemas.A.snapshot = -1)),
      'The entry "A" names no snapshot of the baseline',
    ],
    [
      forged((copy) => (copy.snapshots[0] = 'text')),
      'The snapshot 0 of the baseline is not an object',
    ],
    // Only the options of the wire travel in a baseline: anything else is no
    // option of a baseline, however the schema would take it.
    [
      forged((copy) => (copy.schemas.A.options.validate = false)),
      'The entry "A" carries an option that is not of the wire: "validate"',
    ],
    [
      forged((copy) => (copy.schemas.A.options.codegen = false)),
      'The entry "A" carries an option that is not of the wire: "codegen"',
    ],
    [
      forged((copy) => (copy.schemas.A.options.entities = [])),
      'The entry "A" carries entities that are not a record',
    ],
    [
      forged((copy) => (copy.schemas.A.options.entities = { B: 1 })),
      'The entry "A" carries no options for the entity "B"',
    ],
    [
      forged((copy) => (copy.schemas.A.options.entities = { B: { entities: {} } })),
      'The entry "A" carries an option that is not of the wire: "entities"',
    ],
  ]) {
    assert.throws(() => restore(source), { code: 'ERR_INVALID_SNAPSHOT', message });
  }
  // A key `__proto__` of the entities of a forged baseline is an own key of
  // the parsed object, refused as such; a schema named so travels.
  const proto = forged(
    (copy) => (copy.schemas.A.options.entities = JSON.parse('{"__proto__": {}}')),
  );
  assert.throws(() => restore(proto), {
    message: 'The entry "A" carries an entity named "__proto__"',
  });
  const key = '__proto__';
  const owned = JSON.parse(JSON.stringify(baseline({ [key]: define({ a: 'string' }) })));
  assert.deepStrictEqual(Object.keys(owned.schemas), [key]);
  assert.strictEqual(restore(owned)[key].toString(), '{a:string}');
  for (const [source, message] of [
    [
      forged((copy) => (copy.schemas.A.snapshot = 3)),
      'The entry "A" names no snapshot of the baseline',
    ],
  ]) {
    assert.throws(() => restore(source), { code: 'ERR_INVALID_SNAPSHOT', message });
  }
  // A snapshot that does not read, and options that do not, are the schema's errors.
  assert.throws(() => restore(forged((copy) => (copy.snapshots[0].entities = {}))), {
    code: 'ERR_INVALID_SNAPSHOT',
    message: 'The snapshot has no entity ""',
  });
  assert.throws(() => restore(forged((copy) => (copy.schemas.A.options.sparse = 1))), {
    code: 'ERR_INVALID_OPTIONS',
  });
});

test('Evolve: what baseline refuses', () => {
  assert.throws(() => baseline([V1]), {
    code: 'ERR_SCHEMA_EXPECTED',
    message: 'A record of schemas by name expected',
  });
  assert.throws(() => baseline({ A: 1 }), {
    code: 'ERR_SCHEMA_EXPECTED',
    message: '"A" is not a Schema',
  });
  for (const schema of [V1.list, resolve(V1, V2)]) {
    assert.throws(() => baseline({ A: schema }), {
      code: 'ERR_SCHEMA_EXPECTED',
      message: '"A" was not read from a snapshot: give a schema of its own',
    });
  }
  assert.deepStrictEqual(baseline({}), {
    format: 1,
    generator: `@alexify/protoarray@${version}`,
    snapshots: [],
    schemas: {},
  });
});

test('Evolve: register() installs Schema.compatible', () => {
  assert.strictEqual(Schema.compatible, undefined);
  register();
  register();
  assert.strictEqual(Schema.compatible, compatible);
  assert.strictEqual(Object.getOwnPropertyDescriptor(Schema, 'compatible').enumerable, false);
  assert.deepStrictEqual(Schema.compatible(V1, V2), { ok: true, problems: [] });
  // The metaschema module in the tests is the one injected by the support file.
  assert.strictEqual(typeof ms.Schema, 'function');
});
