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
  fireEvent.click(screen.getByRole('button', { name: '▶ 動画を再開' }))
}

describe('review workspace', () => {
  beforeEach(() => {
    localStorage.clear()
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
    expect(screen.getByRole('button', { name: '⏸ 一時停止' })).toBeInTheDocument()
    expect(video.pause).toHaveBeenCalledTimes(10)
  })

  it('固定5ボタンの順番を変えず、ポイント追加直後の再押下では重複登録しない', async () => {
    render(<App />)
    const video = selectReadyVideo()
    const labels = () => Array.from(document.querySelectorAll('.review-controls button')).map((button) => button.textContent)
    expect(labels()).toEqual(['▶ 再生する', '★ ポイント', '動画区間 開始', '不要区間 開始', 'キャンセル'])

    video.currentTime = 12
    fireEvent.click(screen.getByRole('button', { name: '★ ポイント' }))
    await waitFor(() => expect(screen.getAllByText(/^★\d+$/)).toHaveLength(1))
    expect(labels()).toEqual(['▶ 再生を続ける', '▶ ポイント後を再生', '動画区間 開始', '不要区間 開始', 'キャンセル'])
    fireEvent.click(screen.getByRole('button', { name: '▶ ポイント後を再生' }))
    expect(screen.getAllByText(/^★\d+$/)).toHaveLength(1)
    expect(labels()).toEqual(['⏸ 一時停止', '★ ポイント', '動画区間 開始', '不要区間 開始', 'キャンセル'])

    fireEvent.click(screen.getByRole('button', { name: '⏸ 一時停止' }))
    video.currentTime = 18
    fireEvent.click(screen.getByRole('button', { name: '★ ポイント' }))
    await waitFor(() => expect(screen.getAllByText(/^★\d+$/)).toHaveLength(2))
  })

  it('指定中の区間だけをキャンセルする', () => {
    render(<App />)
    const video = selectReadyVideo()
    addSegment(video, '動画区間', 1, 3)
    video.currentTime = 5
    fireEvent.click(screen.getByRole('button', { name: '不要区間 開始' }))
    expect(screen.getByRole('button', { name: 'キャンセル' })).toBeEnabled()
    fireEvent.click(screen.getByRole('button', { name: 'キャンセル' }))
    expect(screen.getByRole('button', { name: 'キャンセル' })).toBeDisabled()
    expect(screen.getAllByText(/^区間\d+$/)).toHaveLength(1)
    expect(screen.queryAllByText(/^不要\d+$/)).toHaveLength(0)
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
      fireEvent.click(screen.getByRole('button', { name: '★ ポイント' }))
      await waitFor(() => expect(screen.getAllByText(/^★\d+$/)).toHaveLength(index + 1))
      fireEvent.click(screen.getByRole('button', { name: '▶ ポイント後を再生' }))
    }
    for (let index = 0; index < 5; index += 1) addSegment(video, '動画区間', index * 4 + 31, index * 4 + 33)
    for (let index = 0; index < 5; index += 1) addSegment(video, '不要区間', index * 4 + 61, index * 4 + 63)

    expect(screen.getAllByText(/^★\d+$/)).toHaveLength(10)
    expect(screen.getAllByText(/^区間\d+$/)).toHaveLength(5)
    expect(screen.getAllByText(/^不要\d+$/)).toHaveLength(5)
    expect(screen.getByRole('button', { name: '⏸ 一時停止' })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '⏸ 一時停止' }))
    expect(screen.getByRole('button', { name: '▶ 再生する' })).toBeInTheDocument()
  })

  it('分割バー操作でvideo要素とcurrentTimeを維持し、比率だけを保存する', () => {
    render(<App />)
    const video = selectReadyVideo()
    video.currentTime = 44
    const workspace = document.querySelector('.review-workspace') as HTMLDivElement
    const splitter = screen.getByRole('separator')
    Object.defineProperty(workspace, 'clientHeight', { configurable: true, value: 814 })
    workspace.getBoundingClientRect = () => ({ top: 100, bottom: 914, height: 814, left: 0, right: 900, width: 900, x: 0, y: 100, toJSON: () => ({}) })
    Object.assign(splitter, { setPointerCapture: vi.fn(), hasPointerCapture: vi.fn(() => true), releasePointerCapture: vi.fn() })

    fireEvent.pointerDown(splitter, { pointerId: 1, clientY: 596 })
    fireEvent.pointerMove(splitter, { pointerId: 1, clientY: 620 })
    fireEvent.pointerUp(splitter, { pointerId: 1, clientY: 620 })

    expect(document.querySelector('.review-player')).toBe(video)
    expect(video.currentTime).toBe(44)
    expect(localStorage.getItem('ai-skill-recorder.reviewSplitRatio.v1')).not.toBeNull()
  })

  it('登録結果の上で確認はページをスクロールせずメイン動画時刻だけを変更する', () => {
    render(<App />)
    const video = selectReadyVideo()
    const scrollTo = vi.spyOn(window, 'scrollTo').mockImplementation(() => undefined)
    addSegment(video, '動画区間', 8, 11)
    video.currentTime = 50
    fireEvent.click(screen.getByRole('button', { name: '上で確認' }))
    expect(video.currentTime).toBe(8)
    expect(scrollTo).not.toHaveBeenCalled()
  })
})
