/**
 * Sample search over Openverse.
 *
 * ## Why Openverse
 *
 * Splice has no public API. Freesound's needs a registered key, which
 * means nobody can try this feature without signing up first. Openverse
 * indexes Freesound among other providers, serves direct CDN audio URLs,
 * and takes no authentication at all — so sample search works the moment
 * the library is installed.
 *
 * Everything it returns is openly licensed, but *openly* is not *without
 * obligation*: most results are CC-BY and require attribution. Licence
 * and creator come back on every result for exactly that reason, and
 * {@link attributionFor} formats a usable credit line.
 */

import { isCharacterWord, type SampleQuery } from './query';

const ENDPOINT = 'https://api.openverse.org/v1/audio/';

/** Openverse occasionally returns an empty body; see {@link search}. */
const MAX_ATTEMPTS = 2;
const RETRY_DELAY_MS = 400;
// Openverse is slow under load; 15s was short enough to abort real
// searches during development.
const REQUEST_TIMEOUT_MS = 25_000;

export interface SampleResult {
  readonly id: string;
  readonly title: string;
  /** Direct audio URL, ready to hand to `AudioEngine.loadFile`. */
  readonly url: string;
  readonly creator?: string;
  /** Short licence code such as `cc0` or `by-sa`. */
  readonly license: string;
  readonly licenseUrl?: string;
  /** Where a human can see the original. */
  readonly landingUrl?: string;
  readonly durationSec?: number;
  /** Which service Openverse found it on, e.g. `freesound`. */
  readonly provider?: string;
}

export interface SearchOptions {
  /** How many results to ask for. Openverse caps this at 500. */
  pageSize?: number;
  /**
   * Restrict to licences with no attribution requirement.
   *
   * Worth offering because a user dropping a sample into a track they
   * will publish has a materially different obligation under CC0 than
   * under CC-BY.
   */
  publicDomainOnly?: boolean;
  signal?: AbortSignal;
}

/** Raw Openverse shape, narrowed at the boundary. */
interface RawResult {
  id?: unknown;
  title?: unknown;
  url?: unknown;
  creator?: unknown;
  license?: unknown;
  license_url?: unknown;
  foreign_landing_url?: unknown;
  duration?: unknown;
  provider?: unknown;
}

