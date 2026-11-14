/** 注入页面共用的底部通知；dispose 后停止显示并移除挂载的提示。 */
export function createNotice() {
  let active = true
  let notice: HTMLDivElement | undefined
  let noticeTimer: ReturnType<typeof setTimeout> | undefined
  const show = (text: string, retry?: () => void) => {
    if (!active) return
    notice?.remove()
    clearTimeout(noticeTimer)
    notice = document.createElement('div')
    notice.setAttribute('role', 'status')
    notice.dataset.linkdeckNotice = ''
    Object.assign(notice.style, {
      position: 'fixed', bottom: '24px', left: '50%', transform: 'translateX(-50%)',
      zIndex: '2147483647', padding: '12px 18px', borderRadius: '12px',
      background: '#17212b', color: '#fff', font: '14px/1.5 system-ui, sans-serif',
      boxShadow: '0 4px 24px #0004', maxWidth: 'min(480px, 85vw)',
    })
    notice.append(document.createTextNode(text))
    if (retry) {
      const button = document.createElement('button')
      button.type = 'button'
      button.textContent = '重试'
      Object.assign(button.style, { marginLeft: '12px', color: '#fff', background: 'transparent', border: '1px solid #fff', borderRadius: '4px', cursor: 'pointer' })
      button.onclick = () => { button.disabled = true; retry() }
      notice.append(button)
    }
    document.body.append(notice)
    noticeTimer = setTimeout(() => notice?.remove(), retry ? 15000 : 4000)
  }
  const dispose = () => {
    active = false
    notice?.remove()
    clearTimeout(noticeTimer)
  }
  return { show, dispose }
}
