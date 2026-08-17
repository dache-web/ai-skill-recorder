import { describe, expect, it, vi } from 'vitest'
import { formatElapsed, safeRecordingName, supportedMimeType, userFacingCaptureError } from './recorder'

describe('recorder helpers', () => {
  it('経過時間を分と秒で表示する', () => {
    expect(formatElapsed(0)).toBe('00:00')
    expect(formatElapsed(65)).toBe('01:05')
  })

  it('WebMの対応形式を優先順で選ぶ', () => {
    vi.stubGlobal('MediaRecorder', { isTypeSupported: (type: string) => type.includes('vp8') })
    expect(supportedMimeType()).toContain('vp8')
    vi.unstubAllGlobals()
  })

  it('保存ファイル名からWindowsで使えない時刻文字を除く', () => {
    expect(safeRecordingName(new Date('2026-08-17T01:02:03.000Z'))).toBe(
      'ai-skill-recording-2026-08-17T01-02-03.webm',
    )
  })

  it('権限拒否を分かりやすい説明に変換する', () => {
    expect(userFacingCaptureError(new DOMException('', 'NotAllowedError'))).toContain('許可')
  })
})
