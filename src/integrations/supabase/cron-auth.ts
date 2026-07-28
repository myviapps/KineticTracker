import { getRequest } from '@tanstack/react-start/server'

function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false
  let diff = 0
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i)
  return diff === 0
}

export function requireCronSecret(): void {
  const secret = process.env.CRON_SECRET
  if (!secret) throw new Error('CRON_SECRET not configured')

  const request = getRequest()

  // Vercel Cron Jobs send x-vercel-cron: 1 (platform-authenticated)
  if (request.headers.get('x-vercel-cron') === '1') return

  const provided =
    request.headers.get('authorization')?.replace(/^Bearer\s+/i, '') ??
    request.headers.get('x-cron-secret') ??
    ''

  if (!provided || !safeEqual(secret, provided)) {
    throw new Error('Unauthorized: invalid or missing CRON_SECRET')
  }
}
