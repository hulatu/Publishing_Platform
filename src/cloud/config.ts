/**
 * 云服务配置
 *
 * 这里留空即可正常使用工具 —— AI 会降级到「自带 Key」或「本地抽取」。
 * 只有在通过 WorkBuddy 云服务发布后，才把 publicConfig 填进来（免密钥调用）。
 *
 * ⚠️ 云服务按 Origin 精确匹配，localhost 不在白名单：
 * 填了配置在本地 dev 里调用会返回 auth_ 错误，这是预期行为，不是配置错。
 */

export interface PublicConfig {
  endpoint: string
  publishableKey: string
  oauthRelayBaseUrl?: string
}

/** 由云服务激活流程返回；未激活时保持 null */
export const PUBLIC_CONFIG: PublicConfig | null = null

export function isCloudConfigured(): boolean {
  return Boolean(PUBLIC_CONFIG?.endpoint && PUBLIC_CONFIG?.publishableKey)
}
