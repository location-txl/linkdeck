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
const overflowingTagWidths = new Map<string, number>([
  ...tagWidths,
  ['第五个标签', 50],
])

let firstQuickWidth = 230
let secondQuickWidth = 120
let resizeCallback: ResizeObserverCallback | undefined

const tags = [...tagWidths.keys()].map((name, index) => ({
  id: String(index),
  name,
  pinned: false,
  createdAt: index,
  updatedAt: index,
}))

function installMeasurementMocks(widths = tagWidths) {
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
    const width = this.classList.contains('tag-filter-bar__quick--first')
      ? firstQuickWidth
      : this.classList.contains('tag-filter-bar__quick--second')
        ? secondQuickWidth
        : this.closest('.tag-filter-bar__measure')
          ? widths.get(this.getAttribute('title') ?? '') ?? 0
          : 0
    return { width } as DOMRect
  })
}

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
  firstQuickWidth = 230
  secondQuickWidth = 120
  resizeCallback = undefined
})

describe('TagFilterBar', () => {
  it('根据标签实际宽度和可用空间展示标签，并在尺寸变化后重新计算', async () => {
    installMeasurementMocks(overflowingTagWidths)
    const overflowingTags = [...overflowingTagWidths.keys()].map((name, index) => ({
      id: String(index),
      name,
      pinned: false,
      createdAt: index,
      updatedAt: index,
    }))
    const { container } = render(
      <TagFilterBar
        tags={overflowingTags}
        tagCounts={new Map(overflowingTags.map((tag) => [tag.id, 0]))}
        totalCount={0}
        untaggedCount={0}
        filter={{ tagIds: [], untaggedOnly: false }}
        onSelectAll={vi.fn()}
        onToggleTag={vi.fn()}
        onToggleUntagged={vi.fn()}
        onAdd={vi.fn()}
      />,
    )

    const firstRowTags = () => container.querySelector('.tag-filter-bar__quick--first')?.querySelectorAll('.tag-tab--quick')
    const secondRowTags = () => container.querySelector('.tag-filter-bar__quick--second')?.querySelectorAll('.tag-tab--quick')
    await waitFor(() => {
      expect(firstRowTags()).toHaveLength(4)
      expect(secondRowTags()).toHaveLength(1)
    })

    firstQuickWidth = 120
    secondQuickWidth = 120
    act(() => resizeCallback?.([], {} as ResizeObserver))
    await waitFor(() => {
      expect(firstRowTags()).toHaveLength(2)
      expect(secondRowTags()).toHaveLength(2)
    })

    firstQuickWidth = 80
    secondQuickWidth = 80
    act(() => resizeCallback?.([], {} as ResizeObserver))
    await waitFor(() => {
      expect(firstRowTags()).toHaveLength(1)
      expect(secondRowTags()).toHaveLength(1)
    })
  })

  it('快捷标签消失后将焦点移到完整标签入口', async () => {
    installMeasurementMocks()
    const user = userEvent.setup()

    function StatefulTagFilterBar() {
      const [filter, setFilter] = useState({ tagIds: ['3'], untaggedOnly: false })
      const [visibleTags, setVisibleTags] = useState(tags)
      return (
        <TagFilterBar
          tags={visibleTags}
          tagCounts={new Map(visibleTags.map((tag) => [tag.id, 0]))}
          totalCount={0}
          untaggedCount={0}
          filter={filter}
          onSelectAll={vi.fn()}
          onToggleTag={(tagId) => {
            setFilter((current) => ({
              tagIds: current.tagIds.includes(tagId)
                ? current.tagIds.filter((id) => id !== tagId)
                : [...current.tagIds, tagId],
              untaggedOnly: false,
            }))
            setVisibleTags((current) => current.filter((tag) => tag.id !== tagId))
          }}
          onToggleUntagged={vi.fn()}
          onAdd={vi.fn()}
        />
      )
    }

    const { container } = render(<StatefulTagFilterBar />)
    const quickTags = container.querySelector<HTMLElement>('.tag-filter-bar__quick')
    if (!quickTags) throw new Error('快捷标签区域未渲染')
    await waitFor(() => expect(within(quickTags).getAllByRole('button')).toHaveLength(4))

    const removedTag = within(quickTags).getByRole('button', { name: /短标签/ })
    removedTag.focus()
    await user.keyboard(' ')

    await waitFor(() => expect(screen.getByRole('button', { name: /查看全部标签/ })).toHaveFocus())
    expect(removedTag).not.toBeInTheDocument()
  })

  it('收起快捷标签隐藏单标签数量，完整标签浮层保留数量', async () => {
    installMeasurementMocks()
    const user = userEvent.setup()
    const { container } = render(
      <TagFilterBar
        tags={tags}
        tagCounts={new Map(tags.map((tag, index) => [tag.id, index + 1]))}
        totalCount={10}
        untaggedCount={0}
        filter={{ tagIds: [], untaggedOnly: false }}
        onSelectAll={vi.fn()}
        onToggleTag={vi.fn()}
        onToggleUntagged={vi.fn()}
        onAdd={vi.fn()}
      />,
    )

    const quickTags = container.querySelector<HTMLElement>('.tag-filter-bar__quick--first')
    if (!quickTags) throw new Error('快捷标签区域未渲染')
    await waitFor(() => expect(within(quickTags).getAllByRole('button')).toHaveLength(4))
    expect(quickTags.querySelectorAll('em')).toHaveLength(0)

    await user.click(screen.getByRole('button', { name: /查看全部标签/ }))
    const popover = await screen.findByRole('dialog', { name: '全部标签' })
    expect(within(popover).getByRole('button', { name: /短标签/ }).querySelector('em')).toHaveTextContent('1')
  })

  it('置顶标签优先，切换选中状态不改变顺序，并在浮层中保持相同顺序', async () => {
    installMeasurementMocks()
    const user = userEvent.setup()
    const prioritizedTags = tags.map((tag) => tag.id === '2' ? { ...tag, pinned: true } : tag)
    const { container, rerender } = render(
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
    await waitFor(() => expect(within(quickTags).getAllByRole('button')).toHaveLength(4))
    const expectedOrder = ['阅读', '短标签', '工作', '稍长标签']
    expect(within(quickTags).getAllByRole('button').map((button) => button.getAttribute('title'))).toEqual(expectedOrder)

    rerender(
      <TagFilterBar
        tags={prioritizedTags}
        tagCounts={new Map(prioritizedTags.map((tag) => [tag.id, 0]))}
        totalCount={0}
        untaggedCount={0}
        filter={{ tagIds: ['1'], untaggedOnly: false }}
        onSelectAll={vi.fn()}
        onToggleTag={vi.fn()}
        onToggleUntagged={vi.fn()}
        onAdd={vi.fn()}
      />,
    )
    await waitFor(() => expect(within(quickTags).getAllByRole('button').map((button) => button.getAttribute('title'))).toEqual(expectedOrder))

    await user.click(screen.getByRole('button', { name: /查看全部标签/ }))
    const popover = await screen.findByRole('dialog', { name: '全部标签' })
    expect(within(popover).getAllByRole('button').slice(1, 5).map((button) => button.getAttribute('title'))).toEqual([
      '阅读', '短标签', '工作', '稍长标签',
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

    const quickTags = container.querySelector<HTMLElement>('.tag-filter-bar__quick--first')
    if (!quickTags) throw new Error('快捷标签区域未渲染')
    await waitFor(() => expect(within(quickTags).getAllByRole('button')).toHaveLength(4))

    fireEvent.click(within(quickTags).getByRole('button', { name: /短标签/ }), { ctrlKey: true })
    expect(onToggleTag).toHaveBeenLastCalledWith('0', true)
  })
})
