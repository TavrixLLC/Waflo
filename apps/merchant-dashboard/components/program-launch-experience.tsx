"use client";

import { planCatalog } from "@waflo/billing";
import { Alert, Badge, Button, Card, Modal } from "@waflo/ui";
import {
  ArrowRight,
  Check,
  CircleAlert,
  Copy,
  Download,
  ExternalLink,
  Globe2,
  Link2,
  Pause,
  Play,
  RefreshCcw,
  Rocket,
  RotateCcw,
  ShieldCheck,
  Store,
  Users,
  WalletCards,
} from "lucide-react";
import { useRef, useState } from "react";
import { apiUrl } from "../lib/api-client";
import type {
  EnrollmentPolicy,
  EnrollmentSettings,
  WalletHealth,
} from "./program-enrollment-settings";
import {
  deriveProgramSharingPresentation,
  isLocalPreviewUrl,
  type PublicationFailurePresentation,
  type PublicationMode,
  type ProgramSharingPresentation,
  walletSurfacePresentation,
} from "./program-publication-presentation";
import type { LocationItem, ProgramDetail, ProgramDraftInput } from "./program-studio-types";
import type {
  StudioArea,
  StudioLifecyclePresentation,
  StudioPresentationAction,
} from "./program-studio-presentation";

export interface OrganizationPublicationContext {
  billingProfile: {
    subscriptionStatus: string;
    trialStart: string | null;
    trialEnd: string | null;
  } | null;
}

export interface PublicationCommandResult {
  status: "PROCESSING" | "COMPLETED" | "FAILED";
  trialStarted: boolean;
  trialStart: string | null;
  trialEnd: string | null;
}

export interface PublicationSuccessState {
  mode: PublicationMode;
  remainedPaused: boolean;
  command: PublicationCommandResult;
}

export interface PublicationFailureState {
  code: string;
  presentation: PublicationFailurePresentation;
}

export function PublicationConfirmationDialog({
  open,
  mode,
  paused,
  startsTrial,
  working,
  ar,
  onClose,
  onConfirm,
}: {
  open: boolean;
  mode: PublicationMode;
  paused: boolean;
  startsTrial: boolean;
  working: boolean;
  ar: boolean;
  onClose: () => void;
  onConfirm: () => void;
}) {
  const first = mode === "first-launch";
  const title = first
    ? ar
      ? "أنت على وشك إطلاق بطاقة الولاء"
      : "You’re about to launch this loyalty card"
    : ar
      ? "أنت على وشك نشر التغييرات"
      : "You’re about to publish changes";
  const action = first
    ? ar
      ? "إطلاق البطاقة"
      : "Launch card"
    : ar
      ? "نشر التغييرات"
      : "Publish changes";
  return (
    <Modal
      open={open}
      title={title}
      closeLabel={ar ? "إغلاق" : "Close"}
      className="publication-confirmation-dialog"
      description={
        working
          ? first
            ? ar
              ? "جارٍ إطلاق البطاقة. يرجى إبقاء هذه الصفحة مفتوحة."
              : "Launching card. Please keep this page open."
            : ar
              ? "جارٍ نشر التغييرات. يرجى إبقاء هذه الصفحة مفتوحة."
              : "Publishing changes. Please keep this page open."
          : first
            ? ar
              ? "راجع أثر إطلاق بطاقة الولاء قبل المتابعة."
              : "Review what launching the loyalty card will change before continuing."
            : ar
              ? "راجع أثر نشر التغييرات قبل المتابعة."
              : "Review what publishing these changes will affect before continuing."
      }
      locked={working}
      onClose={onClose}
    >
      <div className="publication-confirmation">
        {working ? (
          <div className="publication-execution" role="status" aria-live="assertive">
            <RefreshCcw className="studio-spin" size={24} aria-hidden="true" />
            <div>
              <strong>
                {first
                  ? ar
                    ? "جارٍ إطلاق البطاقة…"
                    : "Launching card…"
                  : ar
                    ? "جارٍ نشر التغييرات…"
                    : "Publishing changes…"}
              </strong>
              <small>{ar ? "يرجى إبقاء هذه الصفحة مفتوحة." : "Please keep this page open."}</small>
            </div>
          </div>
        ) : (
          <>
            <p>
              {first
                ? ar
                  ? "بعد الإطلاق:"
                  : "After launch:"
                : ar
                  ? "بعد النشر:"
                  : "After publishing:"}
            </p>
            <ul>
              {first ? (
                <>
                  <li>{ar ? "يمكن للعملاء المؤهلين الانضمام." : "Eligible customers can join."}</li>
                  <li>
                    {ar
                      ? "تصبح بطاقة العميل على الويب متاحة."
                      : "The Customer Web card becomes available."}
                  </li>
                  <li>
                    {ar
                      ? "يمكن للمواقع المحددة إصدار الأختام."
                      : "Selected locations can issue stamps."}
                  </li>
                  <li>
                    {ar
                      ? "تتوفر واجهات Wallet المهيأة حيث تكون مدعومة."
                      : "Configured Wallet surfaces become available where supported."}
                  </li>
                </>
              ) : (
                <>
                  <li>
                    {ar
                      ? "يستخدم العملاء الجدد أحدث إعداد منشور."
                      : "New customers use the latest published setup."}
                  </li>
                  <li>
                    {ar
                      ? "يحتفظ العملاء الحاليون بشروط عضويتهم وتقدمهم."
                      : "Existing customers keep their membership rules and progress."}
                  </li>
                  <li>
                    {ar
                      ? "لا يعني النشر أن كل بطاقة Wallet حالية قد تم تحديثها."
                      : "Publication does not claim every existing Wallet pass has refreshed."}
                  </li>
                </>
              )}
            </ul>
            {startsTrial ? (
              <Alert
                tone="info"
                title={ar ? "يبدأ هذا الإطلاق الفترة التجريبية" : "This launch starts your trial"}
              >
                {ar
                  ? "تبدأ الفترة التجريبية الحالية لمدة 15 يوماً عند نجاح النشر."
                  : "The existing 15-day trial starts when publication succeeds."}
              </Alert>
            ) : null}
            {paused ? (
              <Alert
                tone="warning"
                title={ar ? "ستبقى البطاقة متوقفة" : "The card will remain paused"}
              >
                {ar
                  ? "استخدم الاستئناف بشكل منفصل عندما تكون مستعداً لإعادتها للعملاء."
                  : "Resume it separately when you are ready to make it available again."}
              </Alert>
            ) : null}
          </>
        )}
        <div className="wf-dialog__actions">
          <Button variant="secondary" disabled={working} onClick={onClose}>
            {ar ? "العودة إلى المراجعة" : "Back to review"}
          </Button>
          <Button loading={working} loadingLabel={action} onClick={onConfirm}>
            <Rocket size={16} aria-hidden="true" /> {action}
          </Button>
        </div>
      </div>
    </Modal>
  );
}

