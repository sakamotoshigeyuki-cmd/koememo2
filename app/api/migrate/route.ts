import { NextResponse } from 'next/server'
import { neon } from '@neondatabase/serverless'

const sql = neon(process.env.DATABASE_URL!)

export async function GET() {
  try {
    await sql`ALTER TABLE memos ADD COLUMN IF NOT EXISTS audio_url TEXT`
    return NextResponse.json({ ok: true, message: 'Migration complete' })
  } catch (error) {
    console.error('Migration failed:', error)
    return NextResponse.json({ error: 'Migration failed' }, { status: 500 })
  }
}
