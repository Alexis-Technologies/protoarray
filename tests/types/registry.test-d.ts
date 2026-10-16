import { expectError, expectType } from 'tsd';
import { Schema as Definition, Model } from '@alexify/metaschema';
import { Schema, type AnySchema } from '../../index.js';
import { SchemaRegistry, type Envelope } from '../../registry.js';

const V1 = Schema.from(new Definition('User', { id: 'number', fullName: 'string' }));
const V2 = Schema.from(
  new Definition('User', { id: 'number', name: { type: 'string', aliases: ['fullName'] } }),
);

const registry = new SchemaRegistry([V1, V2]);
expectType<SchemaRegistry>(registry.add(V1));
expectType<number>(registry.size);
expectType<AnySchema | undefined>(registry.get('id'));
expectType<AnySchema | undefined>(registry.find('User'));
expectType<boolean>(registry.has('id'));
expectType<typeof V2>(registry.resolve(V1.id, V2));
expectType<Envelope>(registry.encode(V1, { id: 1, fullName: 'Alex' }));
expectType<Envelope>(registry.encode(V2, { id: 1, name: 'Alex' }, { as: V1.id }));
expectType<{ id: number; name: string }>(registry.decode([V1.id, []], V2));
expectType<unknown>(registry.decode([V1.id, []]));
expectType<{ id: number; name: string }>(registry.parse('[]', V2, { strict: true }));
expectType<string>(registry.stringify(V1, { id: 1, fullName: 'Alex' }));
const model = new Model({}, new Map([['User', { Struct: {}, id: 'number' }]]));
expectType<SchemaRegistry>(SchemaRegistry.from(model));
expectType<SchemaRegistry>(SchemaRegistry.from(model.toJSON() as never, { validate: false }));
for (const schema of registry) expectType<AnySchema>(schema);
expectError(registry.encode(V1, { id: 'x', fullName: 'Alex' }));
expectError(registry.add({}));
expectError(registry.encode(V1, { id: 1, fullName: 'A' }, { as: 1 }));
expectError(SchemaRegistry.from(model, { sparse: true }));
