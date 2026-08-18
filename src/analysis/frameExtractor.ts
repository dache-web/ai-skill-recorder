import { formatElapsed } from '../recorder'
import type { ExtractedFrame } from './types'

export const MAX_FRAME_COUNT = 30
export const FRAME_INTERVAL_OPTIONS = [2, 5, 10] as const

export const frameFileName = (timeSeconds: number): string =>
  `frame_${String(Math.round(timeSeconds)).padStart(4, '0')}.png`

export const calculateFrameTimes = (
  durationSeconds: number,
  requestedIntervalSeconds: number,
  maximumFrames = MAX_FRAME_COUNT,
): { times: number[]; effectiveIntervalSeconds: number } => {
  if (!Number.isFinite(durationSeconds) || durationSeconds <= 0) {
    throw new Error('録画時間を取得できないため、静止画を生成できません。')
  }
  const safeInterval = Math.max(1, requestedIntervalSeconds)
  const minimumInterval = durationSeconds / maximumFrames
  const effectiveIntervalSeconds = Math.max(safeInterval, minimumInterval)
  const times: number[] = []
  for (let time = 0; time < durationSeconds && times.length < maximumFrames; time += effectiveIntervalSeconds) {
    times.push(Number(time.toFixed(3)))
  }
  return { times: times.length ? times : [0], effectiveIntervalSeconds }
}

const waitForEvent = (target: EventTarget, eventName: string): Promise<void> =>
  new Promise((resolve, reject) => {
    const timeout = window.setTimeout(() => { cleanup(); reject(new Error('動画の読み込みがタイムアウトしました。')) }, 15_000)
    const onSuccess = () => { cleanup(); resolve() }
    const onError = () => { cleanup(); reject(new Error('動画を読み込めませんでした。')) }
    const cleanup = () => {
      window.clearTimeout(timeout)
      target.removeEventListener(eventName, onSuccess)
      target.removeEventListener('error', onError)
    }
    target.addEventListener(eventName, onSuccess, { once: true })
    target.addEventListener('error', onError, { once: true })
  })

const loadVideo = async (url: string): Promise<HTMLVideoElement> => {
  const video = document.createElement('video')
  video.preload = 'auto'
  video.muted = true
  video.playsInline = true
  video.src = url
  await waitForEvent(video, 'loadeddata')
  return video
}

const waitForDecodedFrame = async (video: HTMLVideoElement): Promise<void> => {
  if (video.readyState < HTMLMediaElement.HAVE_CURRENT_DATA) await waitForEvent(video, 'loadeddata')
  if (!video.videoWidth || !video.videoHeight) throw new Error('描画可能な動画フレームを取得できませんでした。')
  await new Promise<void>((resolve) => {
    let settled = false
    const finish = () => { if (!settled) { settled = true; window.clearTimeout(timeout); resolve() } }
    const timeout = window.setTimeout(finish, 1000)
    if ('requestVideoFrameCallback' in video) video.requestVideoFrameCallback(() => finish())
    else window.requestAnimationFrame(() => window.requestAnimationFrame(finish))
  })
}

export const seekToFrame = async (video: HTMLVideoElement, timeSeconds: number): Promise<void> => {
  if (Math.abs(video.currentTime - timeSeconds) < 0.01 && video.readyState >= 2) return
  const completed = waitForEvent(video, 'seeked')
  video.currentTime = timeSeconds
  await completed
}

const resolveDuration = async (video: HTMLVideoElement, durationHint?: number): Promise<number> => {
  if (Number.isFinite(video.duration) && video.duration > 0) return video.duration
  if (durationHint && Number.isFinite(durationHint) && durationHint > 0) return durationHint
  const durationChanged = waitForEvent(video, 'durationchange')
  video.currentTime = Number.MAX_SAFE_INTEGER
  try {
    await durationChanged
    if (Number.isFinite(video.duration) && video.duration > 0) {
      const duration = video.duration
      await seekToFrame(video, 0)
      return duration
    }
  } catch {
    // The caller receives the stable user-facing error below.
  }
  throw new Error('録画時間を取得できませんでした。')
}

const canvasToPng = (canvas: HTMLCanvasElement): Promise<Blob> =>
  new Promise((resolve, reject) => canvas.toBlob(
    (blob) => blob ? resolve(blob) : reject(new Error('静止画を生成できませんでした。')),
    'image/png',
  ))

export const captureVideoFrame = async (video: HTMLVideoElement): Promise<Blob> => {
  await waitForDecodedFrame(video)
  const scale = Math.min(1, 1280 / video.videoWidth)
  const canvas = document.createElement('canvas')
  canvas.width = Math.max(1, Math.round(video.videoWidth * scale))
  canvas.height = Math.max(1, Math.round(video.videoHeight * scale))
  const context = canvas.getContext('2d')
  if (!context) throw new Error('静止画生成用Canvasを利用できません。')
  context.drawImage(video, 0, 0, canvas.width, canvas.height)
  const blob = await canvasToPng(canvas)
  if (blob.size <= 0 || blob.type !== 'image/png') throw new Error('正常なPNG画像を生成できませんでした。')
  return blob
}

export const extractFrames = async (
  blob: Blob,
  intervalSeconds: number,
  durationHintSeconds?: number,
): Promise<{ duration: number; width: number; height: number; effectiveIntervalSeconds: number; frames: ExtractedFrame[] }> => {
  const sourceUrl = URL.createObjectURL(blob)
  try {
    const video = await loadVideo(sourceUrl)
    const duration = await resolveDuration(video, durationHintSeconds)
    const width = video.videoWidth
    const height = video.videoHeight
    if (!width || !height) throw new Error('映像トラックを確認できませんでした。')
    const { times, effectiveIntervalSeconds } = calculateFrameTimes(duration, intervalSeconds)
    const frames: ExtractedFrame[] = []
    for (const timeSeconds of times) {
      await seekToFrame(video, Math.min(timeSeconds, Math.max(0, duration - 0.001)))
      const frameBlob = await captureVideoFrame(video)
      frames.push({
        timeSeconds,
        timeLabel: formatElapsed(Math.floor(timeSeconds)),
        fileName: frameFileName(timeSeconds),
        blob: frameBlob,
        previewUrl: URL.createObjectURL(frameBlob),
      })
    }
    video.removeAttribute('src')
    video.load()
    return { duration, width, height, effectiveIntervalSeconds, frames }
  } finally {
    URL.revokeObjectURL(sourceUrl)
  }
}
