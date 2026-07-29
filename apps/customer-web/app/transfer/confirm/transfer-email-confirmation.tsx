"use client";

import { Alert, Badge, Button, Card } from "@waflo/ui";
import { Check, ShieldCheck } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { customerApi } from "../../client-api";

export function TransferEmailConfirmation() {
  const proof = useRef<{ transferPublicId: string; token: string } | null>(null);
  const [state, setState] = useState<"ready" | "working" | "complete" | "invalid">("ready");
  const [message, setMessage] = useState("");
  const [membershipId, setMembershipId] = useState("");
  const [tenantQuery, setTenantQuery] = useState("");

  useEffect(() => {
    const tenant = new URLSearchParams(window.location.search).get("tenant");
    setTenantQuery(tenant ? `?tenant=${encodeURIComponent(tenant)}` : "");
    const fragment = new URLSearchParams(window.location.hash.slice(1));
    const transferPublicId = fragment.get("transfer") ?? "";
    const token = fragment.get("token") ?? "";
    window.history.replaceState(null, "", `${window.location.pathname}${window.location.search}`);
    if (!transferPublicId || !token) {
      setState("invalid");
      setMessage("This confirmation link is incomplete or has already been removed.");
      return;
    }
    proof.current = { transferPublicId, token };
  }, []);

  async function confirm() {
    if (!proof.current) return;
    setState("working");
    setMessage("");
    try {
      const result = await customerApi<{ publicMembershipId: string }>(
        "/v1/public/transfers/confirm-email",
        {
          method: "POST",
          body: JSON.stringify(proof.current),
        },
      );
      proof.current = null;
      setMembershipId(result.publicMembershipId);
      setState("complete");
    } catch (caught) {
      setState("invalid");
      setMessage(caught instanceof Error ? caught.message : "Transfer confirmation failed.");
    }
  }

  return (
    <main className="customer-page customer-centered">
      <Card className="transfer-result">
        {state === "complete" ? <Check /> : <ShieldCheck />}
        <Badge tone={state === "invalid" ? "warning" : "brand"}>SECURE CARD TRANSFER</Badge>
        <h1>{state === "complete" ? "Card transferred" : "Confirm this transfer"}</h1>
        <p>
          {state === "complete"
            ? "The old QR credential and old Wallet objects are no longer valid. Provider updates may finish shortly."
            : "Continue only if you requested this transfer. Confirmation proves control of the stored email."}
        </p>
        {message ? <Alert tone="danger" title={message} /> : null}
        {state === "complete" ? (
          <a href={`/card/${membershipId}${tenantQuery}`}>
            <Button>Open the new card</Button>
          </a>
        ) : (
          <Button
            onClick={() => void confirm()}
            loading={state === "working"}
            disabled={state === "invalid"}
          >
            Confirm and transfer
          </Button>
        )}
      </Card>
    </main>
  );
}
