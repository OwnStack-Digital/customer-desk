import type { OrganizationProfile } from "../domain/config";

/** Read-only access to the deployment organization profile (file-backed). */
export interface OrganizationProfileRepository {
  getProfile(): OrganizationProfile;
}

export const ORGANIZATION_PROFILE_REPOSITORY = "OrganizationProfileRepository";
