/**
 * 面相的组合成象表。
 *
 * 这里只放**数据**，判定逻辑在 core/configuration.ts —— 与 thresholds.ts 同一个分工。
 *
 * ── 收录标准（很重要，请勿放宽）─────────────────────────────
 * 一条组合要进这张表，必须同时满足：
 *   1. **古法有名目。** `basis` 要写清凭什么这么断，能追到相书的说法。
 *      组合规则比单特征规则表达力强得多，也因此更容易过拟合 ——
 *      没有出处的组合就只是「我们希望某张脸读起来像这样」。
 *   2. **关系已经被量出来了。** 只用现成的特征 id，不新增度量。
 *      跨特征的比值（如中岳 ÷ 四岳）必须已经是某个 feature 的 value
 *      （wuYue.centrality、nose.alarFlare 正是这类），
 *      因为条件语言只能对单个特征取档位或数值区间。
 *   3. **正反两面都写。** 传统相术几乎没有纯吉之象 ——「权骨隆起」下一句
 *      就是「过显则好压人一头」。貴格分支不给 caution 不算写完。
 *
 * ⚠️ **不得为了让某张具体的脸读起来「对」而增删条目或挪动判线。**
 *    那是拿已知答案回头拟合，与相书当年只观察成功者的毛病是同一个。
 *
 * ── 判线的来处 ────────────────────────────────────────────
 * face3d.* 一律 band='categorical'，没有可用档位，因此只能对 value 取区间。
 * 下面每条数值判线都取自该度量**自身定义**（见 features/ 里各 spec 的 describe），
 * 不是拟合出来的：
 *   · wuYue.support     定义 1 = 四岳齐整有辅，0 = 彼此悬殊
 *   · wuYue.centrality  定义 中岳 ÷ 四岳均值，describe 明写「远大于 1 即孤峰无辅」
 *   · threeCourts.*     三段占比，和为 1，故 1/3 ≈ 0.333 是天然参照
 *   · boneFlesh.index   describe 明写「0.5 附近为骨肉相称」
 *   · nose.alarFlare    鼻翼宽 ÷ 鼻长，规范脸实测 0.667
 * 全部标 CALIBRATE：定义清楚不等于判线校准过，真实人群到手后应重设。
 */

import type { ConfigurationSpec } from '@/core/configuration'

/**
 * ── 暂不收录（2026-08）─────────────────────────────────────
 * 下面两条写完之后被实测否掉了。留下记录，等真实样本到手再议 ——
 * **不要**为了让它们能出象而挪判线，那正是本文件开头禁止的事。
 *
 * · **五岳朝拱 / 孤峰无辅**
 *   我把 `wuYue.centrality` 的 describe「远大于 1 即孤峰无辅」读成判线取 2.2，
 *   实测真人脸 3.05、规范脸 2.95 —— **两张都命中**。原因是解剖上鼻尖本来就是
 *   全脸最前突的点，中岳约为四岳均值的三倍是常态，不是「孤峰」。
 *   `wuYue.support` 同理：实测 0.535 / 0.502，颧的前突天然远小于额与颏，
 *   于是「朝拱 ≥ 0.6」与「不齐 ≤ 0.35」两头都不命中。
 *   两条判线都建立在我对该度量自然取值的错误假设上，N=2 定不出正确的线。
 *
 * · **骨肉相称 / 骨胜于肉 / 肉胜于骨**
 *   当初 `boneFlesh.index` 实测 0.106 / 0.141，两张脸都落进「肉胜于骨」，
 *   而 evidence 显示 `cheekFullness` 读到 100.0% —— 分量已饱和。
 *   **上游那个 bug 已经修好**（cheekFullness 原本拿侧廓连线去量正面颊部，
 *   量到的是脸的前后厚度；现改为颊部自身的矢高，见 features/boneFlesh.ts）。
 *   修好后 index 为 0.222 / 0.394，两张脸分得开了。
 *
 *   即便如此**仍不急着放回来**：判线一旦按这两张脸去定，就又是拿 N=2 回头拟合。
 *   另外 `jawAngularity` 实测 0.213 / 0.281 也偏低（下颌角量到 145° / 140°，
 *   而 (160−x)/70 这个映射本身没校准过），index 因此被系统性拉低。
 *   等真实样本到手，两个分量一起定标之后再议。
 * ────────────────────────────────────────────────────────
 */

