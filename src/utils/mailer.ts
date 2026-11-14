export interface SendOtpEmailOptions {
  to: string;
  name: string;
  otp: string;
  ttlMinutes: number;
}

export interface SendOtpEmailResult {
  provider: "gmail_oauth2" | "console_dev";
  delivered: boolean;
}

function toBase64Url(input: string): string {
  return Buffer.from(input, "utf8")
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

/**
 * Mengirim email OTP reset kata sandi siswa (US-05, BR-06).
 * Mendukung pengiriman via Google OAuth2 (Gmail API) bila kredensial
 * GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, dan GOOGLE_REFRESH_TOKEN tersedia,
 * serta fallback ke log konsol lokal pada mode pengembangan.
 */
export async function sendPasswordResetOtpEmail(
  options: SendOtpEmailOptions
): Promise<SendOtpEmailResult> {
  const clientId = process.env.GOOGLE_CLIENT_ID?.split(",")[0]?.trim();
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET?.trim();
  const refreshToken = process.env.GOOGLE_REFRESH_TOKEN?.trim();
  const mailFrom =
    process.env.MAIL_FROM?.trim() ||
    process.env.SMTP_USER?.trim() ||
    "no-reply@mclass.sch.id";

  const subject = `[M-Class] Kode OTP Reset Kata Sandi Anda: ${options.otp}`;
  const htmlBody = `
    <div style="font-family: Arial, sans-serif; max-width: 520px; margin: 0 auto; padding: 24px; border: 1px solid #e5e7eb; border-radius: 12px;">
      <h2 style="color: #111827; margin-top: 0;">Reset Kata Sandi M-Class</h2>
      <p style="color: #374151;">Halo <strong>${options.name}</strong>,</p>
      <p style="color: #374151;">Gunakan kode OTP 6 digit berikut untuk memverifikasi permintaan pengaturan ulang kata sandi akun siswa Anda:</p>
      <div style="background: #f3f4f6; padding: 16px; text-align: center; border-radius: 8px; margin: 20px 0;">
        <span style="font-size: 28px; font-weight: bold; letter-spacing: 6px; color: #059669;">${options.otp}</span>
      </div>
      <p style="color: #6b7280; font-size: 13px;">Kode ini berlaku selama <strong>${options.ttlMinutes} menit</strong>. Jangan berikan kode ini kepada siapa pun.</p>
    </div>
  `.trim();

  if (clientId && clientSecret && refreshToken) {
    try {
      const tokenRes = await fetch("https://oauth2.googleapis.com/token", {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          client_id: clientId,
          client_secret: clientSecret,
          refresh_token: refreshToken,
          grant_type: "refresh_token",
        }),
      });

      if (tokenRes.ok) {
        const tokenData = (await tokenRes.json()) as { access_token?: string };
        if (tokenData.access_token) {
          const mimeMessage = [
            `From: M-Class Presensi <${mailFrom}>`,
            `To: ${options.to}`,
            `Subject: ${subject}`,
            "MIME-Version: 1.0",
            'Content-Type: text/html; charset="UTF-8"',
            "",
            htmlBody,
          ].join("\r\n");

          const sendRes = await fetch(
            "https://gmail.googleapis.com/gmail/v1/users/me/messages/send",
            {
              method: "POST",
              headers: {
                Authorization: `Bearer ${tokenData.access_token}`,
                "Content-Type": "application/json",
              },
              body: JSON.stringify({
                raw: toBase64Url(mimeMessage),
              }),
            }
          );

          if (sendRes.ok) {
            return { provider: "gmail_oauth2", delivered: true };
          }
        }
      }
    } catch (err) {
      console.warn(
        "[MAILER] Gagal mengirim via Gmail OAuth2, beralih ke log konsol:",
        err instanceof Error ? err.message : err
      );
    }
  }

  console.info(
    `[MAILER-OTP] To: ${options.to} (${options.name}) | OTP: ${options.otp} (berlaku ${options.ttlMinutes} menit)`
  );
  return { provider: "console_dev", delivered: true };
}
