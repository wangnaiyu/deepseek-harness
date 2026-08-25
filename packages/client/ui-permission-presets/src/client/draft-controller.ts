/** Browser-only permission staging for a New Session draft. */
import { createSnapshotStore, type SnapshotStore } from '@deepseek-ai/dsh-client-store'
import type { PermissionSelect } from '@deepseek-ai/dsh-permission-presets/client'
import type { PermissionPresetSettingsController } from './settings-store.ts'

function equalSelect(left: PermissionSelect | undefined, right: PermissionSelect | undefined): boolean {
  if (left === right) return true
  if (left === undefined || right === undefined || left.currentValue !== right.currentValue) return false
  return left.options.length === right.options.length && left.options.every((option, index) => {
    const candidate = right.options[index]
    return candidate !== undefined
      && option.value === candidate.value
      && option.name === candidate.name
      && option.description === candidate.description
  })
}

/** Draft permission catalog/current-value controller backed by the Host settings descriptor. */
export class DraftPermissionController {
  /** Select-compatible snapshot rendered by the draft permission chip. */
  readonly store: SnapshotStore<PermissionSelect | undefined> = createSnapshotStore(undefined)

  private staged: string | undefined
  private readonly stopSettings: () => void
  private disposed = false

  /** @param settings - controller that owns the Host-described dynamic preset enum. */
  constructor(private readonly settings: PermissionPresetSettingsController) {
    this.stopSettings = settings.store.subscribe(() => { this.publish() })
    this.publish()
  }

  /** Load the Host settings descriptor without allocating a Session. */
  load(): void {
    this.settings.load().catch(() => { /* settings store owns the failure */ })
  }

  /**
   * Stage one advertised preset in browser memory.
   * @param preset - dynamic permission preset key.
   * @returns whether the current Host descriptor advertises the preset.
   */
  select(preset: string): Promise<boolean> {
    if (this.disposed || !this.settings.store.getSnapshot().options.some(option => option.id === preset)) {
      return Promise.resolve(false)
    }
    this.staged = preset
    this.publish()
    return Promise.resolve(true)
  }

  /**
   * Read the preset to apply after first-send materialization.
   * @returns the staged key, or undefined when the Host default should stand.
   */
  stagedPreset(): string | undefined {
    return this.staged
  }

  /** A fresh draft drops the previous unsent choice but keeps the shared catalog. */
  resetDraft(): void {
    if (this.disposed) return
    this.staged = undefined
    this.publish()
  }

  /** Stop mirroring settings changes and clear the browser-only projection. */
  dispose(): void {
    this.disposed = true
    this.stopSettings()
    this.store.set(undefined)
  }

  private publish(): void {
    if (this.disposed) return
    const state = this.settings.store.getSnapshot()
    if (state.options.length === 0 || state.currentValue === '') {
      if (this.store.getSnapshot() !== undefined) this.store.set(undefined)
      return
    }
    const next: PermissionSelect = {
      currentValue: this.staged ?? state.currentValue,
      options: state.options.map(option => ({ value: option.id, name: option.label })),
    }
    if (!equalSelect(this.store.getSnapshot(), next)) this.store.set(next)
  }
}
