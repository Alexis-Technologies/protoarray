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

const { Schema, ITEMS, each, iterable, registrar } = require('./schema.js');
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
// through its reader: not every platform makes it async-iterable. A consumer
// that stops early (a break, an error) cancels it, as the stream's own
// iterator does.
const readStream = async function* (stream) {
  const reader = stream.getReader();
  let finished = false;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) {
        finished = true;
        return;
      }
      yield value;
    }
  } finally {
    if (!finished) await reader.cancel().catch(() => undefined);
    reader.releaseLock();
  }
};

const chunksOf = (source, name) => {
  // The whole text, as a string or as bytes (a Uint8Array iterates numbers).
  if (typeof source === 'string' || ArrayBuffer.isView(source)) return [source];
  if (source != null && typeof source[Symbol.asyncIterator] === 'function') return source;
  if (source != null && typeof source.getReader === 'function') return readStream(source);
  if (source != null && typeof source[Symbol.iterator] === 'function') return source;
  throw boundary(new DecodeError('structure', '', 'iterable'), name, true);
};

// The longest line or item a parser holds, in characters: a payload that never
// ends one is an error, not a string that grows until memory runs out. The
// largest limit is the shortest string an engine refuses to build.
const MAX_LENGTH = 16 * 1024 * 1024;
const LONGEST = 2 ** 29 - 24;

const limitOf = (options, name) => {
  const given = options == null ? undefined : options.maxLength;
  if (given === undefined) return MAX_LENGTH;
  if (
    typeof given !== 'number' ||
    !(given > 0) ||
    (!Number.isInteger(given) && given !== Infinity)
  ) {
    throw new SchemaDefinitionError('ERR_INVALID_OPTIONS', 'Invalid option "maxLength"', name);
  }
  return Math.min(given, LONGEST);
};

// Text out of chunks of text or UTF-8 bytes, a multi-byte character split
// between two chunks included. Invalid UTF-8 is an error, not a U+FFFD. A
// byte order mark is no text: the decoder drops it from bytes, and from a
// string here.
const texts = () => {
  const decoder = new TextDecoder('utf-8', { fatal: true });
  let first = true;
  return {
    push: (chunk) => {
      const text = typeof chunk === 'string' ? chunk : decoder.decode(chunk, { stream: true });
      if (!first || text.length === 0) return text;
      first = false;
      return text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
    },
    end: () => decoder.decode(),
  };
};

// What a line or an item longer than the limit is: an error at its index.
const tooLong = (index, name) =>
  boundary(new DecodeError('structure', `[${index}]`, 'size'), name, true);

// Complete lines out of text chunks; `\r\n` ends a line too, and a blank line
// is no value. A line is measured before it is joined, so it never grows
// past the limit: the lines before it are still found, and `error` says
// where the long one is.
const lines = (max, name) => {
  let rest = '';
  let count = 0;
  const complete = (text, out) => {
    const end = text.length > 0 && text.charCodeAt(text.length - 1) === 13 ? -1 : text.length;
    const line = text.slice(0, end);
    if (line.trim() === '') return;
    out.push(line);
    count += 1;
  };
  return {
    push: (text) => {
      const out = [];
      let start = 0;
      let at = text.indexOf('\n');
      while (at !== -1) {
        if (rest.length + at - start > max) break;
        complete(rest + text.slice(start, at), out);
        rest = '';
        start = at + 1;
        at = text.indexOf('\n', start);
      }
      const end = at === -1 ? text.length : at;
      if (rest.length + end - start > max) out.error = tooLong(count, name);
      else rest += text.slice(start);
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
  const max = limitOf(options, schema.name);
  return valuesOf(schema, chunksOf(source, schema.name), options, max);
};

const valuesOf = async function* (schema, chunks, options, max) {
  const text = texts();
  const split = lines(max, schema.name);
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
    const found = split.push(decoded(text, chunk, schema.name));
    for (const line of found) yield parse(line);
    if (found.error !== undefined) throw found.error;
  }
  // What the decoder still holds is a character cut off: an error.
  decoded(text, null, schema.name);
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
  const split = lines(limitOf(options, schema.name), schema.name);
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
    if (found.error !== undefined) throw found.error;
  };
  return new TransformStream({
    transform(chunk, controller) {
      enqueue(split.push(decoded(text, chunk, schema.name)), controller);
    },
    flush(controller) {
      decoded(text, null, schema.name);
      enqueue(split.end(), controller);
    },
  });
};

