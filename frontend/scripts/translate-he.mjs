/**
 * One-shot: build frontend/src/locales/he.json from en.json via OpenAI.
 * Run: node --env-file=../backend/.env scripts/translate-he.mjs
 * (or from repo root with OPENAI_API_KEY set)
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const en = JSON.parse(readFileSync(join(root, 'src/locales/en.json'), 'utf8'))
const key = process.env.OPENAI_API_KEY
if (!key) {
  console.error('OPENAI_API_KEY is required')
  process.exit(1)
}

const entries = Object.entries(en)
const batchSize = 80
const out = {}

async function translateBatch(batch) {
  const payload = Object.fromEntries(batch)
  const res = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: process.env.OPENAI_MODEL || 'gpt-4o-mini',
      temperature: 0.2,
      response_format: { type: 'json_object' },
      messages: [
        {
          role: 'system',
          content:
            'You translate a travel-agency CRM UI catalog from English to Hebrew. ' +
            'Return a JSON object with the SAME keys and Hebrew values. ' +
            'Keep placeholders like {value0}, {count}, {name} exactly. ' +
            'Keep brand names, currency codes, and technical tokens. Use natural Israeli Hebrew.',
        },
        { role: 'user', content: JSON.stringify(payload) },
      ],
    }),
  })
  if (!res.ok) {
    const text = await res.text()
    throw new Error(`OpenAI ${res.status}: ${text.slice(0, 400)}`)
  }
  const data = await res.json()
  const parsed = JSON.parse(data.choices[0].message.content)
  for (const [k] of batch) {
    out[k] = typeof parsed[k] === 'string' && parsed[k].trim() ? parsed[k] : en[k]
  }
}

for (let i = 0; i < entries.length; i += batchSize) {
  const batch = entries.slice(i, i + batchSize)
  process.stderr.write(`he.json ${i + 1}-${Math.min(i + batchSize, entries.length)} / ${entries.length}\n`)
  await translateBatch(batch)
}

writeFileSync(join(root, 'src/locales/he.json'), `${JSON.stringify(out, null, 2)}\n`)
console.log(`Wrote ${Object.keys(out).length} Hebrew strings`)
