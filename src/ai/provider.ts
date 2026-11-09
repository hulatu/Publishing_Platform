/**
 * AI Provider
 *
 * 两种可用实现，按优先级自动选择：
 * 1. byok  —— 使用者自己填 OpenAI 兼容 endpoint + key + model，存 localStorage。
 *             这是主路径：任何打开这个网页的人都能填自己的 Key 拿到 AI 能力。
 * 2. cloud —— WorkBuddy 云服务，免密钥。只在发布后的域名下可用（Origin 精确匹配）
 *
 * 都不可用时由调用方降级到 fallback.ts 的本地抽取。
 *
 * 隐私：Key 只写进本机 localStorage，请求直接从浏览器发往使用者选择的服务商，
 * 不经过本工具的任何服务器（本工具没有服务器）。
 */

import { getCloudClient, listCloudModels } from '../cloud/client'
import { isCloudConfigured } from '../cloud/config'

export interface CompleteOptions {
  system: string
  user: string
  signal?: AbortSignal
  onDelta?: (text: string) => void
}

export interface CompleteResult {
  text: string
  /** 是否因 max_tokens 被截断（需要重试而不是当成解析失败） */
  truncated: boolean
}

export interface AIProvider {
  id: 'cloud' | 'byok'
  label: string
  available(): boolean
  complete(opts: CompleteOptions): Promise<CompleteResult>
}

/* ------------------------------------------------------------------ */
/* 服务商预设                                                           */
/* ------------------------------------------------------------------ */

export interface ProviderPreset {
  id: string
  name: string
  endpoint: string
  model: string
  /** 该服务是否支持 response_format: json_object */
  jsonMode: boolean
  /** 备选模型，填进 datalist */
  models: string[]
  /** 申请 Key 的地址 */
  consoleUrl: string
  /** 备注：跨域、可用性等 */
  note?: string
}

export const PROVIDER_PRESETS: ProviderPreset[] = [
  {
    id: 'deepseek',
    name: 'DeepSeek',
    endpoint: 'https://api.deepseek.com/v1',
    model: 'deepseek-chat',
    jsonMode: true,
    models: ['deepseek-chat', 'deepseek-reasoner'],
    consoleUrl: 'https://platform.deepseek.com/api_keys',
    note: '已确认允许浏览器直连，价格低，中文写作表现稳。',
  },
  {
    id: 'moonshot',
    name: '月之暗面 Kimi',
    endpoint: 'https://api.moonshot.cn/v1',
    model: 'kimi-k2-0905-preview',
    jsonMode: true,
    models: ['kimi-k2-0905-preview', 'moonshot-v1-32k', 'moonshot-v1-8k'],
    consoleUrl: 'https://platform.moonshot.cn/console/api-keys',
  },
  {
    id: 'zhipu',
    name: '智谱 GLM',
    endpoint: 'https://open.bigmodel.cn/api/paas/v4',
    model: 'glm-4-flash',
    jsonMode: true,
    models: ['glm-4-flash', 'glm-4-air', 'glm-4-plus'],
    consoleUrl: 'https://bigmodel.cn/usercenter/apikeys',
    note: 'glm-4-flash 有免费额度，适合先试。',
  },
  {
    id: 'siliconflow',
    name: '硅基流动',
    endpoint: 'https://api.siliconflow.cn/v1',
    model: 'Qwen/Qwen2.5-7B-Instruct',
    jsonMode: true,
    models: ['Qwen/Qwen2.5-7B-Instruct', 'deepseek-ai/DeepSeek-V3', 'THUDM/glm-4-9b-chat'],
    consoleUrl: 'https://cloud.siliconflow.cn/account/ak',
    note: '一个 Key 可以调很多开源模型。',
  },
  {
    id: 'dashscope',
    name: '通义千问',
    endpoint: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
    model: 'qwen-plus',
    jsonMode: true,
    models: ['qwen-plus', 'qwen-turbo', 'qwen-max'],
    consoleUrl: 'https://bailian.console.aliyun.com/',
  },
  {
    id: 'openai',
    name: 'OpenAI',
    endpoint: 'https://api.openai.com/v1',
    model: 'gpt-4o-mini',
    jsonMode: true,
    models: ['gpt-4o-mini', 'gpt-4o', 'gpt-4.1-mini'],
    consoleUrl: 'https://platform.openai.com/api-keys',
    note: '国内网络通常无法直连。',
  },
  {
    id: 'custom',
    name: '自定义',
    endpoint: '',
    model: '',
    jsonMode: true,
    models: [],
    consoleUrl: '',
    note: '任何 OpenAI 兼容接口都可以，包括本地 Ollama / LM Studio / one-api 中转。',
  },
]

