#!/usr/bin/env node
/**
 * 公众号草稿箱中转服务（参考实现，零依赖，Node 18+）
 *
 * 为什么需要它，见 docs/wechat-draft-relay.md 开头那四条。一句话：
 * AppSecret 不能进前端，而浏览器又不能直连微信接口。
 *
 * 这个文件刻意写成单文件、零依赖、只做一件事：
 * 收一个 JSON，转成微信的 draft/add，把结果原样回来。
 *
 * 用法：
 *   WECHAT_APPID=wx... \
 *   WECHAT_SECRET=... \
 *   RELAY_TOKEN=自己编一串随机字符 \
 *   DEFAULT_COVER_MEDIA_ID=可选，已有永久封面素材的 media_id \
 *   node relay/wechat-relay.mjs
 *
 * 注意：微信要求调用方 IP 在公众号后台白名单里，所以这台机器必须有固定出口 IP。
 * Cloudflare Worker 的出口 IP 不固定，通常过不了白名单 —— 别拿它当默认方案。
 */

import { createServer } from 'node:http'

const {
  WECHAT_APPID,
  WECHAT_SECRET,
  RELAY_TOKEN,
  DEFAULT_COVER_MEDIA_ID,
  DEFAULT_COVER_URL,
  PORT = '8787',
} = process.env

if (!WECHAT_APPID || !WECHAT_SECRET || !RELAY_TOKEN) {
  console.error('缺少环境变量：WECHAT_APPID / WECHAT_SECRET / RELAY_TOKEN 都是必填')
  process.exit(1)
}

const API = 'https://api.weixin.qq.com'

/* ------------------------------------------------------------------ */
/* access_token 缓存                                                    */
/* ------------------------------------------------------------------ */

/**
 * 为什么一定要缓存：
 * - 有效期 7200 秒，但微信对「每天刷新次数」有限制
 * - 每次调用 draft/add 都去换一次 token，很快就会触发 45009
 * - 更糟的是多端并发刷新会把彼此的 token 顶掉，表现为随机 40001
 *
 * 提前 5 分钟过期，避免「取到 token 的瞬间它就过期了」。
 */
let cache = { token: '', expiresAt: 0 }
/** 并发请求共用同一次刷新，避免同时打出多个 token 请求 */
let refreshing = null

async function getToken() {
  const now = Date.now()
  if (cache.token && now < cache.expiresAt) return cache.token
  if (refreshing) return refreshing

  refreshing = (async () => {
    const url =
      `${API}/cgi-bin/token?grant_type=client_credential` +
      `&appid=${encodeURIComponent(WECHAT_APPID)}&secret=${encodeURIComponent(WECHAT_SECRET)}`
    const res = await fetch(url)
    const data = await res.json()

    if (data.errcode) {
      // 40125 AppSecret 错 / 40164 IP 不在白名单，都在这里出现
      const err = new Error(data.errmsg || '获取 access_token 失败')
      err.errcode = data.errcode
      err.errmsg = data.errmsg
      throw err
    }

    cache = { token: data.access_token, expiresAt: now + (data.expires_in - 300) * 1000 }
    return cache.token
  })()

  try {
    return await refreshing
  } finally {
    refreshing = null
  }
}

/* ------------------------------------------------------------------ */
/* 微信调用                                                             */
/* ------------------------------------------------------------------ */

