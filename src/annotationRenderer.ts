import type { Annotation } from './analysis/types'

export type AnnotationAsset = { id: string; image: CanvasImageSource }

export const visibleAnnotations = (annotations: Annotation[], targetTimelineId: string | null, currentTime: number | null): Annotation[] => annotations.filter((annotation) => {
  if (annotation.targetTimelineId !== targetTimelineId || annotation.status !== 'accepted') return false
  if (annotation.startSeconds === null || annotation.endSeconds === null) return true
  return currentTime !== null && currentTime >= annotation.startSeconds && currentTime <= annotation.endSeconds
})

export const drawAnnotations = (context: CanvasRenderingContext2D, width: number, height: number, annotations: Annotation[], assets: AnnotationAsset[] = []) => annotations.forEach((annotation) => {
  const { x, y, width: itemWidth, height: itemHeight, rotationDegrees } = annotation.geometry
  const left = x * width; const top = y * height; const w = itemWidth * width; const h = itemHeight * height
  context.save(); context.globalAlpha = annotation.style.opacity; context.translate(left + w / 2, top + h / 2); context.rotate(rotationDegrees * Math.PI / 180); context.translate(-w / 2, -h / 2)
  context.strokeStyle = annotation.style.strokeColor; context.fillStyle = annotation.style.fillColor; context.lineWidth = annotation.style.strokeWidth
  if (annotation.type === 'ellipse') { context.beginPath(); context.ellipse(w / 2, h / 2, w / 2, h / 2, 0, 0, Math.PI * 2); context.fill(); context.stroke() }
  else if (annotation.type === 'line' || annotation.type === 'arrow') { context.beginPath(); context.moveTo(0, h / 2); context.lineTo(w, h / 2); context.stroke(); if (annotation.type === 'arrow') { context.beginPath(); context.moveTo(w, h / 2); context.lineTo(w - 16, h / 2 - 10); context.lineTo(w - 16, h / 2 + 10); context.closePath(); context.fillStyle = annotation.style.strokeColor; context.fill() } }
  else if (annotation.type === 'text' || annotation.type === 'step-number' || annotation.type === 'check' || annotation.type === 'warning') { context.fillStyle = annotation.style.textColor; context.font = `${annotation.style.fontSize ?? 28}px sans-serif`; context.textBaseline = 'top'; context.fillText(annotation.text ?? (annotation.type === 'check' ? '✓' : annotation.type === 'warning' ? '!' : '1'), 0, 0, w) }
  else if (annotation.type === 'image') { const asset = assets.find((candidate) => candidate.id === annotation.assetId); if (asset) context.drawImage(asset.image, 0, 0, w, h) }
  else { context.fillRect(0, 0, w, h); context.strokeRect(0, 0, w, h) }
  context.restore()
})

export const canvasToPngBlob = (canvas: HTMLCanvasElement): Promise<Blob> => new Promise((resolve, reject) => canvas.toBlob((blob) => blob ? resolve(blob) : reject(new Error('PNG画像を生成できませんでした。')), 'image/png'))
