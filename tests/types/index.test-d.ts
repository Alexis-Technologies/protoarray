import { expectAssignable, expectError, expectNotAssignable, expectType } from 'tsd';
import {
  DecodeError,
  EncodeError,
  Schema,
  SchemaDefinitionError,
  decode,
  encode,
  parse,
  stringify,
  type Backend,
  type DecodeErrorCode,
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
expectError(Schema.from({ a: 'string' }, { layout: 'rowz' }));
expectError(Schema.from({ a: 'string' }, { unknown: true }));

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
expectType<'object'>(encodeError.code);
expectType<string>(encodeError.path);
const decodeError = new DecodeError();
expectType<DecodeErrorCode>(decodeError.code);
expectType<string>(decodeError.path);
expectType<unknown>(decodeError.cause);
expectAssignable<DecodeErrorCode>('extra');
expectNotAssignable<DecodeErrorCode>('nope');
