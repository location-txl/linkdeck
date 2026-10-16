import type { TagClickMode } from './types'

/** 收藏标签交互设置，由收藏页面维护当前值。 */
export type BookmarkSettingsProps = {
  mode: TagClickMode
  onSelectMode: (mode: TagClickMode) => void
}

export function BookmarkSettingsPanel({ mode, onSelectMode }: BookmarkSettingsProps) {
  return (
    <fieldset className="settings__section">
      <legend>标签点击方式</legend>
      <label className="settings__option">
        <input type="radio" name="tag-click-mode" checked={mode === 'modifier-multi'} onChange={() => onSelectMode('modifier-multi')} />
        <span><strong>切换标签</strong><small>点击切换单个标签；按 Command 或 Ctrl 点击可多选。</small></span>
      </label>
      <label className="settings__option">
        <input type="radio" name="tag-click-mode" checked={mode === 'direct-multi'} onChange={() => onSelectMode('direct-multi')} />
        <span><strong>直接多选</strong><small>点击即可选中或取消标签，可连续多选。</small></span>
      </label>
    </fieldset>
  )
}
