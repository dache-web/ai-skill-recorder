import { useEffect, useRef, type PointerEvent as ReactPointerEvent } from 'react'
import type { Annotation } from './analysis/types'
import { moveAnnotationGeometry, resizeAnnotationGeometry, type PlacementTool, type ResizeCorner } from './annotationInteraction'

type RuntimeAsset = { data: { id: string }; previewUrl: string }
export type OverlayMetrics = { mounted: boolean; width: number; height: number }
type Interaction = { annotationId: string; annotationType: Annotation['type']; mode: 'move' | 'resize'; corner?: ResizeCorner; pointerId: number; startX: number; startY: number; geometry: Annotation['geometry']; historyStarted: boolean; removeWindowListeners?: () => void }
type Props = { annotations: Annotation[]; assets: RuntimeAsset[]; selectedId: string | null; onSelect: (id: string | null) => void; onInteractionStart: () => void; onGeometryChange: (id: string, geometry: Annotation['geometry']) => void; onInteractionEnd: () => void; onDelete: (id: string) => void; placementTool: PlacementTool | null; onPlace: (tool: PlacementTool, normalizedX: number, normalizedY: number) => void; onTextChange: (id: string, text: string) => void; onTextCommit: () => void; editingTextId: string | null; onMetricsChange: (metrics: OverlayMetrics) => void }

const annotationLabel = (annotation: Annotation) => annotation.type === 'ellipse' || annotation.type === 'rectangle' || annotation.type === 'arrow' ? '' : annotation.type === 'line' ? '―' : annotation.type === 'text' ? annotation.text || '' : annotation.text || (annotation.type === 'check' ? '✓' : '1')

