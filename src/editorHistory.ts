export interface EditorHistory<T> { past: T[]; present: T; future: T[] }
export const createEditorHistory = <T>(present: T): EditorHistory<T> => ({ past: [], present, future: [] })
export const commitEditorHistory = <T>(history: EditorHistory<T>, next: T, limit = 100): EditorHistory<T> => ({ past: [...history.past, history.present].slice(-limit), present: next, future: [] })
export const undoEditorHistory = <T>(history: EditorHistory<T>): EditorHistory<T> => history.past.length ? { past: history.past.slice(0, -1), present: history.past.at(-1)!, future: [history.present, ...history.future] } : history
export const redoEditorHistory = <T>(history: EditorHistory<T>): EditorHistory<T> => history.future.length ? { past: [...history.past, history.present], present: history.future[0], future: history.future.slice(1) } : history
