import { describe, expect, it } from 'vitest'
import { initialReviewWorkflow, reviewWorkflowReducer, type ReviewWorkflowEvent, type ReviewWorkflowState } from './reviewWorkflow'

const apply = (events: ReviewWorkflowEvent[], initial = initialReviewWorkflow): ReviewWorkflowState =>
  events.reduce(reviewWorkflowReducer, initial)

describe('review workflow reducer', () => {
  it('動画区間を開始・完了・再生後に完全idleへ戻す', () => {
    expect(apply([
      { type: 'START_SELECTION', kind: 'video', startSeconds: 10 },
      { type: 'COMPLETE_SELECTION', kind: 'video' },
      { type: 'PLAY_CONFIRMED' },
    ])).toEqual(initialReviewWorkflow)
  })

  it('不要区間も再生後に完全idleへ戻す', () => {
    expect(apply([
      { type: 'START_SELECTION', kind: 'excluded', startSeconds: 20 },
      { type: 'COMPLETE_SELECTION', kind: 'excluded' },
      { type: 'EXTERNAL_PLAY_CONFIRMED' },
    ])).toEqual(initialReviewWorkflow)
  })

  it('区間指定中のポイント停止と再生でselectionを維持する', () => {
    expect(apply([
      { type: 'START_SELECTION', kind: 'video', startSeconds: 8 },
      { type: 'POINT_ADDED' },
      { type: 'PLAY_CONFIRMED' },
    ])).toEqual({ selection: { kind: 'video', startSeconds: 8 }, resumeAfter: null })
  })

  it('シークはresume状態だけを解除しselectionを維持する', () => {
    expect(reviewWorkflowReducer(
      { selection: { kind: 'excluded', startSeconds: 4 }, resumeAfter: 'point' },
      { type: 'SEEKED' },
    )).toEqual({ selection: { kind: 'excluded', startSeconds: 4 }, resumeAfter: null })
  })

  it('キャンセルは開始時刻だけを破棄して登録後停止状態には触れない', () => {
    expect(reviewWorkflowReducer(
      { selection: { kind: 'video', startSeconds: 3 }, resumeAfter: 'point' },
      { type: 'CANCEL_SELECTION' },
    )).toEqual({ selection: null, resumeAfter: 'point' })
  })

  it('異なる種類の完了eventはselectionを壊さない', () => {
    const state = { selection: { kind: 'video' as const, startSeconds: 3 }, resumeAfter: null }
    expect(reviewWorkflowReducer(state, { type: 'COMPLETE_SELECTION', kind: 'excluded' })).toBe(state)
  })
})
