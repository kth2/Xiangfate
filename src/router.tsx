import { lazy, Suspense } from 'react'
import { createBrowserRouter } from 'react-router'
import { AppShell } from './ui/AppShell'
import { Home } from './ui/pages/Home'
import { Loading } from './ui/components/Loading'
import { RouteError } from './ui/staleBuild'

/**
 * 路由用 React Router 而非文档 06 里提过的 TanStack Router：
 * 分析会话状态实际住在 Zustand（analysis.store），URL 只需要携带 analysisType，
 * 类型安全 search params 的收益因此很有限，不值得多一层 codegen。
 */

const Capture = lazy(() => import('./ui/pages/Capture').then((m) => ({ default: m.Capture })))
const Report = lazy(() => import('./ui/pages/Report').then((m) => ({ default: m.Report })))
const History = lazy(() => import('./ui/pages/History').then((m) => ({ default: m.History })))
const Settings = lazy(() => import('./ui/pages/Settings').then((m) => ({ default: m.Settings })))
const About = lazy(() => import('./ui/pages/About').then((m) => ({ default: m.About })))
// 开发用验证台。不在任何界面里链接，lazy 引入所以不进主包
const DevValidate = lazy(() =>
  import('./ui/pages/DevValidate').then((m) => ({ default: m.DevValidate })),
)

const withSuspense = (node: React.ReactNode) => <Suspense fallback={<Loading />}>{node}</Suspense>

export const router = createBrowserRouter([
  {
    path: '/',
    element: <AppShell />,
    // 分片加载失败会冒泡到这里。没有它就是 React Router 默认的
    // 「Unexpected Application Error!」+ 堆栈，用户无从下手
    errorElement: <RouteError />,
    children: [
      { index: true, element: <Home /> },
      { path: 'capture/:type', element: withSuspense(<Capture />) },
      { path: 'report/:id?', element: withSuspense(<Report />) },
      { path: 'history', element: withSuspense(<History />) },
      { path: 'settings', element: withSuspense(<Settings />) },
      { path: 'about', element: withSuspense(<About />) },
      { path: 'dev/validate', element: withSuspense(<DevValidate />) },
      { path: '*', element: <Home /> },
    ],
  },
])
