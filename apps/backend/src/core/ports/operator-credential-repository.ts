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

  /**
   * Every credential of this organization. The session guard resolves the
   * operator email with it (carried note 14): the single-operator
   * deployment has exactly one credential, and the guard fails closed
   * when that assumption does not hold.
   */
  listByOrganization(
    organizationId: string,
  ): Promise<readonly OperatorCredential[]>;
}

export const OPERATOR_CREDENTIAL_REPOSITORY = "OperatorCredentialRepository";
