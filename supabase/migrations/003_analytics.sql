-- Migration 003: Analytics — UTM link library + alert rules
-- Run with: psql $DATABASE_URL -f supabase/migrations/003_analytics.sql

-- ─── UTM LINKS ───────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS utm_links (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  label         text NOT NULL,
  destination   text NOT NULL,
  utm_source    text NOT NULL,
  utm_medium    text NOT NULL,
  utm_campaign  text NOT NULL,
  utm_content   text,
  utm_term      text,
  full_url      text NOT NULL,
  clicks        integer NOT NULL DEFAULT 0,
  created_by    text,
  created_at    timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS utm_links_campaign_idx ON utm_links (utm_campaign);
CREATE INDEX IF NOT EXISTS utm_links_created_at_idx ON utm_links (created_at DESC);

-- ─── ALERT RULES ─────────────────────────────────────────────────────────────
-- Configurable ROAS / budget / pacing thresholds per platform or campaign
CREATE TABLE IF NOT EXISTS alert_rules (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name          text NOT NULL,
  platform      text,                   -- null = applies to all platforms
  campaign_id   text,                   -- null = applies to all campaigns on platform
  metric        text NOT NULL,          -- 'roas', 'spend', 'ctr', 'cpc', 'impressions'
  operator      text NOT NULL,          -- 'lt', 'gt', 'lte', 'gte'
  threshold     numeric(12,4) NOT NULL,
  enabled       boolean NOT NULL DEFAULT true,
  notify_slack  boolean NOT NULL DEFAULT false,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS alert_rules_platform_idx ON alert_rules (platform);
CREATE INDEX IF NOT EXISTS alert_rules_enabled_idx  ON alert_rules (enabled);

-- ─── ALERT HISTORY ───────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS alert_history (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  rule_id       uuid NOT NULL REFERENCES alert_rules (id) ON DELETE CASCADE,
  platform      text NOT NULL,
  campaign_id   text,
  campaign_name text,
  metric        text NOT NULL,
  value         numeric(12,4) NOT NULL,
  threshold     numeric(12,4) NOT NULL,
  fired_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS alert_history_rule_id_idx  ON alert_history (rule_id);
CREATE INDEX IF NOT EXISTS alert_history_fired_at_idx ON alert_history (fired_at DESC);
