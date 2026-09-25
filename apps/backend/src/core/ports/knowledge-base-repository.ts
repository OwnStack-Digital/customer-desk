import type { KnowledgeBase } from "../domain/config";

/** Read-only access to approved, versioned answer blocks (file-backed). */
export interface KnowledgeBaseRepository {
  getKnowledgeBase(): KnowledgeBase;
}

export const KNOWLEDGE_BASE_REPOSITORY = "KnowledgeBaseRepository";
