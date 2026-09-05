import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const onboarding = readFileSync(
  resolve(process.cwd(), "apps/merchant-dashboard/components/onboarding.tsx"),
  "utf8",
);
const styles = readFileSync(
  resolve(process.cwd(), "apps/merchant-dashboard/app/globals.css"),
  "utf8",
);

describe("onboarding trial review layout", () => {
  it("keeps information inside the summary card and the confirmation action outside it", () => {
    const review = onboarding.slice(
      onboarding.indexOf('<div className="onboarding-trial-review">'),
      onboarding.indexOf(
        '      ) : (\n        <Alert tone="danger" title={copy.trial.unavailable}',
      ),
    );
    const summary = review.slice(
      review.indexOf('<section className="onboarding-trial-review__summary"'),
      review.indexOf("</section>"),
    );
    const actions = review.slice(
      review.indexOf('<div className="onboarding-trial-review__actions">'),
    );

    expect(summary).toContain("onboarding-trial-review__promise");
    expect(summary).toContain("onboarding-policy-links");
    expect(summary).not.toContain("<Button");
    expect(actions).toContain("<Button onClick={() => void startTrial()} loading={loading}>");
  });

  it("uses logical, responsive layout and bidi isolation for review values", () => {
    expect(onboarding).toContain(
      '<bdi dir="auto">{dateLabel(preview.expectedTrialStart, locale)}</bdi>',
    );
    expect(onboarding).toContain('<bdi dir="ltr">');
    expect(styles).toContain(".onboarding-trial-review__summary");
    expect(styles).toContain("padding: clamp(1.25rem, 3vw, 2rem);");
    expect(styles).toContain(".onboarding-trial-review__actions");
    expect(styles).toContain("@media (max-width: 43.75rem)");
    expect(styles).toContain(".onboarding-trial-review__actions .wf-button {\n    flex: 1 1 0;");
    expect(styles).toContain(
      ".onboarding-trial-review dl > div {\n    grid-template-columns: 1fr;",
    );
  });
});
