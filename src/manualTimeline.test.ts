import { describe, expect, it } from 'vitest'
import type { ReviewSegment, TimelineItem } from './analysis/types'
import { findTimelineOverlaps, findUnclassifiedIntervals, reorderTimeline, timelineConfirmationIssue } from './manualTimeline'

const segment = (id: string, startSeconds: number, endSeconds: number): ReviewSegment => ({ id, order: 1, startSeconds, endSeconds, durationSeconds: endSeconds - startSeconds })
const item = (id: string, sourceId: string, manualOrder: number, sourceCollection: 'videoSegments' | 'excludedSegments' = 'videoSegments'): TimelineItem => ({ id, sourceId, sourceCollection, manualOrder, registeredOrder: manualOrder, contentType: 'video', status: sourceCollection === 'excludedSegments' ? 'excluded' : 'active', thumbnailFileName: `${id}.png` })

describe('manual timeline', () => {
  it('微小な隙間を未分類にせず意味のある隙間だけを返す', () => {
    const items = [item('a', 'a', 1), item('b', 'b', 2), item('c', 'c', 3)]
    const segments = [segment('a', 0, 10), segment('b', 10.03, 18), segment('c', 26, 30)]
    expect(findUnclassifiedIntervals(30, items, segments, [])).toEqual([{ id: 'unclassified-18-26', startSeconds: 18, endSeconds: 26, durationSeconds: 8 }])
  })

  it('重複を結合して未分類を判定し、ポイントは被覆に使わない', () => {
    const point: TimelineItem = { ...item('p', 'p', 3), contentType: 'point', sourceCollection: 'points' }
    expect(findUnclassifiedIntervals(30, [item('a', 'a', 1), item('b', 'b', 2), point], [segment('a', 0, 20), segment('b', 15, 25)], [])).toEqual([{ id: 'unclassified-25-30', startSeconds: 25, endSeconds: 30, durationSeconds: 5 }])
  })

  it('重複区間を警告し元データを変更しない', () => {
    const segments = [segment('a', 0, 20), segment('b', 15, 30)]
    expect(findTimelineOverlaps([item('a', 'a', 1), item('b', 'b', 2)], segments, [])).toEqual([{ firstId: 'a', secondId: 'b', startSeconds: 15, endSeconds: 20 }])
    expect(segments[0]).toEqual(segment('a', 0, 20))
  })

  it('並べ替えはmanualOrderだけを再採番する', () => {
    const result = reorderTimeline([item('a', 'a', 1), item('b', 'b', 2)], 1, 0)
    expect(result.map(({ id, manualOrder, registeredOrder, sourceId }) => ({ id, manualOrder, registeredOrder, sourceId }))).toEqual([
      { id: 'b', manualOrder: 1, registeredOrder: 2, sourceId: 'b' },
      { id: 'a', manualOrder: 2, registeredOrder: 1, sourceId: 'a' },
    ])
  })

  it('重複は確認前だけ確定を止め、確認後は確定可能にする', () => {
    const base = { durationSeconds: 30, unclassifiedCount: 0, timelineValid: true, fullReviewCompleted: true, overlapCount: 1 }
    expect(timelineConfirmationIssue({ ...base, overlapAcknowledged: false })).toBe('overlap')
    expect(timelineConfirmationIssue({ ...base, overlapAcknowledged: true })).toBeNull()
  })
})
