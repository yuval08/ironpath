import { useEffect } from 'react';
import type { ThemeMode } from '@/types';

/** Applies the theme to <html data-theme> and follows the OS when set to 'system'. */
export function useTheme(mode: ThemeMode | undefined): void {
  useEffect(() => {
    const media = window.matchMedia('(prefers-color-scheme: dark)');
    const apply = () => {
      const resolved =
        mode === 'system' || mode == null ? (media.matches ? 'dark' : 'light') : mode;
      document.documentElement.dataset.theme = resolved;
    };
    apply();
    media.addEventListener('change', apply);
    return () => media.removeEventListener('change', apply);
  }, [mode]);
}
