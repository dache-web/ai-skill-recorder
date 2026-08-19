import { describe, expect, it } from 'vitest'
import { moveAnnotationGeometry, resizeAnnotationGeometry } from './annotationInteraction'

const geometry = { x: .3, y: .3, width: .2, height: .1, rotationDegrees: 0 }

describe('annotation direct interaction', () => {
  it('移動量を正規化座標へ反映し画面内へ制限する', () => {
    const moved = moveAnnotationGeometry(geometry, .1, -.1)
    expect(moved).toMatchObject({ x: .4, width: .2, height: .1, rotationDegrees: 0 })
    expect(moved.y).toBeCloseTo(.2)
    expect(moveAnnotationGeometry(geometry, 2, 2)).toEqual({ ...geometry, x: .8, y: .9 })
  })

  it('四隅からリサイズして最小サイズと境界を守る', () => {
    const resized = resizeAnnotationGeometry(geometry, 'se', .1, .2)
    expect(resized).toMatchObject({ x: .3, y: .3, width: .3 })
    expect(resized.height).toBeCloseTo(.3)
    expect(resizeAnnotationGeometry(geometry, 'nw', .3, .2)).toMatchObject({ width: .04, height: .04 })
  })

  it('画像では縦横比を維持する', () => {
    const resized = resizeAnnotationGeometry(geometry, 'se', .3, .1, true)
    expect(resized.width / resized.height).toBeCloseTo(2)
  })
})