export default function AnnotationOverlay({ annotations, assets, selectedId, onSelect, onInteractionStart, onGeometryChange, onInteractionEnd, onDelete, placementTool, onPlace, onTextChange, onTextCommit, editingTextId, onMetricsChange }: Props) {
  const layerRef = useRef<HTMLDivElement>(null)
  const interactionRef = useRef<Interaction | null>(null)

  useEffect(() => {
    const layer = layerRef.current
    if (!layer) return
    const report = (width: number, height: number) => onMetricsChange({ mounted: true, width, height })
    const bounds = layer.getBoundingClientRect()
    report(bounds.width, bounds.height)
    const observer = new ResizeObserver((entries) => { const entry = entries[0]; if (entry) report(entry.contentRect.width, entry.contentRect.height) })
    observer.observe(layer)
    return () => { observer.disconnect(); interactionRef.current?.removeWindowListeners?.(); interactionRef.current = null; onMetricsChange({ mounted: false, width: 0, height: 0 }) }
  }, [onMetricsChange])

  const finishInteraction = (pointerId: number, releaseCapture = true) => {
    const interaction = interactionRef.current; const layer = layerRef.current
    if (!interaction || interaction.pointerId !== pointerId) return
    interactionRef.current = null
    interaction.removeWindowListeners?.()
    if (releaseCapture && layer?.hasPointerCapture?.(pointerId)) layer.releasePointerCapture(pointerId)
    if (interaction.historyStarted) onInteractionEnd()
  }
  const continueInteractionAt = (pointerId: number, clientX: number, clientY: number) => {
    const interaction = interactionRef.current; const layer = layerRef.current
    if (!interaction || interaction.pointerId !== pointerId || !layer) return
    const bounds = layer.getBoundingClientRect(); if (!bounds.width || !bounds.height) return
    const deltaX = (clientX - interaction.startX) / bounds.width; const deltaY = (clientY - interaction.startY) / bounds.height
    if (!interaction.historyStarted && (Math.abs(deltaX) > .001 || Math.abs(deltaY) > .001)) { onInteractionStart(); interaction.historyStarted = true }
    if (!interaction.historyStarted) return
    onGeometryChange(interaction.annotationId, interaction.mode === 'move' ? moveAnnotationGeometry(interaction.geometry, deltaX, deltaY) : resizeAnnotationGeometry(interaction.geometry, interaction.corner ?? 'se', deltaX, deltaY, interaction.annotationType === 'image'))
  }
  const startInteraction = (event: ReactPointerEvent<HTMLElement>, annotation: Annotation, mode: 'move' | 'resize', corner?: ResizeCorner) => {
    event.preventDefault(); event.stopPropagation(); onSelect(annotation.id)
    const pointerId = event.pointerId
    const move = (nativeEvent: PointerEvent) => continueInteractionAt(nativeEvent.pointerId, nativeEvent.clientX, nativeEvent.clientY)
    const finish = (nativeEvent: PointerEvent) => finishInteraction(nativeEvent.pointerId)
    const removeWindowListeners = () => { window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', finish); window.removeEventListener('pointercancel', finish) }
    interactionRef.current = { annotationId: annotation.id, annotationType: annotation.type, mode, corner, pointerId, startX: event.clientX, startY: event.clientY, geometry: annotation.geometry, historyStarted: false, removeWindowListeners }
    window.addEventListener('pointermove', move); window.addEventListener('pointerup', finish); window.addEventListener('pointercancel', finish)
  }

  return <div ref={layerRef} className={`annotation-layer ${placementTool ? 'is-placing' : ''}`} onPointerMove={(event) => continueInteractionAt(event.pointerId, event.clientX, event.clientY)} onPointerUp={(event) => finishInteraction(event.pointerId)} onPointerCancel={(event) => finishInteraction(event.pointerId)} onLostPointerCapture={(event) => finishInteraction(event.pointerId, false)} onPointerDown={(event) => {
    if (event.target !== event.currentTarget) return
    if (!placementTool) { onSelect(null); return }
    const bounds = event.currentTarget.getBoundingClientRect(); if (!bounds.width || !bounds.height) return
    event.preventDefault(); onPlace(placementTool, (event.clientX - bounds.left) / bounds.width, (event.clientY - bounds.top) / bounds.height)
  }}>
    {annotations.map((annotation) => {
      const asset = annotation.assetId ? assets.find((candidate) => candidate.data.id === annotation.assetId) : null; const selected = selectedId === annotation.id
      return <div key={annotation.id} className={`annotation-object ${selected ? 'selected' : ''}`} style={{ left: `${annotation.geometry.x * 100}%`, top: `${annotation.geometry.y * 100}%`, width: `${annotation.geometry.width * 100}%`, height: `${annotation.geometry.height * 100}%`, transform: `rotate(${annotation.geometry.rotationDegrees}deg)`, opacity: annotation.style.opacity }}>
        <div role="button" tabIndex={0} className={`annotation annotation-${annotation.type}`} aria-label={`${annotation.type}注釈を選択・移動`} onPointerDown={(event) => startInteraction(event, annotation, 'move')} style={{ color: annotation.style.textColor, borderColor: annotation.style.strokeColor }}>{asset ? <img src={asset.previewUrl} alt="重ね画像" draggable={false} /> : annotationLabel(annotation)}</div>
        {editingTextId === annotation.id && annotation.type === 'text' && <input className="inline-annotation-text" aria-label="大画面上の文字入力" autoFocus placeholder="文字を入力" value={annotation.text ?? ''} onPointerDown={(event) => event.stopPropagation()} onChange={(event) => onTextChange(annotation.id, event.target.value)} onBlur={onTextCommit} onKeyDown={(event) => { if (event.key === 'Enter') event.currentTarget.blur() }} />}
        {selected && <><span className="selection-frame" aria-hidden="true" />{(['nw', 'ne', 'sw', 'se'] as const).map((corner) => <button key={corner} type="button" className={`resize-handle handle-${corner}`} aria-label={`${corner}ハンドルでサイズ変更`} onPointerDown={(event) => startInteraction(event, annotation, 'resize', corner)} />)}<button type="button" className="annotation-delete" aria-label="選択中の注釈を削除" onClick={(event) => { event.stopPropagation(); onDelete(annotation.id) }}>×</button></>}
      </div>
    })}
  </div>
}
