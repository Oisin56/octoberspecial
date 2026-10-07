import { describe, expect, it } from "vitest";
import { cleanBody, cleanTitle } from "./cleanText";

describe("cleanBody", () => {
  it("removes markdown", () => {
    expect(cleanBody("## The Week Ahead\n\n**Oisin** has the *edge*.\n\n- one\n* two")).toBe("The Week Ahead\n\nOisin has the edge.\n\n- one\n– two");
  });
  it("recovers a body stored as JSON", () => {
    expect(cleanBody('{"title": "Heath", "body": "First para.\\n\\nSecond \\"quoted\\" para."}')).toBe('First para.\n\nSecond "quoted" para.');
  });
  it("recovers a cut-off JSON body", () => {
    expect(cleanBody('```json\n{"title": "Heath", "body": "First para.\\n\\nSecond para that was cut')).toBe("First para.\n\nSecond para that was cut");
  });
  it("keeps normal text and is idempotent", () => {
    const t = "Seven rounds. Two men.\n\nThe courses\nWicklow is windy: 6th over the sea.";
    expect(cleanBody(t)).toBe(t);
    expect(cleanBody(cleanBody("## A\n\n**b**"))).toBe(cleanBody("## A\n\n**b**"));
  });
  it("leaves maths and names alone", () => {
    expect(cleanBody("He was 2*3 holes up; the snake_case stays and so does 5 * 4.")).toBe("He was 2*3 holes up; the snake_case stays and so does 5 * 4.");
    expect(cleanTitle('"**Heath and heartache**"')).toBe("Heath and heartache");
  });
});
