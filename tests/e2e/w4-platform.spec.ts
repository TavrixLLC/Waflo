import "dotenv/config";
import { mkdir } from "node:fs/promises";
import { generateKeyPairSync, randomUUID, sign } from "node:crypto";
import { expect, type Page, test } from "@playwright/test";

const screenshots = "test-results/evidence/handoff-w4-round-1/screenshots";
const organizationId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const disposableCustomerId = randomUUID();
const disposableMembershipId = randomUUID();
const disposableCustomerName = `W4 Erasure Evidence ${randomUUID().slice(0, 8)}`;
const qrStaffName = `W4 QR Staff ${randomUUID().slice(0, 8)}`;
let wrongLocationPairingToken = "";
let prisma: Awaited<ReturnType<typeof connectPrisma>>;

async function connectPrisma() {
  const { createPrismaClient } = await import("../../packages/database/dist/src/client.js");
  return createPrismaClient();
}

async function capture(page: Page, name: string) {
  await mkdir(screenshots, { recursive: true });
  await page.screenshot({
    path: `${screenshots}/${name}.png`,
    fullPage: true,
    animations: "disabled",
  });
}

async function login(page: Page, email = "owner@waflo.local") {
  await page.goto("/en/login");
  await page.locator('input[name="email"]').fill(email);
  await page.locator('input[name="password"]').fill("Waflo-Development-2026");
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page).toHaveURL(/\/en\/dashboard(?:\/|$)/);
  if (email === "owner@waflo.local") {
    const organizationSwitcher = page.locator(".wf-org-switcher select");
    await organizationSwitcher.selectOption(organizationId);
    await expect(organizationSwitcher).toHaveValue(organizationId);
  }
}

async function searchCustomer(page: Page, query: string, name: string) {
  const search = page.locator(".dashboard-form-card form input").first();
  await search.fill(query);
  await page.getByRole("button", { name: /^(Search|بحث)$/ }).click();
  await expect(page.getByRole("button", { name, exact: true })).toBeVisible();
}

async function openProgramTestMode(page: Page, programName: string) {
  const program = await prisma.loyaltyProgram.findFirstOrThrow({
    where: { organizationId, internalName: programName },
    select: { id: true },
  });
  await page.goto(`/en/dashboard/programs/${program.id}/test`);
  const studioNavigation = page.getByRole("navigation", { name: "Studio sections" });
  const createUpdate = page.getByRole("button", { name: "Create update" });
  const startDemoCustomer = page.getByRole("button", { name: "Start demo customer" });
  await expect(createUpdate.or(startDemoCustomer)).toBeVisible();
  if (await createUpdate.isVisible()) {
    await createUpdate.click();
    await expect(startDemoCustomer).toBeVisible();
  }
  await studioNavigation.getByRole("button", { name: /^(?:Review & launch|Launch)/u }).click();
  await page.locator(".studio-launch-action").getByRole("button", { name: "Run checks" }).click();
  await expect(page.getByText("Setup, asset, and preview checks passed.")).toBeVisible();
  await studioNavigation.getByRole("button", { name: /^Test/u }).click();
}

