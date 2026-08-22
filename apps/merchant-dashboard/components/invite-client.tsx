"use client";

import { messages, type InterfaceLocale } from "@waflo/i18n";
import { Alert, Badge, Button } from "@waflo/ui";
import { useEffect, useState } from "react";
import { apiFetch, ApiClientError } from "../lib/api-client";

interface InvitationView {
  organizationName: string;
  role: "MANAGER" | "STAFF";
  invitedEmail: string;
  expiresAt: string;
}

export function InviteClient({ locale }: { locale: InterfaceLocale }) {
  const copy = messages[locale].auth;
  const [token, setToken] = useState("");
  const [invitation, setInvitation] = useState<InvitationView | null>(null);
  const [error, setError] = useState("");
  const [accepted, setAccepted] = useState(false);
  const [loading, setLoading] = useState(false);
  useEffect(() => {
    // Tokens travel in the URL fragment (#token=...) so the browser never
    // sends the raw value to the Next.js server. Reject legacy ?token= links.
    if (typeof window === "undefined") return;

    // Reject legacy query-token links.
    const legacyUrl = new URL(window.location.href);
    if (legacyUrl.searchParams.get("token")) {
      legacyUrl.searchParams.delete("token");
      window.history.replaceState(null, "", `${legacyUrl.pathname}${legacyUrl.search}`);
      setError(copy.invite.invalidOrExpired);
      return;
    }

    const hash = window.location.hash;
    // Remove the fragment immediately before any async work.
    window.history.replaceState(null, "", window.location.pathname + window.location.search);

    const fragmentToken = hash.startsWith("#token=")
      ? decodeURIComponent(hash.slice("#token=".length))
      : "";
    setToken(fragmentToken);
    if (!fragmentToken) {
      setError(copy.invite.unavailable);
      return;
    }
    void apiFetch<InvitationView>("/v1/invitations/inspect", {
      method: "POST",
      body: JSON.stringify({ token: fragmentToken }),
    })
      .then(setInvitation)
      .catch((caught: unknown) => {
        if (!(caught instanceof ApiClientError)) {
          setError(copy.invite.unavailable);
          return;
        }
        const mapped =
          caught.code === "INVITATION_EXPIRED"
            ? copy.apiErrors.invitationExpired
            : caught.code === "INVITATION_ALREADY_ACCEPTED"
              ? copy.apiErrors.invitationAccepted
              : copy.apiErrors.invitationUnavailable;
        setError(mapped);
      });
  }, [copy]);
  async function accept() {
    setLoading(true);
    try {
      await apiFetch("/v1/invitations/accept", {
        method: "POST",
        body: JSON.stringify({ token }),
      });
      setAccepted(true);
    } catch (caught) {
      if (caught instanceof ApiClientError && caught.code === "AUTH_REQUIRED") {
        window.location.assign(`/${locale}/login`);
        return;
      }
      setError(
        caught instanceof ApiClientError && caught.code === "INVITATION_EMAIL_MISMATCH"
          ? copy.apiErrors.invitationEmailMismatch
          : copy.invite.acceptError,
      );
    } finally {
      setLoading(false);
    }
  }
  if (error) return <Alert tone="danger" title={error} />;
  if (accepted) {
    return (
      <>
        <Alert tone="success" title={copy.invite.accepted} />
        <a href={`/${locale}/dashboard`}>
          <Button style={{ width: "100%", marginTop: "1rem" }}>{copy.common.openDashboard}</Button>
        </a>
      </>
    );
  }
  if (!invitation) return <p>{copy.invite.loading}</p>;
  return (
    <>
      <h2>
        {copy.invite.joinOrganization.replace("{organizationName}", invitation.organizationName)}
      </h2>
      <p className="auth-card__intro">
        {copy.invite.invitedAs.replace("{email}", invitation.invitedEmail)}
      </p>
      <Badge tone="brand">
        {invitation.role === "MANAGER" ? copy.invite.roleManager : copy.invite.roleStaff}
      </Badge>
      <Button onClick={accept} loading={loading} style={{ width: "100%", marginTop: "1.5rem" }}>
        {copy.invite.accept}
      </Button>
      <p className="auth-form__footer">
        {copy.invite.needAccount} <a href={`/${locale}/signup`}>{copy.invite.register}</a>
      </p>
    </>
  );
}
