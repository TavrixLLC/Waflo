import type { InterfaceLocale } from "@waflo/i18n";

interface MarketingCopy {
  readonly meta: { readonly title: string; readonly description: string };
  readonly nav: {
    readonly product: string;
    readonly how: string;
    readonly pricing: string;
    readonly solutions: string;
    readonly faq: string;
    readonly contact: string;
    readonly login: string;
    readonly start: string;
    readonly menu: string;
    readonly close: string;
    readonly skip: string;
    readonly mainLabel: string;
    readonly mobileLabel: string;
  };
  readonly hero: {
    readonly eyebrow: string;
    readonly titleLine1: string;
    readonly titleLine2: string;
    readonly lede: string;
    readonly primary: string;
    readonly secondary: string;
    readonly note: string;
    readonly stages: readonly [string, string, string];
  };
  readonly pass: {
    readonly label: string;
    readonly program: string;
    readonly merchant: string;
    readonly reward: string;
    readonly visits: string;
    readonly rewardReady: string;
    readonly addToWallet: string;
    readonly history: string;
    readonly staffScans: string;
  };
  readonly flow: {
    readonly eyebrow: string;
    readonly title: string;
    readonly lede: string;
    readonly steps: readonly { readonly title: string; readonly body: string }[];
  };
  readonly wallet: {
    readonly eyebrow: string;
    readonly title: string;
    readonly lede: string;
    readonly apple: string;
    readonly google: string;
    readonly previewLabel: string;
    readonly points: readonly { readonly title: string; readonly body: string }[];
  };
  readonly sides: {
    readonly eyebrow: string;
    readonly title: string;
    readonly customer: {
      readonly label: string;
      readonly title: string;
      readonly items: readonly string[];
    };
    readonly merchant: {
      readonly label: string;
      readonly title: string;
      readonly items: readonly string[];
    };
    readonly console: {
      readonly program: string;
      readonly published: string;
      readonly progress: string;
      readonly locations: string;
      readonly team: string;
    };
  };
  readonly features: {
    readonly eyebrow: string;
    readonly title: string;
    readonly items: readonly { readonly title: string; readonly body: string }[];
  };
  readonly business: {
    readonly eyebrow: string;
    readonly title: string;
    readonly lede: string;
    readonly previewLabel: string;
    readonly types: readonly {
      readonly key: string;
      readonly name: string;
      readonly reward: string;
      readonly goal: string;
    }[];
  };
  readonly faq: {
    readonly eyebrow: string;
    readonly title: string;
    readonly items: readonly { readonly question: string; readonly answer: string }[];
  };
  readonly cta: {
    readonly eyebrow: string;
    readonly title: string;
    readonly lede: string;
    readonly primary: string;
    readonly secondary: string;
  };
  readonly footer: {
    readonly tagline: string;
    readonly product: string;
    readonly company: string;
    readonly resources: string;
    readonly legal: string;
    readonly language: string;
    readonly rights: string;
    readonly ownedBy: string;
    readonly how: string;
    readonly wallet: string;
    readonly business: string;
    readonly contact: string;
    readonly privacy: string;
    readonly terms: string;
    readonly refunds: string;
  };
}

