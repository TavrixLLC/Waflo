import { Card } from "@waflo/ui";
import { CustomerHeader } from "../page";

export const dynamic = "force-dynamic";

export default async function CustomerPrivacyPage({
  searchParams,
}: {
  searchParams: Promise<{ lang?: string }>;
}) {
  const ar = (await searchParams).lang === "ar";
  const locale = ar ? "ar" : "en";
  return (
    <main className="customer-page legal-page" lang={locale} dir={ar ? "rtl" : "ltr"}>
      <CustomerHeader locale={locale} languagePath="/privacy" />
      <Card>
        <span className="customer-kicker">
          {ar
            ? "خصوصية العميل · المراجعة القانونية مطلوبة"
            : "CUSTOMER PRIVACY · LEGAL REVIEW PENDING"}
        </span>
        <h1>
          {ar ? "كيف تتعامل Waflo مع بيانات بطاقة الولاء" : "How Waflo handles loyalty-card data"}
        </h1>
        <p>
          {ar
            ? "تمتلك Tavrix LLC منصة Waflo وتديرها. يدير التاجر الظاهر في صفحة التسجيل برنامج الولاء الخاص به حيثما كان ذلك مناسباً قانونياً. هذا الإشعار مسودة تنفيذية للمنتج ولا يزال خاضعاً للمراجعة القانونية."
            : "Tavrix LLC owns and operates the Waflo platform. The merchant shown on your enrollment page operates its loyalty program where legally appropriate. This notice is a product implementation draft and remains subject to counsel review."}
        </p>
        <h2>{ar ? "البيانات والغرض" : "Data and purpose"}</h2>
        <p>
          {ar
            ? "تخزن Waflo الاسم الظاهر على بطاقتك ولغتك وموافقة التسجيل وتقدم البطاقة، وعنوان البريد الإلكتروني فقط عندما يطلبه البرنامج. يُشفّر البريد الإلكتروني ويُستخدم لنقل البطاقة بأمان وللاتصالات التي وافقت عليها بشكل منفصل. تحتوي رموز QR على بيانات اعتماد مبهمة وقابلة للإلغاء بدلاً من اسمك أو بريدك الإلكتروني أو تقدمك."
            : "Waflo stores the name displayed on your card, your language, enrollment consent, card progress, and—only when the program requests it—an email address. Email is encrypted and used for secure card transfer and separately consented communications. QR codes contain opaque, revocable credentials rather than your name, email, or progress."}
        </p>
        <h2>{ar ? "مزودو المحفظة ونقل البطاقة" : "Wallet providers and transfer"}</h2>
        <p>
          {ar
            ? "إذا اخترت Apple Wallet أو Google Wallet، يتلقى المزود حقول البطاقة اللازمة لعرض البطاقة وتحديثها. يؤدي نقل البطاقة إلى تدوير بيانات اعتماد QR وإبطال كائنات المزود القديمة. يكون النقل من دون بريد إلكتروني أقل أماناً لأن امتلاك لقطة شاشة لرمز QR قد يكون كافياً لإثبات التحكم."
            : "If you choose Apple Wallet or Google Wallet, the provider receives the card fields needed to display and update the pass. Moving a card rotates its QR credential and invalidates old provider objects. Transfer without email is less secure because possession of a QR screenshot may be enough to prove control."}
        </p>
        <h2>{ar ? "خياراتك وحقوقك" : "Your choices and rights"}</h2>
        <p>
          {ar
            ? "الموافقة التسويقية منفصلة واختيارية. تظل مسارات تصدير بيانات العميل وحذفها وقنوات طلب الحقوق ومدد الاحتفاظ والصياغة الخاصة بكل ولاية قضائية خاضعة للمراجعة القانونية. لا يُذكر هنا عنوان بريدي غير متحقق منه لشركة Tavrix LLC."
            : "Marketing consent is separate and optional. Customer data export and deletion workflows, rights-request contacts, retention periods, and jurisdiction-specific language remain subject to legal review. No unverified Tavrix LLC postal address is asserted here."}
        </p>
      </Card>
    </main>
  );
}
