import { copyFile, mkdir, stat, writeFile } from "node:fs/promises";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "..");
const source = path.join(root, "artifacts", "merchant-design-review");
const w3 = path.join(root, "test-results", "evidence", "handoff-w3-round-2", "screenshots");
const target = path.join(root, "artifacts", "lovable-transplant-review");

const required = {
  "01-marketing-home-desktop-en.png": "48-marketing-home-desktop-en.png",
  "02-marketing-pricing-desktop-en.png": "marketing-pricing-desktop-en.png",
  "03-marketing-home-desktop-ar.png": "49-marketing-home-desktop-ar.png",
  "04-marketing-home-mobile-en.png": "50-marketing-home-mobile-en.png",
  "05-marketing-home-mobile-ar.png": "51-marketing-home-mobile-ar.png",
  "06-marketing-loyalty-preview.png": "marketing-loyalty-preview.png",

  "10-login-desktop-en.png": "35-login-google-existing-user.png",
  "11-signup-desktop-en.png": "signup-desktop-en.png",
  "12-verify-email-desktop-en.png": "verify-email-desktop-en.png",
  "13-login-desktop-ar.png": "login-desktop-ar.png",
  "14-signup-mobile-en.png": "signup-mobile-en.png",
  "15-signup-mobile-ar.png": "signup-mobile-ar.png",

  "20-onboarding-business.png": "onboarding-business.png",
  "21-onboarding-location-mapbox.png": "location-mapbox-token-unset.png",
  "22-onboarding-plan.png": "30-signup-plan-cadence.png",
  "23-onboarding-billing.png": "31-signup-billing-details.png",
  "24-onboarding-payment.png": "32-signup-payment-element-BLOCKED.png",
  "25-onboarding-confirmation.png": "34-signup-success-trial.png",
  "26-onboarding-mobile.png": "onboarding-business-mobile.png",

  "30-overview-desktop-en.png": "01-overview-desktop-en.png",
  "31-loyalty-cards-desktop-en.png": "02-loyalty-cards-desktop-en.png",
  "32-loyalty-studio-desktop-en.png": "loyalty-card-prepublish-validation.png",
  "33-customers-desktop-en.png": "03-customers-desktop-en.png",
  "34-locations-desktop-en.png": "04-locations-desktop-en.png",
  "35-team-desktop-en.png": "05-team-desktop-en.png",
  "36-analytics-desktop-en.png": "06-analytics-desktop-en.png",
  "37-exports-desktop-en.png": "07-exports-desktop-en.png",
  "38-billing-desktop-en.png": "08-billing-desktop-en.png",
  "39-settings-desktop-en.png": "09-settings-desktop-en.png",
  "40-security-desktop-en.png": "10-security-desktop-en.png",

  "45-overview-desktop-ar.png": "11-overview-desktop-ar.png",
  "46-loyalty-cards-desktop-ar.png": "12-loyalty-cards-desktop-ar.png",
  "47-team-desktop-ar.png": "14-team-desktop-ar.png",
  "48-billing-desktop-ar.png": "15-billing-desktop-ar.png",

  "50-overview-mobile-en.png": "18-overview-mobile-en.png",
  "51-loyalty-mobile-en.png": "19-loyalty-cards-mobile-en.png",
  "52-team-mobile-en.png": "21-team-mobile-en.png",
  "53-billing-mobile-en.png": "22-billing-mobile-en.png",
  "54-overview-mobile-ar.png": "25-overview-mobile-ar.png",

  "60-customer-home-desktop-en.png": "customer-today-desktop-en.png",
  "61-customer-enrollment-desktop-en.png": "customer-enrollment.png",
  "62-customer-card-desktop-en.png": "customer-existing-membership.png",
  "63-customer-reward-ready.png": "customer-reward-ready.png",
  "64-customer-mobile-en.png": "customer-today-mobile-en.png",
  "65-customer-mobile-ar.png": "customer-today-mobile-ar.png",
  "66-customer-program-unavailable.png": "customer-program-unavailable.png",

  "70-dropdown-open.png": "44-country-dropdown-open.png",
  "71-modal.png": "38-add-staff-dialog.png",
  "72-drawer-mobile.png": "47-mobile-navigation.png",
  "73-empty-state.png": "46-empty-state.png",
  "74-error-state.png": "signup-duplicate-email-en.png",
  "75-billing-banner.png": "dashboard-billing-restricted-banner.png",
};

const extras = {
  "80-marketing-mobile-360-en.png": "marketing-home-mobile-360-en.png",
  "81-marketing-mobile-430-en.png": "marketing-home-mobile-430-en.png",
  "82-signup-mobile-360-en.png": "signup-mobile-360-en.png",
  "83-signup-mobile-430-en.png": "signup-mobile-430-en.png",
  "84-overview-mobile-360-en.png": "overview-mobile-360-en.png",
  "85-overview-mobile-430-en.png": "overview-mobile-430-en.png",
  "86-overview-mobile-360-ar.png": "overview-mobile-360-ar.png",
  "87-overview-mobile-430-ar.png": "overview-mobile-430-ar.png",
  "88-customer-mobile-360-en.png": "customer-today-mobile-360-en.png",
  "89-customer-mobile-430-en.png": "customer-today-mobile-430-en.png",
  "90-customer-unknown-subdomain.png": "customer-unknown-subdomain.png",
  "91-auth-verification-send-failure.png": "verify-email-send-failure-en.png",
  "92-auth-oauth-no-account.png": "36-login-google-no-account-error.png",
  "93-billing-recovery-mobile.png": "billing-recovery-mobile.png",
  "94-mapbox-provider-unavailable.png": "location-mapbox-token-unset.png",
};

const transferExtras = {
  "95-customer-transfer-inspection.png": "10-transfer-card-proof.png",
  "96-customer-transfer-no-email-warning.png": "11-no-email-security-warning.png",
  "97-customer-transfer-pending-email.png": "14-email-transfer-pending.png",
  "98-customer-transfer-confirmed.png": "15-email-transfer-confirmed.png",
  "99-customer-old-card-transferred.png": "17-old-card-transferred.png",
};

await mkdir(target, { recursive: true });
const manifest = [];

for (const [name, sourceName] of Object.entries({ ...required, ...extras })) {
  const from = path.join(source, sourceName);
  await stat(from);
  await copyFile(from, path.join(target, name));
  manifest.push({ name, source: path.relative(root, from).replaceAll("\\", "/") });
}

for (const [name, sourceName] of Object.entries(transferExtras)) {
  const from = path.join(w3, sourceName);
  await stat(from);
  await copyFile(from, path.join(target, name));
  manifest.push({ name, source: path.relative(root, from).replaceAll("\\", "/") });
}

await writeFile(
  path.join(target, "manifest.json"),
  `${JSON.stringify({ generatedAt: new Date().toISOString(), screenshots: manifest }, null, 2)}\n`,
  "utf8",
);

process.stdout.write(
  `SCREENSHOT_REVIEW_DIRECTORY=${target}\nSCREENSHOTS_CAPTURED=${manifest.length}\n`,
);
