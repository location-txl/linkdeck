import { useEffect, useState } from 'react'
import type { SameTabSettings } from '../types'
import { DEFAULT_SAME_TAB_SETTINGS, matchesSite, normalizeSiteDomain, siteOrigins } from './rules'
import { getSameTabSettings, setSameTabSettings } from './preferences'

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : '保存导航设置失败，请重试。'
}

/** 按来源网站配置导航范围；网站授权始终由用户操作触发。 */
export function SameTabSettingsPanel() {
  const [settings, setSettings] = useState<SameTabSettings>(DEFAULT_SAME_TAB_SETTINGS)
  const [domainInput, setDomainInput] = useState('')
  const [currentDomain, setCurrentDomain] = useState<string>()
  const [missingAccess, setMissingAccess] = useState<string[]>([])
  const [error, setError] = useState<string>()
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const available = typeof chrome !== 'undefined' && Boolean(chrome.permissions?.request)

  useEffect(() => {
    let alive = true
    void getSameTabSettings().then((saved) => {
      if (!alive) return
      setSettings(saved)
    }).catch((caught: unknown) => { if (alive) setError(errorMessage(caught)) })
      .finally(() => { if (alive) setLoading(false) })
    if (available) {
      void chrome.tabs.query({ active: true, currentWindow: true }).then(([tab]) => {
        if (alive && tab?.url && /^https?:\/\//i.test(tab.url)) setCurrentDomain(normalizeSiteDomain(tab.url))
      }).catch(() => undefined)
    }
    return () => { alive = false }
  }, [available])

  useEffect(() => {
    if (!available) return
    let alive = true
    const refreshAccess = () => {
      void Promise.all(settings.sites.map(async (site) =>
        await chrome.permissions.contains({ origins: siteOrigins(site.domain) }) ? null : site.domain))
        .then((domains) => { if (alive) setMissingAccess(domains.filter((domain): domain is string => domain !== null)) })
        .catch((caught: unknown) => { if (alive) setError(errorMessage(caught)) })
    }
    chrome.permissions.onAdded.addListener(refreshAccess)
    chrome.permissions.onRemoved.addListener(refreshAccess)
    refreshAccess()
    return () => {
      alive = false
      chrome.permissions.onAdded.removeListener(refreshAccess)
      chrome.permissions.onRemoved.removeListener(refreshAccess)
    }
  }, [available, settings.sites])

  const save = async (next: SameTabSettings, accessDomains: string[] = []): Promise<boolean> => {
    setError(undefined)
    setSaving(true)
    let previousOrigins: string[] = []
    let granted = false
    try {
      if (accessDomains.length) {
        // request 必须在当前点击调用栈内发起，不能先 await 读取配置或权限。
        const before = chrome.permissions.getAll()
        const request = chrome.permissions.request({ origins: [...new Set(accessDomains.flatMap(siteOrigins))] })
        const [permissions, accepted] = await Promise.all([before, request])
        previousOrigins = permissions.origins ?? []
        if (!accepted) throw new Error('未获得网站权限，规则没有启用。')
        granted = true
      }
      await setSameTabSettings(next)
      setSettings(next)
      setMissingAccess((domains) => domains.filter((domain) => !accessDomains.includes(domain)))
      return true
    } catch (caught) {
      if (granted) {
        const permissions = await chrome.permissions.getAll().catch(() => ({ origins: [] as string[] }))
        const requestedOrigins = accessDomains.flatMap(siteOrigins)
        const added = (permissions.origins ?? []).filter((origin) => requestedOrigins.includes(origin) && !previousOrigins.includes(origin))
        if (added.length) await chrome.permissions.remove({ origins: added }).catch(() => undefined)
      }
      setError(errorMessage(caught))
      return false
    } finally {
      setSaving(false)
    }
  }

  const addDomain = async (value: string) => {
    const domain = normalizeSiteDomain(value)
    if (!domain) {
      setError('请输入有效的域名或 HTTP(S) 网址。')
      return
    }
    if (settings.sites.some((site) => site.domain === domain)) {
      setError('这个网站已经添加。')
      return
    }
    if (await save({ ...settings, sites: [...settings.sites, { domain, scope: 'all' }] }, [domain])) setDomainInput('')
  }

  const removeDomain = async (domain: string) => {
    const sites = settings.sites.filter((site) => site.domain !== domain)
    if (!await save({ ...settings, sites })) return
    setSaving(true)
    try {
      const { origins = [] } = await chrome.permissions.getAll()
      const required: string[] = chrome.runtime.getManifest().host_permissions ?? []
      const overlaps = (left: string, right: string) => matchesSite(left, right) || matchesSite(right, left)
      // 同时清理此前因重叠规则保留的父域/子域授权，保留仍在使用及非本次相关的权限。
      const unused = origins.filter((origin) => {
        const grantedDomain = normalizeSiteDomain(origin.replace('://*.', '://'))
        if (!grantedDomain || !overlaps(grantedDomain, domain) || sites.some((site) => overlaps(site.domain, grantedDomain))) return false
        // Chrome 撤销父域模式会连带移除其覆盖的必需权限，保留这种共享授权。
        return !required.some((requiredOrigin) => {
          const scheme = requiredOrigin.split('://')[0]
          if (scheme !== '*' && scheme !== origin.split('://')[0]) return false
          const requiredDomain = normalizeSiteDomain(requiredOrigin.replace('://*.', '://'))
          return requiredDomain && overlaps(grantedDomain, requiredDomain)
        })
      })
      if (unused.length) await chrome.permissions.remove({ origins: unused })
    } catch (caught) {
      setError(errorMessage(caught))
    } finally {
      setSaving(false)
    }
  }

  const disabled = loading || saving || !available
  return (
    <section className="settings__section same-tab-settings" aria-labelledby="same-tab-title">
      <h3 id="same-tab-title">当前标签页打开</h3>
      <label className="settings__option">
        <input type="checkbox" checked={settings.enabled} disabled={disabled}
          onChange={(event) => void save({ ...settings, enabled: event.target.checked }, event.target.checked ? settings.sites.map((site) => site.domain) : [])} />
        <span><strong>启用当前标签页打开</strong><small>指定网站内的普通点击直接跳转，可用浏览器返回。</small></span>
      </label>
      <div className="same-tab-settings__add">
        <input aria-label="添加当前标签页打开网站" placeholder="example.com 或完整网址" value={domainInput} disabled={disabled}
          onChange={(event) => setDomainInput(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter') {
              event.preventDefault()
              void addDomain(domainInput)
            }
          }} />
        <button className="button button--quiet" type="button" disabled={disabled} onClick={() => void addDomain(domainInput)}>添加网站</button>
      </div>
      <button className="button button--quiet same-tab-settings__current" type="button"
        disabled={disabled || !currentDomain || settings.sites.some((site) => site.domain === currentDomain)}
        onClick={() => { if (currentDomain) void addDomain(currentDomain) }}>
        {currentDomain ? `添加当前网站 ${currentDomain}` : '添加当前网站'}
      </button>
      {settings.sites.length > 0 && <ul className="same-tab-settings__sites">
        {settings.sites.map((site) => <li key={site.domain}>
          <span title={site.domain}>{site.domain}</span>
          <select aria-label={`${site.domain} 的打开范围`} value={site.scope} disabled={disabled}
            onChange={(event) => void save({ ...settings, sites: settings.sites.map((item) => item.domain === site.domain ? { ...item, scope: event.target.value as 'site' | 'all' } : item) })}>
            <option value="all">站内和外链</option><option value="site">仅站内</option>
          </select>
          {missingAccess.includes(site.domain) && <button className="button button--quiet" type="button" disabled={disabled}
            onClick={() => void save(settings, [site.domain])} aria-label={`授权 ${site.domain}`}>授权</button>}
          <button className="icon-button" type="button" disabled={disabled} aria-label={`移除网站 ${site.domain}`} onClick={() => void removeDomain(site.domain)}>×</button>
        </li>)}
      </ul>}
      {error && <p className="form__error" role="alert">{error}</p>}
      <p className="same-tab-settings__note">域名包含子域名，重叠时使用更具体的规则。⌘/Ctrl 点击、Shift 点击和中键保留原行为。配置仅保存在当前浏览器。</p>
      <p className="same-tab-settings__note">下载和显式弹窗不受影响。已打开的网页若仍新开标签页，请刷新后再试。与 Gist 同步权限重叠的网站授权会保留，移除规则后仍停止导航改写。</p>
      {!available && <p className="same-tab-settings__note">请在浏览器扩展中配置网站权限。</p>}
    </section>
  )
}
