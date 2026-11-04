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

## 部署

推到 `main` 即自动发布：`.github/workflows/deploy.yml` 会安装依赖 → 跑 `npm run check`
→ 构建 → 上传到 GitHub Pages。

构建用相对路径（`base: './'`），所以同一份产物既能挂在根域名，也能挂在
`hulatu.github.io/Publishing_Platform/` 子路径下，不用改配置。

### 域名

- 仓库里的 `public/CNAME` 写着 `publish.hulatu.com`，会被一起构建进 `dist/`。
- GitHub 仓库 **Settings → Pages → Custom domain** 也填同一个域名。
- DNS（Cloudflare 托管）加一条记录：

  | 类型 | 名称 | 目标 | 代理状态 |
  | --- | --- | --- | --- |
  | CNAME | `publish` | `hulatu.github.io` | **DNS only（灰云）** |

  必须关掉 Cloudflare 代理。开橙云时 GitHub 无法完成证书签发，会一直卡在
  「certificate not yet provisioned」或直接证书错误。

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
scripts/       回归检查
```

## 已知取舍

- 四个平台一起生成是串行调用，慢；日常建议按需单平台生成。
- 摘要最多切 12 节，超长文章会把相邻小节省并，合并过的节会标注「含合并小节」。
- 公众号正文上限 20000 字符，超了会截断并提示。
- 卡片导出用 `html-to-image`，不能引用外链图片（会触发 CORS）。
