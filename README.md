# 文章分发台 · Publishing Platform

把一篇长博客（Markdown）一次分发给多个内容平台的小工具。纯前端、无服务端、无数据库，
可以直接扔在任意静态托管上。

**在线地址：<https://publish.hulatu.com>**

---

## 它解决什么

博客写好之后，同一篇内容要发到不同平台，每个平台的「正确形态」都不一样：

| 类型 | 平台 | 需要什么 |
| --- | --- | --- |
| 原生支持 Markdown | 少数派、知乎、豆瓣 | 规整的 Markdown + 图片上传清单 |
| 需要排版美化 | 微信公众号 | 全内联样式的 HTML（微信不认 `<style>` / `class`） |
| 需要浓缩改写 | 小红书、推特/X、即刻、微博 | 按平台语气重写的短文案 + 配图卡片 |

前两类是**确定性转换**（不调用大模型、秒出、可复现），第三类是**大模型改写**。

## 改写为什么是两段式

一开始是一步到位：把全文丢给模型，让它直接产出四个平台。结果很差——模型只盯开头几段，
后半篇内容整体丢失，所谓「要点」也没有结构锚点，读起来是一堆散句。

现在是两段：

```
① 全文 ──按 ## 切节──▶ 每节 1–2 句摘要 + 全篇一句话      （中间产物，可逐条手改）
② 摘要 ──按平台重写──▶ 小红书 / 推特 / 即刻 / 微博 成品文案
```

这样做的收益：

- **覆盖可验证**：要点数量 = 小节数量，漏掉一节会被校验打回，模型少给就本地补齐。
- **空壳句判不合格**：「本节介绍了……」「作者认为……」「综上所述」开头一律重写。
- **结构可校验**：小红书正文里没有 `· 小标题：一句话说明` 这种要点行就打回重来。
- **只重跑需要的**：摘要改完再生成；切换平台只跑第②段，不重复消耗 token。

## AI Key 怎么来

工具本身没有服务器，也没有中转。Key 存在**你自己的浏览器 localStorage**，请求从浏览器
直连服务商。支持任何 OpenAI 兼容接口：DeepSeek / Kimi / 智谱 / 硅基流动 / 通义 / OpenAI，
以及自定义地址（本地 Ollama、one-api 中转都行）。

设置 → 选服务商 → 填 Key → 点「测试连接」（用 `max_tokens: 8` 做最小验证）→ 保存。

不填 Key 也能用：走本地抽取，结构一样但措辞生硬，界面会明确标注「本地组装」，不假装是 AI。

> 换域名要留意跨域：服务商必须允许你的站点 Origin。DeepSeek 会回显请求方 Origin，
> 所以换到 `publish.hulatu.com` 依然能直连；换成白名单制的服务商则需要把域名加进去。

## 本地开发

```bash
npm install
npm run dev        # http://localhost:5183
```

```bash
npm run typecheck  # 只做类型检查
npm run check      # 解析/渲染 + 摘要两套回归（会扫 content 目录里的真实文章）
npm run build      # 类型检查 + 生产构建到 dist/
npm run preview    # 预览构建产物
```

## 公众号排版主题

12 套主题，四组。差别不只是换色——标题形态、是否衬线、首行缩进、引用块、代码块明暗、
表格线条都是独立开关，所以同一篇文章在不同主题下是**结构**不同，不是换了件衣服。

| 组 | 主题 | 特征 |
| --- | --- | --- |
| 极简 | 纸白 / 素页 / 墨线 | 左竖线 / 零装饰 / 下划线标题 |
| 书卷 | 宋刻 / 米黄 / 铅字 | 衬线 + 首行缩进 + 居中标题 / 暖棕旧纸 / 报纸式粗横线 |
| 色块 | 靛蓝 / 序号 / 薄荷 | 标题带底色块 / 01·02 编号 / 浅绿圆角 |
| 商务 | 藏青 / 石墨 / 莫兰迪 | 深色代码块 / 无装饰标题 + 深色代码 / 低饱和豆沙色 |

