import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { X } from "lucide-react";

interface Props {
  open: boolean;
  title: string;
  description?: string;
  initialValue: string;
  label: string;
  placeholder?: string;
  maxLength?: number;
  busy?: boolean;
  onClose: () => void;
  onSubmit: (value: string) => void;
}

/** Small single-field rename dialog shared by projects and agent sessions. */
export function RenameDialog({
  open,
  title,
  description,
  initialValue,
  label,
  placeholder,
  maxLength = 80,
  busy = false,
  onClose,
  onSubmit,
}: Props) {
  const { t } = useTranslation("base");
  const [value, setValue] = useState(initialValue);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!open) return;
    setValue(initialValue);
    const frame = window.requestAnimationFrame(() => {
      inputRef.current?.focus();
      inputRef.current?.select();
    });
    return () => window.cancelAnimationFrame(frame);
  }, [open, initialValue]);

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [open, onClose]);

  if (!open) return null;

  const trimmed = value.trim();
  const submit = () => {
    if (!trimmed || busy) return;
    onSubmit(trimmed);
  };

  return (
    <div className="modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <div className="modal rename-dialog" role="dialog" aria-modal="true" aria-labelledby="renameDialogTitle">
        <header className="modal-head">
          <div>
            <span className="eyebrow">RENAME</span>
            <h2 id="renameDialogTitle">{title}</h2>
            {description && <p>{description}</p>}
          </div>
          <button className="modal-close" type="button" onClick={onClose} aria-label={t("close")}>
            <X size={15} />
          </button>
        </header>
        <div className="modal-body">
          <label className="form-field full">
            <span>{label}</span>
            <input
              ref={inputRef}
              value={value}
              maxLength={maxLength}
              placeholder={placeholder}
              onChange={(event) => setValue(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  event.preventDefault();
                  submit();
                }
              }}
            />
            <small>{t("renameHint", { max: maxLength })}</small>
          </label>
        </div>
        <footer className="modal-foot">
          <span className="test-state">{trimmed ? "" : t("renameRequired")}</span>
          <div className="modal-foot-right">
            <button className="text-btn" type="button" onClick={onClose}>{t("cancel")}</button>
            <button className="save-btn" type="button" disabled={!trimmed || busy} onClick={submit}>
              {busy ? t("saving") : t("save")}
            </button>
          </div>
        </footer>
      </div>
    </div>
  );
}
