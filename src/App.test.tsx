import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import App from './App'

const selectReadyVideo = () => {
  fireEvent.change(screen.getByLabelText('ファイルを選択'), { target: { files: [new File(['webm'], 'review.webm', { type: 'video/webm' })] } })
  const video = document.querySelector('.review-player') as HTMLVideoElement
  let paused = true
  Object.defineProperties(video, { readyState: { configurable: true, value: 2 }, videoWidth: { configurable: true, value: 1280 }, videoHeight: { configurable: true, value: 720 }, duration: { configurable: true, value: 120 }, paused: { configurable: true, get: () => paused }, requestVideoFrameCallback: { configurable: true, value: (callback: VideoFrameRequestCallback) => { callback(0, {} as VideoFrameCallbackMetadata); return 1 } } })
  video.play = vi.fn(async () => { paused = false; fireEvent.play(video) }); video.pause = vi.fn(() => { paused = true; fireEvent.pause(video) })
  fireEvent.loadedMetadata(video); fireEvent.loadedData(video); return video
}
const addSegment = async (video: HTMLVideoElement, kind: '動画区間' | '削除予定', start: number, end: number) => {
  video.currentTime = start; fireEvent.click(screen.getByRole('button', { name: `${kind} 開始` })); await waitFor(() => expect(screen.getByRole('button', { name: `${kind} 終了` })).toBeInTheDocument())
  video.currentTime = end; fireEvent.click(screen.getByRole('button', { name: `${kind} 終了` })); await waitFor(() => expect(screen.getByRole('button', { name: '▶ 動画を再開' })).toBeInTheDocument())
  fireEvent.click(screen.getByRole('button', { name: '▶ 動画を再開' })); await waitFor(() => expect(screen.getByRole('button', { name: `${kind} 開始` })).toBeInTheDocument())
}

