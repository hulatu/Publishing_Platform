# 直发公众号草稿箱：中转服务契约

把文章直接建成公众号草稿，省掉「复制富文本 → 粘进编辑器 → 补封面」这一步。

但这个功能**默认不可用**，必须先自己部署一个中转服务。原因不是懒，是四条硬约束：

| 约束 | 后果 |
| --- | --- |
| `AppSecret` 不能进前端 | 打包后的 JS 谁都能读，泄露等于把公众号交出去 |
| `access_token` 要缓存、统一刷新 | 2 小时过期，每天刷新次数有限；多端各自刷新会互相顶掉，表现为随机 `40001` |
| IP 白名单 | 微信要求调用方 IP 在后台白名单里，浏览器没有固定出口 IP |
| CORS | `api.weixin.qq.com` 不返回跨域头，浏览器读不到响应 |

所以前端的「直发草稿箱」按钮实际做三件事：保存中转服务地址与口令、发请求前查一遍微信的硬限制、把 `errcode` 翻成人话。真正调微信的是中转服务。

---

## 一、部署中转服务

仓库里有一份零依赖的参考实现：`relay/wechat-relay.mjs`（Node 18+，单文件）。

### 1. 准备

- 一个**有固定出口 IP** 的机器（一台小 VPS 就够）。Cloudflare Worker 的出口 IP 不固定，通常过不了白名单，别拿它当默认方案。
- 公众号后台 → 设置与开发 → 基本配置，拿到 `AppID` / `AppSecret`。
- 同一页面的 **IP 白名单**里加上这台机器的出口 IP。`curl ifconfig.me` 看到的就是它。
- 确认公众号有「草稿箱」接口权限（`48001` 就是没有，通常需要认证）。

### 2. 起服务

```bash
WECHAT_APPID=wx1234567890abcdef \
WECHAT_SECRET=你的AppSecret \
RELAY_TOKEN=$(openssl rand -hex 24) \
node relay/wechat-relay.mjs
```

可选环境变量：

| 变量 | 作用 |
| --- | --- |
| `DEFAULT_COVER_MEDIA_ID` | 已有永久封面素材的 `media_id`，所有草稿共用它 |
| `DEFAULT_COVER_URL` | 一张封面图地址，每次现传成永久缩略图素材 |
| `PORT` | 默认 8787 |

微信新建草稿**强制要求 `thumb_media_id`**，所以 `DEFAULT_COVER_MEDIA_ID` 和 `DEFAULT_COVER_URL` 至少要有一个，否则前端必须为每篇填封面地址。推荐配 `DEFAULT_COVER_MEDIA_ID`：封面图几乎不变，配一次就不用再管。

### 3. 挂 TLS

微信不要求回调走 HTTPS，但前端是 HTTPS 页面，**混合内容会被浏览器拦掉**。用 Caddy / Nginx 反代一层，或者套 Cloudflare 代理（只做前置，不改变出口 IP 的话白名单仍然要按源站 IP 配）。

```caddyfile
relay.example.com {
  reverse_proxy 127.0.0.1:8787
}
```

### 4. 填进前端

公众号页签底部点「直发草稿箱」，把 `https://relay.example.com` 和 `RELAY_TOKEN` 填进去，点「测试连接」。看到「连接正常 · AppID wx12****cdef · 已配默认封面」就通了。

---

## 二、接口契约

中转服务只需要实现两个端点。**任何语言、任何框架都行**，只要满足下面的形状。

### `GET /health`

用于前端「测试连接」。

```http
Authorization: Bearer <RELAY_TOKEN>
```

```json
{ "ok": true, "appIdMasked": "wx12****cdef", "hasDefaultCover": true }
```

失败时返回 `401` 或 `{ "ok": false, "code": "...", "message": "..." }`。

### `POST /wechat/draft`

```http
Authorization: Bearer <RELAY_TOKEN>
Content-Type: application/json
```

