import { useEffect, useState } from 'react'
import { getSameTabSettings } from '@linkdeck/same-tab-navigation/preferences'
import { isXBookmarkEnabled } from '../x-bookmark/preferences'
import { getSiteBookmarkSettings, setSiteBookmarkSettings } from './preferences'
import { DEFAULT_SITE_BOOKMARK_SETTINGS, defaultTagName, matchesSite, normalizeSiteDomain, siteOrigins } from './rules'
import type { ExtractConfig, SiteBookmarkSettings, SiteRule, TitleExtractSource, UrlExtractSource } from './types'

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : '保存站点收藏设置失败，请重试。'
}

type CurrentTab = { id: number; domain?: string }

const URL_KIND_LABELS: Record<UrlExtractSource['kind'], string> = {
  closestLink: '按钮旁的链接',
  pageUrl: '当前页面链接',
  text: '元素文本',
  attribute: '元素属性',
}
const TITLE_KIND_LABELS: Record<TitleExtractSource['kind'], string> = {
  pageTitle: '页面标题',
  text: '元素文本',
  attribute: '元素属性',
}

/** 规则编辑表单：草稿确认后整体写回，避免逐键写存储触发脚本同步。 */
function RuleForm({ rule, disabled, onCancel, onSave }: {
  rule: SiteRule
  disabled: boolean
  onCancel: () => void
  onSave: (next: SiteRule) => Promise<boolean>
}) {
  const [draft, setDraft] = useState(() => ({
    name: rule.name,
    triggerSelector: rule.triggerSelector,
    containerSelector: rule.containerSelector ?? '',
    tagName: rule.tagName,
    urlKind: rule.url.source.kind as UrlExtractSource['kind'],
    urlSelector: rule.url.source.kind === 'text' || rule.url.source.kind === 'attribute' ? rule.url.source.selector : '',
    urlAttribute: rule.url.source.kind === 'attribute' ? rule.url.source.attribute : '',
    urlPattern: rule.url.pattern ?? '',
    titleKind: rule.title.source.kind as TitleExtractSource['kind'],
    titleSelector: rule.title.source.kind === 'text' || rule.title.source.kind === 'attribute' ? rule.title.source.selector : '',
    titleAttribute: rule.title.source.kind === 'attribute' ? rule.title.source.attribute : '',
    titlePattern: rule.title.pattern ?? '',
  }))
  const [error, setError] = useState('')

  // 校验草稿并组装提取配置；字符串返回值代表校验错误文案。
  const withPattern = <C extends object>(config: C, pattern: string, label: string): C | string => {
    const trimmed = pattern.trim()
    if (!trimmed) return config
    try { new RegExp(trimmed) } catch { return `${label}的正则无效。` }
    return { ...config, pattern: trimmed }
  }
  const requireSelector = (selector: string, label: string): string | undefined =>
    selector.trim() ? undefined : `请填写${label}的选择器。`

  const buildUrlConfig = (): ExtractConfig<UrlExtractSource> | string => {
    const kind = draft.urlKind
    if (kind === 'text' || kind === 'attribute') {
      const invalid = requireSelector(draft.urlSelector, '链接提取')
      if (invalid) return invalid
      if (kind === 'text') return withPattern({ source: { kind, selector: draft.urlSelector.trim() } }, draft.urlPattern, '链接提取')
      if (!draft.urlAttribute.trim()) return '请填写链接提取的属性名。'
      return withPattern({ source: { kind, selector: draft.urlSelector.trim(), attribute: draft.urlAttribute.trim() } }, draft.urlPattern, '链接提取')
    }
    return withPattern({ source: { kind } }, draft.urlPattern, '链接提取')
  }
  const buildTitleConfig = (): ExtractConfig<TitleExtractSource> | string => {
    const kind = draft.titleKind
    if (kind === 'text' || kind === 'attribute') {
      const invalid = requireSelector(draft.titleSelector, '标题提取')
      if (invalid) return invalid
      if (kind === 'text') return withPattern({ source: { kind, selector: draft.titleSelector.trim() } }, draft.titlePattern, '标题提取')
      if (!draft.titleAttribute.trim()) return '请填写标题提取的属性名。'
      return withPattern({ source: { kind, selector: draft.titleSelector.trim(), attribute: draft.titleAttribute.trim() } }, draft.titlePattern, '标题提取')
    }
    return withPattern({ source: { kind: 'pageTitle' } }, draft.titlePattern, '标题提取')
  }

  const submit = async () => {
    setError('')
    const url = buildUrlConfig()
    if (typeof url === 'string') { setError(url); return }
    const title = buildTitleConfig()
    if (typeof title === 'string') { setError(title); return }
    const triggerSelector = draft.triggerSelector.trim()
    if (!triggerSelector) { setError('请填写触发按钮选择器。'); return }
    const tagName = draft.tagName.trim() || defaultTagName(rule.domain)
    const next: SiteRule = {
      ...rule,
      name: draft.name.trim() || rule.domain,
      triggerSelector,
      containerSelector: draft.containerSelector.trim() || undefined,
      tagName,
      url, title,
      updatedAt: Date.now(),
    }
    if (!await onSave(next)) setError('保存规则失败，请重试。')
  }

  const update = <K extends keyof typeof draft>(key: K, value: (typeof draft)[K]) => setDraft((current) => ({ ...current, [key]: value }))
  return (
    <div className="site-bookmark-settings__form">
      <label>规则名称
        <input value={draft.name} disabled={disabled} onChange={(event) => update('name', event.target.value)} />
      </label>
      <label>触发按钮选择器
        <input value={draft.triggerSelector} disabled={disabled} placeholder="点击命中的元素即收藏" onChange={(event) => update('triggerSelector', event.target.value)} />
      </label>
      <label>卡片容器选择器（留空 = 当前页面）
        <input value={draft.containerSelector} disabled={disabled} placeholder="按钮所在的卡片，用于提取链接和标题" onChange={(event) => update('containerSelector', event.target.value)} />
      </label>
      <label>收藏标签
        <input value={draft.tagName} disabled={disabled} onChange={(event) => update('tagName', event.target.value)} />
      </label>
      <label>链接提取
        <select value={draft.urlKind} disabled={disabled} onChange={(event) => update('urlKind', event.target.value as UrlExtractSource['kind'])}>
          {Object.entries(URL_KIND_LABELS).map(([kind, label]) => <option key={kind} value={kind}>{label}</option>)}
        </select>
      </label>
      {(draft.urlKind === 'text' || draft.urlKind === 'attribute') && (
        <label>链接选择器
          <input value={draft.urlSelector} disabled={disabled} onChange={(event) => update('urlSelector', event.target.value)} />
        </label>
      )}
      {draft.urlKind === 'attribute' && (
        <label>链接属性名
          <input value={draft.urlAttribute} disabled={disabled} placeholder="href、content 等" onChange={(event) => update('urlAttribute', event.target.value)} />
        </label>
      )}
      <label>链接正则（可选）
        <input value={draft.urlPattern} disabled={disabled} placeholder="有捕获组取第 1 组，不匹配保留原值" onChange={(event) => update('urlPattern', event.target.value)} />
      </label>
      <label>标题提取
        <select value={draft.titleKind} disabled={disabled} onChange={(event) => update('titleKind', event.target.value as TitleExtractSource['kind'])}>
          {Object.entries(TITLE_KIND_LABELS).map(([kind, label]) => <option key={kind} value={kind}>{label}</option>)}
        </select>
      </label>
      {(draft.titleKind === 'text' || draft.titleKind === 'attribute') && (
        <label>标题选择器
          <input value={draft.titleSelector} disabled={disabled} onChange={(event) => update('titleSelector', event.target.value)} />
        </label>
      )}
      {draft.titleKind === 'attribute' && (
        <label>标题属性名
          <input value={draft.titleAttribute} disabled={disabled} placeholder="title、aria-label 等" onChange={(event) => update('titleAttribute', event.target.value)} />
        </label>
      )}
      <label>标题正则（可选）
        <input value={draft.titlePattern} disabled={disabled} placeholder="如 (.+?) - 站名 用于清理标题后缀" onChange={(event) => update('titlePattern', event.target.value)} />
      </label>
      {error && <p className="form__error" role="alert">{error}</p>}
      <div className="site-bookmark-settings__form-actions">
        <button className="button button--quiet" type="button" disabled={disabled} onClick={onCancel}>取消</button>
        <button className="button button--quiet" type="button" disabled={disabled} onClick={() => void submit()}>保存规则</button>
      </div>
    </div>
  )
}

