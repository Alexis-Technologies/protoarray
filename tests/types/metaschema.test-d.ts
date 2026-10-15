import { expectError, expectType } from 'tsd';
import type { AnySchema } from '../../index.js';
import type { SchemaRegistry } from '../../registry.js';
import { fromMetaschema, fromModel, register, types, type CustomType } from '../../metaschema.js';

declare const source: object;
expectType<AnySchema>(fromMetaschema(source, { codegen: false }));
expectType<SchemaRegistry>(fromModel(source));
expectType<CustomType>(types.bytes);
expectType<CustomType>(types.flags);
expectType<void>(register());
expectError(fromMetaschema(source, { layout: 'nope' }));