function selectedPolicy(
  access: EnrollmentSettings | null,
  mode: PublicationMode,
): EnrollmentPolicy | null {
  if (!access) return null;
  return mode === "update"
    ? (access.editableVersion?.policy ?? access.publishedVersion?.policy ?? null)
    : (access.editableVersion?.policy ?? null);
}

function emailPolicyLabel(policy: EnrollmentPolicy | null, ar: boolean): string {
  if (!policy) return ar ? "الحالة غير متاحة" : "Status unavailable";
  if (policy.emailCollectionMode === "HIDDEN") return ar ? "لا يُجمع البريد" : "Email not collected";
  if (policy.emailCollectionMode === "REQUIRED") return ar ? "البريد مطلوب" : "Email required";
  return ar ? "البريد اختياري" : "Email optional";
}

function planName(plan: "STARTER" | "GROWTH" | "SCALE") {
  return planCatalog[plan.toLocaleLowerCase("en-US") as "starter" | "growth" | "scale"];
}

function WalletSurfaceList({ health, ar }: { health: WalletHealth[]; ar: boolean }) {
  return (
    <div className="publication-wallet-list">
      {(["APPLE", "GOOGLE"] as const).map((code) => {
        const provider = health.find((item) => item.provider === code);
        const presentation = walletSurfacePresentation(provider, ar);
        return (
          <section key={code}>
            <span className="publication-wallet-list__icon">
              <WalletCards size={18} aria-hidden="true" />
            </span>
            <div>
              <strong>{code === "APPLE" ? "Apple Wallet" : "Google Wallet"}</strong>
              <small>{presentation.explanation}</small>
            </div>
            <Badge tone={presentation.tone}>{presentation.label}</Badge>
          </section>
        );
      })}
    </div>
  );
}

