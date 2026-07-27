import { Injectable } from "@nestjs/common";
import nodemailer from "nodemailer";
import type { Locale } from "@waflo/contracts";
import { EnvironmentService } from "../config/environment.service.js";

export type NotificationKind =
  | "email_verification"
  | "password_reset"
  | "team_invitation"
  | "invitation_accepted"
  | "new_login"
  | "password_changed"
  | "session_revoked"
  | "subscription_status";

interface NotificationMessage {
  to: string;
  locale: Locale;
  kind: NotificationKind;
  actionUrl?: string;
  organizationName?: string;
}

interface NotificationProvider {
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
    });
  }

  async send(message: { to: string; subject: string; html: string }): Promise<void> {
    await this.transporter.sendMail({
      from: this.environment.values.EMAIL_FROM,
      to: message.to,
      subject: message.subject,
      html: message.html,
    });
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
  },
};

@Injectable()
export class NotificationService {
  private readonly provider: NotificationProvider;

  constructor(environment: EnvironmentService) {
    this.provider = new SmtpNotificationProvider(environment);
  }

  async send(message: NotificationMessage): Promise<void> {
    const direction = message.locale === "ar" ? "rtl" : "ltr";
    const actionLabel =
      message.locale === "ar"
        ? message.kind === "password_reset"
          ? "إعادة تعيين كلمة المرور"
          : "متابعة"
        : message.kind === "password_reset"
          ? "Reset password"
          : "Continue";
    const body =
      message.locale === "ar"
        ? `تم إرسال هذه الرسالة بخصوص حسابك${message.organizationName ? ` في ${message.organizationName}` : ""}.`
        : `This message was sent about your Waflo account${message.organizationName ? ` at ${message.organizationName}` : ""}.`;
    const action = message.actionUrl
      ? `<a href="${message.actionUrl}" style="display:inline-block;background:#AE3115;color:#fff;padding:12px 22px;border-radius:999px;text-decoration:none;font-weight:700">${actionLabel}</a>`
      : "";
    const html = `<!doctype html><html lang="${message.locale}" dir="${direction}"><body style="margin:0;background:#F7F9FF;color:#241916;font-family:Arial,sans-serif"><div style="max-width:600px;margin:32px auto;background:#fff;border-radius:22px;padding:32px"><div style="font-size:28px;font-weight:800;color:#AE3115">waflo</div><h1 style="font-size:24px">${subjects[message.locale][message.kind]}</h1><p style="line-height:1.7">${body}</p>${action}<p style="margin-top:32px;color:#76645F;font-size:12px">Waflo is owned and operated by Tavrix LLC.</p></div></body></html>`;
    await this.provider.send({
      to: message.to,
      subject: subjects[message.locale][message.kind],
      html,
    });
  }
}
