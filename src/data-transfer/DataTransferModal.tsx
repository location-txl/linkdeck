import { useRef, useState } from 'react'
import { Icon } from '../components/Icon'
import { Modal } from '../components/Modal'
import { GistSyncPanel } from '../gist-sync/GistSyncPanel'
import type { GistSyncViewState } from '../gist-sync/types'
import type { CollectionSnapshot, ImportMode } from '../types'
import { downloadBackup, readBackupFile, type LinkDeckBackup } from './data-transfer'

type DataTransferModalProps = {
  snapshot: CollectionSnapshot
  onClose: () => void
  onExported: (filename: string) => void
  onImport: (snapshot: CollectionSnapshot, mode: ImportMode) => Promise<void>
  onGistSyncStateChange?: (state: GistSyncViewState) => void
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : '处理 JSON 文件时出现未知错误。'
}

export function DataTransferModal({
  snapshot,
  onClose,
  onExported,
  onImport,
  onGistSyncStateChange,
}: DataTransferModalProps) {
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [selected, setSelected] = useState<{ fileName: string; backup: LinkDeckBackup }>()
  const [mode, setMode] = useState<ImportMode>()
  const [formError, setFormError] = useState<string>()
  const [importing, setImporting] = useState(false)

  const exportJson = () => {
    setFormError(undefined)
    try {
      onExported(downloadBackup(snapshot))
    } catch (error) {
      setFormError(errorMessage(error))
    }
  }

  const selectFile = async (file?: File) => {
    if (!file) return
    setFormError(undefined)
    setSelected(undefined)
    setMode(undefined)
    try {
      const backup = await readBackupFile(file)
      setSelected({ fileName: file.name, backup })
    } catch (error) {
      setFormError(errorMessage(error))
    } finally {
      if (fileInputRef.current) fileInputRef.current.value = ''
    }
  }

  const importJson = async () => {
    if (!selected || !mode) return
    setFormError(undefined)
    setImporting(true)
    try {
      await onImport(selected.backup.data, mode)
    } catch (error) {
      setFormError(errorMessage(error))
    } finally {
      setImporting(false)
    }
  }

  return (
    <Modal title={selected ? '确认导入' : '数据管理'} onClose={onClose} size="wide">
      <input
        ref={fileInputRef}
        className="data-transfer__file-input"
        type="file"
        accept=".json,application/json"
        aria-label="选择 JSON 备份文件"
        onChange={(event) => void selectFile(event.target.files?.[0])}
      />

      {selected ? (
        <div className="data-transfer data-transfer--preview">
          <div className="backup-file">
            <span className="backup-file__mark" aria-hidden="true">
              <Icon name="deck" size={19} />
            </span>
            <div>
              <strong>{selected.fileName}</strong>
              <span>
                {selected.backup.data.meta.tags.length} 个标签 · {selected.backup.data.bookmarks.length} 个网站
              </span>
            </div>
            <button
              className="text-button"
              type="button"
              onClick={() => fileInputRef.current?.click()}
            >
              重新选择
            </button>
          </div>

          <fieldset className="import-modes">
            <legend>选择导入方式</legend>
            <label className={mode === 'merge' ? 'import-mode import-mode--active' : 'import-mode'}>
              <input
                type="radio"
                name="import-mode"
                value="merge"
                checked={mode === 'merge'}
                onChange={() => setMode('merge')}
              />
              <span className="import-mode__radio" aria-hidden="true" />
              <span>
                <strong>智能合并</strong>
                <small>保留当前数据；同名标签归并，重复网址合并标签。</small>
              </span>
            </label>
            <label className={mode === 'replace' ? 'import-mode import-mode--danger import-mode--active' : 'import-mode import-mode--danger'}>
              <input
                type="radio"
                name="import-mode"
                value="replace"
                checked={mode === 'replace'}
                onChange={() => setMode('replace')}
              />
              <span className="import-mode__radio" aria-hidden="true" />
              <span>
                <strong>完整替换</strong>
                <small>清除当前 {snapshot.meta.tags.length} 个标签和 {snapshot.bookmarks.length} 个网站。</small>
              </span>
            </label>
          </fieldset>

          {mode === 'replace' && (
            <p className="data-transfer__warning">
              <Icon name="warning" size={15} />
              当前收藏会被备份内容覆盖，此操作无法撤销。
            </p>
          )}
          {formError && <p className="form__error">{formError}</p>}

          <footer className="data-transfer__footer">
            <button className="button button--quiet" type="button" onClick={onClose}>
              取消
            </button>
            <button
              className={mode === 'replace' ? 'button button--danger-solid' : 'button button--ink'}
              type="button"
              disabled={!mode || importing}
              onClick={() => void importJson()}
            >
              {importing ? '导入中…' : mode ? '开始导入' : '请选择导入方式'}
            </button>
          </footer>
        </div>
      ) : (
        <div className="data-transfer">
          <div className="data-transfer__summary">
            <span>
              <b>{snapshot.meta.tags.length}</b>
              个标签
            </span>
            <i />
            <span>
              <b>{snapshot.bookmarks.length}</b>
              个网站
            </span>
          </div>

          <div className="data-transfer__actions">
            <button className="transfer-action" type="button" onClick={exportJson}>
              <span className="transfer-action__mark transfer-action__mark--export">
                <Icon name="download" size={19} />
              </span>
              <span>
                <strong>导出 JSON</strong>
                <small>下载全部标签和收藏，留作备份。</small>
              </span>
              <Icon name="chevron-right" size={16} />
            </button>
            <button
              className="transfer-action"
              type="button"
              onClick={() => fileInputRef.current?.click()}
            >
              <span className="transfer-action__mark transfer-action__mark--import">
                <Icon name="upload" size={19} />
              </span>
              <span>
                <strong>导入 JSON</strong>
                <small>先检查备份内容，再选择导入方式。</small>
              </span>
              <Icon name="chevron-right" size={16} />
            </button>
          </div>

          <GistSyncPanel onStateChange={onGistSyncStateChange} />

          {formError && <p className="form__error">{formError}</p>}
          <p className="data-transfer__privacy">
            <Icon name="check" size={14} />
            备份文件仅在本地处理，不会上传到网络。
          </p>
        </div>
      )}
    </Modal>
  )
}
