import type { Classification, ClassifierInput } from "../domain/processing";

/**
 * Intent classification for one inbound message. Implementations return lane
 * slots only and throw on infrastructure failure (timeout-style errors are
 * recorded as `failed` revisions by the use case).
 */
export interface ClassifierPort {
  classify(input: ClassifierInput): Promise<Classification>;
}

export const CLASSIFIER_PORT = "ClassifierPort";
