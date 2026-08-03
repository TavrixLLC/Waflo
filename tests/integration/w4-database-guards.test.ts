import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createPrismaClient, type PrismaClient } from "../../packages/database/src/index.js";

const ORGANIZATION_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const SECOND_ORGANIZATION_ID = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const MEMBERSHIP_ID = "60000000-0000-4000-8000-000000000003";
const DEVICE_ID = "80000000-0000-4000-8000-000000000001";
const SECOND_LOCATION_ID = "b1111111-1111-4111-8111-111111111111";
const COOKIE_VERSION_ID = "c1000000-0000-4000-8000-000000000001";

const ledgerColumns = `
  id, public_id, organization_id, membership_id, customer_id, program_id,
  program_version_id, location_id, staff_organization_member_id, staff_device_id,
  event_type, membership_sequence, cycle_number, stamp_delta, reward_entitlement_id,
  reward_redemption_id, reversal_of_entry_id, operation_command_id,
  purchase_amount_minor, purchase_currency, merchant_transaction_reference,
  operational_timezone, operational_local_date, occurred_at, recorded_at,
  safe_metadata, ledger_hash_version, previous_entry_hash, entry_hash, created_at
`;

describe.sequential("W4 direct database guards", () => {
  let prisma: PrismaClient;

  beforeAll(() => {
    prisma = createPrismaClient();
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it("rejects ledger UPDATE and DELETE", async () => {
    await expect(
      prisma.$executeRawUnsafe(
        `UPDATE loyalty_ledger_entries SET safe_metadata = '{"mutated":true}'::jsonb
         WHERE membership_id = $1::uuid`,
        MEMBERSHIP_ID,
      ),
    ).rejects.toThrow(/WAFLO_LEDGER_APPEND_ONLY/);
    await expect(
      prisma.$executeRawUnsafe(
        "DELETE FROM loyalty_ledger_entries WHERE membership_id = $1::uuid",
        MEMBERSHIP_ID,
      ),
    ).rejects.toThrow(/WAFLO_LEDGER_APPEND_ONLY/);
  });

  it("rejects duplicate sequence and cross-tenant ledger insertion", async () => {
    await expect(
      prisma.$executeRawUnsafe(`
        INSERT INTO loyalty_ledger_entries (${ledgerColumns})
        SELECT gen_random_uuid(), gen_random_uuid(), organization_id, membership_id, customer_id,
          program_id, program_version_id, location_id, staff_organization_member_id,
          staff_device_id, event_type, membership_sequence, cycle_number, stamp_delta,
          reward_entitlement_id, reward_redemption_id, reversal_of_entry_id,
          operation_command_id, purchase_amount_minor, purchase_currency,
          merchant_transaction_reference, operational_timezone, operational_local_date,
          occurred_at, recorded_at, safe_metadata, ledger_hash_version,
          previous_entry_hash, entry_hash, now()
        FROM loyalty_ledger_entries
        WHERE membership_id = '${MEMBERSHIP_ID}'::uuid
        ORDER BY membership_sequence
        LIMIT 1
      `),
    ).rejects.toThrow(/unique|duplicate/i);

    await expect(
      prisma.$executeRawUnsafe(`
        INSERT INTO loyalty_ledger_entries (${ledgerColumns})
        SELECT gen_random_uuid(), gen_random_uuid(), '${SECOND_ORGANIZATION_ID}'::uuid,
          membership_id, customer_id, program_id, program_version_id, location_id,
          staff_organization_member_id, staff_device_id, event_type,
          membership_sequence + 100000, cycle_number, stamp_delta, reward_entitlement_id,
          reward_redemption_id, reversal_of_entry_id, operation_command_id,
          purchase_amount_minor, purchase_currency, merchant_transaction_reference,
          operational_timezone, operational_local_date, occurred_at, recorded_at,
          safe_metadata, ledger_hash_version, previous_entry_hash, entry_hash, now()
        FROM loyalty_ledger_entries
        WHERE membership_id = '${MEMBERSHIP_ID}'::uuid
        ORDER BY membership_sequence
        LIMIT 1
      `),
    ).rejects.toThrow(/WAFLO_LEDGER_MEMBERSHIP_CONTEXT_MISMATCH/);
  });

  it("rejects a projection version without its exact source event", async () => {
    await expect(
      prisma.$executeRawUnsafe(
        `UPDATE membership_progress_projections
         SET projection_version = projection_version + 1,
             last_ledger_sequence = last_ledger_sequence + 1,
             last_source_event_id = NULL
         WHERE membership_id = $1::uuid`,
        MEMBERSHIP_ID,
      ),
    ).rejects.toThrow(/WAFLO_PROJECTION_SOURCE_MISMATCH/);
  });

  it("rejects cross-tenant device assignment and device identity reassignment", async () => {
    await expect(
      prisma.$executeRawUnsafe(
        `INSERT INTO staff_device_locations
          (staff_device_id, location_id, earning_allowed, redemption_allowed, active, created_at)
         VALUES ($1::uuid, $2::uuid, true, true, true, now())`,
        DEVICE_ID,
        SECOND_LOCATION_ID,
      ),
    ).rejects.toThrow(/WAFLO_DEVICE_ASSIGNMENT_EXCEEDS_STAFF/);

    await expect(
      prisma.$executeRawUnsafe(
        "UPDATE staff_devices SET organization_id = $1::uuid WHERE id = $2::uuid",
        SECOND_ORGANIZATION_ID,
        DEVICE_ID,
      ),
    ).rejects.toThrow(/WAFLO_DEVICE_IDENTITY_IMMUTABLE/);
  });

  it("rejects cross-tenant reward mutation and published operational-policy mutation", async () => {
    await expect(
      prisma.$executeRawUnsafe(
        `UPDATE reward_entitlements
         SET organization_id = $1::uuid
         WHERE organization_id = $2::uuid
         AND id = (SELECT id FROM reward_entitlements WHERE organization_id = $2::uuid LIMIT 1)`,
        SECOND_ORGANIZATION_ID,
        ORGANIZATION_ID,
      ),
    ).rejects.toThrow(/WAFLO_REWARD_CONTEXT_MISMATCH/);

    await expect(
      prisma.$executeRawUnsafe(
        "UPDATE stamp_rules SET required_stamp_count = 9 WHERE version_id = $1::uuid",
        COOKIE_VERSION_ID,
      ),
    ).rejects.toThrow(/published|immutable|WAFLO/i);
  });

  it("rejects a risk signal that references a nonexistent Program", async () => {
    await expect(
      prisma.operationalRiskSignal.create({
        data: {
          organizationId: ORGANIZATION_ID,
          programId: randomUUID(),
          ruleCode: "INVALID_PROGRAM_REFERENCE_GUARD",
          severity: "LOW",
          score: 1,
          safeEvidence: { test: "foreign-key-guard" },
        },
      }),
    ).rejects.toMatchObject({ code: "P2003" });
  });
});