```json
{
  "title": "文章标题",
  "author": "作者（≤8 字，可省）",
  "digest": "摘要（≤120 字，可省，微信会截正文前 54 字）",
  "content": "<section style=\"...\">全内联样式 HTML</section>",
  "contentSourceUrl": "https://hulatu.com/...（「阅读原文」链接，可省）",
  "coverUrl": "https://.../cover.jpg（可省，服务端可配默认封面）"
}
```

成功：

```json
{
  "ok": true,
  "mediaId": "草稿的 media_id",
  "url": "https://mp.weixin.qq.com/cgi-bin/appmsg?..."
}
```

失败：

```json
{
  "ok": false,
  "code": "UPSTREAM_ERROR",
  "message": "invalid ip 1.2.3.4, not in whitelist",
  "upstream": { "errcode": 40164, "errmsg": "invalid ip 1.2.3.4, not in whitelist" }
}
```

`upstream.errcode` 建议原样透传 —— 前端有一张 errcode 表，即使中转服务自己不做什么错误映射，用户也能看到「调用方 IP 不在白名单，去公众平台加一下」这种可执行的建议。

也可以偷懒直接转发微信的响应体（`{ "errcode": 0, "media_id": "..." }`），前端两种都认。

### 微信侧真正调的两个接口

| 用途 | 接口 | 说明 |
| --- | --- | --- |
| 换 token | `GET /cgi-bin/token?grant_type=client_credential` | 缓存到过期前 5 分钟 |
| 传封面 | `POST /cgi-bin/material/add_material?type=thumb` | **必须用 `add_material`**，`media/upload` 传的是临时素材，草稿不认 |
| 建草稿 | `POST /cgi-bin/draft/add` | body `{ articles: [...] }` |

---

## 三、错误对照表

前端的翻译逻辑在 `src/cloud/wechat-relay.ts` 的 `ERRCODES`，改这张表就改了用户看到的话。

| errcode | 含义 | 用户该做什么 |
| --- | --- | --- |
| `40001` | access_token 失效 | 重试；持续失败说明 AppSecret 不对 |
| `40013` | AppID 无效 | 别把「原始 ID」（`gh_` 开头）当 AppID |
| `40125` | AppSecret 无效 | 重置 AppSecret 并更新环境变量 |
| `40164` | IP 不在白名单 | 把中转机出口 IP 加进白名单 |
| `45009` | 调用超限 | 当天配额用完；也说明可能在死循环重试 |
| `45110` | 内容超长 | 正文 20000 字符 / 1MB 上限，用「按 H2 拆篇导出」 |
| `40007` | 封面素材无效 | 重新传封面 |
| `53503` / `53504` | 草稿箱满（20 篇） | 去后台删旧草稿 |
| `48001` | 接口未授权 | 公众号没有草稿箱权限，通常需要认证 |

---

## 四、安全清单

- [ ] `RELAY_TOKEN` 用随机串，别用「abc123」。它等于发文章的口令。
- [ ] 中转服务只暴露 `/health` 与 `/wechat/draft`，其它路径一律 404。
- [ ] `Access-Control-Allow-Origin` 改成你的前端域名，别留 `*`。
- [ ] 请求体限制在 2MB 以内（正文上限 1MB，留余量）。
- [ ] 不要把 `AppSecret` 写进代码或提交到仓库，只用环境变量。
- [ ] 定期看日志：连续 `40164` 说明 IP 变了（换机器 / 换机房），要去后台改白名单。

---

## 五、已知限制

- **只建草稿，不群发**。群发是不可撤销的，不该由一个「复制粘贴工具」代劳。发之前请在公众号后台预览。
- **图片不会自动上传**。正文里的外链图在微信里会裂，仍然要走「图片清单」逐张上传。这是微信图床防盗链决定的，跟中转服务无关。
- **草稿箱上限 20 篇**。发得多的话要定期清。
- 一篇草稿对应一个 `media_id`。同标题重复发送会建出多篇草稿，工具不会去重。
