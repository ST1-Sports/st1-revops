# ST1 Sports RevOps Platform

Sales, deals, RFPs, invoicing, prospecting, and integrations — all in one place.

## Stack

- **React 18** + **Vite 5** — fast builds, instant HMR in dev
- **React Router 6** — client-side routing, SPA with URL-based tool switching
- **Vercel** — hosting, edge functions for API proxy, automatic deploys
- **Anthropic Claude** — AI features (routed through serverless proxy, key never in browser)

---

## Quick Deploy to Vercel

### Step 1 — Push to GitHub

```bash
# From this folder:
git init
git add .
git commit -m "Initial ST1 RevOps deploy"
git branch -M main

# Create a new repo at github.com then:
git remote add origin https://github.com/YOUR_USERNAME/st1-revops.git
git push -u origin main
```

### Step 2 — Connect to Vercel

1. Go to [vercel.com](https://vercel.com) → **Add New Project**
2. Import your `st1-revops` GitHub repo
3. Framework: **Vite** (auto-detected)
4. Click **Deploy** — first deploy will fail because the API key isn't set yet

### Step 3 — Add the API key

1. In Vercel: **Project Settings → Environment Variables**
2. Add:

| Name | Value | Environments |
|------|-------|-------------|
| `ANTHROPIC_KEY` | `sk-ant-api03-...` | Production, Preview, Development |

3. **Redeploy** — Settings → Deployments → click the three dots → Redeploy

### Step 4 — Visit your live URL

Vercel gives you a URL like `st1-revops.vercel.app`. Share it with the team.

---

## Local Development

```bash
# Install dependencies
npm install

# Copy environment template
cp .env.example .env.local

# Edit .env.local and add your Anthropic key:
# VITE_ANTHROPIC_KEY=sk-ant-...

# Start dev server (opens at http://localhost:3000)
npm run dev
```

**Note:** In local dev, API calls go to `https://api.anthropic.com` directly using `VITE_ANTHROPIC_KEY`.
In production on Vercel, they go through `/api/claude` (the serverless proxy) using `ANTHROPIC_KEY`.
The `src/lib/api.js` handles this automatically.

---

## Custom Domain (optional)

1. Vercel → Project → Settings → Domains
2. Add `revops.st1sports.com`
3. Add a CNAME record in your DNS (Route 53 if on AWS):
   - Name: `revops`
   - Value: `cname.vercel-dns.com`
4. Vercel auto-provisions SSL

---

## App URLs

| URL | What it is |
|-----|-----------|
| `/` | Main app — Daily Briefing, Deals, RFPs, Invoices, Reorder Engine, Prospecting, Marketing, Competitors, AI Agent |
| `/rfp` | RFP Automation Tool — upload PDF bids, auto-price, export |
| `/prices` | Price List Manager — supplier costs, margin alerts |
| `/expansion` | State Expansion Playbook generator |
| `/integrations` | Slack, Zoho Books, Zoho CRM, Shopify |

---

## Team Logins

| User | PIN | Role |
|------|-----|------|
| Matt Stone | 1234 | Owner — sees all deals, all invoices |
| Alex Rivera | 2345 | Rep — sees own deals only |
| Jordan Wells | 3456 | Rep — sees own deals only |

---

## Connecting Integrations

### Zoho Books + CRM
1. Go to [api-console.zoho.com](https://api-console.zoho.com)
2. Click **Self Client** → **Create**
3. Scope: `ZohoBooks.invoices.ALL,ZohoCRM.modules.Contacts.ALL`
4. Click **Generate Code** — copy the token
5. In the app: **Integrations** tab → paste token + your Org ID
6. Org ID: Zoho Books → Settings → Organization Profile

Tokens expire after 60 minutes with Self Client. For production-grade, set up a
Server-based OAuth app with refresh tokens — see [Zoho OAuth docs](https://www.zoho.com/accounts/protocol/oauth.html).

### Shopify
1. Shopify admin → Settings → **Apps and sales channels** → **Develop apps** → create an app
2. Configure Admin API scopes: read/write access to Products and Orders → install the app
3. Copy the **Admin API access token**
4. Add to Vercel env vars: `SHOPIFY_STORE_DOMAIN` (e.g. `your-store.myshopify.com`) and `SHOPIFY_ACCESS_TOKEN`
5. In the app: **Integrations** → Shopify tab → **Test Connection** (credentials live in Vercel, never in the browser or app UI)

### Slack
Already connected via MCP — no configuration needed.
Channel: **#all-st1-sports** (`C09F64RK0MN`)

---

## Data Persistence

All data (deals, invoices, RFPs, reorders, contacts) is stored in browser `localStorage`
under the key `st1_revops_v2`. It persists across browser sessions on the same device.

**To back up:** Settings tab → Export Backup (downloads JSON)
**To restore:** Currently manual — import coming in a future update
**To reset:** Settings tab → Reset to Demo

Each team member's browser stores their own copy. For shared real-time data across
all three users, the next step is connecting to Zoho CRM as the source of truth —
deals and contacts sync bi-directionally.

---

## Project Structure

```
st1-revops/
├── api/
│   └── claude.js          ← Vercel edge function (API key proxy)
├── public/
│   ├── manifest.json      ← PWA manifest (Add to Home Screen)
│   └── favicon.svg
├── src/
│   ├── App.jsx            ← Router — all routes defined here
│   ├── main.jsx           ← React entry point
│   ├── lib/
│   │   └── api.js         ← Central AI + Zoho clients
│   └── pages/
│       ├── RevOps.jsx     ← Main unified app shell (Daily Briefing, Deals, etc.)
│       ├── RFPTool.jsx    ← RFP Automation (PDF upload, auto-price, export)
│       ├── PriceTool.jsx  ← Price List Manager
│       ├── Expansion.jsx  ← State Expansion Playbook
│       └── Integrations.jsx ← Slack, Zoho, Shopify hub
├── index.html             ← Entry HTML with PWA meta tags
├── vite.config.js
├── vercel.json            ← Vercel routing + headers config
└── package.json
```

---

## Deploying Updates

Every `git push` to `main` triggers an automatic Vercel redeploy.

```bash
# Make changes, then:
git add .
git commit -m "Update deal stages / add new feature"
git push
```

Vercel deploys in ~30 seconds. Zero downtime.

---

## Adding to Home Screen (iPhone / Android)

1. Open the live URL in Safari (iPhone) or Chrome (Android)
2. **Share → Add to Home Screen** (iPhone) or **Menu → Add to Home Screen** (Android)
3. The app opens full-screen, no browser chrome — looks and feels native

---

## Anthropic API Costs (estimated)

| Usage level | Monthly cost |
|-------------|-------------|
| Light (5–10 AI requests/day) | ~$5–15 |
| Medium (20–40 requests/day) | ~$20–50 |
| Heavy (100+ requests/day) | ~$80–150 |

Monitor at [console.anthropic.com/usage](https://console.anthropic.com/usage).