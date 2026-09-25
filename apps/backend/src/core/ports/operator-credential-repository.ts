import type { OperatorCredential } from "../domain/auth";

/** Stored operator credentials for this deployment's single organization. */
export interface OperatorCredentialRepository {
  findByEmail(
    organizationId: string,
    email: string,
  ): Promise<OperatorCredential | undefined>;

  create(credential: OperatorCredential): Promise<void>;

  /** Number of credentials in this organization (drives seed-on-boot). */
  count(organizationId: string): Promise<number>;
}

export const OPERATOR_CREDENTIAL_REPOSITORY = "OperatorCredentialRepository";
