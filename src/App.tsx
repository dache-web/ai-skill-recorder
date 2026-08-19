import { useEffect, useMemo, useReducer, useRef, useState } from 'react'
import { createAnalysisPackage } from './analysis/analysisPackage'
import { analysisJson, downloadBlob, downloadJson } from './analysis/export'
import { captureVideoFrame, FRAME_INTERVAL_OPTIONS, seekToFrame } from './analysis/frameExtractor'
import { captureReviewPoint, createSegment, MAX_POINT_COUNT, normalizeTime, pointData } from './analysis/reviewAnnotations'
import type { AnalysisResult, Annotation, AnnotationType, InsertedAssetData, InsertedSlide, ManualTimelineItem, RecordingSource, ReviewPoint, ReviewSegment, TimelineItem } from './analysis/types'
import { canvasToPngBlob, drawAnnotations, visibleAnnotations } from './annotationRenderer'
import { findTimelineOverlaps, findUnclassifiedIntervals, reorderTimeline, timelineConfirmationIssue, timelinePoint, timelineSegment, type UnclassifiedInterval } from './manualTimeline'
import { formatElapsed, safeRecordingName, supportedMimeType, type RecorderStatus, userFacingCaptureError } from './recorder'
import { initialReviewWorkflow, reviewWorkflowReducer, type ResumeAfter } from './reviewWorkflow'
import AnnotationOverlay from './AnnotationOverlay'

