/**
 * Hand-written typings for @alexify/protoarray/evolve: whether a newer version of a schema keeps
 * the wire of an older one, and a baseline of schemas a CI job checks the module against.
 */

import type { AnySchema, Layout, Schema, Snapshot, WireType } from './index.js';

/**
 * How bad a problem is: an `error` breaks the wire, a `warning` is survived by older peers but
 * must be minded when deploying, `info` changes nothing on the wire.
 */
export type Severity = 'error' | 'warning' | 'info';

/** The rule a problem breaks (see the evolution guide, "Checking it in CI"). */
export type Rule =
  | 'inserted'
  | 'moved'
  | 'removed'
  | 'renamed'
  | 'required'
  | 'retired'
  | 'type'
  | 'optional'
  | 'appended'
  | 'wire'
  | 'flat'
  | 'default'
  | 'fingerprint';

export interface Problem {
  /** The place, as the errors spell it (`address.city`, `orders[].sku`, `''` for the root). */
  readonly path: string;
  readonly rule: Rule;
  readonly severity: Severity;
  readonly message: string;
  /**
   * The canonical form of the node in the previous version, where there is one; for the values
   * of an enum, the names of flags or the values of a union, with the first problem of the place
   * only (every problem of a wide enum would otherwise carry the whole enum).
   */
  readonly previous?: string;
  /** The canonical form of the node in the next version, where there is one, likewise. */
  readonly next?: string;
}

export interface Compatibility {
  /** No problem is an error (with `strict`, none is a warning either). */
  readonly ok: boolean;
  readonly problems: readonly Problem[];
}

export interface CompatibleOptions {
  /** A warning fails the check too. */
  readonly strict?: boolean;
}

/** The options a baseline carries: the ones that shape the wire and the canonical form. */
export interface BaselineOptions {
  readonly sparse: boolean | readonly string[];
  readonly layout: Layout | Readonly<Record<string, Layout>>;
  readonly intern: boolean | readonly string[];
  readonly delta: readonly string[];
  readonly references: 'kind' | 'embed' | 'id';
  readonly types: Readonly<Record<string, WireType>>;
  /**
   * The name of a built-in fingerprint; `null` for a function of your own, which a baseline
   * cannot carry: the id is then recorded, not checked.
   */
  readonly fingerprint?: string | null;
  /** The options of the entities the schema reaches, by name. */
  readonly entities?: Readonly<Record<string, Omit<BaselineOptions, 'entities'>>>;
}

export interface BaselineEntry {
  /** The index of the schema's snapshot in `snapshots`. */
  readonly snapshot: number;
  /** The entity of that snapshot the schema is of. */
  readonly entity: string;
  readonly options: BaselineOptions;
  /** The canonical form the schema was written with: `restore` checks it. */
  readonly canonical: string;
  /**
   * The signature the schema was written with: its canonical form, then `;Name=<canonical>` for
   * every entity it reaches. `restore` checks it, so a reached entity is held too, whatever the
   * fingerprint.
   */
  readonly signature: string;
  readonly id: string;
}

/** What `baseline` writes and `restore` reads: plain JSON. The schemas are sorted by name. */
export interface Baseline {
  readonly format: 1;
  /** The version of protoarray that wrote it (`@alexify/protoarray@2.1.0`); not checked. */
  readonly generator?: string;
  /** Each snapshot once, however many schemas share it. */
  readonly snapshots: readonly Snapshot[];
  readonly schemas: Readonly<Record<string, BaselineEntry>>;
}

/**
 * Whether `next` reads what `previous` writes, and writes what it reads, by position: the two
 * plans walked together, every place where the newer version reads an older payload differently
 * reported with the rule it breaks; two versions hashed with different fingerprints are told
 * apart (`fingerprint`, info), since their ids are not comparable. Throws `ERR_SCHEMA_EXPECTED`
 * for anything but a schema of its own (a resolved schema is no version), `ERR_INCOMPATIBLE` for
 * a chain of references too long for the stack.
 */
export function compatible(
  previous: AnySchema,
  next: AnySchema,
  options?: CompatibleOptions,
): Compatibility;

/**
 * The schemas given, by name, as JSON: their snapshots, the options that shape their wire, and
 * their canonical forms and ids as checksums. Each must have been read from a snapshot (not
 * `schema.list`, not a resolved schema): `ERR_SCHEMA_EXPECTED` otherwise.
 */
export function baseline(schemas: Readonly<Record<string, AnySchema>>): Baseline;

/**
 * The schemas of a baseline (the parsed JSON, checked here: anything else is
 * `ERR_INVALID_SNAPSHOT`), built again and held to the canonical form, the signature and the id
 * each was written with (`ERR_INVALID_SNAPSHOT`, naming what differs with both values: another
 * version of protoarray wrote the baseline, or it was edited). Only the options of the wire are
 * taken from a baseline.
 */
export function restore(source: unknown): Readonly<Record<string, Schema>>;

/** Installs `Schema.compatible`. Once per process. */
export function register(): void;

declare module './index.js' {
  namespace Schema {
    /** `compatible` of `@alexify/protoarray/evolve`, once its `register()` has run. */
    function compatible(
      previous: AnySchema,
      next: AnySchema,
      options?: CompatibleOptions,
    ): Compatibility;
  }
}
