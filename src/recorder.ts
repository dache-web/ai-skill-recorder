export type RecorderStatus = 'idle' | 'requesting' | 'recording' | 'stopping' | 'preview'

export const supportedMimeType = (): string => {
  const candidates = [
    'video/webm;codecs=vp9,opus',
    'video/webm;codecs=vp8,opus',
    'video/webm',
  ]

  return candidates.find((type) => MediaRecorder.isTypeSupported(type)) ?? ''
}

export const formatElapsed = (totalSeconds: number): string => {
  const minutes = Math.floor(totalSeconds / 60)
  const seconds = totalSeconds % 60
  return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`
}

export const safeRecordingName = (date = new Date()): string => {
  const stamp = date.toISOString().replace(/[:.]/g, '-').slice(0, 19)
  return `ai-skill-recording-${stamp}.webm`
}

export const userFacingCaptureError = (error: unknown): string => {
  if (error instanceof DOMException) {
    if (error.name === 'NotAllowedError') {
      return '画面共有が許可されませんでした。もう一度「録画開始」を押し、共有する画面を選んでください。'
    }
    if (error.name === 'NotFoundError') {
      return '録画できる画面が見つかりませんでした。ブラウザとWindowsの設定を確認してください。'
    }
    if (error.name === 'NotReadableError') {
      return '選択した画面を録画できませんでした。他の録画アプリを終了して、もう一度お試しください。'
    }
  }
  return '録画を開始できませんでした。ChromeまたはEdgeでページを開き直して、もう一度お試しください。'
}
