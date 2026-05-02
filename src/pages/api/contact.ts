export const prerender = false;

import type { APIRoute } from 'astro';
import { Resend } from 'resend';

const SERVICE_LABELS: Record<string, string> = {
  consulting: 'Digital Consulting',
  web: 'Web Development',
  apps: 'Custom Applications',
  other: "Not sure — let's talk",
};

export const POST: APIRoute = async ({ request }) => {
  const json = (body: object, status = 200) =>
    new Response(JSON.stringify(body), {
      status,
      headers: { 'Content-Type': 'application/json' },
    });

  let data: FormData;
  try {
    data = await request.formData();
  } catch {
    return json({ error: 'Invalid request body.' }, 400);
  }

  // ── Honeypot check ────────────────────────────────────────
  // If the hidden "website" field is filled in, it's a bot.
  const honeypot = data.get('website');
  if (honeypot) {
    // Return 200 so bots think it worked
    return json({ ok: true });
  }

  // ── Read fields ───────────────────────────────────────────
  const name    = (data.get('name')    as string | null)?.trim();
  const email   = (data.get('email')   as string | null)?.trim();
  const service = (data.get('service') as string | null)?.trim();
  const message = (data.get('message') as string | null)?.trim();
  const token   = data.get('cf-turnstile-response') as string | null;

  if (!name || !email || !service || !message) {
    return json({ error: 'All fields are required.' }, 400);
  }

  // Basic email sanity check
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return json({ error: 'Invalid email address.' }, 400);
  }

  // ── Cloudflare Turnstile verification ─────────────────────
  if (!token) {
    return json({ error: 'Please complete the bot challenge.' }, 400);
  }

  const turnstileSecret = import.meta.env.TURNSTILE_SECRET_KEY;
  if (!turnstileSecret) {
    console.error('TURNSTILE_SECRET_KEY is not set');
    return json({ error: 'Server configuration error.' }, 500);
  }

  const verifyBody = new URLSearchParams();
  verifyBody.set('secret', turnstileSecret);
  verifyBody.set('response', token);

  const turnstileRes = await fetch(
    'https://challenges.cloudflare.com/turnstile/v0/siteverify',
    {
      method: 'POST',
      body: verifyBody,
    }
  );
  const turnstileData = await turnstileRes.json() as { success: boolean };

  if (!turnstileData.success) {
    return json({ error: 'Bot verification failed. Please try again.' }, 403);
  }

  // ── Send email via Resend ─────────────────────────────────
  const resendKey = import.meta.env.RESEND_API_KEY;
  if (!resendKey) {
    console.error('RESEND_API_KEY is not set');
    return json({ error: 'Server configuration error.' }, 500);
  }

  const resend = new Resend(resendKey);
  const serviceLabel = SERVICE_LABELS[service] ?? service;

  const { error: sendError } = await resend.emails.send({
    from: 'K3 Contact Form <contact@k3creativeworks.com>',
    to: ['hello@k3creativeworks.com'],
    replyTo: email,
    subject: `New inquiry from ${name} — ${serviceLabel}`,
    html: `
      <div style="font-family:Inter,system-ui,sans-serif;max-width:600px;margin:0 auto;color:#0d1f33">
        <div style="background:#0d1f33;padding:28px 32px;border-radius:12px 12px 0 0">
          <h1 style="margin:0;color:#7aaad4;font-size:20px;font-weight:700;letter-spacing:-.01em">
            New inquiry via K3 Creative Works
          </h1>
        </div>
        <div style="background:#f5f7f9;padding:28px 32px;border-radius:0 0 12px 12px;border:1px solid #e0e5ea;border-top:none">
          <table style="width:100%;border-collapse:collapse">
            <tr>
              <td style="padding:10px 0;border-bottom:1px solid #e0e5ea;width:110px;color:#6b7f8e;font-size:13px;font-weight:600;text-transform:uppercase;letter-spacing:.06em">Name</td>
              <td style="padding:10px 0;border-bottom:1px solid #e0e5ea;color:#0d1f33;font-size:15px">${escapeHtml(name)}</td>
            </tr>
            <tr>
              <td style="padding:10px 0;border-bottom:1px solid #e0e5ea;color:#6b7f8e;font-size:13px;font-weight:600;text-transform:uppercase;letter-spacing:.06em">Email</td>
              <td style="padding:10px 0;border-bottom:1px solid #e0e5ea;font-size:15px">
                <a href="mailto:${escapeHtml(email)}" style="color:#1a5cb0;text-decoration:none">${escapeHtml(email)}</a>
              </td>
            </tr>
            <tr>
              <td style="padding:10px 0;border-bottom:1px solid #e0e5ea;color:#6b7f8e;font-size:13px;font-weight:600;text-transform:uppercase;letter-spacing:.06em">Service</td>
              <td style="padding:10px 0;border-bottom:1px solid #e0e5ea;color:#0d1f33;font-size:15px">${escapeHtml(serviceLabel)}</td>
            </tr>
            <tr>
              <td style="padding:12px 0 0;color:#6b7f8e;font-size:13px;font-weight:600;text-transform:uppercase;letter-spacing:.06em;vertical-align:top">Message</td>
              <td style="padding:12px 0 0;color:#0d1f33;font-size:15px;line-height:1.65;white-space:pre-wrap">${escapeHtml(message)}</td>
            </tr>
          </table>
          <div style="margin-top:28px;padding-top:20px;border-top:1px solid #e0e5ea">
            <a href="mailto:${escapeHtml(email)}" style="display:inline-block;padding:12px 24px;background:#1a3a5c;color:white;border-radius:8px;text-decoration:none;font-size:14px;font-weight:600">
              Reply to ${escapeHtml(name)} →
            </a>
          </div>
        </div>
      </div>
    `,
    text: `New inquiry via K3 Creative Works\n\nName: ${name}\nEmail: ${email}\nService: ${serviceLabel}\n\nMessage:\n${message}`,
  });

  if (sendError) {
    console.error('Resend error:', sendError);
    return json({ error: 'Failed to send message. Please try again.' }, 500);
  }

  return json({ ok: true });
};

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