选择器里的缩略图是用**真实渲染管线**跑出来的，不是示意图——卡片上看到什么，
复制到公众号就是什么。

点顶栏的「更换」打开的是**主题墙**（弹层 + 全宽网格），不是原来那条横向滚动的窄条：
列数由可用宽度决定（宽屏 6 列，12 款两行放得下，不用滚），缩略图宽度跟着列宽走
（ResizeObserver 算缩放比），不会出现「右边一片空、要横向拖」的情况。
点一下即时应用，Esc / 点遮罩 / 「完成」关闭。

加一套主题只需要在 `src/themes/wechat.ts` 里追加一个 `ThemeSpec`：

```ts
const myTheme = makeTheme({
  id: 'my', name: '我的', group: '极简', hint: '一句话说明',
  heading: 'underline',   // bar | plain | underline | center | block | index
  quote: 'box',           // bar | box | plain
  code: 'dark',           // light | dark
  table: 'minimal',       // bordered | minimal
  serif: false, indent: false,
  palette: { /* 11 个色值 */ },
})
```

`npm run check:themes` 会把 109 篇文章 × 全部主题真渲染一遍，检查输出里没有
`class` / `id` / `<pre>`、`style` 属性没被引号截断、字符数比基准主题涨幅不超过 20%、
编号主题真的注入了 01/02。

> 两个踩过的坑：微信会把 `::before` 伪元素整条剥掉，所以 H2 编号只能在渲染时注入真实
> `<span>`；`style="..."` 里的 `font-family` 如果带双引号，属性会被提前闭合，后面所有
> 声明全部失效——表现为「只有第一条样式生效」，非常难查。字体名一律用单引号。

## 配图卡片

一套图 = **封面 + 每个 `##` 小节一张 + 结尾**。按小节出图而不是只出四张，
是因为图集要「一图一件事」：一张图塞四个要点，读者在手机上扫过去什么都记不住；
一节一张，图集本身就是一份能滑完的提纲。

| 版式 | 内容 | 正文来源 |
| --- | --- | --- |
| 封面 | 标题 + 摘要 | 元信息 |
| 小节 | 小节标题 + 本节摘要 | AI 章节摘要（已校对）→ 本地「本节前两句」兜底 |
| 结尾 | 总结 + 标签 | 元信息 |

- 每张卡右上角有 `03 / 08` 页码，整套连起来读时知道进度。
- 四张版式共用同一个 `Shell` 骨架（同边距、同页脚基线、同分隔线），
  装饰元素全部锚在正文区之外，结构上不可能压到文字。
- 导出 1080×1440 PNG（540×720 @2x），可单张下载，也可整包 zip。
- 「+ 加一张卡」可以补金句 / 要点 / 小节 / 封面 / 结尾；改过的卡不会被新摘要覆盖。

`npm run check:cards` 会用全部真实文章跑一遍出图逻辑，检查卡片数、页码连续性、
摘要非空且不超过画布容量（118 字）、标题不残留 Hugo 锚点。

## 部署

托管在 **Cloudflare Pages**，域名 `publish.hulatu.com`（和主站 `hulatu.com` 同一个
Cloudflare 账号，证书和 DNS 都在那里统一管）。

Cloudflare 从 GitHub 仓库 `hulatu/Publishing_Platform` 拉代码构建：

| 配置项 | 值 |
| --- | --- |
| 生产分支 | `main` |
| 构建命令 | `npm run build` |
| 输出目录 | `dist` |
| 环境变量 | `NODE_VERSION=22` |

构建用相对路径（`base: './'`），产物既能挂根域名也能挂子路径，换托管不用改配置。
`public/_headers` 给带哈希的 `/assets/*` 上了永久缓存，入口 HTML 不缓存。

