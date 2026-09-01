import { Popover } from '@base-ui/react'
import { useCallback, useLayoutEffect, useMemo, useRef, useState } from 'react'
import type { Tag, TagFilter } from '../types'
import { Icon } from './Icon'

/** 两行快捷标签分别可展示的标签数量。 */
type QuickTagCounts = {
  firstRow: number
  secondRow: number
}

type TagFilterBarProps = {
  tags: Tag[]
  tagCounts: Map<string, number>
  totalCount: number
  untaggedCount: number
  filter: TagFilter
  onSelectAll: () => void
  onToggleTag: (tagId: string, multiSelect: boolean) => void
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
      return Number(right.tag.pinned) - Number(left.tag.pinned) || left.index - right.index
    })
    .map(({ tag }) => tag), [tags])
  const firstQuickTagsRef = useRef<HTMLDivElement>(null)
  const secondQuickTagsRef = useRef<HTMLDivElement>(null)
  const tagMeasureRef = useRef<HTMLDivElement>(null)
  const popoverTriggerRef = useRef<HTMLButtonElement>(null)
  const [quickTagCounts, setQuickTagCounts] = useState<QuickTagCounts>({
    firstRow: orderedTags.length,
    secondRow: 0,
  })

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
    const showCount = location === 'popover'
    return (
      <button
        className={`tag-tab ${location === 'quick' ? 'tag-tab--quick' : ''} ${active ? 'tag-tab--active' : ''}`}
        key={tag.id}
        type="button"
        aria-pressed={active}
        onClick={(event) => {
          const quickButton = location === 'quick' ? event.currentTarget : null
          onToggleTag(tag.id, event.metaKey || event.ctrlKey)

          // 取消被提升的标签后，按钮可能离开快捷区；将焦点交给稳定的完整标签入口。
          if (quickButton) {
            window.setTimeout(() => {
              if (!quickButton.isConnected) popoverTriggerRef.current?.focus()
            })
          }
        }}
        title={tag.name}
      >
        <span>{tag.name}</span>{showCount && <em>{tagCounts.get(tag.id) ?? 0}</em>}
      </button>
    )
  }

  /**
   * 根据两行快捷区和标签按钮的实际宽度，计算每行可展示的连续标签数量。
   *
   * 第一行不受右侧操作区限制，第二行只使用操作区左侧的剩余空间。
   */
  const updateQuickTagCounts = useCallback(() => {
    const firstQuickContainer = firstQuickTagsRef.current
    const secondQuickContainer = secondQuickTagsRef.current
    const tagMeasure = tagMeasureRef.current
    if (!firstQuickContainer || !secondQuickContainer || !tagMeasure) return

    const firstRowWidth = firstQuickContainer.getBoundingClientRect().width
    const secondRowWidth = secondQuickContainer.getBoundingClientRect().width
    const tagButtons = Array.from(tagMeasure.querySelectorAll<HTMLElement>('.tag-tab'))
    if (tagButtons.length === 0) {
      setQuickTagCounts((current) => current.firstRow === 0 && current.secondRow === 0
        ? current
        : { firstRow: 0, secondRow: 0 })
      return
    }
    if (firstRowWidth <= 0 || secondRowWidth <= 0) return

    const gap = Number.parseFloat(getComputedStyle(firstQuickContainer).gap) || 0
    const tagWidths = tagButtons.map((tagButton) => tagButton.getBoundingClientRect().width)
    const takeFittingCount = (startIndex: number, availableWidth: number) => {
      let usedWidth = 0
      let count = 0
      for (let index = startIndex; index < tagWidths.length; index += 1) {
        const requiredWidth = tagWidths[index] + (count > 0 ? gap : 0)
        if (usedWidth + requiredWidth > availableWidth) break
        usedWidth += requiredWidth
        count += 1
      }
      return count
    }

    const firstRowCount = takeFittingCount(0, firstRowWidth)
    let secondRowCount = takeFittingCount(firstRowCount, secondRowWidth)

    // 极窄窗口下仍保留一个入口，避免所有标签只能从浮层寻找。
    if (firstRowCount === 0 && secondRowCount === 0) secondRowCount = 1

    setQuickTagCounts((current) => current.firstRow === firstRowCount && current.secondRow === secondRowCount
      ? current
      : { firstRow: firstRowCount, secondRow: secondRowCount })
  }, [orderedTags])

  useLayoutEffect(() => {
    updateQuickTagCounts()
    const firstQuickContainer = firstQuickTagsRef.current
    const secondQuickContainer = secondQuickTagsRef.current
    if (!firstQuickContainer || !secondQuickContainer || typeof ResizeObserver === 'undefined') return

    const observer = new ResizeObserver(updateQuickTagCounts)
    observer.observe(firstQuickContainer)
    observer.observe(secondQuickContainer)
    return () => observer.disconnect()
  }, [updateQuickTagCounts])

  const firstQuickTags = orderedTags.slice(0, quickTagCounts.firstRow)
  const secondQuickTags = orderedTags.slice(
    quickTagCounts.firstRow,
    quickTagCounts.firstRow + quickTagCounts.secondRow,
  )

  return (
    <nav className="tag-filter-bar" aria-label="标签筛选">
      <div className="tag-filter-bar__row tag-filter-bar__row--first">
        <button
          className={`tag-tab ${allActive ? 'tag-tab--active' : ''}`}
          type="button"
          aria-pressed={allActive}
          onClick={onSelectAll}
        >
          <span>全部</span><em>{totalCount}</em>
        </button>

        <div className="tag-filter-bar__quick tag-filter-bar__quick--first" ref={firstQuickTagsRef}>
          {firstQuickTags.map((tag) => renderTagButton(tag, 'quick'))}
        </div>
      </div>

      <div className="tag-filter-bar__row tag-filter-bar__row--second">
        <div className="tag-filter-bar__quick tag-filter-bar__quick--second" ref={secondQuickTagsRef}>
          {secondQuickTags.map((tag) => renderTagButton(tag, 'quick'))}
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
      </div>

      <div className="tag-filter-bar__measure" aria-hidden="true" ref={tagMeasureRef}>
        {orderedTags.map((tag) => renderTagButton(tag, 'quick'))}
      </div>
    </nav>
  )
}
