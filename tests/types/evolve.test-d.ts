import { expectError, expectType } from 'tsd';
import { Schema as Definition } from '@alexify/metaschema';
import { Schema } from '../../index.js';
import {
  baseline,
  compatible,
  register,
  restore,
  type Baseline,
  type Compatibility,
  type Problem,
  type Rule,
  type Severity,
} from '../../evolve.js';

const V1 = Schema.from(new Definition('User', { id: 'number', fullName: 'string' }));
const V2 = Schema.from(new Definition('User', { id: 'number', name: 'string' }));

expectType<Compatibility>(compatible(V1, V2));
expectType<Compatibility>(compatible(V1, V2, { strict: true }));
expectType<boolean>(compatible(V1, V2).ok);
expectType<readonly Problem[]>(compatible(V1, V2).problems);
expectError(compatible(V1, V2, { aliases: {} }));
expectError(compatible(V1, 1));
declare const problem: Problem;
expectType<Rule>(problem.rule);
expectType<Severity>(problem.severity);
expectType<string | undefined>(problem.previous);
expectType<string>(problem.path);

const written = baseline({ V1, V2 });
expectType<Baseline>(written);
expectType<1>(written.format);
expectType<number>(written.schemas.V1.snapshot);
expectType<string | null | undefined>(written.schemas.V1.options.fingerprint);
expectType<string>(written.schemas.V1.signature);
expectType<string | undefined>(written.generator);
expectError(baseline(V1));
expectError(baseline({ V1: 1 }));
expectType<Readonly<Record<string, Schema>>>(restore(written));
// What JSON.parse gives: checked at runtime, so anything is taken.
expectType<Readonly<Record<string, Schema>>>(restore(JSON.parse('{}') as unknown));
expectType<unknown>(restore(written).V1.decode([1]));
expectType<void>(register());
expectType<Compatibility>(Schema.compatible(V1, V2));