async function wechatPost(path, body) {
  const token = await getToken()
  const res = await fetch(`${API}${path}?access_token=${encodeURIComponent(token)}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  const data = await res.json()

  // 关键：微信的失败也是 HTTP 200，必须看 errcode
  if (typeof data.errcode === 'number' && data.errcode !== 0) {
    // token 失效就把缓存清掉，下次调用自动换新的
    if (data.errcode === 40001 || data.errcode === 42001) cache = { token: '', expiresAt: 0 }
    const err = new Error(data.errmsg || `微信返回错误 ${data.errcode}`)
    err.errcode = data.errcode
    err.errmsg = data.errmsg
    throw err
  }
  return data
}

/**
 * 把一张图传成「永久缩略图素材」，拿到 thumb_media_id。
 *
 * 微信新建草稿强制要求封面，没有就直接 40007。而上传封面必须用
 * material/add_material?type=thumb —— 普通的 media/upload 传的是临时素材，草稿不认。
 */
async function uploadThumb(imageUrl) {
  const img = await fetch(imageUrl)
  if (!img.ok) throw new Error(`封面图下载失败：HTTP ${img.status}`)

  const buf = Buffer.from(await img.arrayBuffer())
  if (buf.length > 10 * 1024 * 1024) throw new Error('封面图超过 10MB')

  const type = img.headers.get('content-type') || 'image/jpeg'
  const ext = type.includes('png') ? 'png' : type.includes('gif') ? 'gif' : 'jpg'

  const form = new FormData()
  form.append('media', new Blob([buf], { type }), `cover.${ext}`)

  const token = await getToken()
  const res = await fetch(
    `${API}/cgi-bin/material/add_material?access_token=${encodeURIComponent(token)}&type=thumb`,
    { method: 'POST', body: form },
  )
  const data = await res.json()
  if (typeof data.errcode === 'number' && data.errcode !== 0) {
    const err = new Error(data.errmsg || '上传封面失败')
    err.errcode = data.errcode
    throw err
  }
  return data.media_id
}

/* ------------------------------------------------------------------ */
/* HTTP 服务                                                            */
/* ------------------------------------------------------------------ */

const LIMITS = { title: 64, digest: 120, content: 20_000 }

function send(res, status, body) {
  const json = JSON.stringify(body)
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(json),
    // 中转服务只给自己的前端用；不开 CORS 通配更安全，按需改成你的域名
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Authorization, Content-Type',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  })
  res.end(json)
}

function authed(req) {
  const h = req.headers.authorization || ''
  const token = h.startsWith('Bearer ') ? h.slice(7).trim() : ''
  // 长度先比，避免明显不对的请求也走到字符串比较
  if (token.length !== RELAY_TOKEN.length) return false
  let diff = 0
  for (let i = 0; i < token.length; i++) diff |= token.charCodeAt(i) ^ RELAY_TOKEN.charCodeAt(i)
  return diff === 0
}

function readJson(req) {
  return new Promise((resolve, reject) => {
    let size = 0
    const chunks = []
    req.on('data', (c) => {
      size += c.length
      // 正文上限 1MB，留点余量给其它字段
      if (size > 2 * 1024 * 1024) {
        reject(new Error('请求体超过 2MB'))
        req.destroy()
        return
      }
      chunks.push(c)
    })
    req.on('end', () => {
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')))
      } catch {
        reject(new Error('请求体不是合法 JSON'))
      }
    })
    req.on('error', reject)
  })
}

const server = createServer(async (req, res) => {
  if (req.method === 'OPTIONS') return send(res, 204, {})

  const url = new URL(req.url, 'http://localhost')

  if (url.pathname === '/health') {
    if (!authed(req)) return send(res, 401, { ok: false, code: 'UNAUTHORIZED' })
    return send(res, 200, {
      ok: true,
      appIdMasked: `${WECHAT_APPID.slice(0, 4)}****${WECHAT_APPID.slice(-4)}`,
      hasDefaultCover: Boolean(DEFAULT_COVER_MEDIA_ID || DEFAULT_COVER_URL),
    })
  }

  if (url.pathname !== '/wechat/draft' || req.method !== 'POST') {
    return send(res, 404, { ok: false, code: 'NOT_FOUND', message: '只有 /health 和 /wechat/draft' })
  }

  if (!authed(req)) return send(res, 401, { ok: false, code: 'UNAUTHORIZED' })

  let payload
  try {
    payload = await readJson(req)
  } catch (e) {
    return send(res, 400, { ok: false, code: 'BAD_REQUEST', message: e.message })
  }

  const title = String(payload.title ?? '').trim()
  const content = String(payload.content ?? '')
  if (!title) return send(res, 400, { ok: false, code: 'BAD_REQUEST', message: '标题为空' })
  if (!content.trim()) return send(res, 400, { ok: false, code: 'BAD_REQUEST', message: '正文为空' })

  // 前端也会查一遍，这里再查是因为不能相信任何客户端
  if ([...title].length > LIMITS.title) {
    return send(res, 400, { ok: false, code: 'CONTENT_TOO_LONG', message: `标题超过 ${LIMITS.title} 字` })
  }
  if ([...content].length > LIMITS.content) {
    return send(res, 400, {
      ok: false,
      code: 'CONTENT_TOO_LONG',
      message: `正文 ${[...content].length} 字符，超过 ${LIMITS.content}`,
    })
  }

  try {
    // 封面：优先用请求带的地址，其次用环境变量配的
    let thumb = DEFAULT_COVER_MEDIA_ID || ''
    const coverUrl = String(payload.coverUrl ?? '').trim() || DEFAULT_COVER_URL || ''
    if (!thumb && coverUrl) thumb = await uploadThumb(coverUrl)
    if (!thumb) {
      return send(res, 400, {
        ok: false,
        code: 'THUMB_REQUIRED',
        message: '没有封面：请求里没带 coverUrl，服务端也没配 DEFAULT_COVER_MEDIA_ID / DEFAULT_COVER_URL',
      })
    }

    const article = {
      title,
      author: String(payload.author ?? '').slice(0, 8),
      digest: String(payload.digest ?? '').slice(0, LIMITS.digest),
      content,
      content_source_url: String(payload.contentSourceUrl ?? ''),
      thumb_media_id: thumb,
      // 评论默认不自动打开：自动开评论的草稿在手机预览里会多一行，容易漏看
      need_open_comment: 0,
      only_fans_can_comment: 0,
    }

    const data = await wechatPost('/cgi-bin/draft/add', { articles: [article] })
    const mediaId = data.media_id

    return send(res, 200, {
      ok: true,
      mediaId,
      // 微信没有返回草稿箱链接，这里给一个能直接打开草稿箱后台的地址
      url: 'https://mp.weixin.qq.com/cgi-bin/appmsg?t=media/appmsg_edit&action=edit&type=10&isMul=1',
    })
  } catch (e) {
    const errcode = typeof e.errcode === 'number' ? e.errcode : undefined
    // 原样把 errcode 透传出去，前端有一张 errcode → 人话的表
    return send(res, errcode ? 400 : 500, {
      ok: false,
      code: 'UPSTREAM_ERROR',
      message: e.message,
      upstream: errcode ? { errcode, errmsg: e.errmsg } : undefined,
    })
  }
})

server.listen(Number(PORT), () => {
  console.log(`wechat relay listening on :${PORT}`)
  console.log(`AppID ${WECHAT_APPID.slice(0, 4)}****${WECHAT_APPID.slice(-4)}`)
  console.log('记得把这台机器的出口 IP 加到公众号后台的 IP 白名单')
})
