import { useEffect, useMemo, useReducer, useRef, useState } from 'react'
import type { CSSProperties, KeyboardEvent as ReactKeyboardEvent, PointerEvent as ReactPointerEvent } from 'react'
import { createAnalysisPackage } from './analysis/analysisPackage'
import { analysisJson, downloadBlob, downloadJson } from './analysis/export'
import { captureVideoFrame, FRAME_INTERVAL_OPTIONS, seekToFrame } from './analysis/frameExtractor'
import { captureReviewPoint, createSegment, MAX_POINT_COUNT, normalizeTime, pointData } from './analysis/reviewAnnotations'
import type { AnalysisResult, ManualTimelineItem, RecordingSource, ReviewPoint, ReviewSegment, TimelineItem } from './analysis/types'
import { findTimelineOverlaps, findUnclassifiedIntervals, reorderTimeline, timelineConfirmationIssue, timelinePoint, timelineSegment, type UnclassifiedInterval } from './manualTimeline'
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
  const [timelineItems, setTimelineItems] = useState<TimelineItem[]>([])
  const [timelineThumbnails, setTimelineThumbnails] = useState<Record<string, { blob: Blob; previewUrl: string }>>({})
  const [selectedTimelineId, setSelectedTimelineId] = useState<string | null>(null)
  const [fullReviewActive, setFullReviewActive] = useState(false)
  const [fullReviewCompletedAt, setFullReviewCompletedAt] = useState<string | null>(null)
  const [timelineConfirmedAt, setTimelineConfirmedAt] = useState<string | null>(null)
  const [overlapAcknowledgedAt, setOverlapAcknowledgedAt] = useState<string | null>(null)
  const [draggedTimelineId, setDraggedTimelineId] = useState<string | null>(null)
  const [videoDuration, setVideoDuration] = useState(0)
  const [reviewWorkflow, dispatchReviewWorkflow] = useReducer(reviewWorkflowReducer, initialReviewWorkflow)
  const [reviewMessage, setReviewMessage] = useState('')
  const [videoReady, setVideoReady] = useState(false)
  const [videoPlaying, setVideoPlaying] = useState(false)
  const [splitRatio, setSplitRatio] = useState(() => readReviewSplitRatio(reviewStorage()))
  const [splitTopPixels, setSplitTopPixels] = useState<number | null>(null)
  const [reviewDialog, setReviewDialog] = useState<{ type: 'point'; point: ReviewPoint } | null>(null)
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
  const pendingSegmentThumbnailRef = useRef<{ kind: 'video' | 'excluded'; blob: Blob; previewUrl: string; fileName: string } | null>(null)
  const timelinePlaybackRef = useRef<{ itemId: string; endSeconds: number } | null>(null)
  const timelineSequenceRef = useRef(0)
  const pointSequenceRef = useRef(0)
  const videoSegmentSequenceRef = useRef(0)
  const excludedSegmentSequenceRef = useRef(0)
  const reviewUrl = importedUrl || videoUrl
  const activeSegment = reviewWorkflow.selection
  const pauseReason = reviewWorkflow.resumeAfter
  const unclassifiedIntervals = useMemo(() => findUnclassifiedIntervals(videoDuration, timelineItems, videoSegments, excludedSegments), [videoDuration, timelineItems, videoSegments, excludedSegments])
  const timelineOverlaps = useMemo(() => findTimelineOverlaps(timelineItems, videoSegments, excludedSegments), [timelineItems, videoSegments, excludedSegments])

  useEffect(() => {
    if (status !== 'recording') return
    const timer = window.setInterval(() => setElapsed(Math.floor((Date.now() - startedAtRef.current) / 1000)), 250)
    return () => window.clearInterval(timer)
  }, [status])
  useEffect(() => () => { stopTracks(displayStreamRef.current); stopTracks(micStreamRef.current) }, [])
  useEffect(() => () => { if (videoUrl) URL.revokeObjectURL(videoUrl) }, [videoUrl])
  useEffect(() => () => { if (importedUrl) URL.revokeObjectURL(importedUrl) }, [importedUrl])
  useEffect(() => { setVideoReady(false); setVideoPlaying(false); setVideoDuration(0); playRequestRef.current = null; timelinePlaybackRef.current = null; dispatchReviewWorkflow({ type: 'RESET' }) }, [reviewUrl])
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
  const markTimelineChanged = () => {
    setFullReviewActive(false); setFullReviewCompletedAt(null); setTimelineConfirmedAt(null); setOverlapAcknowledgedAt(null); timelinePlaybackRef.current = null
    resetAnalysis()
  }
  const appendTimelineItem = (item: Omit<TimelineItem, 'registeredOrder' | 'manualOrder'>) => {
    const registeredOrder = ++timelineSequenceRef.current
    const complete = { ...item, registeredOrder, manualOrder: 0 }
    setTimelineItems((current) => [...current, { ...complete, manualOrder: current.length + 1 }])
    setSelectedTimelineId(item.id)
    markTimelineChanged()
  }
  const clearReview = () => {
    points.forEach((point) => URL.revokeObjectURL(point.previewUrl))
    Object.values(timelineThumbnails).forEach((thumbnail) => URL.revokeObjectURL(thumbnail.previewUrl))
    if (pendingSegmentThumbnailRef.current) URL.revokeObjectURL(pendingSegmentThumbnailRef.current.previewUrl)
    pendingSegmentThumbnailRef.current = null
    setPoints([]); setVideoSegments([]); setExcludedSegments([]); setTimelineItems([]); setTimelineThumbnails({}); setSelectedTimelineId(null); setFullReviewActive(false); setFullReviewCompletedAt(null); setTimelineConfirmedAt(null); setOverlapAcknowledgedAt(null); setVideoDuration(0); dispatchReviewWorkflow({ type: 'RESET' }); setReviewMessage(''); setVideoPlaying(false); playRequestRef.current = null
    pointSequenceRef.current = 0; videoSegmentSequenceRef.current = 0; excludedSegmentSequenceRef.current = 0
    timelineSequenceRef.current = 0; timelinePlaybackRef.current = null
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
      const point = await captureReviewPoint(video, ++pointSequenceRef.current, timeSeconds); setPoints((current) => ordered([...current, point]))
      appendTimelineItem({ id: `timeline-${timelineSequenceRef.current + 1}`, contentType: 'point', sourceId: point.id, sourceCollection: 'points', thumbnailFileName: point.imageFileName, status: 'active' })
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
      markTimelineChanged(); setReviewMessage(`${replacement.timeLabel}へポイント位置と画像を変更しました。`)
    } catch (pointError) { setReviewMessage(pointError instanceof Error ? pointError.message : 'ポイントを変更できませんでした。') }
  }
  const deletePoint = (id: string) => {
    setPoints((current) => ordered(current.filter((point) => { if (point.id === id) URL.revokeObjectURL(point.previewUrl); return point.id !== id })))
    const timelineId = timelineItems.find((item) => item.sourceId === id && item.sourceCollection === 'points')?.id
    const deletedIndex = timelineItems.findIndex((item) => item.id === timelineId)
    const fallbackId = timelineItems[deletedIndex + 1]?.id ?? timelineItems[deletedIndex - 1]?.id ?? null
    setTimelineItems((current) => current.filter((item) => item.id !== timelineId).map((item, index) => ({ ...item, manualOrder: index + 1 })))
    if (selectedTimelineId === timelineId) setSelectedTimelineId(fallbackId)
    markTimelineChanged(); setReviewMessage('ポイントを削除しました。元WebMは変更されていません。')
  }

  const toggleSegment = async (kind: 'video' | 'excluded') => {
    const video = previewRef.current
    const completedReason: ResumeAfter = kind === 'video' ? 'video-segment' : 'excluded-segment'
    if (!activeSegment && pauseReason === completedReason) { void resumeReviewPlayback(`${kind === 'video' ? '動画区間' : '削除予定'}の終了位置から再生を続けています。`); return }
    const time = currentVideoTime(); if (!video || time === null) return
    if (!activeSegment) {
      try {
        const blob = await captureVideoFrame(video)
        const sequence = kind === 'video' ? videoSegmentSequenceRef.current + 1 : excludedSegmentSequenceRef.current + 1
        const fileName = `${kind === 'video' ? 'video' : 'excluded'}_segment_${String(sequence).padStart(3, '0')}_start.png`
        const previewUrl = URL.createObjectURL(blob)
        pendingSegmentThumbnailRef.current = { kind, blob, previewUrl, fileName }
        dispatchReviewWorkflow({ type: 'START_SELECTION', kind, startSeconds: time }); setReviewMessage('')
        if (video.paused) await resumeReviewPlayback(`${kind === 'video' ? '動画区間' : '削除予定'}を指定中です。`)
      } catch (captureError) { setReviewMessage(captureError instanceof Error ? captureError.message : '開始位置のサムネイルを生成できませんでした。') }
      return
    }
    if (activeSegment.kind !== kind) { setReviewMessage('先に開始中の区間を終了またはキャンセルしてください。'); return }
    try {
      const label = kind === 'video' ? '動画区間' : '削除予定'
      const sequence = kind === 'video' ? ++videoSegmentSequenceRef.current : ++excludedSegmentSequenceRef.current
      const segment = createSegment(`${kind === 'video' ? 'video' : 'excluded'}-segment-${sequence}`, 0, activeSegment.startSeconds, time)
      if (kind === 'video') {
        setVideoSegments((current) => [...current, { ...segment, order: current.length + 1 }])
      } else {
        setExcludedSegments((current) => [...current, { ...segment, order: current.length + 1 }])
      }
      const thumbnail = pendingSegmentThumbnailRef.current
      const timelineId = `timeline-${timelineSequenceRef.current + 1}`
      if (thumbnail?.kind === kind) {
        setTimelineThumbnails((current) => ({ ...current, [timelineId]: { blob: thumbnail.blob, previewUrl: thumbnail.previewUrl } }))
      }
      pendingSegmentThumbnailRef.current = null
      appendTimelineItem({ id: timelineId, contentType: 'video', sourceId: segment.id, sourceCollection: kind === 'video' ? 'videoSegments' : 'excludedSegments', thumbnailFileName: thumbnail?.fileName ?? `${kind}_segment_start.png`, status: kind === 'video' ? 'active' : 'excluded' })
      dispatchReviewWorkflow({ type: 'COMPLETE_SELECTION', kind })
      video.pause()
      setVideoPlaying(false)
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
      markTimelineChanged(); setReviewMessage(`${boundary === 'start' ? '開始' : '終了'}位置を変更しました。`)
    } catch (segmentError) { setReviewMessage(segmentError instanceof Error ? segmentError.message : '区間を変更できませんでした。') }
  }
  const deleteSegment = (kind: 'video' | 'excluded', id: string) => {
    if (kind === 'video') setVideoSegments((current) => ordered(current.filter((segment) => segment.id !== id)))
    else setExcludedSegments((current) => ordered(current.filter((segment) => segment.id !== id)))
    const collection = kind === 'video' ? 'videoSegments' : 'excludedSegments'
    const timelineId = timelineItems.find((item) => item.sourceId === id && item.sourceCollection === collection)?.id
    const deletedIndex = timelineItems.findIndex((item) => item.id === timelineId)
    const fallbackId = timelineItems[deletedIndex + 1]?.id ?? timelineItems[deletedIndex - 1]?.id ?? null
    const thumbnail = timelineId ? timelineThumbnails[timelineId] : null
    if (thumbnail) URL.revokeObjectURL(thumbnail.previewUrl)
    if (timelineId) setTimelineThumbnails((current) => { const next = { ...current }; delete next[timelineId]; return next })
    setTimelineItems((current) => current.filter((item) => item.id !== timelineId).map((item, index) => ({ ...item, manualOrder: index + 1 })))
    if (selectedTimelineId === timelineId) setSelectedTimelineId(fallbackId)
    markTimelineChanged(); setReviewMessage('区間指定を削除しました。元WebMは変更されていません。')
  }
  const closeReviewDialog = () => {
    reviewDialogRef.current?.close()
  }
  const openPointPreview = (point: ReviewPoint) => {
    setReviewDialog({ type: 'point', point })
    if (!reviewDialogRef.current?.open) reviewDialogRef.current?.showModal()
  }
  const serializedTimelineItems = (): ManualTimelineItem[] => timelineItems.map((item) => {
    const point = timelinePoint(item, points)
    const segment = timelineSegment(item, videoSegments, excludedSegments)
    return { ...item, ...(point ? { pointSeconds: point.timeSeconds } : {}), ...(segment ? { startSeconds: segment.startSeconds, endSeconds: segment.endSeconds } : {}) }
  })
  const reviewAnnotations = () => ({
    maximumPoints: MAX_POINT_COUNT, points: points.map(pointData), videoSegments,
    excludedSegments: excludedSegments.map((segment) => ({ ...segment, treatment: 'exclude-candidate' as const })),
    manualTimeline: {
      status: timelineConfirmedAt ? 'confirmed' as const : 'draft' as const,
      confirmedAt: timelineConfirmedAt,
      fullReviewCompletedAt,
      overlapAcknowledgedAt,
      items: serializedTimelineItems(),
      unclassifiedIntervals: unclassifiedIntervals.map(({ startSeconds, endSeconds, durationSeconds }) => ({ startSeconds, endSeconds, durationSeconds })),
    },
  })
  const prepareAnalysis = async () => {
    const source = selectedAnalysisSource(); if (!source) return
    resetAnalysis(); setAnalysisBusy(true); setAnalysisMessage('ブラウザ内で解析JSONとAI解析用の補助画像を生成しています…')
    try {
      const result = await createAnalysisPackage(source, frameInterval, reviewAnnotations()); setAnalysisResult(result)
      setAnalysisMessage(`解析準備が完了しました。ポイント${points.length}件、動画区間${videoSegments.length}件、削除予定${excludedSegments.length}件、補助PNG ${result.frames.length}枚です。`)
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
    if (video && Number.isFinite(video.duration) && video.duration > 0) setVideoDuration(normalizeTime(video.duration))
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

  const showInMainVideo = (timeSeconds: number, label: string, timelineId?: string, preserveFullReview = false) => {
    const video = previewRef.current
    if (!video) return
    if (activeSegment) { setReviewMessage('先に開始中の区間を終了またはキャンセルしてください。'); return }
    video.pause()
    video.currentTime = normalizeTime(timeSeconds, Number.isFinite(video.duration) ? video.duration : undefined)
    timelinePlaybackRef.current = null; if (!preserveFullReview) setFullReviewActive(false); setVideoPlaying(false); if (timelineId) setSelectedTimelineId(timelineId)
    dispatchReviewWorkflow({ type: 'SEEKED' }); setReviewMessage(`${label}を動画で確認しています。`)
  }

  const timelineItemTime = (item: TimelineItem): number | null => {
    const point = timelinePoint(item, points); if (point) return point.timeSeconds
    return timelineSegment(item, videoSegments, excludedSegments)?.startSeconds ?? null
  }
  const selectTimelineItem = (item: TimelineItem, preserveFullReview = false) => {
    const time = timelineItemTime(item); if (time === null) return
    showInMainVideo(time, item.contentType === 'point' ? '★ポイント' : item.status === 'excluded' ? '削除予定' : '動画区間', item.id, preserveFullReview)
  }
  const moveTimelineSelection = (direction: -1 | 1) => {
    if (!timelineItems.length || activeSegment) { if (activeSegment) setReviewMessage('先に開始中の区間を終了またはキャンセルしてください。'); return }
    const currentIndex = timelineItems.findIndex((item) => item.id === selectedTimelineId)
    const targetIndex = currentIndex < 0 ? (direction > 0 ? 0 : timelineItems.length - 1) : currentIndex + direction
    const target = timelineItems[targetIndex]
    if (target) selectTimelineItem(target, fullReviewActive)
    else if (fullReviewActive && direction > 0) { previewRef.current?.pause(); setFullReviewActive(false); setFullReviewCompletedAt(new Date().toISOString()); setReviewMessage('タイムライン全体の確認が完了しました。') }
  }
  const playFullReviewItem = async (item: TimelineItem) => {
    const video = previewRef.current; if (!video) return
    setSelectedTimelineId(item.id); setFullReviewActive(true)
    const point = timelinePoint(item, points)
    if (point) { video.pause(); video.currentTime = point.timeSeconds; setVideoPlaying(false); timelinePlaybackRef.current = null; setReviewMessage('★ポイントを確認中です。確認後「次へ」を押してください。'); return }
    const segment = timelineSegment(item, videoSegments, excludedSegments); if (!segment) return
    video.pause(); video.currentTime = segment.startSeconds
    timelinePlaybackRef.current = { itemId: item.id, endSeconds: segment.endSeconds }
    const messageText = item.status === 'excluded' ? '削除予定を確認中です。元WebMからは削除されていません。' : '動画区間を全体確認中です。'
    setReviewMessage(messageText)
    await resumeReviewPlayback(messageText)
  }
  const startFullReview = () => {
    if (activeSegment) { setReviewMessage('先に開始中の区間を終了またはキャンセルしてください。'); return }
    if (!timelineItems.length) { setReviewMessage('全体確認する項目がありません。'); return }
    setFullReviewCompletedAt(null); void playFullReviewItem(timelineItems[0])
  }
  const handleTimelinePlayback = (video: HTMLVideoElement) => {
    const playback = timelinePlaybackRef.current
    if (!playback || video.currentTime < playback.endSeconds) return
    video.pause(); timelinePlaybackRef.current = null
    const index = timelineItems.findIndex((item) => item.id === playback.itemId)
    const next = timelineItems[index + 1]
    if (next) void playFullReviewItem(next)
    else { setFullReviewActive(false); setFullReviewCompletedAt(new Date().toISOString()); setReviewMessage('タイムライン全体の確認が完了しました。') }
  }
  const moveTimelineItem = (id: string, direction: -1 | 1) => {
    const index = timelineItems.findIndex((item) => item.id === id); if (index < 0) return
    setTimelineItems((current) => reorderTimeline(current, index, index + direction)); previewRef.current?.pause(); markTimelineChanged(); setSelectedTimelineId(id); setReviewMessage('マニュアル上の順番を変更しました。元動画時刻は変更されていません。')
  }
  const dropTimelineItem = (targetId: string) => {
    if (!draggedTimelineId || draggedTimelineId === targetId) { setDraggedTimelineId(null); return }
    const from = timelineItems.findIndex((item) => item.id === draggedTimelineId)
    const to = timelineItems.findIndex((item) => item.id === targetId)
    if (from >= 0 && to >= 0) { setTimelineItems((current) => reorderTimeline(current, from, to)); previewRef.current?.pause(); markTimelineChanged(); setSelectedTimelineId(draggedTimelineId); setReviewMessage('ドラッグ操作でマニュアル上の順番を変更しました。') }
    setDraggedTimelineId(null)
  }
  const toggleTimelineStatus = (id: string) => {
    setTimelineItems((current) => current.map((item) => item.id === id ? { ...item, status: item.status === 'excluded' ? 'active' : 'excluded' } : item))
    previewRef.current?.pause(); markTimelineChanged(); setSelectedTimelineId(id); setReviewMessage('採用状態を変更しました。IDと元動画時刻は維持されています。')
  }
  const classifyUnclassified = async (interval: UnclassifiedInterval, status: 'active' | 'excluded') => {
    const video = previewRef.current; if (!video) return
    try {
      video.pause(); await seekToFrame(video, interval.startSeconds)
      const blob = await captureVideoFrame(video)
      const kind = status === 'active' ? 'video' : 'excluded'
      const sequence = status === 'active' ? ++videoSegmentSequenceRef.current : ++excludedSegmentSequenceRef.current
      const segment = createSegment(`${kind}-segment-${sequence}`, 0, interval.startSeconds, interval.endSeconds)
      if (status === 'active') setVideoSegments((current) => [...current, { ...segment, order: current.length + 1 }])
      else setExcludedSegments((current) => [...current, { ...segment, order: current.length + 1 }])
      const timelineId = `timeline-${timelineSequenceRef.current + 1}`
      const previewUrl = URL.createObjectURL(blob); setTimelineThumbnails((current) => ({ ...current, [timelineId]: { blob, previewUrl } }))
      appendTimelineItem({ id: timelineId, contentType: 'video', sourceId: segment.id, sourceCollection: status === 'active' ? 'videoSegments' : 'excludedSegments', thumbnailFileName: `${kind}_segment_${String(sequence).padStart(3, '0')}_start.png`, status })
      setReviewMessage(status === 'active' ? '未分類区間を動画として残しました。' : '未分類区間を削除予定にしました。')
    } catch (classificationError) { setReviewMessage(classificationError instanceof Error ? classificationError.message : '未分類区間を分類できませんでした。') }
  }
  const confirmTimeline = () => {
    const timelineValid = Boolean(timelineItems.length) && !timelineItems.some((item, index) => item.manualOrder !== index + 1 || timelineItemTime(item) === null) && !timelineItems.some((item) => item.contentType === 'video' && !timelineThumbnails[item.id]) && !points.some((point) => !point.previewUrl)
    const issue = timelineConfirmationIssue({ durationSeconds: videoDuration, unclassifiedCount: unclassifiedIntervals.length, timelineValid, fullReviewCompleted: Boolean(fullReviewCompletedAt), overlapCount: timelineOverlaps.length, overlapAcknowledged: Boolean(overlapAcknowledgedAt) })
    if (issue === 'duration') { setReviewMessage('動画時間を取得できないため確定できません。'); return }
    if (issue === 'unclassified') { setReviewMessage(`元動画にまだ判断されていない区間が${unclassifiedIntervals.length}件あります。`); return }
    if (issue === 'timeline') { setReviewMessage('タイムラインの順序、参照データ、またはサムネイルが不正なため確定できません。'); return }
    if (issue === 'full-review') { setReviewMessage('確定前に「全体を確認」を完了してください。'); return }
    if (issue === 'overlap') { setReviewMessage('重複区間があります。内容を確認し、「重複を確認済みにする」を押してください。'); return }
    const now = new Date().toISOString(); setTimelineConfirmedAt(now); setReviewMessage('この内容でマニュアル構成を確定しました。元WebMは変更されていません。'); resetAnalysis()
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

  const timelineCard = (item: TimelineItem, index: number) => {
    const point = timelinePoint(item, points)
    const segment = timelineSegment(item, videoSegments, excludedSegments)
    const isSelected = item.id === selectedTimelineId
    const kind = item.sourceCollection === 'excludedSegments' ? 'excluded' : 'video'
    const thumbnail = point ? point.previewUrl : timelineThumbnails[item.id]?.previewUrl
    const label = point ? '★ポイント' : item.status === 'excluded' ? '削除予定' : '動画'
    return <article key={item.id} draggable onDragStart={() => setDraggedTimelineId(item.id)} onDragEnd={() => setDraggedTimelineId(null)} onDragOver={(event) => event.preventDefault()} onDrop={() => dropTimelineItem(item.id)} className={`timeline-item ${item.status === 'excluded' ? 'is-excluded' : ''} ${isSelected ? 'is-reviewing' : ''}`} aria-current={isSelected ? 'true' : undefined}>
      <div className="timeline-card-heading"><span className="drag-handle" title="ドラッグして順番を変更">↕</span><strong>{index + 1}. {label}</strong>{isSelected && <span className="reviewing-label">確認中</span>}</div>
      {thumbnail ? <img className="timeline-thumbnail" src={thumbnail} alt={`${label}${index + 1}の実画面サムネイル`} /> : <div className="thumbnail-missing">サムネイルを準備できませんでした</div>}
      <p className="timeline-time">{point ? `${point.timeLabel}（${point.timeSeconds}秒）` : segment ? `${formatElapsed(Math.floor(segment.startSeconds))} → ${formatElapsed(Math.floor(segment.endSeconds))}（${segment.durationSeconds}秒）` : '参照データがありません'}</p>
      <div className="item-actions">
        <button type="button" onClick={() => selectTimelineItem(item)}>動画で確認</button>
        {point && <button type="button" onClick={() => openPointPreview(point)}>画像を拡大</button>}
        {point && <button type="button" onClick={() => replacePoint(point.id)}>現在位置へ変更</button>}
        {segment && <button type="button" onClick={() => changeSegmentBoundary(kind, segment.id, 'start')}>開始変更</button>}
        {segment && <button type="button" onClick={() => changeSegmentBoundary(kind, segment.id, 'end')}>終了変更</button>}
        {segment && <button type="button" onClick={() => toggleTimelineStatus(item.id)}>{item.status === 'excluded' ? '削除予定解除' : '削除予定にする'}</button>}
        <button type="button" onClick={() => moveTimelineItem(item.id, -1)} disabled={index === 0}>前へ移動</button>
        <button type="button" onClick={() => moveTimelineItem(item.id, 1)} disabled={index === timelineItems.length - 1}>後へ移動</button>
        <button className="danger-link" type="button" onClick={() => point ? deletePoint(point.id) : segment && deleteSegment(kind, segment.id)}>削除</button>
        {(point || timelineThumbnails[item.id]) && <button type="button" onClick={() => point ? downloadBlob(point.blob, point.imageFileName) : downloadBlob(timelineThumbnails[item.id].blob, item.thumbnailFileName)}>PNG保存</button>}
      </div>
    </article>
  }
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
            <video ref={previewRef} className="video-player review-player" src={reviewUrl} controls playsInline preload="auto" onLoadedMetadata={updateVideoReady} onLoadedData={updateVideoReady} onCanPlay={updateVideoReady} onDurationChange={updateVideoReady} onPlay={observeVideoPlay} onPause={() => setVideoPlaying(false)} onEnded={() => setVideoPlaying(false)} onTimeUpdate={(event) => handleTimelinePlayback(event.currentTarget)} onSeeking={() => dispatchReviewWorkflow({ type: 'SEEKED' })} />
            <div className="review-controls">
              <button className="review-control playback-button" type="button" onClick={togglePlayback} disabled={!videoReady}>{videoPlaying ? '⏸ 一時停止' : pauseReason ? '▶ 再生を続ける' : '▶ 再生する'}</button>
              <button className="review-control point-button" type="button" onClick={addPoint} disabled={!videoReady}>{pauseReason === 'point' ? '▶ ポイント後を再生' : '★ ポイント'}</button>
              <button className={`review-control ${activeSegment?.kind === 'video' ? 'active-control' : ''}`} type="button" onClick={() => toggleSegment('video')} disabled={!videoReady || Boolean(activeSegment && activeSegment.kind !== 'video')}>{activeSegment?.kind === 'video' ? '動画区間 終了' : pauseReason === 'video-segment' ? '▶ 動画を再開' : '動画区間 開始'}</button>
              <button className={`review-control ${activeSegment?.kind === 'excluded' ? 'active-control excluded' : ''}`} type="button" onClick={() => void toggleSegment('excluded')} disabled={!videoReady || Boolean(activeSegment && activeSegment.kind !== 'excluded')}>{activeSegment?.kind === 'excluded' ? '削除予定 終了' : pauseReason === 'excluded-segment' ? '▶ 動画を再開' : '削除予定 開始'}</button>
              <button className="review-control cancel-control" type="button" disabled={!activeSegment} onClick={() => { if (pendingSegmentThumbnailRef.current) URL.revokeObjectURL(pendingSegmentThumbnailRef.current.previewUrl); pendingSegmentThumbnailRef.current = null; dispatchReviewWorkflow({ type: 'CANCEL_SELECTION' }); setReviewMessage('区間指定をキャンセルしました。') }}>キャンセル</button>
            </div>
            {!videoReady && <p className="video-preparing" aria-live="polite">動画を準備しています…</p>}
            <div className="review-message" aria-live="polite">{activeSegment ? <><strong>{activeSegment.kind === 'video' ? '動画区間' : '削除予定'}を指定中</strong><span>開始：{formatElapsed(Math.floor(activeSegment.startSeconds))}</span>{reviewMessage && <span className="review-workflow-error">{reviewMessage}</span>}</> : reviewMessage ? reviewMessage.split('\n').map((line, index) => index === 0 ? <strong key={`${line}-${index}`}>{line}</strong> : <span key={`${line}-${index}`}>{line}</span>) : <span>動画を再生し、残したい場面を指定してください。</span>}</div>
          </div>
          <div className="review-splitter" role="separator" aria-label="動画と登録結果の表示比率" aria-orientation="horizontal" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(splitRatio * 100)} tabIndex={0} onPointerDown={beginSplitDrag} onPointerMove={moveSplitDrag} onPointerUp={finishSplitDrag} onPointerCancel={finishSplitDrag} onKeyDown={handleSplitKeyboard} onDoubleClick={() => setSplitByRatio(DEFAULT_REVIEW_SPLIT_RATIO)}><span aria-hidden="true">＝</span></div>
          <div className="review-results">
            <div className="registered-heading"><div><h3>マニュアルの流れ</h3><span>動画・ポイント・削除予定を1本のタイムラインで編集します</span></div><span>下側だけスクロールできます</span></div>
            <div className="timeline-toolbar">
              <button type="button" onClick={startFullReview} disabled={!timelineItems.length}>全体を確認</button>
              <button type="button" onClick={() => moveTimelineSelection(-1)} disabled={!timelineItems.length}>← 前へ</button>
              <strong>{selectedTimelineId ? timelineItems.findIndex((item) => item.id === selectedTimelineId) + 1 : 0} / {timelineItems.length}</strong>
              <button type="button" onClick={() => moveTimelineSelection(1)} disabled={!timelineItems.length}>{fullReviewActive && selectedTimelineId === timelineItems.at(-1)?.id ? '確認完了' : '次へ →'}</button>
            </div>
            {fullReviewActive && <p className="timeline-notice">全体確認中です。固定5ボタンと各カード操作で、そのまま修正できます。</p>}
            {timelineItems.length === 0 ? <p className="empty-state">動画を見ながら、動画区間・★ポイント・削除予定を登録してください。</p> : <div className="manual-timeline">{timelineItems.map(timelineCard)}</div>}
            <section className={`unclassified-panel ${unclassifiedIntervals.length ? 'has-warning' : ''}`}>
              <div className="result-heading"><h3>未分類区間</h3><span>{unclassifiedIntervals.length}件</span></div>
              {!videoDuration && <p>動画時間を取得しています。</p>}
              {videoDuration > 0 && !unclassifiedIntervals.length && <p className="coverage-complete">元動画の全時間を判断済みです。</p>}
              {unclassifiedIntervals.map((interval) => <article className="unclassified-item" key={interval.id}>
                <video className="timeline-thumbnail" src={reviewUrl} muted playsInline preload="metadata" onLoadedMetadata={(event) => { event.currentTarget.currentTime = interval.startSeconds }} aria-label={`${formatElapsed(Math.floor(interval.startSeconds))}からの未分類実画面`} />
                <div><strong>未分類</strong><span>{formatElapsed(Math.floor(interval.startSeconds))} → {formatElapsed(Math.floor(interval.endSeconds))}（{interval.durationSeconds}秒）</span></div>
                <div className="item-actions"><button type="button" onClick={() => showInMainVideo(interval.startSeconds, '未分類区間')}>動画で確認</button><button type="button" onClick={() => void classifyUnclassified(interval, 'active')}>動画として残す</button><button type="button" onClick={() => void classifyUnclassified(interval, 'excluded')}>削除予定にする</button></div>
              </article>)}
            </section>
            {timelineOverlaps.length > 0 && <section className="overlap-panel"><div className="result-heading"><h3>重複区間</h3><span>{timelineOverlaps.length}件</span></div><p>同じ元動画部分を複数回使う指定があります。自動変更はしていません。</p>{timelineOverlaps.map((overlap) => <div className="overlap-row" key={`${overlap.firstId}-${overlap.secondId}`}><span>{formatElapsed(Math.floor(overlap.startSeconds))} → {formatElapsed(Math.floor(overlap.endSeconds))}</span><button type="button" onClick={() => { const item = timelineItems.find((candidate) => candidate.id === overlap.secondId); if (item) selectTimelineItem(item) }}>動画で確認</button></div>)}<button type="button" onClick={() => { setOverlapAcknowledgedAt(new Date().toISOString()); setReviewMessage('重複区間を確認済みとして記録しました。元時刻は変更されていません。') }}>重複を確認済みにする</button></section>}
            <div className="timeline-confirm"><button className="primary-button" type="button" onClick={confirmTimeline}>この内容で確定</button><span>{timelineConfirmedAt ? '確定済み' : fullReviewCompletedAt ? '全体確認済み・未確定' : '確定前に全体確認が必要です'}</span></div>
          </div>
        </div> : <p className="analysis-hint">録画を完了するか、マニュアルを作成するWebMを選択してください。</p>}
      </section>

      <dialog ref={reviewDialogRef} className="review-dialog" onClose={() => setReviewDialog(null)}>
        {reviewDialog?.type === 'point' && <div className="dialog-content">
          <div className="dialog-heading"><div><p className="section-number">POINT PREVIEW</p><h3>★ポイント{reviewDialog.point.order}</h3></div><span>{reviewDialog.point.timeLabel}（{reviewDialog.point.timeSeconds}秒）</span></div>
          <img className="dialog-point-image" src={reviewDialog.point.previewUrl} alt={`★ポイント${reviewDialog.point.order}の拡大画像`} />
          <div className="dialog-actions"><button className="primary-button" type="button" onClick={closeReviewDialog}>閉じる</button></div>
        </div>}
      </dialog>

      <section className="analysis-card" aria-labelledby="analysis-title"><div className="preview-heading"><div><p className="section-number">03</p><h2 id="analysis-title">解析データを作成</h2></div><span className="ready-label">STEP 2-1</span></div><p className="analysis-lead">指定情報をJSONにまとめ、AI解析用の補助画像を一定間隔で生成します。すべてブラウザ内で処理します。</p><div className="analysis-settings"><label>補助画像の間隔<select value={frameInterval} onChange={(event) => { resetAnalysis(); setFrameInterval(Number(event.target.value)) }}>{FRAME_INTERVAL_OPTIONS.map((seconds) => <option key={seconds} value={seconds}>{seconds}秒</option>)}</select></label><p>補助画像は最大30枚。★ポイントPNGが主データです。</p></div><button className="primary-button" type="button" onClick={prepareAnalysis} disabled={analysisBusy || !reviewUrl}>{analysisBusy ? '解析データ作成中…' : '解析データを作成'}</button>{!reviewUrl && <p className="analysis-hint">録画を完了するか、保存済みWebMを選択してください。</p>}{analysisMessage && <div className="privacy-note" aria-live="polite"><span aria-hidden="true">◆</span><p>{analysisMessage}</p></div>}{analysisResult && <div className="analysis-result"><div className="analysis-summary"><h3>解析データ</h3><dl><div><dt>元WebM</dt><dd>{analysisResult.document.recording.fileName}</dd></div><div><dt>原本</dt><dd>変更なし</dd></div><div><dt>ポイント</dt><dd>{points.length}件</dd></div><div><dt>動画区間</dt><dd>{videoSegments.length}件</dd></div><div><dt>削除予定</dt><dd>{excludedSegments.length}件</dd></div><div><dt>補助PNG</dt><dd>{analysisResult.frames.length}枚</dd></div></dl></div><div className="preview-actions"><button className="secondary-button" type="button" onClick={saveOriginalWebM}>元WebMを保存</button><button className="secondary-button" type="button" onClick={copyAnalysisJson}>JSONをコピー</button><button className="primary-button" type="button" onClick={() => downloadJson(analysisResult.document)}>JSONを保存</button></div><details><summary>解析用JSONを確認</summary><pre className="json-preview">{analysisJson(analysisResult.document)}</pre></details><h3 className="supplement-heading">AI解析用の補助画像</h3><div className="frame-grid">{analysisResult.frames.map((frame) => <figure key={frame.fileName}><img src={frame.previewUrl} alt={`${frame.timeLabel}時点の補助画像`} onLoad={(event) => { if (!event.currentTarget.naturalWidth || !event.currentTarget.naturalHeight) setAnalysisMessage('補助画像を正常に表示できませんでした。') }} onError={() => setAnalysisMessage('補助画像を読み込めませんでした。')} /><figcaption><span>{frame.timeLabel}</span><button type="button" onClick={() => downloadBlob(frame.blob, frame.fileName)}>PNG保存</button></figcaption></figure>)}</div></div>}</section>
      <footer><p>録画データを外部へ自動送信しません</p><p>対応環境：Windows版 Google Chrome / Microsoft Edge</p></footer>
    </main>
  )
}

export default App
