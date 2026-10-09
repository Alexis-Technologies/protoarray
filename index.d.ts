/**
 * Encodes an object into a positional array described by a schema.
 *
 * Placeholder: throws until the protoarray format is implemented. The
 * signature is provisional.
 */
export function encode(schema: unknown, value: object): unknown[];

/**
 * Decodes a positional array back into an object described by a schema.
 *
 * Placeholder: throws until the protoarray format is implemented. The
 * signature is provisional.
 */
export function decode(schema: unknown, array: readonly unknown[]): object;
