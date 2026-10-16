import { expectAssignable, expectError, expectNotAssignable, expectType } from 'tsd';
import { Schema as Definition, Model } from '@alexify/metaschema';
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
  type Decoded,
  type DecodeErrorCode,
  type EncodeErrorCode,
  type InputOf,
  type OutputOf,
  type SchemaErrorCode,
  type Snapshot,
} from '../../index.js';

const Address = Definition.from({ city: 'string', zip: '?string' });

const UserDefinition = Definition.from({
  id: 'integer',
  name: 'string',
  active: 'boolean',
  role: { enum: ['admin', 'editor', 'viewer'] },
  address: Address,
  tags: { array: 'string' },
  orders: { array: { sku: 'string', qty: '?number' } },
  createdAt: 'date',
  seen: { set: 'string' },
  scores: { map: { string: 'number' } },
  avatar: '?bytes',
  big: 'bigint',
  payload: 'json',
  pair: ['number', '?string'],
  'nick?': 'string',
  email: '?string',
});

// The types of a schema come from metaschema's, read by their shape.
const User = Schema.from(UserDefinition);
expectType<Schema<OutputOf<typeof UserDefinition>, InputOf<typeof UserDefinition>>>(User);

const decoded = User.decode(['x']);
expectType<number>(decoded.id);
expectType<string>(decoded.name);
expectType<boolean>(decoded.active);
expectType<'admin' | 'editor' | 'viewer'>(decoded.role);
expectAssignable<{ city: string; zip: string | null }>(decoded.address);
expectType<string[]>(decoded.tags);
expectAssignable<{ sku: string; qty: number | null }[]>(decoded.orders);
expectType<Date>(decoded.createdAt);
expectType<Set<string>>(decoded.seen);
expectType<Map<string, number>>(decoded.scores);
expectType<Uint8Array | null>(decoded.avatar);
expectType<bigint>(decoded.big);
// A key that may be missing on the wire decodes as null: every key is present.
expectType<string | null>(decoded.nick);
expectType<string | null>(decoded.email);
expectAssignable<[number, string | null]>(decoded.pair);
expectType<typeof decoded>(User.parse('[]'));

// Encoding takes what metaschema's input type takes.
expectType<unknown>(User.encode({ ...decoded, nick: undefined }));
expectError(User.encode({ id: 'x' }));
expectType<string>(User.stringify({ ...decoded }));

// What decode gives for a value type: optional keys present and nullable.
expectType<{ a: number; b: string | null }>({} as Decoded<{ a: number; b?: string }>);
expectType<Map<string, { c: Date | null }>>({} as Decoded<Map<string, { c?: Date }>>);
expectType<{ t: [number, string | null] }>({} as Decoded<{ t: [number, string?] }>);
expectType<Uint8Array>({} as Decoded<Uint8Array>);

// A snapshot, a Model's entity or a definition with metaschema injected: typed on request.
declare const snapshot: Snapshot;
expectType<Schema<unknown, unknown>>(Schema.from(snapshot));
expectType<Schema<{ id: number }, { id: number }>>(Schema.from<{ id: number }>(snapshot));
expectType<Schema<unknown, unknown>>(
  Schema.from({ id: 'number' }, { metaschema: { Schema: Definition } }),
);
const model = new Model({}, new Map([['A', { Struct: {}, a: 'number' }]]));
expectType<Readonly<Record<string, Schema>>>(Schema.fromModel(model, { codegen: false }));
expectError(Schema.fromModel(model, { sparse: true }));
// A schema built again with other options keeps its types.
expectType<typeof User>(Schema.from(User, { sparse: true }));

expectType<string>(User.name);
expectType<Snapshot | null>(User.snapshot);
expectType<unknown>(User.source);
expectType<readonly string[]>(User.keys);
expectType<Backend>(User.backend);
expectType<string>(User.id);
expectType<string>(User.toString());
expectType<(typeof decoded)[]>(User.list.decode([]));
expectType<'dense' | 'sparse' | 'rows' | 'flat' | 'columns'>(User.layout);

// Options: paths for the places they shape.
Schema.from(UserDefinition, {
  codegen: false,
  validate: true,
  sparse: ['address'],
  layout: { orders: 'columns' },
  intern: ['tags[]'],
  delta: ['orders[].qty'],
  stringify: 'builder',
  fingerprint: (canonical) => canonical,
  references: 'embed',
  types: { money: 'number' },
  entity: 'User',
  entities: { Address: { sparse: true } },
});
expectError(Schema.from(UserDefinition, { validate: 'both' }));
expectError(Schema.from(UserDefinition, { intern: 'tags' }));
expectError(Schema.from(UserDefinition, { types: { money: 'float' } }));
expectError(Schema.from(UserDefinition, { schemas: {} }));

// The free functions follow the schema's methods.
expectType<unknown>(encode(User, decoded));
expectType<typeof decoded>(decode(User, []));
expectType<string>(stringify(User, decoded));
expectType<typeof decoded>(parse(User, '[]'));
expectError(encode(User, { id: 'x' }));

// Errors.
declare const definitionError: SchemaDefinitionError;
expectType<SchemaErrorCode>(definitionError.code);
expectType<string>(definitionError.field);
expectAssignable<SchemaErrorCode>('ERR_INVALID_SNAPSHOT');
expectAssignable<SchemaErrorCode>('ERR_COMPILED_MISMATCH');
expectAssignable<SchemaErrorCode>('ERR_ID_COLLISION');
declare const encodeError: EncodeError;
expectType<EncodeErrorCode>(encodeError.code);
expectNotAssignable<EncodeErrorCode>('required');
expectNotAssignable<EncodeErrorCode>('enum');
declare const decodeError: DecodeError;
expectType<DecodeErrorCode>(decodeError.code);
expectType<unknown>(decodeError.cause);
expectAssignable<Backend>('standalone');
