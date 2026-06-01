/**
 * Vercel Serverless Function: /api/claude
 *
 * Proxies requests to the Anthropic API.
 * Supports both regular and streaming (stream:true) responses.
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
  maxDuration: 120,
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

  const body = req.body || {}
  const isStream = body.stream === true

  // pdfs-2024-09-25 is a Claude 3.5-era beta — PDF support is GA in Claude 3.7+ and all 4.x models.
  // Including that beta with 4.x returns a 400. Only add it for 3.5 models.
  const model = body.model || ''
  const needsPdfBeta = model.includes('claude-3-5')
  const betaHeader = needsPdfBeta ? 'pdfs-2024-09-25' : undefined

  try {
    const upstream = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type':      'application/json',
        'x-api-key':         apiKey,
        'anthropic-version': '2023-06-01',
        ...(betaHeader ? { 'anthropic-beta': betaHeader } : {}),
      },
      body: JSON.stringify(body),
    })

    if (isStream) {
      // If Anthropic returned an error, read it as text and return as JSON so the client can surface it
      if (!upstream.ok) {
        const errText = await upstream.text()
        // Try to extract error message from SSE event or plain JSON
        let errMsg = `Anthropic ${upstream.status}`
        try {
          const line = errText.split('\n').find(l => l.startsWith('data:'))
          const parsed = JSON.parse(line ? line.slice(5) : errText)
          errMsg = parsed?.error?.message || parsed?.message || errMsg
        } catch {}
        return res.status(upstream.status).json({ error: errMsg })
      }

      // Forward SSE stream directly to client — keeps connection alive during long generations
      res.setHeader('Content-Type', 'text/event-stream')
      res.setHeader('Cache-Control', 'no-cache')
      res.setHeader('X-Accel-Buffering', 'no')
      res.status(upstream.status)

      if (!upstream.body) {
        res.end()
        return
      }

      const reader = upstream.body.getReader()
      try {
        while (true) {
          const { done, value } = await reader.read()
          if (done) break
          res.write(value)
        }
      } finally {
        res.end()
      }
      return
    }

    // Non-streaming path (existing behaviour)
    const text = await upstream.text()
    let data
    try {
      data = JSON.parse(text)
    } catch {
      return res.status(upstream.status).json({ error: `Anthropic returned non-JSON: ${text.slice(0, 300)}` })
    }
    return res.status(upstream.status).json(data)

  } catch (err) {
    return res.status(500).json({ error: err.message })
  }
}
