import { formatElapsed } from '../recorder'
import { captureVideoFrame } from './frameExtractor'
import type { ReviewPoint, ReviewPointData, ReviewSegment } from './types'

export const MAX_POINT_COUNT = 30

export const normalizeTime = (timeSeconds: number, durationSeconds?: number): number => {
  const safeTime = Math.max(0, timeSeconds)
  const boundedTime = Number.isFinite(durationSeconds) && durationSeconds! > 0
    ? Math.min(safeTime, durationSeconds!)
    : safeTime
  return Number(boundedTime.toFixed(3))
}

export const pointFileName = (sequence: number): string =>
  `point_${String(sequence).padStart(3, '0')}.png`

export const captureReviewPoint = async (
  video: HTMLVideoElement,
  sequence: number,
  timeSeconds: number,
): Promise<ReviewPoint> => {
  if (video.readyState < HTMLMediaElement.HAVE_CURRENT_DATA || !video.videoWidth || !video.videoHeight) {
    throw new Error('動画の読み込み完了後にポイントを追加してください。')
  }
  const blob = await captureVideoFrame(video)
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

export const hasReachedSegmentEnd = (currentTime: number, endSeconds: number): boolean =>
  Number.isFinite(currentTime) && currentTime >= endSeconds

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
