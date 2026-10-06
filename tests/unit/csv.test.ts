import { describe, expect, it } from 'vitest';
import { parseCsv } from '@/modules/imports/csv';

describe('parseCsv', () => {
  it('parses simple rows and skips blank lines', () => {
    expect(parseCsv('a,b\n1,2\n\n3,4\n')).toEqual([
      ['a', 'b'],
      ['1', '2'],
      ['3', '4'],
    ]);
  });

  it('handles quotes, escaped quotes, commas and newlines inside quotes', () => {
    expect(parseCsv('name,note\r\n"Doe, Jane","said ""hi""\nthere"\r\n')).toEqual([
      ['name', 'note'],
      ['Doe, Jane', 'said "hi"\nthere'],
    ]);
  });

  it('strips a UTF-8 BOM and keeps empty cells', () => {
    expect(parseCsv('﻿a,b,c\n1,,3')).toEqual([
      ['a', 'b', 'c'],
      ['1', '', '3'],
    ]);
  });

  it('rejects an unterminated quote', () => {
    expect(() => parseCsv('a\n"oops')).toThrow('Unterminated');
  });
});
