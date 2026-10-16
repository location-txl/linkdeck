import { useEffect, useState } from 'react'
import {
  AUTO_CLOSE_DEFAULT_IDLE_MINUTES,
  AUTO_CLOSE_MAX_IDLE_MINUTES,
  AUTO_CLOSE_MIN_IDLE_MINUTES,
  DEFAULT_AUTO_CLOSE_SETTINGS,
  getAutoCloseSettings,
  normalizeWhitelistDomain,
  setAutoCloseSettings,
} from './preferences'
import type { AutoCloseSettings } from './types'

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : '保存设置失败，请稍后重试。'
}

/**
 * 展示并保存当前浏览器的闲置标签页自动关闭配置。
 *
 * 配置每次有效变更都会立即写入本地存储；写入失败时保留表单值，方便用户重试。
 */
export function AutoCloseSettingsPanel() {
  const [settings, setSettings] = useState<AutoCloseSettings>(DEFAULT_AUTO_CLOSE_SETTINGS)
  const [idleMinutesInput, setIdleMinutesInput] = useState(String(AUTO_CLOSE_DEFAULT_IDLE_MINUTES))
  const [domainInput, setDomainInput] = useState('')
  const [domainError, setDomainError] = useState<string>()
  const [error, setError] = useState<string>()
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    let alive = true
    void getAutoCloseSettings()
      .then((saved) => {
        if (!alive) return
        setSettings(saved)
        setIdleMinutesInput(String(saved.idleMinutes))
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

  const save = async (next: AutoCloseSettings): Promise<boolean> => {
    setError(undefined)
    setSaving(true)
    try {
      await setAutoCloseSettings(next)
      // 只有持久化成功的值才参与重复判断，失败时保留输入供原值重试。
      setSettings(next)
      return true
    } catch (caught) {
      setError(errorMessage(caught))
      return false
    } finally {
      setSaving(false)
    }
  }

  const commitIdleMinutes = () => {
    const value = Number(idleMinutesInput)
    if (!/^\d+$/.test(idleMinutesInput) || !Number.isInteger(value) || value < AUTO_CLOSE_MIN_IDLE_MINUTES || value > AUTO_CLOSE_MAX_IDLE_MINUTES) {
      setError(`闲置时间需为 ${AUTO_CLOSE_MIN_IDLE_MINUTES}～${AUTO_CLOSE_MAX_IDLE_MINUTES} 的整数分钟。`)
      return
    }
    if (value !== settings.idleMinutes) void save({ ...settings, idleMinutes: value })
  }

  const addDomain = async () => {
    const domain = normalizeWhitelistDomain(domainInput)
    if (!domain) {
      setDomainError('请输入有效的域名或网址。')
      return
    }
    if (settings.whitelistDomains.includes(domain)) {
      setDomainError('这个域名已经在白名单中。')
      return
    }
    setDomainError(undefined)
    const saved = await save({ ...settings, whitelistDomains: [...settings.whitelistDomains, domain] })
    if (saved) setDomainInput('')
  }

  const removeDomain = (domain: string) => {
    void save({
      ...settings,
      whitelistDomains: settings.whitelistDomains.filter((item) => item !== domain),
    })
  }

  return (
    <section className="settings__section auto-close-settings" aria-labelledby="auto-close-title">
      <div className="auto-close-settings__heading">
        <div>
          <h3 id="auto-close-title">自动关闭闲置标签页</h3>
          <small>后台标签页超过设定时间未使用时自动关闭。</small>
        </div>
        {saving && <span className="auto-close-settings__saving">保存中…</span>}
      </div>
      <label className="settings__option">
        <input
          type="checkbox"
          checked={settings.enabled}
          disabled={loading}
          onChange={(event) => void save({ ...settings, enabled: event.target.checked })}
        />
        <span><strong>启用自动关闭</strong><small>当前窗口选中、固定、播放声音和白名单内的页面不会关闭。</small></span>
      </label>
      <label className="field auto-close-settings__duration">
        <span>闲置时间（分钟）</span>
        <input
          aria-label="闲置时间（分钟）"
          type="number"
          min={AUTO_CLOSE_MIN_IDLE_MINUTES}
          max={AUTO_CLOSE_MAX_IDLE_MINUTES}
          step="1"
          value={idleMinutesInput}
          onChange={(event) => setIdleMinutesInput(event.target.value)}
          onBlur={commitIdleMinutes}
          onKeyDown={(event) => {
            if (event.key === 'Enter') {
              event.preventDefault()
              commitIdleMinutes()
            }
          }}
        />
      </label>
      <div className="auto-close-settings__whitelist">
        <div className="auto-close-settings__label"><span>白名单域名</span><small>例如 example.com 会保护它及所有子域名。</small></div>
        <div className="auto-close-settings__domain-input">
          <input
            aria-label="添加白名单域名"
            value={domainInput}
            onChange={(event) => { setDomainInput(event.target.value); setDomainError(undefined) }}
            onKeyDown={(event) => {
              if (event.key === 'Enter') {
                event.preventDefault()
                void addDomain()
              }
            }}
            placeholder="example.com 或完整网址"
          />
          <button className="button button--quiet" type="button" onClick={() => void addDomain()}>添加</button>
        </div>
        {domainError && <p className="form__error">{domainError}</p>}
        {settings.whitelistDomains.length > 0 && (
          <ul className="auto-close-settings__domains">
            {settings.whitelistDomains.map((domain) => (
              <li key={domain}>
                <span>{domain}</span>
                <button type="button" aria-label={`移除白名单 ${domain}`} onClick={() => removeDomain(domain)}><span aria-hidden="true">×</span></button>
              </li>
            ))}
          </ul>
        )}
      </div>
      {error && <p className="form__error" role="alert">{error}</p>}
      <p className="auto-close-settings__note">自动关闭可能丢失网页中未保存的内容；扩展不会检测网页表单状态。电脑休眠或浏览器重启后会重新开始计时。</p>
    </section>
  )
}
