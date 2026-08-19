import type { Annotation, InsertedAssetData, InsertedSlide, ReviewPointData, ReviewSegment, TimelineItem } from './analysis/types'

export type ProjectViewMode = 'original-video' | 'editing-preview' | 'static-point' | 'inserted-page'
export interface EditorProject {
  schemaVersion: 'step2-1-editor-project-1'
  savedAt: string
  originalWebM: { fileName: string; sizeBytes: number; mimeType: string; durationSeconds: number; immutableSource: true; embedded: false }
  editor: {
    timelineItems: TimelineItem[]
    points: ReviewPointData[]
    videoSegments: ReviewSegment[]
    excludedSegments: ReviewSegment[]
    annotations: Annotation[]
    insertedSlides: InsertedSlide[]
    insertedAssets: InsertedAssetData[]
    selectedTimelineId: string | null
    viewMode: ProjectViewMode
    timelineConfirmedAt: string | null
    fullReviewCompletedAt: string | null
    overlapAcknowledgedAt: string | null
  }
  media: { pointImages: Record<string, string>; insertedAssets: Record<string, string>; timelineThumbnails: Record<string, string> }
  history: { policy: 'resume-from-saved-state'; undoEntriesIncluded: false }
}

export const blobToDataUrl = (blob: Blob): Promise<string> => new Promise((resolve, reject) => {
  const reader = new FileReader(); reader.onload = () => resolve(String(reader.result)); reader.onerror = () => reject(reader.error ?? new Error('画像を保存できませんでした。')); reader.readAsDataURL(blob)
})

export const dataUrlToBlob = (dataUrl: string): Blob => {
  const [header, payload] = dataUrl.split(','); const mimeType = /data:([^;]+)/.exec(header)?.[1] ?? 'application/octet-stream'
  const bytes = Uint8Array.from(atob(payload), (character) => character.charCodeAt(0))
  return new Blob([bytes], { type: mimeType })
}

export const parseEditorProject = (text: string): EditorProject => {
  const value = JSON.parse(text) as Partial<EditorProject>
  if (value.schemaVersion !== 'step2-1-editor-project-1' || !value.originalWebM || !value.editor || !value.media) throw new Error('対応していない作業データです。')
  if (value.originalWebM.embedded !== false || value.originalWebM.immutableSource !== true) throw new Error('元WebM原本情報を確認できません。')
  return value as EditorProject
}

export const matchesProjectWebM = (project: EditorProject, file: File) => project.originalWebM.fileName === file.name && project.originalWebM.sizeBytes === file.size && (!project.originalWebM.mimeType || !file.type || project.originalWebM.mimeType === file.type)
