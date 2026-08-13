import type { Prisma } from "@waflo/database";

export const REVIEW_FIXTURE_IDS = {
  user: "9e000000-0000-4000-8000-000000000001",
  organization: "9e000000-0000-4000-8000-000000000002",
  member: "9e000000-0000-4000-8000-000000000003",
  location: "9e000000-0000-4000-8000-000000000004",
  program: "9e000000-0000-4000-8000-000000000005",
  programVersion: "9e000000-0000-4000-8000-000000000006",
  purchaseProgram: "9e000000-0000-4000-8000-000000000007",
  purchaseProgramVersion: "9e000000-0000-4000-8000-000000000008",
  filledAsset: "9e000000-0000-4000-8000-000000000009",
  emptyAsset: "9e000000-0000-4000-8000-000000000010",
  milestoneReward: "9e000000-0000-4000-8000-000000000011",
  finalReward: "9e000000-0000-4000-8000-000000000012",
  purchaseFinalReward: "9e000000-0000-4000-8000-000000000013",
  seedDevice: "9e000000-0000-4000-8000-000000000014",
} as const;

export const REVIEW_SCENARIOS = [
  {
    id: "CUSTOMER_NEW",
    membershipId: "9f000000-0000-4000-8000-000000000001",
    customerId: "9d000000-0000-4000-8000-000000000001",
    membershipPublicId: "mem_review_new_00000001",
    credentialPublicId: "cred_review_new_00000001",
    programVersionId: REVIEW_FIXTURE_IDS.programVersion,
    targetProgress: 0,
  },
  {
    id: "CUSTOMER_ACTIVE_5_OF_8",
    membershipId: "9f000000-0000-4000-8000-000000000002",
    customerId: "9d000000-0000-4000-8000-000000000002",
    membershipPublicId: "mem_review_active_000002",
    credentialPublicId: "cred_review_active_000002",
    programVersionId: REVIEW_FIXTURE_IDS.programVersion,
    targetProgress: 5,
  },
  {
    id: "CUSTOMER_REWARD_READY_8_OF_8",
    membershipId: "9f000000-0000-4000-8000-000000000003",
    customerId: "9d000000-0000-4000-8000-000000000003",
    membershipPublicId: "mem_review_ready_000003",
    credentialPublicId: "cred_review_ready_000003",
    programVersionId: REVIEW_FIXTURE_IDS.programVersion,
    targetProgress: 8,
  },
  {
    id: "MANAGER_APPROVAL_REQUIRED",
    membershipId: "9f000000-0000-4000-8000-000000000004",
    customerId: "9d000000-0000-4000-8000-000000000004",
    membershipPublicId: "mem_review_approval_0004",
    credentialPublicId: "cred_review_approval_0004",
    programVersionId: REVIEW_FIXTURE_IDS.programVersion,
    targetProgress: 5,
  },
  {
    id: "PURCHASE_THRESHOLD_FAILURE",
    membershipId: "9f000000-0000-4000-8000-000000000005",
    customerId: "9d000000-0000-4000-8000-000000000005",
    membershipPublicId: "mem_review_purchase_0005",
    credentialPublicId: "cred_review_purchase_0005",
    programVersionId: REVIEW_FIXTURE_IDS.purchaseProgramVersion,
    targetProgress: 0,
  },
  {
    id: "BILLING_BLOCKED",
    membershipId: "9f000000-0000-4000-8000-000000000006",
    customerId: "9d000000-0000-4000-8000-000000000006",
    membershipPublicId: "mem_review_billing_00006",
    credentialPublicId: "cred_review_billing_00006",
    programVersionId: REVIEW_FIXTURE_IDS.programVersion,
    targetProgress: 0,
  },
  {
    id: "INVALID_QR",
    membershipId: "9f000000-0000-4000-8000-000000000007",
    customerId: "9d000000-0000-4000-8000-000000000007",
    membershipPublicId: "mem_review_invalid_000007",
    credentialPublicId: "cred_review_invalid_000007",
    programVersionId: REVIEW_FIXTURE_IDS.programVersion,
    targetProgress: 0,
  },
] as const;

export type ReviewScenarioId = (typeof REVIEW_SCENARIOS)[number]["id"];
export type StaffSessionMode = "NORMAL" | "REVIEW";

export function isReviewWindowActive(
  enabled: boolean,
  expiresAt: string,
  now = new Date(),
): boolean {
  const expiry = new Date(expiresAt);
  return enabled && Number.isFinite(expiry.getTime()) && expiry > now;
}

/** Shares the first invariant lock with every loyalty mutation in this tenant. */
export function reviewInvariantLockKeys(): readonly string[] {
  return [`organization:${REVIEW_FIXTURE_IDS.organization}`];
}

export function sessionModeFromMetadata(value: Prisma.JsonValue | null): StaffSessionMode {
  if (
    value &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    "sessionMode" in value &&
    value.sessionMode === "REVIEW"
  ) {
    return "REVIEW";
  }
  return "NORMAL";
}

export function reviewSessionMetadata(
  source: Record<string, unknown> = {},
): Prisma.InputJsonObject {
  return { ...source, sessionMode: "REVIEW" } as Prisma.InputJsonObject;
}

export function isExactReviewSessionBinding(
  value:
    | {
        sessionMode?: string;
        organizationId?: string;
        organizationMemberId?: string;
        locationId?: string;
      }
    | null
    | undefined,
): boolean {
  return (
    value?.sessionMode === "REVIEW" &&
    value.organizationId === REVIEW_FIXTURE_IDS.organization &&
    value.organizationMemberId === REVIEW_FIXTURE_IDS.member &&
    value.locationId === REVIEW_FIXTURE_IDS.location
  );
}

export function isExactActiveReviewDevice(
  value:
    | {
        organizationId: string;
        organizationMemberId: string;
        installationId: string;
        publicKey: string;
        trustLevel: string;
        status: string;
      }
    | null
    | undefined,
  expected: { installationId: string; publicKey: string },
): boolean {
  return (
    value?.organizationId === REVIEW_FIXTURE_IDS.organization &&
    value.organizationMemberId === REVIEW_FIXTURE_IDS.member &&
    value.installationId === expected.installationId &&
    value.publicKey === expected.publicKey &&
    value.trustLevel === "REVIEW" &&
    value.status === "ACTIVE"
  );
}
