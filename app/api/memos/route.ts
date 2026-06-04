import { NextRequest, NextResponse } from 'next/server'
import { promises as fs } from 'fs'
import path from 'path'

const MEMOS_DIR = path.join(process.cwd(), '.data/memos')

interface Memo {
  id: string
  date: string
  time: string
  text: string
  audioUrl: string
}

async function ensureDirExists() {
  try {
    await fs.mkdir(MEMOS_DIR, { recursive: true })
  } catch (error) {
    console.error('Failed to create directory:', error)
  }
}

async function getMemos(): Promise<Memo[]> {
  await ensureDirExists()

  try {
    const files = await fs.readdir(MEMOS_DIR)
    const memos: Memo[] = []

    for (const file of files) {
      if (file.endsWith('.json')) {
        const content = await fs.readFile(
          path.join(MEMOS_DIR, file),
          'utf-8'
        )
        memos.push(JSON.parse(content))
      }
    }

    return memos.sort(
      (a, b) => new Date(b.date + ' ' + b.time).getTime() - new Date(a.date + ' ' + a.time).getTime()
    )
  } catch (error) {
    console.error('Failed to read memos:', error)
    return []
  }
}

async function transcribeAudio(audioBuffer: Buffer): Promise<string> {
  const formData = new FormData()
  const audioBlob = new Blob([new Uint8Array(audioBuffer)], { type: 'audio/wav' })
  formData.append('file', audioBlob, 'audio.wav')
  formData.append('model', 'whisper-1')

  try {
    const response = await fetch('https://api.openai.com/v1/audio/transcriptions', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
      },
      body: formData,
    })

    if (!response.ok) {
      console.error('Transcription failed:', await response.text())
      return '[文字起こしに失敗しました]'
    }

    const result = await response.json()
    return result.text || '[空の音声ファイル]'
  } catch (error) {
    console.error('Transcription error:', error)
    return '[文字起こしエラー]'
  }
}

export async function GET() {
  const memos = await getMemos()
  return NextResponse.json(memos)
}

export async function POST(request: NextRequest) {
  try {
    await ensureDirExists()
    const formData = await request.formData()
    const audioFile = formData.get('audio') as File
    const textFromClient = formData.get('text') as string

    if (!audioFile) {
      return NextResponse.json(
        { error: 'No audio file provided' },
        { status: 400 }
      )
    }

    const now = new Date()
    const date = now.toISOString().split('T')[0]
    const time = now.toTimeString().slice(0, 5)
    const id = `memo_${Date.now()}`

    const audioBuffer = await audioFile.arrayBuffer()
    const audioPath = path.join(MEMOS_DIR, `${id}.wav`)
    await fs.writeFile(audioPath, Buffer.from(audioBuffer))

    let text = textFromClient || '[文字起こし中...]'
    if (!textFromClient && process.env.OPENAI_API_KEY) {
      text = await transcribeAudio(Buffer.from(audioBuffer))
    }

    const memo: Memo = {
      id,
      date,
      time,
      text,
      audioUrl: `/api/audio/${id}`,
    }

    await fs.writeFile(
      path.join(MEMOS_DIR, `${id}.json`),
      JSON.stringify(memo, null, 2)
    )

    return NextResponse.json(memo, { status: 201 })
  } catch (error) {
    console.error('Failed to save memo:', error)
    return NextResponse.json(
      { error: 'Failed to save memo' },
      { status: 500 }
    )
  }
}
