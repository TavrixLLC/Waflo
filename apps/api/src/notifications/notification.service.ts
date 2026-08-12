import { Injectable } from "@nestjs/common";
import type { Locale } from "@waflo/contracts";
import nodemailer from "nodemailer";
import { EnvironmentService } from "../config/environment.service.js";

export type NotificationKind =
  | "email_verification"
  | "password_reset"
  | "team_invitation"
  | "invitation_accepted"
  | "new_login"
  | "password_changed"
  | "session_revoked"
  | "subscription_status"
  | "membership_transfer_confirmation"
  | "membership_transfer_completed"
  | "membership_transfer_suspicious";

export interface NotificationMessage {
  to: string;
  locale: Locale;
  kind: NotificationKind;
  actionUrl?: string;
  organizationName?: string;
  programName?: string;
  expiresAt?: Date;
}

export interface NotificationProvider {
  send(message: { to: string; subject: string; html: string }): Promise<void>;
}

class SmtpNotificationProvider implements NotificationProvider {
  private readonly transporter;

  constructor(private readonly environment: EnvironmentService) {
    this.transporter = nodemailer.createTransport({
      host: environment.values.SMTP_HOST,
      port: environment.values.SMTP_PORT,
      secure: environment.values.SMTP_SECURE,
      connectionTimeout: 5_000,
      greetingTimeout: 5_000,
      socketTimeout: 10_000,
      ...(environment.values.SMTP_USER && environment.values.SMTP_PASSWORD
        ? {
            auth: {
              user: environment.values.SMTP_USER,
              pass: environment.values.SMTP_PASSWORD,
            },
          }
        : {}),
    });
  }

  async send(message: { to: string; subject: string; html: string }): Promise<void> {
    await this.transporter.sendMail({
      from: this.environment.values.SMTP_FROM || this.environment.values.EMAIL_FROM,
      to: message.to,
      subject: message.subject,
      html: message.html,
    });
  }

  async verify(): Promise<void> {
    await this.transporter.verify();
  }
}

const subjects: Readonly<Record<Locale, Readonly<Record<NotificationKind, string>>>> = {
  en: {
    email_verification: "Verify your Waflo email",
    password_reset: "Reset your Waflo password",
    team_invitation: "You are invited to a Waflo team",
    invitation_accepted: "A teammate accepted your invitation",
    new_login: "New sign-in to Waflo",
    password_changed: "Your Waflo password changed",
    session_revoked: "A Waflo session was revoked",
    subscription_status: "Your Waflo subscription status changed",
    membership_transfer_confirmation: "Confirm your Waflo card transfer",
    membership_transfer_completed: "Your Waflo card transfer is complete",
    membership_transfer_suspicious: "A Waflo card transfer was requested",
  },
  ar: {
    email_verification: "تأكيد بريدك الإلكتروني في Waflo",
    password_reset: "إعادة تعيين كلمة مرور Waflo",
    team_invitation: "لديك دعوة للانضمام إلى فريق Waflo",
    invitation_accepted: "تم قبول دعوة الفريق",
    new_login: "تسجيل دخول جديد إلى Waflo",
    password_changed: "تم تغيير كلمة مرور Waflo",
    session_revoked: "تم إنهاء جلسة Waflo",
    subscription_status: "تغيرت حالة اشتراك Waflo",
    membership_transfer_confirmation: "تأكيد نقل بطاقة Waflo",
    membership_transfer_completed: "اكتمل نقل بطاقة Waflo",
    membership_transfer_suspicious: "تم طلب نقل بطاقة Waflo",
  },
};

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

export function safeNotificationActionUrl(
  value: string | undefined,
  allowedOrigins: readonly string[],
): string | null {
  if (!value) return null;
  try {
    const parsed = new URL(value);
    if (parsed.username || parsed.password) return null;
    const isLocalDevelopmentHost =
      parsed.hostname === "localhost" ||
      parsed.hostname.endsWith(".localhost") ||
      parsed.hostname === "lvh.me" ||
      parsed.hostname.endsWith(".lvh.me");
    if (parsed.protocol !== "https:" && !isLocalDevelopmentHost) return null;
    const allowed = allowedOrigins.some((origin) => {
      if (origin === parsed.origin) return true;
      const wildcard = /^(https?):\/\/\*\.([^/:]+)(?::(\d+))?$/.exec(origin);
      if (!wildcard) return false;
      const protocol = `${wildcard[1]}:`;
      const hostname = wildcard[2] ?? "";
      const port = wildcard[3] ?? "";
      return (
        parsed.protocol === protocol &&
        parsed.hostname.endsWith(`.${hostname}`) &&
        parsed.hostname !== hostname &&
        parsed.port === port
      );
    });
    if (!allowed) return null;
    return parsed.toString();
  } catch {
    return null;
  }
}

