export const DEFAULT_REVIEW_SPLIT_RATIO = 0.62
export const REVIEW_SPLITTER_HEIGHT = 14
export const MIN_REVIEW_TOP_HEIGHT = 420
export const MIN_REVIEW_BOTTOM_HEIGHT = 180
export const REVIEW_SPLIT_STORAGE_KEY = 'ai-skill-recorder.reviewSplitRatio.v1'

const validRatio = (value: number): number => Number.isFinite(value) && value > 0 && value < 1
  ? value
  : DEFAULT_REVIEW_SPLIT_RATIO

export const splitTopHeight = (
  ratio: number,
  containerHeight: number,
  minimumTopHeight = MIN_REVIEW_TOP_HEIGHT,
  minimumBottomHeight = MIN_REVIEW_BOTTOM_HEIGHT,
): number => {
  const availableHeight = Math.max(0, containerHeight - REVIEW_SPLITTER_HEIGHT)
  if (availableHeight <= minimumTopHeight + minimumBottomHeight) return Math.max(0, availableHeight - minimumBottomHeight)
  return Math.round(Math.min(
    availableHeight - minimumBottomHeight,
    Math.max(minimumTopHeight, availableHeight * validRatio(ratio)),
  ))
}

export const ratioFromTopHeight = (topHeight: number, containerHeight: number): number => {
  const availableHeight = Math.max(1, containerHeight - REVIEW_SPLITTER_HEIGHT)
  return Number((splitTopHeight(topHeight / availableHeight, containerHeight) / availableHeight).toFixed(4))
}

export const readReviewSplitRatio = (storage: Pick<Storage, 'getItem'> | null): number => {
  if (!storage) return DEFAULT_REVIEW_SPLIT_RATIO
  try { return validRatio(Number(storage.getItem(REVIEW_SPLIT_STORAGE_KEY))) }
  catch { return DEFAULT_REVIEW_SPLIT_RATIO }
}

export const saveReviewSplitRatio = (storage: Pick<Storage, 'setItem'> | null, ratio: number): void => {
  if (!storage) return
  try { storage.setItem(REVIEW_SPLIT_STORAGE_KEY, String(validRatio(ratio))) }
  catch { /* 表示設定を保存できなくても動画レビューは継続する */ }
}
