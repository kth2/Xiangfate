import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { RouterProvider } from 'react-router/dom'
import { router } from './router'
import { installStaleChunkReload } from './ui/staleBuild'
import './styles/index.css'

// 部署后旧标签页会去请求已被换掉 hash 的分片，必须在挂载前装上兜底
installStaleChunkReload()

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <RouterProvider router={router} />
  </StrictMode>,
)