const en: MarketingCopy = {
  meta: {
    title: "Wallet-first loyalty for local businesses",
    description:
      "Turn every visit into a reason to return with digital loyalty cards for the web, Apple Wallet, and Google Wallet.",
  },
  nav: {
    product: "Product",
    how: "How it works",
    pricing: "Pricing",
    solutions: "Solutions",
    faq: "FAQ",
    contact: "Contact",
    login: "Log in",
    start: "Get started",
    menu: "Open menu",
    close: "Close menu",
    skip: "Skip to content",
    mainLabel: "Main navigation",
    mobileLabel: "Mobile navigation",
  },
  hero: {
    eyebrow: "A return journey, made visible",
    titleLine1: "Turn every visit",
    titleLine2: "into a reason to return.",
    lede: "Waflo gives your customers a loyalty card that lives in their phone, while you run the program, locations, and team from one calm place.",
    primary: "Start free",
    secondary: "See how it works",
    note: "7-day trial. Payment method required; nothing charged today.",
    stages: ["Visit", "Collect", "Reward"],
  },
  pass: {
    label: "Coffee House loyalty card",
    program: "Coffee rewards",
    merchant: "Coffee House",
    reward: "Free coffee",
    visits: "visits",
    rewardReady: "Reward ready",
    addToWallet: "Add to wallet",
    history: "History",
    staffScans: "Staff scans",
  },
  flow: {
    eyebrow: "The Waflo flow",
    title: "One card, five moments.",
    lede: "The card tells the whole return story while the customer simply keeps visiting.",
    steps: [
      {
        title: "They visit",
        body: "A customer walks in and buys something—the habit they already have.",
      },
      {
        title: "They join",
        body: "One scan opens their web card. No new app and no account maze.",
      },
      {
        title: "They collect",
        body: "Your team records the visit and the next stamp appears immediately.",
      },
      {
        title: "They earn",
        body: "When the card is full, the reward becomes unmistakable and ready to use.",
      },
      {
        title: "They return",
        body: "The reward is used, a new cycle starts, and the reason to come back remains.",
      },
    ],
  },
  wallet: {
    eyebrow: "Wallet first",
    title: "The card lives where the phone already is.",
    lede: "No customer app to learn. The card moves naturally from the web to the wallet, while the web experience remains available.",
    apple: "Apple Wallet",
    google: "Google Wallet",
    previewLabel: "Choose a wallet preview",
    points: [
      {
        title: "Added in one tap",
        body: "The customer scans, saves the pass, and joins your program.",
      },
      {
        title: "Always current",
        body: "The pass reflects every recorded visit without manual refreshes.",
      },
      {
        title: "Always in reach",
        body: "It stays on the phone they already carry—not in a drawer at home.",
      },
    ],
  },
  sides: {
    eyebrow: "Two sides, one flow",
    title: "Effortless for customers. Controlled for you.",
    customer: {
      label: "Customer",
      title: "Nothing new to learn.",
      items: ["Join on the web", "See progress at a glance", "Know exactly what the reward is"],
    },
    merchant: {
      label: "Merchant",
      title: "Nothing important left to guess.",
      items: [
        "Record a visit in seconds",
        "Set the reward and goal",
        "Run locations and staff together",
      ],
    },
    console: {
      program: "Coffee Rewards",
      published: "Published",
      progress: "4 of 6 visits",
      locations: "3 locations",
      team: "10 team seats",
    },
  },
  features: {
    eyebrow: "Built for the way loyalty works",
    title: "A calm workspace for real return visits.",
    items: [
      {
        title: "Loyalty without friction",
        body: "A digital pass instead of another customer app.",
      },
      {
        title: "Your brand on the card",
        body: "Your name, colors, goal, and reward stay visible.",
      },
      { title: "Rewards you decide", body: "Choose the goal and reward before publishing." },
      { title: "Locations and team", body: "Keep daily operations inside one merchant workspace." },
    ],
  },
  business: {
    eyebrow: "Made for places people come back to",
    title: "From coffee counters to every repeat visit.",
    lede: "Choose a business type to preview how the same loyalty loop adapts.",
    previewLabel: "Business preview",
    types: [
      { key: "cafe", name: "Cafés", reward: "Free coffee", goal: "6 visits" },
      { key: "restaurant", name: "Restaurants", reward: "Free main dish", goal: "8 visits" },
      { key: "bakery", name: "Bakeries", reward: "Box of pastries", goal: "5 visits" },
      { key: "barber", name: "Barbers", reward: "Free haircut", goal: "7 visits" },
      { key: "salon", name: "Salons", reward: "Free treatment", goal: "6 visits" },
      { key: "retail", name: "Retail", reward: "Member discount", goal: "4 visits" },
    ],
  },
  faq: {
    eyebrow: "Before you start",
    title: "Questions before you start.",
    items: [
      {
        question: "Do my customers need to install an app?",
        answer:
          "No. They join on the web and can save the pass to Apple Wallet or Google Wallet when available.",
      },
      {
        question: "How does a visit get recorded?",
        answer:
          "A paired staff device scans the customer card with the location and permissions already known.",
      },
      {
        question: "Can I choose the reward?",
        answer: "Yes. Set the stamp goal and reward before you publish the loyalty card.",
      },
      {
        question: "Does it work across more than one location?",
        answer:
          "Yes. Locations and team members stay together in one workspace, within your plan limits.",
      },
      {
        question: "Which languages does Waflo support?",
        answer:
          "The site supports English, Arabic, Kurdish Badini, and Kurdish Sorani with native right-to-left layout.",
      },
      {
        question: "How much does Waflo cost?",
        answer: "Choose Starter, Growth, or Scale with monthly, quarterly, or yearly billing.",
      },
    ],
  },
  cta: {
    eyebrow: "Bring the next visit closer",
    title: "Give them a reason to come back.",
    lede: "Set up your card, choose your reward, and start a 7-day trial with nothing charged today.",
    primary: "Start free",
    secondary: "Talk to us",
  },
  footer: {
    tagline: "A digital loyalty platform for businesses people come back to.",
    product: "Product",
    company: "Company",
    resources: "Resources",
    legal: "Legal",
    language: "Language",
    rights: "All rights reserved.",
    ownedBy: "Waflo is owned and operated by Tavrix LLC.",
    how: "How it works",
    wallet: "Wallet experience",
    business: "Business types",
    contact: "Contact",
    privacy: "Privacy",
    terms: "Terms",
    refunds: "Refund policy",
  },
};

