import nodemailer, { Transporter } from "nodemailer";
import { config } from "./env";

let transporter: Transporter | null = null;

/** Lazily builds a Gmail SMTP transporter. Requires a Gmail App Password, not the account password. */
export const getMailTransporter = (): Transporter => {
  if (!config.gmailSmtpUser || !config.gmailSmtpAppPassword) {
    throw new Error(
      "GMAIL_SMTP_USER/GMAIL_SMTP_APP_PASSWORD is not configured. Refusing to send notification emails without credentials."
    );
  }
  if (!transporter) {
    transporter = nodemailer.createTransport({
      service: "gmail",
      auth: { user: config.gmailSmtpUser, pass: config.gmailSmtpAppPassword },
    });
  }
  return transporter;
};

/** Called once at server startup so a missing SMTP credential fails fast instead of on the first notification. */
export const assertMailerConfigured = (): void => {
  getMailTransporter();
};
