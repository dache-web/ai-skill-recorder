import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { Annotation } from './analysis/types'
import AnnotationOverlay from './AnnotationOverlay'

const annotation: Annotation = {
  id: 'annotation-1', targetTimelineId: 'timeline-1', type: 'rectangle', source: 'user', status: 'accepted', startSeconds: 1, endSeconds: 2,
  geometry: { x: .2, y: .2, width: .1, height: .1, rotationDegrees: 0 },
  style: { strokeColor: '#f00', fillColor: 'transparent', textColor: '#111', strokeWidth: 2, opacity: 1 },
}
afterEach(cleanup)
const pointerEvent = (target: Element, type: string, values: { pointerId: number; clientX?: number; clientY?: number }) => {
  const event = new Event(type, { bubbles: true, cancelable: true }); Object.assign(event, values); fireEvent(target, event)
}

const renderOverlay = () => {
  const onInteractionStart = vi.fn(); const onGeometryChange = vi.fn(); const onInteractionEnd = vi.fn()
  const view = render(<AnnotationOverlay annotations={[annotation]} assets={[]} selectedId={annotation.id} editingTextId={null} onSelect={vi.fn()} onInteractionStart={onInteractionStart} onGeometryChange={onGeometryChange} onInteractionEnd={onInteractionEnd} onDelete={vi.fn()} placementTool={null} onPlace={vi.fn()} onTextChange={vi.fn()} onTextCommit={vi.fn()} onMetricsChange={vi.fn()} />)
  const layer = view.container.querySelector('.annotation-layer') as HTMLElement
  vi.spyOn(layer, 'getBoundingClientRect').mockReturnValue({ x: 0, y: 0, left: 0, top: 0, right: 1000, bottom: 500, width: 1000, height: 500, toJSON: () => ({}) })
  Object.assign(layer, { setPointerCapture: vi.fn(), hasPointerCapture: vi.fn(() => false), releasePointerCapture: vi.fn() })
  return { layer, onInteractionStart, onGeometryChange, onInteractionEnd }
}

describe('AnnotationOverlay pointer session', () => {
  it('pointercancelでresize sessionを安全に1回確定する', () => {
    const { layer, onInteractionStart, onGeometryChange, onInteractionEnd } = renderOverlay()
    pointerEvent(screen.getByRole('button', { name: 'seハンドルでサイズ変更' }), 'pointerdown', { pointerId: 3, clientX: 300, clientY: 150 })
    pointerEvent(layer, 'pointermove', { pointerId: 3, clientX: 400, clientY: 200 })
    pointerEvent(layer, 'pointercancel', { pointerId: 3 })
    expect(onInteractionStart).toHaveBeenCalledTimes(1); expect(onGeometryChange).toHaveBeenCalled(); expect(onInteractionEnd).toHaveBeenCalledTimes(1)
  })

  it('lostpointercaptureでもsessionを終了し後続moveを無視する', () => {
    const { layer, onGeometryChange, onInteractionEnd } = renderOverlay()
    pointerEvent(screen.getByRole('button', { name: 'nwハンドルでサイズ変更' }), 'pointerdown', { pointerId: 4, clientX: 200, clientY: 100 })
    pointerEvent(layer, 'pointermove', { pointerId: 4, clientX: 150, clientY: 50 })
    pointerEvent(layer, 'lostpointercapture', { pointerId: 4 })
    const calls = onGeometryChange.mock.calls.length
    pointerEvent(layer, 'pointermove', { pointerId: 4, clientX: 100, clientY: 0 })
    expect(onInteractionEnd).toHaveBeenCalledTimes(1); expect(onGeometryChange).toHaveBeenCalledTimes(calls)
  })
})
