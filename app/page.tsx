'use client'

import { useState, useEffect, useRef } from 'react'
import { useIndexedDB } from '@/lib/useIndexedDB'

interface VoiceMemo {
  id: string
  date: string
  time: string
  text: string
  audioUrl: string
}

export default function Home() {
  const db = useIndexedDB()
  const [memos, setMemos] = useState<VoiceMemo[]>([])
  const [isRecording, setIsRecording] = useState(false)
  const [isTranscribing, setIsTranscribing] = useState(false)
  const [recordingSource, setRecordingSource] = useState<string>('')
  const [showSourceSelect, setShowSourceSelect] = useState(true)
  const [searchQuery, setSearchQuery] = useState('')
  const [searchType, setSearchType] = useState<'date' | 'keyword' | 'text'>('text')
  const [isOnline, setIsOnline] = useState(true)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editText, setEditText] = useState('')
  const [importProgress, setImportProgress] = useState<{ current: number; total: number } | null>(null)
  const mediaRecorderRef = useRef<MediaRecorder | null>(null)
  const audioChunksRef = useRef<Blob[]>([])
  const fileInputRef = useRef<HTMLInputElement | null>(null)

  useEffect(() => {
    loadMemos()
    const saved = localStorage.getItem('recordingSource')
    if (saved) {
      setRecordingSource(saved)
      setShowSourceSelect(false)
    }

    const handleOnline = () => {
      setIsOnline(true)
      setTimeout(() => syncPendingMemos(), 500)
    }
    const handleOffline = () => setIsOnline(false)

    window.addEventListener('online', handleOnline)
    window.addEventListener('offline', handleOffline)
    setIsOnline(navigator.onLine)

    syncPendingMemos()
  }, [db.isReady])

  const loadMemos = async () => {
    try {
      if (!navigator.onLine) {
        const localMemos = await db.getMemos()
        setMemos(
          localMemos.map((m) => ({
            id: m.id,
            date: m.date,
            time: m.time,
            text: m.text,
            audioUrl: '',
          }))
        )
        return
      }

      const response = await fetch('/api/memos')
      const data = await response.json()
      setMemos(data)
    } catch (error) {
      console.error('Failed to load memos:', error)
      const localMemos = await db.getMemos()
      setMemos(
        localMemos.map((m) => ({
          id: m.id,
          date: m.date,
          time: m.time,
          text: m.text,
          audioUrl: '',
        }))
      )
    }
  }

  const syncPendingMemos = async () => {
    if (!navigator.onLine || !db.isReady) return

    const unsynced = await db.getUnsyncedMemos()
    for (const memo of unsynced) {
      try {
        const formData = new FormData()
        formData.append('audio', memo.audioBlob)
        formData.append('text', memo.text)

        const response = await fetch('/api/memos', {
          method: 'POST',
          body: formData,
        })

        if (response.ok) {
          await db.markAsSynced(memo.id)
        }
      } catch (error) {
        console.error('Failed to sync memo:', memo.id, error)
      }
    }
    loadMemos()
  }

  const deleteMemo = async (id: string) => {
    if (!confirm('このメモを削除しますか？')) return

    try {
      const response = await fetch(`/api/memos/${id}`, {
        method: 'DELETE',
      })

      if (response.ok) {
        loadMemos()
      }
    } catch (error) {
      console.error('Failed to delete memo:', error)
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

  const resampleAudio = async (audioBlob: Blob): Promise<Blob> => {
    const audioContext = new (window.AudioContext || (window as any).webkitAudioContext)()
    const arrayBuffer = await audioBlob.arrayBuffer()
    const audioBuffer = await audioContext.decodeAudioData(arrayBuffer)

    const offlineContext = new OfflineAudioContext(
      1,
      audioBuffer.duration * 16000,
      16000
    )
    const source = offlineContext.createBufferSource()
    source.buffer = audioBuffer
    source.connect(offlineContext.destination)
    source.start(0)

    const resampledBuffer = await offlineContext.startRendering()
    const wav = encodeWAV(resampledBuffer)
    return new Blob([wav], { type: 'audio/wav' })
  }

  const encodeWAV = (audioBuffer: AudioBuffer): ArrayBuffer => {
    const channelData = audioBuffer.getChannelData(0)
    const sampleRate = audioBuffer.sampleRate
    const length = channelData.length

    const buffer = new ArrayBuffer(44 + length * 2)
    const view = new DataView(buffer)

    const writeString = (offset: number, string: string) => {
      for (let i = 0; i < string.length; i++) {
        view.setUint8(offset + i, string.charCodeAt(i))
      }
    }

    writeString(0, 'RIFF')
    view.setUint32(4, 36 + length * 2, true)
    writeString(8, 'WAVE')
    writeString(12, 'fmt ')
    view.setUint32(16, 16, true)
    view.setUint16(20, 1, true)
    view.setUint16(22, 1, true)
    view.setUint32(24, sampleRate, true)
    view.setUint32(28, sampleRate * 2, true)
    view.setUint16(32, 2, true)
    view.setUint16(34, 16, true)
    writeString(36, 'data')
    view.setUint32(40, length * 2, true)

    let offset = 44
    for (let i = 0; i < length; i++) {
      view.setInt16(offset, Math.max(-1, Math.min(1, channelData[i])) * 0x7fff, true)
      offset += 2
    }

    return buffer
  }

  const transcribeAndSave = async (audioBlob: Blob) => {
    setIsTranscribing(true)

    try {
      const resampledBlob = await resampleAudio(audioBlob)
      const formData = new FormData()
      formData.append('audio', resampledBlob)

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
    const now = new Date()
    const date = now.toISOString().split('T')[0]
    const time = now.toTimeString().slice(0, 5)
    const id = `memo_${Date.now()}`

    if (!navigator.onLine) {
      await db.saveMemo({
        id,
        date,
        time,
        text,
        audioBlob,
        synced: false,
        createdAt: Date.now(),
      })
      loadMemos()
      return
    }

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
      await db.saveMemo({
        id,
        date,
        time,
        text,
        audioBlob,
        synced: false,
        createdAt: Date.now(),
      })
      loadMemos()
    }
  }

  const importPixelWatchFiles = async (files: FileList) => {
    const audioFiles = Array.from(files).filter((f) => f.type.startsWith('audio/') || f.name.endsWith('.m4a'))
    if (audioFiles.length === 0) return

    setImportProgress({ current: 0, total: audioFiles.length })

    for (let i = 0; i < audioFiles.length; i++) {
      setImportProgress({ current: i + 1, total: audioFiles.length })
      const file = audioFiles[i]

      // ファイルの録音日時をIDに使い重複を防ぐ
      const recorded = new Date(file.lastModified)
      const id = `memo_pw_${file.lastModified}`
      const date = recorded.toISOString().split('T')[0]
      const time = recorded.toTimeString().slice(0, 5)

      try {
        const resampledBlob = await resampleAudio(file)
        const formData = new FormData()
        formData.append('audio', resampledBlob)

        const response = await fetch('/api/transcribe', { method: 'POST', body: formData })
        const data = await response.json()
        const text = data.text || '[文字起こしに失敗しました]'

        const saveResponse = await fetch('/api/memos', {
          method: 'POST',
          body: (() => { const fd = new FormData(); fd.append('id', id); fd.append('audio', file); fd.append('text', text); fd.append('date', date); fd.append('time', time); return fd })(),
        })
        if (!saveResponse.ok && saveResponse.status !== 409) {
          console.error('Failed to save:', file.name)
        }
      } catch (error) {
        console.error('Failed to import file:', file.name, error)
      }
    }

    setImportProgress(null)
    if (fileInputRef.current) fileInputRef.current.value = ''
    loadMemos()
  }

  const startEditing = (memo: VoiceMemo) => {
    setEditingId(memo.id)
    setEditText(memo.text)
  }

  const cancelEditing = () => {
    setEditingId(null)
    setEditText('')
  }

  const saveMemoText = async (id: string) => {
    try {
      const response = await fetch(`/api/memos/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: editText }),
      })
      if (response.ok) {
        setMemos((prev) => prev.map((m) => (m.id === id ? { ...m, text: editText } : m)))
        cancelEditing()
      }
    } catch (error) {
      console.error('Failed to update memo:', error)
    }
  }

  const exportToCSV = () => {
    const rows = filterMemos().map((m) => [
      m.date,
      m.time,
      `"${m.text.replace(/"/g, '""')}"`,
    ])
    const csv = [['日付', '時刻', 'テキスト'], ...rows].map((r) => r.join(',')).join('\n')
    const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8;' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `koememo_${new Date().toISOString().slice(0, 10)}.csv`
    a.click()
    URL.revokeObjectURL(url)
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
          <h1 className="text-3xl font-bold mb-2 text-center text-gray-800">koememo2</h1>
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
            <h1 className="text-2xl font-bold text-gray-800">koememo2</h1>
            <div className="flex gap-3 items-center">
              {!isOnline && (
                <span className="text-xs px-2 py-1 bg-yellow-100 text-yellow-800 rounded">
                  オフラインモード
                </span>
              )}
              {isOnline && (
                <button
                  onClick={syncPendingMemos}
                  className="text-xs px-2 py-1 bg-blue-100 text-blue-700 hover:bg-blue-200 rounded transition"
                >
                  同期
                </button>
              )}
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
          </div>

          {/* Recording / Import UI */}
          {recordingSource === 'Pixel Watch' ? (
            <div>
              <input
                ref={fileInputRef}
                type="file"
                // @ts-expect-error webkitdirectory is not in standard types
                webkitdirectory=""
                className="hidden"
                onChange={(e) => e.target.files && importPixelWatchFiles(e.target.files)}
              />
              <button
                onClick={() => fileInputRef.current?.click()}
                disabled={!!importProgress}
                className={`w-full py-4 px-6 rounded-lg font-bold text-white text-lg transition ${
                  importProgress ? 'bg-gray-400 cursor-not-allowed' : 'bg-green-500 hover:bg-green-600'
                }`}
              >
                {importProgress
                  ? `⏳ 処理中... ${importProgress.current} / ${importProgress.total}`
                  : '📂 録音ファイルを選択（複数可）'}
              </button>
              {importProgress && (
                <div className="mt-3">
                  <div className="w-full bg-gray-200 rounded-full h-2">
                    <div
                      className="bg-green-500 h-2 rounded-full transition-all"
                      style={{ width: `${(importProgress.current / importProgress.total) * 100}%` }}
                    />
                  </div>
                </div>
              )}
            </div>
          ) : (
            <div>
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
          <div className="flex justify-end">
            <button
              onClick={exportToCSV}
              disabled={filteredMemos.length === 0}
              className="text-xs px-3 py-1 bg-green-500 hover:bg-green-600 disabled:bg-gray-300 disabled:cursor-not-allowed text-white rounded transition"
            >
              CSV出力 ({filteredMemos.length}件)
            </button>
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
                className="bg-white rounded-lg shadow-sm p-4 hover:shadow-md transition"
              >
                <p className="text-sm font-semibold text-gray-600 mb-1">
                  {memo.date} {memo.time}
                </p>
                {editingId === memo.id ? (
                  <div>
                    <textarea
                      value={editText}
                      onChange={(e) => setEditText(e.target.value)}
                      className="w-full border border-blue-400 rounded-lg p-2 text-gray-800 focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none"
                      rows={4}
                      autoFocus
                    />
                    <div className="flex gap-2 mt-2 justify-end">
                      <button
                        onClick={cancelEditing}
                        className="text-xs px-3 py-1 text-gray-600 hover:text-gray-900 border border-gray-300 rounded transition"
                      >
                        キャンセル
                      </button>
                      <button
                        onClick={() => saveMemoText(memo.id)}
                        className="text-xs px-3 py-1 bg-blue-500 hover:bg-blue-600 text-white rounded transition"
                      >
                        保存
                      </button>
                    </div>
                  </div>
                ) : (
                  <div className="flex justify-between items-start gap-3">
                    <p
                      className="text-gray-800 flex-1 cursor-pointer hover:bg-gray-50 rounded px-1 -mx-1"
                      onClick={() => startEditing(memo)}
                    >
                      {memo.text}
                    </p>
                    <div className="flex gap-1 flex-shrink-0">
                      <button
                        onClick={() => startEditing(memo)}
                        className="text-xs px-2 py-1 text-blue-600 hover:text-blue-800 hover:bg-blue-50 rounded transition"
                      >
                        編集
                      </button>
                      <button
                        onClick={() => deleteMemo(memo.id)}
                        className="text-xs px-2 py-1 text-red-600 hover:text-red-800 hover:bg-red-50 rounded transition"
                      >
                        削除
                      </button>
                    </div>
                  </div>
                )}
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  )
}
