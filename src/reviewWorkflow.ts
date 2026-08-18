export type SegmentKind = 'video' | 'excluded'
export type ResumeAfter = 'point' | 'video-segment' | 'excluded-segment'

export type ReviewWorkflowState = {
  selection: { kind: SegmentKind; startSeconds: number } | null
  resumeAfter: ResumeAfter | null
}

export type ReviewWorkflowEvent =
  | { type: 'START_SELECTION'; kind: SegmentKind; startSeconds: number }
  | { type: 'COMPLETE_SELECTION'; kind: SegmentKind }
  | { type: 'POINT_ADDED' }
  | { type: 'PLAY_CONFIRMED' }
  | { type: 'EXTERNAL_PLAY_CONFIRMED' }
  | { type: 'SEEKED' }
  | { type: 'CANCEL_SELECTION' }
  | { type: 'RESET' }

export const initialReviewWorkflow: ReviewWorkflowState = { selection: null, resumeAfter: null }

export const reviewWorkflowReducer = (state: ReviewWorkflowState, event: ReviewWorkflowEvent): ReviewWorkflowState => {
  switch (event.type) {
    case 'START_SELECTION':
      if (state.selection) return state
      return { selection: { kind: event.kind, startSeconds: event.startSeconds }, resumeAfter: null }
    case 'COMPLETE_SELECTION':
      if (state.selection?.kind !== event.kind) return state
      return { selection: null, resumeAfter: event.kind === 'video' ? 'video-segment' : 'excluded-segment' }
    case 'POINT_ADDED':
      return { ...state, resumeAfter: 'point' }
    case 'PLAY_CONFIRMED':
    case 'EXTERNAL_PLAY_CONFIRMED':
    case 'SEEKED':
      return state.resumeAfter ? { ...state, resumeAfter: null } : state
    case 'CANCEL_SELECTION':
      return state.selection ? { ...state, selection: null } : state
    case 'RESET':
      return initialReviewWorkflow
  }
}
