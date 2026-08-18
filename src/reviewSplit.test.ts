import { describe, expect, it, vi } from 'vitest'
import {
  DEFAULT_REVIEW_SPLIT_RATIO,
  ratioFromTopHeight,
  readReviewSplitRatio,
  REVIEW_SPLIT_STORAGE_KEY,
  saveReviewSplitRatio,
  splitTopHeight,
} from './reviewSplit'

describe('review split helpers', () => {
  it('実コンテナ高へ初期比率を適用する', () => {
    expect(splitTopHeight(0.62, 814)).toBe(496)
  })

  it('上下の最低高を超えないよう補正する', () => {
    expect(splitTopHeight(0.1, 814)).toBe(420)
    expect(splitTopHeight(0.95, 814)).toBe(620)
  })

  it('保存値を復元し、不正値は初期比率へ戻す', () => {
    expect(readReviewSplitRatio({ getItem: () => '0.7' })).toBe(0.7)
    expect(readReviewSplitRatio({ getItem: () => 'broken' })).toBe(DEFAULT_REVIEW_SPLIT_RATIO)
    expect(readReviewSplitRatio({ getItem: () => '1.2' })).toBe(DEFAULT_REVIEW_SPLIT_RATIO)
  })

  it('ドラッグ終了時の比率だけを保存する', () => {
    const setItem = vi.fn()
    saveReviewSplitRatio({ setItem }, ratioFromTopHeight(500, 814))
    expect(setItem).toHaveBeenCalledWith(REVIEW_SPLIT_STORAGE_KEY, '0.625')
  })
})
