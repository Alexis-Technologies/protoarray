// The `./stream` subpath: payloads that arrive or leave a piece at a time.
//
// - `stringifyLines` and `parseLines`: NDJSON, one value's payload per line;
//   `stringifyStream` and `parseStream` do the same as TransformStreams.
// - `stringifyItems` and `parseItems`: one large JSON array of a collection
//   (rows or flat), written and read item by item without holding it whole.
//
// Sources are a string, an iterable or async iterable of strings and bytes
// (UTF-8), or a ReadableStream of them; nothing here needs a Node builtin.
// Kept out of the core entry; `register()` installs the functions as methods
// of Schema for the programs that want them.

const { Schema, ITEMS, each, iterable } = require('./schema.js');
const { SchemaDefinitionError, EncodeError, DecodeError, boundary, nest } = require('./errors.js');
const { isSchema } = require('./plan.js');

const expect = (schema) => {
  if (isSchema(schema)) return schema;
  throw new SchemaDefinitionError('ERR_SCHEMA_EXPECTED', 'Schema instance expected');
};

// The text of an invalid payload is a DecodeError `json`, with the cause.
const syntax = (message, path, name) =>
  boundary(new DecodeError('json', path, '', new SyntaxError(message)), name, true);

// The chunks of a source as an async iterable. A ReadableStream is read
// through its reader: not every platform makes it async-iterable.
const readStream = async function* (stream) {
  const reader = stream.getReader();
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) return;
      yield value;
    }
  } finally {
    reader.releaseLock();
  }
};

const chunksOf = (source, name) => {
  if (typeof source === 'string') return [source];
  if (source != null && typeof source[Symbol.asyncIterator] === 'function') return source;
  if (source != null && typeof source.getReader === 'function') return readStream(source);
  if (source != null && typeof source[Symbol.iterator] === 'function') return source;
  throw boundary(new DecodeError('structure', '', 'iterable'), name, true);
};

// Text out of chunks of text or UTF-8 bytes, a multi-byte character split
// between two chunks included. Invalid UTF-8 is an error, not a U+FFFD.
const texts = () => {
  const decoder = new TextDecoder('utf-8', { fatal: true });
  return {
    push: (chunk) => (typeof chunk === 'string' ? chunk : decoder.decode(chunk, { stream: true })),
    end: () => decoder.decode(),
  };
};

// Complete lines out of text chunks; `\r\n` ends a line too, and a blank line
// is no value.
const lines = () => {
  let rest = '';
  const complete = (text, out) => {
    const end = text.length > 0 && text.charCodeAt(text.length - 1) === 13 ? -1 : text.length;
    const line = text.slice(0, end);
    if (line.trim() !== '') out.push(line);
  };
  return {
    push: (text) => {
      const out = [];
      let start = 0;
      let at = text.indexOf('\n');
      while (at !== -1) {
        complete(rest + text.slice(start, at), out);
        rest = '';
        start = at + 1;
        at = text.indexOf('\n', start);
      }
      rest += text.slice(start);
      return out;
    },
    end: () => {
      const out = [];
      complete(rest, out);
      rest = '';
      return out;
    },
  };
};

// The payload of one value per line, lazily; an error names the value's index.
const stringifyLines = (schema, values) => {
  expect(schema);
  return each(values, (value) => `${schema.stringify(value)}\n`, schema.name, false);
};

// The values of NDJSON text, lazily and in order. A line that is not valid
// JSON is a DecodeError `json`, one that does not match the schema the error
// its decode throws; either names the index of the value.
const parseLines = (schema, source, options) => {
  expect(schema);
  return valuesOf(schema, chunksOf(source, schema.name), options);
};

const valuesOf = async function* (schema, chunks, options) {
  const text = texts();
  const split = lines();
  let index = 0;
  const parse = (line) => {
    const at = index++;
    try {
      return schema.parse(line, options);
    } catch (error) {
      throw boundary(nest(error, `[${at}]`), schema.name, true);
    }
  };
  for await (const chunk of chunks) {
    for (const line of split.push(decoded(text, chunk, schema.name))) yield parse(line);
  }
  split.push(decoded(text, null, schema.name));
  for (const line of split.end()) yield parse(line);
};

// A chunk as text, or what the decoder still holds at the end (null).
const decoded = (text, chunk, name) => {
  try {
    return chunk === null ? text.end() : text.push(chunk);
  } catch (error) {
    throw boundary(new DecodeError('json', '', '', error), name, true);
  }
};

// The same as TransformStreams: values in, lines out, and text or bytes in,
// values out.
const stringifyStream = (schema) => {
  expect(schema);
  let index = 0;
  return new TransformStream({
    transform(value, controller) {
      const at = index++;
      try {
        controller.enqueue(`${schema.stringify(value)}\n`);
      } catch (error) {
        throw boundary(nest(error, `[${at}]`), schema.name, false);
      }
    },
  });
};

const parseStream = (schema, options) => {
  expect(schema);
  const text = texts();
  const split = lines();
  let index = 0;
  const enqueue = (found, controller) => {
    for (const line of found) {
      const at = index++;
      try {
        controller.enqueue(schema.parse(line, options));
      } catch (error) {
        throw boundary(nest(error, `[${at}]`), schema.name, true);
      }
    }
  };
  return new TransformStream({
    transform(chunk, controller) {
      enqueue(split.push(decoded(text, chunk, schema.name)), controller);
    },
    flush(controller) {
      split.push(decoded(text, null, schema.name));
      enqueue(split.end(), controller);
    },
  });
};