export function ShareLoyaltyCard({
  access,
  presentation,
  organizationId,
  programId,
  ar,
  onViewCustomers,
  compact = false,
}: {
  access: EnrollmentSettings | null;
  presentation: ProgramSharingPresentation;
  organizationId: string;
  programId: string;
  ar: boolean;
  onViewCustomers: () => void;
  compact?: boolean;
}) {
  const [copied, setCopied] = useState(false);
  const [copyError, setCopyError] = useState(false);
  const publicUrl = access?.publicUrl ?? null;
  const qrAvailable = Boolean(access?.publicSlug);
  const qrBase = `${apiUrl}/v1/organizations/${organizationId}/programs/${programId}/enrollment-qr`;

  async function copyLink() {
    if (!publicUrl || !presentation.canCopyJoinLink) return;
    try {
      await navigator.clipboard.writeText(publicUrl);
      setCopied(true);
      setCopyError(false);
      window.setTimeout(() => setCopied(false), 2_500);
    } catch {
      setCopyError(true);
    }
  }

  return (
    <Card
      className={`publication-share${compact ? " publication-share--compact" : ""}${presentation.canShare ? "" : " publication-share--inactive"}`}
    >
      <div className="publication-section-heading">
        <span className="publication-section-icon">
          <Link2 size={19} aria-hidden="true" />
        </span>
        <div>
          <span className="dashboard-card__label">{ar ? "المشاركة" : "SHARE"}</span>
          <h3>
            {presentation.canShare
              ? ar
                ? "شارك بطاقة الولاء"
                : "Share loyalty card"
              : ar
                ? "مشاركة العملاء"
                : "Customer sharing"}
          </h3>
          <p>{presentation.description}</p>
        </div>
        <Badge tone={presentation.tone}>{presentation.label}</Badge>
      </div>

      {presentation.blockingReason ? (
        <Alert
          tone={presentation.tone === "neutral" ? "info" : "warning"}
          title={presentation.blockingReason}
        />
      ) : null}

      {publicUrl ? (
        <div className="publication-share__link">
          <div>
            {!presentation.canShare ? (
              <small>{ar ? "رابط محفوظ وغير نشط" : "Saved inactive link"}</small>
            ) : isLocalPreviewUrl(publicUrl) ? (
              <small>{ar ? "معاينة محلية للتطوير" : "Local development preview"}</small>
            ) : (
              <small>{ar ? "رابط الانضمام العام" : "Public join link"}</small>
            )}
            <code dir="ltr">{publicUrl}</code>
          </div>
          {presentation.canCopyJoinLink || presentation.canOpenJoinPage ? (
            <div className="publication-share__actions">
              {presentation.canCopyJoinLink ? (
                <Button variant="secondary" onClick={() => void copyLink()}>
                  <Copy size={16} aria-hidden="true" />
                  {copied
                    ? ar
                      ? "تم نسخ الرابط"
                      : "Link copied"
                    : ar
                      ? "نسخ الرابط"
                      : "Copy link"}
                </Button>
              ) : null}
              {presentation.canOpenJoinPage ? (
                <a href={publicUrl} target="_blank" rel="noreferrer">
                  <Button variant="secondary">
                    <ExternalLink size={16} aria-hidden="true" />
                    {ar ? "فتح صفحة الانضمام" : "Open join page"}
                  </Button>
                </a>
              ) : null}
            </div>
          ) : null}
        </div>
      ) : (
        <Alert tone="info" title={ar ? "الرابط متاح بعد الإطلاق" : "Link available after launch"}>
          {ar
            ? "لم تصبح لهذه البطاقة صفحة انضمام عامة بعد."
            : "This card does not have a public join page yet."}
        </Alert>
      )}

      <div className="publication-share__footer">
        <div className="publication-share__actions">
          {qrAvailable && presentation.canDownloadQr ? (
            <>
              <a href={`${qrBase}?format=png&locale=${ar ? "ar" : "en"}`} download>
                <Button
                  variant="secondary"
                  aria-label={
                    ar ? "تنزيل رمز QR للتسجيل بصيغة PNG" : "Download enrollment QR as PNG"
                  }
                >
                  <Download size={16} aria-hidden="true" /> QR PNG
                </Button>
              </a>
              <a href={`${qrBase}?format=svg&locale=${ar ? "ar" : "en"}`} download>
                <Button
                  variant="secondary"
                  aria-label={
                    ar ? "تنزيل رمز QR للتسجيل بصيغة SVG" : "Download enrollment QR as SVG"
                  }
                >
                  <Download size={16} aria-hidden="true" /> QR SVG
                </Button>
              </a>
            </>
          ) : null}
        </div>
        {presentation.canViewCustomers ? (
          <Button variant="secondary" onClick={onViewCustomers}>
            <Users size={16} aria-hidden="true" /> {ar ? "عرض العملاء" : "View customers"}
          </Button>
        ) : null}
      </div>
      <span className="wf-sr-only" role="status" aria-live="polite">
        {copied ? (ar ? "تم نسخ الرابط" : "Link copied") : ""}
      </span>
      {copyError ? (
        <Alert tone="danger" title={ar ? "تعذر نسخ الرابط" : "The link could not be copied"} />
      ) : null}
    </Card>
  );
}

function PublicationCardAnchor({
  draft,
  locations,
  ar,
}: {
  draft: ProgramDraftInput;
  locations: LocationItem[];
  ar: boolean;
}) {
  const content = draft.translations[ar ? "ar" : "en"];
  const reward = [...draft.rewards].sort(
    (left, right) => right.thresholdStampCount - left.thresholdStampCount,
  )[0];
  const rewardName = reward?.translations[ar ? "ar" : "en"].name ?? content.rewardSummary;
  const participating = locations.filter((location) => draft.locationIds.includes(location.id));
  const stampPreview = Array.from(
    { length: Math.min(draft.requiredStampCount, 10) },
    (_, index) => index,
  );
  return (
    <aside
      className="publication-card-anchor"
      aria-label={ar ? "ملخص بطاقة الولاء" : "Loyalty card summary"}
    >
      <div
        className="publication-card-anchor__card"
        style={{
          backgroundColor: draft.visualTheme.backgroundColor,
          color: draft.visualTheme.foregroundColor,
          borderRadius: `${Math.max(14, draft.visualTheme.borderRadius)}px`,
        }}
      >
        <span>{ar ? "ملخص الإطلاق" : "LAUNCH SUMMARY"}</span>
        <h4>{content.programName}</h4>
        <p>{rewardName}</p>
        <div className="publication-card-anchor__stamps" aria-hidden="true">
          {stampPreview.map((item) => (
            <i key={item} style={{ borderColor: draft.visualTheme.accentColor }} />
          ))}
        </div>
        <strong>
          {draft.requiredStampCount} {ar ? "أختام للمكافأة" : "stamps to reward"}
        </strong>
      </div>
      <dl>
        <div>
          <dt>{ar ? "المكافأة" : "Reward"}</dt>
          <dd>{rewardName}</dd>
        </div>
        <div>
          <dt>{ar ? "المواقع" : "Locations"}</dt>
          <dd>
            {participating.length === 1
              ? participating[0]?.name
              : ar
                ? `${participating.length} مواقع مشاركة`
                : `${participating.length} participating locations`}
          </dd>
        </div>
      </dl>
    </aside>
  );
}

