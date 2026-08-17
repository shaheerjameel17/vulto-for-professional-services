import type { GraphQuery } from "../query";
import type { GraphQueryResult, SQLiteGraphIndex } from "./storage/sqlite-graph-index";

export class GraphQuerySubscription {
  readonly #index: SQLiteGraphIndex;
  readonly #listener: (result: GraphQueryResult) => void;
  readonly #query: GraphQuery;
  #last = "";
  #pending = Promise.resolve();
  #unsubscribe: (() => void) | null;

  constructor(
    index: SQLiteGraphIndex,
    query: GraphQuery,
    listener: (result: GraphQueryResult) => void,
  ) {
    this.#index = index;
    this.#query = query;
    this.#listener = listener;
    this.#unsubscribe = index.subscribe(() => this.#schedule());
  }

  async start(): Promise<void> {
    await this.#emitIfChanged();
  }

  dispose(): void {
    this.#unsubscribe?.();
    this.#unsubscribe = null;
  }

  #schedule(): void {
    this.#pending = this.#pending.then(() => this.#emitIfChanged());
  }

  async #emitIfChanged(): Promise<void> {
    const result = await this.#index.execute(this.#query);
    const serialized = JSON.stringify(result);
    if (serialized === this.#last) return;
    this.#last = serialized;
    this.#listener(result);
  }
}
