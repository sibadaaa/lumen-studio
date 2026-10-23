import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react";

export type ThemePref = "system" | "light" | "dark";
export type ResolvedTheme = "light" | "dark";

const STORAGE_KEY = "lumen.theme";

function readStoredPref(): ThemePref {
  try {
    const value = localStorage.getItem(STORAGE_KEY);
    if (value === "light" || value === "dark" || value === "system") return value;
  } catch {
    /* storage unavailable */
  }
  return "system";
}

function systemPrefersDark() {
  return typeof window !== "undefined" && window.matchMedia("(prefers-color-scheme: dark)").matches;
}

function resolve(pref: ThemePref): ResolvedTheme {
  if (pref === "system") return systemPrefersDark() ? "dark" : "light";
  return pref;
}

function applyTheme(theme: ResolvedTheme) {
  const root = document.documentElement;
  root.dataset.theme = theme;
  document.querySelector('meta[name="color-scheme"]')?.setAttribute("content", theme);
}

interface ThemeContextValue {
  pref: ThemePref;
  resolved: ResolvedTheme;
  setTheme: (pref: ThemePref) => void;
  cycleTheme: () => void;
}

const ThemeContext = createContext<ThemeContextValue | null>(null);

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [pref, setPref] = useState<ThemePref>(readStoredPref);
  const resolved = useMemo(() => resolve(pref), [pref]);

  useEffect(() => {
    applyTheme(resolved);
    if (pref !== "system") return;
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const onChange = () => applyTheme(resolve("system"));
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, [pref, resolved]);

  const value = useMemo<ThemeContextValue>(
    () => ({
      pref,
      resolved,
      setTheme: (next) => {
        setPref(next);
        try {
          localStorage.setItem(STORAGE_KEY, next);
        } catch {
          /* private mode: session-only */
        }
      },
      cycleTheme: () => {
        setPref((prev) => {
          const next: ThemePref = prev === "light" ? "dark" : prev === "dark" ? "system" : "light";
          try {
            localStorage.setItem(STORAGE_KEY, next);
          } catch {
            /* ignore */
          }
          return next;
        });
      },
    }),
    [pref, resolved]
  );

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme() {
  const context = useContext(ThemeContext);
  if (!context) throw new Error("useTheme must be used inside ThemeProvider");
  return context;
}
