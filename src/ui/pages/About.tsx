import { Link } from 'react-router'
import { ALL_TYPES, TYPE_SPECS } from '@/core/registry'
import { FULL_DISCLAIMER } from '@/copy/disclaimer.zh-CN'
import { Seal } from '../components/Seal'

const CLASSICS: { name: string; author: string; note: string }[] = [
  { name: '麻衣神相', author: '麻衣道者 · 北宋', note: '面相学奠基之作，系统化面相理论' },
  { name: '柳庄相法', author: '袁珙 · 明初', note: '实战案例丰富，注重实践应用' },
  { name: '神相全编', author: '袁忠彻 · 明代', note: '相术集大成，涵盖面相手相骨相' },
  { name: '水镜神相', author: '范蠡（传）', note: '简明实用' },
  { name: '冰鉴', author: '曾国藩 · 清代', note: '观人术，侧重气质与才能' },
  { name: '太清神鉴', author: '佚名 · 宋代', note: '骨相气色，形神兼备' },
  { name: '人伦大统赋', author: '佚名 · 金元', note: '歌赋体相法' },
]

export function About() {
  return (
    <div className="page px-6 pt-8 pb-16">
      <div className="flex items-center justify-between">
        <Link to="/" className="font-title text-[13px] tracking-[0.1em] text-muted">
          ← 返回
        </Link>
        <h1 className="font-title text-base tracking-[0.25em]">关于</h1>
        <span className="w-12" />
      </div>

      <div className="rule-gold my-6" />

      <section className="mb-10">
        <h2 className="font-title mb-3 text-sm tracking-[0.15em]">这是什么</h2>
        <p className="text-[13px] leading-loose text-muted">
          一个把传统相术当作文化来玩的应用。你拍一张照片，
          应用在你的设备本地提取几何特征，把算出来的数值交给 AI，
          用传统相书的框架生成一份解读。
        </p>
      </section>

      <section className="mb-10">
        <h2 className="font-title mb-4 text-sm tracking-[0.15em]">四相与出处</h2>
        <div className="flex flex-col gap-4">
          {ALL_TYPES.map((t) => {
            const s = TYPE_SPECS[t]
            return (
              <div key={t} className="flex gap-3">
                <span
                  aria-hidden
                  className="mt-1 h-full w-[2px] shrink-0"
                  style={{ background: s.accent, opacity: 0.8 }}
                />
                <div>
                  <p className="font-title text-[15px] tracking-[0.1em]">
                    {s.name}
                    <span className="ml-2 text-[11px] tracking-normal text-subtle">{s.pinyin}</span>
                  </p>
                  <p className="mt-1 text-[12px] text-muted">{s.aspects.join(' · ')}</p>
                  <p className="mt-1 text-[11px] text-subtle">
                    出处：{s.classics.map((c) => `《${c}》`).join('')}
                  </p>
                </div>
              </div>
            )
          })}
        </div>
      </section>

      <section className="mb-10">
        <h2 className="font-title mb-4 text-sm tracking-[0.15em]">知识来源</h2>
        <div className="flex flex-col gap-3">
          {CLASSICS.map((c) => (
            <div key={c.name} className="flex items-baseline justify-between gap-3">
              <div>
                <span className="font-title text-[13px]">《{c.name}》</span>
                <span className="ml-2 text-[11px] text-subtle">{c.author}</span>
              </div>
              <span className="shrink-0 text-right text-[11px] text-subtle">{c.note}</span>
            </div>
          ))}
        </div>
      </section>

      <section className="mb-10">
        <h2 className="font-title mb-3 text-sm tracking-[0.15em]">关于那些「不好听的话」</h2>
        <p className="text-[13px] leading-loose text-muted">
          传统相书成书于千百年前，里面有不少在今天看来属于人格贬损、性别偏见、
          身材歧视和伪医学断言的内容 —— 比如「耳小薄削主短命」「掌色发黄主肝胆问题」。
          这些内容没有进入本应用的规则库。我们保留传统相术的框架、术语和观察角度，
          剔除其中的贬损性判断。
        </p>
        <p className="mt-3 text-[13px] leading-loose text-muted">
          另外：测不到的东西我们不会瞎猜。比如骨相里的枕骨、顶骨、耳后骨，
          任何照片都拍不到，报告里会如实写明「未观测，不作论断」。
        </p>
      </section>

      <div className="rule-gold my-8" />

      <section className="mb-10">
        <h2 className="font-title mb-3 text-sm tracking-[0.15em]">免责声明</h2>
        <p className="text-[12px] leading-loose whitespace-pre-line text-subtle">
          {FULL_DISCLAIMER.replaceAll('**', '')}
        </p>
      </section>

      <div className="flex flex-col items-center gap-3">
        <Seal size={40} />
        <p className="text-[11px] text-subtle">相由心生 · 命由己造</p>
        {/* PWA 会拿旧壳顶一阵子。出问题时先对一下这个，再判断是不是版本没更新 */}
        <p className="text-[10px] text-subtle">构建 {__BUILD_ID__}</p>
      </div>
    </div>
  )
}
