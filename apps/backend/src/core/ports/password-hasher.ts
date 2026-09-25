/** Password hashing (Argon2id out of tree; fake in tests). */
export interface PasswordHasher {
  hash(password: string): Promise<string>;
  verify(password: string, hash: string): Promise<boolean>;
}

export const PASSWORD_HASHER = "PasswordHasher";