const ar: MarketingCopy = {
  meta: {
    title: "ولاء رقمي يبدأ من المحفظة للأعمال المحلية",
    description:
      "اجعل كل زيارة سببًا للعودة مع بطاقات ولاء رقمية للويب وApple Wallet وGoogle Wallet.",
  },
  nav: {
    product: "المنتج",
    how: "كيف يعمل",
    pricing: "الأسعار",
    solutions: "الحلول",
    faq: "الأسئلة",
    contact: "تواصل معنا",
    login: "تسجيل الدخول",
    start: "ابدأ الآن",
    menu: "فتح القائمة",
    close: "إغلاق القائمة",
    skip: "الانتقال إلى المحتوى",
    mainLabel: "التنقل الرئيسي",
    mobileLabel: "قائمة الهاتف",
  },
  hero: {
    eyebrow: "ولاء بسيط يعود مع العميل",
    titleLine1: "اجعل كل زيارة",
    titleLine2: "سببًا للعودة.",
    lede: "بطاقة ولاء تعيش في هاتف عميلك، ومساحة واحدة هادئة تدير منها البرنامج والفروع والفريق.",
    primary: "ابدأ مجانًا",
    secondary: "شاهد كيف يعمل",
    note: "7 أيام تجريبية. البطاقة مطلوبة، ولا خصم اليوم.",
    stages: ["يزور", "يجمع", "يستحق"],
  },
  pass: {
    label: "بطاقة ولاء بيت القهوة",
    program: "مكافآت القهوة",
    merchant: "بيت القهوة",
    reward: "قهوة مجانية",
    visits: "زيارات",
    rewardReady: "المكافأة جاهزة",
    addToWallet: "إضافة للمحفظة",
    history: "السجل",
    staffScans: "يمسحها الفريق",
  },
  flow: {
    eyebrow: "تدفق Waflo",
    title: "بطاقة واحدة، وخمس لحظات.",
    lede: "تحكي البطاقة رحلة العودة كاملة، بينما يواصل العميل زيارته ببساطة.",
    steps: [
      { title: "يزور", body: "يدخل العميل ويشتري شيئًا—وهي العادة التي يقوم بها أصلًا." },
      { title: "ينضم", body: "مسح واحد يفتح بطاقته على الويب، بلا تطبيق جديد ولا حساب معقد." },
      { title: "يجمع", body: "يسجل فريقك الزيارة فيظهر الختم التالي فورًا." },
      { title: "يستحق", body: "عند اكتمال البطاقة تصبح المكافأة واضحة وجاهزة للاستخدام." },
      { title: "يعود", body: "تُستخدم المكافأة وتبدأ دورة جديدة ويبقى سبب العودة." },
    ],
  },
  wallet: {
    eyebrow: "المحفظة أولًا",
    title: "البطاقة تعيش حيث يوجد الهاتف أصلًا.",
    lede: "لا تطبيق آخر ليتعلمه العميل. تنتقل البطاقة طبيعيًا من الويب إلى المحفظة، وتبقى نسخة الويب متاحة.",
    apple: "Apple Wallet",
    google: "Google Wallet",
    previewLabel: "اختر معاينة المحفظة",
    points: [
      { title: "تُضاف بلمسة واحدة", body: "يمسح العميل الرمز ويحفظ البطاقة وينضم إلى برنامجك." },
      { title: "محدّثة دائمًا", body: "تعكس البطاقة كل زيارة مسجلة من دون تحديث يدوي." },
      { title: "قريبة دائمًا", body: "تبقى في الهاتف الذي يحمله العميل أصلًا، لا في درج المنزل." },
    ],
  },
  sides: {
    eyebrow: "جانبان، تدفق واحد",
    title: "سهل للعميل. واضح لك.",
    customer: {
      label: "العميل",
      title: "لا شيء جديد ليتعلمه.",
      items: ["الانضمام من الويب", "التقدم ظاهر بنظرة", "المكافأة معروفة بوضوح"],
    },
    merchant: {
      label: "التاجر",
      title: "لا شيء مهم يُترك للتخمين.",
      items: ["تسجيل الزيارة في ثوانٍ", "تحديد المكافأة والهدف", "إدارة الفروع والفريق معًا"],
    },
    console: {
      program: "بطاقة القهوة",
      published: "منشورة",
      progress: "4 من 6 زيارات",
      locations: "3 فروع",
      team: "10 مقاعد فريق",
    },
  },
  features: {
    eyebrow: "صُممت لطريقة عمل الولاء",
    title: "مساحة عمل هادئة للعودة الحقيقية.",
    items: [
      { title: "ولاء بلا احتكاك", body: "بطاقة رقمية بدل تطبيق آخر للعميل." },
      { title: "علامتك على البطاقة", body: "يبقى اسمك وألوانك وهدفك ومكافأتك واضحة." },
      { title: "مكافآت تقررها أنت", body: "اختر الهدف والمكافأة قبل النشر." },
      { title: "الفروع والفريق", body: "أبقِ العمليات اليومية داخل مساحة تاجر واحدة." },
    ],
  },
  business: {
    eyebrow: "مصنوع للأماكن التي يعود إليها الناس",
    title: "من المقاهي إلى كل زيارة تتكرر.",
    lede: "اختر نوع النشاط لترى كيف تتكيف دورة الولاء نفسها.",
    previewLabel: "معاينة النشاط",
    types: [
      { key: "cafe", name: "المقاهي", reward: "قهوة مجانية", goal: "6 زيارات" },
      { key: "restaurant", name: "المطاعم", reward: "طبق رئيسي مجاني", goal: "8 زيارات" },
      { key: "bakery", name: "المخابز", reward: "علبة معجنات", goal: "5 زيارات" },
      { key: "barber", name: "الحلاقون", reward: "حلاقة مجانية", goal: "7 زيارات" },
      { key: "salon", name: "الصالونات", reward: "جلسة مجانية", goal: "6 زيارات" },
      { key: "retail", name: "التجزئة", reward: "خصم للأعضاء", goal: "4 زيارات" },
    ],
  },
  faq: {
    eyebrow: "قبل أن تبدأ",
    title: "أسئلة واضحة، وإجابات مباشرة.",
    items: [
      {
        question: "هل يحتاج العميل إلى تثبيت تطبيق؟",
        answer:
          "لا. ينضم من الويب ويمكنه حفظ البطاقة في Apple Wallet أو Google Wallet عندما تكون الخدمة متاحة.",
      },
      {
        question: "كيف تُسجل الزيارة؟",
        answer: "يمسح جهاز الفريق المرتبط بطاقة العميل مع معرفة الفرع والصلاحيات مسبقًا.",
      },
      {
        question: "هل أختار المكافأة؟",
        answer: "نعم. تضبط عدد الأختام والمكافأة قبل نشر بطاقة الولاء.",
      },
      {
        question: "هل تعمل مع أكثر من فرع؟",
        answer: "نعم. تدير الفروع والفريق من مساحة عمل واحدة وفق حدود باقتك.",
      },
      {
        question: "ما اللغات المدعومة؟",
        answer:
          "يدعم الموقع الإنجليزية والعربية والكردية البادينية والكردية السورانية بتخطيط RTL أصلي.",
      },
      {
        question: "كم تكلف Waflo؟",
        answer: "توجد باقات Starter وGrowth وScale مع دفع شهري أو ربع سنوي أو سنوي.",
      },
    ],
  },
  cta: {
    eyebrow: "قرّب الزيارة القادمة",
    title: "امنحهم سببًا آخر للعودة.",
    lede: "أنشئ بطاقتك واختر مكافأتك وابدأ تجربة لمدة 7 أيام من دون خصم اليوم.",
    primary: "ابدأ مجانًا",
    secondary: "تحدث معنا",
  },
  footer: {
    tagline: "منصة ولاء رقمية للأعمال التي يعود إليها الناس.",
    product: "المنتج",
    company: "الشركة",
    resources: "المصادر",
    legal: "قانوني",
    language: "اللغة",
    rights: "جميع الحقوق محفوظة.",
    ownedBy: "Waflo منتج مملوك ومدار بواسطة Tavrix LLC.",
    how: "كيف يعمل",
    wallet: "تجربة المحفظة",
    business: "أنواع الأعمال",
    contact: "تواصل معنا",
    privacy: "الخصوصية",
    terms: "الشروط",
    refunds: "سياسة الاسترداد",
  },
};

