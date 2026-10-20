/**
 * Hand-written typings for @alexify/protoarray/binary: the same schema on a binary wire. The
 * bytes are a `Uint8Array`; both sides need the same schema (see Wire Format in the guide).
 */

import type { AnySchema } from './index.js';

type Value<S extends AnySchema> = Parameters<S['encode']>[0];
type Decoded<S extends AnySchema> = ReturnType<S['decode']>;

/**
 * The bytes of a value on the binary wire, a `Uint8Array` of their own. Throws `EncodeError` for
 * a value with no form (the wrong shape, `null` at the root, a union value outside the union, a
 * decimal past the safe integers), `SchemaDefinitionError` `ERR_NO_BINARY_FORM` for a schema
 * with interned strings, lists of differences, a flat or columns layout, or one from `resolve`.
 */
export function toBinary<S extends AnySchema>(schema: S, value: Value<S>): Uint8Array;

/**
 * The value of the bytes `toBinary` of the same schema gave. Throws `DecodeError` for a message
 * that is not of the schema (truncated, an index out of range, a required field missing) when
 * the schema validates, and for anything but a `Uint8Array`.
 */
export function fromBinary<S extends AnySchema>(schema: S, bytes: Uint8Array): Decoded<S>;

/** Installs `toBinary` and `fromBinary` as methods of Schema. Once per process. */
export function register(): void;

declare module './index.js' {
  interface Schema<Output, Input> {
    /** `toBinary` of `@alexify/protoarray/binary`, once its `register()` has run. */
    toBinary(value: Input): Uint8Array;
    /** `fromBinary` of `@alexify/protoarray/binary`, once its `register()` has run. */
    fromBinary(bytes: Uint8Array): Output;
  }
  interface Collection<Output, Input> {
    toBinary(value: readonly Input[]): Uint8Array;
    fromBinary(bytes: Uint8Array): Output[];
  }
}
