import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import App from './App'

const selectReadyVideo = (beforeReady?: (video: HTMLVideoElement) => void) => {
  fireEvent.change(screen.getByLabelText('ファイルを選択'), { target: { files: [new File(['webm'], 'review.webm', { type: 'video/webm' })] } })
  const video = document.querySelector('.review-player') as HTMLVideoElement
  let paused = true; let currentTime = 0
  Object.defineProperties(video, { readyState: { configurable: true, value: 2 }, videoWidth: { configurable: true, value: 1280 }, videoHeight: { configurable: true, value: 720 }, duration: { configurable: true, value: 120 }, currentTime: { configurable: true, get: () => currentTime, set: (value: number) => { currentTime = value; queueMicrotask(() => fireEvent.seeked(video)) } }, paused: { configurable: true, get: () => paused }, requestVideoFrameCallback: { configurable: true, value: (callback: VideoFrameRequestCallback) => { callback(0, {} as VideoFrameCallbackMetadata); return 1 } } })
  video.play = vi.fn(async () => { paused = false; fireEvent.play(video) }); video.pause = vi.fn(() => { paused = true; fireEvent.pause(video) }); beforeReady?.(video)
  fireEvent.loadedMetadata(video); fireEvent.loadedData(video); return video
}
const placeText = (clientX = 300, clientY = 150) => {
  fireEvent.click(screen.getByRole('button', { name: 'T' }))
  const layer = document.querySelector('.annotation-layer') as HTMLElement
  Object.defineProperty(layer, 'getBoundingClientRect', { configurable: true, value: vi.fn(() => ({ x: 0, y: 0, left: 0, top: 0, right: 1000, bottom: 500, width: 1000, height: 500, toJSON: () => ({}) })) })
  fireEvent.pointerDown(layer, { pointerId: 1, clientX, clientY })
}
const addSegment = async (video: HTMLVideoElement, kind: '動画区間' | '削除予定', start: number, end: number) => {
  video.currentTime = start; fireEvent.click(screen.getByRole('button', { name: `${kind} 開始` })); await waitFor(() => expect(screen.getByRole('button', { name: `${kind} 終了` })).toBeInTheDocument())
  video.currentTime = end; fireEvent.click(screen.getByRole('button', { name: `${kind} 終了` })); await waitFor(() => expect(screen.getByRole('button', { name: '▶ 動画を再開' })).toBeInTheDocument())
  fireEvent.click(screen.getByRole('button', { name: '▶ 動画を再開' })); await waitFor(() => expect(screen.getByRole('button', { name: `${kind} 開始` })).toBeInTheDocument())
}
const readBlob = (blob: Blob) => new Promise<string>((resolve, reject) => { const reader = new FileReader(); reader.onload = () => resolve(String(reader.result)); reader.onerror = () => reject(reader.error); reader.readAsText(blob) })