const kuBadini: MarketingCopy = {
  meta: {
    title: "دلسۆزیا دیجیتاڵ بۆ بزنسا ناڤخۆیی",
    description: "هەر سەرەدانەکێ بکە ئەگەرەک بۆ ڤەگەڕانێ ب کارتێت دلسۆزیا دیجیتاڵ.",
  },
  nav: {
    product: "بەرهەم",
    how: "چاوا کار دکەت",
    pricing: "نرخان",
    solutions: "چارەسەر",
    faq: "پرسیارێت بەرباو",
    contact: "پەیوەندی",
    login: "چوونا ژ ناڤ",
    start: "دەست پێ بکە",
    menu: "ڤەکرنا لیستێ",
    close: "گرتنا لیستێ",
    skip: "بچۆ بۆ ناڤەرۆکێ",
    mainLabel: "ڕێدانا سەرەکی",
    mobileLabel: "ڕێدانا مۆبایلێ",
  },
  hero: {
    eyebrow: "پلاتفۆرما دلسۆزییا زیرەک",
    titleLine1: "هەر سەرەدانەکێ بکە",
    titleLine2: "ئەگەرەک بۆ ڤەگەڕانێ.",
    lede: "وافلۆ کارتەکا دلسۆزی ددەتە کریارێت تە کو د تەلەفۆنا وان دا دژیت، و ئێک جه ژی ددەتە تە بۆ ب رێڤەبرنا هەمی پرۆگرامی.",
    primary: "ب خۆڕایی دەست پێ بکە",
    secondary: "ببینە چاوا کار دکەت",
    note: "7 ڕۆژ ب خۆڕایی. ئەڤڕۆ چو پارە ناهێتە وەرگرتن.",
    stages: ["سەرەدان", "کۆمکرن", "خەلات"],
  },
  pass: {
    label: "کارتا دلسۆزیا کۆفی هاوس",
    program: "خەلاتێت قەهوەیێ",
    merchant: "کۆفی هاوس",
    reward: "قەهوەیا خۆڕایی",
    visits: "سەرەدان",
    rewardReady: "خەلات ئامادە یە",
    addToWallet: "زێدە بکە بۆ جزدانێ",
    history: "دیرۆک",
    staffScans: "ستاف سکان دکەت",
  },
  flow: {
    eyebrow: "ڕەوتا وافلۆ",
    title: "ئێک کارت، پێنج ساتەکان.",
    lede: "کارت هەمی چیرۆکا ڤەگەڕانێ دبێژیت و کریار تنێ سەرەدانا خۆ بەردەوام دکەت.",
    steps: [
      { title: "سەرەدان دکەت", body: "کریار دهێت و تشتەکێ دکریت—ئەو عادەتا وی یا هەیی." },
      {
        title: "بەشدار دبیت",
        body: "ئێک سکان کارتا وی ل وێبێ ڤەدکەت؛ نە ئەپەکا نی و نە هەژمارەکا گران.",
      },
      { title: "کۆم دکەت", body: "ستافێ تە سەرەدانێ تۆمار دکەت و مۆرا دی هەمان دەم دیار دبیت." },
      { title: "خەلات دستینیت", body: "وەختێ کارت تەمام دبیت، خەلات ب زەلالی ئامادەیە." },
      { title: "ڤەدگەڕیت", body: "خەلات دهێتە بکارئینان و سووڕەکا نی دەست پێ دکەت." },
    ],
  },
  wallet: {
    eyebrow: "جزدان بەری هەمی",
    title: "کارت ل وێ دەرێ یە کو تەلەفۆن ژی لێ یە.",
    lede: "نە ئەپەکا دی بۆ فێربوونێ. کارت ژ وێبێ بۆ جزدانێ دچیت و وێب هەردەم بەردەست دمینیت.",
    apple: "Apple Wallet",
    google: "Google Wallet",
    previewLabel: "پێشاندانا جزدانێ هەلبژێرە",
    points: [
      {
        title: "ب ئێک تلی زێدە دبیت",
        body: "کریار سکان دکەت، کارت پاراستن دکەت و دچیتە ناڤ پرۆگرامێ تە.",
      },
      { title: "هەردەم نی", body: "کارت هەر سەرەدانا تۆمارکری بێ نیکرنا دەستی پیشان ددەت." },
      { title: "هەردەم بەردەست", body: "د وێ تەلەفۆنێ دا دمینیت کو کریار هەردەم هەلدگریت." },
    ],
  },
  sides: {
    eyebrow: "دو لا، ئێک ڕەوت",
    title: "ئاسان بۆ کریاری. د دەستێ تە دا بۆ تە.",
    customer: {
      label: "کریار",
      title: "چو تشت بۆ فێربوونێ نینە.",
      items: ["بەشداری ژ وێبێ", "پێشکەفتن ب ئێک نێرینێ", "خەلات ب زەلالی دیارە"],
    },
    merchant: {
      label: "بازرگان",
      title: "چو تشتێ گرنگ بۆ گریمانێ نینە.",
      items: [
        "سەرەدان د چرکەیان دا تۆمار بکە",
        "خەلات و ئارمانج دیار بکە",
        "جه و ستاف پێکڤە ب رێڤە ببە",
      ],
    },
    console: {
      program: "خەلاتێت قەهوەیێ",
      published: "بەلاڤکری",
      progress: "4 ژ 6 سەرەدانان",
      locations: "3 جه",
      team: "10 جهێت تیمێ",
    },
  },
  features: {
    eyebrow: "چێکری بۆ ڕەوتا دلسۆزیێ",
    title: "جهەکێ ئارام بۆ سەرەدانێت ڤەگەڕانێ.",
    items: [
      { title: "دلسۆزیا بێ ئاستەنگ", body: "کارتەکا دیجیتاڵ ل شوینا ئەپەکا دی." },
      { title: "براندا تە ل سەر کارتێ", body: "ناڤ و ڕەنگ و ئارمانج و خەلاتێ تە دیار دمینن." },
      { title: "خەلاتێت تو دیار دکەی", body: "بەری بەلاڤکرنێ ئارمانج و خەلاتی هەلبژێرە." },
      { title: "جه و تیم", body: "کارێت ڕۆژانە د ئێک جهێ بازرگانی دا بهێلە." },
    ],
  },
  business: {
    eyebrow: "بۆ وان جهان کو خەلک ڤەدگەڕنێ",
    title: "ژ کافێیان بۆ هەر سەرەدانەکا دووبارە.",
    lede: "جۆرەکێ بزنسی هەلبژێرە دا ببینی ڕەوتا دلسۆزیێ چاوا دگونجیت.",
    previewLabel: "پێشاندانا بزنسی",
    types: [
      { key: "cafe", name: "کافێ", reward: "قەهوەیا خۆڕایی", goal: "6 سەرەدان" },
      { key: "restaurant", name: "خارنگەه", reward: "ژەما سەرەکی یا خۆڕایی", goal: "8 سەرەدان" },
      { key: "bakery", name: "نانەپێژ", reward: "سندۆقەکا شیرینیان", goal: "5 سەرەدان" },
      { key: "barber", name: "دەلاک", reward: "پۆرکرنا خۆڕایی", goal: "7 سەرەدان" },
      { key: "salon", name: "سالۆن", reward: "چاڤدێریا خۆڕایی", goal: "6 سەرەدان" },
      { key: "retail", name: "فرۆشگەه", reward: "داشکاندنا ئەندامان", goal: "4 سەرەدان" },
    ],
  },
  faq: {
    eyebrow: "بەری دەستپێکرنێ",
    title: "پرسیارێت بەرباو.",
    items: [
      {
        question: "ئەرێ کریارێت من پێتڤی ب ئەپەکێ هەنە؟",
        answer:
          "نەخێر. ئەو ژ وێبێ بەشدار دبن و دشێن کارتێ ل Apple Wallet یان Google Wallet پارێزن.",
      },
      {
        question: "سەرەدان چاوا تۆمار دبیت؟",
        answer: "ئامیرێ ستافی یێ گرێدای سکان دکەت و جه و دەستپێگەهشتن پێشتر دیارن.",
      },
      {
        question: "دشێم خەلاتی ب خۆ دیار بکەم؟",
        answer: "بەلێ. ژمارا مۆران و خەلاتی بەری بەلاڤکرنێ دیار بکە.",
      },
      {
        question: "د گەل ژێدەتر ژ ئێک جهی کار دکەت؟",
        answer: "بەلێ. جه و تیم د ئێک جهێ کاری دا ب رێڤە ببە.",
      },
      {
        question: "وافلۆ پشتەڤانیا کیژ زمانان دکەت؟",
        answer: "ماڵپەڕ ب ئینگلیزی، عەرەبی، کوردیا بادینی و کوردیا سۆرانی بەردەستە.",
      },
      {
        question: "بهایێ وافلۆ چەندە؟",
        answer: "پلانێت Starter و Growth و Scale ب پارەدانا مانگانە، سێ مانگانە یان سالانە هەنە.",
      },
    ],
  },
  cta: {
    eyebrow: "سەرەدانا دی نێزیک بکە",
    title: "ئەگەرەک بدەیە وان بۆ ڤەگەڕانێ.",
    lede: "کارتا خۆ چێ بکە، خەلاتی هەلبژێرە و 7 ڕۆژان ب خۆڕایی دەست پێ بکە.",
    primary: "ب خۆڕایی دەست پێ بکە",
    secondary: "د گەل مە ئاخفتن بکە",
  },
  footer: {
    tagline: "پلاتفۆرما دلسۆزییا دیجیتاڵ بۆ وان بزنسان کو خەلک ڤەدگەڕنێ.",
    product: "بەرهەم",
    company: "کۆمپانیا",
    resources: "سەرچاڤە",
    legal: "یاسایی",
    language: "زمان",
    rights: "هەمی ماف پاراستین.",
    ownedBy: "Waflo ژ لایێ Tavrix LLC ڤە دهێتە خاوەنداریکرن و ب رێڤەبرن.",
    how: "چاوا کار دکەت",
    wallet: "ئەزموونا جزدانێ",
    business: "جۆرێت بزنسی",
    contact: "پەیوەندی",
    privacy: "تایبەتمەندی",
    terms: "مەرج",
    refunds: "سیاسەتا ڤەگەڕاندنێ",
  },
};

