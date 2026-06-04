'use client'

import { useState, useEffect, useRef } from 'react'

interface VoiceMemo {
  id: string
  date: string
  time: string
  text: string
  audioUrl: string
}

export default function Home() {
  const [memos, setMemos] = useState<VoiceMemo[]>([])
  const [isRecording, setIsRecording] = useState(false)
  const [isTranscribing, setIsTranscribing] = useState(false)
  const [recordingSource, setRecordingSource] = useState<string>('')
  const [showSourceSelect, setShowSourceSelect] = useState(true)
  const [searchQuery, setSearchQuery] = useState('')
  const [searchType, setSearchType] = useState<'date' | 'keyword' | 'text'>('text')
  const mediaRecorderRef = useRef<MediaRecorder | null>(null)
  const audioChunksRef = useRef<Blob[]>([])

  useEffect(() => {
    loadMemos()
    const saved = localStorage.getItem('recordingSource')
    if (saved) {
      setRecordingSource(saved)
      setShowSourceSelect(false)
    }
  }, [])

  const loadMemos = async () => {
    try {
      const response = await fetch('/api/memos')
      const data = await response.json()
      setMemos(data)
    } catch (error) {
      console.error('Failed to load memos:', error)
    }
  }

  const selectSource = (source: string) => {
    setRecordingSource(source)
    localStorage.setItem('recordingSource', source)
    setShowSourceSelect(false)
  }

  const startRecording = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      const mediaRecorder = new MediaRecorder(stream)
      audioChunksRef.current = []

      mediaRecorder.ondataavailable = (event) => {
        audioChunksRef.current.push(event.data)
      }

      mediaRecorder.onstop = async () => {
        const audioBlob = new Blob(audioChunksRef.current, { type: 'audio/wav' })
        await transcribeAndSave(audioBlob)
        stream.getTracks().forEach((track) => track.stop())
      }

      mediaRecorder.start()
      mediaRecorderRef.current = mediaRecorder
      setIsRecording(true)
    } catch (error) {
      console.error('Failed to start recording:', error)
      alert('マイクへのアクセスが許可されていません')
    }
  }

  const stopRecording = () => {
    if (mediaRecorderRef.current) {
      mediaRecorderRef.current.stop()
      setIsRecording(false)
    }
  }

  const transcribeAndSave = async (audioBlob: Blob) => {
    setIsTranscribing(true)

    try {
      const formData = new FormData()
      formData.append('audio', audioBlob)

      const response = await fetch('/api/transcribe', {
        method: 'POST',
        body: formData,
      })

      const data = await response.json()
      const text = data.text || '[文字起こしに失敗しました]'

      await saveRecording(audioBlob, text)
    } catch (error) {
      console.error('Transcription error:', error)
      await saveRecording(audioBlob, '[文字起こしエラー]')
    } finally {
      setIsTranscribing(false)
    }
  }

  const saveRecording = async (audioBlob: Blob, text: string) => {
    const formData = new FormData()
    formData.append('audio', audioBlob)
    formData.append('text', text)

    try {
      const response = await fetch('/api/memos', {
        method: 'POST',
        body: formData,
      })

      if (response.ok) {
        loadMemos()
      }
    } catch (error) {
      console.error('Failed to save recording:', error)
    }
  }

  const filterMemos = () => {
    if (!searchQuery) return memos

    return memos.filter((memo) => {
      switch (searchType) {
        case 'date':
          return memo.date.includes(searchQuery)
        case 'keyword':
          return memo.text.includes(searchQuery)
        case 'text':
          return memo.text.includes(searchQuery)
        default:
          return true
      }
    })
  }

  if (showSourceSelect) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-blue-50 to-indigo-100 p-4">
        <div className="bg-white rounded-lg shadow-xl p-8 max-w-md w-full">
          <h1 className="text-3xl font-bold mb-2 text-center text-gray-800">声メモ2</h1>
          <p className="text-center text-gray-600 mb-8">思いついたことを即座に音声で記録</p>

          <div className="space-y-3">
            <p className="text-sm font-semibold text-gray-700 mb-4">録音元を選択してください</p>
            <button
              onClick={() => selectSource('スマホ標準レコーダー')}
              className="w-full px-4 py-3 bg-blue-500 hover:bg-blue-600 text-white rounded-lg font-medium transition"
            >
              スマホ標準レコーダー
            </button>
            <button
              onClick={() => selectSource('Pixel Watch')}
              className="w-full px-4 py-3 bg-green-500 hover:bg-green-600 text-white rounded-lg font-medium transition"
            >
              Pixel Watch
            </button>
            <button
              onClick={() => selectSource('その他対応録音アプリ')}
              className="w-full px-4 py-3 bg-purple-500 hover:bg-purple-600 text-white rounded-lg font-medium transition"
            >
              その他対応録音アプリ
            </button>
          </div>
        </div>
      </div>
    )
  }

  const filteredMemos = filterMemos()

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="max-w-2xl mx-auto p-4">
        {/* Header */}
        <div className="bg-white rounded-lg shadow-sm p-6 mb-6">
          <div className="flex items-center justify-between mb-4">
            <h1 className="text-2xl font-bold text-gray-800">声メモ2</h1>
            <button
              onClick={() => {
                localStorage.removeItem('recordingSource')
                setShowSourceSelect(true)
              }}
              className="text-sm text-gray-600 hover:text-gray-900"
            >
              録音元変更: {recordingSource}
            </button>
          </div>

          {/* Recording Button */}
          <button
            onClick={isRecording ? stopRecording : startRecording}
            disabled={isTranscribing}
            className={`w-full py-4 px-6 rounded-lg font-bold text-white text-lg transition ${
              isRecording
                ? 'bg-red-500 hover:bg-red-600 animate-pulse'
                : isTranscribing
                  ? 'bg-gray-400 cursor-not-allowed'
                  : 'bg-blue-500 hover:bg-blue-600'
            }`}
          >
            {isTranscribing
              ? '⏳ 文字起こし中...'
              : isRecording
                ? '● 録音中...をタップして終了'
                : '🎙️ 録音を開始'}
          </button>

          {isTranscribing && (
            <p className="text-sm text-gray-500 text-center mt-3">
              音声を再生して文字起こしを処理しています...
            </p>
          )}
        </div>

        {/* Search Section */}
        <div className="bg-white rounded-lg shadow-sm p-6 mb-6">
          <div className="flex gap-2 mb-4">
            <select
              value={searchType}
              onChange={(e) => setSearchType(e.target.value as any)}
              className="px-3 py-2 border border-gray-300 rounded-lg text-sm"
            >
              <option value="text">全文検索</option>
              <option value="date">日付検索</option>
              <option value="keyword">キーワード検索</option>
            </select>
            <input
              type="text"
              placeholder={
                searchType === 'date'
                  ? '例: 2025-06-04'
                  : searchType === 'keyword'
                    ? 'キーワードを入力'
                    : 'テキストを検索'
              }
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="flex-1 px-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
            {searchQuery && (
              <button
                onClick={() => setSearchQuery('')}
                className="px-4 py-2 text-gray-600 hover:text-gray-900"
              >
                ✕
              </button>
            )}
          </div>
        </div>

        {/* Memos List */}
        <div className="space-y-3">
          {filteredMemos.length === 0 ? (
            <div className="bg-white rounded-lg shadow-sm p-8 text-center text-gray-500">
              {memos.length === 0
                ? '音声メモはまだありません。録音を開始してください。'
                : '検索結果がありません。'}
            </div>
          ) : (
            filteredMemos.map((memo) => (
              <div
                key={memo.id}
                className="bg-white rounded-lg shadow-sm p-4 hover:shadow-md transition cursor-pointer"
              >
                <div className="flex justify-between items-start mb-2">
                  <div>
                    <p className="text-sm font-semibold text-gray-600">
                      {memo.date} {memo.time}
                    </p>
                  </div>
                </div>
                <p className="text-gray-800 line-clamp-2">{memo.text}</p>
                {memo.audioUrl && (
                  <audio
                    controls
                    className="w-full mt-3 h-8"
                    src={memo.audioUrl}
                  />
                )}
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  )
}
