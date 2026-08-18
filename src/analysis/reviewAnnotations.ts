import { formatElapsed } from '../recorder'
import type { ReviewPoint, ReviewPointData, ReviewSegment } from './types'

export const MAX_POINT_COUNT = 30

export const normalizeTime = (timeSeconds: number, durationSeconds: number): number =>
  Number(Math.min(Math.max(0, timeSeconds), Math.max(0, durationSeconds)).toFixed(3))

export const pointFileName = (sequence: number): string =>
  `point_${String(sequence).padStart(3, '0')}.png`

const canvasToPng = (canvas: HTMLCanvasElement): Promise<Blob> =>
  new Promise((resolve, reject) => canvas.toBlob(
    (blob) => blob ? resolve(blob) : reject(new Error('ポイント画像を生成できませんでした。')),
    'image/png',
  ))

export const captureReviewPoint = async (
  video: HTMLVideoElement,
  sequence: number,
): Promise<ReviewPoint> => {
  if (!Number.isFinite(video.duration) || video.duration <= 0 || !video.videoWidth || !video.videoHeight) {
    throw new Error('動画の読み込み完了後にポイントを追加してください。')
  }
  const timeSeconds = normalizeTime(video.currentTime, video.duration)
  const scale = Math.min(1, 1280 / video.videoWidth)
  const canvas = document.createElement('canvas')
  canvas.width = Math.max(1, Math.round(video.videoWidth * scale))
  canvas.height = Math.max(1, Math.round(video.videoHeight * scale))
  const context = canvas.getContext('2d')
  if (!context) throw new Error('ポイント画像生成用Canvasを利用できません。')
  context.drawImage(video, 0, 0, canvas.width, canvas.height)
  const blob = await canvasToPng(canvas)
  return {
    id: `point-${sequence}`,
    order: 0,
    timeSeconds,
    timeLabel: formatElapsed(Math.floor(timeSeconds)),
    imageFileName: pointFileName(sequence),
    blob,
    previewUrl: URL.createObjectURL(blob),
  }
}

export const pointData = (point: ReviewPoint): ReviewPointData => ({
  id: point.id,
  order: point.order,
  timeSeconds: point.timeSeconds,
  timeLabel: point.timeLabel,
  imageFileName: point.imageFileName,
})

export const createSegment = (
  id: string,
  order: number,
  startSeconds: number,
  endSeconds: number,
): ReviewSegment => {
  const start = Number(startSeconds.toFixed(3))
  const end = Number(endSeconds.toFixed(3))
  if (end <= start) throw new Error('終了位置は開始位置より後にしてください。')
  return { id, order, startSeconds: start, endSeconds: end, durationSeconds: Number((end - start).toFixed(3)) }
}

export const segmentsOverlap = (first: ReviewSegment, second: ReviewSegment): boolean =>
  first.startSeconds < second.endSeconds && second.startSeconds < first.endSeconds

export const overlappingSegmentIds = (
  videoSegments: ReviewSegment[],
  excludedSegments: ReviewSegment[],
): Set<string> => {
  const ids = new Set<string>()
  videoSegments.forEach((videoSegment) => excludedSegments.forEach((excludedSegment) => {
    if (segmentsOverlap(videoSegment, excludedSegment)) {
      ids.add(videoSegment.id)
      ids.add(excludedSegment.id)
    }
  }))
  return ids
}
