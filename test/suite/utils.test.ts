import * as assert from "assert";

// Example parser you likely have:
type Op = "upload"|"download"|"save"|"create"|"delete"|"move"|"open";
function parseActionParam(raw: unknown): { check: boolean; action?: Op } | null {
  const v = String(raw ?? "").trim().toLowerCase();
  const OPS = new Set<Op>(["upload","download","save","create","delete","move","open"]);
  if (v === "none") {return { check: false };}
  if (v === "check") {return { check: true };}
  if (v.startsWith("check&") && OPS.has(v.slice(6) as Op)) {return { check: true, action: v.slice(6) as Op };}
  if (OPS.has(v as Op)) {return { check: false, action: v as Op };}
  return null;
}

suite("Utilities", () => {
  test("parseActionParam", () => {
    assert.deepEqual(parseActionParam("none"), { check: false });
    assert.deepEqual(parseActionParam("check&upload"), { check: true, action: "upload" });
    assert.equal(parseActionParam("wat"), null);
  });
});
