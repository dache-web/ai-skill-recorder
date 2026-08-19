import { describe, expect, it } from 'vitest'
import { matchesProjectWebM, parseEditorProject, type EditorProject } from './editorProject'

const project: EditorProject = { schemaVersion: 'step2-1-editor-project-1', savedAt: '2026-01-01T00:00:00.000Z', originalWebM: { fileName: 'work.webm', sizeBytes: 4, mimeType: 'video/webm', durationSeconds: 12, immutableSource: true, embedded: false }, editor: { timelineItems: [], points: [], videoSegments: [], excludedSegments: [], annotations: [], insertedSlides: [], insertedAssets: [], selectedTimelineId: null, viewMode: 'editing-preview', timelineConfirmedAt: null, fullReviewCompletedAt: null, overlapAcknowledgedAt: null }, media: { pointImages: {}, insertedAssets: {}, timelineThumbnails: {} }, history: { policy: 'resume-from-saved-state', undoEntriesIncluded: false } }

describe('editor project', () => {
  it('作業JSONを検証し元WebM Blobを含めない', () => { const parsed = parseEditorProject(JSON.stringify(project)); expect(parsed.originalWebM.embedded).toBe(false); expect(JSON.stringify(parsed)).not.toContain('blob:') })
  it('ファイル名・サイズ・MIME typeで元WebMを照合する', () => { expect(matchesProjectWebM(project, new File(['1234'], 'work.webm', { type: 'video/webm' }))).toBe(true); expect(matchesProjectWebM(project, new File(['x'], 'other.webm', { type: 'video/webm' }))).toBe(false) })
})
