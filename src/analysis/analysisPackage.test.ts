import { describe, expect, it } from 'vitest'
import { buildAnalysisDocument } from './analysisPackage'
import { calculateFrameTimes, frameFileName, MAX_FRAME_COUNT } from './frameExtractor'
import { analysisJson } from './export'
import { createSegment, normalizeTime, overlappingSegmentIds, pointFileName, segmentsOverlap } from './reviewAnnotations'

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
      undefined,
      new Date('2026-08-17T00:00:00.000Z'),
    )
    expect(document.recording.hasAudio).toBe('unknown')
    expect(document.recording.recordedAt).toBeNull()
    expect(document.limitations).toHaveLength(2)
    expect(document.originalWebM.automaticUpload).toBe(false)
    expect(document.originalWebM.immutableSource).toBe(true)
    expect(document.schemaVersion).toBe('step2-1-preview-2')
    expect(document.reviewAnnotations.points).toEqual([])
  })

  it('ポイント時刻を動画の範囲内に正規化する', () => {
    expect(normalizeTime(5.1239, 10)).toBe(5.124)
    expect(normalizeTime(-1, 10)).toBe(0)
    expect(normalizeTime(12, 10)).toBe(10)
  })

  it('ポイントPNG名を連番で作る', () => {
    expect(pointFileName(1)).toBe('point_001.png')
    expect(pointFileName(31)).toBe('point_031.png')
  })

  it('開始より後の終了位置だけを区間として記録する', () => {
    expect(createSegment('segment-1', 1, 10, 15.25)).toEqual({
      id: 'segment-1', order: 1, startSeconds: 10, endSeconds: 15.25, durationSeconds: 5.25,
    })
    expect(() => createSegment('segment-2', 2, 10, 10)).toThrow('終了位置は開始位置より後にしてください。')
  })

  it('動画区間と不要区間の重複を警告対象として両方保持する', () => {
    const video = createSegment('video-1', 1, 60, 90)
    const excluded = createSegment('excluded-1', 1, 80, 85)
    expect(segmentsOverlap(video, excluded)).toBe(true)
    expect([...overlappingSegmentIds([video], [excluded])]).toEqual(['video-1', 'excluded-1'])
  })
})
