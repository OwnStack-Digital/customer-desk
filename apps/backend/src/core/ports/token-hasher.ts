/**
 * One-way hashing for opaque session ids. Only the hash is persisted, so a
 * database leak does not yield usable cookies.
 */
export interface TokenHasher {
  hash(token: string): string;
}

export const TOKEN_HASHER = "TokenHasher";
