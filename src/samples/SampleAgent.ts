/**
 * Ask for a sample in plain English and get one back, loaded and ready.
 *
 * Three steps: interpret the request, search for it, load the result into
 * the engine. The first is pluggable, the second defaults to Openverse
 * (no API key), and the third goes through the normal file importer —
 * which downloads remote URLs into the same cache a picked document uses.
 *
 * ## The optional model
 *
 * `interpret` lets a language model replace the built-in parser:
 *
 * ```ts
 * const agent = new SampleAgent({
 *   interpret: async (prompt) => {
 *     const reply = await myModel(prompt);
 *     return { terms: reply.terms, bpm: reply.bpm, understood: {} };
 *   },
 * });
 * ```
 *
 * It is a hook rather than a dependency because every free model needs a
 * key, and the feature has to work without one. A model mainly buys
 * better handling of phrasing the vocabulary parser has no entry for —
 * "that sound from early Burial records" — which is worth having and is
 * not worth blocking the feature on.
 */

import { AudioEngine } from '../api/AudioEngine';
import type { Source } from '../api/Source';
import { parseSampleRequest, type SampleQuery } from './query';
import {
  attributionFor,
  search,
  type SampleResult,
  type SearchOptions,
} from './openverse';

export interface SampleAgentOptions {
  /** Replace the built-in request parser, e.g. with a language model. */
  interpret?: (prompt: string) => Promise<SampleQuery> | SampleQuery;
  /** Replace the search backend. */
  searcher?: (
    query: SampleQuery,
    options: SearchOptions
  ) => Promise<SampleResult[]>;
  /** Results per search. */
  pageSize?: number;
  /** Restrict to licences that need no attribution. */
  publicDomainOnly?: boolean;
}

export interface SampleSearch {
  /** What the agent understood, for showing back to the user. */
  readonly query: SampleQuery;
  readonly results: readonly SampleResult[];
}

export interface LoadedSample {
  readonly source: Source;
  readonly result: SampleResult;
  /** Credit line; required by most licences Openverse indexes. */
  readonly attribution: string;
}

export class SampleAgent {
  private readonly options: SampleAgentOptions;

  constructor(options: SampleAgentOptions = {}) {
    this.options = options;
  }

  /** Interpret a request and search for it. */
  async find(prompt: string, signal?: AbortSignal): Promise<SampleSearch> {
    const trimmed = prompt.trim();
    if (!trimmed) {
      throw new Error('Describe the sample you are looking for.');
    }
    const query = await (this.options.interpret?.(trimmed) ??
      parseSampleRequest(trimmed));
    const searcher = this.options.searcher ?? search;
    const results = await searcher(query, {
      pageSize: this.options.pageSize,
      publicDomainOnly: this.options.publicDomainOnly,
      signal,
    });
    return { query, results };
  }

  /**
   * Load a result into the engine.
   *
   * The remote URL goes straight to `loadFile`; the native importer
   * downloads it into its cache and decodes it there, so a sample from
   * the network behaves exactly like one the user picked off disk.
   */
  async load(result: SampleResult): Promise<LoadedSample> {
    const source = await AudioEngine.loadFile(result.url);
    return { source, result, attribution: attributionFor(result) };
  }

  /** Find and load the best match in one step. */
  async fetch(prompt: string, signal?: AbortSignal): Promise<LoadedSample> {
    const { results } = await this.find(prompt, signal);
    const best = results[0];
    if (!best) {
      throw new Error(`Nothing found for "${prompt}". Try different words.`);
    }
    return this.load(best);
  }
}
