import { expectError, expectType } from 'tsd';
import { Schema as Definition } from '@alexify/metaschema';
import { Schema, encodeEach, decodeEach } from '../../index.js';
import {
  parseItems,
  parseLines,
  parseStream,
  register,
  stringifyItems,
  stringifyLines,
  stringifyStream,
} from '../../stream.js';

const User = Schema.from(Definition.from({ id: 'number', name: '?string' }));
type User = { id: number; name: string | null };
declare const asyncUsers: AsyncIterable<{ id: number }>;

expectType<Generator<unknown, void, undefined>>(User.encodeEach([{ id: 1 }]));
expectType<AsyncGenerator<unknown, void, undefined>>(User.encodeEach(asyncUsers));
expectType<Generator<User, void, undefined>>(User.decodeEach([[1]], { strict: true }));
expectType<Generator<unknown, void, undefined>>(encodeEach(User, [{ id: 1 }]));
expectType<AsyncGenerator<User, void, undefined>>(decodeEach(User, asyncUsers));
expectError(User.encodeEach([{ id: 'x' }]));

expectType<Generator<string, void, undefined>>(stringifyLines(User, [{ id: 1 }]));
expectType<AsyncGenerator<string, void, undefined>>(stringifyLines(User, asyncUsers));
expectType<AsyncGenerator<User, void, undefined>>(parseLines(User, '[1]\n'));
expectType<AsyncGenerator<User, void, undefined>>(parseLines(User, [new Uint8Array(1), 'x']));
expectType<TransformStream<{ id: number; name?: string | null }, string>>(stringifyStream(User));
expectType<TransformStream<string | Uint8Array, User>>(parseStream(User, { strict: true }));
expectType<Generator<string, void, undefined>>(stringifyItems(User.list, [{ id: 1 }]));
expectType<AsyncGenerator<User, void, undefined>>(parseItems(User.list, '[[1]]'));
expectError(parseLines(User, 1));
expectType<void>(register());
expectType<AsyncGenerator<User, void, undefined>>(User.parseLines('[1]'));
expectType<AsyncGenerator<User, void, undefined>>(User.parseLines('[1]', { maxLength: 1024 }));
expectType<AsyncGenerator<User, void, undefined>>(parseLines(User, new Uint8Array(1)));
expectType<AsyncGenerator<User, void, undefined>>(User.list.parseItems('[[1]]'));
expectType<Generator<string, void, undefined>>(User.list.stringifyItems([{ id: 1 }]));
expectType<AsyncGenerator<string, void, undefined>>(User.stringifyLines(asyncUsers));
expectType<TransformStream<string | Uint8Array, User>>(User.parseStream({ maxLength: 10 }));
expectError(parseItems(User.list, '[]', { maxLength: '10' }));
expectError(User.list.stringifyItems([{ id: 'x' }]));
