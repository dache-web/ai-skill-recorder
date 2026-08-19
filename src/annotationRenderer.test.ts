import { describe, expect, it } from 'vitest'
import type { Annotation } from './analysis/types'
import { visibleAnnotations } from './annotationRenderer'

const annotation = (id: string, startSeconds: number | null, endSeconds: number | null, status: Annotation['status'] = 'accepted'): Annotation => ({ id, targetTimelineId: 'timeline-1', type: 'arrow', source: 'user', status, startSeconds, endSeconds, geometry: { x: .1, y: .1, width: .2, height: .1, rotationDegrees: 0 }, style: { strokeColor: '#f00', fillColor: '#f00', textColor: '#000', strokeWidth: 3, opacity: 1 } })
describe('annotation renderer', () => {
  it('動画時刻内のaccepted注釈だけを返す', () => expect(visibleAnnotations([annotation('a', 2, 4), annotation('b', 5, 6), annotation('c', 2, 4, 'proposed')], 'timeline-1', 3).map(({ id }) => id)).toEqual(['a']))
  it('静止項目の注釈は時刻なしで表示する', () => expect(visibleAnnotations([annotation('a', null, null)], 'timeline-1', null)).toHaveLength(1))
})
