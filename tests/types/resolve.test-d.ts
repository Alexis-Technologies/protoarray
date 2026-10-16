import { expectError, expectType } from 'tsd';
import { Schema as Definition } from '@alexify/metaschema';
import { Schema } from '../../index.js';
import { register, resolve } from '../../resolve.js';

const V1 = Schema.from(new Definition('User', { id: 'number', fullName: 'string' }));
const V2 = Schema.from(new Definition('User', { id: 'number', name: 'string' }));

expectType<typeof V2>(resolve(V1, V2));
expectType<typeof V2>(resolve(V1, V2, { aliases: { name: 'fullName' } }));
expectType<typeof V2>(resolve(V1, V2, { aliases: { name: ['fullName', 'full'] } }));
expectError(resolve(V1, V2, { aliases: { name: 1 } }));
expectError(resolve(V1, V2, { strict: true }));
expectType<void>(register());
expectType<typeof V2>(Schema.resolve(V1, V2));
expectType<{ id: number; name: string }>(resolve(V1, V2).decode([1, 'Alex']));
