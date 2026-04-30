-- Ad Hub tables: campaign tracking, performance cache, attribution
-- Run: supabase db push  OR  psql $DATABASE_URL -f this_file.sql

-- Campaigns created/managed from the Ad Hub
CREATE TABLE IF NOT EXISTS ad_campaigns (
  id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  name            TEXT        NOT NULL,
  objective       TEXT        NOT NULL,  -- AWARENESS | TRAFFIC | CONVERSIONS | LEAD_GEN
  status          TEXT        NOT NULL DEFAULT 'DRAFT', -- DRAFT | ACTIVE | PAUSED | ENDED
  platforms       TEXT[]      NOT NULL DEFAULT '{}',    -- meta, google, linkedin, tiktok, microsoft
  platform_ids    JSONB       NOT NULL DEFAULT '{}',    -- { meta: 'id', google: 'id', ... }
  audience_preset TEXT,
  budget_daily    NUMERIC(10,2),
  budget_lifetime NUMERIC(10,2),
  schedule_start  DATE,
  schedule_end    DATE,
  creative        JSONB       NOT NULL DEFAULT '{}',    -- { assetId, headline, body, cta, imageUrl }
  created_by      TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Cached performance snapshots per platform per day
CREATE TABLE IF NOT EXISTS ad_performance_cache (
  id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  campaign_id     UUID        REFERENCES ad_campaigns(id) ON DELETE CASCADE,
  platform        TEXT        NOT NULL,   -- meta | google | linkedin | tiktok | microsoft
  platform_campaign_id TEXT   NOT NULL,
  date_preset     TEXT        NOT NULL,   -- last_7_days | last_30_days | etc.
  spend           NUMERIC(10,2) DEFAULT 0,
  revenue         NUMERIC(10,2) DEFAULT 0,
  roas            NUMERIC(8,4)  DEFAULT 0,
  impressions     BIGINT        DEFAULT 0,
  clicks          BIGINT        DEFAULT 0,
  ctr             NUMERIC(8,4)  DEFAULT 0,
  cpc             NUMERIC(8,4)  DEFAULT 0,
  cpm             NUMERIC(8,4)  DEFAULT 0,
  conversions     NUMERIC(10,2) DEFAULT 0,
  raw_data        JSONB         DEFAULT '{}',
  fetched_at      TIMESTAMPTZ   NOT NULL DEFAULT NOW()
);

-- Attribution: link ad conversions back to Zoho deals
CREATE TABLE IF NOT EXISTS ad_attribution (
  id                UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  platform          TEXT        NOT NULL,
  platform_campaign_id TEXT,
  platform_ad_id    TEXT,
  zoho_deal_id      TEXT,
  zoho_contact_id   TEXT,
  contact_email     TEXT,
  attributed_revenue NUMERIC(10,2) DEFAULT 0,
  attribution_type  TEXT        DEFAULT 'last_click',  -- last_click | first_click | linear
  converted_at      TIMESTAMPTZ,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_ad_perf_platform ON ad_performance_cache(platform, platform_campaign_id);
CREATE INDEX IF NOT EXISTS idx_ad_perf_fetched  ON ad_performance_cache(fetched_at DESC);
CREATE INDEX IF NOT EXISTS idx_ad_attr_platform ON ad_attribution(platform, platform_campaign_id);
CREATE INDEX IF NOT EXISTS idx_ad_attr_deal     ON ad_attribution(zoho_deal_id);

CREATE OR REPLACE FUNCTION set_ad_campaigns_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN NEW.updated_at = NOW(); RETURN NEW; END;
$$;

DROP TRIGGER IF EXISTS ad_campaigns_updated_at ON ad_campaigns;
CREATE TRIGGER ad_campaigns_updated_at
  BEFORE UPDATE ON ad_campaigns
  FOR EACH ROW EXECUTE FUNCTION set_ad_campaigns_updated_at();
