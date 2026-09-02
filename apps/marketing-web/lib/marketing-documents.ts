import type { InterfaceLocale } from "@waflo/i18n";

export type MarketingDocumentId = "contact" | "terms" | "privacy" | "refunds";

export interface MarketingDocumentCopy {
  readonly kicker: string;
  readonly title: string;
  readonly lede: string;
  readonly effectiveDate: string;
  readonly sections: readonly { readonly heading: string; readonly body: string }[];
  readonly alert?: string;
  readonly contactLabel?: string;
}

type MarketingDocuments = Readonly<Record<MarketingDocumentId, MarketingDocumentCopy>>;

const en: MarketingDocuments = {
  contact: {
    kicker: "Contact Waflo",
    title: "How can we help?",
    lede: "Contact us about merchant setup, digital loyalty cards, or support for your account.",
    effectiveDate: "",
    sections: [
      {
        heading: "Support",
        body: "Send your message to our configured support channel. If public email is not yet available, existing merchants can continue in the merchant dashboard.",
      },
    ],
    contactLabel: "Open merchant dashboard",
  },
  terms: {
    kicker: "Terms",
    title: "Waflo Terms of Service",
    lede: "These terms are an initial operating document and will receive legal review before public launch.",
    effectiveDate: "Effective date:",
    sections: [
      {
        heading: "The service",
        body: "Tavrix LLC provides Waflo to help local businesses create and manage digital loyalty cards and programs. Wallet-provider availability may depend on service and merchant-program configuration.",
      },
      {
        heading: "Accounts",
        body: "Users are responsible for safeguarding credentials, providing accurate information, and using permissions within their organization’s authority.",
      },
      {
        heading: "Plans and billing",
        body: "The 15-day free trial starts after you choose a plan and billing cadence, add a valid payment method, and confirm the subscription. We show the price and first charge date before confirmation.",
      },
      {
        heading: "Legal review",
        body: "This version is not final legal advice and will be replaced by an approved version before launch.",
      },
    ],
    contactLabel: "Contact Waflo",
  },
  privacy: {
    kicker: "Privacy",
    title: "Waflo Privacy Policy",
    lede: "This document outlines the initial principles for handling merchant account data. It will receive legal review before public launch.",
    effectiveDate: "Effective date:",
    sections: [
      { heading: "Who operates Waflo", body: "Waflo is owned and operated by Tavrix LLC." },
      {
        heading: "Data we process",
        body: "Account, organization, and session data needed to provide and secure the platform, plus limited audit and security records.",
      },
      {
        heading: "Security and retention",
        body: "We use strong password hashing, revocable sessions, and tenant-scoped access controls. Final retention periods will be set after legal review.",
      },
      {
        heading: "Contact",
        body: "Use the public contact page to reach Waflo through the configured support channel.",
      },
    ],
    contactLabel: "Contact Waflo",
  },
  refunds: {
    kicker: "Billing & refunds",
    title: "Waflo Billing & Refund Policy",
    lede: "This policy explains how Waflo reviews billing issues without treating cancellation or downgrade as an automatic refund. It does not limit mandatory rights available under applicable law.",
    effectiveDate: "Effective date:",
    alert:
      "Jurisdiction-specific legal entitlements require review before launch. Mandatory statutory consumer rights always remain available where they apply.",
    sections: [
      {
        heading: "Cancellation, downgrade, and refunds",
        body: "Cancellation stops renewal and a downgrade moves an organization to lower plan limits after blockers are resolved. Neither automatically reverses a past payment. An approved refund returns a full or partial amount through the original Stripe payment path.",
      },
      {
        heading: "What Waflo can review",
        body: "You can request review of a duplicate or incorrect charge, a material service failure, an unauthorized payment, or another explained issue. A review may result in a full or partial refund when supported by the facts, product policy, and applicable law.",
      },
      {
        heading: "How to request a review",
        body: "Open Billing in the merchant dashboard, choose an eligible paid invoice, and select Request refund. Choose a reason and amount and add a useful explanation. Never send a full card number or CVC.",
      },
      {
        heading: "Review and status",
        body: "A request may move through Requested, Under review, Approved, Processing, and Succeeded, or to Rejected or Failed. Waflo prevents duplicate active requests and amounts above the server-calculated refundable balance.",
      },
      {
        heading: "Accounting treatment",
        body: "Some finalized invoices or jurisdictions may require a Stripe Credit Note in addition to a refund. Legal and accounting review determines any required treatment.",
      },
    ],
    contactLabel: "Contact Waflo",
  },
};

