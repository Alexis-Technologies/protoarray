/**
 * Hand-written typings for @alexify/protoarray/stream: NDJSON, TransformStreams and the items
 * of a large JSON array, a piece at a time. `ReadableStream` and `TransformStream` are the
 * platform's: a project compiles these typings with the DOM library or `@types/node`.
 */

import type { AnySchema, Collection, DecodeOptions } from './index.js';

/** A piece of text: a string, or UTF-8 bytes. */
export type Chunk = string | Uint8Array;

/** Where text comes from: all of it, as text or bytes, or chunks, in any order of arrival. */
export type Source =
  | string
  | Uint8Array
  | Iterable<Chunk>
  | AsyncIterable<Chunk>
  | ReadableStream<Chunk>;

export interface StreamOptions extends DecodeOptions {
  /**
   * The longest line (NDJSON) or item (a large array) a parser holds, in characters: a longer
   * one is a `DecodeError` `structure` at its index. 16 MiB by default; `Infinity` is the
   * longest string the engine builds.
   */
  readonly maxLength?: number;
}

type Value<S extends AnySchema> = Parameters<S['encode']>[0];
type Decoded<S extends AnySchema> = ReturnType<S['decode']>;
type Item<S extends AnySchema> = Value<S> extends readonly (infer T)[] ? T : never;
type DecodedItem<S extends AnySchema> = Decoded<S> extends readonly (infer T)[] ? T : never;

/** One line of NDJSON per value, `\n` included; an async iterable gives an async generator. */
export function stringifyLines<S extends AnySchema>(
  schema: S,
  values: AsyncIterable<Value<S>>,
): AsyncGenerator<string, void, undefined>;
export function stringifyLines<S extends AnySchema>(
  schema: S,
  values: Iterable<Value<S>>,
): Generator<string, void, undefined>;

/** The values of NDJSON text; an error names the value's index (`[3].name`). */
export function parseLines<S extends AnySchema>(
  schema: S,
  source: Source,
  options?: StreamOptions,
): AsyncGenerator<Decoded<S>, void, undefined>;

/** Values in, NDJSON lines out. */
export function stringifyStream<S extends AnySchema>(schema: S): TransformStream<Value<S>, string>;

/** NDJSON text or bytes in, values out. */
export function parseStream<S extends AnySchema>(
  schema: S,
  options?: StreamOptions,
): TransformStream<Chunk, Decoded<S>>;

/** The JSON array of a collection (rows or flat), a piece per item. */
export function stringifyItems<S extends AnySchema>(
  collection: S,
  values: AsyncIterable<Item<S>>,
): AsyncGenerator<string, void, undefined>;
export function stringifyItems<S extends AnySchema>(
  collection: S,
  values: Iterable<Item<S>>,
): Generator<string, void, undefined>;

/** The items of a collection's JSON array (rows or flat), decoded while the text arrives. */
export function parseItems<S extends AnySchema>(
  collection: S,
  source: Source,
  options?: StreamOptions,
): AsyncGenerator<DecodedItem<S>, void, undefined>;

/** Installs the functions above as methods of Schema. Once per process. */
export function register(): void;

type ItemOf<T> = T extends readonly (infer U)[] ? U : never;

declare module './index.js' {
  interface Schema<Output, Input> {
    stringifyLines(values: AsyncIterable<Input>): AsyncGenerator<string, void, undefined>;
    stringifyLines(values: Iterable<Input>): Generator<string, void, undefined>;
    parseLines(source: Source, options?: StreamOptions): AsyncGenerator<Output, void, undefined>;
    stringifyStream(): TransformStream<Input, string>;
    parseStream(options?: StreamOptions): TransformStream<Chunk, Output>;
    stringifyItems(values: AsyncIterable<ItemOf<Input>>): AsyncGenerator<string, void, undefined>;
    stringifyItems(values: Iterable<ItemOf<Input>>): Generator<string, void, undefined>;
    parseItems(
      source: Source,
      options?: StreamOptions,
    ): AsyncGenerator<ItemOf<Output>, void, undefined>;
  }
  interface Collection<Output, Input> {
    stringifyItems(values: AsyncIterable<Input>): AsyncGenerator<string, void, undefined>;
    stringifyItems(values: Iterable<Input>): Generator<string, void, undefined>;
    parseItems(source: Source, options?: StreamOptions): AsyncGenerator<Output, void, undefined>;
  }
}
