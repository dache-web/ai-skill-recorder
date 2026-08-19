import { describe, expect, it } from 'vitest'
import { moveAnnotationGeometry, placementGeometry, resizeAnnotationGeometry } from './annotationInteraction'

const geometry = { x: .3, y: .3, width: .2, height: .1, rotationDegrees: 0 }

describe('annotation direct interaction', () => {
  it('クリック位置を中心に配置し画面端ではclampする', () => {
    expect(placementGeometry('ellipse', .5, .5)).toMatchObject({ x: .46, width: .08, height: .07, rotationDegrees: 0 })
    expect(placementGeometry('ellipse', .5, .5).y).toBeCloseTo(.465)
    const arrow = placementGeometry('arrow', .99, .01)
    expect(arrow).toMatchObject({ y: 0, width: .12, height: .06, rotationDegrees: 0 })
    expect(arrow.x).toBeCloseTo(.88)
  })
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
