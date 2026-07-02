/**
 * /api/cron/send-batches — Server-side batch email sender
 *
 * Fires scheduled email batches for all campaigns, independent of the browser.
 * Called every 15 minutes by Vercel Cron.
 *
 * Business hours: Mon–Fri 9am–5pm only.
 * Outside those hours: overdue batches are rescheduled to the next 9am business day
 * (preserving relative gaps between batches) rather than being skipped or dropped.
 *
 * Authorization: Bearer ${CRON_SECRET} header required in production.
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

// All business-hours logic runs in Mountain Time (America/Denver).
function getMTComponents(ms = Date.now()) {
  const parts = {};
  new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Denver",
    year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", hourCycle: "h23", weekday: "short",
  }).formatToParts(new Date(ms)).forEach(p => { if (p.type !== "literal") parts[p.type] = p.value; });
  return {
    h: parseInt(parts.hour) % 24,
    wd: ["Sun","Mon","Tue","Wed","Thu","Fri","Sat"].indexOf(parts.weekday),
    y: parseInt(parts.year), mo: parseInt(parts.month) - 1, d: parseInt(parts.day),
  };
}

function isBusinessHours(nowMs = Date.now()) {
  const { h, wd } = getMTComponents(nowMs);
  return wd >= 1 && wd <= 5 && h >= 9 && h < 17;
}

// Returns UTC timestamp of the next 9:00am Mountain Time on a business day.
function nextBusinessStart(nowMs = Date.now()) {
  for (let i = 0; i <= 7; i++) {
    const probe = nowMs + i * 86400000;
    const { y, mo, d } = getMTComponents(probe);
    for (const off of [6, 7]) {
      const c = Date.UTC(y, mo, d, 9 + off, 0, 0);
      const ck = getMTComponents(c);
      if (ck.h !== 9 || c <= nowMs) continue;
      if (ck.wd >= 1 && ck.wd <= 5) return c;
    }
  }
  return nowMs + 86400000;
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
    const campaigns = [...(state.campaigns || [])];
    const contacts = state.contacts || [];
    const reps = state.reps || [];

    const contactMap = {};
    for (const c of contacts) {
      if (c?.id) contactMap[c.id] = c;
    }

    const now = Date.now();
    const todStr = new Date().toISOString().slice(0, 10);

    // ── Outside business hours: reschedule overdue batches to next 9am ──────
    if (!isBusinessHours(now)) {
      const nextStart = nextBusinessStart(now);
      let anyRescheduled = false;

      for (let ci = 0; ci < campaigns.length; ci++) {
        const camp = campaigns[ci];
        if (!camp?.scheduledBatches || typeof camp.scheduledBatches !== "object") continue;

        // Collect overdue batches (past due AND any scheduled before next business start)
        const toReschedule = Object.entries(camp.scheduledBatches)
          .filter(([, info]) => new Date(info.scheduledAt).getTime() < nextStart)
          .sort((a, b) => new Date(a[1].scheduledAt).getTime() - new Date(b[1].scheduledAt).getTime());

        if (toReschedule.length === 0) continue;

        // Shift entire block so the first batch starts at nextStart,
        // subsequent batches keep their original spacing.
        const newSched = { ...camp.scheduledBatches };
        const firstOrigMs = new Date(toReschedule[0][1].scheduledAt).getTime();

        for (const [bk, info] of toReschedule) {
          const origMs = new Date(info.scheduledAt).getTime();
          const offsetFromFirst = origMs - firstOrigMs; // 0 for first, delay*N for rest
          newSched[bk] = { ...info, scheduledAt: new Date(nextStart + offsetFromFirst).toISOString() };
        }

        campaigns[ci] = { ...camp, scheduledBatches: newSched };
        anyRescheduled = true;
        console.log(`[cron] Off-hours: rescheduled ${toReschedule.length} batch(es) for campaign ${camp.id} → ${new Date(nextStart).toISOString()}`);
      }

      if (anyRescheduled) {
        await prisma.setting.upsert({
          where: { key: "app_state" },
          update: { value: { ...state, campaigns } },
          create: { key: "app_state", value: { ...state, campaigns } },
        });
      }

      return res.json({
        ok: true,
        batchesFired: 0,
        emailsSent: 0,
        offHours: true,
        rescheduledCampaigns: anyRescheduled ? campaigns.filter(c => c.scheduledBatches && Object.keys(c.scheduledBatches).length).length : 0,
        nextWindow: new Date(nextStart).toISOString(),
      });
    }

    // ── Business hours: fire one due batch per campaign ──────────────────────
    let totalBatchesFired = 0;
    let totalEmailsSent = 0;
    const errors = [];

    for (let ci = 0; ci < campaigns.length; ci++) {
      const camp = campaigns[ci];
      if (!camp?.scheduledBatches || typeof camp.scheduledBatches !== "object") continue;

      // Find due batches, sorted oldest-first
      const dueBatches = Object.entries(camp.scheduledBatches)
        .filter(([, info]) => new Date(info.scheduledAt).getTime() <= now)
        .sort((a, b) => new Date(a[1].scheduledAt).getTime() - new Date(b[1].scheduledAt).getTime());

      if (dueBatches.length === 0) continue;

      // Fire ONE batch per campaign per run to stay within 120s timeout
      const [batchKey, batchInfo] = dueBatches[0];
      const { touchIdx, contactIds } = batchInfo;

      if (!Array.isArray(contactIds) || contactIds.length === 0) {
        const newSched = { ...camp.scheduledBatches };
        delete newSched[batchKey];
        campaigns[ci] = { ...camp, scheduledBatches: newSched };
        continue;
      }

      const touch = (camp.touches || [])[touchIdx];
      if (!touch) {
        console.warn(`[cron] Touch ${touchIdx} not found in campaign ${camp.id} — dropping batch ${batchKey}`);
        const newSched = { ...camp.scheduledBatches };
        delete newSched[batchKey];
        campaigns[ci] = { ...camp, scheduledBatches: newSched };
        continue;
      }

      const rep = camp.repId ? reps.find(r => r.id === camp.repId) : null;
      const forceResend = !!batchInfo.forceResend;
      const updEnr = [...(camp.enrollments || [])];
      let sent = 0;
      let failed = 0;

      for (const contactId of contactIds) {
        const enroll = updEnr.find(e => e.contactId === contactId);
        if (!enroll) continue;
        // forceResend bypasses step guard (contacts skipped by step mismatch)
        if (!forceResend && enroll.step !== touchIdx) continue;
        if (enroll.status === "interested") continue;
        if ((enroll.sentSteps || []).includes(touchIdx)) continue;

        const c = contactMap[contactId];
        if (!c?.email) continue;

        const subject = mergeTags(touch.subject, c) || `Following up — ${camp.product || camp.name}`;
        const mergedBody = mergeTags(touch.body, c);
        const plainBody = mergedBody.trim() ? mergedBody : "(No email body — edit this touch in the Assets tab)";

        const esc = t => t.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
        const htmlLines = plainBody.split("\n").map(l => l.trim() ? `<p style="margin:0 0 10px 0">${esc(l)}</p>` : "<br>").join("");
        const htmlBody = `<!DOCTYPE html><html><body style="font-family:Arial,sans-serif;font-size:14px;color:#222;line-height:1.7;max-width:600px;margin:0 auto;padding:20px 24px">${htmlLines}</body></html>`;

        const to_name = c.fullName || `${c.firstName || ""} ${c.lastName || ""}`.trim();

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
              ...(rep?.gmailEnvKey ? { repEnvKey: rep.gmailEnvKey } : {}),
              ...(rep?.email ? { reply_to: rep.email, from_name: rep.name } : {}),
            }),
          });

          const gmailData = await gmailRes.json();

          if (gmailData.sent) {
            const idx = updEnr.findIndex(e => e.contactId === contactId);
            if (idx >= 0) {
              if (forceResend) {
                // Don't reset step — contact may be further ahead; just record sent step + timestamps
                updEnr[idx] = {
                  ...updEnr[idx],
                  sentSteps: [...(updEnr[idx].sentSteps || []), touchIdx],
                  lastContacted: todStr,
                  lastSentAt: todStr,
                };
              } else {
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
            }
            sent++;
          } else {
            console.error(`[cron] Failed to send to ${c.email}: ${gmailData.error || "send failed"}`);
            failed++;
          }
        } catch (err) {
          console.error(`[cron] Exception sending to ${c.email}: ${err.message}`);
          failed++;
          errors.push({ contactId, error: err.message });
        }

        await sleep(3000);
      }

      const newSched = { ...camp.scheduledBatches };
      delete newSched[batchKey];
      campaigns[ci] = {
        ...camp,
        enrollments: updEnr,
        scheduledBatches: newSched,
        sentBatches: {
          ...(camp.sentBatches || {}),
          [batchKey]: { sent, failed, sentAt: new Date().toISOString() },
        },
      };

      totalBatchesFired++;
      totalEmailsSent += sent;
      console.log(`[cron] Batch ${batchKey}: sent=${sent} failed=${failed}`);
    }

    if (totalBatchesFired > 0) {
      await prisma.setting.upsert({
        where: { key: "app_state" },
        update: { value: { ...state, campaigns } },
        create: { key: "app_state", value: { ...state, campaigns } },
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
