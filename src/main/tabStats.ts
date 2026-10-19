// What an agent session cost and how long it worked, read from its transcript.
// Figures the transcript cannot back are null rather than zero: a zero reads
// as free or instant, which is a different claim.

export interface TokenUsage {
  input: number;
  output: number;
  cacheWrite: number;
  cacheRead: number;
}

export interface SessionStats {
  tokens: TokenUsage;
  /** Estimated from list prices; null when a model in it has no known price. */
  costUsd: number | null;
  /** Time from each prompt to the end of the turn it started; null when the transcript has no turns to time. */
  agentMs: number | null;
  model?: string;
  /** The first prompt, for a tab that never got a title of its own. */
  firstPrompt?: string;
}

/** Anthropic list prices in USD per million tokens. Cache writes are 1.25x
 *  input (5 minute) or 2x (1 hour); cache reads are the listed rate or 0.1x input. */
const prices: { match: RegExp; input: number; output: number; cacheRead?: number }[] = [
  { match: /fable|mythos/, input: 10, output: 50, cacheRead: 0.25 },
  { match: /opus-5-5/, input: 4, output: 20, cacheRead: 0.2 },
  { match: /opus-(5|4-[5-9])/, input: 5, output: 25 },
  { match: /opus/, input: 15, output: 75 },
  { match: /sonnet-5/, input: 2, output: 10, cacheRead: 0.2 },
  { match: /sonnet/, input: 3, output: 15 },
  { match: /haiku-4/, input: 1, output: 5 },
  { match: /haiku/, input: 0.8, output: 4 },
];

export function priceUsd(model: string, usage: TokenUsage & { cacheWrite1h?: number }): number | null {
  const price = prices.find((entry) => entry.match.test(model));
  if (!price) return null;
  const write1h = usage.cacheWrite1h ?? 0;
  const write5m = usage.cacheWrite - write1h;
  const perToken = (rate: number) => rate / 1_000_000;
  return usage.input * perToken(price.input)
    + usage.output * perToken(price.output)
    + write5m * perToken(price.input * 1.25)
    + write1h * perToken(price.input * 2)
    + usage.cacheRead * perToken(price.cacheRead ?? price.input * 0.1);
}

const emptyUsage = (): TokenUsage => ({ input: 0, output: 0, cacheWrite: 0, cacheRead: 0 });

/** A user line that starts a turn, as opposed to one carrying tool results back. */
function promptText(content: unknown): string | undefined {
  if (typeof content === "string") return content;
  if (!Array.isArray(content) || content.some((block) => block?.type === "tool_result")) return undefined;
  const text = content.filter((block) => block?.type === "text").map((block) => block.text).join(" ");
  return text || undefined;
}

export function claudeStats(transcript: string): SessionStats {
  const tokens = emptyUsage();
  let costUsd: number | null = 0;
  let model: string | undefined;
  let firstPrompt: string | undefined;
  let agentMs = 0;
  let turnStart: number | undefined;
  let turnEnd: number | undefined;
  let turns = 0;
  // One API response is written as several lines, one per content block, each
  // repeating the response's usage.
  const counted = new Set<string>();
  const closeTurn = () => { if (turnStart !== undefined && turnEnd !== undefined) { agentMs += Math.max(0, turnEnd - turnStart); turns++; } };
  for (const line of transcript.split("\n")) {
    if (!line.trim()) continue;
    let entry: { type?: string; isSidechain?: boolean; isMeta?: boolean; timestamp?: string; requestId?: string; message?: { id?: string; model?: string; content?: unknown; usage?: Record<string, number & { ephemeral_1h_input_tokens?: number }> & { cache_creation?: { ephemeral_1h_input_tokens?: number } } } };
    try { entry = JSON.parse(line); } catch { continue; }
    const at = entry.timestamp ? Date.parse(entry.timestamp) : NaN;
    if (entry.type === "user" && !entry.isSidechain && !entry.isMeta) {
      const prompt = promptText(entry.message?.content);
      if (prompt !== undefined && !Number.isNaN(at)) {
        closeTurn();
        turnStart = at;
        turnEnd = undefined;
        firstPrompt ??= prompt.trim().slice(0, 200);
        continue;
      }
    }
    if (turnStart !== undefined && !Number.isNaN(at) && (entry.type === "assistant" || entry.type === "user")) turnEnd = at;
    const usage = entry.message?.usage;
    const key = entry.requestId ?? entry.message?.id;
    if (entry.type !== "assistant" || !usage || (key && counted.has(key))) continue;
    if (key) counted.add(key);
    const used: TokenUsage & { cacheWrite1h: number } = {
      input: usage.input_tokens ?? 0,
      output: usage.output_tokens ?? 0,
      cacheWrite: usage.cache_creation_input_tokens ?? 0,
      cacheRead: usage.cache_read_input_tokens ?? 0,
      cacheWrite1h: usage.cache_creation?.ephemeral_1h_input_tokens ?? 0,
    };
    tokens.input += used.input;
    tokens.output += used.output;
    tokens.cacheWrite += used.cacheWrite;
    tokens.cacheRead += used.cacheRead;
    const responseModel = entry.message?.model;
    if (responseModel && responseModel !== "<synthetic>") model = responseModel;
    const cost = responseModel ? priceUsd(responseModel, used) : null;
    costUsd = cost === null || costUsd === null ? null : costUsd + cost;
  }
  closeTurn();
  return { tokens, costUsd, agentMs: turns ? agentMs : null, model, firstPrompt };
}

/** Codex writes running totals, so the last count is the session's. No price
 *  table is kept for its models, so cost and turn timing stay unknown. */
export function codexStats(transcript: string): SessionStats {
  const tokens = emptyUsage();
  let model: string | undefined;
  for (const line of transcript.split("\n")) {
    if (!line.includes("token_count") && !line.includes("turn_context")) continue;
    let entry: { type?: string; payload?: { type?: string; model?: string; info?: { total_token_usage?: Record<string, number> } } };
    try { entry = JSON.parse(line); } catch { continue; }
    if (entry.type === "turn_context" && entry.payload?.model) model = entry.payload.model;
    const total = entry.payload?.type === "token_count" ? entry.payload.info?.total_token_usage : undefined;
    if (!total) continue;
    tokens.cacheRead = total.cached_input_tokens ?? 0;
    tokens.input = (total.input_tokens ?? 0) - tokens.cacheRead;
    tokens.cacheWrite = total.cache_write_input_tokens ?? 0;
    tokens.output = total.output_tokens ?? 0;
  }
  return { tokens, costUsd: null, agentMs: null, model };
}

/** Sums several sessions of one tab. Unknown in any part stays unknown in the whole. */
export function addStats(all: SessionStats[]): SessionStats | null {
  if (!all.length) return null;
  const tokens = emptyUsage();
  let costUsd: number | null = 0;
  let agentMs: number | null = 0;
  for (const stats of all) {
    tokens.input += stats.tokens.input;
    tokens.output += stats.tokens.output;
    tokens.cacheWrite += stats.tokens.cacheWrite;
    tokens.cacheRead += stats.tokens.cacheRead;
    costUsd = costUsd === null || stats.costUsd === null ? null : costUsd + stats.costUsd;
    agentMs = agentMs === null || stats.agentMs === null ? null : agentMs + stats.agentMs;
  }
  return { tokens, costUsd, agentMs, model: all.at(-1)?.model, firstPrompt: all[0].firstPrompt };
}