test.describe
  .serial("Waflo W4 real loyalty operations", () => {
    test.beforeAll(async () => {
      prisma = await connectPrisma();
      const now = new Date();
      await prisma.managerApprovalChallenge.update({
        where: { id: "94000000-0000-4000-8000-000000000001" },
        data: {
          status: "PENDING",
          approvedByUserId: null,
          approvedAt: null,
          rejectedAt: null,
          consumedAt: null,
          expiresAt: new Date(now.getTime() + 10 * 60_000),
        },
      });
      await prisma.managerApprovalChallenge.update({
        where: { id: "94000000-0000-4000-8000-000000000002" },
        data: {
          status: "APPROVED",
          approvedByUserId: "11111111-1111-4111-8111-111111111111",
          approvedAt: now,
          rejectedAt: null,
          consumedAt: null,
          expiresAt: new Date(now.getTime() + 10 * 60_000),
        },
      });
      await prisma.operationalRiskSignal.updateMany({
        where: {
          id: {
            in: ["90000000-0000-4000-8000-000000000001", "90000000-0000-4000-8000-000000000002"],
          },
        },
        data: {
          status: "OPEN",
          acknowledgedByUserId: null,
          acknowledgedAt: null,
          resolvedByUserId: null,
          resolvedAt: null,
          resolutionNote: null,
        },
      });
      const policyProgramIds = [
        "d0000000-0000-4000-8000-000000000001",
        "e0000000-0000-4000-8000-000000000001",
      ];
      await prisma.loyaltyProgramVersion.updateMany({
        where: {
          programId: { in: policyProgramIds },
          status: { in: ["DRAFT", "VALIDATED", "TEST_READY"] },
        },
        data: { status: "ABANDONED", abandonedAt: now },
      });
      await prisma.loyaltyProgram.updateMany({
        where: { id: { in: policyProgramIds } },
        data: { currentDraftVersionId: null },
      });
      const policyPrograms = await prisma.loyaltyProgram.findMany({
        where: {
          id: {
            in: policyProgramIds,
          },
        },
        select: {
          currentDraftVersionId: true,
          currentPublishedVersionId: true,
        },
      });
      const policyVersionIds = policyPrograms.flatMap((program) =>
        [program.currentDraftVersionId, program.currentPublishedVersionId].filter(
          (versionId): versionId is string => Boolean(versionId),
        ),
      );
      const policySessions = await prisma.programTestSession.findMany({
        where: { versionId: { in: policyVersionIds } },
        select: { id: true },
      });
      await prisma.programTestEvent.deleteMany({
        where: { sessionId: { in: policySessions.map((session) => session.id) } },
      });
      await prisma.programTestSession.deleteMany({
        where: { id: { in: policySessions.map((session) => session.id) } },
      });
      await prisma.devicePairingSession.updateMany({
        where: {
          organizationId,
          status: { in: ["PENDING", "CLAIMED"] },
        },
        data: { status: "CANCELED" },
      });
      const staff = await prisma.organizationMember.findFirstOrThrow({
        where: {
          organizationId,
          userId: "44444444-4444-4444-8444-444444444444",
        },
      });
      const { createPairingToken } = await import(
        "../../packages/staff-device-security/dist/index.js"
      );
      const pairingPublicId = randomUUID();
      const pairing = createPairingToken({
        publicId: pairingPublicId,
        environmentId: process.env.NODE_ENV ?? "development",
      });
      wrongLocationPairingToken = pairing.token;
      await prisma.devicePairingSession.create({
        data: {
          publicId: pairingPublicId,
          organizationId,
          intendedStaffMemberId: staff.id,
          pairingTokenHash: pairing.tokenHash,
          requestedLocationAssignments: [
            {
              locationId: "a1111111-1111-4111-8111-111111111111",
              earningAllowed: true,
              redemptionAllowed: true,
            },
          ],
          deviceLabelSuggestion: "Wrong Location evidence client",
          createdByUserId: "11111111-1111-4111-8111-111111111111",
          expiresAt: new Date(Date.now() + 10 * 60_000),
        },
      });
      await prisma.customer.create({
        data: {
          id: disposableCustomerId,
          organizationId,
          displayName: disposableCustomerName,
          preferredLocale: "EN",
          memberships: {
            create: {
              id: disposableMembershipId,
              organizationId,
              programId: "c0000000-0000-4000-8000-000000000001",
              enrollmentProgramVersionId: "c1000000-0000-4000-8000-000000000001",
              publicMembershipId: `mem_W4Erasure${randomUUID().replaceAll("-", "").slice(0, 24)}`,
              progress: { create: { organizationId } },
            },
          },
        },
      });
    });

    test.afterAll(async () => {
      await prisma.$disconnect();
    });

    test("Owner reviews customers, pinned progress, ledger details, rewards, and projection integrity", async ({
      page,
    }) => {
      await login(page);
      await page.goto("/en/dashboard/customers");
      await expect(page.getByRole("heading", { name: "Customers and memberships" })).toBeVisible();
      await expect(page.getByRole("table", { name: "Organization customers" })).toBeVisible();
      await capture(page, "01-customers-populated");

      await searchCustomer(page, "zero@example.test", "Noor Zero");
      await capture(page, "02-customers-search");
      await page.getByRole("button", { name: "Noor Zero", exact: true }).click();
      await expect(page.getByRole("dialog")).toContainText("z***@e*****.test");
      await page.getByRole("button", { name: "Close" }).click();

      await searchCustomer(page, "Zaid Completed Cycle", "Zaid Completed Cycle");
      await page.getByRole("button", { name: "Zaid Completed Cycle", exact: true }).click();
      await expect(page.getByRole("dialog")).toContainText("0 / 8");
      await capture(page, "27-membership-zero-of-eight");
      await page.getByRole("button", { name: "Close" }).click();

      await searchCustomer(page, "Sara Milestone", "Sara Milestone");
      await page.getByRole("button", { name: "Sara Milestone", exact: true }).click();
      await expect(page.getByRole("dialog")).toContainText("5 / 8");
      await capture(page, "28-membership-five-of-eight");
      await page.getByRole("button", { name: "Open ledger" }).click();
      await expect(page.getByRole("table", { name: "Membership ledger" })).toBeVisible();
      await expect(page.getByRole("table", { name: "Membership rewards" })).toBeVisible();
      await capture(page, "04-membership-ledger");

      await page.getByRole("button", { name: "STAMP_ISSUED", exact: true }).click();
      await expect(page.getByRole("heading", { name: "Operation detail" })).toBeVisible();
      await capture(page, "29-operation-detail");
      await page.getByRole("button", { name: "Close" }).last().click();

      const projectionDialog = page.waitForEvent("dialog");
      await page.getByRole("button", { name: "Verify projection" }).click();
      const projectionResult = await projectionDialog;
      expect(projectionResult.message()).toContain("Ledger and projection match");
      await projectionResult.accept();
      await capture(page, "30-projection-verification");
    });

    test("Owner manages Staff QR access, manager approvals, risk review, analytics, and exports", async ({
      page,
    }) => {
      await login(page);
      await page.goto("/en/dashboard/devices");
      await expect(page).toHaveURL(/\/en\/dashboard\/team$/);
      await page.getByRole("button", { name: "Add staff" }).click();
      await page.locator('input[name="name"]').fill(qrStaffName);
      await page.getByRole("button", { name: "Create staff" }).click();
      const staffRow = page.getByRole("row").filter({ hasText: qrStaffName });
      await expect(staffRow).toContainText("QR sign-in · no email");
      await capture(page, "31-staff-access-contexts");
      await staffRow.getByRole("button", { name: "Sign-in QR" }).click();
      await page.getByRole("button", { name: "Generate QR" }).click();
      await expect(page.getByRole("dialog")).toContainText("This is the only valid code");
      await expect(page.getByRole("dialog").locator("img")).toHaveAttribute("alt", /Pair/i);
      await capture(page, "09-staff-sign-in-qr");
      await page.getByRole("button", { name: "Done" }).click();

      await page.goto("/en/dashboard/approvals");
      const approvalTable = page.getByRole("table", { name: "Manager approval challenges" });
      await expect(approvalTable).toContainText("PENDING");
      await expect(approvalTable).toContainText("APPROVED");
      await capture(page, "32-manager-approval-pending");
      const pendingRow = approvalTable.getByRole("row").filter({ hasText: "Maha Reward Ready" });
      page.once("dialog", (dialog) => dialog.accept("Verified in the W4 browser evidence flow."));
      await pendingRow.getByRole("button", { name: "Approve" }).click();
      await expect(
        page.getByText("The redeem intent is no longer eligible for approval."),
      ).toBeVisible();
      await page.reload();
      await expect(
        page
          .getByRole("table", { name: "Manager approval challenges" })
          .getByRole("row")
          .filter({ hasText: "Maha Reward Ready" }),
      ).toContainText("EXPIRED");
      await capture(page, "33-stale-manager-approval-blocked");

      await page.goto("/en/dashboard/risk");
      const riskTable = page.getByRole("table", { name: "Operational risk signals" });
      await expect(riskTable).toContainText("UNUSUAL_REVERSAL_PATTERN");
      await capture(page, "10-risk-signals");
      await riskTable
        .getByRole("row")
        .filter({ hasText: "UNUSUAL_REVERSAL_PATTERN" })
        .getByRole("button", { name: "Details" })
        .click();
      await expect(page.getByRole("heading", { name: "Risk signal detail" })).toBeVisible();
      await expect(page.getByRole("dialog")).toContainText("Safe evidence");
      await capture(page, "34-risk-detail");
      await page.getByRole("button", { name: "Close" }).click();

      await page.goto("/en/dashboard/analytics");
      await expect(
        page.getByRole("main").getByRole("heading", { name: "Analytics" }),
      ).toBeVisible();
      await page.getByRole("button", { name: "Loyalty cards" }).click();
      await expect(page.getByRole("table", { name: "Loyalty cards analytics" })).toBeVisible();
      await capture(page, "12-analytics-program-comparison");

      await page.goto("/en/dashboard/exports");
      await expect(page.getByRole("table", { name: "Current export jobs" })).toBeVisible();
      await capture(page, "13-export-completed");
    });

    test("Owner completes privacy export and ledger-preserving customer erasure", async ({
      page,
    }) => {
      await login(page);
      await page.goto("/en/dashboard/customers");
      await searchCustomer(page, disposableCustomerName, disposableCustomerName);
      await page.getByRole("button", { name: disposableCustomerName, exact: true }).click();

      page.once("dialog", (dialog) => dialog.accept("Customer data access request."));
      await page.getByRole("button", { name: "Privacy export" }).click();
      await expect(page.getByRole("dialog")).toContainText("EXPORT");
      await capture(page, "35-privacy-export-request");

      page.once("dialog", (dialog) => dialog.accept("Verified customer erasure request."));
      await page.getByRole("button", { name: "Request erasure" }).click();
      await expect(page.getByRole("dialog")).toContainText("ERASURE");
      await expect
        .poll(
          async () =>
            (
              await prisma.customer.findUniqueOrThrow({
                where: { id: disposableCustomerId },
                select: { status: true },
              })
            ).status,
          { timeout: 30_000 },
        )
        .toBe("ARCHIVED");
      await page.getByRole("button", { name: "Close" }).click();
      await page.locator(".dashboard-form-card form input").first().fill("Erased customer");
      await page.getByRole("button", { name: "Search", exact: true }).click();
      const erasedCustomer = page.getByRole("button", { name: /^Erased customer/ }).first();
      await expect(erasedCustomer).toBeVisible();
      await erasedCustomer.click();
      await expect(page.getByRole("dialog")).toContainText("ARCHIVED");
      await capture(page, "36-erased-anonymized-customer");

      const retainedLedgerEvents = await prisma.loyaltyLedgerEntry.count({
        where: { membershipId: disposableMembershipId },
      });
      expect(retainedLedgerEvents).toBeGreaterThan(0);
    });

    test("Test Mode visibly enforces daily cap, purchase threshold, and currency", async ({
      page,
    }) => {
      await login(page);
      await page.goto("/en/dashboard/programs");
      await openProgramTestMode(page, "Daily Coffee");
      await page.getByRole("button", { name: "Start demo customer" }).click();
      await page.getByRole("button", { name: "+5 stamps" }).click();
      await page.getByRole("button", { name: "Add a stamp" }).click();
      await expect(
        page.getByText(
          "The demo customer reached the daily stamp limit. Real customers are unaffected. Change the simulated day or reset the demo customer.",
        ),
      ).toBeVisible();
      await capture(page, "37-daily-cap-blocked");

      await openProgramTestMode(page, "Qualifying Purchase");
      await page.getByRole("button", { name: "Start demo customer" }).click();
      await page.getByRole("button", { name: "Add a stamp" }).click();
      await expect(
        page.getByText(
          "Enter a purchase amount to continue this demo. Real customers are unaffected.",
        ),
      ).toBeVisible();
      await capture(page, "38-purchase-amount-required");

      await page.getByText("Demo purchase details", { exact: true }).click();
      await page.getByLabel("Purchase amount").fill("10000");
      await page.getByLabel("Purchase currency").fill("USD");
      await page.getByRole("button", { name: "Add a stamp" }).click();
      await expect(
        page.getByText(
          "The demo purchase currency must match the card's configured currency. Real customers are unaffected.",
        ),
      ).toBeVisible();
      await capture(page, "39-purchase-currency-mismatch");

      await page.getByLabel("Purchase amount").fill("9999");
      await page.getByLabel("Purchase currency").fill("IQD");
      await page.getByRole("button", { name: "Add a stamp" }).click();
      await expect(
        page.getByText(
          "The demo purchase does not meet the card's minimum amount. Real customers are unaffected.",
        ),
      ).toBeVisible();
      await capture(page, "41-purchase-threshold-blocked");
    });

    test("Signed Staff Test Client visibly proves wrong-location blocking", async ({
      page,
      request,
    }) => {
      const keys = generateKeyPairSync("ed25519");
      const publicKey = keys.publicKey.export({ format: "pem", type: "spki" }).toString();
      const claimResponse = await request.post(
        "http://localhost:4000/v1/staff/devices/pairing/claim",
        {
          data: {
            pairingToken: wrongLocationPairingToken,
            installationId: `w4-wrong-location-${randomUUID()}`,
            publicKey,
            platform: "TEST_CLIENT",
            appVersion: "w4-evidence/1.0",
            osVersion: process.version,
            model: "Playwright",
          },
        },
      );
      expect(claimResponse.status()).toBe(200);
      const claimEnvelope = (await claimResponse.json()) as {
        data: { pairingPublicId: string; challenge: string; message: string };
      };
      const claim = claimEnvelope.data;
      const completeResponse = await request.post(
        "http://localhost:4000/v1/staff/devices/pairing/complete",
        {
          data: {
            pairingPublicId: claim.pairingPublicId,
            challenge: claim.challenge,
            signature: sign(null, Buffer.from(claim.message, "utf8"), keys.privateKey).toString(
              "base64url",
            ),
            displayName: "Wrong Location evidence client",
          },
        },
      );
      expect(completeResponse.status()).toBe(200);
      const completeEnvelope = (await completeResponse.json()) as {
        data: {
          device: { publicId: string };
          session: { id: string; token: string };
          context: { organizationId: string; locationId: string };
        };
      };
      const paired = completeEnvelope.data;
      const device = await prisma.staffDevice.findUniqueOrThrow({
        where: { publicId: paired.device.publicId },
      });
      await prisma.staffDeviceLocation.update({
        where: {
          staffDeviceId_locationId: {
            staffDeviceId: device.id,
            locationId: paired.context.locationId,
          },
        },
        data: { active: false },
      });

      const credential = await prisma.membershipCredential.findFirstOrThrow({
        where: {
          membershipId: "60000000-0000-4000-8000-000000000005",
          status: "ACTIVE",
        },
      });
      const [
        { decodeSecret, deriveMembershipCredentialSecret },
        { formatMembershipQrPayload },
        { parseEnvironment },
      ] = await Promise.all([
        import("../../packages/customer-security/dist/index.js"),
        import("../../packages/qr-core/dist/index.js"),
        import("../../packages/config/dist/index.js"),
      ]);
      const environment = parseEnvironment(process.env);
      const credentialSecret = {
        version: environment.MEMBERSHIP_CREDENTIAL_ACTIVE_SECRET_VERSION,
        secret: decodeSecret(environment.MEMBERSHIP_CREDENTIAL_SECRET_V1),
      };
      const qrPayload = formatMembershipQrPayload({
        publicCredentialId: credential.publicCredentialId,
        secretVersion: credential.secretVersion,
        secret: deriveMembershipCredentialSecret(
          credential.publicCredentialId,
          credential.credentialVersion,
          credentialSecret,
        ),
      });
      const path = "/v1/staff/operations/stamps";
      const payload = JSON.stringify({ qrPayload, amount: 1 });
      const { bodySha256, canonicalDeviceRequestEnvelope } = await import(
        "../../packages/staff-device-security/dist/index.js"
      );
      const requestId = randomUUID();
      const timestamp = new Date().toISOString();
      const nonce = randomUUID();
      const digest = bodySha256(payload);
      const signature = sign(
        null,
        Buffer.from(
          canonicalDeviceRequestEnvelope({
            method: "POST",
            canonicalPath: path,
            requestId,
            timestamp,
            nonce,
            bodyDigest: digest,
            deviceSessionId: paired.session.id,
            organizationId: paired.context.organizationId,
          }),
          "utf8",
        ),
        keys.privateKey,
      ).toString("base64url");
      const blockedResponse = await request.post(`http://localhost:4000${path}`, {
        headers: {
          authorization: `Device ${paired.session.token}`,
          "content-type": "application/json",
          "x-waflo-device-id": paired.device.publicId,
          "x-waflo-device-session-id": paired.session.id,
          "x-waflo-request-id": requestId,
          "x-waflo-timestamp": timestamp,
          "x-waflo-nonce": nonce,
          "x-waflo-body-sha256": digest,
          "x-waflo-signature": signature,
          "x-idempotency-key": randomUUID(),
        },
        data: payload,
      });
      const blockedBody = (await blockedResponse.json()) as {
        error: { code: string; message: string };
      };
      expect(blockedResponse.status(), JSON.stringify(blockedBody)).toBe(401);
      expect(blockedBody.error.code).toBe("STAFF_LOCATION_ASSIGNMENT_INVALID");

      await page.setContent(`
        <!doctype html>
        <html lang="en">
          <head>
            <meta charset="utf-8" />
            <title>W4 Staff Test Client evidence</title>
            <style>
              body { margin: 0; padding: 64px; background: #f6f1ed; color: #2b1914; font: 20px/1.5 Arial, sans-serif; }
              main { max-width: 920px; margin: auto; background: white; border-radius: 28px; padding: 48px; box-shadow: 0 20px 60px #2b191426; }
              small { color: #765c51; text-transform: uppercase; letter-spacing: .12em; }
              h1 { font-size: 42px; margin: 12px 0 24px; }
              .result { border: 2px solid #b3261e; background: #fff1f0; border-radius: 18px; padding: 24px; }
              code { color: #9c1c14; font-weight: 700; }
              li { margin: 12px 0; }
            </style>
          </head>
          <body>
            <main>
              <small>Development Staff Test Client · actual signed API response</small>
              <h1>Wrong Location blocked</h1>
              <div class="result">
                <p><strong>HTTP ${blockedResponse.status()}</strong></p>
                <p><code>${blockedBody.error.code}</code></p>
                <p>${blockedBody.error.message}</p>
              </div>
              <ul>
                <li>Ephemeral Ed25519 device key; private key was not persisted.</li>
                <li>Request was bound to the paired device, session, nonce, and location.</li>
                <li>No Membership QR, session token, signature, or customer data is displayed.</li>
              </ul>
            </main>
          </body>
        </html>
      `);
      await capture(page, "40-wrong-location-blocked");
    });

    test("Arabic RTL and Staff denial remain enforced", async ({ browser, page }) => {
      await login(page);
      await page.goto("/ar/dashboard/customers");
      await expect(page.locator("html")).toHaveAttribute("dir", "rtl");
      await expect(page.getByRole("heading", { name: "العملاء والعضويات" })).toBeVisible();
      await searchCustomer(page, "Sara Milestone", "Sara Milestone");
      await page.getByRole("button", { name: "Sara Milestone", exact: true }).click();
      await expect(page.getByRole("dialog")).toContainText("5 / 8");
      await capture(page, "23-arabic-customer-detail");
      await page.getByRole("button", { name: "Close" }).click();

      await page.goto("/ar/dashboard/devices");
      await expect(page).toHaveURL(/\/ar\/dashboard\/team$/);
      await page.getByRole("button", { name: "إضافة موظف" }).click();
      await expect(page.getByRole("dialog")).toBeVisible();
      await capture(page, "24-rtl-staff-creation");

      const staffContext = await browser.newContext();
      const staffPage = await staffContext.newPage();
      await login(staffPage, "staff@waflo.local");
      await staffPage.goto("/en/dashboard/customers");
      await expect(
        staffPage.getByText("This section requires Manager or Owner permission."),
      ).toBeVisible();
      await expect(staffPage.getByRole("link", { name: "Customers" })).toHaveCount(0);
      await capture(staffPage, "26-staff-access-denied");

      const crossTenantStatus = await staffPage.evaluate(async () => {
        const response = await fetch(
          "http://localhost:4000/v1/organizations/bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb/customers",
          { credentials: "include" },
        );
        return response.status;
      });
      expect(crossTenantStatus).toBe(403);
      await staffContext.close();
    });
  });
