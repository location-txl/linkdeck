import { Combobox as ComboboxPrimitive } from '@base-ui/react'
import { useMemo, useState } from 'react'
import type { BookmarkDraft, Tag } from './types'
import { validateTagName } from './validation'
import { Icon } from '@linkdeck/ui/icon'

type TagInputProps = {
  tags: Tag[]
  value: Pick<BookmarkDraft, 'tagIds' | 'newTagNames'>
  onChange: (value: Pick<BookmarkDraft, 'tagIds' | 'newTagNames'>) => void
}

/**
 * 支持搜索、选择和草稿创建的多标签输入框。
 *
 * 新建标签仅保存在表单草稿中，调用方提交收藏时才与收藏一并持久化。
 */
export function TagInput({ tags, value, onChange }: TagInputProps) {
  const [query, setQuery] = useState('')
  const [inputError, setInputError] = useState<string>()
  const selectedTags = useMemo(
    () => tags.filter((tag) => value.tagIds.includes(tag.id)),
    [tags, value.tagIds],
  )
  const normalizedQuery = query.trim().toLocaleLowerCase()
  const exactTag = tags.find((tag) => tag.name.toLocaleLowerCase() === normalizedQuery) ??
    value.newTagNames.find((name) => name.toLocaleLowerCase() === normalizedQuery)
  const canCreate = Boolean(normalizedQuery) && !exactTag

  const updateTagIds = (nextTags: Tag[]) => {
    onChange({ tagIds: nextTags.map((tag) => tag.id), newTagNames: value.newTagNames })
  }

  const createDraftTag = () => {
    try {
      const name = validateTagName(query)
      if (tags.some((tag) => tag.name.toLocaleLowerCase() === name.toLocaleLowerCase()) ||
        value.newTagNames.some((tagName) => tagName.toLocaleLowerCase() === name.toLocaleLowerCase())) {
        setInputError('已有同名标签。')
        return
      }
      onChange({ tagIds: value.tagIds, newTagNames: [...value.newTagNames, name] })
      setQuery('')
      setInputError(undefined)
    } catch (error) {
      setInputError(error instanceof Error ? error.message : '标签名称不正确。')
    }
  }

  return (
    <div className="tag-input">
      <ComboboxPrimitive.Root
        items={tags}
        multiple
        value={selectedTags}
        autoHighlight
        itemToStringValue={(tag) => tag.name}
        isItemEqualToValue={(left, right) => left.id === right.id}
        onValueChange={updateTagIds}
        onInputValueChange={(next) => {
          setQuery(next)
          setInputError(undefined)
        }}
      >
        <ComboboxPrimitive.Chips className="tag-input__chips">
          <ComboboxPrimitive.Value>
            {(selected: Tag[]) => selected.map((tag) => (
              <ComboboxPrimitive.Chip className="tag-input__chip" key={tag.id}>
                {tag.name}
                <ComboboxPrimitive.ChipRemove aria-label={`移除标签 ${tag.name}`} className="tag-input__remove">
                  <Icon name="close" size={12} />
                </ComboboxPrimitive.ChipRemove>
              </ComboboxPrimitive.Chip>
            ))}
          </ComboboxPrimitive.Value>
          {value.newTagNames.map((name) => (
            <span className="tag-input__chip tag-input__chip--draft" key={name}>
              {name}
              <button
                className="tag-input__remove"
                type="button"
                aria-label={`移除新标签 ${name}`}
                onClick={() => onChange({
                  tagIds: value.tagIds,
                  newTagNames: value.newTagNames.filter((tagName) => tagName !== name),
                })}
              >
                <Icon name="close" size={12} />
              </button>
            </span>
          ))}
          <ComboboxPrimitive.Input
            className="tag-input__field"
            placeholder={selectedTags.length || value.newTagNames.length ? '继续添加标签' : '输入或选择标签'}
            onKeyDown={(event) => {
              if (event.key === 'Enter' && canCreate) {
                event.preventDefault()
                createDraftTag()
              }
            }}
          />
        </ComboboxPrimitive.Chips>

        <ComboboxPrimitive.Portal>
          <ComboboxPrimitive.Positioner className="tag-input__positioner" side="bottom" sideOffset={6} align="start">
            <ComboboxPrimitive.Popup className="tag-input__popup" initialFocus={false} finalFocus={false}>
              <ComboboxPrimitive.List className="tag-input__list">
                {(tag: Tag) => (
                  <ComboboxPrimitive.Item className="tag-input__item" key={tag.id} value={tag}>
                    <span>{tag.name}</span>
                    <ComboboxPrimitive.ItemIndicator className="tag-input__indicator">
                      <Icon name="check" size={14} />
                    </ComboboxPrimitive.ItemIndicator>
                  </ComboboxPrimitive.Item>
                )}
              </ComboboxPrimitive.List>
              {canCreate && (
                <button className="tag-input__create" type="button" onMouseDown={(event) => event.preventDefault()} onClick={createDraftTag}>
                  <Icon name="add" size={14} />
                  创建“{query.trim()}”
                </button>
              )}
              {!canCreate && tags.length === 0 && (
                <ComboboxPrimitive.Empty className="tag-input__empty">输入标签名称后按 Enter 创建</ComboboxPrimitive.Empty>
              )}
            </ComboboxPrimitive.Popup>
          </ComboboxPrimitive.Positioner>
        </ComboboxPrimitive.Portal>
      </ComboboxPrimitive.Root>
      {inputError && <p className="form__error">{inputError}</p>}
    </div>
  )
}
