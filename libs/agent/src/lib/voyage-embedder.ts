import { Embedder, HashingEmbedder } from './embeddings';

export interface VoyageEmbedderOptions {
  apiKey?: string;
  /** Voyage model. Default `voyage-3.5` (1024 dims). */
  model?: string;
  /** Must match the model's output size and the pgvector column. Default 1024. */
  dimension?: number;
  /** Injectable for tests; defaults to global `fetch`. */
  fetchImpl?: typeof fetch;
}

interface VoyageResponse {
  data: { embedding: number[]; index: number }[];
}

/**
 * Real embeddings via the Voyage AI API (Anthropic's embeddings partner). Uses
 * `fetch` only — no SDK. Reads `VOYAGE_API_KEY` from the env by default. The
 * `dimension` must match both the chosen model and the pgvector column
 * (`vector(N)`); switching to this from the stand-in needs a column migration.
 */
export class VoyageEmbedder implements Embedder {
  readonly dimension: number;
  private readonly apiKey: string;
  private readonly model: string;
  private readonly fetchImpl: typeof fetch;

  constructor(options: VoyageEmbedderOptions = {}) {
    this.apiKey = options.apiKey ?? process.env.VOYAGE_API_KEY ?? '';
    this.model = options.model ?? 'voyage-3.5';
    this.dimension = options.dimension ?? 1024;
    this.fetchImpl = options.fetchImpl ?? fetch;
  }

  async embed(texts: string[]): Promise<number[][]> {
    if (texts.length === 0) return [];
    if (!this.apiKey) throw new Error('VoyageEmbedder: VOYAGE_API_KEY is not set');

    const res = await this.fetchImpl('https://api.voyageai.com/v1/embeddings', {
      method: 'POST',
      headers: { authorization: `Bearer ${this.apiKey}`, 'content-type': 'application/json' },
      body: JSON.stringify({ model: this.model, input: texts }),
    });
    if (!res.ok) {
      throw new Error(`VoyageEmbedder: ${res.status} ${await res.text()}`);
    }
    const json = (await res.json()) as VoyageResponse;
    // Return in input order (the API includes an index per item).
    return [...json.data].sort((a, b) => a.index - b.index).map((d) => d.embedding);
  }
}

/**
 * Select an {@link Embedder} from the environment: the real Voyage embedder when
 * `VOYAGE_API_KEY` is set, otherwise the deterministic {@link HashingEmbedder}
 * (so tests/CI run offline and key-free).
 */
export function getEmbedder(): Embedder {
  return process.env.VOYAGE_API_KEY ? new VoyageEmbedder() : new HashingEmbedder();
}
