"use client";

import type { Locale } from "@waflo/contracts";
import { Alert, Badge, Button } from "@waflo/ui";
import { useEffect, useState } from "react";
import { apiFetch, ApiClientError } from "../lib/api-client";

interface InvitationView {
  organizationName: string;
  role: "MANAGER" | "STAFF";
  invitedEmail: string;
  expiresAt: string;
}

export function InviteClient({ locale, token }: { locale: Locale; token: string }) {
  const ar = locale === "ar";
  const [invitation, setInvitation] = useState<InvitationView | null>(null);
  const [error, setError] = useState("");
  const [accepted, setAccepted] = useState(false);
  const [loading, setLoading] = useState(false);
  useEffect(() => {
    void apiFetch<InvitationView>(`/v1/invitations/${encodeURIComponent(token)}`)
      .then(setInvitation)
      .catch((caught: unknown) =>
        setError(caught instanceof ApiClientError ? caught.message : "Invitation unavailable."),
      );
  }, [token]);
  async function accept() {
    setLoading(true);
    try {
      await apiFetch(`/v1/invitations/${encodeURIComponent(token)}/accept`, { method: "POST" });
      setAccepted(true);
    } catch (caught) {
      if (caught instanceof ApiClientError && caught.code === "AUTH_REQUIRED") {
        window.location.assign(`/${locale}/login`);
        return;
      }
      setError(caught instanceof ApiClientError ? caught.message : "Unable to accept.");
    } finally {
      setLoading(false);
    }
  }
  if (error) return <Alert tone="danger" title={error} />;
  if (accepted) {
    return (
      <>
        <Alert tone="success" title={ar ? "تم قبول الدعوة" : "Invitation accepted"} />
        <a href={`/${locale}/dashboard`}>
          <Button style={{ width: "100%", marginTop: "1rem" }}>
            {ar ? "فتح لوحة التحكم" : "Open dashboard"}
          </Button>
        </a>
      </>
    );
  }
  if (!invitation) return <p>{ar ? "جارٍ تحميل الدعوة…" : "Loading invitation…"}</p>;
  return (
    <>
      <h2>
        {ar ? `دعوة إلى ${invitation.organizationName}` : `Join ${invitation.organizationName}`}
      </h2>
      <p className="auth-card__intro">
        {ar
          ? `تمت دعوتك باستخدام ${invitation.invitedEmail}. سجّل الدخول بالبريد نفسه للقبول.`
          : `You were invited as ${invitation.invitedEmail}. Sign in with the same email to accept.`}
      </p>
      <Badge tone="brand">{invitation.role}</Badge>
      <Button onClick={accept} loading={loading} style={{ width: "100%", marginTop: "1.5rem" }}>
        {ar ? "قبول الدعوة" : "Accept invitation"}
      </Button>
      <p className="auth-form__footer">
        {ar ? "ليس لديك حساب؟" : "Need an account?"}{" "}
        <a href={`/${locale}/signup`}>
          {ar ? "أنشئ حساباً بالبريد المدعو" : "Register with the invited email"}
        </a>
      </p>
    </>
  );
}
