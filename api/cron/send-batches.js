/**
 * /api/cron/send-batches — Server-side batch email sender
 *
 * Fires scheduled email batches for all campaigns, independent of the browser.
 * Called every 15 minutes by Vercel Cron (Mon–Fri 9am–5pm MT only).
 *
 * Kill switch: set PAUSE_EMAIL_SENDING=true in Vercel env vars to halt all sends.
 * DB-level kill switch: set state.globalPause=true via /api/cron/status (UI toggle).
 *
 * Double-send prevention: each batch is claimed (removed from scheduledBatches
 * and written to DB) before any email is sent. A function timeout mid-send will
 * not re-queue the batch on the next cron tick.
 *
 * Pacing: 30s between each email. All due batches across all campaigns are
 * processed in one run (not just one per campaign). A time-budget guard stops
 * gracefully 45s before the 300s Vercel timeout so no run is killed mid-send.
 * The 15-minute cron picks up remaining batches on the next tick.
 */

import { prisma } from '../_lib/prisma.js';

const APP_URL = process.env.APP_URL || "https://revops.st1sports.com";

const SEND_PAUSE_MS   = 30_000;  // 30s between emails
const MAX_DURATION_MS = 300_000; // must match vercel.json maxDuration for this function
const TIMEOUT_BUFFER  = 45_000;  // stop this many ms before the hard timeout

const mergeTags = (text, c) => (text || "")
  .replace(/\{\{firstName\}\}/gi, c?.firstName || (c?.fullName || "").split(" ")[0] || "there")
  .replace(/\{\{orgName\}\}/gi, (typeof c?.school === "string" ? c.school : c?.school?.name) || "your school")
  .replace(/\{\{lastName\}\}/gi, c?.lastName || "")
  .replace(/\{\{sport\}\}/gi, (typeof c?.sport === "string" ? c.sport : c?.sport?.name) || "athletics");

function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

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

async function saveState(state) {
  await prisma.setting.upsert({
    where: { key: "app_state" },
    update: { value: state },
    create: { key: "app_state", value: state },
  });
}

