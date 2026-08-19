import { describe, expect, it } from 'vitest'
import { commitEditorHistory, createEditorHistory, redoEditorHistory, undoEditorHistory } from './editorHistory'

describe('editor history', () => {
  it('複数回Undo/Redoし新編集でRedoを破棄する', () => {
    let history = createEditorHistory(0)
    history = commitEditorHistory(history, 1); history = commitEditorHistory(history, 2)
    history = undoEditorHistory(history); history = undoEditorHistory(history)
    expect(history.present).toBe(0)
    history = redoEditorHistory(history); expect(history.present).toBe(1)
    history = commitEditorHistory(history, 3); expect(history.future).toEqual([])
  })
})
