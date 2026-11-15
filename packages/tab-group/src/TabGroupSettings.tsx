import { useEffect, useState } from 'react'
import { DEFAULT_TAB_GROUP_SETTINGS, getTabGroupSettings, setTabGroupSettings } from './preferences'
import type { TabGroupSettings } from './types'

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : '保存设置失败，请稍后重试。'
}

/**
 * 展示并保存链接标签组开关。
 *
 * 开关每次变更都会立即写入本地存储；写入失败时保留当前状态，方便用户重试。
 */
export function TabGroupSettingsPanel() {
  const [settings, setSettings] = useState<TabGroupSettings>(DEFAULT_TAB_GROUP_SETTINGS)
  const [error, setError] = useState<string>()
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    let alive = true
    void getTabGroupSettings()
      .then((saved) => {
        if (alive) setSettings(saved)
      })
      .catch((caught: unknown) => {
        if (alive) setError(errorMessage(caught))
      })
      .finally(() => {
        if (alive) setLoading(false)
      })
    return () => {
      alive = false
    }
  }, [])

  const save = async (next: TabGroupSettings): Promise<void> => {
    setError(undefined)
    setSaving(true)
    try {
      await setTabGroupSettings(next)
      // 只有持久化成功的值才更新界面，失败时保留原状态供重试。
      setSettings(next)
    } catch (caught) {
      setError(errorMessage(caught))
    } finally {
      setSaving(false)
    }
  }

  return (
    <section className="settings__section tab-group-settings" aria-labelledby="tab-group-title">
      <div className="tab-group-settings__heading">
        <div>
          <h3 id="tab-group-title">链接标签组</h3>
          <small>点击链接新开标签页时自动与来源页面组成标签组。</small>
        </div>
        {saving && <span className="tab-group-settings__saving">保存中…</span>}
      </div>
      <label className="settings__option">
        <input
          type="checkbox"
          checked={settings.enabled}
          disabled={loading}
          onChange={(event) => void save({ enabled: event.target.checked })}
        />
        <span><strong>启用链接标签组</strong><small>来源页面已在标签组内时，新标签页直接加入该组；新建的组以来源页面标题命名。</small></span>
      </label>
      {error && <p className="form__error" role="alert">{error}</p>}
    </section>
  )
}
