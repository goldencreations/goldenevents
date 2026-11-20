export const isAppShell = () => import.meta.env.VITE_APP_SHELL === '1';

export function installShellClass() {
  if (isAppShell()) document.documentElement.classList.add('app-shell');
}
