import { describe, expect, it } from 'vitest'
import { buildAnalysisDocument } from './analysisPackage'
import { calculateFrameTimes, frameFileName, MAX_FRAME_COUNT } from './frameExtractor'
import { analysisJson } from './export'

describe('STEP2-1 analysis helpers', () => {
  it('5秒間隔で動画末尾を超えない時刻を作る', () => {
    expect(calculateFrameTimes(12, 5)).toEqual({ times: [0, 5, 10], effectiveIntervalSeconds: 5 })
  })

  it('静止画を最大30枚に制限する', () => {
    const result = calculateFrameTimes(120, 2)
    expect(result.times).toHaveLength(MAX_FRAME_COUNT)
    expect(result.effectiveIntervalSeconds).toBe(4)
  })

  it('時刻付きPNGファイル名を作る', () => {
    expect(frameFileName(5)).toBe('frame_0005.png')
  })

  it('解析JSONを読みやすく整形する', () => {
    expect(analysisJson({ hasAudio: 'unknown' })).toContain('"hasAudio": "unknown"')
  })

  it('保存済みWebMの不明情報を推測せずlimitationsへ記録する', () => {
    const document = buildAnalysisDocument(
      { blob: new Blob(['webm'], { type: 'video/webm' }), fileName: 'saved.webm', source: 'saved-webm', recordedAt: null, hasAudio: 'unknown' },
      5,
      { duration: 10, width: 1280, height: 720, effectiveIntervalSeconds: 5, frames: [] },
      new Date('2026-08-17T00:00:00.000Z'),
    )
    expect(document.recording.hasAudio).toBe('unknown')
    expect(document.recording.recordedAt).toBeNull()
    expect(document.limitations).toHaveLength(2)
    expect(document.originalWebM.automaticUpload).toBe(false)
  })
})