const ar: MarketingDocuments = {
  contact: {
    kicker: "تواصل معنا",
    title: "كيف يمكننا مساعدتك؟",
    lede: "تواصل معنا بشأن إعداد حساب التاجر أو بطاقات الولاء الرقمية أو دعم حسابك.",
    effectiveDate: "",
    sections: [
      {
        heading: "الدعم",
        body: "أرسل رسالتك إلى قناة الدعم المعتمدة. إن لم يتوفر البريد العام بعد، يمكن للتجار الحاليين المتابعة من لوحة التاجر.",
      },
    ],
    contactLabel: "فتح لوحة التاجر",
  },
  terms: {
    kicker: "الشروط",
    title: "شروط استخدام Waflo",
    lede: "هذه الشروط وثيقة تشغيلية أولية وستتلقى مراجعة قانونية قبل الإطلاق العام.",
    effectiveDate: "تاريخ السريان:",
    sections: [
      {
        heading: "الخدمة",
        body: "تقدم Tavrix LLC منصة Waflo لمساعدة الأعمال المحلية على إنشاء وإدارة بطاقات وبرامج الولاء الرقمية. قد يعتمد توفر مزودي المحفظة على إعداد الخدمة وبرنامج التاجر.",
      },
      {
        heading: "الحسابات",
        body: "يتحمل المستخدم مسؤولية حماية بيانات الدخول وتقديم معلومات صحيحة واستخدام الصلاحيات ضمن تفويض مؤسسته.",
      },
      {
        heading: "الخطط والفوترة",
        body: "تبدأ التجربة المجانية لمدة 15 يوماً بعد اختيار الباقة ووتيرة الدفع وإضافة طريقة دفع صالحة وتأكيد الاشتراك. نوضح السعر وتاريخ أول دفعة قبل التأكيد.",
      },
      {
        heading: "المراجعة القانونية",
        body: "هذه النسخة ليست نصيحة قانونية نهائية وستستبدل بنسخة معتمدة قبل الإطلاق.",
      },
    ],
    contactLabel: "تواصل مع Waflo",
  },
  privacy: {
    kicker: "الخصوصية",
    title: "سياسة خصوصية Waflo",
    lede: "توضح هذه الوثيقة المبادئ الأولية لمعالجة بيانات حسابات التجار. ستخضع لمراجعة قانونية قبل الإطلاق العام.",
    effectiveDate: "تاريخ السريان:",
    sections: [
      { heading: "الجهة المسؤولة", body: "Waflo مملوك ومدار بواسطة Tavrix LLC." },
      {
        heading: "البيانات التي نعالجها",
        body: "بيانات الحساب والمؤسسة والجلسة اللازمة لتقديم المنصة وتأمينها، إضافة إلى سجلات تدقيق وأمان محدودة.",
      },
      {
        heading: "الأمان والاحتفاظ",
        body: "نستخدم تجزئة قوية لكلمات المرور وجلسات قابلة للإلغاء وضوابط وصول خاصة بكل مؤسسة. تحدد مدد الاحتفاظ النهائية بعد المراجعة القانونية.",
      },
      {
        heading: "التواصل",
        body: "استخدم صفحة التواصل العامة للوصول إلى Waflo عبر قناة الدعم المعتمدة.",
      },
    ],
    contactLabel: "تواصل مع Waflo",
  },
  refunds: {
    kicker: "الفوترة والاسترداد",
    title: "سياسة Waflo للفوترة والاسترداد",
    lede: "تشرح هذه السياسة كيفية مراجعة Waflo لمشكلات الفوترة من دون اعتبار الإلغاء أو التخفيض استرداداً تلقائياً. لا تحد هذه السياسة من الحقوق الإلزامية التي يمنحها القانون المعمول به.",
    effectiveDate: "تاريخ السريان:",
    alert:
      "تتطلب الاستحقاقات القانونية الخاصة بكل دولة مراجعة قانونية قبل الإطلاق. تبقى حقوق المستهلك الإلزامية متاحة دائماً حيث تنطبق.",
    sections: [
      {
        heading: "الإلغاء والتخفيض والاسترداد",
        body: "يوقف الإلغاء التجديد وينقل التخفيض المؤسسة إلى حدود خطة أدنى بعد معالجة المتطلبات. لا يعيد أي منهما دفعة سابقة تلقائياً. يعيد الاسترداد الموافق عليه مبلغاً كاملاً أو جزئياً عبر مسار الدفع الأصلي في Stripe.",
      },
      {
        heading: "ما يمكن لـ Waflo مراجعته",
        body: "يمكنك طلب مراجعة دفعة مكررة أو غير صحيحة أو تعطل جوهري في الخدمة أو دفعة غير مصرح بها أو سبب آخر موضح. قد تؤدي المراجعة إلى استرداد كامل أو جزئي عند دعم الوقائع وسياسة المنتج والقانون لذلك.",
      },
      {
        heading: "كيفية طلب المراجعة",
        body: "افتح الفوترة في لوحة التاجر واختر فاتورة مدفوعة مؤهلة ثم اختر طلب استرداد. حدد السبب والمبلغ وأضف شرحاً مفيداً. لا ترسل رقم بطاقة كاملاً أو رمز CVC.",
      },
      {
        heading: "المراجعة والحالة",
        body: "قد ينتقل الطلب بين مطلوب وقيد المراجعة وموافق عليه وقيد المعالجة وناجح، أو إلى مرفوض أو فشل. تمنع Waflo الطلبات النشطة المكررة والمبالغ التي تتجاوز الرصيد القابل للاسترداد المحسوب من الخادم.",
      },
      {
        heading: "المعالجة المحاسبية",
        body: "قد تتطلب بعض الفواتير النهائية أو بعض الدول إشعاراً دائناً من Stripe إضافة إلى الاسترداد. تحدد المراجعة القانونية والمحاسبية المعالجة المطلوبة.",
      },
    ],
    contactLabel: "تواصل مع Waflo",
  },
};

