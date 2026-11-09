/**
 * 云服务客户端（免密钥大模型调用）
 *
 * 采用 CDN IIFE 形式按需加载 SDK，理由：
 * 1. 不引入 npm 依赖 —— 构建不依赖 @tencent-ai/workbuddy-cloud-sdk 是否装成功
 * 2. 未配置 publicConfig 时完全不加载任何脚本，离线可用
 *
 * 代价：首次调用需要联网拉一次 SDK（约 100KB）。对只在「生成文案」时才用到的
 * 场景来说可以接受，而且失败会优雅降级到 BYOK / 本地抽取。
 */

import { isCloudConfigured, PUBLIC_CONFIG } from './config'

// 钉死版本号：@dev 是移动标签（当前指向 0.1.4-dev 预发布版），上游一次坏发布
// 就会直接打断所有用户。升级时手动改这里，顺带在 jsDelivr 上确认文件存在。
const SDK_URL = 'https://cdn.jsdelivr.net/npm/@tencent-ai/workbuddy-cloud-sdk@0.1.4/lib/index.global.js'

interface CloudChunk {
  choices?: {
    delta?: { content?: string | null; reasoning_content?: string | null }
    finish_reason?: string | null
  }[]
  usage?: { total_tokens?: number }
}

interface CloudClient {
  llm: {
    chat: {
      completions: {
        create: (args: Record<string, unknown>) => AsyncIterable<CloudChunk>
      }
    }
    models: {
      list: () => Promise<{ id: string; name?: string; disabled?: boolean; supportsReasoning?: boolean }[]>
    }
  }
}

declare global {
  interface Window {
    WorkBuddyCloud?: {
      createWorkBuddyCloud: (opts: Record<string, unknown>) => CloudClient
    }
  }
}

type CloudSdk = NonNullable<Window['WorkBuddyCloud']>

let sdkPromise: Promise<CloudSdk> | null = null
let clientPromise: Promise<CloudClient> | null = null

function loadSdk(): Promise<CloudSdk> {
  if (window.WorkBuddyCloud) return Promise.resolve(window.WorkBuddyCloud)
  if (sdkPromise) return sdkPromise

  sdkPromise = new Promise<CloudSdk>((resolve, reject) => {
    // 失败时把 script 标签摘掉：否则下次重试会找到这个已经触发过 error 的
    // 标签、重新挂监听却永远等不到事件，promise 永久挂起。
    const fail = (msg: string) => {
      document.querySelector('script[data-wb-cloud]')?.remove()
      reject(new Error(msg))
    }

    const existing = document.querySelector<HTMLScriptElement>(`script[data-wb-cloud]`)
    if (existing) {
      existing.addEventListener('load', () => {
        if (window.WorkBuddyCloud) resolve(window.WorkBuddyCloud)
        else fail('云服务 SDK 已加载但未挂载全局对象')
      })
      existing.addEventListener('error', () => fail('云服务 SDK 加载失败'))
      return
    }

    const script = document.createElement('script')
    script.src = SDK_URL
    script.async = true
    script.dataset.wbCloud = '1'
    script.onload = () => {
      if (window.WorkBuddyCloud) resolve(window.WorkBuddyCloud)
      else fail('云服务 SDK 加载完成但未挂载全局对象')
    }
    script.onerror = () => fail('云服务 SDK 加载失败，请检查网络')
    document.head.appendChild(script)
  })

  // 失败不缓存：jsDelivr 抖一下不该让一整个会话的 AI 调用都失败，
  // 下次调用重新拉一次 SDK。
  sdkPromise.catch(() => {
    sdkPromise = null
  })

  return sdkPromise
}

/** 拿到云服务客户端；未配置时返回 null（不抛错） */
export async function getCloudClient(): Promise<CloudClient | null> {
  if (!isCloudConfigured() || !PUBLIC_CONFIG) return null
  if (clientPromise) return clientPromise

  clientPromise = (async () => {
    const sdk = await loadSdk()
    if (!sdk) throw new Error('云服务 SDK 不可用')
    return sdk.createWorkBuddyCloud({
      endpoint: PUBLIC_CONFIG.endpoint,
      publishableKey: PUBLIC_CONFIG.publishableKey,
      oauthRelayBaseUrl: PUBLIC_CONFIG.oauthRelayBaseUrl,
    })
  })()

  // 和 loadSdk 一样：失败不缓存，下次调用重建客户端。
  clientPromise.catch(() => {
    clientPromise = null
  })

  return clientPromise
}

/** 模型列表超时：complete() 有两段超时守卫，这里之前没有，云服务挂起时设置页会一直转圈 */
const MODELS_TIMEOUT = 15_000

/** 拉取可用模型列表（跳过 disabled） */
export async function listCloudModels(): Promise<{ id: string; name: string }[]> {
  const client = await getCloudClient()
  if (!client) return []
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    const models = await Promise.race([
      client.llm.models.list(),
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error('拉取模型列表超时（15 秒）')), MODELS_TIMEOUT)
      }),
    ])
    return models
      .filter((m) => m.disabled !== true)
      .map((m) => ({ id: m.id, name: m.name ?? m.id }))
  } finally {
    if (timer) clearTimeout(timer)
  }
}
