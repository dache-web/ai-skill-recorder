export type KnownBoolean = true | false | 'unknown'

export type RecordingSourceKind = 'current-recording' | 'saved-webm'

export interface RecordingSource {
  blob: Blob
  fileName: string
  source: RecordingSourceKind
  recordedAt: string | null
  hasAudio: KnownBoolean
  durationHintSeconds?: number
}

export interface ExtractedFrame {
  timeSeconds: number
  timeLabel: string
  fileName: string
  blob: Blob
  previewUrl: string
}

export interface ReviewPointData {
  id: string
  order: number
  timeSeconds: number
  timeLabel: string
  imageFileName: string
}

export interface ReviewSegment {
  id: string
  order: number
  startSeconds: number
  endSeconds: number
  durationSeconds: number
}

export type TimelineContentType = 'video' | 'point'
export type TimelineItemStatus = 'active' | 'excluded'
export type TimelineSourceCollection = 'points' | 'videoSegments' | 'excludedSegments'

export interface TimelineItem {
  id: string
  contentType: TimelineContentType
  sourceId: string
  sourceCollection: TimelineSourceCollection
  registeredOrder: number
  manualOrder: number
  thumbnailFileName: string
  status: TimelineItemStatus
}

export interface ManualTimelineItem extends TimelineItem {
  pointSeconds?: number
  startSeconds?: number
  endSeconds?: number
}

export interface ManualTimeline {
  status: 'draft' | 'confirmed'
  confirmedAt: string | null
  fullReviewCompletedAt: string | null
  overlapAcknowledgedAt: string | null
  items: ManualTimelineItem[]
  unclassifiedIntervals: Array<{ startSeconds: number; endSeconds: number; durationSeconds: number }>
}

export interface ReviewAnnotations {
  maximumPoints: number
  points: ReviewPointData[]
  videoSegments: ReviewSegment[]
  excludedSegments: Array<ReviewSegment & { treatment: 'exclude-candidate' }>
  manualTimeline: ManualTimeline
}

export interface ReviewPoint extends ReviewPointData {
  blob: Blob
  previewUrl: string
}

export interface AnalysisDocument {
  schemaVersion: 'step2-1-preview-2'
  generatedAt: string
  recording: {
    source: RecordingSourceKind
    fileName: string
    recordedAt: string | null
    durationSeconds: number
    mimeType: string
    sizeBytes: number
    width: number
    height: number
    hasVideo: KnownBoolean
    hasAudio: KnownBoolean
  }
  frameExtraction: {
    enabled: true
    purpose: 'ai-analysis-supplement'
    requestedIntervalSeconds: number
    effectiveIntervalSeconds: number
    maximumFrames: number
    frameCount: number
    frames: Array<{
      timeSeconds: number
      timeLabel: string
      fileName: string
    }>
  }
  reviewAnnotations: ReviewAnnotations
  originalWebM: {
    fileName: string
    includedInRequiredSet: true
    automaticUpload: false
    immutableSource: true
  }
  limitations: string[]
}

export interface AnalysisResult {
  document: AnalysisDocument
  frames: ExtractedFrame[]
}
