/**
 * Vercel Serverless Function: /api/claude
 *
 * Proxies requests to the Anthropic API.
 * Uses Node.js runtime (not edge) so it can handle large PDF payloads.
 * Body size limit is set to 20MB to support base64-encoded PDFs.
 *
 * The API key lives in Vercel environment variables — never in the browser.
 */

export const config = {
  api: {
    bodyParser: {
      sizeLimit: '20mb',
    },
  },
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type')

  if (req.method === 'OPTIONS') return res.status(200).end()
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })

  const apiKey = process.env.ANTHROPIC_KEY
  if (!apiKey) {
    return res.status(500).json({ error: 'ANTHROPIC_KEY not configured in Vercel environment variables' })
  }

  try {
    const upstream = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type':    'application/json',
        'x-api-key':       apiKey,
        'anthropic-version': '2023-06-01',
        'anthropic-beta':  'mcp-client-2025-04-04,pdfs-2024-09-25',
      },
      body: JSON.stringify(req.body),
    })

    const text = await upstream.text()

    let data
    try {
      data = JSON.parse(text)
    } catch {
      // Anthropic returned non-JSON — surface it clearly
      return res.status(upstream.status).json({ error: `Anthropic returned non-JSON: ${text.slice(0, 300)}` })
    }

    return res.status(upstream.status).json(data)

  } catch (err) {
    return res.status(500).json({ error: err.message })
  }
}
