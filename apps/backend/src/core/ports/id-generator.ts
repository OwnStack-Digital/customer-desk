/** ULID strings for every entity and opaque session id. */
export interface IdGenerator {
  nextId(): string;
}

export const ID_GENERATOR = "IdGenerator";