function LaunchReview({
  mode,
  draft,
  detail,
  locations,
  plan,
  organization,
  access,
  walletHealth,
  ar,
}: {
  mode: PublicationMode;
  draft: ProgramDraftInput;
  detail: ProgramDetail;
  locations: LocationItem[];
  plan: "STARTER" | "GROWTH" | "SCALE";
  organization: OrganizationPublicationContext | null;
  access: EnrollmentSettings | null;
  walletHealth: WalletHealth[];
  ar: boolean;
}) {
  const policy = selectedPolicy(access, mode);
  const planDefinition = planName(plan);
  const startsTrial =
    mode === "first-launch" &&
    organization?.billingProfile?.subscriptionStatus === "PENDING_ACTIVATION" &&
    organization.billingProfile.trialStart === null;
  const participating = locations.filter((location) => draft.locationIds.includes(location.id));

  return (
    <div className="publication-review">
      <PublicationCardAnchor draft={draft} locations={locations} ar={ar} />
      <div className="publication-review__docket">
        <section>
          <div className="publication-section-heading">
            <span className="publication-section-icon">
              <Globe2 size={19} aria-hidden="true" />
            </span>
            <div>
              <span className="dashboard-card__label">
                {ar ? "وصول العملاء" : "CUSTOMER ACCESS"}
              </span>
              <h3>{ar ? "ما سيستلمه العملاء" : "What customers receive"}</h3>
            </div>
          </div>
          <dl className="publication-fact-grid">
            <div>
              <dt>{ar ? "الانضمام" : "Joining"}</dt>
              <dd>
                {policy?.enrollmentOpen === false
                  ? ar
                    ? "متوقف"
                    : "Off"
                  : ar
                    ? "مفتوح عند الإطلاق"
                    : "Opens at launch"}
              </dd>
            </div>
            <div>
              <dt>{ar ? "الرابط العام" : "Public link"}</dt>
              <dd>
                {access?.publicSlug
                  ? ar
                    ? "محجوز وجاهز"
                    : "Reserved and ready"
                  : ar
                    ? "يلزم إعداد الرابط"
                    : "Link setup required"}
              </dd>
            </div>
            <div>
              <dt>{ar ? "جمع البريد" : "Email collection"}</dt>
              <dd>{emailPolicyLabel(policy, ar)}</dd>
            </div>
            <div>
              <dt>{ar ? "اللغات" : "Languages"}</dt>
              <dd>{ar ? "العربية والإنجليزية" : "English and Arabic"}</dd>
            </div>
            <div>
              <dt>{ar ? "المواقع المشاركة" : "Participating locations"}</dt>
              <dd>
                {participating.map((location) => location.name).join(" · ") ||
                  (ar ? "لا يوجد" : "None")}
              </dd>
            </div>
            <div>
              <dt>{ar ? "الموافقة" : "Consent"}</dt>
              <dd>
                {policy?.marketingConsentVisible
                  ? ar
                    ? "موافقة تسويقية منفصلة"
                    : "Separate marketing consent"
                  : ar
                    ? "شروط العميل مطلوبة"
                    : "Customer terms required"}
              </dd>
            </div>
          </dl>
        </section>

        <section>
          <div className="publication-section-heading">
            <span className="publication-section-icon">
              <WalletCards size={19} aria-hidden="true" />
            </span>
            <div>
              <span className="dashboard-card__label">{ar ? "الواجهات" : "SURFACES"}</span>
              <h3>{ar ? "مكان توفر البطاقة" : "Where the card will be available"}</h3>
            </div>
          </div>
          <div className="publication-customer-web-status">
            <span>
              <Globe2 size={18} aria-hidden="true" />
              <strong>{ar ? "بطاقة العميل على الويب" : "Customer Web"}</strong>
            </span>
            <Badge tone="success">{ar ? "جاهزة" : "Ready"}</Badge>
          </div>
          <WalletSurfaceList health={walletHealth} ar={ar} />
        </section>

        <section className="publication-effects">
          <div className="publication-section-heading">
            <span className="publication-section-icon">
              <Rocket size={19} aria-hidden="true" />
            </span>
            <div>
              <span className="dashboard-card__label">
                {ar ? "أثر النشر" : "PUBLICATION EFFECTS"}
              </span>
              <h3>
                {mode === "first-launch"
                  ? ar
                    ? "ما سيتغير بعد الإطلاق"
                    : "What changes after launch"
                  : ar
                    ? "ما سيتغير بعد نشر التحديث"
                    : "What changes after publishing"}
              </h3>
            </div>
          </div>
          <ol>
            {mode === "first-launch" ? (
              <>
                <li>
                  <Check size={16} aria-hidden="true" />
                  <span>
                    {ar
                      ? "تصبح صفحة الانضمام متاحة للعملاء المؤهلين."
                      : "The join page becomes available to eligible customers."}
                  </span>
                </li>
                <li>
                  <Check size={16} aria-hidden="true" />
                  <span>
                    {ar
                      ? "يمكن للمواقع المحددة إصدار الأختام وفق القواعد المنشورة."
                      : "Selected locations can issue stamps under the published rules."}
                  </span>
                </li>
                <li>
                  <Check size={16} aria-hidden="true" />
                  <span>
                    {ar
                      ? "يمكن إيقاف البطاقة مؤقتاً أو أرشفتها لاحقاً دون حذف إعدادها."
                      : "The card can later be paused or archived without deleting its setup."}
                  </span>
                </li>
              </>
            ) : (
              <>
                <li>
                  <Check size={16} aria-hidden="true" />
                  <span>
                    {ar
                      ? "يستخدم العملاء الجدد هذا الإعداد المنشور."
                      : "New customers enroll on this published setup."}
                  </span>
                </li>
                <li>
                  <ShieldCheck size={16} aria-hidden="true" />
                  <span>
                    {ar
                      ? "يحتفظ العملاء الحاليون بشروط عضويتهم وتقدمهم الحالي."
                      : "Existing customers keep their current membership rules and progress."}
                  </span>
                </li>
                <li>
                  <WalletCards size={16} aria-hidden="true" />
                  <span>
                    {ar
                      ? "لا يدّعي Waflo تحديث بطاقات Wallet الحالية بسبب هذا النشر."
                      : "Waflo does not claim existing Wallet passes refresh from this publication."}
                  </span>
                </li>
              </>
            )}
          </ol>
          <div className="publication-plan-impact">
            <strong>{ar ? `خطة ${planDefinition.name}` : `${planDefinition.name} plan`}</strong>
            <span>
              {mode === "update"
                ? ar
                  ? "لا يستخدم نشر التحديث خانة بطاقة إضافية."
                  : "Publishing an update does not use another active-card slot."
                : planDefinition.limits.programs === null
                  ? ar
                    ? "لا يوجد حد ثابت للبطاقات النشطة في هذه الخطة، وتُعاد مراجعة الاستحقاقات عند الإطلاق."
                    : "This plan has no fixed active-card limit; entitlements are rechecked at launch."
                  : ar
                    ? `تُحتسب هذه البطاقة ضمن حد ${planDefinition.limits.programs} بطاقة نشطة.`
                    : `This card counts toward the ${planDefinition.limits.programs}-active-card limit.`}
            </span>
          </div>
          {startsTrial ? (
            <Alert
              tone="info"
              title={ar ? "يبدأ الإطلاق الفترة التجريبية" : "Launching starts your trial"}
            >
              {ar
                ? "يبدأ هذا الإطلاق الفترة التجريبية الحالية لمدة 15 يوماً داخل عملية النشر نفسها."
                : "This first launch starts the existing 15-day trial in the same publication transaction."}
            </Alert>
          ) : null}
          {detail.status === "PAUSED" && mode === "update" ? (
            <Alert
              tone="warning"
              title={ar ? "ستبقى البطاقة متوقفة" : "The card will remain paused"}
            >
              {ar
                ? "سيُنشر التحديث، لكن يجب استئناف البطاقة بشكل منفصل لإعادتها للعملاء."
                : "The update will publish, but the card must be resumed separately before it is available again."}
            </Alert>
          ) : null}
        </section>
      </div>
    </div>
  );
}

