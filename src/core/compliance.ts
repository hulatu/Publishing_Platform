/**
 * 发布前合规检查
 *
 * 只做「本地词表 + 正则」这一层：不联网、不上传正文，命中后给出原句和改法。
 * 这一层能拦住的是「明显会踩雷」的表述 —— 极限词、承诺性用语、医疗功效、
 * 站外导流、联系方式、标题党。真正的平台审核尺度随时在变，这里只是提前预警。
 *
 * 规则按平台分开：小红书禁站外导流最严，公众号对极限词和标题党更敏感。
 */

export type ComplianceScope = 'wechat' | 'xhs' | 'other'
export type Severity = 'high' | 'medium'

export interface ComplianceRule {
  id: string
  /** 违规类型，展示用 */
  label: string
  severity: Severity
  /** 适用平台；'other' 表示所有平台都查 */
  scopes: ComplianceScope[]
  pattern: RegExp
  hint: string
}

export interface ComplianceHit {
  ruleId: string
  label: string
  severity: Severity
  /** 命中的原文片段 */
  match: string
  /** 命中位置所在的句子（超长会截断） */
  context: string
  /** 在全文里的下标，用于排序 */
  index: number
  hint: string
}

const RULES: ComplianceRule[] = [
  {
    id: 'extreme',
    label: '极限词',
    severity: 'medium',
    scopes: ['other'],
    // 只收「几乎不可能是正常表达」的短语。
    // 「最好 / 最强 / 唯一 / 绝对」这类看着像极限词，但「最好的朋友」「唯一的问题是」
    // 都是正常中文，全收进来会 60% 的文章都报警，用户第二次就不看了。
    pattern:
      /(最低价|最高级|全网最|史上最|第一品牌|全国第一|行业第一|独家首发|顶级配置|国家级|世界级|百分百有效|100%有效|包治百病|永久有效|终身免费|一劳永逸)/g,
    hint: '广告法对极限词很敏感，换成「在我用过的里面算…」这类可证伪的说法',
  },
  {
    id: 'guarantee',
    label: '承诺性用语',
    severity: 'high',
    scopes: ['other'],
    pattern: /(保证有效|保证成功|保证赚钱|包治|无效退款|稳赚|必赚|零风险|绝对有效|立竿见影)/g,
    hint: '承诺比夸大更危险：删掉承诺，只留你亲历的事实',
  },
  {
    id: 'income',
    label: '收益承诺',
    severity: 'high',
    scopes: ['other'],
    pattern: /(稳赚不赔|日入过万|月入十万|躺赚|零成本创业|包回本)/g,
    hint: '涉及收益的绝对化描述，平台和监管都盯得紧，改成区间或直接删',
  },
  {
    id: 'medical',
    label: '医疗功效',
    severity: 'medium',
    scopes: ['other'],
    pattern: /(治愈|根治|疗效|抗癌|降血压|降血糖|排毒|祛痘|生发|壮阳|药到病除|包治百病)/g,
    hint: '作为产品功效宣称需要资质；转述就医经历一般没问题',
  },
  {
    id: 'traffic-xhs',
    label: '站外导流',
    severity: 'high',
    scopes: ['xhs'],
    pattern: /(微信|VX|vx|V信|威信|公众号|加我|私信我|二维码|扫码|淘宝|天猫|京东|拼多多|代购|主页链接|链接在评论)/g,
    hint: '小红书对导流最严，容易限流；改成「主页」或不提',
  },
  {
    id: 'traffic-wechat',
    label: '导流倾向',
    severity: 'medium',
    scopes: ['wechat'],
    pattern: /(加我微信|私信我|扫码|二维码|淘宝|天猫|拼多多|代购)/g,
    hint: '公众号正文里的导流表述，未认证号尤其容易被处理',
  },
  {
    id: 'contact',
    label: '联系方式',
    severity: 'high',
    scopes: ['other'],
    pattern: /(\b1[3-9]\d{9}\b|[Qq]{2}\s*[:：]?\s*\d{5,}|[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,})/g,
    hint: '正文里直接留手机号 / 邮箱容易被判营销，放在个人简介里更安全',
  },
  {
    id: 'clickbait',
    label: '标题党',
    severity: 'medium',
    scopes: ['wechat'],
    pattern: /(震惊|吓尿|速看|删前速看|不转不是|惊呆|万万没想到)/g,
    hint: '这类词会拉低账号质量分，换成具体的结果描述',
  },
]

/** 单条规则最多报几处，避免一个「最」字刷屏 */
const MAX_PER_RULE = 3
/** 总共最多报几处 */
const MAX_TOTAL = 30
/** 上下文句子的展示上限 */
const CONTEXT_MAX = 62

const BREAK = '。！？；\n'

function contextAt(text: string, index: number, len: number): string {
  let s = index
  let e = index + len
  while (s > 0 && !BREAK.includes(text[s - 1])) s--
  while (e < text.length && !BREAK.includes(text[e])) e++

  const sentence = text.slice(s, e).trim()
  if (sentence.length <= CONTEXT_MAX) return sentence

  // 句子太长时以命中词为中心截一段
  const rel = index - s
  const from = Math.max(0, Math.min(rel - 24, sentence.length - CONTEXT_MAX))
  const head = from > 0 ? '…' : ''
  const tail = from + CONTEXT_MAX < sentence.length ? '…' : ''
  return head + sentence.slice(from, from + CONTEXT_MAX) + tail
}

/** 检查一段文本；scope 决定用哪套规则 */
export function checkText(text: string, scope: ComplianceScope): ComplianceHit[] {
  if (!text) return []

  const hits: ComplianceHit[] = []

  for (const rule of RULES) {
    if (!rule.scopes.includes('other') && !rule.scopes.includes(scope)) continue

    // 每次都新建正则，避免 lastIndex 残留
    const re = new RegExp(rule.pattern.source, rule.pattern.flags)
    let m: RegExpExecArray | null
    let count = 0

    while ((m = re.exec(text)) !== null) {
      if (count >= MAX_PER_RULE) break
      count++
      hits.push({
        ruleId: rule.id,
        label: rule.label,
        severity: rule.severity,
        match: m[0],
        context: contextAt(text, m.index, m[0].length),
        index: m.index,
        hint: rule.hint,
      })
      if (m.index === re.lastIndex) re.lastIndex++
    }
  }

  return hits.sort((a, b) => {
    if (a.severity !== b.severity) return a.severity === 'high' ? -1 : 1
    return a.index - b.index
  }).slice(0, MAX_TOTAL)
}

/** HTML 转纯文本，用于检查公众号 / 豆瓣的产物 */
export function stripHtml(html: string): string {
  return html
    .replace(/<(script|style)[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|section|div|li|h[1-6]|blockquote|tr)>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/[ \t]+/g, ' ')
}

/** 平台 id → 规则集 */
export function scopeOf(platformId: string): ComplianceScope {
  if (platformId === 'wechat') return 'wechat'
  if (platformId === 'xiaohongshu') return 'xhs'
  return 'other'
}
