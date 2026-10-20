import { describe, expect, it } from '@jest/globals';

import { attributionFor, buildSearchParams, queryVariants } from '../openverse';
import { parseSampleRequest } from '../query';

describe('queryVariants', () => {
  it('asks for everything the user said first', () => {
    const variants = queryVariants(
      parseSampleRequest('lofi drum loop at 90bpm')
    );

    expect(variants[0]).toContain('90bpm');
    expect(variants[0]).toContain('drum');
  });

  it('falls back to the query without the tempo', () => {
    // Openverse ANDs terms, and most uploads carry no tempo in the title,
    // so requiring it returns nothing. Verified against the live API.
    const variants = queryVariants(
      parseSampleRequest('lofi drum loop at 90bpm')
    );

    // "loop" is no longer a search term: it is captured as `loop: true`
    // and stripped, so it cannot AND away untagged results.
    expect(variants).toContain('lofi drum');
  });

  it('drops character adjectives before anything else', () => {
    const variants = queryVariants(
      parseSampleRequest('gritty dusty drum loop')
    );

    expect(variants).toContain('drum');
    expect(variants.indexOf('drum')).toBeGreaterThan(0);
  });

  it('keeps the instrument when the adjectives come last', () => {
    // Dropping leading words blindly would lose "snare", which is the
    // one term that has to match.
    for (const variant of queryVariants(parseSampleRequest('snare one shot'))) {
      expect(variant.length).toBeGreaterThan(0);
    }
    expect(queryVariants(parseSampleRequest('snare one shot'))[0]).toContain(
      'snare'
    );
  });

  it('orders from most to least specific', () => {
    const variants = queryVariants(parseSampleRequest('warm analog pad'));
    const lengths = variants.map((variant) => variant.split(' ').length);

    expect([...lengths].sort((a, b) => b - a)).toEqual(lengths);
  });

  it('does not repeat a variant', () => {
    const variants = queryVariants(parseSampleRequest('vinyl crackle'));

    expect(new Set(variants).size).toBe(variants.length);
  });

  it('never yields an empty variant', () => {
    for (const prompt of ['x', 'a', 'drum', 'gritty']) {
      for (const variant of queryVariants(parseSampleRequest(prompt))) {
        expect(variant.trim().length).toBeGreaterThan(0);
      }
    }
  });

  it('does not repeat the key as both a term and an extra', () => {
    const variants = queryVariants(parseSampleRequest('warm pad in F#m'));
    const first = variants[0]!.toLowerCase();

    expect(first.split('f#m').length - 1).toBe(1);
  });
});

describe('buildSearchParams', () => {
  it('does not set a category', () => {
    // category=music drops "gritty drum loop" from 29 results to 0;
    // Openverse files plenty of real loops under sound effects.
    expect(buildSearchParams('drum loop').has('category')).toBe(false);
  });

  it('restricts the licence only when asked', () => {
    expect(buildSearchParams('drum').has('license')).toBe(false);
    expect(
      buildSearchParams('drum', { publicDomainOnly: true }).get('license')
    ).toBe('cc0,pdm');
  });

  it('passes the page size through', () => {
    expect(buildSearchParams('drum', { pageSize: 7 }).get('page_size')).toBe(
      '7'
    );
  });
});

describe('attributionFor', () => {
  it('names the creator and licence, which CC-BY requires', () => {
    const credit = attributionFor({
      id: '1',
      title: 'Tribe Drum Loop',
      url: 'https://example.test/a.mp3',
      creator: 'PearceWilsonKing',
      license: 'by',
      provider: 'freesound',
    });

    expect(credit).toContain('Tribe Drum Loop');
    expect(credit).toContain('PearceWilsonKing');
    expect(credit).toContain('BY');
  });

  it('reads sensibly when the creator is unknown', () => {
    const credit = attributionFor({
      id: '1',
      title: 'Untitled',
      url: 'https://example.test/a.mp3',
      license: 'cc0',
    });

    expect(credit).not.toContain('undefined');
  });
});

describe('genre survives relaxation longer than texture', () => {
  it('drops the texture adjective before the genre', () => {
    const variants = queryVariants(
      parseSampleRequest('gritty ambient snare one shot')
    );
    const withoutTexture = variants.indexOf('ambient snare');
    const withoutGenre = variants.indexOf('snare');

    expect(withoutTexture).toBeGreaterThan(-1);
    expect(withoutGenre).toBeGreaterThan(withoutTexture);
  });
});
