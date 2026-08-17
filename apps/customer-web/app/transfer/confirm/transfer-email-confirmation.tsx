"use client";

import { Alert, Badge, Button, Card } from "@waflo/ui";
import { Check, ShieldCheck } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { customerApi } from "../../client-api";

export function TransferEmailConfirmation({ locale }: { locale: "en" | "ar" }) {
  const proof = useRef<{ transferPublicId: string; token: string } | null>(null);
  const [state, setState] = useState<"ready" | "working" | "complete" | "invalid">("ready");
  const [message, setMessage] = useState("");
  const [membershipId, setMembershipId] = useState("");
  const [cardQuery, setCardQuery] = useState("");
  const ar = locale === "ar";

  useEffect(() => {
    const tenant = new URLSearchParams(window.location.search).get("tenant");
    const nextQuery = new URLSearchParams({ lang: locale });
    if (tenant) nextQuery.set("tenant", tenant);
    setCardQuery(`?${nextQuery.toString()}`);
    const fragment = new URLSearchParams(window.location.hash.slice(1));
    const transferPublicId = fragment.get("transfer") ?? "";
    const token = fragment.get("token") ?? "";
    window.history.replaceState(null, "", `${window.location.pathname}${window.location.search}`);
    if (!transferPublicId || !token) {
      setState("invalid");
      setMessage(
        ar
          ? "رابط التأكيد غير مكتمل أو تمت إزالة بياناته بالفعل."
          : "This confirmation link is incomplete or has already been removed.",
      );
      return;
    }
    proof.current = { transferPublicId, token };
  }, [ar, locale]);

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
      setMessage(
        caught instanceof Error
          ? caught.message
          : ar
            ? "تعذر تأكيد نقل البطاقة."
            : "Transfer confirmation failed.",
      );
    }
  }

  return (
    <main className="customer-page customer-centered" lang={locale} dir={ar ? "rtl" : "ltr"}>
      <Card className="transfer-result">
        {state === "complete" ? <Check /> : <ShieldCheck />}
        <Badge tone={state === "invalid" ? "warning" : "brand"}>
          {ar ? "نقل آمن للبطاقة" : "SECURE CARD TRANSFER"}
        </Badge>
        <h1>
          {state === "complete"
            ? ar
              ? "تم نقل البطاقة"
              : "Card transferred"
            : ar
              ? "تأكيد نقل البطاقة"
              : "Confirm this transfer"}
        </h1>
        <p>
          {state === "complete"
            ? ar
              ? "لم تعد بيانات اعتماد الرمز القديمة وبطاقات Wallet القديمة صالحة. قد يكتمل التحديث خلال وقت قصير."
              : "The old QR credential and old Wallet objects are no longer valid. Wallet updates may finish shortly."
            : ar
              ? "تابع فقط إذا طلبت هذا النقل. يؤكد هذا الإجراء تحكمك بالبريد الإلكتروني المحفوظ."
              : "Continue only if you requested this transfer. Confirmation proves control of the stored email."}
        </p>
        {message ? <Alert tone="danger" title={message} /> : null}
        {state === "complete" ? (
          <a href={`/card/${membershipId}${cardQuery}`}>
            <Button>{ar ? "فتح البطاقة الجديدة" : "Open the new card"}</Button>
          </a>
        ) : (
          <Button
            onClick={() => void confirm()}
            loading={state === "working"}
            disabled={state === "invalid"}
          >
            {ar ? "تأكيد ونقل البطاقة" : "Confirm and transfer"}
          </Button>
        )}
      </Card>
    </main>
  );
}
