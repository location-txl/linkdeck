import { useState } from 'react'
import { act, cleanup, render, screen, waitFor, within } from '@testing-library/react'
import { fireEvent } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { TagFilterBar } from './TagFilterBar'

const tagWidths = new Map([
  ['短标签', 50],
  ['工作', 50],
  ['阅读', 50],
  ['稍长标签', 50],
])

let quickWidth = 120
let resizeCallback: ResizeObserverCallback | undefined

const tags = [...tagWidths.keys()].map((name, index) => ({
  id: String(index),
  name,
  pinned: false,
  createdAt: index,
  updatedAt: index,
}))

function installMeasurementMocks() {
  class ResizeObserverMock {
    constructor(callback: ResizeObserverCallback) {
      resizeCallback = callback
    }

    observe() {}
    unobserve() {}
    disconnect() {}
  }
  vi.stubGlobal('ResizeObserver', ResizeObserverMock)
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
    const width = this.classList.contains('tag-filter-bar__quick')
      ? quickWidth
      : this.closest('.tag-filter-bar__measure')
        ? tagWidths.get(this.getAttribute('title') ?? '') ?? 0
        : 0
    return { width } as DOMRect
  })
}

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
  quickWidth = 120
  resizeCallback = undefined
})

describe('TagFilterBar', () => {
  it('根据标签实际宽度和可用空间展示标签，并在尺寸变化后重新计算', async () => {
    installMeasurementMocks()
    const { container } = render(
      <TagFilterBar
        tags={tags}
        tagCounts={new Map(tags.map((tag) => [tag.id, 0]))}
        totalCount={0}
        untaggedCount={0}
        filter={{ tagIds: [], untaggedOnly: false }}
        onSelectAll={vi.fn()}
        onToggleTag={vi.fn()}
        onToggleUntagged={vi.fn()}
        onAdd={vi.fn()}
      />,
    )

    const visibleQuickTags = () => container.querySelector('.tag-filter-bar__quick')?.querySelectorAll('.tag-tab--quick')
    await waitFor(() => expect(visibleQuickTags()).toHaveLength(2))

    quickWidth = 230
    act(() => resizeCallback?.([], {} as ResizeObserver))
    await waitFor(() => expect(visibleQuickTags()).toHaveLength(4))
  })

  it('取消被提升的快捷标签后将焦点移到完整标签入口', async () => {
    installMeasurementMocks()
    const user = userEvent.setup()

    function StatefulTagFilterBar() {
      const [filter, setFilter] = useState({ tagIds: ['3'], untaggedOnly: false })
      return (
        <TagFilterBar
          tags={tags}
          tagCounts={new Map(tags.map((tag) => [tag.id, 0]))}
          totalCount={0}
          untaggedCount={0}
          filter={filter}
          onSelectAll={vi.fn()}
          onToggleTag={(tagId) => setFilter((current) => ({
            tagIds: current.tagIds.includes(tagId)
              ? current.tagIds.filter((id) => id !== tagId)
              : [...current.tagIds, tagId],
            untaggedOnly: false,
          }))}
          onToggleUntagged={vi.fn()}
          onAdd={vi.fn()}
        />
      )
    }

    const { container } = render(<StatefulTagFilterBar />)
    const quickTags = container.querySelector<HTMLElement>('.tag-filter-bar__quick')
    if (!quickTags) throw new Error('快捷标签区域未渲染')
    await waitFor(() => expect(within(quickTags).getAllByRole('button')).toHaveLength(2))

    const promotedTag = within(quickTags).getByRole('button', { name: /稍长标签/ })
    promotedTag.focus()
    await user.keyboard(' ')

    await waitFor(() => expect(screen.getByRole('button', { name: /查看全部标签/ })).toHaveFocus())
    expect(promotedTag).not.toBeInTheDocument()
  })

  it('将置顶标签排在选中和普通标签之前，并在浮层中保持相同顺序', async () => {
    installMeasurementMocks()
    const user = userEvent.setup()
    const prioritizedTags = tags.map((tag) => tag.id === '2' ? { ...tag, pinned: true } : tag)
    const { container } = render(
      <TagFilterBar
        tags={prioritizedTags}
        tagCounts={new Map(prioritizedTags.map((tag) => [tag.id, 0]))}
        totalCount={0}
        untaggedCount={0}
        filter={{ tagIds: ['3'], untaggedOnly: false }}
        onSelectAll={vi.fn()}
        onToggleTag={vi.fn()}
        onToggleUntagged={vi.fn()}
        onAdd={vi.fn()}
      />,
    )

    const quickTags = container.querySelector<HTMLElement>('.tag-filter-bar__quick')
    if (!quickTags) throw new Error('快捷标签区域未渲染')
    await waitFor(() => expect(within(quickTags).getAllByRole('button')).toHaveLength(2))
    expect(within(quickTags).getAllByRole('button').map((button) => button.getAttribute('title'))).toEqual(['阅读', '稍长标签'])

    await user.click(screen.getByRole('button', { name: /查看全部标签/ }))
    const popover = await screen.findByRole('dialog', { name: '全部标签' })
    expect(within(popover).getAllByRole('button').slice(1, 5).map((button) => button.getAttribute('title'))).toEqual([
      '阅读', '稍长标签', '短标签', '工作',
    ])
  })

  it('将 Command 或 Ctrl 点击作为多选意图传给调用方', async () => {
    installMeasurementMocks()
    const onToggleTag = vi.fn()
    const { container } = render(
      <TagFilterBar
        tags={tags}
        tagCounts={new Map(tags.map((tag) => [tag.id, 0]))}
        totalCount={0}
        untaggedCount={0}
        filter={{ tagIds: [], untaggedOnly: false }}
        onSelectAll={vi.fn()}
        onToggleTag={onToggleTag}
        onToggleUntagged={vi.fn()}
        onAdd={vi.fn()}
      />,
    )

    const quickTags = container.querySelector<HTMLElement>('.tag-filter-bar__quick')
    if (!quickTags) throw new Error('快捷标签区域未渲染')
    await waitFor(() => expect(within(quickTags).getAllByRole('button')).toHaveLength(2))

    fireEvent.click(within(quickTags).getByRole('button', { name: /短标签/ }), { ctrlKey: true })
    expect(onToggleTag).toHaveBeenLastCalledWith('0', true)
  })
})
