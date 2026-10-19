import { describe, expect, it } from "vitest";
import { addStats, claudeStats, codexStats, priceUsd } from "../src/main/tabStats.js";
import { parseTitle } from "../src/main/titles.js";
import { dayLabel, formatDuration, formatTokens, formatUsd } from "../src/shared/historyFormat.js";

const line = (entry: object) => JSON.stringify(entry);
const usage = { input_tokens: 10, output_tokens: 100, cache_creation_input_tokens: 1000, cache_read_input_tokens: 5000, cache_creation: { ephemeral_1h_input_tokens: 0 } };

describe("claude transcript stats", () => {
  const transcript = [
    line({ type: "user", timestamp: "2026-10-19T10:00:00Z", message: { role: "user", content: "fix the split bug" } }),
    // One response written as two lines, each repeating its usage.
    line({ type: "assistant", requestId: "r1", timestamp: "2026-10-19T10:00:05Z", message: { model: "claude-opus-5-5", usage } }),
    line({ type: "assistant", requestId: "r1", timestamp: "2026-10-19T10:00:06Z", message: { model: "claude-opus-5-5", usage } }),
    line({ type: "user", timestamp: "2026-10-19T10:00:07Z", message: { role: "user", content: [{ type: "tool_result", content: "ok" }] } }),
    line({ type: "assistant", requestId: "r2", timestamp: "2026-10-19T10:00:30Z", message: { model: "claude-opus-5-5", usage } }),
    line({ type: "user", timestamp: "2026-10-19T11:00:00Z", message: { role: "user", content: [{ type: "text", text: "now the history" }] } }),
    line({ type: "assistant", requestId: "r3", timestamp: "2026-10-19T11:01:00Z", message: { model: "claude-opus-5-5", usage } }),
    "not json",
  ].join("\n");

  it("counts each response once", () => {
    expect(claudeStats(transcript).tokens).toEqual({ input: 30, output: 300, cacheWrite: 3000, cacheRead: 15000 });
  });

  it("times each turn from its prompt to its last line, not the gap between turns", () => {
    expect(claudeStats(transcript).agentMs).toBe(30_000 + 60_000);
  });

  it("prices the responses and keeps the first prompt", () => {
    const stats = claudeStats(transcript);
    expect(stats.costUsd).toBeCloseTo(3 * priceUsd("claude-opus-5-5", { input: 10, output: 100, cacheWrite: 1000, cacheRead: 5000 })!);
    expect(stats.firstPrompt).toBe("fix the split bug");
    expect(stats.model).toBe("claude-opus-5-5");
  });

  it("leaves the cost unknown for a model with no price", () => {
    const unknown = line({ type: "assistant", requestId: "x", message: { model: "some-other-model", usage } });
    expect(claudeStats(unknown).costUsd).toBeNull();
  });
});

describe("pricing", () => {
  it("prices a 1 hour cache write at twice the input rate", () => {
    expect(priceUsd("claude-opus-5-5", { input: 0, output: 0, cacheWrite: 1_000_000, cacheRead: 0, cacheWrite1h: 1_000_000 })).toBeCloseTo(8);
    expect(priceUsd("claude-opus-5-5", { input: 0, output: 0, cacheWrite: 1_000_000, cacheRead: 0 })).toBeCloseTo(5);
  });

  it("uses the listed cache read rate where there is one", () => {
    expect(priceUsd("claude-sonnet-5-5", { input: 0, output: 0, cacheWrite: 0, cacheRead: 1_000_000 })).toBeCloseTo(0.2);
    expect(priceUsd("claude-haiku-4-5", { input: 0, output: 0, cacheWrite: 0, cacheRead: 1_000_000 })).toBeCloseTo(0.1);
  });
});

describe("codex transcript stats", () => {
  it("takes the last running total and leaves cost unknown", () => {
    const transcript = [
      line({ type: "turn_context", payload: { model: "gpt-5-codex" } }),
      line({ type: "event_msg", payload: { type: "token_count", info: { total_token_usage: { input_tokens: 100, cached_input_tokens: 40, output_tokens: 5 } } } }),
      line({ type: "event_msg", payload: { type: "token_count", info: { total_token_usage: { input_tokens: 300, cached_input_tokens: 200, output_tokens: 20 } } } }),
    ].join("\n");
    expect(codexStats(transcript)).toEqual({ tokens: { input: 100, output: 20, cacheWrite: 0, cacheRead: 200 }, costUsd: null, agentMs: null, model: "gpt-5-codex" });
  });
});

describe("adding a tab's sessions", () => {
  it("keeps an unknown part unknown in the total", () => {
    const known = { tokens: { input: 1, output: 1, cacheWrite: 0, cacheRead: 0 }, costUsd: 1, agentMs: 1000 };
    const unknown = { ...known, costUsd: null };
    expect(addStats([known, known])?.costUsd).toBe(2);
    expect(addStats([known, unknown])?.costUsd).toBeNull();
    expect(addStats([])).toBeNull();
  });
});

describe("history formatting", () => {
  it("formats durations, tokens and money", () => {
    expect(formatDuration(null)).toBe("");
    expect(formatDuration(45_000)).toBe("45s");
    expect(formatDuration(12 * 60_000)).toBe("12m");
    expect(formatDuration(185 * 60_000)).toBe("3h 05m");
    expect(formatTokens(950)).toBe("950");
    expect(formatTokens(1_500)).toBe("1.5k");
    expect(formatTokens(2_300_000)).toBe("2.3M");
    expect(formatUsd(0.004)).toBe("<$0.01");
    expect(formatUsd(null)).toBe("");
  });

  it("files a visit under today, yesterday or its date", () => {
    const now = new Date(2026, 9, 19, 9).getTime();
    expect(dayLabel(new Date(2026, 9, 19, 1).getTime(), now)).toBe("Today");
    expect(dayLabel(new Date(2026, 9, 18, 23).getTime(), now)).toBe("Yesterday");
    expect(dayLabel(new Date(2026, 9, 14).getTime(), now)).not.toMatch(/Today|Yesterday/);
  });
});

describe("short titles", () => {
  it("reads the two lines a model replies with, capped at their word counts", () => {
    expect(parseTitle("Deck Navigation\nPreserve layers, add history")).toEqual({ short: "Deck Navigation", long: "Preserve layers, add history" });
    expect(parseTitle("line 1: \"Tab history\"\nline 2: Browser style history for every tab")).toEqual({ short: "Tab history", long: "Browser style history for every" });
    expect(parseTitle("just one line")).toBeUndefined();
  });
});
