import { MAX_FRAME_COUNT, extractFrames } from './frameExtractor'
import type { AnalysisDocument, AnalysisResult, ExtractedFrame, RecordingSource } from './types'

interface ExtractedRecording {
  duration: number
  width: number
  height: number
  effectiveIntervalSeconds: number
  frames: ExtractedFrame[]
}

export const buildAnalysisDocument = (
  source: RecordingSource,
  intervalSeconds: number,
  extracted: ExtractedRecording,
  generatedAt = new Date(),
): AnalysisDocument => {
  const limitations: string[] = []
  if (source.recordedAt === null) limitations.push('保存済みWebMの実際の録画開始日時はブラウザ標準APIでは取得できません。')
  if (source.hasAudio === 'unknown') limitations.push('保存済みWebMの音声トラック有無はブラウザ標準APIだけでは確実に判定できません。')
  if (extracted.effectiveIntervalSeconds > intervalSeconds) {
    limitations.push(`静止画が${MAX_FRAME_COUNT}枚を超えないよう、抽出間隔を自動調整しました。`)
  }
  return {
    schemaVersion: 'step2-1-preview-1',
    generatedAt: generatedAt.toISOString(),
    recording: {
      source: source.source,
      fileName: source.fileName,
      recordedAt: source.recordedAt,
      durationSeconds: Number(extracted.duration.toFixed(3)),
      mimeType: source.blob.type || 'video/webm',
      sizeBytes: source.blob.size,
      width: extracted.width,
      height: extracted.height,
      hasVideo: true,
      hasAudio: source.hasAudio,
    },
    frameExtraction: {
      requestedIntervalSeconds: intervalSeconds,
      effectiveIntervalSeconds: Number(extracted.effectiveIntervalSeconds.toFixed(3)),
      maximumFrames: MAX_FRAME_COUNT,
      frameCount: extracted.frames.length,
      frames: extracted.frames.map(({ timeSeconds, timeLabel, fileName }) => ({ timeSeconds, timeLabel, fileName })),
    },
    originalWebM: { fileName: source.fileName, includedInRequiredSet: true, automaticUpload: false },
    limitations,
  }
}

export const createAnalysisPackage = async (
  source: RecordingSource,
  intervalSeconds: number,
): Promise<AnalysisResult> => {
  const extracted = await extractFrames(source.blob, intervalSeconds, source.durationHintSeconds)
  return {
    document: buildAnalysisDocument(source, intervalSeconds, extracted),
    frames: extracted.frames,
  }
}
