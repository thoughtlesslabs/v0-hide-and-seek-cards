import { useEffect, useId, useRef, type ReactNode } from "react"
import { X } from "lucide-react"

interface DialogProps {
  open: boolean
  title: string
  description?: string
  children: ReactNode
  onClose: () => void
  closeLabel?: string
}

export function Dialog({ open, title, description, children, onClose, closeLabel = "Close dialog" }: DialogProps) {
  const ref = useRef<HTMLDialogElement>(null)
  const restoreFocusRef = useRef<HTMLElement | null>(null)
  const titleId = useId()
  const descriptionId = useId()

  useEffect(() => {
    const dialog = ref.current
    if (!dialog) return
    if (open && !dialog.open) {
      restoreFocusRef.current = document.activeElement as HTMLElement | null
      dialog.showModal()
      window.requestAnimationFrame(() => {
        dialog.querySelector<HTMLElement>("[data-autofocus], button, input, select, textarea")?.focus()
      })
    } else if (!open && dialog.open) {
      dialog.close()
    }
  }, [open])

  useEffect(
    () => () => {
      restoreFocusRef.current?.focus()
    },
    [],
  )

  return (
    <dialog
      ref={ref}
      className="dialog"
      aria-labelledby={titleId}
      aria-describedby={description ? descriptionId : undefined}
      onCancel={(event) => {
        event.preventDefault()
        onClose()
      }}
      onClose={() => {
        restoreFocusRef.current?.focus()
        if (open) onClose()
      }}
      onClick={(event) => {
        if (event.target === ref.current) onClose()
      }}
    >
      <div className="dialog__panel">
        <button className="icon-button dialog__close" type="button" onClick={onClose} aria-label={closeLabel}>
          <X aria-hidden="true" />
        </button>
        <h2 id={titleId}>{title}</h2>
        {description && (
          <p id={descriptionId} className="dialog__description">
            {description}
          </p>
        )}
        {children}
      </div>
    </dialog>
  )
}
