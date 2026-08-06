/**
 * 采集页接相机流的方式 —— 源码级守卫。
 *
 * 这一组是被一个线上故障换来的：「打开相机」之后画面全黑，按快门永远报
 * 「相机还没准备好」。根因是 openCamera 里 setCameraOn(true) 之后用
 * queueMicrotask 去接 videoRef —— React 的渲染排在宏任务，微任务必定跑在提交之前，
 * 于是 videoRef.current 恒为 null，srcObject 从来没被赋值过。
 *
 * ⚠️ 说清楚这个测试的性质：它检查的是**源码写法**，不是运行时行为。
 * 本项目的 vitest 跑在 node 环境、不含 DOM，渲染一个组件需要引入 jsdom 与
 * testing-library —— 为这一条回归引整套 DOM 测试栈不划算。
 * 真正的时序逻辑（何时算有画面、超时、abort）在 camera.test.ts 里是真跑的；
 * 这里只锁住「别再退回原来那种写法」。
 */

import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath, URL } from 'node:url'

const raw = readFileSync(
  fileURLToPath(new URL('../../ui/pages/Capture.tsx', import.meta.url)),
  'utf8',
)

/**
 * 先去掉注释再检查。
 * 文件里那段注释本身就在讲 queueMicrotask 这个坑，不剔掉的话守卫会被自己的说明文字绊倒。
 * 换成空白而不是删掉，保证下面按下标比较先后顺序仍然成立。
 */
const src = raw.replace(/\/\*[\s\S]*?\*\/|\/\/[^\n]*/g, (m) => m.replace(/[^\n]/g, ' '))

describe('Capture.tsx 的相机接线', () => {
  it('不用 queueMicrotask 接流 —— 那正是当初的 bug', () => {
    expect(src).not.toContain('queueMicrotask')
  })

  it('srcObject 的赋值出现在 useEffect 之后，而不是在 openCamera 里', () => {
    const assign = src.indexOf('.srcObject = stream')
    expect(assign, '没找到接流的地方').toBeGreaterThan(0)

    // 赋值点之前最近的一个 useEffect( 必须比最近的一个 openCamera 定义更靠后
    const effect = src.lastIndexOf('useEffect(', assign)
    const opener = src.lastIndexOf('async function openCamera', assign)
    expect(effect, 'srcObject 必须在 effect 里赋值').toBeGreaterThan(-1)
    expect(effect).toBeGreaterThan(opener)
  })

  it('等到有画面才放开快门', () => {
    expect(src).toContain('waitForVideoReady')
    expect(src).toContain('setCameraReady(true)')
    // 按钮禁用与 onShutter 里各一道，缺一不可
    expect(src).toContain('disabled={!cameraReady}')
    expect(src).toMatch(/onShutter[\s\S]{0,200}!cameraReady/)
  })

  it('离开相机时把 srcObject 也断开，不留悬挂引用', () => {
    expect(src).toContain('v.srcObject = null')
  })

  it('相机开不了时，报的是分类过的原因而不是一句笼统的话', () => {
    expect(src).toContain('cameraUnavailableReason')
    expect(src).toContain('cameraErrorMessage')
  })

  it('镜像跟着当前朝向走，而不是跟着相术类型写死', () => {
    expect(src).toContain('mirrorFor(facing)')
    // 原先是 spec.type === 'tixiang' ? 'none' : 'scaleX(-1)'，后摄一翻就拍反了
    expect(src).not.toMatch(/transform:\s*spec\.type/)
  })

  it('切换前先停掉旧流 —— 多数手机不许同时占两路摄像头', () => {
    const flip = src.slice(src.indexOf('async function flipCamera'))
    const stop = flip.indexOf('getTracks()')
    const open = flip.indexOf('openCameraStream')
    expect(stop, '没找到停流').toBeGreaterThan(-1)
    expect(open, '没找到开流').toBeGreaterThan(-1)
    expect(stop, '停流必须排在开流之前').toBeLessThan(open)
  })
})