// The text of a collection's JSON array, a piece per item: `[`, the items
// with their commas, `]`. A flat collection writes each record's slots.
const piece = (items, value, index) => {
  const text = JSON.stringify(items.encode(value, index));
  const slots = items.size === 0 ? text : text.slice(1, -1);
  return index === 0 ? slots : `,${slots}`;
};

const piecesSync = function* (items, values) {
  let index = 0;
  yield '[';
  for (const value of values) yield piece(items, value, index++);
  yield ']';
};

const piecesAsync = async function* (items, values) {
  let index = 0;
  yield '[';
  for await (const value of values) yield piece(items, value, index++);
  yield ']';
};

const stringifyItems = (schema, values) => {
  const items = expect(schema)[ITEMS];
  if (!iterable(values)) throw boundary(new EncodeError('iterable'), schema.name, false);
  const async = typeof values[Symbol.asyncIterator] === 'function';
  return async ? piecesAsync(items, values) : piecesSync(items, values);
};

// What the scanner of a JSON array is at.
const BEFORE = 0;
const INSIDE = 1;
const AFTER = 2;

const SPACE = (code) => code === 32 || code === 10 || code === 13 || code === 9;

// The top-level elements of one JSON array, out of text chunks. The scanner
// only finds where each element ends (a comma or the closing bracket outside
// strings and nested values) and hands its text to JSON.parse, which does the
// rest of the work and reports what is malformed inside an element.
const scanner = (name) => {
  let state = BEFORE;
  let depth = 0;
  let string = false;
  let escape = false;
  let started = false;
  let commas = 0;
  let buffer = '';
  return {
    push: (text, out) => {
      let start = 0;
      for (let i = 0; i < text.length; i++) {
        const code = text.charCodeAt(i);
        if (state !== INSIDE) {
          if (state === BEFORE && code === 91) {
            state = INSIDE;
            start = i + 1;
          } else if (!SPACE(code)) {
            throw syntax(`Unexpected character "${text[i]}" outside the array`, '', name);
          }
        } else if (string) {
          if (escape) escape = false;
          else if (code === 92) escape = true;
          else if (code === 34) string = false;
        } else if (code === 34) {
          string = true;
          started = true;
        } else if (code === 91 || code === 123) {
          depth += 1;
          started = true;
        } else if ((code === 93 || code === 125) && depth > 0) {
          depth -= 1;
        } else if ((code === 44 || code === 93) && depth === 0) {
          // An element ends: empty only where `[]` closes an empty array.
          if (!started && (code === 44 || commas > 0)) {
            throw syntax('An empty element', `[${out.count + out.length}]`, name);
          }
          if (started) out.push(buffer + text.slice(start, i));
          buffer = '';
          started = false;
          start = i + 1;
          if (code === 44) commas += 1;
          else state = AFTER;
        } else if (!SPACE(code)) {
          started = true;
        }
      }
      if (state === INSIDE) buffer += text.slice(start);
    },
    end: () => {
      if (state !== AFTER) throw syntax('The array does not end', '', name);
    },
  };
};

// The items of a collection's JSON array, decoded one at a time while the
// text arrives. A flat collection gathers each record's slots first.
const parseItems = (schema, source, options) => {
  const items = expect(schema)[ITEMS];
  return itemsOf(schema, items, chunksOf(source, schema.name), options);
};

const itemsOf = async function* (schema, items, chunks, options) {
  const strict = options != null && options.strict === true;
  const text = texts();
  const scan = scanner(schema.name);
  let index = 0;
  let row = [];
  const elements = [];
  elements.count = 0;
  // The JSON of each element found; a flat collection yields every `size`.
  const take = function* () {
    for (const element of elements) {
      let wire;
      try {
        wire = JSON.parse(element);
      } catch (error) {
        const at = items.size === 0 ? index : Math.floor(elements.count / items.size);
        throw boundary(new DecodeError('json', `[${at}]`, '', error), schema.name, true);
      }
      elements.count += 1;
      if (items.size === 0) {
        yield items.decode(wire, index, strict);
        index += 1;
        continue;
      }
      row.push(wire);
      if (row.length < items.size) continue;
      yield items.decode(row, index, strict);
      index += 1;
      row = [];
    }
    elements.length = 0;
  };
  for await (const chunk of chunks) {
    scan.push(decoded(text, chunk, schema.name), elements);
    yield* take();
  }
  scan.push(decoded(text, null, schema.name), elements);
  scan.end();
  if (row.length !== 0) {
    throw boundary(new DecodeError('structure', '', 'length'), schema.name, true);
  }
};

// Installed like class members: not enumerable. Once per process.
let registered = false;

const register = () => {
  if (registered) return;
  registered = true;
  const members = {
    stringifyLines(values) {
      return stringifyLines(this, values);
    },
    parseLines(source, options) {
      return parseLines(this, source, options);
    },
    stringifyStream() {
      return stringifyStream(this);
    },
    parseStream(options) {
      return parseStream(this, options);
    },
    stringifyItems(values) {
      return stringifyItems(this, values);
    },
    parseItems(source, options) {
      return parseItems(this, source, options);
    },
  };
  const descriptors = Object.getOwnPropertyDescriptors(members);
  for (const name of Object.keys(descriptors)) {
    descriptors[name].enumerable = false;
    Object.defineProperty(Schema.prototype, name, descriptors[name]);
  }
};

module.exports = {
  stringifyLines,
  parseLines,
  stringifyStream,
  parseStream,
  stringifyItems,
  parseItems,
  register,
};
