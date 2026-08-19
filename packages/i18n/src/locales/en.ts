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
  merchant: {
    shell: {
      overview: "Overview",
      programs: "Loyalty Cards",
      customers: "Customers",
      locations: "Locations",
      team: "Team",
      analytics: "Analytics",
      exports: "Exports",
      billing: "Billing",
      settings: "Settings",
      security: "Security",
      administration: "Account",
      more: "More",
      logout: "Log out",
      chooseOrganization: "Choose organization",
      primaryNavigation: "Primary navigation",
      close: "Close",
      preparingAccount: "Preparing your account…",
      accountLoadFailed: "Unable to load your account. Try again.",
    },
    billingAttention: {
      actionRequiredMessage:
        "Your payment needs confirmation. Complete the required action to keep using Waflo.",
      actionRequiredAction: "Complete payment action",
      pastDueMessage:
        "Your payment failed, and your account is in its recovery window. Update billing now.",
      pastDueAction: "Update billing",
      pausedMessage: "Your Waflo subscription is paused. Resume it before making changes.",
      pausedAction: "Resume subscription",
      canceledMessage: "Your Waflo subscription has ended. Renew it before making changes.",
      canceledAction: "Renew subscription",
      setupMessage: "Finish billing setup to activate full Waflo access.",
      setupAction: "Finish billing setup",
      renewalMessage: "Your Waflo subscription needs to be renewed before you can make changes.",
      renewalAction: "Renew subscription",
    },
  },
} as const;

export type LocaleMessageShape<T> = {
  readonly [Key in keyof T]: T[Key] extends string ? string : LocaleMessageShape<T[Key]>;
};

export type InterfaceMessages = LocaleMessageShape<typeof en>;
