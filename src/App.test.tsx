import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import App from './App'

const selectReadyVideo = () => {
  const input = screen.getByLabelText('ファイルを選択')
  fireEvent.change(input, { target: { files: [new File(['webm'], 'review.webm', { type: 'video/webm' })] } })
  const video = document.querySelector('.review-player') as HTMLVideoElement
  let paused = true
  Object.defineProperties(video, {
    readyState: { configurable: true, value: HTMLMediaElement.HAVE_CURRENT_DATA },
    videoWidth: { configurable: true, value: 1280 },
    videoHeight: { configurable: true, value: 720 },
    duration: { configurable: true, value: 120 },
    paused: { configurable: true, get: () => paused },
    requestVideoFrameCallback: { configurable: true, value: (callback: VideoFrameRequestCallback) => { callback(0, {} as VideoFrameCallbackMetadata); return 1 } },
  })
  video.play = vi.fn(async () => { paused = false; fireEvent.play(video) })
  video.pause = vi.fn(() => { paused = true; fireEvent.pause(video) })
  fireEvent.loadedData(video)
  return video
}

const addSegment = (video: HTMLVideoElement, kind: '動画区間' | '不要区間', start: number, end: number) => {
  video.currentTime = start
  fireEvent.click(screen.getByRole('button', { name: `${kind} 開始` }))
  video.currentTime = end
  fireEvent.click(screen.getByRole('button', { name: `${kind} 終了` }))
}

describe('review workspace', () => {
  beforeEach(() => {
    vi.stubGlobal('URL', { createObjectURL: vi.fn(() => 'blob:review'), revokeObjectURL: vi.fn() })
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({ drawImage: vi.fn() } as unknown as CanvasRenderingContext2D)
    vi.spyOn(HTMLCanvasElement.prototype, 'toBlob').mockImplementation((callback) => callback(new Blob(['png'], { type: 'image/png' })))
  })

  afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals() })

  it('動画区間と不要区間をそれぞれ5回連続で追加する', () => {
    render(<App />)
    const video = selectReadyVideo()
    for (let index = 0; index < 5; index += 1) addSegment(video, '動画区間', index * 4 + 1, index * 4 + 3)
    for (let index = 0; index < 5; index += 1) addSegment(video, '不要区間', index * 4 + 21, index * 4 + 23)

    expect(screen.getAllByText(/^区間\d+$/)).toHaveLength(5)
    expect(screen.getAllByText(/^不要\d+$/)).toHaveLength(5)
    expect(screen.getByRole('button', { name: '動画区間 開始' })).toBeEnabled()
    expect(screen.getByRole('button', { name: '不要区間 開始' })).toBeEnabled()
    expect(screen.getByRole('button', { name: '▶ 再生を続ける' })).toBeInTheDocument()
    expect(video.pause).toHaveBeenCalledTimes(10)
  })

  it('動画区間と不要区間を混在順で追加する', () => {
    render(<App />)
    const video = selectReadyVideo()
    ;(['動画区間', '不要区間', '動画区間', '不要区間', '動画区間'] as const).forEach((kind, index) => addSegment(video, kind, index * 5 + 1, index * 5 + 4))
    expect(screen.getAllByText(/^区間\d+$/)).toHaveLength(3)
    expect(screen.getAllByText(/^不要\d+$/)).toHaveLength(2)
  })

  it('20件を混在登録して再生操作と一覧を維持する', async () => {
    render(<App />)
    const video = selectReadyVideo()
    for (let index = 0; index < 10; index += 1) {
      video.currentTime = index + 1
      fireEvent.click(screen.getByRole('button', { name: '★ この場面をポイント追加' }))
      await waitFor(() => expect(screen.getAllByText(/^★\d+$/)).toHaveLength(index + 1))
    }
    for (let index = 0; index < 5; index += 1) addSegment(video, '動画区間', index * 4 + 31, index * 4 + 33)
    for (let index = 0; index < 5; index += 1) addSegment(video, '不要区間', index * 4 + 61, index * 4 + 63)

    expect(screen.getAllByText(/^★\d+$/)).toHaveLength(10)
    expect(screen.getAllByText(/^区間\d+$/)).toHaveLength(5)
    expect(screen.getAllByText(/^不要\d+$/)).toHaveLength(5)
    fireEvent.click(screen.getByRole('button', { name: '▶ 再生を続ける' }))
    await waitFor(() => expect(screen.getByRole('button', { name: '⏸ 一時停止' })).toBeInTheDocument())
    fireEvent.click(screen.getByRole('button', { name: '⏸ 一時停止' }))
    expect(screen.getByRole('button', { name: '▶ 再生する' })).toBeInTheDocument()
  })
})