describe('unified review timeline', () => {
  it('編集対象とOverlay実寸がそろうまで編集ツールを無効化し自動で有効化する', async () => {
    render(<App />)
    selectReadyVideo(() => { expect(screen.getByRole('button', { name: 'T' })).toBeDisabled(); expect(screen.getByText('編集画面を準備しています…')).toBeInTheDocument() })
    await waitFor(() => expect(screen.getByRole('button', { name: 'T' })).toBeEnabled())
    expect(screen.getByText('図形・文字・画像を追加できます。')).toBeInTheDocument()
  })

  it('seekやtimeupdateなしで初回Annotationを配置できる', () => {
    render(<App />); selectReadyVideo(); placeText(); expect(document.querySelectorAll('.annotation-object')).toHaveLength(1)
  })
  beforeEach(() => { localStorage.clear(); vi.stubGlobal('PointerEvent', MouseEvent); vi.stubGlobal('URL', { createObjectURL: vi.fn(() => `blob:review-${Math.random()}`), revokeObjectURL: vi.fn() }); vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({ drawImage: vi.fn() } as unknown as CanvasRenderingContext2D); vi.spyOn(HTMLCanvasElement.prototype, 'toBlob').mockImplementation((callback) => callback(new Blob(['png'], { type: 'image/png' }))); vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => undefined) })
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
    fireEvent.click(screen.getByText('2. ★ポイント')); expect(video.currentTime).toBe(4); fireEvent.click(screen.getByRole('button', { name: '← 前の項目' })); expect(video.currentTime).toBe(1)
  })

  it('削除予定解除は同じカードと画像を保つ', async () => { render(<App />); const video = selectReadyVideo(); await addSegment(video, '削除予定', 10, 12); const card = document.querySelector('.timeline-item') as HTMLElement; const image = card.querySelector('img'); expect(card).toHaveClass('is-excluded'); fireEvent.click(screen.getByRole('button', { name: '削除予定解除' })); expect(card).not.toHaveClass('is-excluded'); expect(screen.getByText('1. 動画')).toBeInTheDocument(); expect(card.querySelector('img')).toBe(image) })

  it('並べ替えても元動画時刻を維持する', async () => { render(<App />); const video = selectReadyVideo(); await addSegment(video, '動画区間', 2, 4); await addSegment(video, '動画区間', 20, 22); fireEvent.click(screen.getByRole('button', { name: '順番を前へ' })); expect(Array.from(document.querySelectorAll('.timeline-time')).map((node) => node.textContent)).toEqual(['00:20 → 00:22', '00:02 → 00:04']); fireEvent.click(screen.getByText('1. 動画')); expect(video.currentTime).toBe(20) })

  it('完成版確認は動画後にポイントで停止する', async () => { render(<App />); const video = selectReadyVideo(); await addSegment(video, '動画区間', 1, 3); video.currentTime = 4; fireEvent.click(screen.getByRole('button', { name: '★ ポイント' })); await waitFor(() => expect(screen.getByText('2. ★ポイント')).toBeInTheDocument()); fireEvent.click(screen.getByRole('button', { name: '編集した内容を再生' })); await waitFor(() => expect(video.currentTime).toBe(1)); video.currentTime = 3; fireEvent.timeUpdate(video); await waitFor(() => expect(video.currentTime).toBe(4)); expect(screen.getByText(/★ポイントを確認中/)).toBeInTheDocument() })

  it('5回繰り返しても新しい区間を受け付ける', async () => { render(<App />); const video = selectReadyVideo(); for (let index = 0; index < 5; index += 1) await addSegment(video, '動画区間', index * 3 + 1, index * 3 + 2); expect(document.querySelectorAll('.timeline-item')).toHaveLength(5); expect(screen.getByRole('button', { name: '動画区間 開始' })).toBeEnabled() })

  it('ゴミ箱・復元・Undoで元動画と時刻を維持する', async () => { render(<App />); const video = selectReadyVideo(); await addSegment(video, '動画区間', 40, 44); video.currentTime = 44; fireEvent.click(screen.getByRole('button', { name: 'ゴミ箱へ' })); expect(document.querySelectorAll('.timeline-item')).toHaveLength(0); fireEvent.click(screen.getByRole('button', { name: 'ゴミ箱' })); expect(screen.getByRole('button', { name: '元に戻す' })).toBeInTheDocument(); fireEvent.click(screen.getByRole('button', { name: '元に戻す' })); fireEvent.click(screen.getByRole('button', { name: '編集画面へ戻る' })); expect(document.querySelectorAll('.timeline-item')).toHaveLength(1); expect(document.querySelector('.review-player')).toBe(video); expect(video.currentTime).toBe(44) })

  it('注釈追加とUndo/Redoを同じ項目に適用する', async () => { render(<App />); const video = selectReadyVideo(); await addSegment(video, '動画区間', 2, 5); placeText(); expect(document.querySelectorAll('.annotation')).toHaveLength(1); fireEvent.click(screen.getByRole('button', { name: '↶ 戻す' })); expect(document.querySelectorAll('.annotation')).toHaveLength(0); fireEvent.click(screen.getByRole('button', { name: '↷ 進む' })); expect(document.querySelectorAll('.annotation')).toHaveLength(1) })

  it('編集ツール選択で動画を止め、大画面クリック後にハンドルを表示する', async () => { render(<App />); const video = selectReadyVideo(); await addSegment(video, '動画区間', 2, 5); await video.play(); const before = video.currentTime; placeText(); expect(video.pause).toHaveBeenCalled(); expect(video.currentTime).toBe(before); expect(screen.getAllByRole('button', { name: /ハンドルでサイズ変更/ })).toHaveLength(4); expect(screen.getByRole('button', { name: '選択中の注釈を削除' })).toBeInTheDocument(); expect(screen.queryByText('注意')).not.toBeInTheDocument() })

  it('○・□・矢印を選んだ位置へ配置する', async () => {
    render(<App />); const video = selectReadyVideo(); await addSegment(video, '動画区間', 2, 5); fireEvent.click(screen.getByText('図形'))
    const layer = document.querySelector('.annotation-layer') as HTMLElement; Object.defineProperty(layer, 'getBoundingClientRect', { configurable: true, value: vi.fn(() => ({ x: 0, y: 0, left: 0, top: 0, right: 1000, bottom: 500, width: 1000, height: 500, toJSON: () => ({}) })) })
    for (const [name, x] of [['○', 200], ['□', 500], ['矢印', 800]] as const) { fireEvent.click(screen.getByRole('button', { name })); fireEvent.pointerDown(layer, { pointerId: 1, clientX: x, clientY: 250 }) }
    expect(document.querySelectorAll('.annotation-object')).toHaveLength(3); const positions = Array.from(document.querySelectorAll<HTMLElement>('.annotation-object')).map((item) => Number.parseFloat(item.style.left)); expect(positions[0]).toBeCloseTo(16); expect(positions[1]).toBeCloseTo(45); expect(positions[2]).toBeCloseTo(74)
  })

  it('1回の直接ドラッグをUndo 1回で元へ戻す', async () => {
    render(<App />); const video = selectReadyVideo(); await addSegment(video, '動画区間', 2, 5); placeText()
    const textInput = screen.getByRole('textbox', { name: '大画面上の文字入力' }); fireEvent.change(textInput, { target: { value: '操作説明' } }); fireEvent.keyDown(textInput, { key: 'Enter' }); expect(screen.queryByRole('textbox', { name: '大画面上の文字入力' })).not.toBeInTheDocument()
    const layer = document.querySelector('.annotation-layer') as HTMLElement; vi.spyOn(layer, 'getBoundingClientRect').mockReturnValue({ x: 0, y: 0, left: 0, top: 0, right: 1000, bottom: 500, width: 1000, height: 500, toJSON: () => ({}) })
    const annotation = screen.getByRole('button', { name: 'text注釈を選択・移動' }); Object.assign(annotation, { setPointerCapture: vi.fn(), hasPointerCapture: vi.fn(() => false), releasePointerCapture: vi.fn() })
    fireEvent.pointerDown(annotation, { pointerId: 1, clientX: 200, clientY: 100 }); fireEvent.pointerMove(annotation, { pointerId: 1, clientX: 300, clientY: 150 }); fireEvent.pointerUp(annotation, { pointerId: 1, clientX: 300, clientY: 150 })
    expect(Number.parseFloat((annotation.parentElement as HTMLElement).style.left)).toBeCloseTo(33); fireEvent.click(screen.getByRole('button', { name: '↶ 戻す' })); expect((annotation.parentElement as HTMLElement).style.left).toBe('23%')
  })

  it('Overlay管理の四隅リサイズをドラッグ中に反映し1回のUndoで戻す', async () => {
    render(<App />); const video = selectReadyVideo(); await addSegment(video, '動画区間', 2, 5); placeText()
    const input = screen.getByRole('textbox', { name: '大画面上の文字入力' }); fireEvent.keyDown(input, { key: 'Enter' })
    const layer = document.querySelector('.annotation-layer') as HTMLElement
    vi.spyOn(layer, 'getBoundingClientRect').mockReturnValue({ x: 0, y: 0, left: 0, top: 0, right: 1000, bottom: 500, width: 1000, height: 500, toJSON: () => ({}) })
    Object.assign(layer, { setPointerCapture: vi.fn(), hasPointerCapture: vi.fn(() => false), releasePointerCapture: vi.fn() })
    const object = document.querySelector('.annotation-object') as HTMLElement; const before = object.style.width
    fireEvent.pointerDown(screen.getByRole('button', { name: 'seハンドルでサイズ変更' }), { pointerId: 7, clientX: 300, clientY: 150 })
    fireEvent.pointerMove(layer, { pointerId: 7, clientX: 400, clientY: 200 })
    expect(Number.parseFloat(object.style.width)).toBeGreaterThan(Number.parseFloat(before))
    fireEvent.pointerUp(layer, { pointerId: 7, clientX: 400, clientY: 200 })
    fireEvent.click(screen.getByRole('button', { name: '↶ 戻す' })); expect(object.style.width).toBe(before)
  })

  it('pointからvideoへ戻しても同じvideo要素を維持する', async () => {
    render(<App />); const video = selectReadyVideo(); await addSegment(video, '動画区間', 2, 5)
    video.currentTime = 7; fireEvent.click(screen.getByRole('button', { name: '★ ポイント' })); await waitFor(() => expect(screen.getByText('2. ★ポイント')).toBeInTheDocument())
    fireEvent.click(screen.getByText('2. ★ポイント')); await waitFor(() => expect(video.style.display).toBe('none'))
    fireEvent.click(screen.getByText('1. 動画')); await waitFor(() => expect(video.style.display).toBe('block'))
    expect(document.querySelector('.review-player')).toBe(video); expect(video.currentTime).toBe(2)
  })

  it('元動画と編集表示を区別しseekしても表示モードを維持する', () => {
    render(<App />); const video = selectReadyVideo(); placeText(); expect(screen.getByText('編集中プレビュー')).toBeInTheDocument(); expect(document.querySelectorAll('.annotation-object')).toHaveLength(1)
    fireEvent.click(screen.getByRole('button', { name: '元動画' })); expect(document.querySelector('.view-mode-badge')).toHaveTextContent('元動画'); expect(document.querySelectorAll('.annotation-object')).toHaveLength(0)
    video.currentTime = 9; fireEvent.seeking(video); fireEvent.timeUpdate(video); expect(document.querySelector('.view-mode-badge')).toHaveTextContent('元動画')
    fireEvent.click(screen.getByRole('button', { name: '編集表示' })); expect(screen.getByText('編集中プレビュー')).toBeInTheDocument(); expect(document.querySelectorAll('.annotation-object')).toHaveLength(1)
  })

  it('作業JSONへ編集状態とWebM metadataを保存しWebM本体を含めない', async () => {
    render(<App />); selectReadyVideo(); placeText(); fireEvent.click(screen.getByRole('button', { name: '作業を保存' }))
    await waitFor(() => expect(screen.getByText(/作業データを保存しました/)).toBeInTheDocument())
    const jsonBlob = [...vi.mocked(URL.createObjectURL).mock.calls].reverse().map(([blob]) => blob).find((blob): blob is Blob => blob instanceof Blob && blob.type === 'application/json') as Blob
    const project = JSON.parse(await readBlob(jsonBlob)); expect(project.schemaVersion).toBe('step2-1-editor-project-1'); expect(project.editor.annotations).toHaveLength(1); expect(project.editor.viewMode).toBe('editing-preview'); expect(project.originalWebM).toMatchObject({ fileName: 'review.webm', immutableSource: true, embedded: false }); expect(project.originalWebM.blob).toBeUndefined()
  })

  it('作業JSONと一致する元WebMからTimeline・Annotation・選択状態を復元する', async () => {
    const project = { schemaVersion: 'step2-1-editor-project-1', savedAt: '2026-01-01T00:00:00.000Z', originalWebM: { fileName: 'review.webm', sizeBytes: 4, mimeType: 'video/webm', durationSeconds: 120, immutableSource: true, embedded: false }, editor: { timelineItems: [{ id: 'timeline-1', contentType: 'video', sourceId: 'video-segment-1', sourceCollection: 'videoSegments', registeredOrder: 1, manualOrder: 1, thumbnailFileName: 'thumb.png', status: 'active', placement: 'timeline' }], points: [], videoSegments: [{ id: 'video-segment-1', order: 1, startSeconds: 2, endSeconds: 5, durationSeconds: 3 }], excludedSegments: [], annotations: [{ id: 'annotation-1', targetTimelineId: 'timeline-1', type: 'rectangle', source: 'user', status: 'accepted', startSeconds: 2, endSeconds: 5, geometry: { x: .2, y: .2, width: .1, height: .1, rotationDegrees: 0 }, style: { strokeColor: '#f00', fillColor: 'transparent', textColor: '#111', strokeWidth: 2, opacity: 1 } }], insertedSlides: [], insertedAssets: [], selectedTimelineId: 'timeline-1', viewMode: 'editing-preview', timelineConfirmedAt: null, fullReviewCompletedAt: null, overlapAcknowledgedAt: null }, media: { pointImages: {}, insertedAssets: {}, timelineThumbnails: {} }, history: { policy: 'resume-from-saved-state', undoEntriesIncluded: false } }
    render(<App />); const projectFile = new File([JSON.stringify(project)], 'skill-recorder-project.json', { type: 'application/json' }); Object.defineProperty(projectFile, 'text', { value: vi.fn(async () => JSON.stringify(project)) })
    fireEvent.change(screen.getByLabelText('作業データファイル'), { target: { files: [projectFile] } }); await waitFor(() => expect(screen.getByText(/続けて元WebM/)).toBeInTheDocument())
    fireEvent.change(screen.getByLabelText('再開用元WebM'), { target: { files: [new File(['webm'], 'review.webm', { type: 'video/webm' })] } })
    await waitFor(() => expect(screen.getByText('1. 動画')).toBeInTheDocument()); expect(document.querySelectorAll('.annotation-object')).toHaveLength(1); expect(screen.getByText(/保存時点から作業を再開/)).toBeInTheDocument()
  })

  it('タイムラインを横並び専用コンテナに表示し選択項目を明示する', async () => { render(<App />); const video = selectReadyVideo(); await addSegment(video, '動画区間', 2, 5); expect(document.querySelector('.timeline-strip')).toBeInTheDocument(); expect(screen.getByText('編集中')).toBeInTheDocument(); expect(screen.getByRole('button', { name: '次の項目 →' })).toBeInTheDocument() })

  it('同じ動画項目へ10件配置しても全件表示し配置を重複させない', async () => { render(<App />); const video = selectReadyVideo(); await addSegment(video, '動画区間', 2, 5); for (let index = 0; index < 10; index += 1) placeText(100 + index * 70, 80 + index * 25); const objects = Array.from(document.querySelectorAll<HTMLElement>('.annotation-object')); expect(objects).toHaveLength(10); expect(new Set(objects.map((object) => object.style.cssText)).size).toBe(10) })

  it('画像を読み込むと中央へ追加し即選択する', async () => {
    class LoadedImage { naturalWidth = 800; naturalHeight = 400; onload: null | (() => void) = null; onerror: null | (() => void) = null; set src(_value: string) { queueMicrotask(() => this.onload?.()) } }
    vi.stubGlobal('Image', LoadedImage); render(<App />); const video = selectReadyVideo(); await addSegment(video, '動画区間', 2, 5); fireEvent.click(screen.getByText('画像')); fireEvent.click(screen.getByRole('button', { name: '画面に追加' })); const input = document.querySelector('input[accept="image/png,image/jpeg,image/webp"]') as HTMLInputElement; fireEvent.change(input, { target: { files: [new File(['png'], 'sample.png', { type: 'image/png' })] } }); await waitFor(() => expect(screen.getByAltText('重ね画像')).toBeInTheDocument()); expect(document.querySelector('.annotation-object.selected')).toBeInTheDocument(); expect(screen.getAllByRole('button', { name: /ハンドルでサイズ変更/ })).toHaveLength(4)
  })

  it('現在の動画フレーム保存は再生位置と編集履歴を変えない', async () => { render(<App />); const video = selectReadyVideo(); await addSegment(video, '動画区間', 6, 9); video.currentTime = 7; fireEvent.timeUpdate(video); const undo = screen.getByRole('button', { name: '↶ 戻す' }); const undoEnabledBefore = !undo.hasAttribute('disabled'); fireEvent.click(screen.getByRole('button', { name: '画像を保存' })); await waitFor(() => expect(screen.getByText('現在表示中の完成画面をPNGで保存しました。')).toBeInTheDocument()); expect(video.currentTime).toBe(7); expect(!undo.hasAttribute('disabled')).toBe(undoEnabledBefore) })

  it('タイトルと章区切りと白紙ページをタイムラインへ追加する', () => { vi.spyOn(window, 'prompt').mockReturnValue('見出し'); render(<App />); selectReadyVideo(); fireEvent.click(screen.getByRole('button', { name: 'タイトル追加' })); fireEvent.click(screen.getByRole('button', { name: '章区切り追加' })); fireEvent.click(screen.getByRole('button', { name: '白紙ページ追加' })); expect(Array.from(document.querySelectorAll('.timeline-card-heading strong')).map((node) => node.textContent)).toEqual(['1. タイトル', '2. 章区切り', '3. 白紙ページ']) })
})