const kuSorani: MarketingCopy = {
  meta: {
    title: "دڵسۆزیی دیجیتاڵ بۆ بزنسی ناوخۆیی",
    description: "هەر سەردانێک بکە بە هۆکارێک بۆ گەڕانەوە بە کارتی دڵسۆزیی دیجیتاڵ.",
  },
  nav: {
    product: "بەرهەم",
    how: "چۆن کاردەکات",
    pricing: "نرخەکان",
    solutions: "چارەسەرەکان",
    faq: "پرسیارە باوەکان",
    contact: "پەیوەندی",
    login: "چوونەژوورەوە",
    start: "دەست پێبکە",
    menu: "کردنەوەی لیست",
    close: "داخستنی لیست",
    skip: "بڕۆ بۆ ناوەڕۆک",
    mainLabel: "ڕێدانی سەرەکی",
    mobileLabel: "ڕێدانی مۆبایل",
  },
  hero: {
    eyebrow: "پلاتفۆرمی دڵسۆزیی زیرەک",
    titleLine1: "هەر سەردانێک بکە",
    titleLine2: "بە هۆکارێک بۆ گەڕانەوە.",
    lede: "وافلۆ کارتێکی دڵسۆزی دەداتە کڕیارەکانت کە لە مۆبایلەکەیاندا دەژیت، و یەک شوێنیشت پێدەدات بۆ بەڕێوەبردنی هەموو پرۆگرامەکە.",
    primary: "بەخۆڕایی دەست پێبکە",
    secondary: "ببینە چۆن کاردەکات",
    note: "7 ڕۆژ بەخۆڕایی. ئەمڕۆ هیچ پارەیەک وەرناگیرێت.",
    stages: ["سەردان", "کۆکردنەوە", "خەڵات"],
  },
  pass: {
    label: "کارتی دڵسۆزیی کۆفی هاوس",
    program: "خەڵاتی قاوە",
    merchant: "کۆفی هاوس",
    reward: "قاوەی بەخۆڕایی",
    visits: "سەردان",
    rewardReady: "خەڵات ئامادەیە",
    addToWallet: "زیادی بکە بۆ جزدان",
    history: "مێژوو",
    staffScans: "ستاف سکان دەکات",
  },
  flow: {
    eyebrow: "ڕەوتی وافلۆ",
    title: "یەک کارت، پێنج ساتەوەخت.",
    lede: "کارتەکە هەموو چیرۆکی گەڕانەوە دەگێڕێتەوە و کڕیار تەنیا بەردەوام دەبێت لە سەردان.",
    steps: [
      { title: "سەردان دەکات", body: "کڕیار دێتە ژوورەوە و شتێک دەکڕێت—ئەو عادەتەی پێشتر هەیەتی." },
      {
        title: "بەشدار دەبێت",
        body: "یەک سکان کارتەکەی لە وێب دەکاتەوە؛ نە ئەپی نوێ و نە هەژماری ئاڵۆز.",
      },
      {
        title: "کۆدەکاتەوە",
        body: "ستافەکەت سەردانەکە تۆمار دەکات و مۆری داهاتوو دەستبەجێ دەردەکەوێت.",
      },
      { title: "خەڵات وەردەگرێت", body: "کاتێک کارتەکە تەواو دەبێت، خەڵاتەکە بە ڕوونی ئامادەیە." },
      { title: "دەگەڕێتەوە", body: "خەڵاتەکە بەکاردێت و سووڕێکی نوێ دەست پێدەکات." },
    ],
  },
  wallet: {
    eyebrow: "جزدان لە پێشەوە",
    title: "کارتەکە لەوێدایە کە مۆبایلەکە پێشتر لێیە.",
    lede: "نە ئەپێکی تر بۆ فێربوون. کارتەکە لە وێبەوە بۆ جزدان دەچێت و وێب هەمیشە بەردەست دەمێنێت.",
    apple: "Apple Wallet",
    google: "Google Wallet",
    previewLabel: "پێشاندانی جزدان هەڵبژێرە",
    points: [
      {
        title: "بە یەک پەنجە زیاد دەکرێت",
        body: "کڕیار سکان دەکات، کارتەکە دەپارێزێت و دەچێتە ناو پرۆگرامەکەت.",
      },
      {
        title: "هەمیشە نوێ",
        body: "کارتەکە هەر سەردانێکی تۆمارکراو بێ نوێکردنەوەی دەستی پیشان دەدات.",
      },
      { title: "هەمیشە بەردەست", body: "لەو مۆبایلەدا دەمێنێت کە کڕیار هەمیشە هەڵیدەگرێت." },
    ],
  },
  sides: {
    eyebrow: "دوو لا، یەک ڕەوت",
    title: "ئاسان بۆ کڕیار. کۆنترۆڵکراو بۆ تۆ.",
    customer: {
      label: "کڕیار",
      title: "هیچ شتێکی نوێ بۆ فێربوون نییە.",
      items: ["بەشداری لە وێب", "پێشکەوتن بە یەک نیگا", "خەڵات بە ڕوونی دیارە"],
    },
    merchant: {
      label: "بازرگان",
      title: "هیچ شتێکی گرنگ بۆ گریمانە نییە.",
      items: [
        "سەردان لە چرکەدا تۆمار بکە",
        "خەڵات و ئامانج دیاری بکە",
        "شوێن و ستاف پێکەوە بەڕێوە ببە",
      ],
    },
    console: {
      program: "خەڵاتی قاوە",
      published: "بڵاوکراوە",
      progress: "4 لە 6 سەردان",
      locations: "3 شوێن",
      team: "10 شوێنی تیم",
    },
  },
  features: {
    eyebrow: "دروستکراوە بۆ ڕەوتی دڵسۆزی",
    title: "شوێنێکی ئارام بۆ سەردانەکانی گەڕانەوە.",
    items: [
      { title: "دڵسۆزی بێ ئاستەنگ", body: "کارتێکی دیجیتاڵ لە جیاتی ئەپێکی تر." },
      { title: "براندەکەت لەسەر کارتەکە", body: "ناو و ڕەنگ و ئامانج و خەڵاتەکەت دیار دەمێنن." },
      { title: "خەڵاتی تۆ دیاری دەکەیت", body: "پێش بڵاوکردنەوە ئامانج و خەڵات هەڵبژێرە." },
      { title: "شوێنەکان و تیم", body: "کارە ڕۆژانەکان لە یەک شوێنی بازرگانی بهێڵەوە." },
    ],
  },
  business: {
    eyebrow: "بۆ ئەو شوێنانەی خەڵک دەگەڕێنەوە",
    title: "لە کافێکانەوە بۆ هەر سەردانێکی دووبارە.",
    lede: "جۆرێکی بزنس هەڵبژێرە بۆ بینینی ئەوەی ڕەوتی دڵسۆزی چۆن دەگونجێت.",
    previewLabel: "پێشاندانی بزنس",
    types: [
      { key: "cafe", name: "کافێکان", reward: "قاوەی بەخۆڕایی", goal: "6 سەردان" },
      { key: "restaurant", name: "چێشتخانەکان", reward: "ژەمی سەرەکی بەخۆڕایی", goal: "8 سەردان" },
      { key: "bakery", name: "نانەواخانەکان", reward: "سندوقێک شیرینی", goal: "5 سەردان" },
      { key: "barber", name: "قوافیخانەکان", reward: "قژبڕینی بەخۆڕایی", goal: "7 سەردان" },
      { key: "salon", name: "سالۆنەکان", reward: "چاودێریی بەخۆڕایی", goal: "6 سەردان" },
      { key: "retail", name: "فرۆشگاکان", reward: "داشکاندنی ئەندام", goal: "4 سەردان" },
    ],
  },
  faq: {
    eyebrow: "پێش دەستپێکردن",
    title: "پرسیارە باوەکان.",
    items: [
      {
        question: "ئایا کڕیارەکانم پێویستیان بە ئەپ هەیە؟",
        answer:
          "نەخێر. لە وێبەوە بەشدار دەبن و دەتوانن کارتەکە لە Apple Wallet یان Google Wallet بپارێزن.",
      },
      {
        question: "سەردان چۆن تۆمار دەکرێت؟",
        answer: "ئامێری ستافی بەستراو سکان دەکات و شوێن و دەستپێگەیشتن پێشتر دیارن.",
      },
      {
        question: "دەتوانم خەڵاتەکە خۆم دیاری بکەم؟",
        answer: "بەڵێ. ژمارەی مۆرەکان و خەڵاتەکە پێش بڵاوکردنەوە دیاری بکە.",
      },
      {
        question: "لەگەڵ زیاتر لە یەک شوێن کاردەکات؟",
        answer: "بەڵێ. شوێنەکان و تیم لە یەک شوێنی کار بەڕێوە ببە.",
      },
      {
        question: "وافلۆ پشتگیریی چ زمانێک دەکات؟",
        answer: "ماڵپەڕەکە بە ئینگلیزی، عەرەبی، کوردی بادینی و کوردی سۆرانی بەردەستە.",
      },
      {
        question: "نرخی وافلۆ چەندە؟",
        answer: "پلانی Starter و Growth و Scale بە پارەدانی مانگانە، سێ مانگانە یان ساڵانە هەن.",
      },
    ],
  },
  cta: {
    eyebrow: "سەردانی داهاتوو نزیک بکەوە",
    title: "هۆکارێکیان بدەرێ بۆ گەڕانەوە.",
    lede: "کارتەکەت دروست بکە، خەڵات هەڵبژێرە و 7 ڕۆژ بەخۆڕایی دەست پێبکە.",
    primary: "بەخۆڕایی دەست پێبکە",
    secondary: "قسەمان لەگەڵ بکە",
  },
  footer: {
    tagline: "پلاتفۆرمی دڵسۆزیی دیجیتاڵی بۆ ئەو بزنسانەی خەڵک دەگەڕێنەوە بۆیان.",
    product: "بەرهەم",
    company: "کۆمپانیا",
    resources: "سەرچاوەکان",
    legal: "یاسایی",
    language: "زمان",
    rights: "هەموو مافەکان پارێزراون.",
    ownedBy: "Waflo لەلایەن Tavrix LLC خاوەندارێتی و بەڕێوە دەبرێت.",
    how: "چۆن کاردەکات",
    wallet: "ئەزموونی جزدان",
    business: "جۆرەکانی بزنس",
    contact: "پەیوەندی",
    privacy: "تایبەتمەندی",
    terms: "مەرجەکان",
    refunds: "سیاسەتی گەڕاندنەوە",
  },
};

export const marketingCopy: Readonly<Record<InterfaceLocale, MarketingCopy>> = {
  en,
  ar,
  "ku-badini": kuBadini,
  "ku-sorani": kuSorani,
};

export type { MarketingCopy };