function PublicationFailure({
  failure,
  ar,
  onAction,
}: {
  failure: PublicationFailureState;
  ar: boolean;
  onAction: (action: PublicationFailurePresentation["action"]) => void;
}) {
  const { presentation } = failure;
  return (
    <section
      className="publication-failure"
      role="alert"
      aria-labelledby="publication-failure-title"
    >
      <span>
        <CircleAlert size={24} aria-hidden="true" />
      </span>
      <div>
        <span className="dashboard-card__label">{ar ? "لم يتم النشر" : "NOT PUBLISHED"}</span>
        <h3 id="publication-failure-title">{presentation.title}</h3>
        <dl>
          <div>
            <dt>{ar ? "ما حدث" : "What happened"}</dt>
            <dd>{presentation.whatHappened}</dd>
          </div>
          <div>
            <dt>{ar ? "ما بقي آمناً" : "What remains safe"}</dt>
            <dd>{presentation.remainsSafe}</dd>
          </div>
        </dl>
        <Button onClick={() => onAction(presentation.action)}>
          {presentation.action === "retry" ? <RefreshCcw size={16} aria-hidden="true" /> : null}
          {presentation.actionLabel}
        </Button>
        {presentation.action === "reload" ? (
          <Button variant="secondary" onClick={() => onAction("studio")}>
            {ar ? "العودة إلى الاستوديو" : "Return to Studio"}
          </Button>
        ) : null}
      </div>
    </section>
  );
}

