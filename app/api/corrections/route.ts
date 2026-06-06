import { NextRequest, NextResponse } from 'next/server'
import { neon } from '@neondatabase/serverless'

const sql = neon(process.env.DATABASE_URL!)

const ensureTable = async () => {
  await sql`
    CREATE TABLE IF NOT EXISTS corrections (
      wrong TEXT PRIMARY KEY,
      correct TEXT NOT NULL,
      count INT DEFAULT 1
    )
  `
}

export async function GET() {
  try {
    await ensureTable()
    const rows = await sql`SELECT wrong, correct FROM corrections ORDER BY count DESC LIMIT 200`
    return NextResponse.json(rows)
  } catch (error) {
    console.error('Failed to get corrections:', error)
    return NextResponse.json([])
  }
}

export async function POST(request: NextRequest) {
  try {
    await ensureTable()
    const { corrections } = await request.json()
    for (const { wrong, correct } of corrections as { wrong: string; correct: string }[]) {
      await sql`
        INSERT INTO corrections (wrong, correct, count)
        VALUES (${wrong}, ${correct}, 1)
        ON CONFLICT (wrong) DO UPDATE SET correct = ${correct}, count = corrections.count + 1
      `
    }
    return NextResponse.json({ success: true })
  } catch (error) {
    console.error('Failed to save corrections:', error)
    return NextResponse.json({ error: 'Failed' }, { status: 500 })
  }
}
