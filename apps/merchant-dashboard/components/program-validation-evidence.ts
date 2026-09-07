import { apiFetch } from "../lib/api-client";

const requiredValidationPreviewProfiles = [
  "CUSTOMER_WEB",
  "APPLE_WALLET",
  "GOOGLE_WALLET",
] as const;

/**
 * Materializes the server-owned provider evidence when a merchant explicitly
 * asks to validate a saved draft. This is deliberately not used by the live
 * Dashboard preview: editing remains entirely local and never waits for a
 * server-generated preview image.
 */
export async function materializeProgramValidationEvidence({
  organizationId,
  programId,
  locale,
}: {
  organizationId: string;
  programId: string;
  locale: string;
}): Promise<void> {
  for (const profile of requiredValidationPreviewProfiles) {
    const query = new URLSearchParams({ progress: "0", profile, locale });
    await apiFetch(
      `/v1/organizations/${organizationId}/programs/${programId}/preview?${query.toString()}`,
    );
  }
}