function PublicationSuccess({
  success,
  detail,
  access,
  walletHealth,
  organizationId,
  programId,
  ar,
  onArea,
  onViewCustomers,
  onLifecycle,
}: {
  success: PublicationSuccessState;
  detail: ProgramDetail;
  access: EnrollmentSettings | null;
  walletHealth: WalletHealth[];
  organizationId: string;
  programId: string;
  ar: boolean;
  onArea: (area: StudioArea) => void;
  onViewCustomers: () => void;
  onLifecycle: (action: "resume" | "restore") => void;
}) {
  const [shareOpen, setShareOpen] = useState(false);
  const shareRef = useRef<HTMLDivElement>(null);
  const first = success.mode === "first-launch";
  const publishedPolicy = access?.publishedVersion?.policy ?? null;
  const sharing = deriveProgramSharingPresentation({
    lifecycle: success.remainedPaused ? "PAUSED" : detail.status,
    enrollmentPolicy: publishedPolicy,
    hasPublishedVersion: Boolean(detail.currentPublishedVersion),
    publicUrl: access?.publicUrl ?? null,
    slug: access?.publicSlug ?? null,
    qrAvailability: Boolean(access?.publicSlug),
    customerAccessState: access?.enrollmentLinkStatus === "ACTIVE" ? "available" : "unavailable",
    locale: ar ? "ar" : "en",
  });

  function showShare() {
    setShareOpen(true);
    window.requestAnimationFrame(() => shareRef.current?.focus());
  }

  return (
    <div className="publication-success" id="publication-success" tabIndex={-1}>
      <section
        className="publication-success__hero"
        aria-labelledby="publication-success-title"
        role="status"
      >
        <span className="publication-success__mark">
          <Check size={26} aria-hidden="true" />
        </span>
        <div>
          <span className="dashboard-card__label">
            {first ? (ar ? "تم الإطلاق" : "LAUNCHED") : ar ? "تم النشر" : "PUBLISHED"}
          </span>
          <h3 id="publication-success-title">
            {first
              ? ar
                ? "بطاقة الولاء مباشرة الآن"
                : "Your loyalty card is live"
              : ar
                ? "تم نشر التغييرات"
                : "Changes published"}
          </h3>
          <p>
            {first
              ? ar
                ? "يمكن للعملاء الآن الوصول إليها في المواقع المشاركة."
                : "Customers can now access it at participating locations."
              : success.remainedPaused
                ? ar
                  ? "أصبحت أحدث التغييرات منشورة، وستبقى البطاقة متوقفة حتى استئنافها."
                  : "The latest changes are published, and the card remains paused until resumed."
                : ar
                  ? "أصبحت أحدث التغييرات المحفوظة منشورة للعملاء الجدد."
                  : "The latest saved changes are now published for new customers."}
          </p>
        </div>
      </section>

      <div className="publication-success__actions">
        {sharing.primaryAction === "share" ? (
          <Button onClick={showShare}>
            <Link2 size={16} aria-hidden="true" />
            {sharing.primaryActionLabel}
          </Button>
        ) : sharing.primaryAction === "resume" || sharing.primaryAction === "restore" ? (
          <Button
            onClick={() => onLifecycle(sharing.primaryAction === "resume" ? "resume" : "restore")}
          >
            {sharing.primaryAction === "resume" ? (
              <Play size={16} aria-hidden="true" />
            ) : (
              <RotateCcw size={16} aria-hidden="true" />
            )}
            {sharing.primaryActionLabel}
          </Button>
        ) : (
          <Button onClick={() => onArea("customers-locations")}>
            <ShieldCheck size={16} aria-hidden="true" /> {sharing.primaryActionLabel}
          </Button>
        )}
        {sharing.canViewCustomers ? (
          <Button variant="secondary" onClick={onViewCustomers}>
            <Users size={16} aria-hidden="true" />
            {ar ? "عرض العملاء" : "View customers"}
          </Button>
        ) : null}
        {access?.publicUrl && sharing.canOpenJoinPage ? (
          <a href={access.publicUrl} target="_blank" rel="noreferrer">
            <Button variant="secondary">
              <ExternalLink size={16} aria-hidden="true" />
              {ar ? "فتح صفحة البطاقة العامة" : "Open public card page"}
            </Button>
          </a>
        ) : null}
        <Button variant="secondary" onClick={() => onArea("overview")}>
          {first
            ? ar
              ? "إدارة البطاقة المباشرة"
              : "Manage live card"
            : ar
              ? "العودة إلى النظرة العامة"
              : "Return to Overview"}
        </Button>
      </div>

      <section className="publication-success__wallets">
        <div className="publication-section-heading">
          <span className="publication-section-icon">
            <WalletCards size={19} aria-hidden="true" />
          </span>
          <div>
            <span className="dashboard-card__label">WALLET</span>
            <h3>{ar ? "توفر المحافظ" : "Wallet availability"}</h3>
          </div>
        </div>
        <WalletSurfaceList health={walletHealth} ar={ar} />
      </section>

      {shareOpen && sharing.canShare ? (
        <div ref={shareRef} tabIndex={-1}>
          <ShareLoyaltyCard
            access={access}
            presentation={sharing}
            organizationId={organizationId}
            programId={programId}
            ar={ar}
            onViewCustomers={onViewCustomers}
          />
        </div>
      ) : null}
    </div>
  );
}

