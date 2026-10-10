import { describe, expect, it } from "vitest";
import { readPlanJson } from "./planJson";

describe("readPlanJson", () => {
  it("reads plain JSON", () => {
    expect(readPlanJson('{"chapters":[{"round":1}]}')).toEqual({ chapters: [{ round: 1 }] });
  });
  it("reads JSON in a code fence with words around it", () => {
    expect(readPlanJson('Here is the plan:\n```json\n{"mood":"epic","chapters":[]}\n```\nEnjoy!')).toEqual({ mood: "epic", chapters: [] });
  });
  it("forgives trailing commas", () => {
    expect(readPlanJson('{"chapters":[{"round":1,"clips":[{"id":"a","payoff":"In it goes!",},],},],}')).toEqual({ chapters: [{ round: 1, clips: [{ id: "a", payoff: "In it goes!" }] }] });
  });
  it("forgives smart quotes used as JSON quotes", () => {
    expect(readPlanJson("{\u201cmood\u201d: \u201cepic\u201d}")).toEqual({ mood: "epic" });
  });
  it("keeps smart quotes inside a line", () => {
    expect(readPlanJson('{"openingVoice":"They call it \u201cthe Quarry\u201d."}')).toEqual({ openingVoice: "They call it \u201cthe Quarry\u201d." });
  });
  it("gives up on nonsense", () => {
    expect(readPlanJson("I'm sorry, I can't do that.")).toBeNull();
  });
});
