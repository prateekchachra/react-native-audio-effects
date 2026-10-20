/**
 * Turning a plain-English request into a sample search.
 *
 * "something gritty for a 90bpm lo-fi beat" has to become a query string
 * and a set of filters. A language model does this well, but every free
 * one needs an API key, and a library that cannot search until the user
 * registers for a token is a library most people never try.
 *
 * So the default interpreter is this: a vocabulary of terms that actually
 * appear in sample metadata, plus a few regexes for the things that are
 * unambiguous in text — tempo, musical key, duration, "loop" vs "one
 * shot". It is not clever. It is, however, instant, free, offline, and
 * right about the parts of a request that matter most for retrieval.
 *
 * {@link SampleAgent} takes an optional `interpret` hook for anyone who
 * does want to put a model in front of it.
 */

/** What a search needs, independent of which service runs it. */
export interface SampleQuery {
  /** Search terms, already stripped of filler. */
  readonly terms: string;
  /** Beats per minute, if the request named one. */
  readonly bpm?: number;
  /** Musical key, normalised like `"F#m"`. */
  readonly key?: string;
  /** Shortest acceptable result, in seconds. */
  readonly minDurationSec?: number;
  /** Longest acceptable result, in seconds. */
  readonly maxDurationSec?: number;
  /** True for loops, false for one-shots, undefined if unstated. */
  readonly loop?: boolean;
  /** Everything recognised, for showing the user what was understood. */
  readonly understood: Readonly<Record<string, string>>;
}

/**
 * Words that carry no retrieval value.
 *
 * Dropped rather than searched, because sample metadata is written by
 * uploaders describing a sound, not answering a question — "can you find
 * me a" matches nothing and dilutes the terms that would have.
 */
const FILLER = new Set([
  'a',
  'an',
  'the',
  'some',
  'any',
  'me',
  'my',
  'i',
  'we',
  'you',
  'can',
  'could',
  'would',
  'please',
  'want',
  'need',
  'looking',
  'look',
  'find',
  'get',
  'give',
  'fetch',
  'search',
  'for',
  'of',
  'to',
  'with',
  'and',
  'or',
  'that',
  'this',
  'is',
  'are',
  'be',
  'something',
  'sound',
  'sounds',
  'sample',
  'samples',
  'audio',
  'track',
  'song',
  'like',
  'kind',
  'sort',
  'bit',
  'really',
  'very',
  'at',
  'in',
  'on',
  'it',
]);

/**
 * Words worth keeping even though they are short.
 *
 * The length filter below would otherwise drop them, and they are among
 * the most useful terms a request can contain.
 */
const KEEP_SHORT = new Set(['hat', 'kick', 'snare', 'pad', 'arp', 'sub', 'fx']);

/**
 * Adjectives that describe a sound's character.
 *
 * Tracked separately because they are the first thing worth dropping
 * when a query is too narrow: "gritty dusty drum loop" matching nothing
 * should fall back to "drum loop", not to "dusty drum loop". Without
 * this list the fallback would have to drop leading words blindly,
 * which throws away the instrument in a phrase like "snare one shot".
 */
const CHARACTER = new Set([
  'gritty',
  'dusty',
  'warm',
  'cold',
  'bright',
  'dark',
  'deep',
  'soft',
  'hard',
  'punchy',
  'tight',
  'loose',
  'dry',
  'wet',
  'lush',
  'thin',
  'fat',
  'crisp',
  'muddy',
  'clean',
  'dirty',
  'smooth',
  'rough',
  'heavy',
  'light',
  'distorted',
  'saturated',
  'crunchy',
  'airy',
  'mellow',
  'aggressive',
]);

/**
 * Genre and instrument words, which must survive into the query.
 *
 * These were originally lumped in with the adjectives above and dropped
 * as fluff, which is how "snare one shot for an ambient song" ended up
 * searching for "snare one shot" and returning jazz loops. To a producer
 * the genre *is* the request — it carries more intent than the
 * instrument half the time.
 *
 * They are still droppable, but last, and only after every texture word
 * has already gone.
 */
const GENRE = new Set([
  'ambient',
  'lofi',
  'lo-fi',
  'jazz',
  'house',
  'techno',
  'trap',
  'drill',
  'dnb',
  'jungle',
  'garage',
  'funk',
  'soul',
  'disco',
  'cinematic',
  'orchestral',
  'folk',
  'rock',
  'metal',
  'punk',
  'indie',
  'pop',
  'hiphop',
  'rnb',
  'reggae',
  'dub',
  'afrobeat',
  'latin',
  'classical',
  'choral',
  'vintage',
  'modern',
  'analog',
  'analogue',
  'digital',
  'dreamy',
  'ethereal',
  'organic',
  'synthetic',
]);

/** Whether a term only describes texture, not what the sound is. */
export function isCharacterWord(word: string): boolean {
  return CHARACTER.has(word.toLowerCase());
}

/** Whether a term names a genre or style. Kept in the query far longer. */
export function isGenreWord(word: string): boolean {
  return GENRE.has(word.toLowerCase());
}

/** Terms whose presence implies a loop, and the reverse. */
const LOOP_WORDS = ['loop', 'looped', 'looping', 'groove', 'beat', 'riff'];
const ONESHOT_WORDS = ['one shot', 'oneshot', 'one-shot', 'hit', 'stab'];

