import { useState } from 'react'
import { Icon } from './Icon'
import { Modal } from './Modal'

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : '出现未知错误，请稍后重试。'
}

type ConfirmModalProps = {
  title: string
  mark: 'trash' | 'warning'
  children: React.ReactNode
  onClose: () => void
  onConfirm: () => Promise<void>
  confirmLabel: string
}

/** 带二次确认的通用确认弹窗；确认动作执行失败时在弹窗内展示错误。 */
export function ConfirmModal({ title, mark, children, onClose, onConfirm, confirmLabel }: ConfirmModalProps) {
  const [busy, setBusy] = useState(false)
  const [formError, setFormError] = useState<string>()
  const confirm = async () => {
    setBusy(true)
    setFormError(undefined)
    try {
      await onConfirm()
    } catch (caught) {
      setFormError(errorMessage(caught))
    } finally {
      setBusy(false)
    }
  }
  return <Modal title={title} onClose={onClose}><div className="confirm"><span className="confirm__mark"><Icon name={mark} size={18} /></span>{children}{formError && <p className="form__error">{formError}</p>}<footer className="form__footer"><button className="button button--quiet" type="button" onClick={onClose}>取消</button><button className="button button--danger-solid" type="button" disabled={busy} onClick={() => void confirm()}>{busy ? '处理中…' : confirmLabel}</button></footer></div></Modal>
}
