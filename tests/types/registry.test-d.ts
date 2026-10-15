import { expectError, expectType } from 'tsd';
import { Schema, type AnySchema } from '../../index.js';
import { SchemaRegistry, type Envelope } from '../../registry.js';

const V1 = new Schema('User', { id: 'number', fullName: 'string' });
const V2 = new Schema('User', { id: 'number', name: { type: 'string', aliases: ['fullName'] } });

const registry = new SchemaRegistry([V1, V2]);
expectType<SchemaRegistry>(registry.add(V1));
expectType<number>(registry.size);
expectType<AnySchema | undefined>(registry.get('id'));
expectType<AnySchema | undefined>(registry.find('User'));
expectType<boolean>(registry.has('id'));
expectType<Schema<typeof V2.definition>>(registry.resolve(V1.id, V2));
expectType<Envelope>(registry.encode(V1, { id: 1, fullName: 'Alex' }));
expectType<Envelope>(registry.encode(V2, { id: 1, name: 'Alex' }, { as: V1.id }));
expectType<{ id: number; name: string }>(registry.decode([V1.id, []], V2));
expectType<unknown>(registry.decode([V1.id, []]));
expectType<{ id: number; name: string }>(registry.parse('[]', V2, { strict: true }));
expectType<string>(registry.stringify(V1, { id: 1, fullName: 'Alex' }));
expectType<SchemaRegistry>(SchemaRegistry.from({}));
for (const schema of registry) expectType<AnySchema>(schema);
expectError(registry.encode(V1, { id: 'x', fullName: 'Alex' }));
expectError(registry.add({}));
expectError(registry.encode(V1, { id: 1, fullName: 'A' }, { as: 1 }));