export function LiveAccessSummary({
  detail,
  access,
  walletHealth,
  organizationId,
  programId,
  ar,
  hasUnpublishedChanges,
  onReviewChanges,
  onViewCustomers,
}: {
  detail: ProgramDetail;
  access: EnrollmentSettings | null;
  walletHealth: WalletHealth[];
  organizationId: string;
  programId: string;
  ar: boolean;
  hasUnpublishedChanges: boolean;
  onReviewChanges: () => void;
  onViewCustomers: () => void;
}) {
  const policy = access?.publishedVersion?.policy;
  const sharing = deriveProgramSharingPresentation({
    lifecycle: detail.status,
    enrollmentPolicy: policy ?? null,
    hasPublishedVersion: Boolean(detail.currentPublishedVersion),
    publicUrl: access?.publicUrl ?? null,
    slug: access?.publicSlug ?? null,
    qrAvailability: Boolean(access?.publicSlug),
    customerAccessState: access?.enrollmentLinkStatus === "ACTIVE" ? "available" : "unavailable",
    locale: ar ? "ar" : "en",
  });
  return (
    <section
      className="live-access-summary"
      id="studio-live-sharing"
      aria-labelledby="live-access-summary-title"
      tabIndex={-1}
    >
      {hasUnpublishedChanges ? (
        <div className="unpublished-change-indicator" role="status">
          <span>
            <RefreshCcw size={18} aria-hidden="true" />
          </span>
          <div>
            <strong>{ar ? "تغييرات بانتظار النشر" : "Changes waiting to be published"}</strong>
            <small>
              {ar ? "البطاقة المباشرة الحالية لم تتغير." : "The current live card is unchanged."}
            </small>
          </div>
          <Button onClick={onReviewChanges}>{ar ? "مراجعة التغييرات" : "Review changes"}</Button>
        </div>
      ) : null}
      <div className="live-access-summary__heading">
        <div>
          <span className="dashboard-card__label">{ar ? "الوصول المباشر" : "LIVE ACCESS"}</span>
          <h3 id="live-access-summary-title">
            {sharing.canShare
              ? ar
                ? "شارك البطاقة وأدر العملاء"
                : "Share the card and manage customers"
              : sharing.label}
          </h3>
        </div>
        <Badge tone={sharing.tone}>{sharing.label}</Badge>
      </div>
      <p>{sharing.description}</p>
      <ShareLoyaltyCard
        access={access}
        presentation={sharing}
        organizationId={organizationId}
        programId={programId}
        ar={ar}
        onViewCustomers={onViewCustomers}
        compact
      />
      <WalletSurfaceList health={walletHealth} ar={ar} />
    </section>
  );
}

