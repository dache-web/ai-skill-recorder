import { useEffect, useMemo, useReducer, useRef, useState } from 'react'
import type { CSSProperties, KeyboardEvent as ReactKeyboardEvent, PointerEvent as ReactPointerEvent } from 'react'
import { flushSync } from 'react-dom'
import { createAnalysisPackage } from './analysis/analysisPackage'
import { analysisJson, downloadBlob, downloadJson } from './analysis/export'
import { FRAME_INTERVAL_OPTIONS } from './analysis/frameExtractor'
import { captureReviewPoint, createSegment, hasReachedSegmentEnd, MAX_POINT_COUNT, normalizeTime, overlappingSegmentIds, pointData } from './analysis/reviewAnnotations'
import type { AnalysisResult, RecordingSource, ReviewPoint, ReviewSegment } from './analysis/types'
import { formatElapsed, safeRecordingName, supportedMimeType, type RecorderStatus, userFacingCaptureError } from './recorder'
import { DEFAULT_REVIEW_SPLIT_RATIO, ratioFromTopHeight, readReviewSplitRatio, REVIEW_SPLITTER_HEIGHT, saveReviewSplitRatio, splitTopHeight } from './reviewSplit'
import { initialReviewWorkflow, reviewWorkflowReducer, type ResumeAfter } from './reviewWorkflow'

const stopTracks = (stream: MediaStream | null) => stream?.getTracks().forEach((track) => track.stop())
const ordered = <T extends { order: number }>(items: T[]): T[] => items.map((item, index) => ({ ...item, order: index + 1 }))
const reviewStorage = (): Storage | null => {
  try { return typeof window === 'undefined' ? null : window.localStorage }
  catch { return null }
}

