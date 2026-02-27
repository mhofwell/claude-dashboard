import { createHmac, timingSafeEqual } from "crypto";

export function verifySignature(
  body: string,
  signature: string,
  secret: string
): boolean {
  if (!signature || !signature.startsWith("sha256=")) return false;

  const expected = createHmac("sha256", secret).update(body).digest("hex");
  const provided = signature.slice("sha256=".length);

  if (expected.length !== provided.length) return false;

  return timingSafeEqual(Buffer.from(expected), Buffer.from(provided));
}