const kuBadini: MarketingDocuments = {
  contact: {
    kicker: "پەیوەندی",
    title: "چ دکارین بۆ تە بکەین؟",
    lede: "دەربارەی ڕێکخستنا هەژمارێ بازرگان، کارتێن دلسۆزییا دیجیتاڵ یان پشتەڤانیا هەژمارێ خۆ پەیوەندیێ مە بکە.",
    effectiveDate: "",
    sections: [
      {
        heading: "پشتەڤانی",
        body: "پەیاما خۆ بۆ کەناڵێ پشتەڤانیا دیارکری بنێرە. ئەگەر ئیمەیلا گشتی هێشتا بەردەست نەبیت، بازرگانێن هەیی دکارن ل داشبۆردا بازرگان بەردەوام بن.",
      },
    ],
    contactLabel: "داشبۆردا بازرگان ڤەکە",
  },
  terms: {
    kicker: "مەرج",
    title: "مەرجێن خزمەتگوزاریا Waflo",
    lede: "ئەڤ مەرجە بەڵگەیەکا سەرەتایی یا کارپێکردنێن و پێداچوونا یاسایی وەردگرن بەر دەستپێکا گشتی.",
    effectiveDate: "دیرۆکا کاریگەربوونێ:",
    sections: [
      {
        heading: "خزمەتگوزاری",
        body: "Tavrix LLC Waflo پێشکێش دکەت بۆ هاریکاریا بزنسانێن ناوخۆیی د دروستکرن و بەڕێڤەبرنا کارت و بەرنامێن دلسۆزییا دیجیتاڵ.",
      },
      {
        heading: "هەژمار",
        body: "بەکارهێنەر بەرپرسیارە بۆ پاراستنا زانیاریێن چوونەژوور، دروستیا زانیاریان و بەکارهێنانا دەستەسەلاتان د ناڤ دەسەلاتا رێکخراوا خۆدا.",
      },
      {
        heading: "پلان و فۆتیرە",
        body: "تاقیکرنا 15 رۆژان پشتی هەلبژارتنا پلان و دەمێ پارەدانێ، زیادکرنا رێکا پارەدانێ و پشتڕاستکرنا بەشداربوونێ دەست پێ دکەت.",
      },
      {
        heading: "پێداچوونا یاسایی",
        body: "ئەڤ وەشانا راوێژا یاسایی یا کۆتایی نینە و ب وەشانەکا پەسەندکری دەهێتە گۆهارتن بەر دەستپێکێ.",
      },
    ],
    contactLabel: "پەیوەندی ب Waflo بکە",
  },
  privacy: {
    kicker: "تایبەتمەندی",
    title: "سیاسەتا تایبەتمەندیا Waflo",
    lede: "ئەڤ بەڵگە بنەمایێن سەرەتایی بۆ مامەڵەکرنا داتایێن هەژمارا بازرگان دیار دکەت و پێداچوونا یاسایی وەردگریت.",
    effectiveDate: "دیرۆکا کاریگەربوونێ:",
    sections: [
      {
        heading: "کێ Waflo بەڕێڤەدبەت",
        body: "Waflo یا Tavrix LLC یە و ژ لایێ وێ ڤە دهێتە بەڕێڤەبرن.",
      },
      {
        heading: "داتایێن ئەم کارپێدکەین",
        body: "داتایێن هەژمار، رێکخراو و دانیشتنێن پێدڤی بۆ دابینکرن و پاراستنا پلاتفۆرمێ، لەگەل تۆمارێن سنوردارێن پشکنین و پاراستنێ.",
      },
      {
        heading: "پاراستن و هەلدان",
        body: "هەشکرنا بەهێز یا وشەی نهێنی، دانیشتنێن هەلدان و کۆنترۆلێن دەستگەهێن رێکخراوی بەکاردئینین. ماوێن هەلدانێ پشتی پێداچوونا یاسایی دیار دبن.",
      },
      {
        heading: "پەیوەندی",
        body: "رێکا پەیوەندیا گشتی بەکاربینە بۆ گەهشتن ب Waflo ل ڕێکا کەناڵێ پشتەڤانیا دیارکری.",
      },
    ],
    contactLabel: "پەیوەندی ب Waflo بکە",
  },
  refunds: {
    kicker: "فۆتیرە و ڤەگەڕاندن",
    title: "سیاسەتا فۆتیرە و ڤەگەڕاندنا Waflo",
    lede: "ئەڤ سیاسەتە رێکا پێداچوونا کێشێن فۆتیرە دیار دکەت بێ کو راگەهاندن یان کەمکرن ب ڤەگەڕاندنا خۆکار بهێتە هەژمارتن.",
    effectiveDate: "دیرۆکا کاریگەربوونێ:",
    alert:
      "مافێن یاسایی یێن تایبەت ب هەر وڵاتێ پێداچوونا یاسایی پێدڤیە بەر دەستپێکێ. مافێن ناچار یێن بەکارهێنەر هەردەم ل شوێنێن پێدڤی بەردەستن.",
    sections: [
      {
        heading: "راگەهاندن، کەمکرن و ڤەگەڕاندن",
        body: "راگەهاندن نۆکرنێ رادکەت و کەمکرن رێکخراوێ پشتی چارەسەرکرنا کێشەیان دگەهینیتە سنورێن پلانەکا کێمتر. هیچ ژ وان پارەدانا بوری خۆکار ناگەڕینیتەوە.",
      },
      {
        heading: "ئەوەی Waflo دکاریت پێداچوونا بکەت",
        body: "دکاریت داخوازییا پێداچوونێ بۆ پارەدانەکا دووبارە، نادروست، کێشەیەکا سەرەکی یا خزمەتگوزاری یان پارەدانەکا بێ دەسەلات بکەی.",
      },
      {
        heading: "چۆن داخوازییەک بکەی",
        body: "فۆتیرە ل داشبۆردا بازرگان ڤەکە، فۆتیرەکا پارەدایی یا گونجاو هەلبژێرە و داخوازییا ڤەگەڕاندنێ بکە. ژمارا کارتێ یا تەواو یان CVC مە بنێرە.",
      },
      {
        heading: "پێداچوون و دۆخ",
        body: "داخوازی دکاریت ل قۆناغێن داواکری، پێداچوون، پەسەندکری، کارپێکردن و سەرکەفتی بگوازیت یان رەتکری و سەرنەکەفتی ببیت.",
      },
      {
        heading: "مامەڵەی هەژماری",
        body: "هندەک فۆتیرە یان دەسەلات دکارن تێبینا قەرز یا Stripe پێدڤی بکەن. پێداچوونا یاسایی و هەژماری مامەڵەیا پێدڤی دیار دکەت.",
      },
    ],
    contactLabel: "پەیوەندی ب Waflo بکە",
  },
};

