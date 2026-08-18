export const en = {
  brandTagline: "Loyalty that flows.",
  navigation: {
    home: "Home",
    pricing: "Pricing",
    contact: "Contact",
    login: "Log in",
    signup: "Start free",
  },
  language: {
    label: "Language",
    english: "English",
    arabic: "Arabic",
    kurdish: "Kurdish",
    badini: "Kurdish Badini",
    sorani: "Kurdish Sorani",
  },
  trial: {
    pending:
      "7 days free. Add a payment method now; your first charge is shown before you confirm.",
  },
  errors: {
    retry: "Try again",
    back: "Go back",
    unavailable: "This page is temporarily unavailable.",
  },
} as const;

export type LocaleMessageShape<T> = {
  readonly [Key in keyof T]: T[Key] extends string ? string : LocaleMessageShape<T[Key]>;
};

export type InterfaceMessages = LocaleMessageShape<typeof en>;
