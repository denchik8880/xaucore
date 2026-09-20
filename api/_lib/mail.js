/* =========================================================================
   XAUCORE — outgoing mail (password-reset codes only).

   One provider, no dependencies: Resend's HTTP API. Set in the Vercel project:
     RESEND_API_KEY   re_...            (required to send anything)
     MAIL_FROM        XAUCORE <noreply@your-verified-domain>   (optional)

   Nothing else in the app sends mail, and no address is ever stored anywhere
   but the account row it already belongs to.
   ========================================================================= */

export const mailConfigured = () => !!process.env.RESEND_API_KEY;

const FROM = () => process.env.MAIL_FROM || "XAUCORE <onboarding@resend.dev>";

/** Send one mail. Throws on a provider error so the route can answer honestly. */
export async function sendMail({ to, subject, text, html }) {
  const key = process.env.RESEND_API_KEY;
  if (!key) throw new Error("mail not configured");
  const r = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: "Bearer " + key, "Content-Type": "application/json" },
    body: JSON.stringify({ from: FROM(), to: [to], subject, text, html }),
  });
  if (!r.ok) {
    let d = null;
    try { d = await r.json(); } catch { /* ignore */ }
    throw new Error((d && (d.message || d.error)) || ("mail HTTP " + r.status));
  }
  return true;
}

/** The reset-code letter, in the language the app is in (falls back to English). */
export function resetCodeMail(code, lang) {
  const T = {
    en: { s: "XAUCORE — password reset code", h: "Your code", p: "Enter this code in the app to set a new password. It is valid for 15 minutes.", f: "If you did not ask for it, ignore this letter — your password stays as it is." },
    ru: { s: "XAUCORE — код для смены пароля", h: "Ваш код", p: "Введите этот код в приложении, чтобы задать новый пароль. Он действует 15 минут.", f: "Если вы этого не запрашивали, просто не отвечайте на письмо — пароль останется прежним." },
    uk: { s: "XAUCORE — код для зміни пароля", h: "Ваш код", p: "Уведіть цей код у застосунку, щоб задати новий пароль. Він дійсний 15 хвилин.", f: "Якщо ви цього не запитували, просто не відповідайте на лист — пароль залишиться тим самим." },
    fr: { s: "XAUCORE — code de réinitialisation", h: "Votre code", p: "Saisissez ce code dans l’application pour définir un nouveau mot de passe. Il est valable 15 minutes.", f: "Si vous n’êtes pas à l’origine de cette demande, ignorez ce message — votre mot de passe reste inchangé." },
    tr: { s: "XAUCORE — parola sıfırlama kodu", h: "Kodunuz", p: "Yeni bir parola belirlemek için bu kodu uygulamaya girin. 15 dakika geçerlidir.", f: "Bunu siz istemediyseniz bu e-postayı yok sayın — parolanız aynı kalır." },
  };
  const t = T[lang] || T.en;
  return {
    subject: t.s,
    text: t.h + ": " + code + "\n\n" + t.p + "\n\n" + t.f,
    html:
      '<div style="font-family:-apple-system,Segoe UI,Roboto,Arial,sans-serif;max-width:440px;margin:0 auto;padding:24px;color:#111418">' +
      '<div style="font-size:20px;font-weight:700;letter-spacing:.04em">XAUCORE</div>' +
      '<p style="margin:18px 0 6px;color:#5f6368">' + t.h + "</p>" +
      '<div style="font-size:34px;font-weight:700;letter-spacing:.22em;font-variant-numeric:tabular-nums">' + code + "</div>" +
      '<p style="margin:18px 0 0;line-height:1.5">' + t.p + "</p>" +
      '<p style="margin:14px 0 0;color:#8b8f95;font-size:13px;line-height:1.5">' + t.f + "</p>" +
      "</div>",
  };
}
