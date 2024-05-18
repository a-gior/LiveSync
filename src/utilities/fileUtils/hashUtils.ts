import * as crypto from "crypto";

export function generateHash(
  name: string,
  size: number,
  modifiedTime: Date,
): string {
  const hash = crypto.createHash("sha256");
  hash.update(`${name}${size}${modifiedTime.toISOString()}`);
  return hash.digest("hex");
}
