import { expectAssignable, expectError, expectNotAssignable, expectType } from 'tsd';
import {
  DecodeError,
  EncodeError,
  Schema,
  SchemaDefinitionError,
  check,
  decode,
  encode,
  parse,
  stringify,
  type Backend,
  type DecodeErrorCode,
  type EncodeErrorCode,
  type Infer,
  type Input,
  type SchemaErrorCode,
} from '../../index.js';

const Address = Schema.from({ city: 'string', zip: '?string' });

const User = new Schema('User', {
  id: 'number',
  name: 'string',
  active: 'boolean',
  role: { enum: ['admin', 'editor', 'viewer'] },
  address: Address,
  tags: { array: 'string' },
  orders: { array: { sku: 'string', qty: '?number' } },
  createdAt: 'date',
  perms: { flags: ['read', 'write'] },
  balance: { type: 'number', default: 0 },
  big: 'bigint',
  payload: 'json',
  pair: ['number', '?string'],
  manager: '?User',
  'nick?': 'string',
  email: '?string',
  computed: (record: unknown) => record,
});

type Decoded = Infer<typeof User.definition>;

const decoded = User.decode(['x']);
expectType<Decoded>(decoded);
expectType<number>(decoded.id);
expectType<string>(decoded.name);
expectType<boolean>(decoded.active);
expectType<'admin' | 'editor' | 'viewer'>(decoded.role);
expectType<{ city: string; zip: string | null }>(decoded.address);
expectType<string[]>(decoded.tags);
expectType<{ sku: string; qty: number | null }[]>(decoded.orders);
expectType<Date>(decoded.createdAt);
expectType<{ read: boolean; write: boolean }>(decoded.perms);
expectType<number | null>(decoded.balance);
expectType<bigint>(decoded.big);
expectType<unknown>(decoded.payload);
expectType<[number, string | null]>(decoded.pair);
expectType<unknown>(decoded.manager);
expectType<string | null>(decoded.nick);
expectType<string | null>(decoded.email);
expectError(decoded.computed);

// Encoding accepts optional fields left out or set to null, never a wrong type.
const input: Input<typeof User.definition> = {
  id: 1,
  name: 'Alex',
  active: true,
  role: 'editor',
  address: { city: 'Kyiv' },
  tags: [],
  orders: [{ sku: 'A' }],
  createdAt: new Date(),
  perms: { read: true },
  big: 1n,
  payload: { any: 1 },
  pair: [1, null],
  nick: null,
};
expectType<unknown[]>(User.encode(input));
expectType<string>(User.stringify(input));
expectType<Decoded>(User.parse('[]'));
expectType<Decoded>(User.parse('[]', { strict: true }));
expectError(User.encode({ ...input, id: 'x' }));
expectError(User.encode({ name: 'Alex' }));
expectError(User.decode('x'));
expectError(User.decode([1], { strict: 'yes' }));

expectAssignable<Input<typeof Address.definition>>({ city: 'Kyiv' });
expectAssignable<Input<typeof Address.definition>>({ city: 'Kyiv', zip: undefined });
expectNotAssignable<Input<typeof Address.definition>>({ zip: '01001' });

// Metadata.
expectType<string>(User.name);
expectType<readonly string[]>(User.keys);
expectType<Backend>(User.backend);
expectType<'dense' | 'sparse' | 'rows' | 'flat' | 'columns'>(User.layout);
expectType<string>(User.id);
expectType<string>(User.toString());
expectType<Decoded[]>(User.list.decode([]));
expectType<unknown[]>(User.list.encode([input]));
expectType<Decoded[]>(decode(User.list, []));
expectType<unknown[]>(encode(User.list, [input]));
expectError(User.list.encode([{ name: 'x' }]));

// Collections, tuples, scalars and keys-only schemas at the root.
const Users = Schema.from({ array: User }, { layout: 'columns' });
expectType<Decoded[]>(Users.decode([]));
const Point = Schema.from(['number', 'number']);
expectType<[number, number]>(Point.decode([1, 2]));
const Text = Schema.from('?string');
expectType<string | null>(Text.decode('x'));
expectType<unknown>(Text.encode('x'));
const Keys = Schema.keys(['x', 'y']);
expectType<{ x: unknown; y: unknown }>(Keys.decode([]));

