/**
 * /api/cron/send-batches — Server-side batch email sender
 *
 * Fires scheduled email batches for all campaigns, independent of the browser.
 * Called every 15 minutes by Vercel Cron.
 *
 * Authorization: Bearer ${CRON_SECRET} header required in production.
 * If CRON_SECRET is not set, auth check is skipped (allows manual testing).
 *
 * For each campaign with due scheduledBatches, fires one batch per campaign per run
 * to stay within the 120s function timeout.
 */

import { prisma } from '../_lib/prisma.js';

const APP_URL = process.env.APP_URL || "https://revops.st1sports.com";

const mergeTags = (text, c) => (text || "")
  .replace(/\{\{firstName\}\}/gi, c?.firstName || (c?.fullName || "").split(" ")[0] || "there")
  .replace(/\{\{orgName\}\}/gi, (typeof c?.school === "string" ? c.school : c?.school?.name) || "your school")
  .replace(/\{\{lastName\}\}/gi, c?.lastName || "")
  .replace(/\{\{sport\}\}/gi, (typeof c?.sport === "string" ? c.sport : c?.sport?.name) || "athletics");

function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

export default async function handler(req, res) {
  // Verify auth if CRON_SECRET is configured
  const cronSecret = process.env.CRON_SECRET;
  if (cronSecret) {
    const authHeader = req.headers["authorization"] || "";
    if (authHeader !== `Bearer ${cronSecret}`) {
      return res.status(401).json({ error: "Unauthorized" });
    }
  }

  if (req.method !== "GET" && req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {
    // Load full app state from DB
    const row = await prisma.setting.findUnique({ where: { key: "app_state" } });
    if (!row?.value) {
      return res.json({ ok: true, batchesFired: 0, emailsSent: 0, message: "No state found" });
    }

    const state = row.value;
    const campaigns = state.campaigns || [];
    const contacts = state.contacts || [];
    const reps = state.reps || [];

    // Build contact map for fast lookup
    const contactMap = {};
    for (const c of contacts) {
      if (c?.id) contactMap[c.id] = c;
    }

    const now = Date.now();
    const todStr = new Date().toISOString().slice(0, 10);
    let totalBatchesFired = 0;
    let totalEmailsSent = 0;
    const errors = [];

    // Process each campaign
    for (const camp of campaigns) {
      if (!camp?.scheduledBatches || typeof camp.scheduledBatches !== "object") continue;

      // Find all due batches for this campaign, sorted by scheduledAt ascending
      const dueBatches = Object.entries(camp.scheduledBatches)
        .filter(([, info]) => new Date(info.scheduledAt).getTime() <= now)
        .sort((a, b) => new Date(a[1].scheduledAt).getTime() - new Date(b[1].scheduledAt).getTime());

      if (dueBatches.length === 0) continue;

      // Fire only ONE batch per campaign per cron run to stay within timeout
      const [batchKey, batchInfo] = dueBatches[0];
      const { scheduledAt, touchIdx, contactIds } = batchInfo;

      if (!Array.isArray(contactIds) || contactIds.length === 0) {
        // Empty batch — just remove it
        delete camp.scheduledBatches[batchKey];
        continue;
      }

      const touch = (camp.touches || [])[touchIdx];
      if (!touch) {
        console.warn(`[cron] Touch ${touchIdx} not found in campaign ${camp.id} — skipping batch ${batchKey}`);
        delete camp.scheduledBatches[batchKey];
        continue;
      }

      const rep = camp.repId ? reps.find(r => r.id === camp.repId) : null;
      const updEnr = [...(camp.enrollments || [])];

      let sent = 0;
      let failed = 0;

      for (const contactId of contactIds) {
        const enroll = updEnr.find(e => e.contactId === contactId);
        if (!enroll) continue;

        // Skip guards
        if (enroll.step !== touchIdx) continue; // already advanced
        if (enroll.status === "interested") continue; // interested contacts skip email
        if ((enroll.sentSteps || []).includes(touchIdx)) continue; // already sent this touch

        const c = contactMap[contactId];
        if (!c?.email) continue; // no email

        // Build email content
        const subject = mergeTags(touch.subject, c) || `Following up — ${camp.product || camp.name}`;
        const mergedBody = mergeTags(touch.body, c);
        const plainBody = mergedBody.trim() ? mergedBody : "(No email body — edit this touch in the Assets tab)";

        const esc = t => t.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
        const htmlLines = plainBody.split("\n").map(l => l.trim() ? `<p style="margin:0 0 10px 0">${esc(l)}</p>` : "<br>").join("");
        const htmlBody = `<!DOCTYPE html><html><body style="font-family:Arial,sans-serif;font-size:14px;color:#222;line-height:1.7;max-width:600px;margin:0 auto;padding:20px 24px">${htmlLines}</body></html>`;

        const to_name = c.fullName || `${c.firstName || ""} ${c.lastName || ""}`.trim();
        const repEnvKey = rep?.gmailEnvKey || null;
        const reply_to = rep?.email || null;
        const from_name = rep?.name || null;

        try {
          const gmailRes = await fetch(`${APP_URL}/api/gmail`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              action: "send",
              to_email: c.email,
              to_name,
              subject,
              body: plainBody,
              htmlBody,
              ...(repEnvKey ? { repEnvKey } : {}),
              ...(reply_to ? { reply_to, from_name } : {}),
            }),
          });

          const gmailData = await gmailRes.json();

          if (gmailData.sent) {
            // Update enrollment: mark sentStep and advance
            const idx = updEnr.findIndex(e => e.contactId === contactId);
            if (idx >= 0) {
              const ns = touchIdx + 1;
              const done = ns >= (camp.touches || []).length;
              const nt = (camp.touches || [])[ns];
              const nd = nt ? new Date(Date.now() + nt.dayOffset * 86400000).toISOString().slice(0, 10) : null;
              updEnr[idx] = {
                ...updEnr[idx],
                sentSteps: [...(updEnr[idx].sentSteps || []), touchIdx],
                step: ns,
                status: done ? "done" : "active",
                nextDate: nd || enroll.nextDate,
                lastContacted: todStr,
                lastSentAt: todStr,
              };
            }
            sent++;
          } else {
            const reason = gmailData.error || "send failed";
            console.error(`[cron] Failed to send to ${c.email}: ${reason}`);
            failed++;
          }
        } catch (err) {
          console.error(`[cron] Exception sending to ${c.email}: ${err.message}`);
          failed++;
          errors.push({ contactId, error: err.message });
        }

        // Rate limit: wait 3s between emails (same as frontend)
        await sleep(3000);
      }

      // Update campaign: remove from scheduledBatches, add to sentBatches, update enrollments
      const campIdx = campaigns.findIndex(c => c.id === camp.id);
      if (campIdx >= 0) {
        const newSched = { ...(campaigns[campIdx].scheduledBatches || {}) };
        delete newSched[batchKey];
        campaigns[campIdx] = {
          ...campaigns[campIdx],
          enrollments: updEnr,
          scheduledBatches: newSched,
          sentBatches: {
            ...(campaigns[campIdx].sentBatches || {}),
            [batchKey]: { sent, failed, sentAt: new Date().toISOString() },
          },
        };
      }

      totalBatchesFired++;
      totalEmailsSent += sent;

      console.log(`[cron] Batch ${batchKey}: sent=${sent} failed=${failed}`);
    }

    // Save updated state back to DB
    if (totalBatchesFired > 0) {
      const updatedState = { ...state, campaigns };
      await prisma.setting.upsert({
        where: { key: "app_state" },
        update: { value: updatedState },
        create: { key: "app_state", value: updatedState },
      });
    }

    return res.json({
      ok: true,
      batchesFired: totalBatchesFired,
      emailsSent: totalEmailsSent,
      errors: errors.length > 0 ? errors : undefined,
    });

  } catch (err) {
    console.error("[cron] send-batches crashed:", err.message);
    return res.status(500).json({ ok: false, error: err.message });
  }
}