const kuSorani: MarketingDocuments = {
  contact: {
    kicker: "پەیوەندی",
    title: "چۆن یارمەتیت بدەین؟",
    lede: "دەربارەی ڕێکخستنی هەژماری بازرگان، کارتی دڵسۆزیی دیجیتاڵ یان پشتگیریی هەژمارەکەت پەیوەندیمان پێوە بکە.",
    effectiveDate: "",
    sections: [
      {
        heading: "پشتگیری",
        body: "پەیامەکەت بۆ کەناڵی پشتگیریی دیاریکراو بنێرە. ئەگەر ئیمەیڵی گشتی هێشتا بەردەست نەبێت، بازرگانە هەنووکەییەکان دەتوانن لە داشبۆردی بازرگان بەردەوام بن.",
      },
    ],
    contactLabel: "کردنەوەی داشبۆردی بازرگان",
  },
  terms: {
    kicker: "مەرجەکان",
    title: "مەرجەکانی بەکارهێنانی Waflo",
    lede: "ئەم مەرجانە بەڵگەیەکی سەرەتایی کارپێکردنن و پێداچوونەوەی یاسایی وەردەگرن پێش دەستپێکی گشتی.",
    effectiveDate: "بەرواری کاریگەربوون:",
    sections: [
      {
        heading: "خزمەتگوزاری",
        body: "Tavrix LLC Waflo پێشکەش دەکات بۆ یارمەتیدانی بزنسی ناوخۆیی لە دروستکردن و بەڕێوەبردنی کارتی و بەرنامەکانی دڵسۆزیی دیجیتاڵ.",
      },
      {
        heading: "هەژمارەکان",
        body: "بەکارهێنەر بەرپرسیارە لە پاراستنی زانیاریی چوونەژوور، پێشکەشکردنی زانیاریی دروست و بەکارهێنانی دەسەڵاتەکان لە سنووری ڕێگەپێدانی ڕێکخراوەکەی.",
      },
      {
        heading: "پلان و بەپارەدان",
        body: "تاقیکردنەوەی 15 ڕۆژان دوای هەڵبژاردنی پلان و خشتەی پارەدان، زیادکردنی ڕێگایەکی دروستی پارەدان و پشتڕاستکردنەوەی بەشداربوون دەست پێدەکات.",
      },
      {
        heading: "پێداچوونەوەی یاسایی",
        body: "ئەم وەشانە ڕاوێژی یاسایی کۆتایی نییە و پێش دەستپێک بە وەشانێکی پەسەندکراو دەگۆڕدرێت.",
      },
    ],
    contactLabel: "پەیوەندی بە Waflo بکە",
  },
  privacy: {
    kicker: "تایبەتمەندی",
    title: "سیاسەتی تایبەتمەندیی Waflo",
    lede: "ئەم بەڵگەیە بنەما سەرەتاییەکان بۆ مامەڵەکردن لەگەڵ داتای هەژماری بازرگان دیاری دەکات و پێداچوونەوەی یاسایی وەردەگرێت.",
    effectiveDate: "بەرواری کاریگەربوون:",
    sections: [
      {
        heading: "کێ Waflo بەڕێوەدەبات",
        body: "Waflo هی Tavrix LLC ـە و لەلایەن ئەوەوە بەڕێوەدەبرێت.",
      },
      {
        heading: "داتاکانی کار پێدەکەین",
        body: "داتای هەژمار، ڕێکخراو و دانیشتنە پێویستەکان بۆ دابینکردن و پاراستنی پلاتفۆرمەکە، لەگەڵ تۆمارە سنووردارەکانی پشکنین و ئاسایش.",
      },
      {
        heading: "ئاسایش و هەڵگرتن",
        body: "هەشکردنی بەهێزی وشەی نهێنی، دانیشتنی هەڵوەشاو و کۆنترۆڵی دەستگەیشتنی تایبەت بە ڕێکخراو بەکاردەهێنین. ماوەکانی هەڵگرتن دوای پێداچوونەوەی یاسایی دیاری دەکرێن.",
      },
      {
        heading: "پەیوەندی",
        body: "پەڕەی پەیوەندیی گشتی بەکاربهێنە بۆ گەیشتن بە Waflo لە ڕێگەی کەناڵی پشتگیریی دیاریکراو.",
      },
    ],
    contactLabel: "پەیوەندی بە Waflo بکە",
  },
  refunds: {
    kicker: "بەپارەدان و گەڕاندنەوە",
    title: "سیاسەتی بەپارەدان و گەڕاندنەوەی Waflo",
    lede: "ئەم سیاسەتە ڕوون دەکاتەوە Waflo چۆن کێشەکانی بەپارەدان پێداچوونەوە دەکات بەبێ ئەوەی هەڵوەشاندنەوە یان کەمکردن بە گەڕاندنەوەی خۆکار دابنرێت.",
    effectiveDate: "بەرواری کاریگەربوون:",
    alert:
      "مافە یاساییە تایبەتەکانی هەر دەسەڵاتێک پێداچوونەوەی یاسایی پێویستە پێش دەستپێک. مافە ناچارەکانی بەکارهێنەر هەمیشە لە شوێنی جێبەجێبوونیان بەردەستن.",
    sections: [
      {
        heading: "هەڵوەشاندنەوە، کەمکردن و گەڕاندنەوە",
        body: "هەڵوەشاندنەوە نوێکردنەوە ڕادەگرێت و کەمکردن ڕێکخراوەکە دوای چارەسەرکردنی ڕێگرەکان بۆ سنووری پلانێکی نزمتر دەگوازێتەوە. هیچکام خۆکارانە پارەدانێکی ڕابردوو ناگەڕێنێتەوە.",
      },
      {
        heading: "ئەوەی Waflo دەتوانێت پێداچوونەوەی بکات",
        body: "دەتوانیت داوای پێداچوونەوە بۆ پارەدانێکی دووبارە یان نادروست، شکستی سەرەکیی خزمەتگوزاری، پارەدانێکی بێ ڕێگەپێدان یان هۆکارێکی ڕوونکراوەی تر بکەیت.",
      },
      {
        heading: "چۆن داوای پێداچوونەوە بکەیت",
        body: "بەپارەدان لە داشبۆردی بازرگان بکەرەوە، پسوڵەیەکی پارەدراوی گونجاو هەڵبژێرە و داوای گەڕاندنەوە بکە. ژمارەی تەواوی کارت یان CVC مەبنێرە.",
      },
      {
        heading: "پێداچوونەوە و دۆخ",
        body: "داواکارییەکە دەتوانێت بە هەنگاوەکانی داواکراو، لە پێداچوونەوەدا، پەسەندکراو، لە کارکردندا و سەرکەوتوو بگوازرێتەوە، یان بۆ ڕەتکراو یان شکستخواردوو.",
      },
      {
        heading: "مامەڵەی ژمێریاری",
        body: "هەندێک پسوڵەی کۆتایی یان دەسەڵات ڕەنگە تێبینی قەرزی Stripe زیاتر لە گەڕاندنەوە پێویست بکات. پێداچوونەوەی یاسایی و ژمێریاری مامەڵەی پێویست دیاری دەکات.",
      },
    ],
    contactLabel: "پەیوەندی بە Waflo بکە",
  },
};

export const marketingDocuments: Readonly<Record<InterfaceLocale, MarketingDocuments>> = {
  en,
  ar,
  "ku-badini": kuBadini,
  "ku-sorani": kuSorani,
};
