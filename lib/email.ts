import { Resend } from 'resend';

let _resend: Resend | null = null;

function getResend(): Resend {
  if (!_resend) {
    _resend = new Resend(process.env.RESEND_API_KEY);
  }
  return _resend;
}

export const WELCOME_SUBJECT = 'Welcome to the SnoMaster Field Sales Portal';

/** SnoMaster red brand colour. */
const SNO_RED = '#e31e1c';

/** Strip any trailing slash so we never build `//login`. */
export function siteBase(): string {
  const url = process.env.NEXT_PUBLIC_SITE_URL || 'https://snomaster-fieldsales-portal.vercel.app';
  return url.replace(/\/+$/, '');
}

/**
 * Branded welcome email. Used both at user creation and the "Send Welcome" button
 * so the two paths stay identical.
 */
export function welcomeEmailHtml(opts: { name: string; email: string; password: string }): string {
  const base = siteBase();
  const loginUrl = `${base}/login`;
  const snoLogo = `${base}/snomaster-logo.png`;
  const ojLogo = `${base}/oj-logo.png`;

  return `
  <div style="margin:0;padding:0;background:#f3f4f6;font-family:Arial,Helvetica,sans-serif;color:#1f2937;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f3f4f6;padding:24px 0;">
      <tr><td align="center">
        <table role="presentation" width="560" cellpadding="0" cellspacing="0" style="max-width:560px;width:100%;background:#ffffff;border-radius:14px;overflow:hidden;box-shadow:0 2px 8px rgba(0,0,0,0.06);">
          <!-- Header -->
          <tr><td style="background:${SNO_RED};padding:28px 32px;text-align:center;">
            <img src="${snoLogo}" alt="SnoMaster" width="190" style="max-width:190px;height:auto;display:inline-block;" />
          </td></tr>
          <tr><td style="height:5px;background:#1a1a1a;"></td></tr>

          <!-- Body -->
          <tr><td style="padding:32px;">
            <h1 style="margin:0 0 18px;font-size:20px;line-height:1.3;color:#111827;">
              Welcome to the <span style="color:${SNO_RED};">SnoMaster Field Sales Portal</span>, ${opts.name}
            </h1>

            <p style="margin:0 0 16px;font-size:14px;line-height:1.6;color:#374151;">
              In this portal, you will be able to view transactional data from retailers as well as
              field data like BA and Rep visits and form submission data.
            </p>

            <p style="margin:0 0 10px;font-size:14px;line-height:1.6;color:#374151;">
              Here are your credentials to log in:
            </p>

            <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#fef2f2;border-left:4px solid ${SNO_RED};border-radius:8px;margin:0 0 22px;">
              <tr><td style="padding:16px 18px;font-size:14px;color:#1f2937;">
                <p style="margin:0 0 6px;"><strong style="color:${SNO_RED};">Username:</strong> ${opts.email}</p>
                <p style="margin:0;"><strong style="color:${SNO_RED};">Password:</strong> ${opts.password}</p>
              </td></tr>
            </table>

            <table role="presentation" cellpadding="0" cellspacing="0" style="margin:0 0 22px;">
              <tr><td style="border-radius:8px;background:${SNO_RED};">
                <a href="${loginUrl}" style="display:inline-block;padding:12px 26px;font-size:14px;font-weight:bold;color:#ffffff;text-decoration:none;border-radius:8px;">
                  Log in &amp; change your password
                </a>
              </td></tr>
            </table>

            <p style="margin:0 0 22px;font-size:12px;line-height:1.5;color:#6b7280;">
              Or paste this link into your browser:<br/>
              <a href="${loginUrl}" style="color:${SNO_RED};">${loginUrl}</a>
            </p>

            <p style="margin:0 0 4px;font-size:14px;line-height:1.6;color:#374151;">
              We look forward to providing you value that grows sales!
            </p>
            <p style="margin:0;font-size:14px;font-weight:bold;color:#111827;">Team OuterJoin</p>
          </td></tr>

          <!-- Footer -->
          <tr><td style="padding:22px 32px;border-top:1px solid #e5e7eb;text-align:center;">
            <img src="${ojLogo}" alt="OuterJoin" width="170" style="max-width:170px;height:auto;display:inline-block;margin-bottom:10px;" />
            <p style="margin:6px 0 0;font-size:11px;color:#9ca3af;letter-spacing:0.03em;">In association with Atomic Marketing</p>
          </td></tr>
        </table>
      </td></tr>
    </table>
  </div>`;
}

export async function sendEmail(opts: {
  to: string | string[];
  subject: string;
  html: string;
  from?: string;
  cc?: string | string[];
  bcc?: string | string[];
}) {
  const resend = getResend();
  return resend.emails.send({
    from: opts.from ?? 'SnoMaster Field Sales Portal <noreply@outerjoin.co.za>',
    to: Array.isArray(opts.to) ? opts.to : [opts.to],
    subject: opts.subject,
    html: opts.html,
    ...(opts.cc ? { cc: Array.isArray(opts.cc) ? opts.cc : [opts.cc] } : {}),
    ...(opts.bcc ? { bcc: Array.isArray(opts.bcc) ? opts.bcc : [opts.bcc] } : {}),
  });
}
