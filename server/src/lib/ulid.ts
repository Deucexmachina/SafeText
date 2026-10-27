import { randomBytes } from "node:crypto";

const CROCKFORD = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";

// ULID: 48-bit ms timestamp + 80 bits of randomness, Crockford base32, 26 chars.
export function ulid(now: number = Date.now()): string {
  const chars = new Array<string>(26);

  let time = BigInt(now);
  for (let i = 9; i >= 0; i--) {
    chars[i] = CROCKFORD[Number(time % 32n)];
    time /= 32n;
  }

  let rand = BigInt(`0x${randomBytes(10).toString("hex")}`);
  for (let i = 25; i >= 10; i--) {
    chars[i] = CROCKFORD[Number(rand % 32n)];
    rand /= 32n;
  }
  return chars.join("");
}

export function scanId(): string {
  return `scn_${ulid()}`;
}
