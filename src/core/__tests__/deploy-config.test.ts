/**
 * 部署配置的健全性检查。
 *
 * 这个测试是被两次线上部署失败换来的：
 *   1. public/_redirects 里的 SPA 规则让 Cloudflare 判定为无限循环（100324）
 *   2. vercel.json 的 rewrites[0] 里塞了 "_comment" 说明，
 *      Vercel 的 schema 拒绝任何未知属性
 * 两次都是「配置文件本身没法本地验证」导致的 —— 只能等推上去才发现。
 * 这里把能静态检查的部分固化下来。
 */

import { describe, expect, it } from 'vitest'
import { existsSync, readFileSync } from 'node:fs'
import { fileURLToPath, URL } from 'node:url'

const root = (p: string) => fileURLToPath(new URL(`../../../${p}`, import.meta.url))

describe('vercel.json', () => {
  const raw = readFileSync(root('vercel.json'), 'utf8')
  const cfg = JSON.parse(raw) as Record<string, unknown>

  it('是合法 JSON 且有必需字段', () => {
    expect(cfg.outputDirectory).toBe('dist')
    expect(cfg.buildCommand).toBe('npm run build')
    expect(Array.isArray(cfg.rewrites)).toBe(true)
  })

  it('不含任何自造的下划线键 —— JSON 没有注释，Vercel 会拒绝未知属性', () => {
    // $schema 是 Vercel 官方支持的，其余以 _ 开头的都是我们自己加的说明文字
    const offenders: string[] = []
    const walk = (node: unknown, path: string) => {
      if (Array.isArray(node)) {
        node.forEach((v, i) => walk(v, `${path}[${i}]`))
        return
      }
      if (node && typeof node === 'object') {
        for (const [k, v] of Object.entries(node)) {
          if (k.startsWith('_')) offenders.push(`${path}.${k}`)
          walk(v, `${path}.${k}`)
        }
      }
    }
    walk(cfg, 'vercel.json')
    expect(offenders, `想写说明就写到 README，别塞进 JSON：${offenders.join(', ')}`).toEqual([])
  })

  it('SPA 回退指向 index.html', () => {
    const rewrites = cfg.rewrites as { source: string; destination: string }[]
    expect(rewrites.length).toBeGreaterThan(0)
    expect(rewrites.at(-1)?.destination).toBe('/index.html')
  })

  it('保留了相机权限 —— 少了它手机上开不了相机', () => {
    expect(raw).toContain('camera=(self)')
  })
})

describe('Cloudflare 的 _redirects 不能存在', () => {
  it('public/_redirects 与 dist/_redirects 都不该有', () => {
    // 通用 SPA 写法会被 Cloudflare 判定为无限循环，整个部署失败
    expect(existsSync(root('public/_redirects'))).toBe(false)
    expect(existsSync(root('dist/_redirects'))).toBe(false)
  })

  it('postbuild 上挂着清理脚本', () => {
    const pkg = JSON.parse(readFileSync(root('package.json'), 'utf8')) as {
      scripts: Record<string, string>
    }
    expect(pkg.scripts.postbuild).toContain('strip-redirects')
  })
})

describe('netlify.toml', () => {
  const raw = readFileSync(root('netlify.toml'), 'utf8')

  it('有 SPA 回退与正确的发布目录', () => {
    expect(raw).toContain('publish = "dist"')
    expect(raw).toContain('to = "/index.html"')
    expect(raw).toContain('status = 200')
  })

  it('保留了相机权限', () => {
    expect(raw).toContain('camera=(self)')
  })
})

describe('_headers 只给 Cloudflare 用', () => {
  it('存在且带相机权限', () => {
    const raw = readFileSync(root('public/_headers'), 'utf8')
    expect(raw).toContain('camera=(self)')
  })
})
