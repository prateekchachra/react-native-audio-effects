import { describe, expect, it } from '@jest/globals';

import { parseSampleRequest } from '../query';

describe('parseSampleRequest', () => {
  it('strips filler so the terms are what a sample is actually tagged with', () => {
    const query = parseSampleRequest(
      'can you find me a gritty drum loop please'
    );

    expect(query.terms).toContain('gritty');
    expect(query.terms).toContain('drum');
    expect(query.terms).not.toContain('find');
    expect(query.terms).not.toContain('please');
    expect(query.terms).not.toContain('you');
  });

  it('keeps short words that carry meaning', () => {
    expect(parseSampleRequest('hat and kick').terms).toBe('hat kick');
    expect(parseSampleRequest('warm pad').terms).toContain('pad');
  });

  it.each([
    ['a 90bpm beat', 90],
    ['something at 128 bpm', 128],
    ['174bpm drum and bass', 174],
    ['loop at 70', 70],
  ])('reads the tempo from %s', (prompt, expected) => {
    expect(parseSampleRequest(prompt).bpm).toBe(expected);
  });

  it('ignores a number that cannot be a tempo', () => {
    // "at 2010" is a year; treating it as a tempo would filter wrongly.
    expect(parseSampleRequest('vinyl crackle at 2010').bpm).toBeUndefined();
    expect(parseSampleRequest('at 12 oclock').bpm).toBeUndefined();
  });

  it('does not leave the tempo in the search terms as well', () => {
    const query = parseSampleRequest('lofi beat at 90bpm');

    expect(query.bpm).toBe(90);
    expect(query.terms).not.toContain('90');
    expect(query.terms).toContain('lofi');
  });

  it.each([
    ['a loop in F#m', 'F#m'],
    ['pad in C major', 'C'],
    ['bass in Bb minor', 'Bbm'],
    ['chords in A sharp', 'A#'],
  ])('reads the key from %s', (prompt, expected) => {
    expect(parseSampleRequest(prompt).key).toBe(expected);
  });

  it('does not invent a key from a stray capital letter', () => {
    expect(parseSampleRequest('Deep house groove').key).toBeUndefined();
  });

  it.each([
    ['something under 5 seconds', { maxDurationSec: 5 }],
    ['a pad longer than 20 seconds', { minDurationSec: 20 }],
    ['hit shorter than 2s', { maxDurationSec: 2 }],
    ['at least 10 secs of noise', { minDurationSec: 10 }],
  ])('reads a duration bound from %s', (prompt, expected) => {
    expect(parseSampleRequest(prompt)).toMatchObject(expected);
  });

  it('distinguishes a loop from a one shot', () => {
    expect(parseSampleRequest('drum loop').loop).toBe(true);
    expect(parseSampleRequest('snare one shot').loop).toBe(false);
    expect(parseSampleRequest('a kick hit').loop).toBe(false);
    expect(parseSampleRequest('warm analog pad').loop).toBeUndefined();
  });

  it('prefers one shot when a request says both', () => {
    // "one shot" is the more specific statement of intent.
    expect(parseSampleRequest('one shot from a drum loop').loop).toBe(false);
  });

  it('reports what it understood, for showing back to the user', () => {
    const query = parseSampleRequest(
      'gritty 90bpm drum loop in F#m under 8 seconds'
    );

    expect(query.understood).toMatchObject({
      tempo: '90 bpm',
      key: 'F#m',
      type: 'loop',
      maxLength: '8s',
    });
  });

  it('falls back to the raw prompt when everything is filler', () => {
    expect(parseSampleRequest('find me something').terms).toBe(
      'find me something'
    );
  });

  it('rejects nothing — any input yields a usable query', () => {
    for (const prompt of ['???', 'a', '🎹', '   x   ']) {
      expect(parseSampleRequest(prompt).terms.length).toBeGreaterThan(0);
    }
  });

  it('strips punctuation that would not match metadata', () => {
    expect(parseSampleRequest('gritty, dusty drums!').terms).toBe(
      'gritty dusty drums'
    );
  });
});

describe('the jazz-loop regression', () => {
  // "snare one shot for an ambient song" returned jazz loops. Two causes,
  // one test each.
  const query = parseSampleRequest('snare one shot for an ambient song');

  it('keeps the genre, which carries most of the intent', () => {
    expect(query.terms).toContain('ambient');
  });

  it('strips the type words it already captured structurally', () => {
    // Left in, Openverse ANDs on "one" and "shot" and matches any title
    // containing "shot" — which is where the jazz came from.
    expect(query.terms).not.toContain('shot');
    expect(query.terms).not.toContain('one');
    expect(query.loop).toBe(false);
  });

  it('reduces to just the instrument and the genre', () => {
    expect(query.terms.split(/\s+/).sort()).toEqual(['ambient', 'snare']);
  });

  it('treats a loop request the same way', () => {
    const loop = parseSampleRequest('gritty lofi drum loop');
    expect(loop.loop).toBe(true);
    expect(loop.terms).not.toContain('loop');
    expect(loop.terms).toContain('lofi');
  });
});
