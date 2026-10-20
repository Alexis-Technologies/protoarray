// Typed errors. A broken definition throws a SchemaDefinitionError when the
// schema is built; bad input throws an EncodeError or a DecodeError with a
// `code`, a `path` and the `schema` name, so callers can route on them without
// parsing messages.

// The module is a closed function run once: nothing in it reaches outside, so
// standalone.js can embed its source in a module that carries its own runtime.
const kernel = () => {
  // Dictionaries: a code is looked up, never read from a prototype.
  const STRUCTURE = Object.assign(Object.create(null), {
    array: 'is not an array',
    object: 'is not an object',
    set: 'is not a set',
    map: 'is not a map',
    length: 'has a wrong length',
    mask: 'is not a sparse mask',
    envelope: 'is not an envelope: [id, payload]',
    intern: 'is not an interned payload: [table, body]',
    iterable: 'is not iterable',
    depth: 'is nested too deeply',
    size: 'is longer than maxLength allows',
    bytes: 'is not a Uint8Array',
    presence: 'is not a presence byte',
  });

  const TEXT = Object.assign(Object.create(null), {
    structure: '%',
    required: 'is required',
    type: 'is not of expected type: %',
    enum: 'is not of enum: %',
    union: 'is not of union: %',
    extra: 'has extra elements',
    json: 'is not valid JSON',
    schema: 'is not of a schema this reader can read',
  });

  // What a null element of an array of required items was expected to be.
  const EXPECTED = {
    struct: 'object',
    union: 'object',
    array: 'array',
    map: 'map',
    dict: 'object',
    tuple: 'tuple',
    ref: 'object',
  };

  const expectedOf = (node) =>
    node.kind === 'scalar' ? node.expected : node.container || EXPECTED[node.kind];

  // A code of a caller's own (an error made outside protoarray) reads as itself.
  const message = (code, path, detail) => {
    const known = code === 'structure' ? STRUCTURE[detail] : detail;
    const text = TEXT[code] === undefined ? code : TEXT[code].replace('%', known ?? detail);
    return `${path === '' ? 'Value' : `Field "${path}"`} ${text}`;
  };

  class SchemaDefinitionError extends TypeError {
    constructor(code, text, schema = '', field = '', cause = undefined) {
      super(text, cause === undefined ? undefined : { cause });
      this.code = code;
      this.schema = schema;
      this.field = field;
    }
  }

  // A structural code of encode names what the value is not (an `object`, an
  // `array`) or that it is nested too deeply; the others match the decode
  // codes.
  const textOf = (encoding, code, path, detail) =>
    encoding && STRUCTURE[code] !== undefined
      ? message('structure', path, code)
      : message(code, path, detail);

  class EncodeError extends TypeError {
    constructor(code, path = '', detail = '') {
      super(textOf(true, code, path, detail));
      this.code = code;
      this.path = path;
      this.schema = '';
      // Off the public surface: it only serves re-throwing with a longer path.
      Object.defineProperty(this, 'detail', { value: detail });
    }
  }

  class DecodeError extends TypeError {
    constructor(code, path, detail = '', cause = undefined) {
      super(message(code, path, detail), cause === undefined ? undefined : { cause });
      this.code = code;
      this.path = path;
      this.schema = '';
      // The id an envelope names comes from the payload: a property, never
      // part of the message, which is safe to log.
      if (code === 'schema') this.id = detail;
      // Off the public surface: it only serves re-throwing with a longer path.
      Object.defineProperty(this, 'detail', { value: detail });
    }
  }

  for (const [Type, name] of [
    [SchemaDefinitionError, 'SchemaDefinitionError'],
    [EncodeError, 'EncodeError'],
    [DecodeError, 'DecodeError'],
  ]) {
    Object.defineProperty(Type.prototype, 'name', { value: name, configurable: true });
  }

  const fail = (code, path, detail) => {
    throw new DecodeError(code, path, detail);
  };

  const refuse = (code, path, detail) => {
    throw new EncodeError(code, path, detail);
  };

  // A root calls its codec with no key of its own (an alias does): '' adds none.
  const join = (prefix, inner) =>
    prefix === ''
      ? inner
      : inner === ''
        ? prefix
        : inner[0] === '['
          ? prefix + inner
          : `${prefix}.${inner}`;

  // A key of a record in a path: as it is, unless it holds what a path is
  // made of (a dot, brackets, braces), begins with a quote or is empty; then as a quoted
  // JSON string in brackets, so that a path names one place.
  const PUNCTUATION = /[.[\]{}]|^"|^$/;
  const step = (key) => (PUNCTUATION.test(key) ? `[${JSON.stringify(key)}]` : key);

  // Errors travel up with a path relative to the value that threw them; each
  // level that knows its own key or index adds it to the error's trail on the
  // way out, and the outermost call (boundary) writes the path and the message
  // once: a payload nested deep costs one error, not one per level. A trail
  // longer than LONGEST keeps both its ends.
  const TRAIL = Symbol('trail');
  const LONGEST = 64;

  const nest = (error, prefix) => {
    if (!(error instanceof DecodeError || error instanceof EncodeError)) return error;
    const trail = error[TRAIL];
    if (trail === undefined) Object.defineProperty(error, TRAIL, { value: [prefix] });
    else trail.push(prefix);
    return error;
  };

  const settle = (error) => {
    const trail = error[TRAIL];
    if (trail === undefined || trail.length === 0) return;
    const half = LONGEST / 2;
    const parts =
      trail.length <= LONGEST ? trail : [...trail.slice(0, half), '[…]', ...trail.slice(-half)];
    let path = error.path;
    for (const prefix of parts) path = join(prefix, path);
    trail.length = 0;
    error.path = path;
    error.message = textOf(error instanceof EncodeError, error.code, path, error.detail);
  };

  // What the engines say when the call stack is exhausted: V8 and
  // JavaScriptCore throw a RangeError, SpiderMonkey an InternalError. Any other
  // RangeError (an invalid string length) is not a depth problem.
  const OVERFLOW = /call stack|too much recursion/i;

  const overflowed = (error) =>
    error !== null &&
    typeof error === 'object' &&
    (error instanceof RangeError || error.name === 'InternalError') &&
    OVERFLOW.test(error.message);

  // The outermost call of a schema: its name goes on the error, and a stack
  // overflow (a recursive schema's payload, a cyclic value) becomes a
  // documented error. Anything else thrown passes through as it is, a null
  // included.
  const boundary = (error, schema, decoding) => {
    if (error instanceof DecodeError || error instanceof EncodeError) {
      settle(error);
      error.schema = schema;
      return error;
    }
    if (!overflowed(error)) return error;
    const depth = decoding ? new DecodeError('structure', '', 'depth') : new EncodeError('depth');
    return boundary(depth, schema, decoding);
  };

  return {
    SchemaDefinitionError,
    EncodeError,
    DecodeError,
    EXPECTED,
    expectedOf,
    fail,
    refuse,
    nest,
    join,
    step,
    overflowed,
    boundary,
  };
};

const errors = kernel();

module.exports = {
  SchemaDefinitionError: errors.SchemaDefinitionError,
  EncodeError: errors.EncodeError,
  DecodeError: errors.DecodeError,
  EXPECTED: errors.EXPECTED,
  expectedOf: errors.expectedOf,
  fail: errors.fail,
  refuse: errors.refuse,
  nest: errors.nest,
  join: errors.join,
  step: errors.step,
  overflowed: errors.overflowed,
  boundary: errors.boundary,
  kernel,
};
