/** Client-safe wire vocabulary for PTO artifact inspection. */

export interface PtoArtifactView {
  readonly relativePath: string
  readonly type: string
  readonly version?: string
  readonly size?: number
}

/** One factual reason evidence is unavailable or invalid. */
export interface PtoEvidenceIssueView {
  readonly code: string
  readonly message: string
}

/** Evidence status and supporting artifact references. */
export interface PtoEvidenceView {
  readonly type: string
  readonly status: 'observed' | 'unchecked' | 'available' | 'missing' | 'invalid' | 'unreadable' | 'incompatible'
  readonly artifactRefs: readonly string[]
  readonly issues: readonly PtoEvidenceIssueView[]
}

/** Bounded facts and revision for a registered artifact directory. */
export interface PtoRecordProfileView {
  readonly id: string
  readonly kind: 'run' | 'evidence-pack'
  readonly relativePath: string
  readonly displayPath: string
  readonly revision: string
  readonly generation: '3.0' | '2.0-pro' | 'unknown'
  readonly runtimeLevel: 'L2' | 'L3' | 'unknown'
  readonly identityEvidence: readonly string[]
  readonly artifacts: readonly PtoArtifactView[]
  readonly evidence: readonly PtoEvidenceView[]
  readonly scan: { readonly complete: boolean; readonly limits: readonly string[] }
}

/** Viewer or analysis availability at the inspected revision. */
export interface PtoActionReadinessView {
  readonly actionId: string
  readonly kind: 'viewer' | 'analysis'
  readonly status: 'available' | 'needs-preparation' | 'unavailable' | 'unknown'
  readonly artifactRefs: readonly string[]
  readonly adapter?: { readonly id: string; readonly version: string }
  readonly skill?: { readonly name: string; readonly provider: string; readonly revision: string }
  readonly reasons: readonly PtoEvidenceIssueView[]
}

/** Explicit user-selected Host directory to register. */
export interface PtoArtifactInspectRequest {
  readonly path: string
}

/** Registered identity with its latest profile and action readiness. */
export interface PtoArtifactRecordView {
  readonly recordId: string
  readonly profile: PtoRecordProfileView
  readonly actions: readonly PtoActionReadinessView[]
}

/** Revision-bound request to open an available viewer action. */
export interface PtoArtifactOpenRequest {
  readonly recordId: string
  readonly revision: string
  readonly actionId: string
}

/** Revocable exact-file route with explicitly unsupported selection features. */
export interface PtoArtifactViewerHandle {
  readonly handleId: string
  readonly actionId: string
  readonly title: string
  readonly artifactRef: string
  readonly kind: 'static-html'
  readonly urlPath: string
  readonly features: { readonly selection: false; readonly deeplink: false }
}

/** Handle whose viewer route is to be revoked. */
export interface PtoArtifactCloseRequest {
  readonly handleId: string
}

/** Whether a live viewer handle was found and revoked. */
export interface PtoArtifactCloseResult {
  readonly closed: boolean
}

/** Session and qualified Skill tuple to revalidate before analysis. */
export interface PtoArtifactAnalysisAdmitRequest {
  readonly requestId: string
  readonly sessionId: string
  readonly recordId: string
  readonly revision: string
  readonly actionId: string
  readonly requestedSkill: { readonly name: string; readonly provider: string; readonly revision: string }
}

/** Host-issued identity binding an admitted analysis to its artifacts, Skill, and tool. */
export interface PtoArtifactAnalysisReceipt {
  readonly requestId: string
  readonly sessionId: string
  readonly recordId: string
  readonly recordRevision: string
  readonly actionId: string
  readonly artifactRefs: readonly string[]
  readonly skill: { readonly name: string; readonly provider: string; readonly revision: string }
  readonly tool: { readonly name: string; readonly revision: string }
}