function text(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

/**
 * Query variants for a request, most specific first.
 *
 * Openverse ANDs its search terms, so every extra word is a filter that
 * can empty the result set. Measured against the live API: "gritty drum
 * loop" returns 29 results, and adding "90bpm" returns 0 — uploaders do
 * sometimes put a tempo in the title, but far too rarely to require it.
 *
 * Rather than choose once between precision and recall, {@link search}
 * walks this list until something comes back. The first variant asks for
 * everything the user said; the last asks only for the head noun.
 */
export function queryVariants(query: SampleQuery): string[] {
  const base = query.terms.trim();
  const variants: string[] = [];

  const extras = [
    query.bpm !== undefined ? `${query.bpm}bpm` : undefined,
    query.key,
  ].filter((value): value is string => value !== undefined);

  if (extras.length > 0) {
    variants.push([base, ...extras].join(' '));
  }
  variants.push(base);

  const words = base.split(/\s+/).filter(Boolean);
  const relaxed: string[] = [];

  // Drop character adjectives first: they narrow hard and are the least
  // likely to appear in an uploader's title. What remains names the
  // instrument, which is the part that has to match.
  const substantive = words.filter((word) => !isCharacterWord(word));
  if (substantive.length > 0 && substantive.length < words.length) {
    relaxed.push(substantive.join(' '));
  }

  // Last resort: the final two words, which in an English noun phrase
  // usually carry the head — "drum loop", "vinyl crackle".
  if (words.length > 2) {
    relaxed.push(words.slice(-2).join(' '));
  }

  // Longest first, so the fallbacks still run most to least specific.
  relaxed.sort((a, b) => b.split(' ').length - a.split(' ').length);
  variants.push(...relaxed);

  // Dedupe while keeping order; the variants often collapse.
  return variants.filter(
    (variant, index) =>
      variant.length > 0 && variants.indexOf(variant) === index
  );
}

/**
 * Build the parameters for one query variant.
 *
 * Note what is *not* set: `category`. It looks like the obvious filter
 * for a loop request, but Openverse files plenty of real loops under
 * sound effects — "gritty drum loop" drops from 29 results to 0 with
 * `category=music` applied. Duration filtering below is the honest way
 * to separate loops from one-shots.
 */
export function buildSearchParams(
  terms: string,
  options: SearchOptions = {}
): URLSearchParams {
  const params = new URLSearchParams({
    q: terms,
    page_size: String(options.pageSize ?? 20),
  });
  if (options.publicDomainOnly) {
    params.set('license', 'cc0,pdm');
  }
  return params;
}

/** Narrow one raw result, dropping anything without a playable URL. */
function toResult(raw: RawResult): SampleResult | undefined {
  const url = text(raw.url);
  const id = text(raw.id);
  if (!url || !id) {
    return undefined;
  }
  // Openverse reports duration in milliseconds.
  const durationMs =
    typeof raw.duration === 'number' ? raw.duration : undefined;
  return {
    id,
    title: text(raw.title) ?? 'Untitled',
    url,
    creator: text(raw.creator),
    license: text(raw.license) ?? 'unknown',
    licenseUrl: text(raw.license_url),
    landingUrl: text(raw.foreign_landing_url),
    durationSec: durationMs !== undefined ? durationMs / 1000 : undefined,
    provider: text(raw.provider),
  };
}

/** Keep only results inside the requested duration window. */
function withinDuration(
  results: SampleResult[],
  query: SampleQuery
): SampleResult[] {
  if (
    query.minDurationSec === undefined &&
    query.maxDurationSec === undefined
  ) {
    return results;
  }
  return results.filter((result) => {
    // A result with no reported duration is kept: excluding it would
    // silently drop valid samples for missing metadata.
    if (result.durationSec === undefined) {
      return true;
    }
    if (
      query.minDurationSec !== undefined &&
      result.durationSec < query.minDurationSec
    ) {
      return false;
    }
    if (
      query.maxDurationSec !== undefined &&
      result.durationSec > query.maxDurationSec
    ) {
      return false;
    }
    return true;
  });
}

const sleep = (ms: number) =>
  new Promise<void>((resolve) => setTimeout(resolve, ms));

/**
 * Fetch one query variant.
 *
 * Retries on an empty body, which Openverse returns intermittently — a
 * 200 with nothing in it, observed roughly one request in three during
 * development. Three attempts makes it rare enough not to surface.
 */
async function fetchVariant(
  terms: string,
  options: SearchOptions
): Promise<SampleResult[]> {
  const url = `${ENDPOINT}?${buildSearchParams(terms, options).toString()}`;
  let lastError: Error | undefined;

  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    if (attempt > 0) {
      await sleep(RETRY_DELAY_MS * attempt);
    }
    // A caller-supplied signal must still win over the timeout.
    const timeout = new AbortController();
    const timer = setTimeout(() => timeout.abort(), REQUEST_TIMEOUT_MS);
    const onAbort = () => timeout.abort();
    options.signal?.addEventListener('abort', onAbort);

    try {
      const response = await fetch(url, {
        headers: { Accept: 'application/json' },
        signal: timeout.signal,
      });
      if (!response.ok) {
        throw new Error(`Openverse returned HTTP ${response.status}.`);
      }
      const body = await response.text();
      if (body.trim().length === 0) {
        throw new Error('Openverse returned an empty response.');
      }
      const parsed = JSON.parse(body) as { results?: unknown };
      const raw = Array.isArray(parsed.results) ? parsed.results : [];
      return raw
        .map((item) => toResult(item as RawResult))
        .filter((item): item is SampleResult => item !== undefined);
    } catch (error) {
      // A caller-initiated abort is not a transport hiccup; stop.
      if (options.signal?.aborted) {
        throw error;
      }
      lastError = error instanceof Error ? error : new Error(String(error));
    } finally {
      clearTimeout(timer);
      options.signal?.removeEventListener('abort', onAbort);
    }
  }

  throw new Error(
    `Sample search failed after ${MAX_ATTEMPTS} attempts: ${lastError?.message}`
  );
}

/**
 * Search, relaxing the query until something comes back.
 *
 * Openverse ANDs its terms, so the most faithful rendering of a request
 * is frequently the one that matches nothing. Walking from specific to
 * general means a detailed request still returns *something* useful,
 * which is what a user asking an agent for a sound expects.
 */
export async function search(
  query: SampleQuery,
  options: SearchOptions = {}
): Promise<SampleResult[]> {
  for (const terms of queryVariants(query)) {
    const results = withinDuration(await fetchVariant(terms, options), query);
    if (results.length > 0) {
      return results;
    }
  }
  return [];
}

/**
 * A credit line for a result.
 *
 * Most of what Openverse indexes is CC-BY, which obliges anyone shipping
 * the sample to name the creator and the licence. Returning this next to
 * the audio makes that the easy path rather than an afterthought.
 */
export function attributionFor(result: SampleResult): string {
  const creator = result.creator ? ` by ${result.creator}` : '';
  const source = result.provider ? ` via ${result.provider}` : '';
  return `"${result.title}"${creator}${source} — ${result.license.toUpperCase()}`;
}
