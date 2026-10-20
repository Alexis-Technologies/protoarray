import { expectError, expectType } from 'tsd';
import { Schema as Definition } from '@alexify/metaschema';
import { Schema } from '../../index.js';
import { fromBinary, register, toBinary } from '../../binary.js';

const User = Schema.from(Definition.from({ id: 'number', name: '?string' }));
type User = { id: number; name: string | null };

expectType<Uint8Array>(toBinary(User, { id: 1 }));
expectType<User>(fromBinary(User, new Uint8Array(1)));
expectError(toBinary(User, { id: 'x' }));
expectError(fromBinary(User, 'text'));
expectType<Uint8Array>(toBinary(User.list, [{ id: 1 }]));
expectType<User[]>(fromBinary(User.list, new Uint8Array(1)));
expectError(toBinary(User.list, [{ id: 'x' }]));

expectType<void>(register());
expectType<Uint8Array>(User.toBinary({ id: 1, name: null }));
expectType<User>(User.fromBinary(new Uint8Array(1)));
expectError(User.toBinary({ id: 'x' }));
expectType<Uint8Array>(User.list.toBinary([{ id: 1 }]));
expectType<User[]>(User.list.fromBinary(new Uint8Array(1)));

const Untyped = Schema.from({
  format: 1,
  root: 'A',
  entities: { A: { kind: 'struct', fields: {} } },
});
expectType<Uint8Array>(toBinary(Untyped, { anything: true }));
expectType<unknown>(fromBinary(Untyped, new Uint8Array(1)));
