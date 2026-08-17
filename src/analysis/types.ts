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

export interface AnalysisDocument {
  schemaVersion: 'step2-1-preview-1'
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
  originalWebM: {
    fileName: string
    includedInRequiredSet: true
    automaticUpload: false
  }
  limitations: string[]
}

export interface AnalysisResult {
  document: AnalysisDocument
  frames: ExtractedFrame[]
}