const stopTracks = (stream: MediaStream | null) => stream?.getTracks().forEach((track) => track.stop())
const ordered = <T extends { order: number }>(items: T[]): T[] => items.map((item, index) => ({ ...item, order: index + 1 }))
type RuntimeAsset = { data: InsertedAssetData; blob: Blob; previewUrl: string }
type EditorSnapshot = { points: ReviewPoint[]; videoSegments: ReviewSegment[]; excludedSegments: ReviewSegment[]; timelineItems: TimelineItem[]; timelineThumbnails: Record<string, { blob: Blob; previewUrl: string }>; annotations: Annotation[]; insertedAssets: RuntimeAsset[]; insertedSlides: InsertedSlide[] }

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
  const [workspaceMode, setWorkspaceMode] = useState<'edit' | 'organize'>('edit')
  const [showTrash, setShowTrash] = useState(false)
  const [annotations, setAnnotations] = useState<Annotation[]>([])
  const [selectedAnnotationId, setSelectedAnnotationId] = useState<string | null>(null)
  const [insertedAssets, setInsertedAssets] = useState<RuntimeAsset[]>([])
  const [insertedSlides, setInsertedSlides] = useState<InsertedSlide[]>([])
  const [annotationSequence, setAnnotationSequence] = useState(0)
  const [assetSequence, setAssetSequence] = useState(0)
  const [slideSequence, setSlideSequence] = useState(0)
  const [, setHistoryVersion] = useState(0)
  const [videoDuration, setVideoDuration] = useState(0)
  const [reviewWorkflow, dispatchReviewWorkflow] = useReducer(reviewWorkflowReducer, initialReviewWorkflow)
  const [reviewMessage, setReviewMessage] = useState('')
  const [videoReady, setVideoReady] = useState(false)
  const [videoPlaying, setVideoPlaying] = useState(false)
  const [reviewCurrentTime, setReviewCurrentTime] = useState(0)
  const [mediaAspectRatio, setMediaAspectRatio] = useState(16 / 9)
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
  const timelineStripRef = useRef<HTMLDivElement>(null)
  const timelineCardRefs = useRef<Record<string, HTMLElement | null>>({})
  const mainImageRef = useRef<HTMLImageElement>(null)
  const imageInputRef = useRef<HTMLInputElement>(null)
  const imageInsertModeRef = useRef<'overlay' | 'slide'>('overlay')
  const pastRef = useRef<EditorSnapshot[]>([])
  const futureRef = useRef<EditorSnapshot[]>([])
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
    const strip = timelineStripRef.current; const card = selectedTimelineId ? timelineCardRefs.current[selectedTimelineId] : null
    if (!strip || !card || typeof strip.scrollTo !== 'function') return
    strip.scrollTo({ left: Math.max(0, card.offsetLeft - (strip.clientWidth - card.offsetWidth) / 2), behavior: 'smooth' })
  }, [selectedTimelineId, workspaceMode])
  useEffect(() => {
    const handleDelete = (event: KeyboardEvent) => {
      if (!selectedAnnotationId || (event.key !== 'Delete' && event.key !== 'Backspace')) return
      const target = event.target
      if (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement || (target instanceof HTMLElement && target.isContentEditable)) return
      event.preventDefault(); deleteAnnotation(selectedAnnotationId)
    }
    window.addEventListener('keydown', handleDelete)
    return () => window.removeEventListener('keydown', handleDelete)
  })

  const resetAnalysis = () => {
    analysisResult?.frames.forEach((frame) => URL.revokeObjectURL(frame.previewUrl))
    setAnalysisResult(null); setAnalysisMessage('')
  }
  const editorSnapshot = (): EditorSnapshot => ({ points, videoSegments, excludedSegments, timelineItems, timelineThumbnails, annotations, insertedAssets, insertedSlides })
  const applyEditorSnapshot = (snapshot: EditorSnapshot) => {
    setPoints(snapshot.points); setVideoSegments(snapshot.videoSegments); setExcludedSegments(snapshot.excludedSegments); setTimelineItems(snapshot.timelineItems); setTimelineThumbnails(snapshot.timelineThumbnails); setAnnotations(snapshot.annotations); setInsertedAssets(snapshot.insertedAssets); setInsertedSlides(snapshot.insertedSlides)
    setFullReviewActive(false); setFullReviewCompletedAt(null); setTimelineConfirmedAt(null); setOverlapAcknowledgedAt(null); timelinePlaybackRef.current = null; resetAnalysis()
  }
  const recordEdit = () => { pastRef.current = [...pastRef.current, editorSnapshot()].slice(-100); futureRef.current = []; setHistoryVersion((value) => value + 1) }
  const undoEdit = () => {
    const previous = pastRef.current.at(-1); if (!previous) return
    futureRef.current = [editorSnapshot(), ...futureRef.current]; pastRef.current = pastRef.current.slice(0, -1); applyEditorSnapshot(previous); setHistoryVersion((value) => value + 1)
  }
  const redoEdit = () => {
    const next = futureRef.current[0]; if (!next) return
    pastRef.current = [...pastRef.current, editorSnapshot()].slice(-100); futureRef.current = futureRef.current.slice(1); applyEditorSnapshot(next); setHistoryVersion((value) => value + 1)
  }
  const markTimelineChanged = () => {
    setFullReviewActive(false); setFullReviewCompletedAt(null); setTimelineConfirmedAt(null); setOverlapAcknowledgedAt(null); timelinePlaybackRef.current = null
    resetAnalysis()
  }
  const appendTimelineItem = (item: Omit<TimelineItem, 'registeredOrder' | 'manualOrder'>) => {
    recordEdit()
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
    insertedAssets.forEach((asset) => URL.revokeObjectURL(asset.previewUrl))
    setPoints([]); setVideoSegments([]); setExcludedSegments([]); setTimelineItems([]); setTimelineThumbnails({}); setAnnotations([]); setInsertedAssets([]); setInsertedSlides([]); setSelectedTimelineId(null); setSelectedAnnotationId(null); setFullReviewActive(false); setFullReviewCompletedAt(null); setTimelineConfirmedAt(null); setOverlapAcknowledgedAt(null); setVideoDuration(0); dispatchReviewWorkflow({ type: 'RESET' }); setReviewMessage(''); setVideoPlaying(false); playRequestRef.current = null
    pointSequenceRef.current = 0; videoSegmentSequenceRef.current = 0; excludedSegmentSequenceRef.current = 0
    timelineSequenceRef.current = 0; timelinePlaybackRef.current = null; pastRef.current = []; futureRef.current = []; setHistoryVersion((value) => value + 1); setAnnotationSequence(0); setAssetSequence(0); setSlideSequence(0)
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
      recordEdit()
      setPoints((current) => current.map((point) => {
        if (point.id !== id) return point
        URL.revokeObjectURL(point.previewUrl); return { ...replacement, id: point.id, order: point.order }
      }))
      dispatchReviewWorkflow({ type: 'POINT_ADDED' })
      markTimelineChanged(); setReviewMessage(`${replacement.timeLabel}へポイント位置と画像を変更しました。`)
    } catch (pointError) { setReviewMessage(pointError instanceof Error ? pointError.message : 'ポイントを変更できませんでした。') }
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
      recordEdit()
      setter((current) => current.map((segment) => segment.id === id ? replacement : segment))
      markTimelineChanged(); setReviewMessage(`${boundary === 'start' ? '開始' : '終了'}位置を変更しました。`)
    } catch (segmentError) { setReviewMessage(segmentError instanceof Error ? segmentError.message : '区間を変更できませんでした。') }
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
    annotations,
    insertedAssets: insertedAssets.map((asset) => asset.data),
    insertedSlides,
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
    if (video?.videoWidth && video.videoHeight) setMediaAspectRatio(video.videoWidth / video.videoHeight)
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
    setReviewCurrentTime(video.currentTime)
    timelinePlaybackRef.current = null; if (!preserveFullReview) setFullReviewActive(false); setVideoPlaying(false); if (timelineId) setSelectedTimelineId(timelineId)
    dispatchReviewWorkflow({ type: 'SEEKED' }); setReviewMessage(`${label}を動画で確認しています。`)
  }

  const timelineItemTime = (item: TimelineItem): number | null => {
    if (item.contentType === 'image-slide') return 0
    const point = timelinePoint(item, points); if (point) return point.timeSeconds
    return timelineSegment(item, videoSegments, excludedSegments)?.startSeconds ?? null
  }
  const selectTimelineItem = (item: TimelineItem, preserveFullReview = false) => {
    if (item.contentType === 'image-slide') { previewRef.current?.pause(); timelinePlaybackRef.current = null; if (!preserveFullReview) setFullReviewActive(false); setVideoPlaying(false); setSelectedTimelineId(item.id); setReviewMessage('挿入ページを編集中です。'); return }
    const time = timelineItemTime(item); if (time === null) return
    showInMainVideo(time, item.contentType === 'point' ? '★ポイント' : item.status === 'excluded' ? '削除予定' : '動画区間', item.id, preserveFullReview)
  }
  const moveTimelineSelection = (direction: -1 | 1) => {
    if (!visibleTimelineItems.length || activeSegment) { if (activeSegment) setReviewMessage('先に開始中の区間を終了またはキャンセルしてください。'); return }
    const currentIndex = visibleTimelineItems.findIndex((item) => item.id === selectedTimelineId)
    const targetIndex = currentIndex < 0 ? (direction > 0 ? 0 : visibleTimelineItems.length - 1) : currentIndex + direction
    const target = visibleTimelineItems[targetIndex]
    if (target) selectTimelineItem(target, fullReviewActive)
    else if (fullReviewActive && direction > 0) { previewRef.current?.pause(); setFullReviewActive(false); setFullReviewCompletedAt(new Date().toISOString()); setReviewMessage('タイムライン全体の確認が完了しました。') }
  }
  const playFullReviewItem = async (item: TimelineItem) => {
    const video = previewRef.current; if (!video) return
    setSelectedTimelineId(item.id); setFullReviewActive(true)
    const point = timelinePoint(item, points)
    if (item.contentType === 'image-slide') { video.pause(); setVideoPlaying(false); timelinePlaybackRef.current = null; setReviewMessage('静止ページを確認中です。確認後「次へ」を押してください。'); return }
    if (point) { video.pause(); video.currentTime = point.timeSeconds; setReviewCurrentTime(point.timeSeconds); setVideoPlaying(false); timelinePlaybackRef.current = null; setReviewMessage('★ポイントを確認中です。確認後「次へ」を押してください。'); return }
    const segment = timelineSegment(item, videoSegments, excludedSegments); if (!segment) return
    video.pause(); video.currentTime = segment.startSeconds; setReviewCurrentTime(segment.startSeconds)
    timelinePlaybackRef.current = { itemId: item.id, endSeconds: segment.endSeconds }
    const messageText = item.status === 'excluded' ? '削除予定を確認中です。元WebMからは削除されていません。' : '動画区間を全体確認中です。'
    setReviewMessage(messageText)
    await resumeReviewPlayback(messageText)
  }
  const startFullReview = () => {
    if (activeSegment) { setReviewMessage('先に開始中の区間を終了またはキャンセルしてください。'); return }
    if (!completionTimelineItems.length) { setReviewMessage('完成版で確認する項目がありません。'); return }
    setFullReviewCompletedAt(null); void playFullReviewItem(completionTimelineItems[0])
  }
  const handleTimelinePlayback = (video: HTMLVideoElement) => {
    const playback = timelinePlaybackRef.current
    if (!playback || video.currentTime < playback.endSeconds) return
    video.pause(); timelinePlaybackRef.current = null
    const index = completionTimelineItems.findIndex((item) => item.id === playback.itemId)
    const next = completionTimelineItems[index + 1]
    if (next) void playFullReviewItem(next)
    else { setFullReviewActive(false); setFullReviewCompletedAt(new Date().toISOString()); setReviewMessage('タイムライン全体の確認が完了しました。') }
  }
  const moveTimelineItem = (id: string, direction: -1 | 1) => {
    const visible = timelineItems.filter((item) => (item.placement ?? 'timeline') === 'timeline')
    const index = visible.findIndex((item) => item.id === id); if (index < 0 || index + direction < 0 || index + direction >= visible.length) return
    recordEdit()
    setTimelineItems((current) => { const active = current.filter((item) => (item.placement ?? 'timeline') === 'timeline'); const trash = current.filter((item) => item.placement === 'trash'); return [...reorderTimeline(active, index, index + direction), ...trash] }); previewRef.current?.pause(); markTimelineChanged(); setSelectedTimelineId(id); setReviewMessage('マニュアル上の順番を変更しました。元動画時刻は変更されていません。')
  }
  const dropTimelineItem = (targetId: string) => {
    if (!draggedTimelineId || draggedTimelineId === targetId) { setDraggedTimelineId(null); return }
    const visible = timelineItems.filter((item) => (item.placement ?? 'timeline') === 'timeline')
    const from = visible.findIndex((item) => item.id === draggedTimelineId)
    const to = visible.findIndex((item) => item.id === targetId)
    if (from >= 0 && to >= 0) { recordEdit(); setTimelineItems((current) => { const active = current.filter((item) => (item.placement ?? 'timeline') === 'timeline'); const trash = current.filter((item) => item.placement === 'trash'); return [...reorderTimeline(active, from, to), ...trash] }); previewRef.current?.pause(); markTimelineChanged(); setSelectedTimelineId(draggedTimelineId); setReviewMessage('ドラッグ操作でマニュアル上の順番を変更しました。') }
    setDraggedTimelineId(null)
  }
  const toggleTimelineStatus = (id: string) => {
    recordEdit()
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
    const timelineValid = Boolean(completionTimelineItems.length) && !visibleTimelineItems.some((item, index) => item.manualOrder !== index + 1 || timelineItemTime(item) === null) && !visibleTimelineItems.some((item) => item.contentType === 'video' && !timelineThumbnails[item.id]) && !points.some((point) => !point.previewUrl) && !visibleTimelineItems.some((item) => item.contentType === 'image-slide' && !insertedSlides.some((slide) => slide.id === item.slideId))
    const issue = timelineConfirmationIssue({ durationSeconds: videoDuration, unclassifiedCount: unclassifiedIntervals.length, timelineValid, fullReviewCompleted: Boolean(fullReviewCompletedAt), overlapCount: timelineOverlaps.length, overlapAcknowledged: Boolean(overlapAcknowledgedAt) })
    if (issue === 'duration') { setReviewMessage('動画時間を取得できないため確定できません。'); return }
    if (issue === 'unclassified') { setReviewMessage(`元動画にまだ判断されていない区間が${unclassifiedIntervals.length}件あります。`); return }
    if (issue === 'timeline') { setReviewMessage('タイムラインの順序、参照データ、またはサムネイルが不正なため確定できません。'); return }
    if (issue === 'full-review') { setReviewMessage('確定前に「全体を確認」を完了してください。'); return }
    if (issue === 'overlap') { setReviewMessage('重複区間があります。内容を確認し、「重複を確認済みにする」を押してください。'); return }
    const now = new Date().toISOString(); setTimelineConfirmedAt(now); setReviewMessage('この内容でマニュアル構成を確定しました。元WebMは変更されていません。'); resetAnalysis()
  }

  const timelinePlacement = (item: TimelineItem) => item.placement ?? 'timeline'
  const visibleTimelineItems = timelineItems.filter((item) => timelinePlacement(item) === 'timeline')
  const completionTimelineItems = visibleTimelineItems.filter((item) => item.status === 'active')
  const selectedTimelineItem = timelineItems.find((item) => item.id === selectedTimelineId) ?? null
  const selectedPoint = selectedTimelineItem ? timelinePoint(selectedTimelineItem, points) : null
  const selectedSegment = selectedTimelineItem ? timelineSegment(selectedTimelineItem, videoSegments, excludedSegments) : null
  const selectedSlide = selectedTimelineItem?.slideId ? insertedSlides.find((slide) => slide.id === selectedTimelineItem.slideId) ?? null : null
  const selectedSlideAsset = selectedSlide?.assetId ? insertedAssets.find((asset) => asset.data.id === selectedSlide.assetId) ?? null : null
  const currentAnnotations = visibleAnnotations(annotations, selectedTimelineId, selectedTimelineItem?.contentType === 'video' ? reviewCurrentTime : null)

  const trashTimelineItem = (id: string) => { recordEdit(); setTimelineItems((current) => { const target = current.find((item) => item.id === id); if (!target) return current; const active = current.filter((item) => item.id !== id && (item.placement ?? 'timeline') === 'timeline').map((item, index) => ({ ...item, manualOrder: index + 1 })); const trash = current.filter((item) => item.id !== id && item.placement === 'trash'); return [...active, ...trash, { ...target, placement: 'trash' as const, trashedFromManualOrder: target.manualOrder }] }); if (selectedTimelineId === id) setSelectedTimelineId(null); markTimelineChanged(); setReviewMessage('項目をゴミ箱へ移動しました。元データは削除されていません。') }
  const restoreTimelineItem = (id: string) => { recordEdit(); setTimelineItems((current) => { const target = current.find((item) => item.id === id); if (!target) return current; const active = current.filter((item) => (item.placement ?? 'timeline') === 'timeline'); const insertAt = Math.max(0, Math.min(active.length, (target.trashedFromManualOrder ?? active.length + 1) - 1)); active.splice(insertAt, 0, { ...target, placement: 'timeline' }); const trash = current.filter((item) => item.id !== id && item.placement === 'trash'); return [...active.map((item, index) => ({ ...item, manualOrder: index + 1 })), ...trash] }); markTimelineChanged(); setSelectedTimelineId(id); setReviewMessage('ゴミ箱から元の項目を復元しました。') }

  const addAnnotation = (type: AnnotationType, text = '') => {
    if (!selectedTimelineItem) { setReviewMessage('先に注釈を追加するタイムライン項目を選択してください。'); return }
    previewRef.current?.pause(); setVideoPlaying(false); timelinePlaybackRef.current = null
    const sequence = annotationSequence + 1; setAnnotationSequence(sequence); recordEdit()
    const start = selectedSegment ? selectedSegment.startSeconds : null
    if (start !== null) setReviewCurrentTime(start)
    const existingCount = annotations.filter((annotation) => annotation.targetTimelineId === selectedTimelineItem.id).length
    const offset = (existingCount % 6) * .025
    const annotation: Annotation = { id: `annotation-${sequence}`, targetTimelineId: selectedTimelineItem.id, type, source: 'user', status: 'accepted', startSeconds: start, endSeconds: selectedSegment ? selectedSegment.endSeconds : null, geometry: { x: .2 + offset, y: .2 + offset, width: .24, height: .16, rotationDegrees: 0 }, style: { strokeColor: '#e13f2b', fillColor: type === 'rectangle' || type === 'ellipse' ? 'rgba(255,255,255,0)' : '#e13f2b', textColor: '#172525', strokeWidth: 4, opacity: 1, fontSize: 34 }, text }
    setAnnotations((current) => [...current, annotation]); setSelectedAnnotationId(annotation.id); markTimelineChanged(); setReviewMessage('注釈を追加しました。位置とサイズを編集できます。')
  }
  const updateSelectedAnnotation = (updates: Partial<Annotation>) => { if (!selectedAnnotationId) return; recordEdit(); setAnnotations((current) => current.map((annotation) => annotation.id === selectedAnnotationId ? { ...annotation, ...updates } : annotation)); markTimelineChanged() }
  const changeAnnotationGeometry = (id: string, geometry: Annotation['geometry']) => setAnnotations((current) => current.map((annotation) => annotation.id === id ? { ...annotation, geometry } : annotation))
  const deleteAnnotation = (id: string) => { recordEdit(); setAnnotations((current) => current.filter((annotation) => annotation.id !== id)); if (selectedAnnotationId === id) setSelectedAnnotationId(null); markTimelineChanged(); setReviewMessage('注釈を削除しました。') }

  const addSlide = (slideType: InsertedSlide['slideType']) => {
    const title = slideType === 'blank' ? '' : window.prompt(slideType === 'title' ? 'タイトルを入力してください' : '章見出しを入力してください', slideType === 'title' ? 'マニュアルタイトル' : 'STEP 1')
    if (title === null) return
    const sequence = slideSequence + 1; setSlideSequence(sequence)
    const slide: InsertedSlide = { id: `slide-${sequence}`, slideType, title, subtitle: '', backgroundColor: slideType === 'section' ? '#173f39' : '#ffffff' }
    setInsertedSlides((current) => [...current, slide])
    const timelineId = `timeline-${timelineSequenceRef.current + 1}`
    appendTimelineItem({ id: timelineId, contentType: 'image-slide', origin: 'inserted', slideId: slide.id, thumbnailFileName: `slide_${String(sequence).padStart(3, '0')}.png`, status: 'active', placement: 'timeline', trashedFromManualOrder: null })
    setReviewMessage('新しい静止ページをタイムラインへ追加しました。')
  }
  const loadImageFile = async (file: File): Promise<{ width: number; height: number; previewUrl: string }> => {
    if (!['image/png', 'image/jpeg', 'image/webp'].includes(file.type)) throw new Error('PNG、JPEG、WebP画像を選択してください。SVGは対応していません。')
    if (file.size > 10 * 1024 * 1024) throw new Error('画像は10MB以下にしてください。')
    const previewUrl = URL.createObjectURL(file); const image = new Image(); image.src = previewUrl
    await new Promise<void>((resolve, reject) => { image.onload = () => resolve(); image.onerror = () => reject(new Error('画像を読み込めませんでした。')) })
    if (!image.naturalWidth || !image.naturalHeight || image.naturalWidth > 8192 || image.naturalHeight > 8192 || image.naturalWidth * image.naturalHeight > 40_000_000) { URL.revokeObjectURL(previewUrl); throw new Error('画像寸法が上限を超えています。') }
    return { width: image.naturalWidth, height: image.naturalHeight, previewUrl }
  }
  const importImage = async (file: File | null) => {
    if (!file) return
    try {
      const loaded = await loadImageFile(file); const sequence = assetSequence + 1; setAssetSequence(sequence)
      const asset: RuntimeAsset = { data: { id: `asset-${sequence}`, fileName: file.name, mimeType: file.type, sizeBytes: file.size, width: loaded.width, height: loaded.height }, blob: file, previewUrl: loaded.previewUrl }
      if (imageInsertModeRef.current === 'overlay') {
        if (!selectedTimelineItem) { URL.revokeObjectURL(asset.previewUrl); setReviewMessage('画像を重ねる項目を先に選択してください。'); return }
        previewRef.current?.pause(); setVideoPlaying(false); timelinePlaybackRef.current = null
        recordEdit(); setInsertedAssets((current) => [...current, asset]); const annotationId = `annotation-${annotationSequence + 1}`; setAnnotationSequence((value) => value + 1)
        setAnnotations((current) => [...current, { id: annotationId, targetTimelineId: selectedTimelineItem.id, type: 'image', source: 'user', status: 'accepted', startSeconds: selectedSegment?.startSeconds ?? null, endSeconds: selectedSegment?.endSeconds ?? null, geometry: { x: .56, y: .56, width: .3, height: .28, rotationDegrees: 0 }, style: { strokeColor: '#ffffff', fillColor: '#ffffff', textColor: '#172525', strokeWidth: 0, opacity: 1 }, assetId: asset.data.id }]); setSelectedAnnotationId(annotationId); markTimelineChanged()
      } else {
        const slideSequenceValue = slideSequence + 1; setSlideSequence(slideSequenceValue); const slide: InsertedSlide = { id: `slide-${slideSequenceValue}`, slideType: 'external-image', assetId: asset.data.id, backgroundColor: '#ffffff' }; setInsertedAssets((current) => [...current, asset]); setInsertedSlides((current) => [...current, slide]); const timelineId = `timeline-${timelineSequenceRef.current + 1}`; appendTimelineItem({ id: timelineId, contentType: 'image-slide', origin: 'inserted', slideId: slide.id, thumbnailFileName: asset.data.fileName, status: 'active', placement: 'timeline', trashedFromManualOrder: null })
      }
      setReviewMessage('画像を追加しました。元画像は変更されていません。')
    } catch (imageError) { setReviewMessage(imageError instanceof Error ? imageError.message : '画像を追加できませんでした。') }
    finally { if (imageInputRef.current) imageInputRef.current.value = '' }
  }

  const loadAssetImage = (asset: RuntimeAsset): Promise<HTMLImageElement> => new Promise((resolve, reject) => { const image = new Image(); image.onload = () => resolve(image); image.onerror = () => reject(new Error('挿入画像を描画できませんでした。')); image.src = asset.previewUrl })
  const saveCurrentView = async () => {
    const video = previewRef.current; const image = mainImageRef.current
    try {
      let width = 1600; let height = 900; const canvas = document.createElement('canvas')
      if (selectedPoint && image) { width = image.naturalWidth || 1280; height = image.naturalHeight || 720 }
      else if (selectedSlideAsset && image) { width = selectedSlideAsset.data.width; height = selectedSlideAsset.data.height }
      else if (!selectedSlide && video?.videoWidth) { width = video.videoWidth; height = video.videoHeight }
      canvas.width = width; canvas.height = height; const context = canvas.getContext('2d'); if (!context) throw new Error('画像保存用Canvasを利用できません。')
      if (selectedSlide && !selectedSlideAsset) { context.fillStyle = selectedSlide.backgroundColor; context.fillRect(0, 0, width, height); context.fillStyle = selectedSlide.slideType === 'section' ? '#ffffff' : '#172525'; context.font = 'bold 72px sans-serif'; context.textAlign = 'center'; context.fillText(selectedSlide.title ?? '', width / 2, height / 2) }
      else if (image) context.drawImage(image, 0, 0, width, height)
      else if (video) context.drawImage(video, 0, 0, width, height)
      const annotationAssets = await Promise.all(insertedAssets.map(async (asset) => ({ id: asset.data.id, image: await loadAssetImage(asset) })))
      drawAnnotations(context, width, height, currentAnnotations, annotationAssets)
      const blob = await canvasToPngBlob(canvas); downloadBlob(blob, `current_view_${String(Math.max(1, visibleTimelineItems.findIndex((item) => item.id === selectedTimelineId) + 1)).padStart(3, '0')}.png`); setReviewMessage('現在表示中の完成画面をPNGで保存しました。')
    } catch (saveError) { setReviewMessage(saveError instanceof Error ? saveError.message : '画像を保存できませんでした。') }
  }

  const timelineCard = (item: TimelineItem, index: number) => {
    const point = timelinePoint(item, points)
    const segment = timelineSegment(item, videoSegments, excludedSegments)
    const isSelected = item.id === selectedTimelineId
    const slide = item.slideId ? insertedSlides.find((candidate) => candidate.id === item.slideId) : null
    const slideAsset = slide?.assetId ? insertedAssets.find((asset) => asset.data.id === slide.assetId) : null
    const thumbnail = point ? point.previewUrl : slideAsset?.previewUrl ?? timelineThumbnails[item.id]?.previewUrl
    const label = point ? '★ポイント' : slide ? slide.slideType === 'title' ? 'タイトル' : slide.slideType === 'section' ? '章区切り' : slide.slideType === 'blank' ? '白紙ページ' : '挿入画像' : item.status === 'excluded' ? '削除予定' : '動画'
    return <article ref={(element) => { timelineCardRefs.current[item.id] = element }} key={item.id} onClick={() => selectTimelineItem(item)} onDragOver={(event) => event.preventDefault()} onDrop={() => dropTimelineItem(item.id)} className={`timeline-item compact ${item.status === 'excluded' ? 'is-excluded' : ''} ${isSelected ? 'is-reviewing' : ''}`} aria-current={isSelected ? 'true' : undefined}>
      <div className="timeline-card-heading"><span className="drag-handle" draggable onDragStart={(event) => { event.stopPropagation(); setDraggedTimelineId(item.id) }} onDragEnd={() => setDraggedTimelineId(null)} title="ドラッグして順番を変更">☰</span><strong>{index + 1}. {label}</strong>{isSelected && <span className="current-editing-label">編集中</span>}</div>
      {thumbnail ? <img className="timeline-thumbnail" src={thumbnail} alt={`${label}${index + 1}の実画面サムネイル`} /> : slide ? <div className="slide-thumbnail" style={{ background: slide.backgroundColor }}><strong>{slide.title}</strong></div> : <div className="thumbnail-missing">画像なし</div>}
      <p className="timeline-time">{point ? point.timeLabel : segment ? `${formatElapsed(Math.floor(segment.startSeconds))} → ${formatElapsed(Math.floor(segment.endSeconds))}` : '静止ページ'}</p>
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
      <section className="recorder-card compact-recorder" aria-labelledby="recorder-title"><div className="recorder-topline"><div><p className="section-number">01</p><h2 id="recorder-title">画面を録画</h2></div><div className="timer" aria-label={`録画経過時間 ${formatElapsed(elapsed)}`}>{formatElapsed(elapsed)}</div></div><div className="compact-recorder-status"><div className={`mic-state ${micActive ? 'active' : ''}`}><span className="mic-icon" aria-hidden="true">●</span><div><small>MICROPHONE</small><strong>{micActive ? 'マイク取得中' : 'マイクなし'}</strong></div></div><p>{message}</p></div>{error && <div className="error-box" role="alert">{error}</div>}<div className="compact-recorder-actions">{status !== 'recording' && <button className="primary-button" type="button" onClick={startRecording} disabled={isBusy}>{status === 'requesting' ? '画面を選択中…' : '● 録画開始'}</button>}{status === 'recording' && <button className="stop-button" type="button" onClick={finishRecording}><span aria-hidden="true" /> 録画停止</button>}<label className="secondary-button recorder-file-button">録画ファイルを開く<input type="file" accept="video/webm,.webm" onChange={(event) => importWebM(event.target.files?.[0] ?? null)} /></label></div></section>

      <section className="review-card" aria-labelledby="review-title">
        <div className="preview-heading"><div><p className="section-number">02</p><h2 id="review-title">編集画面</h2></div><span className="ready-label">REVIEW</span></div>
        {!reviewUrl && videoSourceControls}
        <p className="review-guidance">動画を見ながら、重要な場面、動画で残す部分、不要な部分を指定します。元WebMは変更されません。</p>
        {reviewUrl ? <div ref={reviewWorkspaceRef} className={`review-workspace redesigned mode-${workspaceMode}`}>
          <div className="review-stage" hidden={workspaceMode !== 'edit'}>
            {videoSourceControls}
            <div className="media-editor"><div className="media-viewport"><div className="media-content" style={{ aspectRatio: mediaAspectRatio }}>
              <video ref={previewRef} className="video-player review-player" style={{ display: selectedPoint || selectedSlide ? 'none' : 'block' }} src={reviewUrl} controls playsInline preload="auto" onLoadedMetadata={updateVideoReady} onLoadedData={updateVideoReady} onCanPlay={updateVideoReady} onDurationChange={updateVideoReady} onPlay={observeVideoPlay} onPause={() => setVideoPlaying(false)} onEnded={() => setVideoPlaying(false)} onTimeUpdate={(event) => { setReviewCurrentTime(event.currentTarget.currentTime); handleTimelinePlayback(event.currentTarget) }} onSeeking={() => dispatchReviewWorkflow({ type: 'SEEKED' })} />
              {(selectedPoint || selectedSlideAsset) && <img ref={mainImageRef} className="main-static-image" src={selectedPoint?.previewUrl ?? selectedSlideAsset?.previewUrl} alt="現在編集中の静止画" onLoad={(event) => { if (event.currentTarget.naturalHeight) setMediaAspectRatio(event.currentTarget.naturalWidth / event.currentTarget.naturalHeight) }} />}
              {selectedSlide && !selectedSlideAsset && <div className={`main-slide slide-${selectedSlide.slideType}`} style={{ background: selectedSlide.backgroundColor }}><strong>{selectedSlide.title}</strong><span>{selectedSlide.subtitle}</span></div>}
              <AnnotationOverlay annotations={currentAnnotations} assets={insertedAssets} selectedId={selectedAnnotationId} onSelect={setSelectedAnnotationId} onInteractionStart={() => { previewRef.current?.pause(); setVideoPlaying(false); timelinePlaybackRef.current = null; recordEdit() }} onGeometryChange={changeAnnotationGeometry} onInteractionEnd={() => { markTimelineChanged(); setReviewMessage('注釈の位置・大きさを変更しました。') }} onDelete={deleteAnnotation} />
            </div></div><aside className="annotation-toolbar" aria-label="注釈ツール"><details><summary>記号</summary><div className="shape-menu"><button type="button" onClick={() => addAnnotation('arrow')}>矢印</button><button type="button" onClick={() => addAnnotation('ellipse')}>○</button><button type="button" onClick={() => addAnnotation('rectangle')}>□</button><button type="button" onClick={() => addAnnotation('line')}>線</button><button type="button" onClick={() => addAnnotation('callout', '説明')}>吹出</button><button type="button" onClick={() => addAnnotation('step-number', '1')}>番号</button><button type="button" onClick={() => addAnnotation('check')}>✓</button></div></details><button type="button" onClick={() => addAnnotation('text', 'テキスト')}>T</button><details><summary>画像</summary><div className="image-menu"><button type="button" onClick={() => { previewRef.current?.pause(); setVideoPlaying(false); timelinePlaybackRef.current = null; imageInsertModeRef.current = 'overlay'; imageInputRef.current?.click() }}>画面に追加</button><button type="button" onClick={() => { previewRef.current?.pause(); setVideoPlaying(false); timelinePlaybackRef.current = null; imageInsertModeRef.current = 'slide'; imageInputRef.current?.click() }}>新規ページに追加</button></div></details><hr /><button type="button" onClick={() => void saveCurrentView()}>画像を保存</button><input ref={imageInputRef} hidden type="file" accept="image/png,image/jpeg,image/webp" onChange={(event) => void importImage(event.target.files?.[0] ?? null)} /></aside></div>
            <div className="review-controls">
              <button className="review-control playback-button" type="button" onClick={togglePlayback} disabled={!videoReady}>{videoPlaying ? '⏸ 一時停止' : pauseReason ? '▶ 再生を続ける' : '▶ 再生する'}</button>
              <button className="review-control point-button" type="button" onClick={addPoint} disabled={!videoReady}>{pauseReason === 'point' ? '▶ ポイント後を再生' : '★ ポイント'}</button>
              <button className={`review-control ${activeSegment?.kind === 'video' ? 'active-control' : ''}`} type="button" onClick={() => toggleSegment('video')} disabled={!videoReady || Boolean(activeSegment && activeSegment.kind !== 'video')}>{activeSegment?.kind === 'video' ? '動画区間 終了' : pauseReason === 'video-segment' ? '▶ 動画を再開' : '動画区間 開始'}</button>
              <button className={`review-control ${activeSegment?.kind === 'excluded' ? 'active-control excluded' : ''}`} type="button" onClick={() => void toggleSegment('excluded')} disabled={!videoReady || Boolean(activeSegment && activeSegment.kind !== 'excluded')}>{activeSegment?.kind === 'excluded' ? '削除予定 終了' : pauseReason === 'excluded-segment' ? '▶ 動画を再開' : '削除予定 開始'}</button>
              <button className="review-control cancel-control" type="button" disabled={!activeSegment} onClick={() => { if (pendingSegmentThumbnailRef.current) URL.revokeObjectURL(pendingSegmentThumbnailRef.current.previewUrl); pendingSegmentThumbnailRef.current = null; dispatchReviewWorkflow({ type: 'CANCEL_SELECTION' }); setReviewMessage('区間指定をキャンセルしました。') }}>キャンセル</button>
            </div>
            {!videoReady && <p className="video-preparing" aria-live="polite">動画を準備しています…</p>}
            <div className="review-message" aria-live="polite">{activeSegment ? <><strong>{activeSegment.kind === 'video' ? '動画区間' : '削除予定'}を指定中</strong><span>開始：{formatElapsed(Math.floor(activeSegment.startSeconds))}</span>{reviewMessage && <span className="review-workflow-error">{reviewMessage}</span>}</> : reviewMessage ? reviewMessage.split('\n').map((line, index) => index === 0 ? <strong key={`${line}-${index}`}>{line}</strong> : <span key={`${line}-${index}`}>{line}</span>) : <span>動画を再生し、残したい場面を指定してください。</span>}</div>
            <div className="timeline-toolbar"><button type="button" onClick={() => moveTimelineSelection(-1)} disabled={!visibleTimelineItems.length}>← 前の項目</button><strong>{selectedTimelineId ? visibleTimelineItems.findIndex((item) => item.id === selectedTimelineId) + 1 : 0} / {visibleTimelineItems.length}</strong><button type="button" onClick={() => moveTimelineSelection(1)} disabled={!visibleTimelineItems.length}>次の項目 →</button><button type="button" onClick={() => setWorkspaceMode('organize')}>一覧で整理</button><button type="button" onClick={() => { setShowTrash(true); setWorkspaceMode('organize') }}>ゴミ箱</button><button type="button" onClick={undoEdit} disabled={!pastRef.current.length}>↶ 戻す</button><button type="button" onClick={redoEdit} disabled={!futureRef.current.length}>↷ やり直す</button></div>
            {selectedTimelineItem && <div className="selected-item-editor"><strong>{selectedPoint ? '★ポイント' : selectedSlide ? '静止ページ' : selectedTimelineItem.status === 'excluded' ? '削除予定' : '動画'}</strong>{selectedPoint && <><span>{selectedPoint.timeLabel}</span><button type="button" onClick={() => replacePoint(selectedPoint.id)}>現在位置へ変更</button><button type="button" onClick={() => openPointPreview(selectedPoint)}>画像を拡大</button></>}{selectedSegment && <><span>{formatElapsed(Math.floor(selectedSegment.startSeconds))} → {formatElapsed(Math.floor(selectedSegment.endSeconds))}</span><button type="button" onClick={() => changeSegmentBoundary(selectedTimelineItem.sourceCollection === 'excludedSegments' ? 'excluded' : 'video', selectedSegment.id, 'start')}>開始位置を現在位置に変更</button><button type="button" onClick={() => changeSegmentBoundary(selectedTimelineItem.sourceCollection === 'excludedSegments' ? 'excluded' : 'video', selectedSegment.id, 'end')}>終了位置を現在位置に変更</button><button type="button" onClick={() => toggleTimelineStatus(selectedTimelineItem.id)}>{selectedTimelineItem.status === 'excluded' ? '削除予定解除' : '削除予定にする'}</button></>}<button type="button" onClick={() => moveTimelineItem(selectedTimelineItem.id, -1)}>前へ移動</button><button type="button" onClick={() => moveTimelineItem(selectedTimelineItem.id, 1)}>後へ移動</button><button className="danger-link" type="button" onClick={() => trashTimelineItem(selectedTimelineItem.id)}>ゴミ箱へ</button></div>}
            {selectedAnnotationId && (() => { const annotation = annotations.find((candidate) => candidate.id === selectedAnnotationId); return annotation ? <div className="annotation-editor compact"><strong>選択中：{annotation.type}</strong>{annotation.type === 'text' && <input type="text" aria-label="注釈テキスト" value={annotation.text ?? ''} onChange={(event) => updateSelectedAnnotation({ text: event.target.value })} />}{annotation.startSeconds !== null && <><button type="button" onClick={() => updateSelectedAnnotation({ startSeconds: currentVideoTime() ?? annotation.startSeconds })}>表示開始を現在位置</button><button type="button" onClick={() => updateSelectedAnnotation({ endSeconds: currentVideoTime() ?? annotation.endSeconds })}>表示終了を現在位置</button></>}<button className="danger-link" type="button" onClick={() => deleteAnnotation(annotation.id)}>削除</button></div> : null })()}
            {fullReviewActive && <p className="timeline-notice">全体確認中です。固定5ボタンと各カード操作で、そのまま修正できます。</p>}
            {visibleTimelineItems.length === 0 ? <p className="empty-state">動画を見ながら、動画区間・★ポイント・削除予定を登録してください。</p> : <div ref={timelineStripRef} className="timeline-strip">{visibleTimelineItems.map(timelineCard)}</div>}
            <div className="insert-slide-actions"><button type="button" onClick={() => addSlide('title')}>タイトル追加</button><button type="button" onClick={() => addSlide('section')}>章区切り追加</button><button type="button" onClick={() => addSlide('blank')}>白紙ページ追加</button></div>
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
            <div className="timeline-confirm"><button className="secondary-button" type="button" onClick={startFullReview}>編集した内容を再生</button><button className="primary-button" type="button" onClick={confirmTimeline}>この内容で確定</button><span>{timelineConfirmedAt ? '確定済み' : fullReviewCompletedAt ? '完成版確認済み・未確定' : '確定前に完成版確認が必要です'}</span></div>
          </div>
          {workspaceMode === 'organize' && <section className="timeline-organizer"><div className="organizer-toolbar"><button type="button" onClick={() => setWorkspaceMode('edit')}>編集画面へ戻る</button><button type="button" onClick={() => setShowTrash((value) => !value)}>{showTrash ? '通常項目を表示' : 'ゴミ箱を表示'}</button><button type="button" onClick={undoEdit} disabled={!pastRef.current.length}>戻る</button><button type="button" onClick={redoEdit} disabled={!futureRef.current.length}>進む</button></div><h3>{showTrash ? 'ゴミ箱' : 'マニュアル構成を整理'}</h3><div className="organizer-grid">{timelineItems.filter((item) => showTrash ? timelinePlacement(item) === 'trash' : timelinePlacement(item) === 'timeline').map((item, index) => <div key={item.id} className={`organizer-card ${timelinePlacement(item) === 'trash' ? 'is-trash' : ''}`}>{timelineCard(item, index)}{timelinePlacement(item) === 'trash' && <button type="button" onClick={() => restoreTimelineItem(item.id)}>元に戻す</button>}</div>)}</div></section>}
        </div> : <p className="analysis-hint">録画を完了するか、マニュアルを作成するWebMを選択してください。</p>}
      </section>

      <dialog ref={reviewDialogRef} className="review-dialog" onClose={() => setReviewDialog(null)}>
        {reviewDialog?.type === 'point' && <div className="dialog-content">
          <div className="dialog-heading"><div><p className="section-number">POINT PREVIEW</p><h3>★ポイント{reviewDialog.point.order}</h3></div><span>{reviewDialog.point.timeLabel}（{reviewDialog.point.timeSeconds}秒）</span></div>
          <img className="dialog-point-image" src={reviewDialog.point.previewUrl} alt={`★ポイント${reviewDialog.point.order}の拡大画像`} />
          <div className="dialog-actions"><button className="secondary-button" type="button" onClick={() => void saveCurrentView()}>画像を保存</button><button className="primary-button" type="button" onClick={closeReviewDialog}>閉じる</button></div>
        </div>}
      </dialog>

      <section className="analysis-card" aria-labelledby="analysis-title"><div className="preview-heading"><div><p className="section-number">03</p><h2 id="analysis-title">解析データを作成</h2></div><span className="ready-label">STEP 2-1</span></div><p className="analysis-lead">指定情報をJSONにまとめ、AI解析用の補助画像を一定間隔で生成します。すべてブラウザ内で処理します。</p><div className="analysis-settings"><label>補助画像の間隔<select value={frameInterval} onChange={(event) => { resetAnalysis(); setFrameInterval(Number(event.target.value)) }}>{FRAME_INTERVAL_OPTIONS.map((seconds) => <option key={seconds} value={seconds}>{seconds}秒</option>)}</select></label><p>補助画像は最大30枚。★ポイントPNGが主データです。</p></div><button className="primary-button" type="button" onClick={prepareAnalysis} disabled={analysisBusy || !reviewUrl}>{analysisBusy ? '解析データ作成中…' : '解析データを作成'}</button>{!reviewUrl && <p className="analysis-hint">録画を完了するか、保存済みWebMを選択してください。</p>}{analysisMessage && <div className="privacy-note" aria-live="polite"><span aria-hidden="true">◆</span><p>{analysisMessage}</p></div>}{analysisResult && <div className="analysis-result"><div className="analysis-summary"><h3>解析データ</h3><dl><div><dt>元WebM</dt><dd>{analysisResult.document.recording.fileName}</dd></div><div><dt>原本</dt><dd>変更なし</dd></div><div><dt>ポイント</dt><dd>{points.length}件</dd></div><div><dt>動画区間</dt><dd>{videoSegments.length}件</dd></div><div><dt>削除予定</dt><dd>{excludedSegments.length}件</dd></div><div><dt>補助PNG</dt><dd>{analysisResult.frames.length}枚</dd></div></dl></div><div className="preview-actions"><button className="secondary-button" type="button" onClick={saveOriginalWebM}>元WebMを保存</button><button className="secondary-button" type="button" onClick={copyAnalysisJson}>JSONをコピー</button><button className="primary-button" type="button" onClick={() => downloadJson(analysisResult.document)}>JSONを保存</button></div><details><summary>解析用JSONを確認</summary><pre className="json-preview">{analysisJson(analysisResult.document)}</pre></details><h3 className="supplement-heading">AI解析用の補助画像</h3><div className="frame-grid">{analysisResult.frames.map((frame) => <figure key={frame.fileName}><img src={frame.previewUrl} alt={`${frame.timeLabel}時点の補助画像`} onLoad={(event) => { if (!event.currentTarget.naturalWidth || !event.currentTarget.naturalHeight) setAnalysisMessage('補助画像を正常に表示できませんでした。') }} onError={() => setAnalysisMessage('補助画像を読み込めませんでした。')} /><figcaption><span>{frame.timeLabel}</span><button type="button" onClick={() => downloadBlob(frame.blob, frame.fileName)}>PNG保存</button></figcaption></figure>)}</div></div>}</section>
      <footer><p>録画データを外部へ自動送信しません</p><p>対応環境：Windows版 Google Chrome / Microsoft Edge</p></footer>
    </main>
  )
}

export default App
