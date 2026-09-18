'use client'

import { createContext, useContext, useEffect, useState, useCallback } from 'react'

type Theme = 'dark' | 'light'

interface ThemeContextValue {
  theme: Theme
  toggleTheme: () => void
  setTheme: (theme: Theme) => void
}

const ThemeContext = createContext<ThemeContextValue | undefined>(undefined)

const STORAGE_KEY = 'ob-crm-theme'

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const [theme, setThemeState] = useState<Theme>('dark')

  // Read saved theme on mount
  useEffect(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEY) as Theme | null
      if (saved === 'light' || saved === 'dark') {
        setThemeState(saved)
        document.documentElement.setAttribute('data-theme', saved)
      } else {
        // Default to dark
        document.documentElement.setAttribute('data-theme', 'dark')
      }
    } catch {
      document.documentElement.setAttribute('data-theme', 'dark')
    }
  }, [])

  const setTheme = useCallback((newTheme: Theme) => {
    setThemeState(newTheme)
    document.documentElement.setAttribute('data-theme', newTheme)
    try {
      localStorage.setItem(STORAGE_KEY, newTheme)
    } catch {
      // localStorage may be unavailable
    }
  }, [])

  const toggleTheme = useCallback(() => {
    setTheme(theme === 'dark' ? 'light' : 'dark')
  }, [theme, setTheme])

  /* The context is provided on every render, including the server one.
     Gating it on a mounted flag and returning bare children until then is
     what broke /dashboard: useTheme throws when it cannot find the provider,
     so every page carrying the theme toggle died on first paint.

     Nothing is lost by dropping the gate. The flash it was guarding against
     is already handled in app/layout.tsx, by an inline script that reads the
     saved theme and sets data-theme on <html> before the first paint, and the
     styling keys off that attribute rather than off this state. */
  return (
    <ThemeContext.Provider value={{ theme, toggleTheme, setTheme }}>
      {children}
    </ThemeContext.Provider>
  )
}

/* A missing provider must never take a page down. This threw, and on the
   first real sign-in it killed /dashboard outright: a colour scheme is not
   worth a white screen over. Falling back to the default leaves the page
   working and the toggle inert, which is a cosmetic fault a person can see
   and report, rather than an outage.

   The warning still fires in development so the mistake is not silent. */
const FALLBACK: ThemeContextValue = {
  theme: 'dark',
  toggleTheme: () => {},
  setTheme: () => {},
}

export function useTheme() {
  const context = useContext(ThemeContext)
  if (!context) {
    if (process.env.NODE_ENV !== 'production') {
      console.warn('useTheme was called outside a ThemeProvider; using the default theme.')
    }
    return FALLBACK
  }
  return context
}