// Options.
Schema.from(
  { a: 'string' },
  { codegen: false, validate: false, sparse: true, schemas: { Address } },
);
Schema.from({ a: 'string' }, { fingerprint: (canonical: string) => canonical.toUpperCase() });
Schema.from({ a: 'string' }, { validate: 'both' });
Schema.from({ a: 'string' }, { validate: 'encode' });
Schema.from({ a: 'string' }, { validate: 'decode' });
Schema.from({ a: 'string' }, { validate: true });
expectError(Schema.from({ a: 'string' }, { validate: 'nope' }));
expectError(Schema.from({ a: 'string' }, { layout: 'rowz' }));
expectError(Schema.from({ a: 'string' }, { unknown: true }));
expectError(Schema.from({ a: 'string' }, { fingerprint: 'sha256' }));

// Functional entry points mirror the methods.
expectType<unknown[]>(encode(User, input));
expectType<Decoded>(decode(User, []));
expectType<Decoded>(decode(User, [], { strict: true }));
expectType<string>(stringify(User, input));
expectType<Decoded>(parse(User, '[]'));
expectError(encode({ id: 'number' }, {}));
expectError(decode(User));

// Errors.
const definitionError = new SchemaDefinitionError();
expectType<SchemaErrorCode>(definitionError.code);
expectType<string>(definitionError.schema);
expectType<string>(definitionError.field);
expectAssignable<TypeError>(definitionError);
const encodeError = new EncodeError();
expectType<EncodeErrorCode>(encodeError.code);
expectAssignable<EncodeErrorCode>('required');
expectAssignable<EncodeErrorCode>('depth');
expectNotAssignable<EncodeErrorCode>('extra');
expectType<string>(encodeError.path);
expectType<string>(encodeError.schema);
const decodeError = new DecodeError();
expectType<DecodeErrorCode>(decodeError.code);
expectType<string>(decodeError.path);
expectType<string>(decodeError.schema);
expectType<unknown>(decodeError.cause);
expectAssignable<DecodeErrorCode>('extra');
expectNotAssignable<DecodeErrorCode>('nope');

// Unions: decoded values narrow on the discriminator; a kind key has no position.
const Packet = Schema.from({
  union: [
    { Struct: {}, type: { enum: ['call'] }, id: 'string', args: '?json' },
    { Struct: {}, type: { enum: ['event', 'notice'] }, name: 'string' },
  ],
  discriminator: 'type',
});
const packet = Packet.decode([0, '1']);
expectType<
  { type: 'call'; id: string; args: unknown } | { type: 'event' | 'notice'; name: string }
>(packet);
if (packet.type === 'call') expectType<string>(packet.id);
else expectType<string>(packet.name);
Packet.encode({ type: 'call', id: '1' });
Packet.encode({ type: 'notice', name: 'n' });
expectError(Packet.encode({ type: 'call', name: 'n' }));
expectError(Packet.encode({ type: 'other', id: '1' }));
expectType<
  ({ type: 'call'; id: string; args: unknown } | { type: 'event' | 'notice'; name: string })[]
>(Packet.list.decode([]));
const Holder = Schema.from({
  p: { union: [{ k: { enum: ['a'] }, x: 'number' }], discriminator: 'k', required: false },
});
expectType<{ p: { k: 'a'; x: number } | null }>(Holder.decode([]));
const Kinded = Schema.from({ Entity: {}, a: 'number' });
expectType<{ a: number }>(Kinded.decode([1]));
expectAssignable<EncodeErrorCode>('union');
expectAssignable<DecodeErrorCode>('union');
expectAssignable<SchemaErrorCode>('ERR_INVALID_UNION');

// check returns the error encode would throw, or null.
expectType<EncodeError | null>(User.check({}));
expectType<EncodeError | null>(User.list.check([{}]));
expectType<EncodeError | null>(check(User, 5));
expectType<EncodeError | null>(check(User.list, []));
expectError(check({ id: 'number' }, {}));

// Decimals are numbers.
const Price = Schema.from({ price: { type: 'number', decimals: 2 } });
expectType<{ price: number }>(Price.decode([1999]));

// Bytes are a Uint8Array in and out; a Buffer is one too.
const Blob = Schema.from({ data: 'bytes', thumb: '?bytes' });
expectType<{ data: Uint8Array; thumb: Uint8Array | null }>(Blob.decode([]));
Blob.encode({ data: new Uint8Array(2) });
expectError(Blob.encode({ data: [1, 2] }));

