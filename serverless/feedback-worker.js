/**
 * ClipSend feedback proxy (Cloudflare Worker).
 *
 * The ClipSend desktop app POSTs feedback JSON here instead of calling the
 * Discord webhook directly. The webhook URL is stored ONLY as a Cloudflare
 * Worker secret (env.DISCORD_WEBHOOK_URL) — it never ships inside the
 * installer, never appears in the repo, and can be rotated without shipping
 * a new build.
 *
 * Deploy:
 *   npm i -g wrangler        # or: npx wrangler
 *   cd serverless
 *   wrangler deploy
 *   echo "https://discord.com/api/webhooks/..." | wrangler secret put DISCORD_WEBHOOK_URL
 *
 * Rate limiting is intentionally minimal: Discord's own webhook rate limits
 * (5 req/2s per webhook) apply, and the app itself throttles to one
 * submission per 15 seconds. Add KV-based rate limiting here if abuse ever
 * becomes a problem.
 */

// Accept requests only from the ClipSend app's public feedback form.
const ALLOWED_TYPES = new Set(['bug', 'feature', 'general']);
const MAX_MESSAGE_LENGTH = 1000;
const MAX_CONTACT_LENGTH = 100;

function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' }
  });
}

function buildEmbed({ type, message, contact, version }) {
  let color = 0x808080; // Gray for general
  let titleEmoji = '💬';
  let typeName = 'General Feedback';

  if (type === 'bug') {
    color = 0xFF4444; // Red
    titleEmoji = '🐛';
    typeName = 'Bug Report';
  } else if (type === 'feature') {
    color = 0x44AAFF; // Blue
    titleEmoji = '💡';
    typeName = 'Feature Request';
  }

  const embed = {
    author: { name: 'New Feedback Submission' },
    title: `${titleEmoji} ${typeName}`,
    description: message,
    color,
    timestamp: new Date().toISOString(),
    footer: { text: 'ClipSend Feedback' },
    fields: [{ name: 'App Version', value: version || 'Unknown', inline: true }]
  };

  if (contact && contact.trim().length > 0) {
    embed.fields.push({
      name: 'Submitted by',
      value: contact.substring(0, MAX_CONTACT_LENGTH),
      inline: true
    });
  }

  return embed;
}

export default {
  async fetch(request, env) {
    if (request.method !== 'POST') {
      return json({ success: false, error: 'Method not allowed.' }, 405);
    }

    // Trim in case a trailing space/newline slipped into the secret during
    // `wrangler secret put` (common on Windows when pasting).
    const webhookUrl = (env.DISCORD_WEBHOOK_URL || '').trim();
    if (!webhookUrl) {
      console.error('DISCORD_WEBHOOK_URL secret is not configured.');
      return json({ success: false, error: 'Feedback service is not configured.' }, 500);
    }

    let payload;
    try {
      payload = await request.json();
    } catch (e) {
      return json({ success: false, error: 'Invalid JSON payload.' }, 400);
    }

    // --- Validate (server-side copy of the app's client-side checks) ---
    let { type, message, contact, version } = payload || {};

    if (typeof message !== 'string' || message.trim().length < 10) {
      return json({ success: false, error: 'Message too short — please add more detail.' }, 400);
    }
    if (message.length > MAX_MESSAGE_LENGTH) {
      message = message.substring(0, MAX_MESSAGE_LENGTH) + '...';
    }
    if (!ALLOWED_TYPES.has(type)) {
      type = 'general';
    }
    contact = typeof contact === 'string' ? contact.substring(0, MAX_CONTACT_LENGTH) : '';
    version = typeof version === 'string' ? version.substring(0, 30) : 'Unknown';

    const embed = buildEmbed({ type, message, contact, version });

    try {
      const response = await fetch(webhookUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ embeds: [embed] })
      });

      if (!response.ok) {
        console.error(`Discord webhook returned ${response.status} ${response.statusText}`);
        return json({ success: false, error: `Discord API returned ${response.status}` }, 502);
      }

      return json({ success: true });
    } catch (e) {
      console.error('Failed to reach Discord webhook:', e);
      // Include the underlying cause so a misconfigured secret (e.g. trailing
      // whitespace) is easy to spot instead of a generic message.
      return json({ success: false, error: 'Could not reach Discord.', detail: e.message }, 502);
    }
  }
};
