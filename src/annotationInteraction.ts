import type { Annotation } from './analysis/types'

export type AnnotationGeometry = Annotation['geometry']
export type ResizeCorner = 'nw' | 'ne' | 'sw' | 'se'

const clamp = (value: number, minimum: number, maximum: number) => Math.min(maximum, Math.max(minimum, value))

export const moveAnnotationGeometry = (geometry: AnnotationGeometry, deltaX: number, deltaY: number): AnnotationGeometry => ({
  ...geometry,
  x: clamp(geometry.x + deltaX, 0, Math.max(0, 1 - geometry.width)),
  y: clamp(geometry.y + deltaY, 0, Math.max(0, 1 - geometry.height)),
})

export const resizeAnnotationGeometry = (
  geometry: AnnotationGeometry,
  corner: ResizeCorner,
  deltaX: number,
  deltaY: number,
  preserveAspectRatio = false,
  minimumSize = 0.04,
): AnnotationGeometry => {
  const right = geometry.x + geometry.width
  const bottom = geometry.y + geometry.height
  let left = corner.includes('w') ? clamp(geometry.x + deltaX, 0, right - minimumSize) : geometry.x
  let top = corner.includes('n') ? clamp(geometry.y + deltaY, 0, bottom - minimumSize) : geometry.y
  let nextRight = corner.includes('e') ? clamp(right + deltaX, left + minimumSize, 1) : right
  let nextBottom = corner.includes('s') ? clamp(bottom + deltaY, top + minimumSize, 1) : bottom

  if (preserveAspectRatio) {
    const aspectRatio = geometry.width / geometry.height
    let width = nextRight - left
    let height = nextBottom - top
    if (width / height > aspectRatio) width = height * aspectRatio
    else height = width / aspectRatio
    if (corner.includes('w')) left = nextRight - width
    else nextRight = left + width
    if (corner.includes('n')) top = nextBottom - height
    else nextBottom = top + height
  }

  return {
    ...geometry,
    x: clamp(left, 0, 1 - minimumSize),
    y: clamp(top, 0, 1 - minimumSize),
    width: clamp(nextRight - left, minimumSize, 1 - left),
    height: clamp(nextBottom - top, minimumSize, 1 - top),
  }
}
