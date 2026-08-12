"use client";

import {
  Alert,
  Badge,
  Button,
  Card,
  FormField,
  Modal,
  Select,
  TextArea,
  TextInput,
} from "@waflo/ui";
import {
  BellRing,
  Check,
  MapPin,
  Radio,
  RefreshCcw,
  Send,
  ShieldCheck,
  WalletCards,
} from "lucide-react";
import { type FormEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { apiFetch } from "../lib/api-client";

type CapabilityState = "AVAILABLE" | "NOT_CONFIGURED" | "PROVIDER_CONFIRMATION_REQUIRED";

interface WalletEngagementView {
  program: { id: string; name: string; status: string; templateCode: string | null };
  capabilities: {
    apple: {
      configured: boolean;
      manualPromotion: CapabilityState;
      nearbyRelevance: CapabilityState;
      customNearbyText: true;
      providerControlsNearbyText: false;
      selectableForManualPromotion: false;
    };
    google: {
      configured: boolean;
      manualPromotion: CapabilityState;
      nearbyRelevance: CapabilityState;
      customNearbyText: false;
      providerControlsNearbyText: true;
      selectableForManualPromotion: boolean;
    };
  };
  nearby: {
    enabled: boolean;
    revision: number;
    locationIds: string[];
    desiredAppleMaxDistanceMeters: 2000;
    appleCustomTextEn: string | null;
    appleCustomTextAr: string | null;
    preview: {
      en: { text: string; vertical: string; source: "CATEGORY_TEMPLATE" | "CUSTOM" };
      ar: { text: string; vertical: string; source: "CATEGORY_TEMPLATE" | "CUSTOM" };
    };
  };
  eligibleLocations: Array<{
    id: string;
    name: string;
    city: string | null;
    latitude: number | null;
    longitude: number | null;
    coordinatesConfigured: boolean;
  }>;
  disclosures: { apple: string; google: string };
}

interface AudienceEstimate {
  total: number;
  providers: { apple: number; google: number };
  capped: boolean;
}

interface CampaignHistory {
  items: Array<{
    id: string;
    createdAt: string;
    scheduledAt: string;
    title: string;
    body: string;
    locale: "EN" | "AR";
    providers: Array<"APPLE" | "GOOGLE">;
    status: string;
    counts: {
      eligible: number;
      queued: number;
      succeeded: number;
      skipped: number;
      failed: number;
    };
    creator: string;
  }>;
}

function capabilityLabel(state: CapabilityState, ar: boolean) {
  if (state === "AVAILABLE") return ar ? "متاح" : "Available";
  if (state === "NOT_CONFIGURED") return ar ? "يحتاج إلى إعداد" : "Setup required";
  return ar ? "بانتظار تأكيد المزود" : "Provider confirmation required";
}

function CampaignCount({ label, value }: { label: string; value: number }) {
  return (
    <span className="wallet-campaign-count">
      <strong>{value}</strong>
      <small>{label}</small>
    </span>
  );
}

export function WalletEngagementPanel({
  organizationId,
  programId,
  ar,
  canManage,
}: {
  organizationId: string;
  programId: string;
  ar: boolean;
  canManage: boolean;
}) {
  const base = `/v1/organizations/${organizationId}/programs/${programId}/wallet-engagement`;
  const [view, setView] = useState<WalletEngagementView | null>(null);
  const [audience, setAudience] = useState<AudienceEstimate | null>(null);
  const [history, setHistory] = useState<CampaignHistory>({ items: [] });
  const [loading, setLoading] = useState(true);
  const [savingNearby, setSavingNearby] = useState(false);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [nearbyEnabled, setNearbyEnabled] = useState(false);
  const [selectedLocations, setSelectedLocations] = useState<string[]>([]);
  const [customEn, setCustomEn] = useState("");
  const [customAr, setCustomAr] = useState("");
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [destinationUrl, setDestinationUrl] = useState("");
  const [messageLocale, setMessageLocale] = useState<"EN" | "AR">(ar ? "AR" : "EN");
  const [confirmOpen, setConfirmOpen] = useState(false);
  const campaignIdempotencyKey = useRef("");
  const sendInFlight = useRef(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const [nextView, nextAudience, nextHistory] = await Promise.all([
        apiFetch<WalletEngagementView>(base),
        apiFetch<AudienceEstimate>(`${base}/audience-estimate`),
        apiFetch<CampaignHistory>(`${base}/campaigns?limit=20`),
      ]);
      setView(nextView);
      setAudience(nextAudience);
      setHistory(nextHistory);
      setNearbyEnabled(nextView.nearby.enabled);
      setSelectedLocations(nextView.nearby.locationIds);
      setCustomEn(nextView.nearby.appleCustomTextEn ?? "");
      setCustomAr(nextView.nearby.appleCustomTextAr ?? "");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Wallet Engagement could not be loaded.");
    } finally {
      setLoading(false);
    }
  }, [base]);

  useEffect(() => {
    void load();
  }, [load]);

  const selectedCoordinateCount = useMemo(
    () =>
      view?.eligibleLocations.filter(
        (location) => selectedLocations.includes(location.id) && location.coordinatesConfigured,
      ).length ?? 0,
    [selectedLocations, view],
  );

  async function saveNearby() {
    if (!view) return;
    setSavingNearby(true);
    setError("");
    setNotice("");
    try {
      await apiFetch(`${base}/nearby`, {
        method: "PATCH",
        body: JSON.stringify({
          enabled: nearbyEnabled,
          locationIds: selectedLocations,
          appleCustomTextEn: customEn.trim() || null,
          appleCustomTextAr: customAr.trim() || null,
          revision: view.nearby.revision,
        }),
      });
      setNotice(
        ar
          ? "تم حفظ إعدادات التذكير القريب ووضع تحديثات Wallet في قائمة التنفيذ."
          : "Nearby settings saved. Wallet pass updates are queued.",
      );
      await load();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Nearby settings could not be saved.");
    } finally {
      setSavingNearby(false);
    }
  }

  function openConfirmation(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!campaignIdempotencyKey.current) campaignIdempotencyKey.current = crypto.randomUUID();
    setConfirmOpen(true);
  }

  async function sendCampaign() {
    if (sendInFlight.current) return;
    sendInFlight.current = true;
    if (!campaignIdempotencyKey.current) campaignIdempotencyKey.current = crypto.randomUUID();
    setSending(true);
    setError("");
    try {
      await apiFetch(`${base}/campaigns`, {
        method: "POST",
        body: JSON.stringify({
          idempotencyKey: campaignIdempotencyKey.current,
          locale: messageLocale,
          title,
          body,
          destinationUrl: destinationUrl.trim() || null,
          providers: ["GOOGLE"],
          audienceRule: "ALL_ELIGIBLE_WALLET_HOLDERS",
        }),
      });
      setConfirmOpen(false);
      setTitle("");
      setBody("");
      setDestinationUrl("");
      campaignIdempotencyKey.current = "";
      setNotice(
        ar
          ? "تم إنشاء الحملة بأمان. ستنفذها خدمة Wallet خارج طلب المتصفح."
          : "Campaign created safely. The Wallet worker will dispatch it outside this browser request.",
      );
      const [nextAudience, nextHistory] = await Promise.all([
        apiFetch<AudienceEstimate>(`${base}/audience-estimate`),
        apiFetch<CampaignHistory>(`${base}/campaigns?limit=20`),
      ]);
      setAudience(nextAudience);
      setHistory(nextHistory);
    } catch (caught) {
      setConfirmOpen(false);
      setError(
        caught instanceof Error ? caught.message : "The Wallet campaign could not be created.",
      );
    } finally {
      sendInFlight.current = false;
      setSending(false);
    }
  }

  if (loading) {
    return (
      <div className="wallet-engagement-loading" role="status">
        <RefreshCcw className="wallet-engagement-loading__icon" aria-hidden="true" />
        {ar ? "جارٍ تحميل تفاعل Wallet…" : "Loading Wallet Engagement…"}
      </div>
    );
  }

  if (!view) return <Alert tone="danger" title={error || "Wallet Engagement is unavailable."} />;

  return (
    <div className="wallet-engagement" data-testid="wallet-engagement">
      {error ? <Alert tone="danger" title={error} /> : null}
      {notice ? <Alert tone="success" title={notice} /> : null}
      {!canManage ? (
        <Alert
          tone="warning"
          title={ar ? "صلاحية الإدارة مطلوبة" : "Management permission required"}
        >
          {ar
            ? "يمكنك مراجعة الحالة، لكن إرسال الرسائل أو تغيير إعدادات Wallet متاح للمالك والمدير فقط."
            : "You can review status, but only an owner or manager can change Wallet settings or send campaigns."}
        </Alert>
      ) : null}

      <section
        className="wallet-signal-path"
        aria-label={ar ? "مسار رسالة Wallet" : "Wallet signal path"}
      >
        <span>
          <StoreSignalIcon />
          {ar ? "المحتوى من التاجر" : "Merchant content"}
        </span>
        <i aria-hidden="true" />
        <span>
          <Radio size={17} />
          {ar ? "قواعد Waflo" : "Waflo safeguards"}
        </span>
        <i aria-hidden="true" />
        <span>
          <WalletCards size={17} />
          {ar ? "عرض المزود" : "Provider presentation"}
        </span>
      </section>

      <div className="wallet-engagement-layout">
        <aside
          className="wallet-provider-rail"
          aria-label={ar ? "إمكانات المزود" : "Provider capabilities"}
        >
          <div>
            <span className="wallet-provider-mark">A</span>
            <div>
              <strong>Apple Wallet</strong>
              <small>{capabilityLabel(view.capabilities.apple.nearbyRelevance, ar)}</small>
            </div>
          </div>
          <ul>
            <li>
              <Check size={14} />
              {ar ? "التذكير القريب" : "Nearby relevance"}
            </li>
            <li>
              <Check size={14} />
              {ar ? "نص قريب مخصص" : "Custom nearby text"}
            </li>
            <li className="wallet-provider-rail__pending">
              {capabilityLabel(view.capabilities.apple.manualPromotion, ar)}
            </li>
          </ul>
          <div>
            <span className="wallet-provider-mark wallet-provider-mark--google">G</span>
            <div>
              <strong>Google Wallet</strong>
              <small>{capabilityLabel(view.capabilities.google.manualPromotion, ar)}</small>
            </div>
          </div>
          <ul>
            <li>
              <Check size={14} />
              {ar ? "رسائل يكتبها التاجر" : "Merchant-written messages"}
            </li>
            <li>
              <Check size={14} />
              {ar ? "إشعار قريب من المزود" : "Provider-native nearby"}
            </li>
            <li>{ar ? "Google يتحكم بنص الإشعار القريب" : "Google controls nearby wording"}</li>
          </ul>
        </aside>

        <div className="wallet-engagement-canvas">
          <Card className="wallet-engagement-section" data-testid="wallet-nearby-card">
            <div className="wallet-engagement-heading">
              <div className="wallet-engagement-heading__icon">
                <MapPin />
              </div>
              <div>
                <Badge tone="brand">01 · {ar ? "قريب" : "NEARBY"}</Badge>
                <h3>{ar ? "تذكير Wallet القريب" : "Nearby Wallet reminder"}</h3>
                <p>
                  {ar
                    ? "اختر حتى 10 مواقع تجارية موثقة. يحدد مزود Wallet وقت وكيفية ظهور البطاقة."
                    : "Choose up to 10 verified business locations. Each Wallet provider decides when and how the card appears."}
                </p>
              </div>
              <label className="wallet-switch">
                <input
                  type="checkbox"
                  checked={nearbyEnabled}
                  disabled={!canManage}
                  onChange={(event) => setNearbyEnabled(event.target.checked)}
                />
                <span aria-hidden="true" />
                {nearbyEnabled ? (ar ? "مفعّل" : "Enabled") : ar ? "متوقف" : "Off"}
              </label>
            </div>

            <div className="wallet-location-grid">
              {view.eligibleLocations.length ? (
                view.eligibleLocations.map((location) => (
                  <label
                    className={`wallet-location-option ${location.coordinatesConfigured ? "" : "wallet-location-option--disabled"}`}
                    key={location.id}
                  >
                    <input
                      className="wallet-location-check"
                      type="checkbox"
                      checked={selectedLocations.includes(location.id)}
                      disabled={
                        !canManage ||
                        (!location.coordinatesConfigured &&
                          !selectedLocations.includes(location.id))
                      }
                      onChange={(event) =>
                        setSelectedLocations((current) =>
                          event.target.checked
                            ? [...current, location.id].slice(0, 10)
                            : current.filter((id) => id !== location.id),
                        )
                      }
                    />
                    <span>
                      <strong>{location.name}</strong>
                      <small>
                        {location.coordinatesConfigured
                          ? `${location.city ?? (ar ? "موقع تجاري" : "Business location")} · ${location.latitude}, ${location.longitude}`
                          : ar
                            ? "أضف الإحداثيات من إعدادات المواقع"
                            : "Add coordinates in Location settings"}
                      </small>
                    </span>
                  </label>
                ))
              ) : (
                <Alert tone="warning" title={ar ? "لا توجد مواقع مؤهلة" : "No eligible locations"}>
                  {ar
                    ? "انشر البطاقة مع موقع نشط، ثم أضف إحداثيات الموقع."
                    : "Publish the card with an active location, then add its coordinates."}
                </Alert>
              )}
            </div>
            <p className="wallet-selection-note">
              {selectedCoordinateCount}/10 {ar ? "مواقع جاهزة" : "locations ready"}
            </p>

            <div className="wallet-provider-disclosures">
              <div>
                <strong>Apple Wallet</strong>
                <p>
                  {ar
                    ? "تطلب Waflo حداً أقصى مرغوباً يبلغ 2000 متر، لكن Apple تحدد مسافة الصلة الفعلية."
                    : view.disclosures.apple}
                </p>
              </div>
              <div>
                <strong>Google Wallet</strong>
                <p>
                  {ar
                    ? "تحدد Google Wallet المسافة ومدة البقاء والتذكير الذي يظهر في النظام."
                    : view.disclosures.google}
                </p>
              </div>
            </div>

            <details className="wallet-custom-copy">
              <summary>
                {ar ? "نص Apple القريب (اختياري)" : "Apple nearby wording (optional)"}
              </summary>
              <p>
                {ar
                  ? "يُستخدم النص المخصص حيث تسمح المنصة. لا يغيّر إشعار Google القريب."
                  : "Custom wording is used where the platform permits it. It does not change Google’s nearby notification."}
              </p>
              <div className="wallet-copy-grid">
                <FormField label="English" hint={`${Array.from(customEn).length}/120`}>
                  <TextArea
                    value={customEn}
                    maxLength={120}
                    disabled={!canManage}
                    onChange={(event) => setCustomEn(event.target.value)}
                  />
                </FormField>
                <FormField label="العربية" hint={`${Array.from(customAr).length}/120`}>
                  <TextArea
                    dir="rtl"
                    value={customAr}
                    maxLength={120}
                    disabled={!canManage}
                    onChange={(event) => setCustomAr(event.target.value)}
                  />
                </FormField>
              </div>
              <Button
                type="button"
                variant="ghost"
                disabled={!canManage || (!customEn && !customAr)}
                onClick={() => {
                  setCustomEn("");
                  setCustomAr("");
                }}
              >
                <RefreshCcw size={15} />
                {ar ? "استعادة نص الفئة" : "Reset to category copy"}
              </Button>
            </details>

            <div className="wallet-nearby-preview">
              <span>{ar ? "معاينة نص Apple" : "APPLE TEXT PREVIEW"}</span>
              <blockquote>
                {ar ? view.nearby.preview.ar.text : view.nearby.preview.en.text}
              </blockquote>
              <small>
                {ar ? "الفئة" : "Vertical"}: {view.nearby.preview.en.vertical.replaceAll("_", " ")}
              </small>
            </div>
            <div className="wallet-engagement-actions">
              <Button
                type="button"
                disabled={!canManage || (nearbyEnabled && selectedCoordinateCount === 0)}
                loading={savingNearby}
                onClick={() => void saveNearby()}
              >
                {ar ? "حفظ التذكير القريب" : "Save nearby reminder"}
              </Button>
            </div>
          </Card>

          <Card className="wallet-engagement-section" data-testid="wallet-compose-card">
            <div className="wallet-engagement-heading">
              <div className="wallet-engagement-heading__icon">
                <BellRing />
              </div>
              <div>
                <Badge tone="brand">02 · {ar ? "إرسال" : "SEND"}</Badge>
                <h3>{ar ? "إرسال رسالة إلى Wallet" : "Send a Wallet message"}</h3>
                <p>
                  {ar
                    ? "تُرسل فقط إلى حاملي Google Wallet النشطين الذين منحوا موافقة ترويجية حالية."
                    : "Only active Google Wallet holders with current promotional consent are eligible."}
                </p>
              </div>
            </div>
            {!view.capabilities.google.selectableForManualPromotion ? (
              <Alert
                tone="warning"
                title={ar ? "Google Wallet يحتاج إلى إعداد" : "Google Wallet setup required"}
              />
            ) : null}
            <div className="wallet-audience-strip">
              <ShieldCheck />
              <div>
                <strong>{audience?.total ?? 0}</strong>
                <small>{ar ? "مستلم مؤهل الآن" : "eligible recipients now"}</small>
              </div>
              <span>
                {ar
                  ? "الموافقة قابلة للإلغاء · لا توجد قائمة عملاء من المتصفح"
                  : "Revocable consent · no browser-supplied customer list"}
              </span>
            </div>
            <form className="wallet-campaign-form" onSubmit={openConfirmation}>
              <div className="wallet-form-row">
                <FormField label={ar ? "اللغة" : "Message language"} required>
                  <Select
                    value={messageLocale}
                    onChange={(event) => {
                      campaignIdempotencyKey.current = "";
                      setMessageLocale(event.target.value as "EN" | "AR");
                    }}
                    disabled={!canManage}
                  >
                    <option value="EN">English</option>
                    <option value="AR">العربية</option>
                  </Select>
                </FormField>
                <fieldset className="wallet-provider-choice">
                  <legend className="sr-only">{ar ? "المزود" : "Provider"}</legend>
                  <span>Google Wallet</span>
                  <Badge tone="success">TEXT_AND_NOTIFY</Badge>
                </fieldset>
              </div>
              <FormField
                label={ar ? "العنوان" : "Title"}
                hint={`${Array.from(title).length}/60`}
                required
              >
                <TextInput
                  value={title}
                  minLength={1}
                  maxLength={60}
                  required
                  disabled={!canManage}
                  dir={messageLocale === "AR" ? "rtl" : "ltr"}
                  onChange={(event) => {
                    campaignIdempotencyKey.current = "";
                    setTitle(event.target.value);
                  }}
                />
              </FormField>
              <FormField
                label={ar ? "الرسالة" : "Message"}
                hint={`${Array.from(body).length}/240`}
                required
              >
                <TextArea
                  value={body}
                  minLength={1}
                  maxLength={240}
                  required
                  disabled={!canManage}
                  dir={messageLocale === "AR" ? "rtl" : "ltr"}
                  onChange={(event) => {
                    campaignIdempotencyKey.current = "";
                    setBody(event.target.value);
                  }}
                />
              </FormField>
              <FormField
                label={ar ? "رابط وجهة آمن (اختياري)" : "Safe destination URL (optional)"}
                hint={
                  ar
                    ? "HTTPS على نطاق التاجر أو Waflo فقط"
                    : "HTTPS on this merchant’s or Waflo’s domain only"
                }
              >
                <TextInput
                  type="url"
                  inputMode="url"
                  placeholder="https://…"
                  value={destinationUrl}
                  disabled={!canManage}
                  onChange={(event) => {
                    campaignIdempotencyKey.current = "";
                    setDestinationUrl(event.target.value);
                  }}
                />
              </FormField>
              <div className="wallet-message-preview">
                <div>
                  <span>
                    {ar
                      ? "محتوى محفوظ في Google Wallet"
                      : "MESSAGE CONTENT STORED IN GOOGLE WALLET"}
                  </span>
                  <strong dir={messageLocale === "AR" ? "rtl" : "ltr"}>
                    {title || (ar ? "عنوان رسالتك" : "Your message title")}
                  </strong>
                  <p dir={messageLocale === "AR" ? "rtl" : "ltr"}>
                    {body ||
                      (ar
                        ? "ستظهر رسالتك هنا قبل الإرسال."
                        : "Your message content will appear here before sending.")}
                  </p>
                </div>
                <div className="wallet-message-preview__system">
                  <Radio size={18} />
                  <span>
                    {ar
                      ? "تتحكم Google في عرض إشعار النظام"
                      : "Google controls the system notification presentation"}
                  </span>
                </div>
              </div>
              <div className="wallet-engagement-actions">
                <Button
                  type="submit"
                  disabled={
                    !canManage ||
                    !audience?.total ||
                    !view.capabilities.google.selectableForManualPromotion
                  }
                >
                  <Send size={16} />
                  {ar ? "مراجعة وإرسال" : "Review and send"}
                </Button>
              </div>
            </form>
          </Card>

          <Card
            className="wallet-engagement-section wallet-history"
            data-testid="wallet-campaign-history"
          >
            <div className="wallet-engagement-heading">
              <div>
                <Badge>03 · {ar ? "السجل" : "HISTORY"}</Badge>
                <h3>{ar ? "سجل الحملات" : "Campaign history"}</h3>
              </div>
            </div>
            {history.items.length ? (
              <div className="wallet-history-list">
                {history.items.map((campaign) => (
                  <article key={campaign.id}>
                    <header>
                      <div>
                        <strong>{campaign.title}</strong>
                        <small>
                          {new Intl.DateTimeFormat(ar ? "ar-IQ" : "en", {
                            dateStyle: "medium",
                            timeStyle: "short",
                          }).format(new Date(campaign.createdAt))}{" "}
                          · {campaign.creator}
                        </small>
                      </div>
                      <Badge
                        tone={
                          campaign.status === "SUCCEEDED"
                            ? "success"
                            : campaign.status === "FAILED"
                              ? "danger"
                              : "brand"
                        }
                      >
                        {campaign.status.replaceAll("_", " ")}
                      </Badge>
                    </header>
                    <p dir={campaign.locale === "AR" ? "rtl" : "ltr"}>{campaign.body}</p>
                    <footer>
                      <CampaignCount
                        label={ar ? "مؤهل" : "eligible"}
                        value={campaign.counts.eligible}
                      />
                      <CampaignCount
                        label={ar ? "نجح" : "succeeded"}
                        value={campaign.counts.succeeded}
                      />
                      <CampaignCount
                        label={ar ? "تم تخطيه" : "skipped"}
                        value={campaign.counts.skipped}
                      />
                      <CampaignCount label={ar ? "فشل" : "failed"} value={campaign.counts.failed} />
                    </footer>
                  </article>
                ))}
              </div>
            ) : (
              <div className="wallet-history-empty">
                <BellRing />
                <strong>{ar ? "لا توجد حملات بعد" : "No campaigns yet"}</strong>
                <p>
                  {ar
                    ? "ستظهر الرسائل المرسلة وحالة التسليم هنا."
                    : "Sent messages and delivery status will appear here."}
                </p>
              </div>
            )}
          </Card>
        </div>
      </div>

      <Modal
        open={confirmOpen}
        className="wallet-send-confirmation"
        title={ar ? "تأكيد إرسال رسالة Wallet" : "Confirm Wallet message"}
        description={
          ar
            ? "راجع الجمهور والمحتوى قبل إنشاء الحملة."
            : "Review the audience and content before creating the campaign."
        }
        descriptionVisible
        locked={sending}
        onClose={() => setConfirmOpen(false)}
      >
        <div className="wallet-confirmation-summary" data-testid="wallet-send-confirmation">
          <dl>
            <div>
              <dt>{ar ? "بطاقة الولاء" : "Loyalty Card"}</dt>
              <dd>{view.program.name}</dd>
            </div>
            <div>
              <dt>{ar ? "الجمهور المؤهل" : "Eligible audience"}</dt>
              <dd>{audience?.total ?? 0}</dd>
            </div>
            <div>
              <dt>{ar ? "المزود" : "Provider"}</dt>
              <dd>Google Wallet</dd>
            </div>
          </dl>
          <div className="wallet-confirmation-message" dir={messageLocale === "AR" ? "rtl" : "ltr"}>
            <strong>{title}</strong>
            <p>{body}</p>
          </div>
          <Alert
            tone="warning"
            title={ar ? "يتحكم المزود في العرض النهائي" : "Provider-controlled presentation"}
          >
            {ar
              ? "يُحفظ محتوى الرسالة في Google Wallet، لكن Google تتحكم في ظهور إشعار شاشة القفل وتوقيته."
              : "Your message content is stored in Google Wallet, but Google controls lock-screen notification presentation and timing."}
          </Alert>
          <div className="wallet-engagement-actions">
            <Button
              type="button"
              variant="secondary"
              disabled={sending}
              onClick={() => setConfirmOpen(false)}
            >
              {ar ? "رجوع" : "Go back"}
            </Button>
            <Button type="button" loading={sending} onClick={() => void sendCampaign()}>
              <Send size={16} />
              {ar ? "إرسال الآن" : "Send now"}
            </Button>
          </div>
        </div>
      </Modal>
    </div>
  );
}

function StoreSignalIcon() {
  return <BellRing size={17} aria-hidden="true" />;
}