export function renderNotificationHtml(
  message: NotificationMessage,
  allowedOrigins: readonly string[],
): string {
  const direction = message.locale === "ar" ? "rtl" : "ltr";
  const actionLabel =
    message.locale === "ar"
      ? message.kind === "password_reset"
        ? "إعادة تعيين كلمة المرور"
        : "متابعة"
      : message.kind === "password_reset"
        ? "Reset password"
        : "Continue";
  const organizationName = message.organizationName
    ? ` ${message.locale === "ar" ? "في" : "at"} ${escapeHtml(message.organizationName)}`
    : "";
  const body =
    message.kind === "membership_transfer_confirmation"
      ? message.locale === "ar"
        ? `تم طلب نقل بطاقة الولاء${organizationName}${message.programName ? ` لبرنامج ${escapeHtml(message.programName)}` : ""}. أكد الطلب فقط إذا بدأت عملية النقل. إذا لم تطلب ذلك، فتجاهل هذه الرسالة.`
        : `A loyalty card transfer was requested${organizationName}${message.programName ? ` for ${escapeHtml(message.programName)}` : ""}. Confirm only if you started this transfer. If you did not request it, ignore this message.`
      : message.kind === "membership_transfer_completed"
        ? message.locale === "ar"
          ? `اكتمل نقل بطاقة الولاء${organizationName}. أصبحت البطاقة السابقة ورمزها غير صالحين.`
          : `Your loyalty card transfer${organizationName} is complete. The previous card and QR credential are no longer valid.`
        : message.locale === "ar"
          ? `تم إرسال هذه الرسالة بخصوص حسابك${organizationName}.`
          : `This message was sent about your Waflo account${organizationName}.`;
  const actionUrl = safeNotificationActionUrl(message.actionUrl, allowedOrigins);
  const action = actionUrl
    ? `<a href="${escapeHtml(actionUrl)}" style="display:inline-block;background:#AE3115;color:#fff;padding:12px 22px;border-radius:999px;text-decoration:none;font-weight:700">${escapeHtml(actionLabel)}</a>`
    : "";
  const expiration = message.expiresAt
    ? `<p style="color:#76645F">${message.locale === "ar" ? "تنتهي صلاحية هذا الرابط في" : "This link expires at"} ${escapeHtml(message.expiresAt.toISOString())}.</p>`
    : "";
  return `<!doctype html><html lang="${message.locale}" dir="${direction}"><body style="margin:0;background:#F7F9FF;color:#241916;font-family:Arial,sans-serif"><div style="max-width:600px;margin:32px auto;background:#fff;border-radius:22px;padding:32px"><div style="font-size:28px;font-weight:800;color:#AE3115">waflo</div><h1 style="font-size:24px">${escapeHtml(subjects[message.locale][message.kind])}</h1><p style="line-height:1.7">${body}</p>${expiration}${action}<p style="margin-top:32px;color:#76645F;font-size:12px">Waflo is owned and operated by Tavrix LLC.</p></div></body></html>`;
}

@Injectable()
export class NotificationService {
  private readonly provider: NotificationProvider;
  private readonly allowedActionOrigins: readonly string[];

  constructor(private readonly environment: EnvironmentService) {
    this.provider = new SmtpNotificationProvider(environment);
    const customer = new URL(environment.values.CUSTOMER_WEB_URL);
    this.allowedActionOrigins = [
      new URL(environment.values.MERCHANT_DASHBOARD_URL).origin,
      customer.origin,
      `${customer.protocol}//*.${customer.hostname}${customer.port ? `:${customer.port}` : ""}`,
    ];
  }

  async send(message: NotificationMessage): Promise<void> {
    if (message.to.trim().toLocaleLowerCase("en-US").endsWith("@staff.waflo.invalid")) {
      throw new Error("Synthetic Staff identities cannot receive email.");
    }
    const rendered = {
      to: message.to,
      subject: subjects[message.locale][message.kind],
      html: renderNotificationHtml(message, this.allowedActionOrigins),
    };
    for (let attempt = 1; attempt <= 3; attempt += 1) {
      try {
        await this.provider.send(rendered);
        return;
      } catch {
        if (attempt < 3) await new Promise((resolve) => setTimeout(resolve, attempt * 150));
      }
    }
    throw new Error("Notification delivery failed.");
  }

  configurationStatus() {
    return this.environment.values.SMTP_HOST &&
      (this.environment.values.DEPLOYMENT_ENVIRONMENT === "development" ||
        (this.environment.values.SMTP_USER && this.environment.values.SMTP_PASSWORD))
      ? "READY"
      : "NOT_CONFIGURED";
  }

  async verifyProvider(): Promise<void> {
    if (this.provider instanceof SmtpNotificationProvider) await this.provider.verify();
  }
}
