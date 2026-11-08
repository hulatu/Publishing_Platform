/**
 * AI Prompt —— 两段式流水线
 *
 * 第一段 buildDigestPrompt：整篇文章 → 每一节 1–2 句摘要 + 全篇一句话
 * 第二段 buildPlatformPrompt：只拿摘要去组装各平台文案
 *
 * 为什么拆成两段（这是改写质量的核心）：
 * - 一次性「读全文写四个平台」时，模型只会盯着开头几段，后半篇内容直接丢，
 *   而且写出来的「要点」没有结构锚点，是自由发挥。
 * - 拆开后每一节都必须被压成一句，覆盖是强制的；平台文案从摘要组装，
 *   要点数量 = 小节数量，天然对齐原文结构。
 * - 中间产物（摘要）可以给用户逐条看、逐条改 —— 这是「可核对」的关键。
 *
 * Prompt 与 schemas.ts 必须成对使用：模型会漂，光靠 prompt 不可靠。
 */

import type { Doc } from '../core/ir'
import type { ArticleSection } from '../core/sections'
import { allocateSectionBudget, sectionTextForPrompt } from '../core/sections'
import { toneHints, type DigestSet, type RewriteId, type RewriteTone } from './types'

export interface PromptBuildResult {
  system: string
  user: string
  /** 原文是否被压缩过（超长时按节截断） */
  compressed: boolean
}

/* ------------------------------------------------------------------ */
/* 共用人格与纪律                                                       */
/* ------------------------------------------------------------------ */

export const PERSONA = `你是一位中文技术博客作者本人的内容编辑。作者的行文风格是：第一人称、理性克制、有判断但不喧哗，习惯用「」作引号、用加粗标记关键词、段落偏长、不写标题党。

硬性纪律，任何情况下都不能破：
1. 事实纪律：只使用原文出现过的事实、数字、书名、人名、产品名、链接。绝对不得新增原文没有的事实、数字、版本号、时间或链接。无法确认的一律省略，不猜、不补充背景知识。
2. 标点纪律：保留全角标点，保留「」作为引号，不要改成英文引号或直角引号。
3. 语气纪律：保持第一人称、克制、有信息量。禁止营销腔与网络烂梗，包括但不限于：姐妹们、家人们、宝子、绝了、yyds、爆肝、码住、干货满满、必看、谁懂啊、狠狠、冲鸭、我不允许、哭死、上头、安排上、一键三连。
4. 输出纪律：只输出一个 JSON 对象，不要 markdown 代码围栏，不要任何解释性文字、前言或后记。JSON 必须能被 JSON.parse 直接解析。`

/* ------------------------------------------------------------------ */
/* 第一段：章节摘要                                                     */
/* ------------------------------------------------------------------ */

export const DIGEST_RULES = `你要做的是「逐节摘要」，不是改写、不是点评。

对每一节：
- summary 写 1–2 句话，40–90 字（硬性区间 18–130 字）。第一句讲这一节在说什么，第二句讲它凭什么成立（方法、数字、例子或结论）。
- 必须落到具体内容上。一条合格的 summary 至少包含下列两类信息：核心观点 / 具体做法 / 数字或版本号 / 结论或判断 / 具体例子。
- 禁止空壳开头，出现即算不合格：「本节」「这一节」「该节」「此节」「这部分」「本部分」「作者认为」「作者指出」「文章认为」「文章指出」「主要介绍了」「讲述了」「讨论了」「阐述了」「提到了」。
- 禁止空泛收尾：「总而言之」「综上所述」「由此可见」「总的来说」「不难看出」。
- 不要整句照抄原文。要压缩重述，但专有名词、数字、关键短语要原样保留。
- 如果这一节本身是清单或步骤，summary 要用「先…再…最后…」这类顺序词把结构交代清楚。
- heading 必须原样返回原文标题，一个字都不要改。

另外给一个 oneLiner：全篇一句话，不超过 60 字，说清这篇文章做了什么、得到什么结论。它会直接当微博正文和各平台开场句用，所以要具体、可独立阅读。`

export const DIGEST_JSON_SHAPE = `输出 JSON（字段名必须完全一致）：
{
  "oneLiner": "全篇一句话，≤60 字",
  "sections": [
    { "index": 1, "heading": "原样返回该节标题", "summary": "1–2 句摘要" }
  ]
}`

