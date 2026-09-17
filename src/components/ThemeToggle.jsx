'use client';
// Light / dark toggle. The design system styles through tokens and lets an
// explicit [data-theme] on <html> win over the system preference in both
// directions; this control only sets that attribute and remembers it.
import { useEffect, useState } from 'react';

const KEY = 'reli-theme';

export function ThemeToggle() {
  const [theme, setTheme] = useState(null);
  useEffect(() => {
    const t = document.documentElement.getAttribute('data-theme');
    setTheme(t === 'dark' ? 'dark' : t === 'light' ? 'light' : (window.matchMedia?.('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'));
  }, []);
  function toggle() {
    const next = theme === 'dark' ? 'light' : 'dark';
    document.documentElement.setAttribute('data-theme', next);
    try { window.localStorage.setItem(KEY, next); } catch { /* private mode: not remembered */ }
    setTheme(next);
  }
  const dark = theme === 'dark';
  return (
    <button type="button" className="btn btn-ghost btn-sm theme-toggle" onClick={toggle}
      aria-pressed={dark} aria-label={dark ? 'Switch to light theme' : 'Switch to dark theme'} data-theme-toggle="">
      {dark ? 'Light' : 'Dark'}
    </button>
  );
}

/** Inline, blocking, tiny: applies the remembered theme before first paint. */
export const THEME_BOOT = `try{var t=localStorage.getItem('${KEY}');if(t==='dark'||t==='light')document.documentElement.setAttribute('data-theme',t)}catch(e){}`;
