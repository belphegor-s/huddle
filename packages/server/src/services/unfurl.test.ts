import { describe, expect, it } from 'vitest';
import { readMeta, readTitle } from './unfurl.js';

describe('reading page metadata', () => {
  it('prefers open graph tags and decodes entities', () => {
    const meta = readMeta(`
      <meta property="og:title" content="Ada &amp; Sam ship it">
      <meta property="og:description" content="A &quot;quoted&quot; summary">
      <meta property="og:site_name" content="Example">
    `);

    expect(meta.get('og:title')).toBe('Ada & Sam ship it');
    expect(meta.get('og:description')).toBe('A "quoted" summary');
    expect(meta.get('og:site_name')).toBe('Example');
  });

  it('reads name as well as property, which is what twitter tags use', () => {
    const meta = readMeta('<meta name="twitter:title" content="From twitter">');
    expect(meta.get('twitter:title')).toBe('From twitter');
  });

  it('keeps the first value when a key repeats', () => {
    const meta = readMeta(
      '<meta property="og:title" content="First"><meta property="og:title" content="Second">',
    );
    expect(meta.get('og:title')).toBe('First');
  });

  it('collapses whitespace so a wrapped tag does not become a ragged title', () => {
    const meta = readMeta('<meta property="og:title" content="One\n   two    three">');
    expect(meta.get('og:title')).toBe('One two three');
  });

  it('falls back to the title element', () => {
    expect(readTitle('<html><head><title>  Plain title </title></head></html>')).toBe(
      'Plain title',
    );
    expect(readTitle('<html><head></head></html>')).toBeNull();
  });

  it('decodes numeric entities', () => {
    const meta = readMeta('<meta property="og:title" content="caf&#233;">');
    expect(meta.get('og:title')).toBe('café');
  });

  it('is not fooled by a tag with no content', () => {
    const meta = readMeta('<meta property="og:image">');
    expect(meta.get('og:image')).toBeUndefined();
  });
});