export function presetById(id: string): ProviderPreset | undefined {
  return PROVIDER_PRESETS.find((p) => p.id === id)
}

/* ------------------------------------------------------------------ */
/* BYOK 配置                                                            */
/* ------------------------------------------------------------------ */

export interface ByokSettings {
  /** 预设 id，仅用于 UI 高亮，不参与请求 */
  presetId: string
  endpoint: string
  apiKey: string
  model: string
  /** 该服务是否支持 response_format: json_object */
  jsonMode: boolean
}

const BYOK_KEY = 'dispatch.byok.v1'

const DEEPSEEK = PROVIDER_PRESETS[0]

export const emptyByok: ByokSettings = {
  presetId: DEEPSEEK.id,
  endpoint: DEEPSEEK.endpoint,
  apiKey: '',
  model: DEEPSEEK.model,
  jsonMode: DEEPSEEK.jsonMode,
}

export function loadByok(): ByokSettings {
  try {
    const raw = localStorage.getItem(BYOK_KEY)
    if (!raw) return { ...emptyByok }
    const parsed = JSON.parse(raw) as Partial<ByokSettings>
    const merged: ByokSettings = { ...emptyByok, ...parsed }
    // 老版本存的数据没有 presetId：按 endpoint 反查，反查不到就当自定义
    if (!parsed.presetId) {
      const match = PROVIDER_PRESETS.find((p) => p.endpoint && p.endpoint === merged.endpoint)
      merged.presetId = match?.id ?? 'custom'
    }
    return merged
  } catch {
    return { ...emptyByok }
  }
}

/**
 * 保存自带 Key。返回是否真的落盘了。
 *
 * 隐私模式、禁用第三方 Cookie、存储配额耗尽时 `localStorage.setItem` 会抛异常。
 * 静默吞掉会让用户以为存住了，刷新一次才发现要重填 —— 所以要把结果交回给 UI。
 */
export function saveByok(settings: ByokSettings): boolean {
  let ok = false
  try {
    localStorage.setItem(BYOK_KEY, JSON.stringify(settings))
    ok = true
  } catch {
    // 写不进去不影响本次会话：设置还在内存里，能正常用
  }
  // 预连接是纯优化，跟写盘成功与否无关
  applyPreconnect(settings.endpoint)
  return ok
}

export function clearByok(): boolean {
  try {
    localStorage.removeItem(BYOK_KEY)
    return true
  } catch {
    return false
  }
}

/** 三项都填了才算配好 */
export function byokConfigured(s: ByokSettings = loadByok()): boolean {
  return Boolean(s.endpoint.trim() && s.apiKey.trim() && s.model.trim())
}

/**
 * 给 AI 服务商的域名预连接。
 *
 * endpoint 是确定的，但浏览器要等第一次 fetch 才去 DNS + TCP + TLS。
 * 访问国内 API 光握手就 100–300ms，而这段时间完全可以和「用户读界面、
 * 选平台、检查合规」重叠掉 —— 插一条 preconnect 就行。
 */
export function applyPreconnect(endpoint: string): void {
  if (typeof document === 'undefined') return

  let origin: string
  try {
    origin = new URL(endpoint).origin
  } catch {
    return
  }
  // 同源没有握手成本；本地 Ollama 之类也不需要
  if (origin === location.origin) return

  // 换服务商时把旧的摘掉，别让 <head> 越堆越多
  document.querySelectorAll('link[data-preconnect]').forEach((node) => {
    if (node.getAttribute('href') !== origin) node.remove()
  })
  if (document.querySelector(`link[data-preconnect][href="${origin}"]`)) return

  const link = document.createElement('link')
  link.rel = 'preconnect'
  link.href = origin
  link.crossOrigin = 'anonymous'
  link.setAttribute('data-preconnect', '1')
  document.head.appendChild(link)
}

