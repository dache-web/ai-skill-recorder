import { useEffect, useRef, useState } from 'react'
import { createAnalysisPackage } from './analysis/analysisPackage'
import { analysisJson, downloadBlob, downloadJson } from './analysis/export'
import { FRAME_INTERVAL_OPTIONS } from './analysis/frameExtractor'
import type { AnalysisResult, RecordingSource } from './analysis/types'
import { formatElapsed, safeRecordingName, supportedMimeType, type RecorderStatus, userFacingCaptureError } from './recorder'

const stopTracks = (stream: MediaStream | null) => stream?.getTracks().forEach((track) => track.stop())

function App() {
  const [status, setStatus] = useState<RecorderStatus>('idle')
  const [elapsed, setElapsed] = useState(0)
  const [micActive, setMicActive] = useState(false)
  const [message, setMessage] = useState('録画データは外部へ送信されず、このブラウザ内だけで処理されます。')
  const [error, setError] = useState('')
  const [videoUrl, setVideoUrl] = useState('')
  const [recordingBlob, setRecordingBlob] = useState<Blob | null>(null)
  const [recordingName, setRecordingName] = useState('')
  const [recordedAt, setRecordedAt] = useState<string | null>(null)
  const [recordingHadAudio, setRecordingHadAudio] = useState(false)
  const [recordingDuration, setRecordingDuration] = useState(0)
  const [importedFile, setImportedFile] = useState<File | null>(null)
  const [frameInterval, setFrameInterval] = useState(5)
  const [analysisResult, setAnalysisResult] = useState<AnalysisResult | null>(null)
  const [analysisBusy, setAnalysisBusy] = useState(false)
  const [analysisMessage, setAnalysisMessage] = useState('')
  const recorderRef = useRef<MediaRecorder | null>(null)
  const displayStreamRef = useRef<MediaStream | null>(null)
  const micStreamRef = useRef<MediaStream | null>(null)
  const chunksRef = useRef<Blob[]>([])
  const startedAtRef = useRef(0)
  const isStoppingRef = useRef(false)
  const previewRef = useRef<HTMLVideoElement>(null)

  useEffect(() => {
    if (status !== 'recording') return
    const timer = window.setInterval(() => setElapsed(Math.floor((Date.now() - startedAtRef.current) / 1000)), 250)
    return () => window.clearInterval(timer)
  }, [status])

  useEffect(() => () => {
    stopTracks(displayStreamRef.current)
    stopTracks(micStreamRef.current)
    if (videoUrl) URL.revokeObjectURL(videoUrl)
  }, [videoUrl])

  useEffect(() => () => {
    analysisResult?.frames.forEach((frame) => URL.revokeObjectURL(frame.previewUrl))
  }, [analysisResult])

  const resetAnalysis = () => {
    analysisResult?.frames.forEach((frame) => URL.revokeObjectURL(frame.previewUrl))
    setAnalysisResult(null)
    setAnalysisMessage('')
  }

  const finishRecording = () => {
    if (isStoppingRef.current) return
    isStoppingRef.current = true
    setStatus('stopping')
    setMessage('録画を終了しています…')
    stopTracks(displayStreamRef.current)
    stopTracks(micStreamRef.current)
    const recorder = recorderRef.current
    if (recorder && recorder.state !== 'inactive') recorder.stop()
    else {
      setStatus('idle')
      isStoppingRef.current = false
    }
  }

  const startRecording = async () => {
    if (!navigator.mediaDevices?.getDisplayMedia || !window.MediaRecorder) {
      setError('このブラウザでは録画機能を利用できません。Windows版ChromeまたはEdgeの最新版を使用してください。')
      return
    }
    setError('')
    setMessage('共有する画面を選んでください。')
    setRecordingBlob(null)
    setRecordingName('')
    setRecordedAt(null)
    setRecordingHadAudio(false)
    setRecordingDuration(0)
    setImportedFile(null)
    resetAnalysis()
    if (videoUrl) { URL.revokeObjectURL(videoUrl); setVideoUrl('') }
    setStatus('requesting')
    setElapsed(0)
    isStoppingRef.current = false
    chunksRef.current = []

    try {
      const displayStream = await navigator.mediaDevices.getDisplayMedia({ video: { frameRate: { ideal: 15, max: 30 } }, audio: false })
      displayStreamRef.current = displayStream
      let micStream: MediaStream | null = null
      try {
        micStream = await navigator.mediaDevices.getUserMedia({
          audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true }, video: false,
        })
      } catch {
        setMessage('マイクを取得できなかったため、画面だけを録画しています。')
      }
      micStreamRef.current = micStream
      setMicActive(Boolean(micStream?.getAudioTracks().length))
      const recordingStream = new MediaStream([...displayStream.getVideoTracks(), ...(micStream?.getAudioTracks() ?? [])])
      const mimeType = supportedMimeType()
      const recorder = new MediaRecorder(recordingStream, mimeType ? { mimeType } : undefined)
      recorderRef.current = recorder
      recorder.addEventListener('dataavailable', (event) => { if (event.data.size > 0) chunksRef.current.push(event.data) })
      recorder.addEventListener('error', () => {
        setError('録画中にエラーが発生しました。録画を停止し、もう一度お試しください。')
        finishRecording()
      })
      recorder.addEventListener('stop', () => {
        const blob = new Blob(chunksRef.current, { type: recorder.mimeType || 'video/webm' })
        stopTracks(recordingStream)
        setMicActive(false)
        if (blob.size === 0) {
          setError('録画データが作成されませんでした。もう一度録画してください。')
          setStatus('idle')
        } else {
          setRecordingDuration(Math.max(0.001, (Date.now() - startedAtRef.current) / 1000))
          const url = URL.createObjectURL(blob)
          setRecordingBlob(blob)
          setVideoUrl(url)
          setStatus('preview')
          setMessage('録画が完了しました。再生してから、必要に応じてPCへ保存してください。')
        }
        isStoppingRef.current = false
      })
      displayStream.getVideoTracks()[0]?.addEventListener('ended', finishRecording, { once: true })
      startedAtRef.current = Date.now()
      setRecordedAt(new Date(startedAtRef.current).toISOString())
      setRecordingName(safeRecordingName(new Date(startedAtRef.current)))
      setRecordingHadAudio(Boolean(micStream?.getAudioTracks().length))
      recorder.start(1000)
      setStatus('recording')
      if (micStream) setMessage('画面とマイクを録画しています。')
    } catch (captureError) {
      stopTracks(displayStreamRef.current)
      stopTracks(micStreamRef.current)
      displayStreamRef.current = null
      micStreamRef.current = null
      setMicActive(false)
      setStatus('idle')
      setError(userFacingCaptureError(captureError))
      setMessage('録画は開始されていません。')
    }
  }

  const saveRecording = async () => {
    if (!recordingBlob) return
    setError('')
    const fileName = recordingName || safeRecordingName()
    try {
      if (window.showSaveFilePicker) {
        const handle = await window.showSaveFilePicker({ suggestedName: fileName, types: [{ description: 'WebM動画', accept: { 'video/webm': ['.webm'] } }] })
        const writable = await handle.createWritable()
        await writable.write(recordingBlob)
        await writable.close()
      } else {
        const link = document.createElement('a')
        link.href = videoUrl
        link.download = fileName
        link.click()
      }
      setMessage('録画をPCへ保存しました。録画ファイルをGitHubへ追加しないでください。')
    } catch (saveError) {
      if (saveError instanceof DOMException && saveError.name === 'AbortError') {
        setMessage('保存をキャンセルしました。録画はこの画面に残っているため、もう一度保存できます。')
        return
      }
      setError('録画を保存できませんでした。保存先の空き容量や書き込み権限を確認してください。')
    }
  }

  const restartPreview = async () => {
    if (!previewRef.current) return
    previewRef.current.currentTime = 0
    await previewRef.current.play()
  }

  const selectedAnalysisSource = (): RecordingSource | null => {
    if (importedFile) {
      return { blob: importedFile, fileName: importedFile.name, source: 'saved-webm', recordedAt: null, hasAudio: 'unknown' }
    }
    if (!recordingBlob) return null
    return {
      blob: recordingBlob,
      fileName: recordingName || safeRecordingName(),
      source: 'current-recording',
      recordedAt,
      hasAudio: recordingHadAudio,
      durationHintSeconds: recordingDuration,
    }
  }

  const prepareAnalysis = async () => {
    const source = selectedAnalysisSource()
    if (!source) return
    resetAnalysis()
    setAnalysisBusy(true)
    setAnalysisMessage('ブラウザ内で録画情報と静止画を生成しています…')
    try {
      const result = await createAnalysisPackage(source, frameInterval)
      setAnalysisResult(result)
      setAnalysisMessage(`解析準備が完了しました。元WebM、JSON、PNG ${result.frames.length}枚を確認・保存できます。`)
    } catch (analysisError) {
      setAnalysisMessage(analysisError instanceof Error ? analysisError.message : '解析準備に失敗しました。')
    } finally {
      setAnalysisBusy(false)
    }
  }

  const copyAnalysisJson = async () => {
    if (!analysisResult) return
    try {
      await navigator.clipboard.writeText(analysisJson(analysisResult.document))
      setAnalysisMessage('解析用JSONをクリップボードへコピーしました。')
    } catch {
      setAnalysisMessage('JSONをコピーできませんでした。「JSONを保存」を使用してください。')
    }
  }

  const saveOriginalWebM = () => {
    const source = selectedAnalysisSource()
    if (source) downloadBlob(source.blob, source.fileName)
  }

  const isBusy = status === 'requesting' || status === 'stopping'
  return (
    <main className="shell">
      <header className="hero">
        <div><p className="eyebrow">RECORDING PROTOTYPE · STEP 1</p><h1>AIスキルレコーダー</h1><p className="subtitle">画面と声を、そのまま業務の記録へ。</p></div>
        <div className={`status-pill status-${status}`} aria-live="polite"><span className="status-dot" />{status === 'recording' ? '録画中' : status === 'requesting' ? '許可待ち' : status === 'stopping' ? '終了処理中' : '待機中'}</div>
      </header>
      <section className="recorder-card" aria-labelledby="recorder-title">
        <div className="recorder-topline"><div><p className="section-number">01</p><h2 id="recorder-title">画面録画テスト</h2></div><div className="timer" aria-label={`録画経過時間 ${formatElapsed(elapsed)}`}>{formatElapsed(elapsed)}</div></div>
        <div className="privacy-note"><span aria-hidden="true">◆</span><p>{message}</p></div>
        <div className="meter-row"><div className={`mic-state ${micActive ? 'active' : ''}`}><span className="mic-icon" aria-hidden="true">●</span><div><small>MICROPHONE</small><strong>{micActive ? 'マイク取得中' : 'マイクなし'}</strong></div></div><p className="limit-note">最初のテストは5分以内で行ってください</p></div>
        {error && <div className="error-box" role="alert">{error}</div>}
        <div className="actions">{status !== 'recording' && <button className="primary-button" type="button" onClick={startRecording} disabled={isBusy}>{status === 'requesting' ? '画面を選択中…' : '録画開始'}</button>}{status === 'recording' && <button className="stop-button" type="button" onClick={finishRecording}><span aria-hidden="true" /> 録画停止</button>}</div>
      </section>
      {videoUrl && <section className="preview-card" aria-labelledby="preview-title"><div className="preview-heading"><div><p className="section-number">02</p><h2 id="preview-title">録画を確認</h2></div><span className="ready-label">READY TO REVIEW</span></div><video ref={previewRef} className="video-player" src={videoUrl} controls playsInline /><div className="preview-actions"><button className="secondary-button" type="button" onClick={restartPreview}>最初から再生</button><button className="primary-button" type="button" onClick={saveRecording}>PCへ保存</button></div></section>}
      <section className="analysis-card" aria-labelledby="analysis-title">
        <div className="preview-heading"><div><p className="section-number">03</p><h2 id="analysis-title">解析準備</h2></div><span className="ready-label">STEP 2-1</span></div>
        <p className="analysis-lead">元WebM・解析用JSON・時刻付きPNGをブラウザ内で生成します。外部へ自動送信しません。</p>
        <label className="file-field">保存済みWebMを読み込む（任意）<input type="file" accept="video/webm,.webm" onChange={(event) => { resetAnalysis(); setImportedFile(event.target.files?.[0] ?? null) }} /></label>
        <div className="analysis-settings">
          <label>静止画の間隔<select value={frameInterval} onChange={(event) => { resetAnalysis(); setFrameInterval(Number(event.target.value)) }}>{FRAME_INTERVAL_OPTIONS.map((seconds) => <option key={seconds} value={seconds}>{seconds}秒</option>)}</select></label>
          <p>最大30枚。超える場合は間隔を自動調整します。</p>
        </div>
        <button className="primary-button" type="button" onClick={prepareAnalysis} disabled={analysisBusy || (!recordingBlob && !importedFile)}>{analysisBusy ? '解析準備中…' : '解析準備を開始'}</button>
        {!recordingBlob && !importedFile && <p className="analysis-hint">録画を完了するか、保存済みWebMを選択してください。</p>}
        {analysisMessage && <div className="privacy-note" aria-live="polite"><span aria-hidden="true">◆</span><p>{analysisMessage}</p></div>}
        {analysisResult && <div className="analysis-result">
          <div className="analysis-summary"><h3>解析データ</h3><dl><div><dt>元WebM</dt><dd>{analysisResult.document.recording.fileName}</dd></div><div><dt>録画時間</dt><dd>{analysisResult.document.recording.durationSeconds}秒</dd></div><div><dt>解像度</dt><dd>{analysisResult.document.recording.width} × {analysisResult.document.recording.height}</dd></div><div><dt>音声</dt><dd>{String(analysisResult.document.recording.hasAudio)}</dd></div><div><dt>PNG</dt><dd>{analysisResult.frames.length}枚</dd></div></dl></div>
          <div className="preview-actions"><button className="secondary-button" type="button" onClick={saveOriginalWebM}>元WebMを保存</button><button className="secondary-button" type="button" onClick={copyAnalysisJson}>JSONをコピー</button><button className="primary-button" type="button" onClick={() => downloadJson(analysisResult.document)}>JSONを保存</button></div>
          <details><summary>解析用JSONを確認</summary><pre className="json-preview">{analysisJson(analysisResult.document)}</pre></details>
          <div className="frame-grid">{analysisResult.frames.map((frame) => <figure key={frame.fileName}><img src={frame.previewUrl} alt={`${frame.timeLabel}時点の録画画面`} /><figcaption><span>{frame.timeLabel}</span><button type="button" onClick={() => downloadBlob(frame.blob, frame.fileName)}>PNGを保存</button></figcaption></figure>)}</div>
        </div>}
      </section>
      <footer><p>録画データを外部へ自動送信しません</p><p>対応環境：Windows版 Google Chrome / Microsoft Edge</p></footer>
    </main>
  )
}

export default App
