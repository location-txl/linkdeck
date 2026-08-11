import { act, cleanup, render, waitFor } from '@testing-library/react'
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

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
  resizeCallback = undefined
})

describe('TagFilterBar', () => {
  it('根据标签实际宽度和可用空间展示标签，并在尺寸变化后重新计算', async () => {
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

    const tags = [...tagWidths.keys()].map((name, index) => ({
      id: String(index),
      name,
      createdAt: index,
      updatedAt: index,
    }))
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
})
