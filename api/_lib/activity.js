import { prisma } from './prisma.js';

export async function logActivity(campaignId, userId, type, metadata = {}) {
  try {
    await prisma.activityLog.create({ data: { campaignId, userId, type, metadata } });
  } catch (e) {
    // Non-fatal — don't let logging failures break the request
    console.error('logActivity failed:', e.message);
  }
}