function App() {
  const [status, setStatus] = useState<RecorderStatus>('idle')
  const [elapsed, setElapsed] = useState(0)
  const [micActive, setMicActive] = useState(false)
  const [message, setMessage] = useState('録画データは外部へ送信されず、このブラウザ内だけで処理されます。')
  const [error, setError] = useState('')
  const [videoUrl, setVideoUrl] = useState('')
  const [importedUrl, setImportedUrl] = useState('')
  const [recordingBlob, setRecordingBlob] = useState<Blob | null>(null)
  const [recordingName, setRecordingName] = useState('')
  const [recordedAt, setRecordedAt] = useState<string | null>(null)
  const [recordingHadAudio, setRecordingHadAudio] = useState(false)
  const [recordingDuration, setRecordingDuration] = useState(0)
  const [importedFile, setImportedFile] = useState<File | null>(null)
  const [points, setPoints] = useState<ReviewPoint[]>([])
  const [videoSegments, setVideoSegments] = useState<ReviewSegment[]>([])
  const [excludedSegments, setExcludedSegments] = useState<ReviewSegment[]>([])
  const [reviewWorkflow, dispatchReviewWorkflow] = useReducer(reviewWorkflowReducer, initialReviewWorkflow)
  const [reviewMessage, setReviewMessage] = useState('')
  const [videoReady, setVideoReady] = useState(false)
  const [videoPlaying, setVideoPlaying] = useState(false)
  const [splitRatio, setSplitRatio] = useState(() => readReviewSplitRatio(reviewStorage()))
  const [splitTopPixels, setSplitTopPixels] = useState<number | null>(null)
  const [reviewDialog, setReviewDialog] = useState<
    | { type: 'point'; point: ReviewPoint }
    | { type: 'segment'; kind: 'video' | 'excluded'; segment: ReviewSegment }
    | null
  >(null)
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
  const playRequestRef = useRef<{ onPlaySeen: boolean; promiseResolved: boolean } | null>(null)
  const reviewWorkspaceRef = useRef<HTMLDivElement>(null)
  const splitDragRef = useRef<{ pointerId: number; containerTop: number; containerHeight: number; lastTopHeight: number } | null>(null)
  const reviewDialogRef = useRef<HTMLDialogElement>(null)
  const segmentPreviewRef = useRef<HTMLVideoElement>(null)
  const pointSequenceRef = useRef(0)
  const videoSegmentSequenceRef = useRef(0)
  const excludedSegmentSequenceRef = useRef(0)
  const reviewUrl = importedUrl || videoUrl
  const activeSegment = reviewWorkflow.selection
  const pauseReason = reviewWorkflow.resumeAfter
  const overlapIds = useMemo(() => overlappingSegmentIds(videoSegments, excludedSegments), [videoSegments, excludedSegments])

  useEffect(() => {
    if (status !== 'recording') return
    const timer = window.setInterval(() => setElapsed(Math.floor((Date.now() - startedAtRef.current) / 1000)), 250)
    return () => window.clearInterval(timer)
  }, [status])
  useEffect(() => () => { stopTracks(displayStreamRef.current); stopTracks(micStreamRef.current) }, [])
  useEffect(() => () => { if (videoUrl) URL.revokeObjectURL(videoUrl) }, [videoUrl])
  useEffect(() => () => { if (importedUrl) URL.revokeObjectURL(importedUrl) }, [importedUrl])
  useEffect(() => { setVideoReady(false); setVideoPlaying(false); playRequestRef.current = null; dispatchReviewWorkflow({ type: 'RESET' }) }, [reviewUrl])
  useEffect(() => {
    const workspace = reviewWorkspaceRef.current
    if (!workspace || !window.ResizeObserver) return
    const updateSize = () => setSplitTopPixels(splitTopHeight(splitRatio, workspace.clientHeight))
    updateSize()
    const observer = new ResizeObserver(updateSize)
    observer.observe(workspace)
    return () => observer.disconnect()
  }, [reviewUrl, splitRatio])

  const resetAnalysis = () => {
    analysisResult?.frames.forEach((frame) => URL.revokeObjectURL(frame.previewUrl))
    setAnalysisResult(null); setAnalysisMessage('')
  }
  const clearReview = () => {
    points.forEach((point) => URL.revokeObjectURL(point.previewUrl))
    setPoints([]); setVideoSegments([]); setExcludedSegments([]); dispatchReviewWorkflow({ type: 'RESET' }); setReviewMessage(''); setVideoPlaying(false); playRequestRef.current = null
    pointSequenceRef.current = 0; videoSegmentSequenceRef.current = 0; excludedSegmentSequenceRef.current = 0
    resetAnalysis()
  }

  const finishRecording = () => {
    if (isStoppingRef.current) return
    isStoppingRef.current = true; setStatus('stopping'); setMessage('録画を終了しています…')
    stopTracks(displayStreamRef.current); stopTracks(micStreamRef.current)
    const recorder = recorderRef.current
    if (recorder && recorder.state !== 'inactive') recorder.stop()
    else { setStatus('idle'); isStoppingRef.current = false }
  }

  const startRecording = async () => {
    if (!navigator.mediaDevices?.getDisplayMedia || !window.MediaRecorder) {
      setError('このブラウザでは録画機能を利用できません。Windows版ChromeまたはEdgeの最新版を使用してください。'); return
    }
    setError(''); setMessage('共有する画面を選んでください。'); setRecordingBlob(null); setRecordingName(''); setRecordedAt(null)
    setRecordingHadAudio(false); setRecordingDuration(0); setImportedFile(null); setImportedUrl(''); clearReview(); setVideoUrl('')
    setStatus('requesting'); setElapsed(0); isStoppingRef.current = false; chunksRef.current = []
    try {
      const displayStream = await navigator.mediaDevices.getDisplayMedia({ video: { frameRate: { ideal: 15, max: 30 } }, audio: false })
      displayStreamRef.current = displayStream
      let micStream: MediaStream | null = null
      try { micStream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true }, video: false }) }
      catch { setMessage('マイクを取得できなかったため、画面だけを録画しています。') }
      micStreamRef.current = micStream; setMicActive(Boolean(micStream?.getAudioTracks().length))
      const recordingStream = new MediaStream([...displayStream.getVideoTracks(), ...(micStream?.getAudioTracks() ?? [])])
      const mimeType = supportedMimeType(); const recorder = new MediaRecorder(recordingStream, mimeType ? { mimeType } : undefined)
      recorderRef.current = recorder
      recorder.addEventListener('dataavailable', (event) => { if (event.data.size > 0) chunksRef.current.push(event.data) })
      recorder.addEventListener('error', () => { setError('録画中にエラーが発生しました。録画を停止し、もう一度お試しください。'); finishRecording() })
      recorder.addEventListener('stop', () => {
        const blob = new Blob(chunksRef.current, { type: recorder.mimeType || 'video/webm' }); stopTracks(recordingStream); setMicActive(false)
        if (blob.size === 0) { setError('録画データが作成されませんでした。もう一度録画してください。'); setStatus('idle') }
        else {
          setRecordingDuration(Math.max(0.001, (Date.now() - startedAtRef.current) / 1000)); setRecordingBlob(blob)
          setVideoUrl(URL.createObjectURL(blob)); setStatus('preview'); setMessage('録画が完了しました。原本を保存し、重要な場面を確認できます。')
        }
        isStoppingRef.current = false
      })
      displayStream.getVideoTracks()[0]?.addEventListener('ended', finishRecording, { once: true })
      startedAtRef.current = Date.now(); setRecordedAt(new Date(startedAtRef.current).toISOString())
      setRecordingName(safeRecordingName(new Date(startedAtRef.current))); setRecordingHadAudio(Boolean(micStream?.getAudioTracks().length))
      recorder.start(1000); setStatus('recording'); if (micStream) setMessage('画面とマイクを録画しています。')
    } catch (captureError) {
      stopTracks(displayStreamRef.current); stopTracks(micStreamRef.current); displayStreamRef.current = null; micStreamRef.current = null
      setMicActive(false); setStatus('idle'); setError(userFacingCaptureError(captureError)); setMessage('録画は開始されていません。')
    }
  }

  const selectedAnalysisSource = (): RecordingSource | null => {
    if (importedFile) return { blob: importedFile, fileName: importedFile.name, source: 'saved-webm', recordedAt: null, hasAudio: 'unknown' }
    if (!recordingBlob) return null
    return { blob: recordingBlob, fileName: recordingName || safeRecordingName(), source: 'current-recording', recordedAt, hasAudio: recordingHadAudio, durationHintSeconds: recordingDuration }
  }
  const saveOriginalWebM = () => { const source = selectedAnalysisSource(); if (source) downloadBlob(source.blob, source.fileName) }
  const saveRecording = async () => {
    if (!recordingBlob) return
    setError(''); const fileName = recordingName || safeRecordingName()
    try {
      if (window.showSaveFilePicker) {
        const handle = await window.showSaveFilePicker({ suggestedName: fileName, types: [{ description: 'WebM動画', accept: { 'video/webm': ['.webm'] } }] })
        const writable = await handle.createWritable(); await writable.write(recordingBlob); await writable.close()
      } else downloadBlob(recordingBlob, fileName)
      setMessage('元WebMをPCへ保存しました。原本は編集されていません。')
    } catch (saveError) {
      if (saveError instanceof DOMException && saveError.name === 'AbortError') { setMessage('保存をキャンセルしました。元WebMはこの画面に残っています。'); return }
      setError('録画を保存できませんでした。保存先の空き容量や書き込み権限を確認してください。')
    }
  }

  const currentVideoTime = (): number | null => {
    const video = previewRef.current
    if (!video || !videoReady || !Number.isFinite(video.currentTime)) { setReviewMessage('動画の読み込み完了後に操作してください。'); return null }
    return normalizeTime(video.currentTime, Number.isFinite(video.duration) ? video.duration : undefined)
  }
  const resumeReviewPlayback = async (messageText = '動画を再生しています。') => {
    const video = previewRef.current; if (!video) return
    const request = { onPlaySeen: false, promiseResolved: false }
    playRequestRef.current = request
    try {
      await video.play()
      request.promiseResolved = true
      dispatchReviewWorkflow({ type: 'PLAY_CONFIRMED' }); setVideoPlaying(true); setReviewMessage(messageText)
      if (request.onPlaySeen) playRequestRef.current = null
    } catch {
      if (playRequestRef.current === request) playRequestRef.current = null
      setReviewMessage('再生を開始できませんでした。もう一度同じ再生操作をお試しください。')
    }
  }
  const addPoint = async () => {
    const video = previewRef.current; if (!video) return
    if (pauseReason === 'point') { await resumeReviewPlayback('ポイントを追加した位置から再生を続けています。'); return }
    if (points.length >= MAX_POINT_COUNT) { setReviewMessage(`ポイントは最大${MAX_POINT_COUNT}件です。不要なポイントを削除してから追加してください。`); return }
    const timeSeconds = currentVideoTime(); if (timeSeconds === null) return
    video.pause()
    try {
      const point = await captureReviewPoint(video, ++pointSequenceRef.current, timeSeconds); setPoints((current) => ordered([...current, point])); resetAnalysis()
      dispatchReviewWorkflow({ type: 'POINT_ADDED' })
      setReviewMessage(`★ポイントを追加しました\n${point.timeLabel}`)
    } catch (pointError) { setReviewMessage(pointError instanceof Error ? pointError.message : 'ポイントを追加できませんでした。') }
  }
  const replacePoint = async (id: string) => {
    const video = previewRef.current; if (!video) return
    const timeSeconds = currentVideoTime(); if (timeSeconds === null) return
    video.pause()
    try {
      const replacement = await captureReviewPoint(video, ++pointSequenceRef.current, timeSeconds)
      setPoints((current) => current.map((point) => {
        if (point.id !== id) return point
        URL.revokeObjectURL(point.previewUrl); return { ...replacement, id: point.id, order: point.order }
      }))
      dispatchReviewWorkflow({ type: 'POINT_ADDED' })
      resetAnalysis(); setReviewMessage(`${replacement.timeLabel}へポイント位置と画像を変更しました。`)
    } catch (pointError) { setReviewMessage(pointError instanceof Error ? pointError.message : 'ポイントを変更できませんでした。') }
  }
  const deletePoint = (id: string) => {
    setPoints((current) => ordered(current.filter((point) => { if (point.id === id) URL.revokeObjectURL(point.previewUrl); return point.id !== id })))
    resetAnalysis(); setReviewMessage('ポイントを削除しました。元WebMは変更されていません。')
  }

  const toggleSegment = (kind: 'video' | 'excluded') => {
    const video = previewRef.current
    const completedReason: ResumeAfter = kind === 'video' ? 'video-segment' : 'excluded-segment'
    if (!activeSegment && pauseReason === completedReason) { void resumeReviewPlayback(`${kind === 'video' ? '動画区間' : '不要区間'}の終了位置から再生を続けています。`); return }
    const time = currentVideoTime(); if (!video || time === null) return
    if (!activeSegment) { dispatchReviewWorkflow({ type: 'START_SELECTION', kind, startSeconds: time }); setReviewMessage(''); return }
    if (activeSegment.kind !== kind) { setReviewMessage('先に開始中の区間を終了またはキャンセルしてください。'); return }
    try {
      const label = kind === 'video' ? '動画区間' : '不要区間'
      const sequence = kind === 'video' ? ++videoSegmentSequenceRef.current : ++excludedSegmentSequenceRef.current
      const segment = createSegment(`${kind === 'video' ? 'video' : 'excluded'}-segment-${sequence}`, 0, activeSegment.startSeconds, time)
      if (kind === 'video') {
        setVideoSegments((current) => [...current, { ...segment, order: current.length + 1 }])
      } else {
        setExcludedSegments((current) => [...current, { ...segment, order: current.length + 1 }])
      }
      dispatchReviewWorkflow({ type: 'COMPLETE_SELECTION', kind })
      video.pause()
      setVideoPlaying(false); resetAnalysis()
      setReviewMessage(`${label}を追加しました\n${formatElapsed(Math.floor(segment.startSeconds))} → ${formatElapsed(Math.floor(segment.endSeconds))}`)
    } catch (segmentError) { setReviewMessage(segmentError instanceof Error ? segmentError.message : '区間を追加できませんでした。') }
  }
  const changeSegmentBoundary = (kind: 'video' | 'excluded', id: string, boundary: 'start' | 'end') => {
    const time = currentVideoTime(); if (time === null) return
    const setter = kind === 'video' ? setVideoSegments : setExcludedSegments
    const target = (kind === 'video' ? videoSegments : excludedSegments).find((segment) => segment.id === id)
    if (!target) return
    try {
      const replacement = createSegment(target.id, target.order, boundary === 'start' ? time : target.startSeconds, boundary === 'end' ? time : target.endSeconds)
      setter((current) => current.map((segment) => segment.id === id ? replacement : segment))
      resetAnalysis(); setReviewMessage(`${boundary === 'start' ? '開始' : '終了'}位置を変更しました。`)
    } catch (segmentError) { setReviewMessage(segmentError instanceof Error ? segmentError.message : '区間を変更できませんでした。') }
  }
  const deleteSegment = (kind: 'video' | 'excluded', id: string) => {
    if (kind === 'video') setVideoSegments((current) => ordered(current.filter((segment) => segment.id !== id)))
    else setExcludedSegments((current) => ordered(current.filter((segment) => segment.id !== id)))
    resetAnalysis(); setReviewMessage('区間指定を削除しました。元WebMは変更されていません。')
  }
  const closeReviewDialog = () => {
    segmentPreviewRef.current?.pause()
    reviewDialogRef.current?.close()
  }
  const openPointPreview = (point: ReviewPoint) => {
    setReviewDialog({ type: 'point', point })
    if (!reviewDialogRef.current?.open) reviewDialogRef.current?.showModal()
  }
  const openSegmentPreview = (kind: 'video' | 'excluded', segment: ReviewSegment) => {
    flushSync(() => setReviewDialog({ type: 'segment', kind, segment }))
    const video = segmentPreviewRef.current
    if (video) {
      video.pause()
      const beginPreview = () => {
        const playFromStart = () => { void video.play().catch(() => undefined) }
        if (Math.abs(video.currentTime - segment.startSeconds) < 0.01) playFromStart()
        else {
          video.addEventListener('seeked', playFromStart, { once: true })
          video.currentTime = segment.startSeconds
        }
      }
      if (video.readyState === HTMLMediaElement.HAVE_NOTHING) video.addEventListener('loadedmetadata', beginPreview, { once: true })
      else beginPreview()
    }
    if (!reviewDialogRef.current?.open) reviewDialogRef.current?.showModal()
  }

  const reviewAnnotations = () => ({
    maximumPoints: MAX_POINT_COUNT, points: points.map(pointData), videoSegments,
    excludedSegments: excludedSegments.map((segment) => ({ ...segment, treatment: 'exclude-candidate' as const })),
  })
  const prepareAnalysis = async () => {
    const source = selectedAnalysisSource(); if (!source) return
    resetAnalysis(); setAnalysisBusy(true); setAnalysisMessage('ブラウザ内で解析JSONとAI解析用の補助画像を生成しています…')
    try {
      const result = await createAnalysisPackage(source, frameInterval, reviewAnnotations()); setAnalysisResult(result)
      setAnalysisMessage(`解析準備が完了しました。ポイント${points.length}件、動画区間${videoSegments.length}件、不要区間${excludedSegments.length}件、補助PNG ${result.frames.length}枚です。`)
    } catch (analysisError) { setAnalysisMessage(analysisError instanceof Error ? analysisError.message : '解析準備に失敗しました。') }
    finally { setAnalysisBusy(false) }
  }
  const copyAnalysisJson = async () => {
    if (!analysisResult) return
    try { await navigator.clipboard.writeText(analysisJson(analysisResult.document)); setAnalysisMessage('解析用JSONをクリップボードへコピーしました。') }
    catch { setAnalysisMessage('JSONをコピーできませんでした。「JSONを保存」を使用してください。') }
  }
  const importWebM = (file: File | null) => { setImportedFile(file); setImportedUrl(file ? URL.createObjectURL(file) : ''); clearReview() }
  const updateVideoReady = () => {
    const video = previewRef.current
    setVideoReady(Boolean(video && video.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA && video.videoWidth > 0 && video.videoHeight > 0 && Number.isFinite(video.currentTime)))
  }
  const observeVideoPlay = () => {
    setVideoPlaying(true)
    const request = playRequestRef.current
    if (!request) { dispatchReviewWorkflow({ type: 'EXTERNAL_PLAY_CONFIRMED' }); return }
    request.onPlaySeen = true
    if (request.promiseResolved) playRequestRef.current = null
  }
  const togglePlayback = async () => {
    if (!previewRef.current) return
    if (!previewRef.current.paused) { previewRef.current.pause(); setVideoPlaying(false); setReviewMessage('動画を一時停止しました。'); return }
    await resumeReviewPlayback()
  }

  const showInMainVideo = (timeSeconds: number, label: string) => {
    const video = previewRef.current
    if (!video) return
    if (activeSegment) { setReviewMessage('先に開始中の区間を終了またはキャンセルしてください。'); return }
    video.pause()
    video.currentTime = normalizeTime(timeSeconds, Number.isFinite(video.duration) ? video.duration : undefined)
    setVideoPlaying(false); dispatchReviewWorkflow({ type: 'SEEKED' }); setReviewMessage(`${label}を上の動画に表示しました。`)
  }

  const updateSplitPreview = (clientY: number) => {
    const drag = splitDragRef.current
    const workspace = reviewWorkspaceRef.current
    if (!drag || !workspace) return null
    const topHeight = splitTopHeight((clientY - drag.containerTop) / Math.max(1, drag.containerHeight - REVIEW_SPLITTER_HEIGHT), drag.containerHeight)
    drag.lastTopHeight = topHeight
    workspace.style.setProperty('--review-top-height', `${topHeight}px`)
    return topHeight
  }
  const beginSplitDrag = (event: ReactPointerEvent<HTMLDivElement>) => {
    const workspace = reviewWorkspaceRef.current; if (!workspace) return
    const rect = workspace.getBoundingClientRect()
    splitDragRef.current = { pointerId: event.pointerId, containerTop: rect.top, containerHeight: workspace.clientHeight, lastTopHeight: splitTopHeight(splitRatio, workspace.clientHeight) }
    event.currentTarget.setPointerCapture(event.pointerId)
    event.currentTarget.classList.add('is-dragging')
    updateSplitPreview(event.clientY)
  }
  const moveSplitDrag = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (splitDragRef.current?.pointerId === event.pointerId) updateSplitPreview(event.clientY)
  }
  const finishSplitDrag = (event: ReactPointerEvent<HTMLDivElement>) => {
    const drag = splitDragRef.current
    if (!drag || drag.pointerId !== event.pointerId) return
    const topHeight = event.type === 'pointercancel' ? drag.lastTopHeight : updateSplitPreview(event.clientY)
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId)
    event.currentTarget.classList.remove('is-dragging'); splitDragRef.current = null
    if (topHeight === null) return
    const ratio = ratioFromTopHeight(topHeight, drag.containerHeight)
    setSplitRatio(ratio); setSplitTopPixels(topHeight); saveReviewSplitRatio(reviewStorage(), ratio)
  }
  const setSplitByRatio = (ratio: number) => {
    const workspace = reviewWorkspaceRef.current; if (!workspace) return
    const topHeight = splitTopHeight(ratio, workspace.clientHeight)
    const normalizedRatio = ratioFromTopHeight(topHeight, workspace.clientHeight)
    setSplitRatio(normalizedRatio); setSplitTopPixels(topHeight); saveReviewSplitRatio(reviewStorage(), normalizedRatio)
  }
  const handleSplitKeyboard = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    const change = event.key === 'ArrowUp' ? -0.02 : event.key === 'ArrowDown' ? 0.02 : event.key === 'PageUp' ? -0.1 : event.key === 'PageDown' ? 0.1 : 0
    if (!change) return
    event.preventDefault(); setSplitByRatio(splitRatio + change)
  }

  const segmentList = (kind: 'video' | 'excluded', segments: ReviewSegment[]) => (
    <div className="segment-list">
      {segments.length === 0 && <p className="empty-state">まだ指定されていません。</p>}
      {segments.map((segment) => <article className={`segment-item ${overlapIds.has(segment.id) ? 'has-overlap' : ''}`} key={segment.id}>
        <div><strong>{kind === 'video' ? `区間${segment.order}` : `不要${segment.order}`}</strong><span>{formatElapsed(Math.floor(segment.startSeconds))} → {formatElapsed(Math.floor(segment.endSeconds))}（{segment.durationSeconds}秒）</span></div>
        {overlapIds.has(segment.id) && <p className="overlap-warning">指定が重複しています。情報は両方とも保持されます。</p>}
        <div className="item-actions"><button type="button" onClick={() => showInMainVideo(segment.startSeconds, kind === 'video' ? `動画区間${segment.order}` : `不要区間${segment.order}`)}>上で確認</button><button type="button" onClick={() => openSegmentPreview(kind, segment)}>区間だけ再生</button><button type="button" onClick={() => changeSegmentBoundary(kind, segment.id, 'start')}>開始変更</button><button type="button" onClick={() => changeSegmentBoundary(kind, segment.id, 'end')}>終了変更</button><button className="danger-link" type="button" onClick={() => deleteSegment(kind, segment.id)}>削除</button></div>
      </article>)}
    </div>
  )
  const isBusy = status === 'requesting' || status === 'stopping'
  const videoSourceControls = <div className="video-source-row">
    <div className="video-source-copy"><strong>マニュアルを作成する動画</strong><span>{importedFile?.name || recordingName || '動画が選択されていません'}</span></div>
    <label className="compact-file-field"><span>ファイルを選択</span><input type="file" accept="video/webm,.webm" onChange={(event) => importWebM(event.target.files?.[0] ?? null)} /></label>
    {recordingBlob && !importedFile && <button className="secondary-button compact-save-button" type="button" onClick={saveRecording}>元WebMを保存</button>}
  </div>

  return (
    <main className="shell">
      <header className="hero"><div><p className="eyebrow">RECORDING PROTOTYPE · STEP 2-1</p><h1>AIスキルレコーダー</h1><p className="subtitle">画面と声を、そのまま業務の記録へ。</p></div><div className={`status-pill status-${status}`} aria-live="polite"><span className="status-dot" />{status === 'recording' ? '録画中' : status === 'requesting' ? '許可待ち' : status === 'stopping' ? '終了処理中' : '待機中'}</div></header>
      <section className="recorder-card" aria-labelledby="recorder-title"><div className="recorder-topline"><div><p className="section-number">01</p><h2 id="recorder-title">画面を録画</h2></div><div className="timer" aria-label={`録画経過時間 ${formatElapsed(elapsed)}`}>{formatElapsed(elapsed)}</div></div><div className="privacy-note"><span aria-hidden="true">◆</span><p>{message}</p></div><div className="meter-row"><div className={`mic-state ${micActive ? 'active' : ''}`}><span className="mic-icon" aria-hidden="true">●</span><div><small>MICROPHONE</small><strong>{micActive ? 'マイク取得中' : 'マイクなし'}</strong></div></div><p className="limit-note">録画中は普段どおり作業してください</p></div>{error && <div className="error-box" role="alert">{error}</div>}<div className="actions">{status !== 'recording' && <button className="primary-button" type="button" onClick={startRecording} disabled={isBusy}>{status === 'requesting' ? '画面を選択中…' : '録画開始'}</button>}{status === 'recording' && <button className="stop-button" type="button" onClick={finishRecording}><span aria-hidden="true" /> 録画停止</button>}</div></section>

      <section className="review-card" aria-labelledby="review-title">
        <div className="preview-heading"><div><p className="section-number">02</p><h2 id="review-title">マニュアルに使う場面を指定</h2></div><span className="ready-label">REVIEW</span></div>
        {!reviewUrl && videoSourceControls}
        <p className="review-guidance">動画を見ながら、重要な場面、動画で残す部分、不要な部分を指定します。元WebMは変更されません。</p>
        {reviewUrl ? <div ref={reviewWorkspaceRef} className="review-workspace" style={splitTopPixels === null ? undefined : { '--review-top-height': `${splitTopPixels}px` } as CSSProperties}>
          <div className="review-stage">
            {videoSourceControls}
            <video ref={previewRef} className="video-player review-player" src={reviewUrl} controls playsInline preload="auto" onLoadedMetadata={updateVideoReady} onLoadedData={updateVideoReady} onCanPlay={updateVideoReady} onDurationChange={updateVideoReady} onPlay={observeVideoPlay} onPause={() => setVideoPlaying(false)} onEnded={() => setVideoPlaying(false)} onSeeking={() => dispatchReviewWorkflow({ type: 'SEEKED' })} />
            <div className="review-controls">
              <button className="review-control playback-button" type="button" onClick={togglePlayback} disabled={!videoReady}>{videoPlaying ? '⏸ 一時停止' : pauseReason ? '▶ 再生を続ける' : '▶ 再生する'}</button>
              <button className="review-control point-button" type="button" onClick={addPoint} disabled={!videoReady}>{pauseReason === 'point' ? '▶ ポイント後を再生' : '★ ポイント'}</button>
              <button className={`review-control ${activeSegment?.kind === 'video' ? 'active-control' : ''}`} type="button" onClick={() => toggleSegment('video')} disabled={!videoReady || Boolean(activeSegment && activeSegment.kind !== 'video')}>{activeSegment?.kind === 'video' ? '動画区間 終了' : pauseReason === 'video-segment' ? '▶ 動画を再開' : '動画区間 開始'}</button>
              <button className={`review-control ${activeSegment?.kind === 'excluded' ? 'active-control excluded' : ''}`} type="button" onClick={() => toggleSegment('excluded')} disabled={!videoReady || Boolean(activeSegment && activeSegment.kind !== 'excluded')}>{activeSegment?.kind === 'excluded' ? '不要区間 終了' : pauseReason === 'excluded-segment' ? '▶ 動画を再開' : '不要区間 開始'}</button>
              <button className="review-control cancel-control" type="button" disabled={!activeSegment} onClick={() => { dispatchReviewWorkflow({ type: 'CANCEL_SELECTION' }); setReviewMessage('区間指定をキャンセルしました。') }}>キャンセル</button>
            </div>
            {!videoReady && <p className="video-preparing" aria-live="polite">動画を準備しています…</p>}
            <div className="review-message" aria-live="polite">{activeSegment ? <><strong>{activeSegment.kind === 'video' ? '動画区間' : '不要区間'}を指定中</strong><span>開始：{formatElapsed(Math.floor(activeSegment.startSeconds))}</span>{reviewMessage && <span className="review-workflow-error">{reviewMessage}</span>}</> : reviewMessage ? reviewMessage.split('\n').map((line, index) => index === 0 ? <strong key={line}>{line}</strong> : <span key={line}>{line}</span>) : <span>動画を再生し、残したい場面を指定してください。</span>}</div>
          </div>
          <div className="review-splitter" role="separator" aria-label="動画と登録結果の表示比率" aria-orientation="horizontal" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(splitRatio * 100)} tabIndex={0} onPointerDown={beginSplitDrag} onPointerMove={moveSplitDrag} onPointerUp={finishSplitDrag} onPointerCancel={finishSplitDrag} onKeyDown={handleSplitKeyboard} onDoubleClick={() => setSplitByRatio(DEFAULT_REVIEW_SPLIT_RATIO)}><span aria-hidden="true">＝</span></div>
          <div className="review-results">
            <div className="registered-heading"><h3>登録した内容</h3><span>この領域をスクロールして確認できます</span></div>
            <section>
              <div className="result-heading"><h3>重要ポイント</h3><span>{points.length} / {MAX_POINT_COUNT}</span></div>
              {points.length === 0 && <p className="empty-state">まだポイントはありません。</p>}
              <div className="point-grid">{points.map((point) => <article className="point-item" key={point.id}>
                <img src={point.previewUrl} alt={`${point.timeLabel}のポイント画面`} onLoad={(event) => { if (!event.currentTarget.naturalWidth || !event.currentTarget.naturalHeight) setReviewMessage('ポイント画像を正常に表示できませんでした。') }} onError={() => setReviewMessage('ポイント画像を読み込めませんでした。')} />
                <div><strong>★{point.order}</strong><span>{point.timeLabel}（{point.timeSeconds}秒）</span></div>
                <div className="item-actions"><button type="button" onClick={() => showInMainVideo(point.timeSeconds, `★ポイント${point.order}`)}>上で確認</button><button type="button" onClick={() => openPointPreview(point)}>画像を拡大</button><button type="button" onClick={() => replacePoint(point.id)}>現在位置へ変更</button><button className="danger-link" type="button" onClick={() => deletePoint(point.id)}>削除</button><button type="button" onClick={() => downloadBlob(point.blob, point.imageFileName)}>PNG保存</button></div>
              </article>)}</div>
            </section>
            <section><h3>動画区間</h3>{segmentList('video', videoSegments)}</section>
            <section><h3>不要区間</h3>{segmentList('excluded', excludedSegments)}</section>
          </div>
        </div> : <p className="analysis-hint">録画を完了するか、マニュアルを作成するWebMを選択してください。</p>}
      </section>

      <dialog ref={reviewDialogRef} className="review-dialog" onClose={() => { segmentPreviewRef.current?.pause(); setReviewDialog(null) }}>
        {reviewDialog?.type === 'point' && <div className="dialog-content">
          <div className="dialog-heading"><div><p className="section-number">POINT PREVIEW</p><h3>★ポイント{reviewDialog.point.order}</h3></div><span>{reviewDialog.point.timeLabel}（{reviewDialog.point.timeSeconds}秒）</span></div>
          <img className="dialog-point-image" src={reviewDialog.point.previewUrl} alt={`★ポイント${reviewDialog.point.order}の拡大画像`} />
          <div className="dialog-actions"><button className="primary-button" type="button" onClick={closeReviewDialog}>閉じる</button></div>
        </div>}
        {reviewDialog?.type === 'segment' && <div className="dialog-content">
          <div className="dialog-heading"><div><p className="section-number">SEGMENT PREVIEW</p><h3>{reviewDialog.kind === 'video' ? '動画区間の確認' : '不要区間の確認'}</h3></div><span>{formatElapsed(Math.floor(reviewDialog.segment.startSeconds))} → {formatElapsed(Math.floor(reviewDialog.segment.endSeconds))}</span></div>
          <p className="dialog-note">{reviewDialog.kind === 'excluded' ? '本当に不要部分として指定してよいか確認できます。確認しても指定内容は変更されません。' : '指定した開始位置から終了位置までを確認再生します。'}</p>
          <video ref={segmentPreviewRef} className="dialog-video" src={reviewUrl} controls playsInline preload="metadata" onTimeUpdate={(event) => { if (hasReachedSegmentEnd(event.currentTarget.currentTime, reviewDialog.segment.endSeconds)) event.currentTarget.pause() }} />
          <div className="dialog-actions"><button className="secondary-button" type="button" onClick={() => openSegmentPreview(reviewDialog.kind, reviewDialog.segment)}>最初から確認</button><button className="primary-button" type="button" onClick={closeReviewDialog}>閉じる</button></div>
        </div>}
      </dialog>

      <section className="analysis-card" aria-labelledby="analysis-title"><div className="preview-heading"><div><p className="section-number">03</p><h2 id="analysis-title">解析データを作成</h2></div><span className="ready-label">STEP 2-1</span></div><p className="analysis-lead">指定情報をJSONにまとめ、AI解析用の補助画像を一定間隔で生成します。すべてブラウザ内で処理します。</p><div className="analysis-settings"><label>補助画像の間隔<select value={frameInterval} onChange={(event) => { resetAnalysis(); setFrameInterval(Number(event.target.value)) }}>{FRAME_INTERVAL_OPTIONS.map((seconds) => <option key={seconds} value={seconds}>{seconds}秒</option>)}</select></label><p>補助画像は最大30枚。★ポイントPNGが主データです。</p></div><button className="primary-button" type="button" onClick={prepareAnalysis} disabled={analysisBusy || !reviewUrl}>{analysisBusy ? '解析データ作成中…' : '解析データを作成'}</button>{!reviewUrl && <p className="analysis-hint">録画を完了するか、保存済みWebMを選択してください。</p>}{analysisMessage && <div className="privacy-note" aria-live="polite"><span aria-hidden="true">◆</span><p>{analysisMessage}</p></div>}{analysisResult && <div className="analysis-result"><div className="analysis-summary"><h3>解析データ</h3><dl><div><dt>元WebM</dt><dd>{analysisResult.document.recording.fileName}</dd></div><div><dt>原本</dt><dd>変更なし</dd></div><div><dt>ポイント</dt><dd>{points.length}件</dd></div><div><dt>動画区間</dt><dd>{videoSegments.length}件</dd></div><div><dt>不要区間</dt><dd>{excludedSegments.length}件</dd></div><div><dt>補助PNG</dt><dd>{analysisResult.frames.length}枚</dd></div></dl></div><div className="preview-actions"><button className="secondary-button" type="button" onClick={saveOriginalWebM}>元WebMを保存</button><button className="secondary-button" type="button" onClick={copyAnalysisJson}>JSONをコピー</button><button className="primary-button" type="button" onClick={() => downloadJson(analysisResult.document)}>JSONを保存</button></div><details><summary>解析用JSONを確認</summary><pre className="json-preview">{analysisJson(analysisResult.document)}</pre></details><h3 className="supplement-heading">AI解析用の補助画像</h3><div className="frame-grid">{analysisResult.frames.map((frame) => <figure key={frame.fileName}><img src={frame.previewUrl} alt={`${frame.timeLabel}時点の補助画像`} onLoad={(event) => { if (!event.currentTarget.naturalWidth || !event.currentTarget.naturalHeight) setAnalysisMessage('補助画像を正常に表示できませんでした。') }} onError={() => setAnalysisMessage('補助画像を読み込めませんでした。')} /><figcaption><span>{frame.timeLabel}</span><button type="button" onClick={() => downloadBlob(frame.blob, frame.fileName)}>PNG保存</button></figcaption></figure>)}</div></div>}</section>
      <footer><p>録画データを外部へ自動送信しません</p><p>対応環境：Windows版 Google Chrome / Microsoft Edge</p></footer>
    </main>
  )
}

export default App