export function LaunchPanel({
  editable,
  organizationId,
  programId,
  draft,
  detail,
  locations,
  plan,
  organization,
  access,
  walletHealth,
  ar,
  lifecycleState,
  mode,
  success,
  failure,
  validationPanel,
  onValidate,
  onArea,
  onPublish,
  onRetry,
  onReload,
  onEditDesign,
  onOpenBilling,
  onViewCustomers,
  onLifecycle,
}: {
  editable: boolean;
  organizationId: string;
  programId: string;
  draft: ProgramDraftInput;
  detail: ProgramDetail;
  locations: LocationItem[];
  plan: "STARTER" | "GROWTH" | "SCALE";
  organization: OrganizationPublicationContext | null;
  access: EnrollmentSettings | null;
  walletHealth: WalletHealth[];
  ar: boolean;
  lifecycleState: StudioLifecyclePresentation;
  mode: PublicationMode;
  success: PublicationSuccessState | null;
  failure: PublicationFailureState | null;
  validationPanel: React.ReactNode;
  onValidate: () => void;
  onArea: (area: StudioArea) => void;
  onPublish: () => void;
  onRetry: () => void;
  onReload: () => void;
  onEditDesign: () => void;
  onOpenBilling: () => void;
  onViewCustomers: () => void;
  onLifecycle: (action: "resume" | "restore") => void;
}) {
  if (success)
    return (
      <PublicationSuccess
        success={success}
        detail={detail}
        access={access}
        walletHealth={walletHealth}
        organizationId={organizationId}
        programId={programId}
        ar={ar}
        onArea={onArea}
        onViewCustomers={onViewCustomers}
        onLifecycle={onLifecycle}
      />
    );

  const automated = lifecycleState.launch.requirements.find(
    (requirement) => requirement.key === "automated",
  );
  const showReview = editable && lifecycleState.launch.ready;

  function runAction(action: StudioPresentationAction) {
    if (action.kind === "navigate") onArea(action.area);
    else if (action.kind === "lifecycle") {
      if (action.action === "resume" || action.action === "restore") onLifecycle(action.action);
    } else if (action.kind === "publish") onPublish();
    else onValidate();
  }

  function failureAction(action: PublicationFailurePresentation["action"]) {
    if (action === "retry") onRetry();
    else if (action === "checks") onValidate();
    else if (action === "locations") onArea("customers-locations");
    else if (action === "design") onEditDesign();
    else if (action === "reload") onReload();
    else if (action === "billing") onOpenBilling();
    else onArea("overview");
  }

  return (
    <div className="studio-area-stack">
      {failure ? <PublicationFailure failure={failure} ar={ar} onAction={failureAction} /> : null}

      <section
        className={`studio-launch-summary studio-launch-summary--${lifecycleState.launch.tone}`}
        aria-labelledby="studio-launch-title"
        role="status"
      >
        <div>
          <span className="dashboard-card__label">
            {showReview
              ? mode === "first-launch"
                ? ar
                  ? "المراجعة النهائية"
                  : "FINAL LAUNCH REVIEW"
                : ar
                  ? "مراجعة التحديث"
                  : "PUBLISHED UPDATE REVIEW"
              : ar
                ? "الحالة العامة"
                : "OVERALL LAUNCH STATUS"}
          </span>
          <h3 id="studio-launch-title">
            {showReview && mode === "update"
              ? ar
                ? "جاهزة لنشر التغييرات"
                : "Ready to publish changes"
              : lifecycleState.launch.label}
          </h3>
          <p>
            {showReview && mode === "update"
              ? ar
                ? "راجع التغييرات التي ستصبح منشورة للعملاء الجدد. البطاقة الحالية لم تتغير بعد."
                : "Review what will become published for new customers. The current live card is unchanged."
              : lifecycleState.launch.description}
          </p>
        </div>
        {showReview ? (
          <Rocket size={34} aria-hidden="true" />
        ) : lifecycleState.launch.tone === "success" ? (
          <ShieldCheck size={34} aria-hidden="true" />
        ) : lifecycleState.launch.tone === "warning" ? (
          <Pause size={34} aria-hidden="true" />
        ) : lifecycleState.launch.tone === "neutral" ? (
          <Store size={34} aria-hidden="true" />
        ) : (
          <CircleAlert size={34} aria-hidden="true" />
        )}
      </section>

      {showReview ? (
        <LaunchReview
          mode={mode}
          draft={draft}
          detail={detail}
          locations={locations}
          plan={plan}
          organization={organization}
          access={access}
          walletHealth={walletHealth}
          ar={ar}
        />
      ) : (
        <>
          <ul
            className="studio-readiness-list"
            aria-label={ar ? "متطلبات الإطلاق" : "Launch requirements"}
          >
            {lifecycleState.launch.requirements.map((requirement) => (
              <li
                key={requirement.key}
                className={requirement.blocking ? "studio-readiness-row--blocking" : ""}
              >
                <span className={requirement.complete ? "studio-readiness-row__complete" : ""}>
                  {requirement.complete ? (
                    <Check size={16} aria-hidden="true" />
                  ) : (
                    <CircleAlert size={16} aria-hidden="true" />
                  )}
                </span>
                <span>
                  <strong>{requirement.label}</strong>
                  <small>{requirement.description}</small>
                </span>
                <span className="studio-readiness-row__status">
                  <strong>{requirement.status}</strong>
                  {requirement.action ? (
                    <button
                      type="button"
                      onClick={() => runAction(requirement.action as StudioPresentationAction)}
                    >
                      {requirement.action.label}
                      <ArrowRight className="studio-logical-next" size={15} aria-hidden="true" />
                    </button>
                  ) : null}
                </span>
              </li>
            ))}
          </ul>
          <WalletSurfaceList health={walletHealth} ar={ar} />
        </>
      )}

      {editable ? (
        <details className="studio-launch-checks" open={!automated?.complete}>
          <summary>
            <span>
              <ShieldCheck size={19} aria-hidden="true" />
              <strong>{ar ? "تفاصيل الفحوصات الآلية" : "Automated check details"}</strong>
            </span>
          </summary>
          <div>{validationPanel}</div>
        </details>
      ) : null}

      <div className="studio-launch-action">
        <div>
          <strong>
            {showReview
              ? mode === "first-launch"
                ? ar
                  ? "إطلاق بطاقة الولاء"
                  : "Launch loyalty card"
                : ar
                  ? "نشر التغييرات"
                  : "Publish changes"
              : lifecycleState.launch.action.label}
          </strong>
          <small id="studio-launch-action-description">
            {showReview
              ? mode === "first-launch"
                ? ar
                  ? "اجعل هذه البطاقة متاحة للعملاء المؤهلين."
                  : "Make this card available to eligible customers."
                : ar
                  ? "حدّث ما يراه العملاء الجدد وطريقة عمل بطاقة الولاء."
                  : "Update what new customers see and how this loyalty card operates."
              : lifecycleState.launch.description}
          </small>
        </div>
        <Button
          onClick={() => (showReview ? onPublish() : runAction(lifecycleState.launch.action))}
          aria-describedby="studio-launch-action-description"
        >
          {showReview ? (
            <Rocket size={16} aria-hidden="true" />
          ) : lifecycleState.launch.action.kind === "lifecycle" &&
            lifecycleState.launch.action.action === "resume" ? (
            <Play size={16} aria-hidden="true" />
          ) : lifecycleState.launch.action.kind === "lifecycle" &&
            lifecycleState.launch.action.action === "restore" ? (
            <RotateCcw size={16} aria-hidden="true" />
          ) : (
            <ArrowRight className="studio-logical-next" size={16} aria-hidden="true" />
          )}
          {showReview
            ? mode === "first-launch"
              ? ar
                ? "إطلاق بطاقة الولاء"
                : "Launch loyalty card"
              : ar
                ? "نشر التغييرات"
                : "Publish changes"
            : lifecycleState.launch.action.label}
        </Button>
      </div>
    </div>
  );
}