describe('unified review timeline', () => {
  beforeEach(() => { localStorage.clear(); vi.stubGlobal('URL', { createObjectURL: vi.fn(() => `blob:review-${Math.random()}`), revokeObjectURL: vi.fn() }); vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({ drawImage: vi.fn() } as unknown as CanvasRenderingContext2D); vi.spyOn(HTMLCanvasElement.prototype, 'toBlob').mockImplementation((callback) => callback(new Blob(['png'], { type: 'image/png' }))) })
  afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals() })

  it('固定5ボタンの順番を維持する', () => { render(<App />); selectReadyVideo(); expect(Array.from(document.querySelectorAll('.review-controls button')).map((button) => button.textContent)).toEqual(['▶ 再生する', '★ ポイント', '動画区間 開始', '削除予定 開始', 'キャンセル']) })

  it('停止中の区間開始は自動再生し実画面カードを作る', async () => {
    render(<App />); const video = selectReadyVideo(); video.currentTime = 3; fireEvent.click(screen.getByRole('button', { name: '動画区間 開始' })); await waitFor(() => expect(screen.getByRole('button', { name: '動画区間 終了' })).toBeInTheDocument()); expect(video.play).toHaveBeenCalledTimes(1)
    video.currentTime = 8; fireEvent.click(screen.getByRole('button', { name: '動画区間 終了' })); await waitFor(() => expect(screen.getByText('1. 動画')).toBeInTheDocument()); expect(document.querySelectorAll('.timeline-item .timeline-thumbnail')).toHaveLength(1); expect(video.pause).toHaveBeenCalled()
  })

  it('再生中の開始では余計なplayを呼ばない', async () => { render(<App />); const video = selectReadyVideo(); await video.play(); vi.mocked(video.play).mockClear(); video.currentTime = 4; fireEvent.click(screen.getByRole('button', { name: '動画区間 開始' })); await waitFor(() => expect(screen.getByRole('button', { name: '動画区間 終了' })).toBeInTheDocument()); expect(video.play).not.toHaveBeenCalled() })

  it('3種類を登録順で並べ動画で確認と前へを使える', async () => {
    render(<App />); const video = selectReadyVideo(); await addSegment(video, '動画区間', 1, 3)
    video.currentTime = 4; fireEvent.click(screen.getByRole('button', { name: '★ ポイント' })); await waitFor(() => expect(screen.getByText('2. ★ポイント')).toBeInTheDocument()); fireEvent.click(screen.getByRole('button', { name: '▶ ポイント後を再生' }))
    await addSegment(video, '削除予定', 5, 7); expect(Array.from(document.querySelectorAll('.timeline-card-heading strong')).map((node) => node.textContent)).toEqual(['1. 動画', '2. ★ポイント', '3. 削除予定']); expect(screen.queryByText('上で確認')).not.toBeInTheDocument(); expect(screen.queryByText('区間だけ再生')).not.toBeInTheDocument()
    fireEvent.click(screen.getAllByRole('button', { name: '動画で確認' })[1]); expect(video.currentTime).toBe(4); fireEvent.click(screen.getByRole('button', { name: '← 前へ' })); expect(video.currentTime).toBe(1)
  })

  it('削除予定解除は同じカードと画像を保つ', async () => { render(<App />); const video = selectReadyVideo(); await addSegment(video, '削除予定', 10, 12); const card = document.querySelector('.timeline-item') as HTMLElement; const image = card.querySelector('img'); expect(card).toHaveClass('is-excluded'); fireEvent.click(screen.getByRole('button', { name: '削除予定解除' })); expect(card).not.toHaveClass('is-excluded'); expect(screen.getByText('1. 動画')).toBeInTheDocument(); expect(card.querySelector('img')).toBe(image) })

  it('並べ替えても元動画時刻を維持する', async () => { render(<App />); const video = selectReadyVideo(); await addSegment(video, '動画区間', 2, 4); await addSegment(video, '動画区間', 20, 22); fireEvent.click(screen.getAllByRole('button', { name: '前へ移動' })[1]); expect(Array.from(document.querySelectorAll('.timeline-time')).map((node) => node.textContent)).toEqual(['00:20 → 00:22（2秒）', '00:02 → 00:04（2秒）']); fireEvent.click(screen.getAllByRole('button', { name: '動画で確認' })[0]); expect(video.currentTime).toBe(20) })

  it('全体確認は動画後にポイントで停止する', async () => { render(<App />); const video = selectReadyVideo(); await addSegment(video, '動画区間', 1, 3); video.currentTime = 4; fireEvent.click(screen.getByRole('button', { name: '★ ポイント' })); await waitFor(() => expect(screen.getByText('2. ★ポイント')).toBeInTheDocument()); fireEvent.click(screen.getByRole('button', { name: '全体を確認' })); await waitFor(() => expect(video.currentTime).toBe(1)); video.currentTime = 3; fireEvent.timeUpdate(video); await waitFor(() => expect(video.currentTime).toBe(4)); expect(screen.getByText(/★ポイントを確認中/)).toBeInTheDocument() })

  it('5回繰り返しても新しい区間を受け付ける', async () => { render(<App />); const video = selectReadyVideo(); for (let index = 0; index < 5; index += 1) await addSegment(video, '動画区間', index * 3 + 1, index * 3 + 2); expect(document.querySelectorAll('.timeline-item')).toHaveLength(5); expect(screen.getByRole('button', { name: '動画区間 開始' })).toBeEnabled() })

  it('分割バーはvideoと時刻を維持する', () => { render(<App />); const video = selectReadyVideo(); video.currentTime = 44; const workspace = document.querySelector('.review-workspace') as HTMLDivElement; const splitter = screen.getByRole('separator'); Object.defineProperty(workspace, 'clientHeight', { configurable: true, value: 814 }); workspace.getBoundingClientRect = () => ({ top: 100, bottom: 914, height: 814, left: 0, right: 900, width: 900, x: 0, y: 100, toJSON: () => ({}) }); Object.assign(splitter, { setPointerCapture: vi.fn(), hasPointerCapture: vi.fn(() => true), releasePointerCapture: vi.fn() }); fireEvent.pointerDown(splitter, { pointerId: 1, clientY: 596 }); fireEvent.pointerMove(splitter, { pointerId: 1, clientY: 620 }); fireEvent.pointerUp(splitter, { pointerId: 1, clientY: 620 }); expect(document.querySelector('.review-player')).toBe(video); expect(video.currentTime).toBe(44); expect(localStorage.getItem('ai-skill-recorder.reviewSplitRatio.v1')).not.toBeNull() })
})
