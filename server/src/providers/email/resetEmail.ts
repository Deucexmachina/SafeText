import { config } from "../../config.js";

// SafeText brand colours (match web/src/landing.css).
const GREEN = "#14532d";
const NAVY = "#17324d";
const TINT = "#eef6f0";
const PAGE = "#f4f5f6";
const BORDER = "#d9e2dc";
const MUTED = "#4b5563";
const FONT = "-apple-system, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif";

const escapeHtml = (value: string) =>
  value.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

export function resetEmail(input: {
  code: string;
  expiresMinutes: number;
}): { subject: string; text: string; html: string } {
  const code = escapeHtml(input.code);
  const minutes = escapeHtml(String(input.expiresMinutes));
  const logo = escapeHtml(`${config.appOrigin}/icon.png`);

  // Plain-text version: shown by clients that block or don't support HTML.
  const text = [
    "Someone requested a password reset for your SafeText account.",
    "",
    `Verification code: ${input.code}`,
    "",
    `The code expires in ${input.expiresMinutes} minutes and can only be used once.`,
    "If this wasn't you, ignore this email — your password stays unchanged.",
  ].join("\n");

  // Table layout + inline styles: the only approach Gmail and Outlook render reliably.
  const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="color-scheme" content="light">
<meta name="supported-color-schemes" content="light">
<title>Your SafeText password reset code</title>
</head>
<body style="margin:0;padding:0;background:${PAGE};">
<div style="display:none;max-height:0;overflow:hidden;opacity:0;color:transparent;">Your SafeText code expires in ${minutes} minutes. Never share it with anyone.</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:${PAGE};">
  <tr>
    <td align="center" style="padding:32px 16px;">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:480px;">
        <tr>
          <td style="padding:0 4px 16px;font-family:${FONT};">
            <table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr>
              <td style="padding-right:8px;vertical-align:middle;"><img src="${logo}" width="30" height="27" alt="" style="display:block;border:0;"></td>
              <td style="vertical-align:middle;font-family:${FONT};font-size:20px;font-weight:800;color:${GREEN};letter-spacing:-0.2px;">SafeText</td>
            </tr></table>
          </td>
        </tr>
        <tr>
          <td style="background:#ffffff;border:1px solid ${BORDER};border-radius:14px;overflow:hidden;">
            <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
              <tr><td style="height:5px;background:${GREEN};font-size:0;line-height:0;">&nbsp;</td></tr>
              <tr>
                <td style="padding:28px 28px 8px;font-family:${FONT};">
                  <h1 style="margin:0 0 8px;font-size:22px;line-height:1.3;font-weight:800;color:${NAVY};">Reset your password</h1>
                  <p style="margin:0;font-size:15px;line-height:1.6;color:${MUTED};">Someone requested a password reset for your SafeText account. Enter this code on the reset page to continue.</p>
                </td>
              </tr>
              <tr>
                <td style="padding:20px 28px;">
                  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
                    <tr>
                      <td align="center" style="background:${TINT};border:1px solid ${BORDER};border-radius:12px;padding:18px 12px;font-family:${FONT};">
                        <div style="font-size:12px;font-weight:700;letter-spacing:1px;text-transform:uppercase;color:${MUTED};margin-bottom:6px;">Verification code</div>
                        <div style="font-family:'SFMono-Regular',Consolas,'Courier New',monospace;font-size:34px;line-height:1.2;font-weight:700;letter-spacing:8px;color:${GREEN};">${code}</div>
                      </td>
                    </tr>
                  </table>
                </td>
              </tr>
              <tr>
                <td style="padding:0 28px 28px;font-family:${FONT};font-size:14px;line-height:1.6;color:${MUTED};">
                  <p style="margin:0 0 10px;">&#9201;&nbsp; The code expires in <strong style="color:${NAVY};">${minutes} minutes</strong> and can only be used once.</p>
                  <p style="margin:0 0 10px;">&#128274;&nbsp; <strong style="color:${NAVY};">Never share this code</strong> with anyone, even if they say they're from SafeText.</p>
                  <p style="margin:0;">If this wasn't you, ignore this email. Your password stays unchanged.</p>
                </td>
              </tr>
            </table>
          </td>
        </tr>
        <tr>
          <td align="center" style="padding:18px 12px 0;font-family:${FONT};font-size:12px;line-height:1.6;color:${MUTED};">
            SafeText &middot; Developed by Nano<br>
            An awareness aid, not a guarantee. When in doubt, don't click.
          </td>
        </tr>
      </table>
    </td>
  </tr>
</table>
</body>
</html>`;

  return { subject: "Your SafeText password reset code", text, html };
}
