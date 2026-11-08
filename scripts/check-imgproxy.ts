/**
 * 图片代理的准入规则（functions/api/img.ts）
 *
 * 这个函数是公开可访问的：任何人都能拿 publish.hulatu.com/api/img?u=...
 * 让它去取一个 URL。所以白名单是它唯一的防线 —— 一旦放宽成「任意 https」，
 * 这个域名就变成公共代理，流量和滥用风险都算在账号头上。
 *
 * 这里只断言「拒绝」的分支，不依赖网络：
 * 白名单内的域名允许放行，但能不能真取到图是另一回事（离线时是 502），
 * 所以用「不是 403」来判定「白名单放过了它」。
 */

import { onRequestGet } from '../functions/api/img'

let fail = 0
const check = (cond: boolean, msg: string) => {
  if (cond) {
    console.log(`  ✓ ${msg}`)
  } else {
    console.log(`  ✗ ${msg}`)
    fail++
  }
}

const call = async (u: string | null) => {
  const url = 'https://publish.hulatu.com/api/img' + (u === null ? '' : `?u=${encodeURIComponent(u)}`)
  const res = await onRequestGet({ request: new Request(url) })
  // 只读状态码，不碰 body（图片可能几 MB）
  return res.status
}

const missing = await call(null)
check(missing === 400, '没带 ?u= → 400')

const bad = await call('not a url')
check(bad === 400, '非法 URL → 400')

const http = await call('http://img.hulatu.com/a.png')
check(http === 403, 'http 协议一律拒绝（只放行 https）→ 403')

const other = await call('https://example.com/a.png')
check(other === 403, '不在白名单的域名 → 403')

const trick = await call('https://evil-hulatu.com/a.png')
check(trick === 403, '后缀伪装 evil-hulatu.com 不被当成 hulatu.com → 403')

const trick2 = await call('https://hulatu.com.evil.com/a.png')
check(trick2 === 403, '前缀伪装 hulatu.com.evil.com → 403')

const own = await call('https://img.hulatu.com/post/H2UQZm.webp')
check(own !== 403, '白名单内的图床被放行（取不取得到另说）')

const root = await call('https://hulatu.com/')
check(root !== 403, '主域被放行（但非图片内容会被 415 挡掉）')

/* ------------------------------------------------------------------ */
/* 体检探测（?probe=1）                                                */
/* ------------------------------------------------------------------ */

/**
 * 探测路径返回的是 JSON 而不是图片，客户端靠 content-type 判断
 * 「这是探测结果」还是「Functions 没部署、返回了 SPA 的 index.html」。
 * 这一条如果不成立，本地开发时会把每张图都误报成「查不出格式」。
 */
const callProbe = async (u: string | null) => {
  const url =
    'https://publish.hulatu.com/api/img' +
    (u === null ? '' : `?u=${encodeURIComponent(u)}`) +
    (u === null ? '?probe=1' : '&probe=1')
  return onRequestGet({ request: new Request(url) })
}

const probeMissing = await callProbe(null)
check(probeMissing.status === 400, '探测没带 ?u= → 400')

const probeBad = await callProbe('not a url')
check(probeBad.status === 400, '探测非法 URL → 400')

const probeHttp = await callProbe('http://img.hulatu.com/a.png')
check(probeHttp.status === 403, '探测 http 协议 → 403')

const probeOther = await callProbe('https://example.com/a.png')
check(probeOther.status === 403, '探测白名单外的域名 → 403（探测不能绕过白名单）')

const probeOwn = await callProbe('https://img.hulatu.com/post/H2UQZm.webp')
check(probeOwn.status === 200, '探测白名单内的图床 → 200（结论在 body 的 status 里）')
check(
  (probeOwn.headers.get('content-type') ?? '').includes('application/json'),
  '探测返回 JSON —— 客户端靠这个区分「探测结果」和「代理没部署」',
)
check(
  (probeOwn.headers.get('access-control-allow-origin') ?? '') === '*',
  '探测也带 CORS 头，否则浏览器读不到结论',
)

/**
 * 探测的 body 形状是固定的四个字段，不论联网与否：
 * 连不上时 status 是 0（表示「没问到」，不是「对方返回 0」），
 * 所以这里不按「有值/没值」断言，而是断言形状本身。
 *
 * `hotlink` 必须是布尔且**默认 false** —— 探测失败时如果它变成 true，
 * 界面会把「网络不通」显示成「你被防盗链了」。
 */
const probeBody = (await probeOwn.json()) as {
  status?: unknown
  bytes?: unknown
  hotlink?: unknown
  foreignStatus?: unknown
}
check(typeof probeBody.status === 'number', '探测 body 带 upstream 状态码（连不上时是 0）')
check(typeof probeBody.hotlink === 'boolean', '探测 body 带 hotlink 布尔值')
check(typeof probeBody.foreignStatus === 'number', '探测 body 带「带 Referer 那次」的状态码，便于排查')

console.log(fail === 0 ? '\n图片代理准入规则全部通过' : `\n${fail} 项失败`)
if (fail > 0) process.exitCode = 1
