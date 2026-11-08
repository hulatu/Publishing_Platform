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

console.log(fail === 0 ? '\n图片代理准入规则全部通过' : `\n${fail} 项失败`)
if (fail > 0) process.exitCode = 1