GitHub 上的 `.github/workflows/ci.yml` **只做校验不做发布**：push 时跑类型检查、
解析/渲染/摘要回归、构建，坏了在 GitHub 上直接看红叉，不用等 Cloudflare 构建失败才发现。

### 域名

Cloudflare Pages 项目 → **Custom domains** → 添加 `publish.hulatu.com`。

因为域名和 Pages 项目在同一个账号下，Cloudflare 会**自动**在 `hulatu.com` 区域里
建好 CNAME（指向 `hulatu-publish.pages.dev`），不需要手动去 DNS 页面加记录。
手动加也行，代理状态开橙云即可——Pages 的证书由 Cloudflare 自己签，不存在
GitHub Pages 那种「开代理就签不出证书」的问题。

### 手动发布（可选）

不想连 Git、想直接推构建产物：

```bash
npm run build
npx wrangler pages deploy dist --project-name hulatu-publish
```


## 图标

`public/` 下是一整套按平台拆开的图标，母版只有三个 SVG（都在 `scripts/icon/`）：

| 文件 | 用在哪 |
| --- | --- |
| `icon.svg` | 现代浏览器标签页（矢量，任意缩放） |
| `favicon.ico` | 老浏览器、Windows 快捷方式（内含 16/32/48 三档） |
| `favicon-16x16.png` / `32` | 标签页小图标（用的是**简化版**，没有正文行） |
| `favicon-48x48.png` | 书签栏、桌面快捷方式（完整版） |
| `apple-touch-icon.png` | iOS 添加到主屏（满幅方图，iOS 自己裁圆角） |
| `android-chrome-192/512.png` | Android 主屏、PWA 安装 |
| `maskable-512x512.png` | Android 自适应图标（内容缩进 80% 安全区，不会被裁边） |
| `mstile-150x150.png` | Windows 开始菜单磁贴 |
| `safari-pinned-tab.svg` | Safari 固定标签页（单色蒙版） |

改图标只需要改 SVG 再重新生成：

```bash
npm run icons
```

脚本用 Chromium 渲染 SVG（ImageMagick 自带的 MSVG 会丢圆角、圆头描边和透明度，
出来是坏的），再用 ImageMagick 缩放拼装。默认找 Helium，换浏览器：
`BROWSER=/path/to/chrome npm run icons`。

小尺寸单独一套是刻意的：16px 下正文行会糊成一团，所以 16/32 用只含纸张轮廓的简化版。

## 目录结构

```
src/
  core/        解析与渲染内核（不依赖 React）
    ir.ts        中间表示：Inline / Block，保留加粗、行内代码、链接、脚注
    parse.ts     markdown-it 解析 + HTML 消毒 + 预处理
    frontmatter.ts  YAML 子集解析（手写，容忍手写格式，永不整篇失败）
    sections.ts  按 ## 切节、合并过短节、预算分配
    html-inline.ts 内联样式 HTML 引擎（公众号/网页两种目标）
    cjk.ts       中日韩字宽、加权长度、句子切分、营销词黑名单
    markdown-out.ts  Markdown 输出与 front matter 重建
  renderers/   各平台的确定性转换
  ai/          大模型层
    prompts.ts   两段式提示词 + 各平台写法对照
    schemas.ts   JSON 提取、校验、修复
    pipeline.ts  摘要 / 平台两条流水线，带重试与降级
    fallback.ts  无 Key 时的本地抽取
    provider.ts  服务商适配（BYOK / 云服务）
  cards/       小红书配图卡片（DOM → PNG）
  components/  界面
scripts/       回归检查、图标生成（icon/ 里放 SVG 母版）
```

## 已知取舍

- 四个平台一起生成是串行调用，慢；日常建议按需单平台生成。
- 摘要最多切 12 节，超长文章会把相邻小节省并，合并过的节会标注「含合并小节」。
- 公众号正文上限 20000 字符，超了会截断并提示。
- 卡片导出用 `html-to-image`，不能引用外链图片（会触发 CORS）。
