import { useEffect, useRef, useState } from "react";
import { Monitor, Moon, Settings2, Sun } from "lucide-react";
import { useTheme, type ThemePref } from "../theme";
import { SUPPORTED_LANGUAGES, isLocale, setLocale, useTranslation } from "../i18n";

/** Top-bar preferences popover: theme (3 states) + language. */
export function SettingsMenu() {
  const { t } = useTranslation("base");
  const { pref, resolved, setTheme, cycleTheme } = useTheme();
  const { i18n } = useTranslation();
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    const onClick = (event: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(event.target as Node)) setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    window.addEventListener("mousedown", onClick);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("mousedown", onClick);
    };
  }, [open]);

  const themeLabel = t(pref === "system" ? "themeSystem" : pref === "light" ? "themeLight" : "themeDark");
  const ThemeIcon = pref === "system" ? Monitor : resolved === "light" ? Sun : Moon;

  const changeLanguage = (code: string) => {
    if (isLocale(code)) setLocale(code);
  };

  return (
    <div className="settings-root" ref={rootRef}>
      <button
        className="icon-btn"
        title={t("themeAria", { value: themeLabel })}
        aria-label={t("themeAria", { value: themeLabel })}
        onClick={cycleTheme}
      >
        <ThemeIcon size={17} strokeWidth={1.4} />
      </button>
      <button
        className={`icon-btn ${open ? "is-active" : ""}`}
        aria-label={t("settingsTitle")}
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={() => setOpen((prev) => !prev)}
      >
        <Settings2 size={17} strokeWidth={1.4} />
      </button>
      {open && (
        <div className="settings-pop" role="dialog" aria-modal="false" aria-label={t("settingsTitle")}>
          <header>{t("settingsTitle")}</header>
          <fieldset>
            <legend>{t("appearance")}</legend>
            {([
              ["system", "themeSystem", "themeSystemHint"],
              ["light", "themeLight", ""],
              ["dark", "themeDark", ""],
            ] as const).map(([value, labelKey, hintKey]) => (
              <label key={value} className="settings-option">
                <input
                  type="radio"
                  name="lumen-theme"
                  checked={pref === value}
                  onChange={() => setTheme(value as ThemePref)}
                />
                <span>
                  <strong>{t(labelKey)}</strong>
                  {hintKey ? <small>{t(hintKey)}</small> : null}
                </span>
              </label>
            ))}
          </fieldset>
          <fieldset>
            <legend>{t("language")}</legend>
            {SUPPORTED_LANGUAGES.map((language) => (
              <label key={language.code} className="settings-option">
                <input
                  type="radio"
                  name="lumen-lang"
                  checked={i18n.language === language.code}
                  onChange={() => changeLanguage(language.code)}
                />
                <span><strong>{language.label}</strong></span>
              </label>
            ))}
          </fieldset>
          <footer>{t("storedLocally")}</footer>
        </div>
      )}
    </div>
  );
}