// Decimals are numbers in; a subclass of Uint8Array (a Buffer) is a byte
// array; a branch given as a schema infers like an inline one, a branch by
// name is unknown.
expectAssignable<Input<typeof Price.definition>>({ price: 19.99 });
expectError(Price.encode({ price: '19.99' }));
class Bytes extends Uint8Array {}
Blob.encode({ data: new Bytes(1) });
const CallSchema = Schema.from({ Struct: {}, type: { enum: ['call'] }, id: 'string' });
const Mixed = Schema.from({
  union: [CallSchema, { Struct: {}, type: { enum: ['event'] }, name: 'string' }],
  discriminator: 'type',
});
expectType<{ type: 'call'; id: string } | { type: 'event'; name: string }>(Mixed.decode([0, '1']));
const ByName = Schema.from(
  {
    union: ['Call', { Struct: {}, type: { enum: ['event'] }, name: 'string' }],
    discriminator: 'type',
  },
  { schemas: { Call: CallSchema } },
);
expectType<unknown>(ByName.decode([0, '1']));

// The rest of metaschema's DSL: integer, any, unknown, null, sets, maps,
// object dictionaries and tuples of any elements.
const Wide = Schema.from({
  n: 'integer',
  a: 'any',
  u: 'unknown',
  z: 'null',
  tags: { set: 'string' },
  seen: { map: { string: 'date' } },
  scores: { type: 'map', key: 'number', value: '?string' },
  prices: { object: { string: 'number' } },
  long: { type: 'object', key: 'string', value: 'bigint' },
  list: { type: 'array', value: 'integer' },
  ids: { type: 'set', value: 'number', required: false },
  hit: [{ at: 'date' }, { x: 'number', y: '?number' }, { 'label?': 'string' }, { array: 'number' }],
  pair: { tuple: ['number', 'string'] },
  nested: { schema: { k: 'string' } },
});
const wide = Wide.decode([]);
expectType<number>(wide.n);
expectType<unknown>(wide.a);
expectType<unknown>(wide.u);
expectType<null>(wide.z);
expectType<Set<string>>(wide.tags);
expectType<Map<string, Date>>(wide.seen);
expectType<Map<number, string | null>>(wide.scores);
expectType<Record<string, number>>(wide.prices);
expectType<Record<string, bigint>>(wide.long);
expectType<number[]>(wide.list);
expectType<Set<number> | null>(wide.ids);
expectType<[Date, { x: number; y: number | null }, string | null, number[]]>(wide.hit);
expectType<[number, string]>(wide.pair);
expectType<{ k: string }>(wide.nested);
const wideInput: Input<typeof Wide.definition> = {
  n: 1,
  tags: ['a'],
  seen: new Map([['k', new Date()]]),
  scores: new Map([[1, null]]),
  prices: { tea: 1 },
  long: {},
  list: [],
  hit: [new Date(), { x: 1 }, null, []],
  pair: [1, 'x'],
  nested: { k: 'x' },
};
expectAssignable<Input<typeof Wide.definition>>({ ...wideInput, tags: new Set(['a']) });
expectError(Wide.encode({ ...wideInput, seen: { k: new Date() } }));
expectError(Wide.encode({ ...wideInput, prices: { tea: 'x' } }));

// Schema.resolve: typed as the reader.
const V1 = Schema.from({ id: 'number', fullName: 'string' });
const V2 = Schema.from({ id: 'number', name: { type: 'string', aliases: ['fullName'] } });
const Resolved = Schema.resolve(V1, V2, { aliases: { name: 'fullName', 'a.b': ['c', 'd'] } });
expectType<{ id: number; name: string }>(Resolved.decode([]));
expectType<unknown[]>(Resolved.encode({ id: 1, name: 'x' }));
expectError(Resolved.encode({ id: 1, fullName: 'x' }));
expectError(Schema.resolve(V1, V2, { aliases: { name: 1 } }));
expectError(Schema.resolve(V1, { id: 'number' }));
Schema.from({
  list: { array: 'number', aliases: ['items'] },
  role: { enum: ['a'], aliases: ['r'] },
});
expectAssignable<SchemaErrorCode>('ERR_INCOMPATIBLE');

// delta and intern.
const Compact = Schema.from(
  {
    ids: { array: 'integer', delta: true },
    at: { type: 'array', value: 'date', delta: true },
    id: { type: 'integer', delta: true },
    city: { type: 'string', intern: true },
    name: { type: 'string', intern: false },
  },
  { intern: true },
);
const compact = Compact.decode([]);
expectType<number[]>(compact.ids);
expectType<Date[]>(compact.at);
expectType<number>(compact.id);
expectType<string>(compact.city);
expectError(Schema.from({ a: 'string' }, { intern: 'yes' }));