/** 把分节内容排成给模型看的清单 */
export function formatSectionsForPrompt(sections: ArticleSection[], perSectionLimit: number[]): string {
  return sections
    .map((s, i) => {
      const text = sectionTextForPrompt(s, perSectionLimit[i] ?? 1400)
      return `### [${s.index}] ${s.heading}（${s.chars} 字）\n${text}`
    })
    .join('\n\n')
}

export function buildDigestPrompt(doc: Doc, sections: ArticleSection[], tone: RewriteTone = 'original'): PromptBuildResult {
  const budget = allocateSectionBudget(sections)
  const total = sections.reduce((n, s) => n + s.chars, 0)
  const compressed = sections.some((s, i) => (budget[i] ?? 0) < s.chars)

  const metaLines = [
    `标题：${doc.meta.title}`,
    doc.meta.categories.length ? `分类：${doc.meta.categories.join('、')}` : '',
    doc.meta.tags.length ? `标签：${doc.meta.tags.join('、')}` : '',
    doc.meta.summary ? `作者自写摘要：${doc.meta.summary}` : '',
    `小节数：${sections.length}（全文 ${total} 字）`,
  ]
    .filter(Boolean)
    .join('\n')

  const user = `${DIGEST_RULES}

${DIGEST_JSON_SHAPE}

改写强度参考：${toneHints[tone]}

下面这篇文章已经按 ## 切好，请对每一节各写一条 summary。注意：sections 数组必须正好 ${sections.length} 项，index 与下面方括号里的数字一一对应，顺序不能变，不能漏节，不能合并。

---
${metaLines}

${formatSectionsForPrompt(sections, budget)}
---`

  return { system: PERSONA, user, compressed }
}

/* ------------------------------------------------------------------ */
/* 第二段：平台组装                                                     */
/* ------------------------------------------------------------------ */

const XHS_SPEC = `【xiaohongshu 小红书】
输出 {"title": "...", "body": "...", "tags": ["..."]}

body 必须严格三段式，段与段之间空一行：
① 开场钩子，1–2 句。直接说这篇内容解决什么问题、给出什么判断。用第一人称。
② 主体，3–5 条。每条以「· 」开头，格式固定为「小标题：一句话说明」。
   小标题取该节 heading 的核心词，4–8 字，不加书名号引号。
   说明把该节 summary 压到 30–45 字，要带具体细节。
③ 收尾，1 句。一个能引发讨论的具体问题，或一句克制的判断。不要「点赞收藏关注」。

写法对照（左边不合格，右边合格）：
✗ 今天给大家分享一个超好用的方法，姐妹们一定要码住！
✓ 我把 110 篇博客压成 8 个平台的文案，靠的是一条固定流水线。

✗ · 关于效率：效率很重要，我们要提升效率。
✓ · 摘要先行：先按 ## 切节，每节压成 1–2 句，再拿这些句子拼平台文案。

✗ 以上就是全部内容啦，希望对大家有帮助～
✓ 你写长文的时候，是每次都重写一遍，还是也拆成中间层？

title：不超过 20 个汉字，陈述句，说清「做了什么 / 得到什么」。不含 emoji，不含 #，不以 ！ 结尾。
tags：3–6 个，只写词本身，不带 # 号，不带空格。优先用原文 front matter 里的标签。`

const TWITTER_SPEC = `【twitter 推特 / X】
输出 {"thread": ["第一条", "第二条", ...]}

3–8 条。平台按加权字符算，中文每字算 2，所以每条控制在 135 个汉字以内。
不要自己写「1/7」这类编号，程序会加。

第 1 条：全文最硬的结论，必须能独立读懂，不出现「线程」「往下看」「聊聊」这类元话语。
第 2 条起：一条对应一个小节，格式「小标题 + 一个具体细节」，优先把数字、版本号、对比带上。
最后一条：一句收束，加一个具体问题。不要「求转发」「欢迎关注」。

写法对照：
✗ 我写了一篇新文章，讲内容分发，大家来看看。
✓ 110 篇博客，8 个平台。真正花时间的不是写，是每个平台的格式约束。

✗ 第二点也很重要，这里就不展开了。
✓ 公众号正文上限 20000 字，且不能有 <pre>：手机端没有横向滚动，代码块会被直接截断。`

