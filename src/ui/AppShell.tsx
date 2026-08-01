import { useEffect } from 'react'
import { Outlet, useLocation } from 'react-router'
import { useSettings } from '@/store/settings.store'
import { FirstRunGate } from './components/FirstRunGate'

export function AppShell() {
  const theme = useSettings((s) => s.theme)
  const { pathname } = useLocation()

  useEffect(() => {
    const root = document.documentElement
    const apply = (dark: boolean) => root.classList.toggle('dark', dark)

    if (theme === 'system') {
      const mq = window.matchMedia('(prefers-color-scheme: dark)')
      apply(mq.matches)
      const onChange = (e: MediaQueryListEvent) => apply(e.matches)
      mq.addEventListener('change', onChange)
      return () => mq.removeEventListener('change', onChange)
    }
    apply(theme === 'dark')
  }, [theme])

  // 换页回到顶部
  useEffect(() => {
    window.scrollTo(0, 0)
  }, [pathname])

  return (
    <FirstRunGate>
      <Outlet />
    </FirstRunGate>
  )
}