/** `90bpm`, `90 bpm`, `at 90`. */
const BPM_PATTERN =
  /(\d{2,3})\s*(?:bpm|beats per minute)\b|\bat\s+(\d{2,3})\b/i;

/** `F#m`, `C major`, `in Bb minor`. */
const KEY_PATTERN =
  /\b([A-G])\s?(#|b|sharp|flat)?\s?(maj(?:or)?|min(?:or)?|m)?\b(?=\s|$)/;

/** `under 5 seconds`, `at least 2s`, `3-8 seconds`. */
const MAX_DURATION_PATTERN =
  /(?:under|less than|shorter than|max|up to)\s+(\d+)\s*(?:s|sec|secs|seconds)?\b/i;
const MIN_DURATION_PATTERN =
  /(?:over|more than|longer than|at least|min)\s+(\d+)\s*(?:s|sec|secs|seconds)?\b/i;

/**
 * Normalise a key to the form sample packs use.
 *
 * `"b flat minor"` and `"Bbm"` are the same key; collapsing them means a
 * caller can compare without re-parsing.
 */
function normaliseKey(
  note: string,
  accidental: string | undefined,
  quality: string | undefined
): string {
  const sign =
    accidental === 'sharp'
      ? '#'
      : accidental === 'flat'
        ? 'b'
        : (accidental ?? '');
  // Anchored, because a loose /^m/ also matches "major".
  const minor = quality ? /^(m|min(or)?)$/i.test(quality) : false;
  return `${note.toUpperCase()}${sign}${minor ? 'm' : ''}`;
}

/**
 * Parse a request into a search.
 *
 * Total by construction: an unparseable request still yields a query,
 * because searching for the user's exact words is a better failure than
 * refusing to search.
 */
export function parseSampleRequest(prompt: string): SampleQuery {
  const text = prompt.trim();
  const lower = text.toLowerCase();
  const understood: Record<string, string> = {};

  const bpmMatch = BPM_PATTERN.exec(lower);
  const bpm = bpmMatch ? Number(bpmMatch[1] ?? bpmMatch[2]) : undefined;
  // Guard the range: "at 2010" is a year, not a tempo.
  const validBpm =
    bpm !== undefined && bpm >= 40 && bpm <= 300 ? bpm : undefined;
  if (validBpm !== undefined) {
    understood.tempo = `${validBpm} bpm`;
  }

  // Run the key pattern on the original text: case distinguishes the note
  // `B` from the accidental `b`, and lowercasing loses that.
  const keyMatch = KEY_PATTERN.exec(text);
  const key =
    keyMatch && (keyMatch[2] || keyMatch[3])
      ? normaliseKey(keyMatch[1]!, keyMatch[2], keyMatch[3])
      : undefined;
  if (key) {
    understood.key = key;
  }

  const maxMatch = MAX_DURATION_PATTERN.exec(lower);
  const minMatch = MIN_DURATION_PATTERN.exec(lower);
  const maxDurationSec = maxMatch ? Number(maxMatch[1]) : undefined;
  const minDurationSec = minMatch ? Number(minMatch[1]) : undefined;
  if (maxDurationSec !== undefined) {
    understood.maxLength = `${maxDurationSec}s`;
  }
  if (minDurationSec !== undefined) {
    understood.minLength = `${minDurationSec}s`;
  }

  const wantsOneShot = ONESHOT_WORDS.some((word) => lower.includes(word));
  const wantsLoop =
    !wantsOneShot && LOOP_WORDS.some((word) => lower.includes(word));
  const loop = wantsOneShot ? false : wantsLoop ? true : undefined;
  if (loop !== undefined) {
    understood.type = loop ? 'loop' : 'one shot';
  }

  // Remove the key's own text as well as the structured fields: leaving
  // "f#m" in the terms made it an AND filter *and* a repeated extra.
  const keyText = keyMatch?.[0]?.toLowerCase();
  // Drop the words that only signalled loop-vs-one-shot. They are
  // captured in `loop` already, and leaving them in makes Openverse AND
  // on "one" and "shot", which matches any title containing "shot".
  const typeWords = wantsOneShot ? ONESHOT_WORDS : wantsLoop ? LOOP_WORDS : [];
  let stripped = lower;
  for (const word of typeWords) {
    stripped = stripped.split(word).join(' ');
  }

  const terms = stripped
    // Strip what the structured fields already captured, so "90bpm" does
    // not also go into the text query and exclude everything untagged.
    .replace(BPM_PATTERN, ' ')
    .replace(keyText ? keyText : /(?!)/, ' ')
    .replace(MAX_DURATION_PATTERN, ' ')
    .replace(MIN_DURATION_PATTERN, ' ')
    .replace(/[^a-z0-9#\s-]/g, ' ')
    .split(/\s+/)
    .filter(
      (word) =>
        word.length > 0 &&
        !FILLER.has(word) &&
        (word.length > 2 || KEEP_SHORT.has(word))
    )
    .join(' ')
    .trim();

  if (terms) {
    understood.terms = terms;
  }

  return {
    // Falling back to the raw prompt beats searching for nothing when a
    // request is all filler, like "find me something".
    terms: terms || text,
    bpm: validBpm,
    key,
    minDurationSec,
    maxDurationSec,
    loop,
    understood,
  };
}
