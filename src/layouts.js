// Collection layouts over a record codec. `rows` is the codec itself; `flat`
// concatenates fixed-width rows into one array, `columns` transposes them.
// Both are plain loops over the record functions, so they are the same for
// either backend.

const { fail, nest } = require('./errors.js');

const padded = (item, record, size) => {
  const row = record == null ? [] : item.encode(record);
  while (row.length < size) row.push(null);
  return row;
};

const records = (item, count, read, strict) => {
  const out = new Array(count);
  for (let i = 0; i < count; i++) {
    try {
      out[i] = item.decode(read(i), strict);
    } catch (error) {
      throw nest(error, `[${i}]`);
    }
  }
  return out;
};

const flat = (item, size) => ({
  encode: (list) => {
    const out = [];
    for (let i = 0; i < list.length; i++) out.push(...padded(item, list[i], size));
    return out;
  },
  decode: (array, strict) => {
    if (!Array.isArray(array)) fail('structure', '', 'array');
    if (array.length % size !== 0) fail('structure', '', 'length');
    const read = (i) => array.slice(i * size, i * size + size);
    return records(item, array.length / size, read, strict);
  },
});

const columns = (item, size) => ({
  encode: (list) => {
    const out = [];
    for (let j = 0; j < size; j++) out.push(new Array(list.length));
    for (let i = 0; i < list.length; i++) {
      const row = padded(item, list[i], size);
      for (let j = 0; j < size; j++) out[j][i] = row[j];
    }
    return out;
  },
  decode: (array, strict) => {
    if (!Array.isArray(array)) fail('structure', '', 'array');
    if (strict && array.length > size) fail('extra', '');
    const cols = [];
    for (let j = 0; j < size; j++) {
      const column = j < array.length ? array[j] : null;
      if (column !== null && !Array.isArray(column)) fail('structure', `[${j}]`, 'array');
      if (column !== null && j > 0 && column.length !== cols[0].length) {
        fail('structure', `[${j}]`, 'length');
      }
      cols.push(column);
    }
    const count = cols[0] === null ? 0 : cols[0].length;
    const read = (i) => cols.map((column) => (column === null ? null : column[i]));
    return records(item, count, read, strict);
  },
});

module.exports = { flat, columns };
