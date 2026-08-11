import { Popover } from '@base-ui/react'
import { useCallback, useLayoutEffect, useMemo, useRef, useState } from 'react'
import type { Tag, TagFilter } from '../types'
import { Icon } from './Icon'

type TagFilterBarProps = {
  tags: Tag[]
  tagCounts: Map<string, number>
  totalCount: number
  untaggedCount: number
  filter: TagFilter
  onSelectAll: () => void
  onToggleTag: (tagId: string) => void
  onToggleUntagged: () => void
  onAdd: () => void
}

/**
 * 展示固定宽度的标签筛选栏，并通过浮层提供完整标签列表。
 *
 * 组件只处理筛选交互和浮层状态，筛选持久化与标签创建由调用方负责。
 */
export function TagFilterBar({
  tags,
  tagCounts,
  totalCount,
  untaggedCount,
  filter,
  onSelectAll,
  onToggleTag,
  onToggleUntagged,
  onAdd,
}: TagFilterBarProps) {
  const [open, setOpen] = useState(false)
  const selectedIds = useMemo(() => new Set(filter.tagIds), [filter.tagIds])
  const orderedTags = useMemo(() => tags.map((tag, index) => ({ tag, index }))
    .sort((left, right) => {
      const priority = (item: Tag) => item.pinned ? 0 : selectedIds.has(item.id) ? 1 : 2
      return priority(left.tag) - priority(right.tag) || left.index - right.index
    })
    .map(({ tag }) => tag), [selectedIds, tags])
  const quickTagsRef = useRef<HTMLDivElement>(null)
  const tagMeasureRef = useRef<HTMLDivElement>(null)
  const popoverTriggerRef = useRef<HTMLButtonElement>(null)
  const [quickTagCount, setQuickTagCount] = useState(orderedTags.length)

  const allActive = !filter.untaggedOnly && filter.tagIds.length === 0
  const triggerActive = filter.untaggedOnly || filter.tagIds.length > 0
  const triggerLabel = filter.untaggedOnly
    ? '无标签'
    : filter.tagIds.length > 0
      ? `已选 ${filter.tagIds.length}`
      : `标签 ${tags.length}`
  const triggerAriaLabel = filter.untaggedOnly
    ? '查看全部标签，当前筛选无标签链接'
    : filter.tagIds.length > 0
      ? `查看全部标签，已选择 ${filter.tagIds.length} 个标签`
      : `查看全部标签，共 ${tags.length} 个标签`

  const renderTagButton = (tag: Tag, location: 'quick' | 'popover') => {
    const active = !filter.untaggedOnly && selectedIds.has(tag.id)
    return (
      <button
        className={`tag-tab ${location === 'quick' ? 'tag-tab--quick' : ''} ${active ? 'tag-tab--active' : ''}`}
        key={tag.id}
        type="button"
        aria-pressed={active}
        onClick={(event) => {
          const quickButton = location === 'quick' ? event.currentTarget : null
          onToggleTag(tag.id)

          // 取消被提升的标签后，按钮可能离开快捷区；将焦点交给稳定的完整标签入口。
          if (quickButton) {
            window.setTimeout(() => {
              if (!quickButton.isConnected) popoverTriggerRef.current?.focus()
            })
          }
        }}
        title={tag.name}
      >
        <span>{tag.name}</span><em>{tagCounts.get(tag.id) ?? 0}</em>
      </button>
    )
  }

  /** 根据快捷区和标签按钮的实际宽度，计算不需要折叠的连续标签数量。 */
  const updateQuickTagCount = useCallback(() => {
    const quickContainer = quickTagsRef.current
    const tagMeasure = tagMeasureRef.current
    if (!quickContainer || !tagMeasure) return

    const availableWidth = quickContainer.getBoundingClientRect().width
    const tagButtons = Array.from(tagMeasure.querySelectorAll<HTMLElement>('.tag-tab'))
    if (availableWidth <= 0 || tagButtons.length === 0) return

    const gap = Number.parseFloat(getComputedStyle(quickContainer).gap) || 0
    let usedWidth = 0
    let nextCount = 0
    for (const tagButton of tagButtons) {
      const tagWidth = tagButton.getBoundingClientRect().width
      const requiredWidth = tagWidth + (nextCount > 0 ? gap : 0)
      if (usedWidth + requiredWidth > availableWidth) break
      usedWidth += requiredWidth
      nextCount += 1
    }

    // 至少保留第一个标签，避免极窄窗口下快捷区完全空白。
    nextCount = Math.max(1, nextCount)
    setQuickTagCount((current) => current === nextCount ? current : nextCount)
  }, [orderedTags])

  useLayoutEffect(() => {
    updateQuickTagCount()
    if (!quickTagsRef.current || typeof ResizeObserver === 'undefined') return

    const observer = new ResizeObserver(updateQuickTagCount)
    observer.observe(quickTagsRef.current)
    return () => observer.disconnect()
  }, [updateQuickTagCount])

  const quickTags = orderedTags.slice(0, quickTagCount)

  return (
    <nav className="tag-filter-bar" aria-label="标签筛选">
      <button
        className={`tag-tab ${allActive ? 'tag-tab--active' : ''}`}
        type="button"
        aria-pressed={allActive}
        onClick={onSelectAll}
      >
        <span>全部</span><em>{totalCount}</em>
      </button>

      <div className="tag-filter-bar__quick" ref={quickTagsRef}>
        {quickTags.map((tag) => renderTagButton(tag, 'quick'))}
      </div>
      <div className="tag-filter-bar__measure" aria-hidden="true" ref={tagMeasureRef}>
        {orderedTags.map((tag) => renderTagButton(tag, 'quick'))}
      </div>

      <div className="tag-filter-bar__actions">
        <Popover.Root open={open} onOpenChange={setOpen}>
          <Popover.Trigger
            ref={popoverTriggerRef}
            className={`tag-filter-bar__trigger ${triggerActive ? 'tag-filter-bar__trigger--active' : ''}`}
            aria-label={triggerAriaLabel}
          >
            <span>{triggerLabel}</span>
            <Icon className="tag-filter-bar__chevron" name="chevron-right" size={13} />
          </Popover.Trigger>
          <Popover.Portal>
            <Popover.Positioner side="bottom" align="end" sideOffset={6} collisionPadding={18}>
              <Popover.Popup className="tag-filter-popover" aria-label="全部标签">
                <Popover.Title className="tag-filter-popover__title">全部标签</Popover.Title>
                <div className="tag-filter-popover__list">
                  <button
                    className={`tag-tab ${allActive ? 'tag-tab--active' : ''}`}
                    type="button"
                    aria-pressed={allActive}
                    onClick={onSelectAll}
                  >
                    <span>全部</span><em>{totalCount}</em>
                  </button>
                  {orderedTags.map((tag) => renderTagButton(tag, 'popover'))}
                  <button
                    className={`tag-tab ${filter.untaggedOnly ? 'tag-tab--active' : ''}`}
                    type="button"
                    aria-pressed={filter.untaggedOnly}
                    onClick={onToggleUntagged}
                  >
                    <span>无标签</span><em>{untaggedCount}</em>
                  </button>
                </div>
              </Popover.Popup>
            </Popover.Positioner>
          </Popover.Portal>
        </Popover.Root>

        <button
          className="tag-tab tag-tab--add"
          type="button"
          onClick={() => {
            setOpen(false)
            onAdd()
          }}
          aria-label="新建标签"
          title="新建标签"
        >
          <Icon name="add" size={16} />
        </button>
      </div>
    </nav>
  )
}
