import { NextRequest, NextResponse } from 'next/server'
import { neon } from '@neondatabase/serverless'

const sql = neon(process.env.DATABASE_URL!)

const ensureTable = async () => {
  await sql`
    CREATE TABLE IF NOT EXISTS vocab_hints (
      word TEXT PRIMARY KEY,
      created_at BIGINT
    )
  `
}

export async function GET() {
  try {
    await ensureTable()
    const rows = await sql`SELECT word FROM vocab_hints ORDER BY created_at DESC LIMIT 100`
    return NextResponse.json(rows.map((r) => r.word))
  } catch (error) {
    console.error('Failed to get vocab hints:', error)
    return NextResponse.json([])
  }
}

export async function POST(request: NextRequest) {
  try {
    await ensureTable()
    const { words } = await request.json()
    for (const word of words as string[]) {
      await sql`
        INSERT INTO vocab_hints (word, created_at)
        VALUES (${word}, ${Date.now()})
        ON CONFLICT (word) DO NOTHING
      `
    }
    return NextResponse.json({ success: true })
  } catch (error) {
    console.error('Failed to save vocab hints:', error)
    return NextResponse.json({ error: 'Failed to save' }, { status: 500 })
  }
}
