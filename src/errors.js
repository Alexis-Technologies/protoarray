// Typed errors. A broken definition throws a SchemaDefinitionError when the
// schema is built; bad input throws an EncodeError or a DecodeError with a
// `code`, a `path` and the `schema` name, so callers can route on them without
// parsing messages.

const STRUCTURE = {
  array: 'is not an array',
  object: 'is not an object',
  length: 'has a wrong length',
  mask: 'is not a sparse mask',
  depth: 'is nested too deeply',
};

const TEXT = {
  structure: '%',
  required: 'is required',
  type: 'is not of expected type: %',
  enum: 'is not of enum: %',
  union: 'is not of union: %',
  extra: 'has extra elements',
  json: 'is not valid JSON',
};

// What a null element of an array of required items was expected to be.
const EXPECTED = {
  struct: 'object',
  union: 'object',
  array: 'array',
  tuple: 'tuple',
  ref: 'object',
};

const message = (code, path, detail) => {
  const text = TEXT[code].replace('%', code === 'structure' ? STRUCTURE[detail] : detail);
  return `${path === '' ? 'Value' : `Field "${path}"`} ${text}`;
};

class SchemaDefinitionError extends TypeError {
  constructor(code, text, schema = '', field = '') {
    super(text);
    this.code = code;
    this.schema = schema;
    this.field = field;
  }
}

// A structural code names what the value is not (an `object`, an `array`) or
// that it is nested too deeply; the others match the decode codes.
class EncodeError extends TypeError {
  constructor(code, path = '', detail = '') {
    const structural = STRUCTURE[code] !== undefined;
    super(structural ? message('structure', path, code) : message(code, path, detail));
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

const join = (prefix, inner) =>
  inner === '' ? prefix : inner[0] === '[' ? prefix + inner : `${prefix}.${inner}`;

// Errors travel up with a path relative to the value that threw them; each
// level that knows its own key or index prepends it on the way out. A root
// is never nested: its codec is called directly.
const nest = (error, prefix) => {
  if (error instanceof DecodeError) {
    return new DecodeError(error.code, join(prefix, error.path), error.detail, error.cause);
  }
  if (error instanceof EncodeError) {
    return new EncodeError(error.code, join(prefix, error.path), error.detail);
  }
  return error;
};

// The outermost call of a schema: its name goes on the error, and a stack
// overflow (a recursive schema's payload, a cyclic value) becomes a
// documented error (V8 and JavaScriptCore throw a RangeError, SpiderMonkey an
// InternalError).
const boundary = (error, schema, decoding) => {
  if (error instanceof DecodeError || error instanceof EncodeError) {
    error.schema = schema;
    return error;
  }
  const overflow = error instanceof RangeError || error.name === 'InternalError';
  if (!overflow) return error;
  const depth = decoding ? new DecodeError('structure', '', 'depth') : new EncodeError('depth');
  return boundary(depth, schema, decoding);
};

module.exports = {
  SchemaDefinitionError,
  EncodeError,
  DecodeError,
  EXPECTED,
  fail,
  refuse,
  nest,
  boundary,
};
