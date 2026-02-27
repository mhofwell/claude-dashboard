import { describe, it, expect } from "bun:test";
import { verifySignature } from "./verify";
import { createHmac } from "crypto";

const SECRET = "test-secret";

function sign(body: string, secret: string): string {
  const hmac = createHmac("sha256", secret);
  hmac.update(body);
  return "sha256=" + hmac.digest("hex");
}

describe("verifySignature", () => {
  it("returns true for valid signature", () => {
    const body = '{"action":"push"}';
    const sig = sign(body, SECRET);
    expect(verifySignature(body, sig, SECRET)).toBe(true);
  });

  it("returns false for invalid signature", () => {
    const body = '{"action":"push"}';
    expect(verifySignature(body, "sha256=bad", SECRET)).toBe(false);
  });

  it("returns false for missing signature", () => {
    expect(verifySignature("{}", "", SECRET)).toBe(false);
  });

  it("returns false for wrong prefix", () => {
    const body = "{}";
    const sig = sign(body, SECRET);
    expect(verifySignature(body, sig.replace("sha256=", "sha1="), SECRET)).toBe(false);
  });
});