/* ------------------------------------------------------------------ */
/* 超时                                                                 */
/* ------------------------------------------------------------------ */

/**
 * 首字节超时：连接建立后多久还没收到第一个字节。
 *
 * 网关挂起、代理缓冲、服务端排队，全都表现为「连上了但不吐字」。
 * 没有这个上限就只能干等，用户唯一的出路是刷新页面 —— 已经流出来的半截文案全丢。
 */
const FIRST_BYTE_TIMEOUT = 45_000

/** 空闲超时：已经开始吐字，但两帧之间超过这个间隔。 */
const IDLE_TIMEOUT = 30_000

/**
 * 被我们自己的超时掐断。
 *
 * 必须和「用户主动取消」分开：前者值得重试一次，后者绝对不能重试
 * （用户点了取消，你还偷偷再发一遍请求，是很糟糕的行为）。
 */
export class AITimeoutError extends Error {
  constructor(
    readonly phase: 'first-byte' | 'idle',
    readonly ms: number,
  ) {
    super(
      phase === 'first-byte'
        ? `等了 ${Math.round(ms / 1000)} 秒还没收到第一个字`
        : `数据流中断超过 ${Math.round(ms / 1000)} 秒`,
    )
    this.name = 'AITimeoutError'
  }
}

interface TimeoutGuard {
  signal: AbortSignal
  /** 收到任何字节时调用（含心跳），重置空闲计时 */
  touch: () => void
  /** 是不是被我们掐断的（而不是用户取消） */
  timedOut: () => boolean
  phase: () => 'first-byte' | 'idle'
  dispose: () => void
}

/**
 * 把「外部 signal」和「两段超时」合成一个 signal。
 *
 * 首字节阶段用 FIRST_BYTE_TIMEOUT；第一次 touch 之后切到 IDLE_TIMEOUT，
 * 之后每来一帧就重置。这样「慢但持续有输出」的长文不会被误杀，
 * 「连上就装死」的才会被掐。
 */
function startTimeoutGuard(external?: AbortSignal): TimeoutGuard {
  const ctrl = new AbortController()
  let phase: 'first-byte' | 'idle' = 'first-byte'
  let timedOut = false
  let timer: ReturnType<typeof setTimeout> | undefined

  const arm = (ms: number) => {
    if (timer) clearTimeout(timer)
    timer = setTimeout(() => {
      timedOut = true
      ctrl.abort()
    }, ms)
  }

  const onAbort = () => ctrl.abort()
  if (external) {
    if (external.aborted) ctrl.abort()
    else external.addEventListener('abort', onAbort, { once: true })
  }

  arm(FIRST_BYTE_TIMEOUT)

  return {
    signal: ctrl.signal,
    touch() {
      phase = 'idle'
      arm(IDLE_TIMEOUT)
    },
    timedOut: () => timedOut,
    phase: () => phase,
    dispose() {
      if (timer) clearTimeout(timer)
      external?.removeEventListener('abort', onAbort)
    },
  }
}

/* ------------------------------------------------------------------ */
/* 错误信息中文化                                                       */
/* ------------------------------------------------------------------ */

