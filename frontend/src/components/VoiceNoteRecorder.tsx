import { t as translate, useI18n } from '../lib/i18n'
import { useCallback, useEffect, useRef, useState } from 'react'

type Clip = { blob: Blob; url: string; seconds: number | null; fileName?: string }

type Props = {
  disabled?: boolean
  onSend: (clip: { blob: Blob; seconds: number | null; fileName?: string }) => void
}

/** Stop automatically so a forgotten recording cannot run (and cost) for minutes. */
const MAX_RECORD_SECONDS = 120

// Chrome/Edge record webm, Firefox ogg, Safari mp4 — all are accepted by the backend.
const RECORDER_TYPES = ['audio/webm;codecs=opus', 'audio/webm', 'audio/ogg;codecs=opus', 'audio/mp4']

function pickRecorderType() {
  const supported = typeof MediaRecorder !== 'undefined' ? MediaRecorder.isTypeSupported?.bind(MediaRecorder) : null
  return supported ? RECORDER_TYPES.find((type) => supported(type)) : undefined
}

function clock(seconds: number) {
  return `${Math.floor(seconds / 60)}:${String(Math.floor(seconds % 60)).padStart(2, '0')}`
}

/**
 * Record from the microphone or attach an audio file, preview it, then send.
 * It only produces audio — what happens to it is up to the caller.
 */