export default async function handler(req, res) {
  // Env-level kill switch — set PAUSE_EMAIL_SENDING=true in Vercel env to halt all sends immediately.
  if (process.env.PAUSE_EMAIL_SENDING === 'true') {
    return res.json({ ok: true, paused: true, batchesFired: 0, emailsSent: 0 });
  }

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

  const runStart = Date.now();
  const timeRemaining = () => MAX_DURATION_MS - TIMEOUT_BUFFER - (Date.now() - runStart);

  try {
    const row = await prisma.setting.findUnique({ where: { key: "app_state" } });
    if (!row?.value) {
      return res.json({ ok: true, batchesFired: 0, emailsSent: 0, message: "No state found" });
    }

    const state = row.value;

    // DB-level kill switch — toggled from the Send Status UI
    if (state.globalPause === true) {
      return res.json({ ok: true, paused: true, batchesFired: 0, emailsSent: 0, message: 'Paused via globalPause flag' });
    }

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

        const toReschedule = Object.entries(camp.scheduledBatches)
          .filter(([, info]) => new Date(info.scheduledAt).getTime() < nextStart)
          .sort((a, b) => new Date(a[1].scheduledAt).getTime() - new Date(b[1].scheduledAt).getTime());

        if (toReschedule.length === 0) continue;

        const newSched = { ...camp.scheduledBatches };
        const firstOrigMs = new Date(toReschedule[0][1].scheduledAt).getTime();

        for (const [bk, info] of toReschedule) {
          const origMs = new Date(info.scheduledAt).getTime();
          const offsetFromFirst = origMs - firstOrigMs;
          newSched[bk] = { ...info, scheduledAt: new Date(nextStart + offsetFromFirst).toISOString() };
        }

        campaigns[ci] = { ...camp, scheduledBatches: newSched };
        anyRescheduled = true;
        console.log(`[cron] Off-hours: rescheduled ${toReschedule.length} batch(es) for campaign ${camp.id} → ${new Date(nextStart).toISOString()}`);
      }

      await saveState({ ...state, campaigns, lastCronRun: { timestamp: new Date().toISOString(), offHours: true, batchesFired: 0, emailsSent: 0, stoppedReason: 'off-hours', nextWindow: new Date(nextStart).toISOString(), batches: [] } });
      return res.json({
        ok: true, batchesFired: 0, emailsSent: 0, offHours: true,
        nextWindow: new Date(nextStart).toISOString(),
      });
    }

    // ── Business hours: roll through ALL due batches across all campaigns ────
    // Stops when: no more due batches, end of business day, or time budget exhausted.
    let totalBatchesFired = 0;
    let totalEmailsSent = 0;
    let stoppedReason = "done";
    const batchLog = [];
    const errors = [];

    outer: for (let ci = 0; ci < campaigns.length; ci++) {
      // Process every due batch for this campaign before moving to the next
      while (true) {
        const camp = campaigns[ci];
        if (!camp?.scheduledBatches || typeof camp.scheduledBatches !== "object") break;

        const dueBatches = Object.entries(camp.scheduledBatches)
          .filter(([, info]) => new Date(info.scheduledAt).getTime() <= Date.now())
          .sort((a, b) => new Date(a[1].scheduledAt).getTime() - new Date(b[1].scheduledAt).getTime());

        if (dueBatches.length === 0) break;

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

        // ── CLAIM the batch before sending anything ──────────────────────────
        // Removes from scheduledBatches and writes to DB immediately.
        // A timeout mid-send cannot cause the next cron tick to replay this batch.
        const claimedSched = { ...camp.scheduledBatches };
        delete claimedSched[batchKey];
        campaigns[ci] = { ...camp, scheduledBatches: claimedSched };
        await saveState({ ...state, campaigns });

        const rep = camp.repId ? reps.find(r => r.id === camp.repId) : null;
        const forceResend = !!batchInfo.forceResend;
        const batchContacts = batchInfo.batchContacts || {};
        const updEnr = [...(camp.enrollments || [])];
        let sent = 0;
        let failed = 0;
        let skippedEndOfDay = 0;

        console.log(`[cron] Starting batch ${batchKey} — campaign "${camp.name || camp.id}", touch ${touchIdx}, ${contactIds.length} contact(s)`);

        for (let ei = 0; ei < contactIds.length; ei++) {
          const contactId = contactIds[ei];

          // Stop if we've hit end of business day
          if (!isBusinessHours(Date.now())) {
            skippedEndOfDay = contactIds.length - ei;
            stoppedReason = "end-of-day";
            console.log(`[cron] End of business day — ${skippedEndOfDay} contact(s) in batch ${batchKey} will carry to next business day`);
            break;
          }

          // Stop if we're approaching the function timeout
          if (timeRemaining() < SEND_PAUSE_MS + 10_000) {
            stoppedReason = "time-budget";
            console.log(`[cron] Time budget exhausted — stopping after ${ei} of ${contactIds.length} contact(s) in batch ${batchKey}`);
            break outer;
          }

          const enroll = updEnr.find(e => e.contactId === contactId);
          if (!enroll) continue;
          if (!forceResend && enroll.step !== touchIdx) continue;
          if (enroll.status === "interested") continue;
          if ((enroll.sentSteps || []).includes(touchIdx)) continue;

          const c = batchContacts[contactId] || contactMap[contactId];
          if (!c?.email) {
            console.warn(`[cron] No contact data for ${contactId} in batch ${batchKey} — skipping`);
            continue;
          }

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
              console.log(`[cron] Sent ${ei + 1}/${contactIds.length} in batch ${batchKey} → ${c.email}`);
            } else {
              console.error(`[cron] Failed to send to ${c.email}: ${gmailData.error || "send failed"}`);
              failed++;
            }
          } catch (err) {
            console.error(`[cron] Exception sending to ${c.email}: ${err.message}`);
            failed++;
            errors.push({ contactId, error: err.message });
          }

          // 30s pause between emails (skip after the last one in the batch)
          if (ei < contactIds.length - 1) {
            await sleep(SEND_PAUSE_MS);
          }
        }

        // Persist the updated enrollments + sentBatches record immediately after each campaign.
        // campaigns[ci] already has the claimed (batch-removed) scheduledBatches from above.
        campaigns[ci] = {
          ...campaigns[ci],
          enrollments: updEnr,
          sentBatches: {
            ...(camp.sentBatches || {}),
            [batchKey]: { sent, failed, batchSize: contactIds.length, sentAt: new Date().toISOString() },
          },
        };
        await saveState({ ...state, campaigns });

        totalBatchesFired++;
        totalEmailsSent += sent;
        batchLog.push({
          campaign: camp.name || camp.id,
          batch: batchKey,
          touchIdx,
          batchSize: contactIds.length,
          sent,
          failed,
          skippedEndOfDay,
        });

        console.log(`[cron] Batch ${batchKey} done — sent=${sent} failed=${failed} batchSize=${contactIds.length}`);

        if (stoppedReason === "end-of-day") break outer;
      }
    }

    await saveState({
      ...state,
      campaigns,
      lastCronRun: {
        timestamp: new Date().toISOString(),
        batchesFired: totalBatchesFired,
        emailsSent: totalEmailsSent,
        stoppedReason,
        batches: batchLog,
      },
    });

    return res.json({
      ok: true,
      batchesFired: totalBatchesFired,
      emailsSent: totalEmailsSent,
      stoppedReason,
      batches: batchLog,
      errors: errors.length > 0 ? errors : undefined,
    });

  } catch (err) {
    console.error("[cron] send-batches crashed:", err.message);
    return res.status(500).json({ ok: false, error: err.message });
  }
}
