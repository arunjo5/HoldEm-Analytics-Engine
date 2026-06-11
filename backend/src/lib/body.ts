import { NextResponse } from 'next/server'

export async function readJsonBody(
  request: Request,
  maxBytes: number
): Promise<{ data?: any; error?: NextResponse }> {
  // reject on declared size before buffering the whole body
  const declared = Number(request.headers.get('content-length') || 0)
  if (declared > maxBytes) {
    return { error: NextResponse.json({ error: 'Payload too large' }, { status: 413 }) }
  }
  const raw = await request.text()
  if (Buffer.byteLength(raw, 'utf8') > maxBytes) {
    return { error: NextResponse.json({ error: 'Payload too large' }, { status: 413 }) }
  }
  try {
    return { data: raw ? JSON.parse(raw) : {} }
  } catch {
    return { error: NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }) }
  }
}

export function cleanName(s: string): string {
  let out = ''
  for (const ch of s.normalize('NFC')) {
    const c = ch.codePointAt(0) as number
    if (
      c < 0x20 ||
      (c >= 0x7f && c <= 0x9f) ||
      (c >= 0x200b && c <= 0x200f) ||
      (c >= 0x202a && c <= 0x202e) ||
      (c >= 0x2060 && c <= 0x2064) ||
      (c >= 0x2066 && c <= 0x2069) ||
      c === 0x061c ||
      c === 0xfeff
    ) {
      continue
    }
    out += ch
  }
  return out
}
