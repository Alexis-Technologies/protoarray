import { expectError, expectType } from 'tsd';
import { decode, encode } from '../../index.js';

expectType<unknown[]>(encode({}, { name: 'Alex', age: 27 }));
expectType<object>(decode({}, ['Alex', 27]));
expectType<object>(decode({}, ['Alex', 27] as const));

expectError(encode({}));
expectError(encode({}, 'Alex'));
expectError(decode({}));
expectError(decode({}, { name: 'Alex' }));