const JIKE_SPEC = `【jike 即刻】
输出 {"body": "..."}

不超过 500 字。没有标题。3–6 段，每段 1–3 句，段间空一行。
语感像在即刻发一条动态：第一句是当下的判断或吐槽，中间 2–3 段讲具体怎么做的，最后一句自嘲或留个疑问。
不要话题标签，emoji 最多 2 个，不要感叹号堆叠。

写法对照：
✗ 分享一个效率工具！真的很强！强烈推荐大家试试！
✓ 做了个东西，把自己博客一键分发给 8 个平台。本来以为最麻烦的是排版，结果最麻烦的是「每个平台的限制都不一样」。`

const WEIBO_SPEC = `【weibo 微博】
输出 {"text": "...", "topics": ["..."]}

text 不超过 140 字，必须是完整可读的一段话，不要断在半个句子上。
结构：一句结论 + 一个最具体的细节（数字或对比）+ 一句态度。
不要「转发抽奖」「求扩散」，不要堆 emoji。

topics：1–3 个话题名，只写名字，不带 # 号。

写法对照：
✗ 新文章出炉啦，快来看看吧～ #内容分发# #效率工具#
✓ 110 篇博客要发 8 个平台，每次手动改格式要两小时。现在按 ## 切节压成一句话，再拼平台文案，十分钟搞定。 #内容分发#`

export const PLATFORM_SPECS: Record<RewriteId, string> = {
  xiaohongshu: XHS_SPEC,
  twitter: TWITTER_SPEC,
  jike: JIKE_SPEC,
  weibo: WEIBO_SPEC,
}

/** 从 JSON 里读出来的键名（给 normalizePlatform 用） */
export const PLATFORM_JSON_KEY: Record<RewriteId, string> = {
  xiaohongshu: 'xhs',
  twitter: 'twitter',
  jike: 'jike',
  weibo: 'weibo',
}

const PLATFORM_JSON_SHAPE: Record<RewriteId, string> = {
  xiaohongshu: '{\n  "xhs": { "title": "字符串", "body": "字符串", "tags": ["字符串"] }\n}',
  twitter: '{\n  "twitter": { "thread": ["字符串"] }\n}',
  jike: '{\n  "jike": { "body": "字符串" }\n}',
  weibo: '{\n  "weibo": { "text": "字符串", "topics": ["字符串"] }\n}',
}

/** 把摘要排成「小标题：说明」的清单，这是平台组装的原料 */
export function formatDigestForPrompt(digest: DigestSet): string {
  const lines = digest.sections.map((s) => `${s.index}. ${s.heading}：${s.summary}`)
  return `全篇一句话：${digest.oneLiner}\n\n逐节要点（共 ${digest.sections.length} 条）：\n${lines.join('\n')}`
}

export function buildPlatformPrompt(
  platform: RewriteId,
  doc: Doc,
  digest: DigestSet,
  tone: RewriteTone,
): PromptBuildResult {
  const metaLines = [
    `原文标题：${doc.meta.title}`,
    doc.meta.categories.length ? `分类：${doc.meta.categories.join('、')}` : '',
    doc.meta.tags.length ? `标签：${doc.meta.tags.join('、')}` : '',
  ]
    .filter(Boolean)
    .join('\n')

  const user = `${PLATFORM_SPECS[platform]}

${PLATFORM_JSON_SHAPE[platform]}

改写强度：${toneHints[tone]}

原料是这篇文章的逐节摘要，不是全文。请只基于这些要点写，不要引入摘要之外的信息。
要点有几条，小红书主体和推特中段就应该有几条对应的内容——不要只挑前两三条写。

---
${metaLines}

${formatDigestForPrompt(digest)}
---`

  return { system: PERSONA, user, compressed: false }
}

/* ------------------------------------------------------------------ */
/* 重试                                                                 */
/* ------------------------------------------------------------------ */

/** 校验失败后带错误原文重试的 prompt */
export function buildRetryPrompt(baseUser: string, previous: string, errors: string[]): string {
  return `${baseUser}

---
你上一次的输出有以下问题，请逐条修正后重新输出完整 JSON：
${errors.map((e, i) => `${i + 1}. ${e}`).join('\n')}

上一次的输出是：
${previous.slice(0, 2600)}`
}