export const FACE_CONFIGURATIONS: readonly ConfigurationSpec[] = [
  /* ============ 格局 ============ */

  {
    id: 'config.face.threeCourts',
    name: '三庭',
    domain: '格局',
    source: '麻衣神相',
    basis: '三停各主早中晚一段，相书以「匀停」为贵；一停独盛而一停偏薄，则主该段有余而另一段不足',
    components: [
      'face3d.threeCourts.balance',
      'face3d.threeCourts.upper',
      'face3d.threeCourts.lower',
    ],
    branches: [
      {
        configuration: '上盛而下薄',
        tone: 'ji',
        when: [
          { featureId: 'face3d.threeCourts.upper', gte: 0.36, requirement: '上停明显超过三分之一' },
          { featureId: 'face3d.threeCourts.lower', lte: 0.3, requirement: '下停明显不足三分之一' },
        ],
        meaning: '上停有余而下停偏薄，主早年得力而晚境根基偏浅，宜早作积蓄而不宜后手',
      },
      {
        configuration: '下厚而上薄',
        tone: 'ji',
        when: [
          { featureId: 'face3d.threeCourts.lower', gte: 0.37, requirement: '下停明显超过三分之一' },
          { featureId: 'face3d.threeCourts.upper', lte: 0.29, requirement: '上停明显不足三分之一' },
        ],
        meaning: '下停厚而上停偏薄，主早年少荫庇、须自立门户，成事多在中晚，属晚成之象',
      },
      {
        configuration: '三停匀停',
        tone: 'gui',
        when: [
          {
            // 0.91 ⇔ 三段两两最大差 ≤ 3%，即二维 courtBalanceTol 收紧后的同一条线。
            // 判线取自既有决定而非另拍一个数：0.85 对应 5%，比二维那条松，
            // 两张实测脸都会命中（0.876 / 0.966），又成了一句人人都有的话。
            featureId: 'face3d.threeCourts.balance',
            gte: 0.91,
            requirement: '三段两两差距在 3% 以内，接近均分',
          },
        ],
        meaning: '三停匀停，主一生节奏平稳，早中晚各有所依，无大起落',
        caution: '惟匀停者亦少偏长之才，难有一处独出之势',
      },
    ],
  },

  /* ============ 财帛 ============ */
  {
    id: 'config.face.wealthBearing',
    name: '财帛承载',
    domain: '财帛',
    source: '麻衣神相',
    basis:
      '相书论财不看鼻之大小，而看准头、鼻翼、山根三处是否相配：准头主取，鼻翼为财库主守，山根为根柱。取而无库则聚不住，取而无根则易中断',
    components: [
      'face.palace.caibo',
      'face.nose.alar',
      'face.nose.root',
      'face3d.nose.alarFlare',
    ],
    branches: [
      {
        configuration: '财有所承',
        tone: 'gui',
        when: [
          {
            featureId: 'face.palace.caibo',
            bands: ['high', 'very_high'],
            requirement: '准头丰隆，取之有力',
          },
          {
            featureId: 'face.nose.alar',
            bands: ['balanced', 'high'],
            requirement: '鼻翼有肉而不过张，财库能收',
          },
          {
            featureId: 'face3d.nose.alarFlare',
            lte: 0.78,
            requirement: '鼻翼相对鼻长不过度张开',
          },
          {
            featureId: 'face.nose.root',
            bands: ['balanced', 'high', 'very_high'],
            requirement: '山根连续，根柱不断',
          },
        ],
        meaning:
          '准头有取、鼻翼能守、山根有根，三处相配，传统归入财有所承之象 —— 偏于积累与守成，不主横财',
        caution: '惟守成之象亦主取舍偏保守，遇当进之机易犹疑',
      },
      {
        configuration: '取之有能而守之不足',
        tone: 'ji',
        when: [
          {
            featureId: 'face.palace.caibo',
            bands: ['high', 'very_high'],
            requirement: '准头丰隆，取之有力',
          },
          {
            featureId: 'face3d.nose.alarFlare',
            gte: 0.86,
            requirement: '鼻翼相对鼻长过度张开，库门不收',
          },
        ],
        meaning:
          '准头虽丰而鼻翼过张，古法作财库不收论：进项之力不弱，而聚敛之力逊之 —— 财来财去，重在如何守而非如何取',
      },
      {
        configuration: '取而无根',
        tone: 'ji',
        when: [
          {
            featureId: 'face.palace.caibo',
            bands: ['high', 'very_high'],
            requirement: '准头丰隆，取之有力',
          },
          {
            featureId: 'face.nose.root',
            bands: ['low', 'very_low'],
            requirement: '山根低陷，根柱不接',
          },
        ],
        meaning:
          '准头有取而山根不接，主进项虽有而中途易断，古法列为中年之忌 —— 宜留余地，不宜一路加注',
      },
      {
        configuration: '取守俱薄',
        tone: 'ji',
        when: [
          {
            featureId: 'face.palace.caibo',
            bands: ['low', 'very_low'],
            requirement: '准头尖薄，取之无力',
          },
          {
            featureId: 'face.nose.alar',
            bands: ['low', 'very_low'],
            requirement: '鼻翼薄削，库亦不厚',
          },
        ],
        meaning: '准头与鼻翼俱薄，传统主财帛无根、聚散不定，重神而不重财 —— 所长多不在钱财一路',
      },
    ],
  },

  /* ============ 情感 ============ */
  {
    id: 'config.face.browEye',
    name: '眉眼',
    domain: '情感',
    source: '神相全编',
    basis:
      '眉与眼之间为田宅宫，相书以「眉眼相配、田宅有余」为和；眉长而田宅逼窄者为眉压眼，主心事不舒',
    components: ['face.brow.length', 'face.palace.tianzhai'],
    branches: [
      {
        configuration: '眉压眼',
        tone: 'ji',
        when: [
          {
            featureId: 'face.palace.tianzhai',
            bands: ['low', 'very_low'],
            requirement: '眉眼间距紧凑，田宅逼窄',
          },
          {
            featureId: 'face.brow.length',
            bands: ['high', 'very_high'],
            requirement: '眉长过目，压于眼上',
          },
        ],
        meaning:
          '眉长而眉眼间距逼窄，古法称眉压眼，主心事不舒、多思而不轻示人，与人相处易觉受制',
      },
      {
        configuration: '眉短而田宅亦窄',
        tone: 'ji',
        when: [
          {
            featureId: 'face.brow.length',
            bands: ['low', 'very_low'],
            requirement: '眉长不及目，眉尾收在眼尾之内',
          },
          {
            featureId: 'face.palace.tianzhai',
            bands: ['low', 'very_low'],
            requirement: '眉与眼之间的距离紧凑，田宅一带不舒展',
          },
        ],
        meaning: '眉短而田宅又窄，主助力寡少而居处不安，凡事多靠自己，且不易安于一处',
      },
      {
        configuration: '眉眼相配',
        tone: 'gui',
        when: [
          {
            featureId: 'face.brow.length',
            bands: ['balanced', 'high'],
            requirement: '眉长与眼长相称，不过目亦不短于目',
          },
          {
            featureId: 'face.palace.tianzhai',
            bands: ['balanced', 'high'],
            requirement: '眉眼间距舒展，田宅有余',
          },
        ],
        meaning: '眉眼相配而田宅有余，主心境开朗、与人相处有余地，兄弟朋友之间助力不缺',
        caution: '惟田宅过于舒阔者，亦主心宽而少警觉',
      },
    ],
  },

  /* ============ 执行 ============ */
  {
    id: 'config.face.mouthNasolabial',
    name: '口与法令',
    domain: '执行',
    source: '神相全编',
    basis: '法令主威令，口主气量与食禄；相书以「口阔而法令深长」为令行禁止，法令深而口小则令出而气不足',
    components: ['face.mouth.width', 'face.nasolabial'],
    branches: [
      {
        configuration: '令出而气不足',
        tone: 'ji',
        when: [
          {
            featureId: 'face.nasolabial',
            bands: ['high', 'very_high'],
            requirement: '法令深长，威令之形已具',
          },
          {
            featureId: 'face.mouth.width',
            bands: ['low', 'very_low'],
            requirement: '口形偏窄，气量不称',
          },
        ],
        meaning:
          '法令深而口不阔，主立威之形有而容纳之量不足 —— 令能出而人未必服，行事易失于严而少回旋',
      },
      {
        configuration: '威令未立',
        tone: 'ji',
        when: [
          {
            featureId: 'face.nasolabial',
            bands: ['low', 'very_low'],
            requirement: '法令纹浅淡，鼻翼至口角一线沟形不显',
          },
          {
            featureId: 'face.mouth.width',
            bands: ['low', 'very_low'],
            requirement: '口宽相对鼻翼偏窄，气量不称',
          },
        ],
        meaning: '法令浅而口亦不阔，主威令未立、根基尚浅，做事易被人越过，宜先立事而后立威',
      },
      {
        configuration: '口阔而法令深长',
        tone: 'gui',
        when: [
          {
            featureId: 'face.mouth.width',
            bands: ['balanced', 'high', 'very_high'],
            requirement: '口形端正或阔，气量能容',
          },
          {
            featureId: 'face.nasolabial',
            bands: ['high', 'very_high'],
            requirement: '法令深长，威令已立',
          },
        ],
        meaning: '口阔而法令深长，主威权已立而尚能容人，令行而不失亲和 —— 中晚年主事之相',
        caution: '惟法令过深而延过口角者，古称螣蛇入口，主威令虽行而晚景多阻',
      },
    ],
  },

  /* ============ 才智 ============ */
  {
    id: 'config.face.mingGongRoot',
    name: '印堂与山根',
    domain: '才智',
    source: '麻衣神相',
    basis: '印堂为命宫，山根接其下而主疾厄；相书以二者相连不断为运途少滞，印堂逼窄而山根又陷则为双忌相叠',
    components: ['face.palace.mingGong', 'face.nose.root'],
    branches: [
      {
        configuration: '印堂窄而山根陷',
        tone: 'ji',
        when: [
          {
            featureId: 'face.palace.mingGong',
            bands: ['low', 'very_low'],
            requirement: '两眉头之间逼窄，命宫不开',
          },
          {
            featureId: 'face.nose.root',
            bands: ['low', 'very_low'],
            requirement: '山根低陷，与印堂不相接',
          },
        ],
        meaning:
          '印堂逼窄而山根又陷，两忌相叠，主心量窄而根基不固、多思而意志易摇，遇事宜借外力而不宜独断',
      },
      {
        configuration: '心量宽而根基未固',
        tone: 'neutral',
        when: [
          {
            featureId: 'face.palace.mingGong',
            bands: ['balanced', 'high', 'very_high'],
            requirement: '两眉头之间开阔，命宫舒展',
          },
          {
            featureId: 'face.nose.root',
            bands: ['low', 'very_low'],
            requirement: '山根低陷，与印堂之间断而不接',
          },
        ],
        meaning:
          '印堂虽开而山根不接，主心量不窄、想得开，然根柱偏弱、持续之力逊于起念之力 —— 长处在开局，须防中途松手',
      },
      {
        configuration: '印堂开而山根连',
        tone: 'gui',
        when: [
          {
            featureId: 'face.palace.mingGong',
            bands: ['balanced', 'high', 'very_high'],
            requirement: '两眉头之间开阔，命宫舒展',
          },
          {
            featureId: 'face.nose.root',
            bands: ['balanced', 'high', 'very_high'],
            requirement: '山根连续，与印堂相接',
          },
        ],
        meaning: '印堂开阔而山根相连，主心量开阔、运途少滞，认准一路能走得下去',
        caution: '惟山根过隆者，古法亦主自我过强、不易受劝',
      },
    ],
  },

  /* ============ 根基 ============ */
] as const
