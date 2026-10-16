import { expectError, expectType } from 'tsd';
import { Schema as Definition } from '@alexify/metaschema';
import { Schema } from '../../index.js';
import { register, toSource, type StandaloneSchema } from '../../standalone.js';

const User = Schema.from(Definition.from({ id: 'integer' }));
expectType<string>(toSource(User));
expectType<string>(toSource({ User }, { runtime: 'inline', format: 'esm' }));
expectError(toSource(User, { runtime: 'remote' }));
expectError(toSource({ User: 1 }));
expectType<void>(register());
expectType<string>(User.toSource({ format: 'cjs' }));
declare const copy: StandaloneSchema;
expectType<'standalone'>(copy.backend);
expectType<string>(copy.stringify({}));
expectError(copy.check({}));