export function describeAIError(err: unknown): string {
  if (err instanceof AITimeoutError) {
    const s = Math.round(err.ms / 1000)
    return err.phase === 'first-byte'
      ? `等了 ${s} 秒没收到任何数据。多半是代理或网关把流缓冲住了，也可能服务商在排队。换个网络、或换一家服务商再试。`
      : `数据流中断超过 ${s} 秒，已收到的内容还在。可以点「重新生成」接着来。`
  }

  const anyErr = err as {
    error?: { code?: string; message?: string }
    status?: number
    message?: string
    name?: string
  }
  const code = anyErr?.error?.code ?? ''
  const msg = anyErr?.error?.message ?? anyErr?.message ?? String(err)

  if (anyErr?.name === 'AbortError') return '已取消'
  if (code.startsWith('auth_')) {
    return '云服务鉴权失败：当前域名不在白名单。云服务按 Origin 精确匹配，localhost 无法调用，请发布后再试，或在设置里改用自带 Key。'
  }
  if (code.startsWith('quota_')) return `云服务额度不足或触发限流：${msg}`
  if (code.startsWith('gateway_') || code.startsWith('model_')) {
    return `模型服务暂时不可用：${msg}。可以点「重新生成」再试一次。`
  }
  if (code === 'request_stream_required') return '调用方式错误：该接口只支持流式返回。'
  if (anyErr?.status === 401 || anyErr?.status === 403) {
    return 'API Key 无效或权限不足。到「设置」里检查 Key 是否填对、是否还有余额。'
  }
  if (anyErr?.status === 402) return '账户余额不足，请到服务商后台充值。'
  if (anyErr?.status === 404) {
    return `接口或模型不存在（404）。检查「接口地址」是否少了 /v1，或「模型名」是否拼错。${msg ? `服务商说：${msg}` : ''}`
  }
  if (anyErr?.status === 429) return '触发限流（429）。等一会儿再试，或换一个模型。'
  if (anyErr?.status === 400) return `请求被拒绝（400）：${msg}`
  if (msg.includes('Failed to fetch') || msg.includes('NetworkError') || msg.includes('Load failed')) {
    return '网络请求失败。最常见的原因是这家服务不允许浏览器直接跨域调用（CORS）——换 DeepSeek / 智谱 / 硅基流动通常可以，或改用支持 CORS 的中转地址。'
  }
  return msg
}

/* ------------------------------------------------------------------ */
/* 请求工具                                                             */
/* ------------------------------------------------------------------ */

function joinUrl(base: string, path: string): string {
  return `${base.replace(/\/+$/, '')}/${path.replace(/^\/+/, '')}`
}

/**
 * 逐行解析 SSE，产出每个 data: 负载。
 *
 * onActivity 在「收到任何字节」时触发，包括注释行（`: keep-alive`）——
 * 服务商发心跳就是在说「我还活着」，不该因为心跳不是 data 帧就判定流已死。
 */
async function* readSse(
  body: ReadableStream<Uint8Array>,
  onActivity?: () => void,
): AsyncGenerator<string> {
  const reader = body.getReader()
  const decoder = new TextDecoder('utf-8')
  let buffer = ''

  try {
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      onActivity?.()
      buffer += decoder.decode(value, { stream: true })

      let idx: number
      while ((idx = buffer.indexOf('\n')) !== -1) {
        const line = buffer.slice(0, idx).trim()
        buffer = buffer.slice(idx + 1)
        if (line.startsWith('data:')) yield line.slice(5).trim()
      }
    }
    const tail = buffer.trim()
    if (tail.startsWith('data:')) yield tail.slice(5).trim()
  } finally {
    reader.releaseLock()
  }
}

async function readErrorDetail(res: Response): Promise<string> {
  try {
    const j = (await res.json()) as { error?: { message?: string }; message?: string }
    return j?.error?.message ?? j?.message ?? `HTTP ${res.status}`
  } catch {
    return `HTTP ${res.status}`
  }
}

/** 把「被中止」翻译成调用方看得懂的错误：用户取消原样抛，超时换成 AITimeoutError */
function asTimeout(err: unknown, guard: TimeoutGuard): unknown {
  if (!guard.timedOut()) return err
  const phase = guard.phase()
  return new AITimeoutError(phase, phase === 'first-byte' ? FIRST_BYTE_TIMEOUT : IDLE_TIMEOUT)
}

/* ------------------------------------------------------------------ */
/* BYOK Provider                                                       */
/* ------------------------------------------------------------------ */

