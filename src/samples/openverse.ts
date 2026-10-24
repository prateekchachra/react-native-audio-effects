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

import { isCharacterWord, isGenreWord, type SampleQuery } from './query';

const ENDPOINT = 'https://api.openverse.org/v1/audio/';

/**
 * Timing, chosen from measured behaviour rather than guessed.
 *
 * Openverse does not degrade gracefully: a healthy response comes back in
 * about 60ms, and an unhealthy one hangs until the client gives up. Three
 * consecutive probes measured 63ms, 30s (timeout), 30s (timeout). There is
 * no middle ground to wait for.
 *
 * So the per-request timeout is short — two seconds is already thirty
 * times a healthy response — and the budget is spent on retrying rather
 * than on waiting. A long timeout buys nothing against a hung connection
 * and costs the user the whole wait.
 */
const REQUEST_TIMEOUT_MS = 2_500;
const MAX_ATTEMPTS = 3;

/**
 * How long to wait before firing a duplicate request.
 *
 * The hang is a property of the individual connection, not of the
 * service — a request that stalls stays stalled while a fresh one
 * alongside it returns normally. So rather than wait out a timeout and
 * retry, this races: if the first request has not answered within the
 * hedge delay, a second goes out and whichever answers first wins.
 *
 * 400ms is comfortably above a healthy 63ms response, so a working
 * request is never duplicated, and far below the 2.5s timeout, so a
 * stalled one is overtaken early instead of blocking the budget.
 */
const HEDGE_DELAY_MS = 400;

/**
 * Ceiling for an entire search, across every variant and retry.
 *
 * Without this the relaxation loop multiplies out: four variants times
 * three attempts times the request timeout. The UI sat on "Searching…"
 * for minutes. Bounding the whole operation matters more than bounding
 * any single request.
 */
export const SEARCH_BUDGET_MS = 12_000;

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
  /** Ceiling for the whole search. Defaults to {@link SEARCH_BUDGET_MS}. */
  budgetMs?: number;
  /** Called with each query variant as it is tried, for a status line. */
  onProgress?: (terms: string) => void;
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

  // Drop texture adjectives first — "gritty", "warm". They narrow hard
  // and are the least likely to appear in an uploader's title.
  const withoutTexture = words.filter((word) => !isCharacterWord(word));
  if (withoutTexture.length > 0 && withoutTexture.length < words.length) {
    relaxed.push(withoutTexture.join(' '));
  }

  // Genre goes only after that, and only if something is still left.
  // "ambient" is most of the intent in "snare for an ambient song", so
  // it should be the last thing surrendered, not the first.
  const withoutGenre = withoutTexture.filter((word) => !isGenreWord(word));
  if (withoutGenre.length > 0 && withoutGenre.length < withoutTexture.length) {
    relaxed.push(withoutGenre.join(' '));
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

/**
 * Longest a one-shot can plausibly be.
 *
 * Asking for a one shot and being handed a four-minute loop is the
 * clearest way the search can be wrong, and length is the one signal
 * that separates them reliably — Openverse has no field for it. Three
 * seconds covers a long reverbed cymbal and excludes anything looping.
 */
const ONE_SHOT_MAX_SEC = 3;

/** Keep only results inside the requested duration window. */
function withinDuration(
  results: SampleResult[],
  query: SampleQuery
): SampleResult[] {
  // A stated one-shot implies a length bound even when the user gave
  // no number, which is almost always.
  const maxSec =
    query.maxDurationSec ??
    (query.loop === false ? ONE_SHOT_MAX_SEC : undefined);
  const minSec = query.minDurationSec;

  if (minSec === undefined && maxSec === undefined) {
    return results;
  }
  query = { ...query, minDurationSec: minSec, maxDurationSec: maxSec };
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
  options: SearchOptions,
  deadline: number
): Promise<SampleResult[]> {
  const url = `${ENDPOINT}?${buildSearchParams(terms, options).toString()}`;
  const controllers: AbortController[] = [];

  /** One request, abortable and bounded by both the timeout and deadline. */
  const attempt = async (index: number): Promise<SampleResult[]> => {
    if (index > 0) {
      await sleep(HEDGE_DELAY_MS * index);
    }
    const remaining = deadline - Date.now();
    if (remaining <= 0) {
      throw new Error('Sample search timed out.');
    }

    const controller = new AbortController();
    controllers.push(controller);
    const window = Math.max(1, Math.min(REQUEST_TIMEOUT_MS, remaining));
    const timer = setTimeout(() => controller.abort(), window);
    const onAbort = () => controller.abort();
    options.signal?.addEventListener('abort', onAbort);

    try {
      const response = await fetch(url, {
        headers: { Accept: 'application/json' },
        signal: controller.signal,
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
    } finally {
      clearTimeout(timer);
      options.signal?.removeEventListener('abort', onAbort);
    }
  };

  const hedged = Array.from({ length: MAX_ATTEMPTS }, (_, i) => attempt(i));
  try {
    // First success wins; rejects only if every hedge fails.
    return await Promise.any(hedged);
  } catch (error) {
    if (error instanceof AggregateError) {
      const first = error.errors[0];
      throw first instanceof Error ? first : new Error(String(first));
    }
    throw error;
  } finally {
    // Whoever lost the race is still holding a socket open.
    for (const controller of controllers) {
      controller.abort();
    }
  }
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
  const deadline = Date.now() + (options.budgetMs ?? SEARCH_BUDGET_MS);
  let lastError: Error | undefined;

  for (const terms of queryVariants(query)) {
    if (Date.now() >= deadline) {
      break;
    }
    options.onProgress?.(terms);
    try {
      const results = withinDuration(
        await fetchVariant(terms, options, deadline),
        query
      );
      if (results.length > 0) {
        return results;
      }
    } catch (error) {
      // One variant failing is not the search failing: the next is
      // broader and may well succeed inside the remaining budget.
      lastError = error instanceof Error ? error : new Error(String(error));
    }
  }

  // Only surface an error if nothing was reachable. A genuine zero-result
  // search is an answer, not a failure.
  if (lastError && Date.now() >= deadline) {
    throw new Error(
      'Sample search timed out. Openverse is not responding — try again.'
    );
  }
  if (lastError) {
    throw lastError;
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
