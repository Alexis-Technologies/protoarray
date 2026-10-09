// Typed errors. A broken definition throws a SchemaDefinitionError when the
// schema is built; bad input throws an EncodeError or a DecodeError with a
// `code` and a `path`, so callers can route on them without parsing messages.

const STRUCTURE = {
  array: 'is not an array',
  length: 'has a wrong length',
  mask: 'is not a sparse mask',
};

const TEXT = {
  structure: '%',
  required: 'is required',
  type: 'is not of expected type: %',
  enum: 'is not of enum: %',
  extra: 'has extra elements',
  json: 'is not valid JSON',
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

class EncodeError extends TypeError {
  constructor(code, text, path = '') {
    super(text);
    this.code = code;
    this.path = path;
  }
}

class DecodeError extends TypeError {
  constructor(code, path, detail = '', cause = undefined) {
    super(message(code, path, detail), cause === undefined ? undefined : { cause });
    this.code = code;
    this.path = path;
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

// Errors travel up with a path relative to the value that threw them; each
// level that knows its own key or index prepends it on the way out.
const nest = (error, prefix) => {
  if (!(error instanceof DecodeError) || prefix === '') return error;
  const inner = error.path;
  const path = inner === '' ? prefix : inner[0] === '[' ? prefix + inner : `${prefix}.${inner}`;
  return new DecodeError(error.code, path, error.detail, error.cause);
};

module.exports = { SchemaDefinitionError, EncodeError, DecodeError, fail, nest };
