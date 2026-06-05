import { NextRequest, NextResponse } from 'next/server'
import { neon } from '@neondatabase/serverless'

const sql = neon(process.env.DATABASE_URL!)

interface Memo {
  id: string
  date: string
  time: string
  text: string
  audioUrl: string
}

export async function GET() {
  try {
    const rows = await sql`
      SELECT id, date, time, text FROM memos
      ORDER BY created_at DESC
    `
    const memos: Memo[] = rows.map((r) => ({
      id: r.id,
      date: r.date,
      time: r.time,
      text: r.text,
      audioUrl: '',
    }))
    return NextResponse.json(memos)
  } catch (error) {
    console.error('Failed to get memos:', error)
    return NextResponse.json([], { status: 200 })
  }
}

export async function POST(request: NextRequest) {
  try {
    const formData = await request.formData()
    const textFromClient = formData.get('text') as string
    const clientId = formData.get('id') as string | null
    const clientDate = formData.get('date') as string | null
    const clientTime = formData.get('time') as string | null

    const now = new Date()
    const id = clientId || `memo_${Date.now()}`
    const date = clientDate || now.toISOString().split('T')[0]
    const time = clientTime || now.toTimeString().slice(0, 5)
    const text = textFromClient || '[文字起こし中...]'

    await sql`
      INSERT INTO memos (id, date, time, text, created_at)
      VALUES (${id}, ${date}, ${time}, ${text}, ${Date.now()})
      ON CONFLICT (id) DO NOTHING
    `

    const memo: Memo = { id, date, time, text, audioUrl: '' }
    return NextResponse.json(memo, { status: 201 })
  } catch (error) {
    console.error('Failed to save memo:', error)
    return NextResponse.json({ error: 'Failed to save memo' }, { status: 500 })
  }
}