export default function VoiceNoteRecorder({ disabled, onSend }: Props) {
  useI18n()
  const [recording, setRecording] = useState(false)
  const [elapsed, setElapsed] = useState(0)
  const [clip, setClip] = useState<Clip | null>(null)
  const [error, setError] = useState<string | null>(null)

  const recorderRef = useRef<MediaRecorder | null>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const chunksRef = useRef<Blob[]>([])
  const startedAtRef = useRef(0)
  const timerRef = useRef<number | null>(null)
  const fileInputRef = useRef<HTMLInputElement | null>(null)

  const releaseMic = useCallback(() => {
    if (timerRef.current) window.clearInterval(timerRef.current)
    timerRef.current = null
    streamRef.current?.getTracks().forEach((track) => track.stop())
    streamRef.current = null
  }, [])

  // Never leave the microphone open or leak an object URL.
  useEffect(() => releaseMic, [releaseMic])
  useEffect(() => {
    const url = clip?.url
    return () => {
      if (url) URL.revokeObjectURL(url)
    }
  }, [clip?.url])

  const stop = useCallback(() => {
    const recorder = recorderRef.current
    if (recorder && recorder.state !== 'inactive') recorder.stop()
  }, [])

  const start = async () => {
    setError(null)
    if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === 'undefined') {
      setError('Recording is not supported in this browser. Attach an audio file instead.')
      return
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      streamRef.current = stream
      const mimeType = pickRecorderType()
      const recorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined)
      recorderRef.current = recorder
      chunksRef.current = []

      recorder.ondataavailable = (event: BlobEvent) => {
        if (event.data?.size) chunksRef.current.push(event.data)
      }
      recorder.onstop = () => {
        const seconds = (Date.now() - startedAtRef.current) / 1000
        releaseMic()
        setRecording(false)
        const blob = new Blob(chunksRef.current, { type: recorder.mimeType || mimeType || 'audio/webm' })
        if (!blob.size) {
          setError('Nothing was recorded. Check your microphone and try again.')
          return
        }
        setClip({ blob, url: URL.createObjectURL(blob), seconds })
      }

      startedAtRef.current = Date.now()
      setElapsed(0)
      setClip(null)
      recorder.start()
      setRecording(true)
      timerRef.current = window.setInterval(() => {
        const seconds = (Date.now() - startedAtRef.current) / 1000
        setElapsed(seconds)
        if (seconds >= MAX_RECORD_SECONDS) stop()
      }, 250)
    } catch (err) {
      releaseMic()
      const denied = err instanceof DOMException && (err.name === 'NotAllowedError' || err.name === 'SecurityError')
      setError(
        denied
          ? 'Microphone access was blocked. Allow it in the browser address bar, or attach an audio file.'
          : 'Could not start recording. Attach an audio file instead.',
      )
    }
  }

  const attach = (file: File | undefined) => {
    if (!file) return
    setError(null)
    if (!file.type.startsWith('audio/') && !/\.(ogg|opus|webm|mp3|m4a|mp4|wav)$/i.test(file.name)) {
      setError('Choose an audio file (ogg, webm, mp3, m4a or wav).')
      return
    }
    const url = URL.createObjectURL(file)
    setClip({ blob: file, url, seconds: null, fileName: file.name })

    // Read the length so over-long files are caught like real voice notes.
    const probe = new Audio()
    probe.preload = 'metadata'
    probe.onloadedmetadata = () => {
      if (Number.isFinite(probe.duration)) {
        setClip((current) => (current?.url === url ? { ...current, seconds: probe.duration } : current))
      }
    }
    probe.src = url
  }

  const discard = () => {
    setClip(null)
    setError(null)
    if (fileInputRef.current) fileInputRef.current.value = ''
  }

  const send = () => {
    if (!clip) return
    onSend({ blob: clip.blob, seconds: clip.seconds, fileName: clip.fileName })
    discard()
  }

  return (
    <div className="grid gap-2">
      <div className="flex flex-wrap items-center gap-2">
        {recording ? (
          <button
            type="button"
            onClick={stop}
            className="inline-flex min-h-10 items-center gap-2 rounded-lg bg-red-600 px-3 py-2 text-sm font-semibold text-white hover:bg-red-700"
          >
            <span className="h-2 w-2 animate-pulse rounded-full bg-white" aria-hidden />
            {translate("Stop ·")}{' '}{clock(elapsed)}
          </button>
        ) : (
          <button
            type="button"
            disabled={disabled}
            onClick={() => void start()}
            className="inline-flex min-h-10 items-center gap-2 rounded-lg border border-shop-border bg-white px-3 py-2 text-sm font-medium hover:bg-shop-bg disabled:opacity-50"
          >
            {translate("🎤 Record voice note")}</button>
        )}

        <label
          className={`inline-flex min-h-10 cursor-pointer items-center rounded-lg border border-shop-border bg-white px-3 py-2 text-sm font-medium hover:bg-shop-bg ${
            disabled || recording ? 'pointer-events-none opacity-50' : ''
          }`}
        >
          {translate("Attach audio file")}<input
            ref={fileInputRef}
            type="file"
            accept="audio/*,.ogg,.opus,.webm,.mp3,.m4a,.mp4,.wav"
            className="sr-only"
            data-testid="voice-file-input"
            disabled={disabled || recording}
            onChange={(event) => attach(event.target.files?.[0])}
          />
        </label>
      </div>

      {clip && (
        <div className="grid gap-2 rounded-lg border border-shop-border bg-white p-3">
          <p className="text-xs text-shop-muted">
            {clip.fileName ? clip.fileName : translate('Recording')}
            {clip.seconds ? ` · ${clock(clip.seconds)}` : ''}{' '}{translate("— listen first, then send.")}</p>
          <audio controls src={clip.url} className="h-10 w-full" />
          <div className="flex gap-2">
            <button
              type="button"
              disabled={disabled}
              onClick={send}
              className="rounded-lg bg-shop-ink px-4 py-2 text-sm font-semibold text-white hover:bg-black disabled:opacity-50"
            >
              {translate("Send voice note")}</button>
            <button
              type="button"
              onClick={discard}
              className="rounded-lg border border-shop-border px-4 py-2 text-sm font-medium hover:bg-shop-bg"
            >
              {translate("Discard")}</button>
          </div>
        </div>
      )}

      {error && (
        <p role="alert" className="text-xs text-red-700">
          {translate(error)}
        </p>
      )}
    </div>
  )
}