// The text of a collection's JSON array, a piece per item: `[`, the items
// with their commas, `]`. A flat collection writes each record's slots.
const piece = (items, value, index) => {
  const text = items.text(value, index);
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

// No item yet: a flat row still filling up.
const NONE = Symbol('none');

// What the scanner of a JSON array is at.
const BEFORE = 0;
const INSIDE = 1;
const AFTER = 2;

const SPACE = (code) => code === 32 || code === 10 || code === 13 || code === 9;

// The top-level elements of one JSON array, out of text chunks. The scanner
// only finds where each element ends (a comma or the closing bracket outside
// strings and nested values) and hands its text to JSON.parse, which does the
// rest of the work and reports what is malformed inside an element. An error
// names the item an element belongs to, a record of `size` slots in a flat
// collection; one longer than `max` is measured before it is joined, and the
// elements before it are still found (`error` says where it is).
const scanner = (name, size, max) => {
  const item = (n) => (size === 0 ? n : Math.floor(n / size));
  let state = BEFORE;
  let depth = 0;
  let string = false;
  // The chunk before ended inside a string on a backslash: the first
  // character of this one is escaped.
  let escape = false;
  let started = false;
  let commas = 0;
  let buffer = '';
  // The quote that closes the string `from` is in, or -1 when the chunk ends
  // inside it; an odd run of backslashes before a quote escapes it, and one at
  // the end of the chunk the first character of the next.
  const closing = (text, from) => {
    let quote = text.indexOf('"', from);
    while (quote !== -1) {
      let back = quote - 1;
      while (back >= from && text.charCodeAt(back) === 92) back--;
      if ((quote - 1 - back) % 2 === 0) return quote;
      quote = text.indexOf('"', quote + 1);
    }
    let back = text.length - 1;
    while (back >= from && text.charCodeAt(back) === 92) back--;
    escape = (text.length - 1 - back) % 2 === 1;
    return -1;
  };
  return {
    push: (text, out) => {
      // An empty chunk has no first character to escape: the next one has.
      if (text.length === 0) return;
      let start = 0;
      let i = 0;
      if (escape) {
        escape = false;
        i = 1;
      }
      for (const length = text.length; i < length; i++) {
        if (string) {
          // Through the string to its closing quote, past the chunk maybe.
          const quote = closing(text, i);
          if (quote === -1) break;
          string = false;
          i = quote;
          continue;
        }
        const code = text.charCodeAt(i);
        if (state !== INSIDE) {
          if (state === BEFORE && code === 91) {
            state = INSIDE;
            start = i + 1;
          } else if (!SPACE(code)) {
            throw syntax(`Unexpected character "${text[i]}" outside the array`, '', name);
          }
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
            throw syntax('An empty element', `[${item(out.count + out.length)}]`, name);
          }
          if (buffer.length + i - start > max) {
            out.error = tooLong(item(out.count + out.length), name);
            return;
          }
          if (started) out.push(buffer + text.slice(start, i));
          buffer = '';
          started = false;
          start = i + 1;
          if (code === 44) commas += 1;
          else state = AFTER;
        } else if (!started && !SPACE(code)) {
          started = true;
        }
      }
      if (state !== INSIDE) return;
      if (buffer.length + text.length - start > max) {
        out.error = tooLong(item(out.count + out.length), name);
      } else buffer += text.slice(start);
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
  const max = limitOf(options, schema.name);
  return itemsOf(schema, items, chunksOf(source, schema.name), options, max);
};

const itemsOf = async function* (schema, items, chunks, options, max) {
  const strict = options != null && options.strict === true;
  const text = texts();
  const scan = scanner(schema.name, items.size, max);
  let index = 0;
  let row = [];
  const elements = [];
  elements.count = 0;
  // The item an element completes, or NONE while a flat row fills up.
  const take = (element) => {
    let wire;
    try {
      wire = JSON.parse(element);
    } catch (error) {
      const at = items.size === 0 ? index : Math.floor(elements.count / items.size);
      throw boundary(new DecodeError('json', `[${at}]`, '', error), schema.name, true);
    }
    elements.count += 1;
    if (items.size !== 0) {
      row.push(wire);
      if (row.length < items.size) return NONE;
      wire = row;
      row = [];
    }
    return items.decode(wire, index++, strict);
  };
  for await (const chunk of chunks) {
    scan.push(decoded(text, chunk, schema.name), elements);
    for (let k = 0; k < elements.length; k++) {
      const item = take(elements[k]);
      if (item !== NONE) yield item;
    }
    if (elements.error !== undefined) throw elements.error;
    elements.length = 0;
  }
  // What the decoder still holds is a character cut off: an error.
  decoded(text, null, schema.name);
  scan.end();
  if (row.length !== 0) {
    throw boundary(new DecodeError('structure', '', 'length'), schema.name, true);
  }
};

// Installed like class members: not enumerable. Once per process.
const register = registrar(Schema.prototype, {
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
});

module.exports = {
  stringifyLines,
  parseLines,
  stringifyStream,
  parseStream,
  stringifyItems,
  parseItems,
  register,
};
