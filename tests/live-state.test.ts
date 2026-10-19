import { describe, expect, it } from "vitest";
import { activate, bootChoice, markHealthy, prunable, rollback, type LiveBuild, type LiveState } from "../src/main/liveState.js";

const build = (id: string, builtAt = 0): LiveBuild => ({ id, dir: `/live/${id}`, commit: id, builtAt });
const exists = () => true;

describe("live builds", () => {
  it("runs a new build on trial and keeps it once it reports ready", () => {
    const started = bootChoice(activate({}, build("a")), exists);
    expect(started.run?.id).toBe("a");
    expect(started.state.trial).toEqual({ id: "a", attempts: 1 });
    const healthy = markHealthy(started.state, "a");
    expect(healthy.trial).toBeUndefined();
    expect(healthy.lastGood?.id).toBe("a");
    expect(bootChoice(healthy, exists).run?.id).toBe("a");
  });

  it("goes back to the last good build when a trial never reported ready", () => {
    const good = markHealthy(activate({}, build("good")), "good");
    const crashed = bootChoice(activate(good, build("bad")), exists).state;
    const next = bootChoice(crashed, exists);
    expect(next.run?.id).toBe("good");
    expect(next.state.trial).toBeUndefined();
    expect(next.state.failed).toMatchObject({ commit: "bad", reason: "did not start" });
  });

  it("falls back to the installed build when nothing has worked yet", () => {
    const crashed = bootChoice(activate({}, build("bad")), exists).state;
    expect(bootChoice(crashed, exists).run).toBeUndefined();
  });

  it("skips a build whose files are gone", () => {
    const good: LiveState = markHealthy(activate({}, build("good")), "good");
    const next = bootChoice({ ...good, active: build("gone") }, (file) => !file.includes("gone"));
    expect(next.run?.id).toBe("good");
  });

  it("only marks the build on trial healthy", () => {
    const state = activate({}, build("a"));
    expect(markHealthy(state, "other")).toBe(state);
  });

  it("does not fall back to the build that is failing", () => {
    const good = markHealthy(activate({}, build("a")), "a");
    expect(rollback(good, "x").active).toBeUndefined();
  });

  it("keeps the active, last good and newest builds", () => {
    const builds = [build("old", 1), build("good", 2), build("b", 3), build("c", 4), build("d", 5), build("e", 6)];
    const state = { active: build("e", 6), lastGood: build("good", 2) };
    expect(prunable(builds, state).map((b) => b.id)).toEqual(["old", "b"]);
  });
});
