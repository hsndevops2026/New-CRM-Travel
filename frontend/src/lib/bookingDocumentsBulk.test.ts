import { afterEach, describe, expect, it, vi } from 'vitest'
import { uploadAndClassifyFiles } from './bookingDocuments'

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
}

afterEach(() => vi.unstubAllGlobals())

describe('uploadAndClassifyFiles', () => {
  it('uploads each file, asks the server to name it, and reports failures', async () => {
    const posts: Record<string, unknown>[] = []
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      if (url.includes('cloudinary-sign')) return json({ api_key: 'k', timestamp: 1, signature: 's', folder: 'f', cloud_name: 'demo' })
      if (url.includes('api.cloudinary.com')) {
        const file = (init?.body as FormData).get('file') as File
        if (file.name === 'bad.pdf') return json({ error: { message: 'nope' } }, 400)
        return json({ secure_url: `https://res.cloudinary.com/demo/${file.name}` })
      }
      const body = JSON.parse(String(init?.body || '{}'))
      posts.push(body)
      return json({ document: { id: String(posts.length), title: body.title } }, 201)
    }))

    const progress: number[] = []
    const files = [new File(['a'], 'ticket.pdf', { type: 'application/pdf' }), new File(['b'], 'bad.pdf', { type: 'application/pdf' }), new File(['c'], 'hotel.jpg', { type: 'image/jpeg' })]
    const r = await uploadAndClassifyFiles('L1', files, (done) => progress.push(done))

    expect(r.documents).toHaveLength(2)
    expect(r.failed).toEqual(['bad.pdf'])
    expect(posts.every((p) => p.classify === true)).toBe(true)
    expect(progress.at(-1)).toBe(3)
  })

  it('a typed title names a single file as typed', async () => {
    let posted: Record<string, unknown> = {}
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      if (url.includes('cloudinary-sign')) return json({ api_key: 'k', timestamp: 1, signature: 's', folder: 'f', cloud_name: 'demo' })
      if (url.includes('api.cloudinary.com')) return json({ secure_url: 'https://res.cloudinary.com/demo/x.pdf' })
      posted = JSON.parse(String(init?.body || '{}'))
      return json({ document: { id: '1', title: posted.title } }, 201)
    }))
    await uploadAndClassifyFiles('L1', [new File(['a'], 'x.pdf', { type: 'application/pdf' })], undefined, 'Visa copy')
    expect(posted.title).toBe('Visa copy')
    expect(posted.classify).toBe(false)
  })
})
