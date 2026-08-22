import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { isLocale } from "@waflo/i18n";
import { MarketingShell } from "../../../components/marketing-shell";
import { configuredLegalEffectiveDate, createMarketingMetadata } from "../../../lib/seo";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  return isLocale(locale) ? createMarketingMetadata(locale, "refunds") : {};
}

export default async function RefundPolicyPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  if (!isLocale(locale)) notFound();
  const ar = locale === "ar";
  return (
    <MarketingShell locale={locale} path="/refunds">
      <article className="marketing-container marketing-content">
        <span className="marketing-kicker">{ar ? "الفوترة والاسترداد" : "Billing & refunds"}</span>
        <h1>{ar ? "سياسة Waflo للفوترة والاسترداد" : "Waflo Billing & Refund Policy"}</h1>
        <p className="marketing-content__lead">
          {ar
            ? "تشرح هذه السياسة كيف نراجع مشكلات الفواتير من دون اعتبار الإلغاء أو التخفيض استرداداً تلقائياً. لا تحد هذه السياسة من أي حقوق إلزامية يمنحها القانون المعمول به."
            : "This policy explains how Waflo reviews billing issues without treating cancellation or downgrade as an automatic refund. It does not limit mandatory rights available under applicable law."}
        </p>
        <div className="marketing-legal">
          <p>
            <strong>{ar ? "تاريخ السريان:" : "Effective date:"}</strong>{" "}
            {configuredLegalEffectiveDate(locale)}
          </p>
          <div className="wf-alert wf-alert--warning">
            <div>
              <strong>LEGAL_REVIEW_REQUIRED</strong>
              <div>
                {ar
                  ? "تتطلب الاستحقاقات القانونية الخاصة بكل دولة مراجعة قانونية قبل الإطلاق. تسري حقوق المستهلك الإلزامية دائماً حيث تنطبق."
                  : "Jurisdiction-specific legal entitlements require review before launch. Mandatory statutory consumer rights always remain available where they apply."}
              </div>
            </div>
          </div>
          <h2>{ar ? "مصطلحات مختلفة" : "Different billing outcomes"}</h2>
          <dl className="marketing-policy-definitions">
            <div>
              <dt>{ar ? "الإلغاء" : "Cancellation"}</dt>
              <dd>
                {ar
                  ? "يوقف التجديد وفق حالة الاشتراك؛ ولا يعيد تلقائياً دفعة سابقة."
                  : "Stops renewal according to the subscription state; it does not automatically reverse a past payment."}
              </dd>
            </div>
            <div>
              <dt>{ar ? "التخفيض" : "Downgrade"}</dt>
              <dd>
                {ar
                  ? "ينقل المؤسسة إلى حدود خطة أدنى بعد معالجة المتطلبات؛ وليس استرداداً."
                  : "Moves an organization to lower plan limits after blockers are resolved; it is not a refund."}
              </dd>
            </div>
            <div>
              <dt>{ar ? "الاسترداد" : "Refund"}</dt>
              <dd>
                {ar
                  ? "يعيد مبلغاً كاملاً أو جزئياً، بعد الموافقة، عبر مسار الدفع الأصلي في Stripe."
                  : "Returns an approved full or partial amount through the original Stripe payment path."}
              </dd>
            </div>
            <div>
              <dt>{ar ? "رصيد الحساب" : "Account credit"}</dt>
              <dd>
                {ar
                  ? "تسوية تطبق على التزامات مستقبلية إن عُرضت صراحة؛ وليست أموالاً معادة إلى البطاقة."
                  : "An explicitly offered adjustment toward future obligations; it is not money returned to a card."}
              </dd>
            </div>
            <div>
              <dt>{ar ? "نزاع الدفع" : "Payment dispute"}</dt>
              <dd>
                {ar
                  ? "إجراء منفصل لدى جهة إصدار البطاقة أو شبكة الدفع، وقد يتطلب تصعيداً أمنياً."
                  : "A separate issuer or payment-network process that may require security escalation."}
              </dd>
            </div>
          </dl>
          <h2>{ar ? "ما يمكن مراجعته" : "What Waflo can review"}</h2>
          <p>
            {ar
              ? "يمكن طلب مراجعة لدفعة مكررة أو غير صحيحة، أو تعطل جوهري في الخدمة، أو دفعة غير مصرح بها، أو سبب آخر موضح. قد تؤدي المراجعة إلى استرداد كامل أو جزئي عندما تدعمه الوقائع وسياسة المنتج والقانون المعمول به."
              : "You can request review of a duplicate or incorrect charge, a material service failure, an unauthorized payment, or another explained issue. Review may result in a full or partial refund when supported by the facts, product policy, and applicable law."}
          </p>
          <p>
            {ar
              ? "قد لا تُرد الفترات المستخدمة أو تغييرات الرأي أو الإلغاء بعد بدء فترة مدفوعة، حيث يسمح القانون بذلك. لا تعني هذه الأمثلة أن جميع المبيعات نهائية، ولا تستبعد حقاً قانونياً إلزامياً."
              : "Used service periods, changes of mind, or cancellation after a paid period begins may be non-refundable where law permits. These examples do not make all sales final and do not exclude a mandatory legal right."}
          </p>
          <h2>{ar ? "كيفية الطلب" : "How to request a review"}</h2>
          <p>
            {ar
              ? "افتح الفوترة في لوحة التاجر، واختر فاتورة مدفوعة مؤهلة، ثم اختر «طلب استرداد». حدد السبب والمبلغ المطلوب وأضف شرحاً مفيداً. تحفظ Waflo مرجع الفاتورة وتاريخها وعملتها تلقائياً؛ لا ترسل رقم بطاقة كاملاً أو رمز CVC."
              : "Open Billing in the merchant dashboard, choose an eligible paid invoice, and select “Request refund.” Choose a reason and amount and add a useful explanation. Waflo records the invoice reference, date, and currency automatically; never send a full card number or CVC."}
          </p>
          <h2>{ar ? "المراجعة والحالة" : "Review and status"}</h2>
          <p>
            {ar
              ? "يبدأ الطلب بالحالة «مطلوب»، ثم قد ينتقل إلى «قيد المراجعة» و«موافق عليه» و«قيد المعالجة» و«ناجح» أو إلى «مرفوض» أو «فشل». تمنع Waflo الطلبات النشطة المكررة والمبالغ التي تتجاوز الرصيد القابل للاسترداد."
              : "A request starts as Requested and may move through Under review, Approved, Processing, and Succeeded, or to Rejected or Failed. Waflo prevents duplicate active requests and amounts above the server-calculated refundable balance."}
          </p>
          <h2>{ar ? "بعد الموافقة" : "After approval"}</h2>
          <p>
            {ar
              ? "ترسل Stripe الاسترداد إلى مسار الدفع الأصلي، وليس إلى بطاقة جديدة محفوظة لاحقاً. يختلف وقت ظهور المبلغ بعد نجاح الاسترداد حسب جهة الإصدار وشبكة الدفع، ولا تستطيع Waflo تسريع مدة المعالجة البنكية."
              : "Stripe returns the refund through the original payment path, not a newly saved card. After a refund succeeds, posting time varies by issuer and payment network, and Waflo cannot accelerate bank processing."}
          </p>
          <h2>{ar ? "التعديلات المحاسبية" : "Accounting treatment"}</h2>
          <p>
            <strong>LEGAL_ACCOUNTING_REVIEW_REQUIRED.</strong>{" "}
            {ar
              ? "قد تتطلب بعض الفواتير النهائية أو بعض الدول إشعاراً دائناً في Stripe إضافة إلى الاسترداد. لا تنشئ Waflo تعديلاً محلياً وهمياً؛ سيحدد المختص القانوني والمحاسبي المعالجة المطلوبة للاسترداد الكامل أو الجزئي أو رصيد الحساب أو التسوية خارج Stripe."
              : "Some finalized invoices or jurisdictions may require a Stripe Credit Note in addition to a refund. Waflo does not create a Waflo-only financial adjustment; legal and accounting review will determine the required treatment for full refunds, partial refunds, account credits, and out-of-band adjustments."}
          </p>
          <p>
            <a href={`/${locale}/contact`}>{ar ? "تواصل مع Waflo" : "Contact Waflo"}</a>
          </p>
        </div>
      </article>
    </MarketingShell>
  );
}
