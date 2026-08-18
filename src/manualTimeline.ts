import type { ReviewPoint, ReviewSegment, TimelineItem } from './analysis/types'

export const UNCLASSIFIED_EPSILON_SECONDS = 0.05

export type UnclassifiedInterval = {
  id: string
  startSeconds: number
  endSeconds: number
  durationSeconds: number
}

export type TimelineOverlap = {
  firstId: string
  secondId: string
  startSeconds: number
  endSeconds: number
}

export type TimelineConfirmationIssue = 'duration' | 'unclassified' | 'timeline' | 'full-review' | 'overlap'

export const timelineConfirmationIssue = (input: {
  durationSeconds: number
  unclassifiedCount: number
  timelineValid: boolean
  fullReviewCompleted: boolean
  overlapCount: number
  overlapAcknowledged: boolean
}): TimelineConfirmationIssue | null => {
  if (!Number.isFinite(input.durationSeconds) || input.durationSeconds <= 0) return 'duration'
  if (input.unclassifiedCount > 0) return 'unclassified'
  if (!input.timelineValid) return 'timeline'
  if (!input.fullReviewCompleted) return 'full-review'
  if (input.overlapCount > 0 && !input.overlapAcknowledged) return 'overlap'
  return null
}

export const reorderTimeline = (items: TimelineItem[], from: number, to: number): TimelineItem[] => {
  if (from < 0 || to < 0 || from >= items.length || to >= items.length || from === to) return items
  const next = [...items]
  const [moved] = next.splice(from, 1)
  next.splice(to, 0, moved)
  return next.map((item, index) => ({ ...item, manualOrder: index + 1 }))
}

export const timelineSegment = (
  item: TimelineItem,
  videoSegments: ReviewSegment[],
  excludedSegments: ReviewSegment[],
): ReviewSegment | null => {
  if (item.contentType !== 'video') return null
  const source = item.sourceCollection === 'videoSegments' ? videoSegments : item.sourceCollection === 'excludedSegments' ? excludedSegments : []
  return source.find((segment) => segment.id === item.sourceId) ?? null
}

export const timelinePoint = (item: TimelineItem, points: ReviewPoint[]): ReviewPoint | null =>
  item.contentType === 'point' ? points.find((point) => point.id === item.sourceId) ?? null : null

const round = (value: number) => Number(value.toFixed(3))

export const findUnclassifiedIntervals = (
  durationSeconds: number,
  items: TimelineItem[],
  videoSegments: ReviewSegment[],
  excludedSegments: ReviewSegment[],
  epsilonSeconds = UNCLASSIFIED_EPSILON_SECONDS,
): UnclassifiedInterval[] => {
  if (!Number.isFinite(durationSeconds) || durationSeconds <= 0) return []
  const ranges = items.map((item) => timelineSegment(item, videoSegments, excludedSegments))
    .filter((segment): segment is ReviewSegment => Boolean(segment))
    .map((segment) => ({ start: Math.max(0, segment.startSeconds), end: Math.min(durationSeconds, segment.endSeconds) }))
    .filter((range) => range.end > range.start)
    .sort((a, b) => a.start - b.start)
  const merged: Array<{ start: number; end: number }> = []
  ranges.forEach((range) => {
    const previous = merged.at(-1)
    if (previous && range.start - previous.end <= epsilonSeconds) previous.end = Math.max(previous.end, range.end)
    else merged.push({ ...range })
  })
  const gaps: UnclassifiedInterval[] = []
  let cursor = 0
  const addGap = (start: number, end: number) => {
    if (end - start <= epsilonSeconds) return
    const roundedStart = round(start); const roundedEnd = round(end)
    gaps.push({ id: `unclassified-${roundedStart}-${roundedEnd}`, startSeconds: roundedStart, endSeconds: roundedEnd, durationSeconds: round(roundedEnd - roundedStart) })
  }
  merged.forEach((range) => { addGap(cursor, range.start); cursor = Math.max(cursor, range.end) })
  addGap(cursor, durationSeconds)
  return gaps
}

export const findTimelineOverlaps = (
  items: TimelineItem[],
  videoSegments: ReviewSegment[],
  excludedSegments: ReviewSegment[],
): TimelineOverlap[] => {
  const segments = items.map((item) => ({ item, segment: timelineSegment(item, videoSegments, excludedSegments) }))
    .filter((entry): entry is { item: TimelineItem; segment: ReviewSegment } => Boolean(entry.segment))
  const overlaps: TimelineOverlap[] = []
  for (let first = 0; first < segments.length; first += 1) {
    for (let second = first + 1; second < segments.length; second += 1) {
      const start = Math.max(segments[first].segment.startSeconds, segments[second].segment.startSeconds)
      const end = Math.min(segments[first].segment.endSeconds, segments[second].segment.endSeconds)
      if (end > start) overlaps.push({ firstId: segments[first].item.id, secondId: segments[second].item.id, startSeconds: round(start), endSeconds: round(end) })
    }
  }
  return overlaps
}
