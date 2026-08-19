import { useRef, type PointerEvent as ReactPointerEvent } from 'react'
import type { Annotation } from './analysis/types'
import { moveAnnotationGeometry, resizeAnnotationGeometry, type PlacementTool, type ResizeCorner } from './annotationInteraction'

type RuntimeAsset = { data: { id: string }; previewUrl: string }
type Interaction = {
  annotationId: string
  mode: 'move' | 'resize'
  corner?: ResizeCorner
  pointerId: number
  startX: number
  startY: number
  geometry: Annotation['geometry']
  historyStarted: boolean
}

type Props = {
  annotations: Annotation[]
  assets: RuntimeAsset[]
  selectedId: string | null
  onSelect: (id: string | null) => void
  onInteractionStart: () => void
  onGeometryChange: (id: string, geometry: Annotation['geometry']) => void
  onInteractionEnd: () => void
  onDelete: (id: string) => void
  placementTool: PlacementTool | null
  onPlace: (tool: PlacementTool, normalizedX: number, normalizedY: number) => void
  onTextChange: (id: string, text: string) => void
  onTextCommit: () => void
  editingTextId: string | null
}

const annotationLabel = (annotation: Annotation) => annotation.type === 'ellipse' ? '○' : annotation.type === 'rectangle' ? '□' : annotation.type === 'arrow' ? '➜' : annotation.type === 'line' ? '―' : annotation.type === 'text' ? annotation.text || '' : annotation.text || (annotation.type === 'check' ? '✓' : '1')

export default function AnnotationOverlay({ annotations, assets, selectedId, onSelect, onInteractionStart, onGeometryChange, onInteractionEnd, onDelete, placementTool, onPlace, onTextChange, onTextCommit, editingTextId }: Props) {
  const layerRef = useRef<HTMLDivElement>(null)
  const interactionRef = useRef<Interaction | null>(null)

  const startInteraction = (event: ReactPointerEvent<HTMLElement>, annotation: Annotation, mode: 'move' | 'resize', corner?: ResizeCorner) => {
    event.preventDefault(); event.stopPropagation()
    onSelect(annotation.id)
    interactionRef.current = { annotationId: annotation.id, mode, corner, pointerId: event.pointerId, startX: event.clientX, startY: event.clientY, geometry: annotation.geometry, historyStarted: false }
    event.currentTarget.setPointerCapture(event.pointerId)
  }
  const continueInteraction = (event: ReactPointerEvent<HTMLElement>, annotation: Annotation) => {
    const interaction = interactionRef.current; const layer = layerRef.current
    if (!interaction || interaction.annotationId !== annotation.id || interaction.pointerId !== event.pointerId || !layer) return
    const bounds = layer.getBoundingClientRect(); if (!bounds.width || !bounds.height) return
    const deltaX = (event.clientX - interaction.startX) / bounds.width
    const deltaY = (event.clientY - interaction.startY) / bounds.height
    if (!interaction.historyStarted && (Math.abs(deltaX) > .001 || Math.abs(deltaY) > .001)) { onInteractionStart(); interaction.historyStarted = true }
    if (!interaction.historyStarted) return
    const geometry = interaction.mode === 'move'
      ? moveAnnotationGeometry(interaction.geometry, deltaX, deltaY)
      : resizeAnnotationGeometry(interaction.geometry, interaction.corner ?? 'se', deltaX, deltaY, annotation.type === 'image')
    onGeometryChange(annotation.id, geometry)
  }
  const finishInteraction = (event: ReactPointerEvent<HTMLElement>) => {
    const interaction = interactionRef.current
    if (!interaction || interaction.pointerId !== event.pointerId) return
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId)
    interactionRef.current = null; if (interaction.historyStarted) onInteractionEnd()
  }

  return <div ref={layerRef} className={`annotation-layer ${placementTool ? 'is-placing' : ''}`} onPointerDown={(event) => {
    if (event.target !== event.currentTarget) return
    if (!placementTool) { onSelect(null); return }
    const bounds = event.currentTarget.getBoundingClientRect()
    if (!bounds.width || !bounds.height) return
    event.preventDefault()
    onPlace(placementTool, (event.clientX - bounds.left) / bounds.width, (event.clientY - bounds.top) / bounds.height)
  }}>
    {annotations.map((annotation) => {
      const asset = annotation.assetId ? assets.find((candidate) => candidate.data.id === annotation.assetId) : null
      const selected = selectedId === annotation.id
      return <div key={annotation.id} className={`annotation-object ${selected ? 'selected' : ''}`} style={{ left: `${annotation.geometry.x * 100}%`, top: `${annotation.geometry.y * 100}%`, width: `${annotation.geometry.width * 100}%`, height: `${annotation.geometry.height * 100}%`, transform: `rotate(${annotation.geometry.rotationDegrees}deg)`, opacity: annotation.style.opacity }}>
        <div role="button" tabIndex={0} className={`annotation annotation-${annotation.type}`} aria-label={`${annotation.type}注釈を選択・移動`} onPointerDown={(event) => startInteraction(event, annotation, 'move')} onPointerMove={(event) => continueInteraction(event, annotation)} onPointerUp={finishInteraction} onPointerCancel={finishInteraction} style={{ color: annotation.style.textColor, borderColor: annotation.style.strokeColor }}>
          {asset ? <img src={asset.previewUrl} alt="重ね画像" draggable={false} /> : annotationLabel(annotation)}
        </div>
        {editingTextId === annotation.id && annotation.type === 'text' && <input className="inline-annotation-text" aria-label="大画面上の文字入力" autoFocus placeholder="文字を入力" value={annotation.text ?? ''} onPointerDown={(event) => event.stopPropagation()} onChange={(event) => onTextChange(annotation.id, event.target.value)} onBlur={onTextCommit} onKeyDown={(event) => { if (event.key === 'Enter') event.currentTarget.blur() }} />}
        {selected && <><span className="selection-frame" aria-hidden="true" />{(['nw', 'ne', 'sw', 'se'] as const).map((corner) => <button key={corner} type="button" className={`resize-handle handle-${corner}`} aria-label={`${corner}ハンドルでサイズ変更`} onPointerDown={(event) => startInteraction(event, annotation, 'resize', corner)} onPointerMove={(event) => continueInteraction(event, annotation)} onPointerUp={finishInteraction} onPointerCancel={finishInteraction} />)}<button type="button" className="annotation-delete" aria-label="選択中の注釈を削除" onClick={(event) => { event.stopPropagation(); onDelete(annotation.id) }}>×</button></>}
      </div>
    })}
  </div>
}