export function createByokProvider(settings: ByokSettings): AIProvider {
  return {
    id: 'byok',
    label: settings.model || '自带 Key',
    available: () => byokConfigured(settings),
    async complete({ system, user, signal, onDelta }) {
      const payload: Record<string, unknown> = {
        model: settings.model,
        messages: [
          { role: 'system', content: system },
          { role: 'user', content: user },
        ],
        stream: true,
        temperature: 0.55,
      }
      if (settings.jsonMode) payload.response_format = { type: 'json_object' }

      const guard = startTimeoutGuard(signal)
      try {
        const res = await fetch(joinUrl(settings.endpoint, '/chat/completions'), {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${settings.apiKey}`,
          },
          body: JSON.stringify(payload),
          signal: guard.signal,
        })

        if (!res.ok || !res.body) {
          const detail = await readErrorDetail(res)
          const err = new Error(detail) as Error & { status?: number }
          err.status = res.status
          throw err
        }

        let text = ''
        let truncated = false

        for await (const data of readSse(res.body, guard.touch)) {
          if (!data || data === '[DONE]') continue
          try {
            const chunk = JSON.parse(data) as {
              choices?: { delta?: { content?: string }; finish_reason?: string }[]
            }
            const choice = chunk.choices?.[0]
            const delta = choice?.delta?.content
            if (delta) {
              text += delta
              onDelta?.(delta)
            }
            if (choice?.finish_reason === 'length') truncated = true
          } catch {
            /* 跳过无法解析的帧 */
          }
        }

        return { text, truncated }
      } catch (err) {
        throw asTimeout(err, guard)
      } finally {
        guard.dispose()
      }
    },
  }
}

/* ------------------------------------------------------------------ */
/* 网络重试                                                             */
/* ------------------------------------------------------------------ */

/** 网络层重试次数（不含首次） */
const NET_RETRIES = 2

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms))

/**
 * 这次失败值不值得原样重试。
 *
 * 判断标准只有一个：重试有没有可能得到不同结果。
 * - 超时、限流、5xx、fetch 失败：过几秒网络状况就变了，值得
 * - 401/402/403/404/400：Key 错了、余额没了、模型名拼错了，重试一百次也一样
 */
export function isRetryableAIError(err: unknown): boolean {
  if (err instanceof AITimeoutError) return true
  const status = (err as { status?: number })?.status
  if (status === 429) return true
  if (typeof status === 'number' && status >= 500) return true
  const msg = String((err as { message?: string })?.message ?? err)
  return /Failed to fetch|NetworkError|Load failed|fetch failed|network error/i.test(msg)
}

/**
 * 包一层「网络失败自动重试」。
 *
 * 生成类请求一次要跑几十秒，一次 Failed to fetch（Wi-Fi 切 4G、代理抖一下、
 * 502 网关重启）就整段作废，代价太高。但重试必须用原始 prompt ——
 * 上一次可能一个字都没产出，接不上残文。
 */
export async function completeWithRetry(
  provider: AIProvider,
  opts: CompleteOptions,
  onRetry?: () => void,
): Promise<CompleteResult> {
  let last: unknown
  for (let i = 0; i <= NET_RETRIES; i++) {
    try {
      return await provider.complete(opts)
    } catch (err) {
      last = err
      // 用户主动取消：一次都不重试
      if (opts.signal?.aborted) throw err
      if (!isRetryableAIError(err) || i === NET_RETRIES) throw err
      // 退避加抖动：固定间隔会让同时失败的请求撞在同一个时刻重试
      await sleep(1200 * (i + 1) + Math.random() * 1000)
      onRetry?.()
    }
  }
  throw last
}

/* ------------------------------------------------------------------ */
/* 连接测试                                                             */
/* ------------------------------------------------------------------ */

export interface PingResult {
  ok: boolean
  message: string
  /** 往返毫秒 */
  ms: number
}

/**
 * 用最小代价验证 Key / 地址 / 模型三件套是否可用。
 * 不用流式，只让模型回一个字符，避免浪费额度。
 */
export async function pingByok(settings: ByokSettings): Promise<PingResult> {
  const started = Date.now()
  if (!byokConfigured(settings)) {
    return { ok: false, message: '接口地址、API Key、模型名三项都要填。', ms: 0 }
  }

  // 手动超时：AbortSignal.timeout 在 Safari 16 以下不存在，直接用会抛 TypeError，
  // 结果会被当成「连接失败」，提示全错。手动兜一层（和 fetchOnce 同一套做法）。
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(new DOMException('timeout', 'TimeoutError')), 20_000)
  try {
    const res = await fetch(joinUrl(settings.endpoint, '/chat/completions'), {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${settings.apiKey}`,
      },
      body: JSON.stringify({
        model: settings.model,
        messages: [{ role: 'user', content: '回复 ok' }],
        max_tokens: 8,
        stream: false,
      }),
      signal: ctrl.signal,
    })

    const ms = Date.now() - started

    if (!res.ok) {
      const detail = await readErrorDetail(res)
      const err = new Error(detail) as Error & { status?: number }
      err.status = res.status
      return { ok: false, message: describeAIError(err), ms }
    }

    const j = (await res.json()) as { choices?: { message?: { content?: string } }[] }
    const reply = j?.choices?.[0]?.message?.content?.trim() ?? ''
    return {
      ok: true,
      message: `连接正常，${ms} ms${reply ? `（模型回：${reply.slice(0, 12)}）` : ''}`,
      ms,
    }
  } catch (err) {
    const ms = Date.now() - started
    if (err instanceof Error && err.name === 'TimeoutError') {
      return { ok: false, message: '请求超时 20 秒。地址可能不通，或该服务不允许浏览器直连。', ms }
    }
    return { ok: false, message: describeAIError(err), ms }
  } finally {
    clearTimeout(timer)
  }
}

/* ------------------------------------------------------------------ */
/* Cloud Provider                                                      */
/* ------------------------------------------------------------------ */

const CLOUD_MODEL_KEY = 'dispatch.cloudModel.v1'

/**
 * 这里必须 try/catch：`loadCloudModel` 会在 render 期间被 `resolveProvider` 调到，
 * 而「禁用所有 Cookie」的浏览器里连读 localStorage 都会抛 SecurityError ——
 * 不兜住就是整页白屏，而不是「没有云服务可用」。
 */
export function loadCloudModel(): string {
  try {
    return localStorage.getItem(CLOUD_MODEL_KEY) ?? ''
  } catch {
    return ''
  }
}

export function saveCloudModel(id: string): boolean {
  try {
    localStorage.setItem(CLOUD_MODEL_KEY, id)
    return true
  } catch {
    return false
  }
}

/** 拉取云服务模型列表，供设置页选择 */
export async function fetchCloudModels(): Promise<{ id: string; name: string }[]> {
  if (!isCloudConfigured()) return []
  try {
    return await listCloudModels()
  } catch {
    return []
  }
}

export function createCloudProvider(modelId: string): AIProvider {
  return {
    id: 'cloud',
    label: 'WorkBuddy 云服务（免密钥）',
    available: () => isCloudConfigured() && Boolean(modelId),
    async complete({ system, user, signal, onDelta }) {
      const client = await getCloudClient()
      if (!client) throw new Error('云服务未配置')

      let text = ''
      let truncated = false

      const guard = startTimeoutGuard(signal)
      try {
        const stream = client.llm.chat.completions.create({
          model: modelId,
          messages: [
            { role: 'system', content: system },
            { role: 'user', content: user },
          ],
          stream: true,
          temperature: 0.55,
          response_format: { type: 'json_object' },
          stream_options: { include_usage: true },
          signal: guard.signal,
        })

        for await (const chunk of stream) {
          guard.touch()
          const choice = chunk.choices?.[0]
          const delta = choice?.delta?.content
          if (delta) {
            text += delta
            onDelta?.(delta)
          }
          if (choice?.finish_reason === 'length') truncated = true
        }

        return { text, truncated }
      } catch (err) {
        throw asTimeout(err, guard)
      } finally {
        guard.dispose()
      }
    },
  }
}

/* ------------------------------------------------------------------ */
/* 选择当前可用的 Provider                                              */
/* ------------------------------------------------------------------ */

export type ProviderMode = 'byok' | 'cloud' | 'none'

export interface ProviderChoice {
  provider: AIProvider | null
  mode: ProviderMode
  /** 为什么没有可用 provider */
  reason: string
}

export function resolveProvider(): ProviderChoice {
  // 自带 Key 优先：使用者明确填了，就用他填的
  const byok = loadByok()
  if (byokConfigured(byok)) {
    return { provider: createByokProvider(byok), mode: 'byok', reason: '' }
  }

  const cloudModel = loadCloudModel()
  if (isCloudConfigured() && cloudModel) {
    return { provider: createCloudProvider(cloudModel), mode: 'cloud', reason: '' }
  }

  return {
    provider: null,
    mode: 'none',
    reason: '还没有配置大模型。点右上角「设置」，填入任意 OpenAI 兼容服务的 API Key（推荐 DeepSeek），即可获得 AI 改写。',
  }
}