/** 为任意网站配置"点击按钮即收藏"的规则；授权始终由用户操作触发。 */
export function SiteBookmarkSettingsPanel() {
  const [settings, setSettings] = useState<SiteBookmarkSettings>(DEFAULT_SITE_BOOKMARK_SETTINGS)
  const [currentTab, setCurrentTab] = useState<CurrentTab>()
  const [missingAccess, setMissingAccess] = useState<string[]>([])
  const [editingId, setEditingId] = useState<string>()
  const [error, setError] = useState<string>()
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const available = typeof chrome !== 'undefined' && Boolean(chrome.permissions?.request)

  useEffect(() => {
    if (!available) return
    let alive = true
    const refresh = () => {
      void getSiteBookmarkSettings().then((saved) => {
        if (alive) setSettings(saved)
      }).catch((caught: unknown) => { if (alive) setError(errorMessage(caught)) })
        .finally(() => { if (alive) setLoading(false) })
    }
    const changed = (changes: Record<string, chrome.storage.StorageChange>, area: string) => {
      if (area === 'local' && changes['linkdeck:site-bookmark:rules']) refresh()
    }
    refresh()
    chrome.storage.onChanged.addListener(changed)
    chrome.permissions.onAdded.addListener(refresh)
    chrome.permissions.onRemoved.addListener(refresh)
    return () => {
      alive = false
      chrome.storage.onChanged.removeListener(changed)
      chrome.permissions.onAdded.removeListener(refresh)
      chrome.permissions.onRemoved.removeListener(refresh)
    }
  }, [available])

  useEffect(() => {
    if (!available) return
    let alive = true
    void chrome.tabs.query({ active: true, currentWindow: true }).then(([tab]) => {
      if (alive && tab?.id !== undefined && tab.url && /^https?:\/\//i.test(tab.url)) {
        setCurrentTab({ id: tab.id, domain: normalizeSiteDomain(tab.url) })
      }
    }).catch(() => undefined)
    return () => { alive = false }
  }, [available])

  useEffect(() => {
    if (!available) return
    let alive = true
    const refreshAccess = () => {
      void Promise.all(settings.rules.map(async (rule) =>
        await chrome.permissions.contains({ origins: siteOrigins(rule.domain) }) ? null : rule.domain))
        .then((domains) => { if (alive) setMissingAccess(domains.filter((domain): domain is string => domain !== null)) })
        .catch(() => undefined)
    }
    chrome.permissions.onAdded.addListener(refreshAccess)
    chrome.permissions.onRemoved.addListener(refreshAccess)
    refreshAccess()
    return () => {
      alive = false
      chrome.permissions.onAdded.removeListener(refreshAccess)
      chrome.permissions.onRemoved.removeListener(refreshAccess)
    }
  }, [available, settings.rules])

  const save = async (next: SiteBookmarkSettings): Promise<boolean> => {
    setError(undefined)
    setSaving(true)
    try {
      await setSiteBookmarkSettings(next)
      setSettings(next)
      return true
    } catch (caught) {
      setError(errorMessage(caught))
      return false
    } finally {
      setSaving(false)
    }
  }

  const addRule = async () => {
    if (!currentTab?.domain || currentTab.id === undefined) return
    setError(undefined)
    try {
      // request 必须在当前点击调用栈内发起，不能先 await 读取配置或权限。
      if (!await chrome.permissions.request({ origins: siteOrigins(currentTab.domain) })) {
        setError('未获得网站权限，规则没有创建。')
        return
      }
      await chrome.scripting.executeScript({ target: { tabId: currentTab.id }, files: ['assets/site-bookmark-picker.js'] })
      window.close()
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : '启动元素选取失败，请重试。')
    }
  }

  const grantAccess = async (domain: string) => {
    setError(undefined)
    try {
      if (!await chrome.permissions.request({ origins: siteOrigins(domain) })) throw new Error(`未获得 ${domain} 网站权限。`)
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : '授权失败，请重试。')
    }
  }

  const removeRule = async (id: string) => {
    const rule = settings.rules.find((item) => item.id === id)
    const rules = settings.rules.filter((item) => item.id !== id)
    if (!rule || !await save({ ...settings, rules })) return
    setSaving(true)
    try {
      const { origins = [] } = await chrome.permissions.getAll()
      const required: string[] = chrome.runtime.getManifest().host_permissions ?? []
      const overlaps = (left: string, right: string) => matchesSite(left, right) || matchesSite(right, left)
      // 保留其他规则、X 书签联动和当前标签页导航仍在使用的授权，只清理本次删除独占的来源。
      const xActive = await isXBookmarkEnabled().catch(() => false)
      // undefined 表示导航配置读取失败：无法确认归属时不撤销，避免误伤其他功能。
      const sameTabDomains = await getSameTabSettings()
        .then((settings) => settings.enabled ? settings.sites.map(({ domain }) => domain) : [])
        .catch(() => undefined)
      const unused = origins.filter((origin) => {
        const grantedDomain = normalizeSiteDomain(origin.replace('://*.', '://'))
        if (!grantedDomain || !overlaps(grantedDomain, rule.domain)) return false
        if (rules.some((item) => overlaps(item.domain, grantedDomain))) return false
        if (xActive && overlaps(grantedDomain, 'x.com')) return false
        if (sameTabDomains === undefined || sameTabDomains.some((domain) => overlaps(domain, grantedDomain))) return false
        return !required.some((requiredOrigin) => {
          const scheme = requiredOrigin.split('://')[0]
          if (scheme !== '*' && scheme !== origin.split('://')[0]) return false
          const requiredDomain = normalizeSiteDomain(requiredOrigin.replace('://*.', '://'))
          return requiredDomain ? overlaps(grantedDomain, requiredDomain) : false
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
    <section className="settings__section site-bookmark-settings" aria-labelledby="site-bookmark-title">
      <h3 id="site-bookmark-title">站点收藏规则</h3>
      <label className="settings__option">
        <input type="checkbox" checked={settings.enabled} disabled={disabled || !settings.rules.length}
          onChange={(event) => void save({ ...settings, enabled: event.target.checked })} />
        <span><strong>启用站点收藏规则</strong><small>在任意网页点击指定按钮即收藏到 LinkDeck，并自动打上规则标签。</small></span>
      </label>
      <button className="button button--quiet site-bookmark-settings__add" type="button"
        disabled={disabled || !currentTab?.domain} onClick={() => void addRule()}>
        {currentTab?.domain ? `为当前网站 ${currentTab.domain} 创建规则` : '当前页面不支持创建规则'}
      </button>
      {settings.rules.length > 0 && <ul className="site-bookmark-settings__rules">
        {settings.rules.map((rule) => <li key={rule.id}>
          <div className="site-bookmark-settings__rule">
            <span title={rule.domain}>{rule.name}</span>
            <small>{rule.domain} · 标签「{rule.tagName}」</small>
            <input type="checkbox" aria-label={`启用 ${rule.domain} 规则`} checked={rule.enabled} disabled={disabled}
              onChange={(event) => void save({ ...settings, rules: settings.rules.map((item) => item.id === rule.id ? { ...item, enabled: event.target.checked } : item) })} />
            {missingAccess.includes(rule.domain) && <button className="button button--quiet" type="button" disabled={disabled}
              onClick={() => void grantAccess(rule.domain)}>授权</button>}
            <button type="button" aria-expanded={editingId === rule.id} disabled={disabled}
              onClick={() => setEditingId(editingId === rule.id ? undefined : rule.id)}>{editingId === rule.id ? '收起' : '编辑'}</button>
            <button className="icon-button" type="button" disabled={disabled} aria-label={`删除 ${rule.domain} 规则`} onClick={() => void removeRule(rule.id)}>×</button>
          </div>
          {editingId === rule.id && <RuleForm rule={rule} disabled={disabled} onCancel={() => setEditingId(undefined)}
            onSave={async (next) => {
              const ok = await save({ ...settings, rules: settings.rules.map((item) => item.id === next.id ? next : item) })
              if (ok) setEditingId(undefined)
              return ok
            }} />}
        </li>)}
      </ul>}
      {error && <p className="form__error" role="alert">{error}</p>}
      <p className="site-bookmark-settings__note">创建规则时会在网页上引导你点选触发按钮和所属卡片。规则仅保存在当前浏览器，不进入备份或 Gist 同步。</p>
      {!available && <p className="site-bookmark-settings__note">请在浏览器扩展中配置网站权限。</p>}
    </section>
  )
}
