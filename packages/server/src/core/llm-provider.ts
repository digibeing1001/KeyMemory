/**
 * LLM Provider 抽象层（OpenAI 兼容协议）
 *
 * 设计目标（来自用户原话）：
 * - "把这些模型你直接给一个自定义链接就好了，也不用去预设说具体是哪个模型"
 * - "需要填写一个 API 的地址，还要填写一个 API key，点击一下检测，把能用的模型自动拉取下来"
 * - "然后再通过下拉框去选择，最终保存就可以了"
 * - "系统的，一定要做得让用户知道通了没通"
 *
 * 协议：统一走 OpenAI 兼容协议
 * - Ollama: http://localhost:11434/v1
 * - OpenAI: https://api.openai.com/v1
 * - DeepSeek: https://api.deepseek.com/v1
 * - Claude (兼容层): https://api.anthropic.com/v1（需兼容层）
 *
 * 存储：复用 tool_secrets 表
 * - tool: 'llm-provider'
 * - name: 'default'
 * - value: API key（加密存储）
 * - metadata: { baseUrl, model, enabled, lastVerifiedAt, availableModels }
 */

import { LLM_PROVIDER_DEFAULTS } from '@keymemory/shared';
import type { LLMProviderConfig, LLMVerifyResult, LLMChatRequest, LLMChatResponse } from '@keymemory/shared';
import { getToolSecret, setToolSecret, listToolSecrets, deleteToolSecret } from './secrets.js';

const LLM_TOOL = 'llm-provider';
const LLM_SECRET_NAME = 'default';
/**
 * 本地 Ollama 等不需要 API key 的模型，用此占位符存储。
 * setToolSecret 要求 value 非空，所以空 key 用占位符代替。
 * getLLMApiKey 识别占位符后返回 null，确保不发送 Authorization header。
 */
const NO_API_KEY_SENTINEL = '__no_api_key__';

/**
 * 读取当前 LLM 配置。
 *
 * @returns 配置对象；若未配置过返回 null（调用方应判断并提示用户配置）
 */
export function getLLMConfig(): LLMProviderConfig | null {
  const secret = getToolSecret(LLM_TOOL, LLM_SECRET_NAME);
  if (!secret) return null;

  const meta = secret.metadata ?? {};
  return {
    baseUrl: String(meta.baseUrl ?? LLM_PROVIDER_DEFAULTS.defaultBaseUrl),
    model: String(meta.model ?? ''),
    enabled: Boolean(meta.enabled ?? false),
    lastVerifiedAt: meta.lastVerifiedAt ? String(meta.lastVerifiedAt) : undefined,
    availableModels: Array.isArray(meta.availableModels) ? meta.availableModels.map(String) : undefined,
  };
}

/**
 * 读取已解密的 API key（仅内部使用，不暴露到 API 响应）。
 */
function getLLMApiKey(): string | null {
  const secret = getToolSecret(LLM_TOOL, LLM_SECRET_NAME);
  const val = secret?.value;
  if (!val || val === NO_API_KEY_SENTINEL) return null;
  return val;
}

/**
 * 保存 LLM 配置（不包含连通性检测，纯写入）。
 *
 * @param config 配置对象
 * @param apiKey API key（明文，会被 AES-256-GCM 加密后存储）
 */
export function saveLLMConfig(config: Omit<LLMProviderConfig, 'lastVerifiedAt' | 'availableModels'>, apiKey: string): LLMProviderConfig {
  const existing = getToolSecret(LLM_TOOL, LLM_SECRET_NAME);
  const previousMeta = existing?.metadata ?? {};

  const secret = setToolSecret({
    tool: LLM_TOOL,
    name: LLM_SECRET_NAME,
    value: apiKey || NO_API_KEY_SENTINEL,
    metadata: {
      baseUrl: config.baseUrl,
      model: config.model,
      enabled: config.enabled,
      // 保留上次检测结果（saveLLMConfig 不做检测，由 verifyLLMConnection 单独触发）
      lastVerifiedAt: previousMeta.lastVerifiedAt,
      availableModels: previousMeta.availableModels,
    },
  });

  return {
    baseUrl: config.baseUrl,
    model: config.model,
    enabled: config.enabled,
    lastVerifiedAt: previousMeta.lastVerifiedAt ? String(previousMeta.lastVerifiedAt) : undefined,
    availableModels: Array.isArray(previousMeta.availableModels) ? previousMeta.availableModels.map(String) : undefined,
  };
}

/**
 * 连通性检测 + 拉取模型列表。
 *
 * 流程：GET {baseUrl}/models，Authorization: Bearer {apiKey}
 * 兼容 OpenAI / Ollama / DeepSeek 等响应格式。
 *
 * @param baseUrl 可选，不传则用已保存的配置
 * @param apiKey 可选，不传则用已保存的配置
 * @returns 检测结果 + 可用模型列表
 */
export async function verifyLLMConnection(baseUrl?: string, apiKey?: string): Promise<LLMVerifyResult> {
  const url = baseUrl ?? getLLMConfig()?.baseUrl;
  // apiKey 可选：本地 Ollama 模型不需要 key
  // 如果调用方没传 apiKey，则尝试从已保存配置读取（可能是云端 API）；本地模型保存时 apiKey 为空字符串
  const key = apiKey !== undefined ? apiKey : (getLLMApiKey() || '');

  if (!url) {
    return { ok: false, models: [], error: 'baseUrl 未配置' };
  }

  const modelsUrl = url.replace(/\/+$/, '') + LLM_PROVIDER_DEFAULTS.modelsEndpoint;
  const start = Date.now();

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), LLM_PROVIDER_DEFAULTS.timeoutMs);

    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    // 仅当有 apiKey 时才发送 Authorization header（Ollama 本地模型不需要）
    if (key) {
      headers.Authorization = `Bearer ${key}`;
    }

    const resp = await fetch(modelsUrl, {
      method: 'GET',
      headers,
      signal: controller.signal,
    });
    clearTimeout(timeout);

    if (!resp.ok) {
      const text = await resp.text().catch(() => '');
      return {
        ok: false,
        models: [],
        error: `HTTP ${resp.status}: ${text.slice(0, 200) || resp.statusText}`,
        latencyMs: Date.now() - start,
      };
    }

    const data = await resp.json() as { data?: Array<{ id: string }>; models?: Array<{ name: string; id?: string }> };
    // 兼容 OpenAI 格式（data[].id）和 Ollama 格式（models[].name）
    const models = (data.data?.map(m => m.id) ?? data.models?.map(m => m.name ?? m.id ?? '') ?? [])
      .filter(Boolean)
      .sort();

    return {
      ok: true,
      models,
      latencyMs: Date.now() - start,
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    const isTimeout = msg.includes('abort') || msg.includes('timeout');
    return {
      ok: false,
      models: [],
      error: isTimeout ? `连接超时（${LLM_PROVIDER_DEFAULTS.timeoutMs}ms）` : msg,
      latencyMs: Date.now() - start,
    };
  }
}

/**
 * 保存检测结果（用户点"检测"后，把 lastVerifiedAt + availableModels 持久化）。
 *
 * 与 saveLLMConfig 分离：检测不修改 baseUrl/model/enabled，只更新检测元数据。
 */
export function saveLLMVerifyResult(result: LLMVerifyResult): LLMProviderConfig | null {
  const existing = getToolSecret(LLM_TOOL, LLM_SECRET_NAME);
  if (!existing) return null;

  const meta = existing.metadata ?? {};
  const secret = setToolSecret({
    tool: LLM_TOOL,
    name: LLM_SECRET_NAME,
    value: existing.value, // 保留原 key
    metadata: {
      ...meta,
      lastVerifiedAt: result.ok ? new Date().toISOString() : meta.lastVerifiedAt,
      availableModels: result.ok ? result.models : meta.availableModels,
    },
  });

  return {
    baseUrl: String(meta.baseUrl ?? LLM_PROVIDER_DEFAULTS.defaultBaseUrl),
    model: String(meta.model ?? ''),
    enabled: Boolean(meta.enabled ?? false),
    lastVerifiedAt: result.ok ? new Date().toISOString() : (meta.lastVerifiedAt ? String(meta.lastVerifiedAt) : undefined),
    availableModels: result.ok ? result.models : (Array.isArray(meta.availableModels) ? meta.availableModels.map(String) : undefined),
  };
}

/**
 * 调用 LLM Chat（OpenAI 兼容协议）。
 *
 * @param request 推理请求
 * @returns 推理响应
 * @throws 如果未配置或调用失败
 */
export async function chatWithLLM(request: LLMChatRequest): Promise<LLMChatResponse> {
  const config = getLLMConfig();
  if (!config) {
    throw new Error('LLM 未配置：请在设置页面填写 baseUrl + apiKey + model');
  }
  if (!config.enabled) {
    throw new Error('LLM 已禁用：请在设置页面启用');
  }
  if (!config.model) {
    throw new Error('LLM model 未选择：请在设置页面选择模型');
  }

  // apiKey 可选：本地 Ollama 模型不需要 key
  const apiKey = getLLMApiKey() || '';

  const chatUrl = config.baseUrl.replace(/\/+$/, '') + LLM_PROVIDER_DEFAULTS.chatEndpoint;
  const start = Date.now();

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), request.maxTokens ? 60000 : LLM_PROVIDER_DEFAULTS.timeoutMs);

  try {
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (apiKey) {
      headers.Authorization = `Bearer ${apiKey}`;
    }
    const resp = await fetch(chatUrl, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        model: config.model,
        messages: [
          { role: 'system', content: request.systemPrompt },
          { role: 'user', content: request.userMessage },
        ],
        temperature: request.temperature ?? 0.1,
        max_tokens: request.maxTokens ?? 2000,
        stream: false,
      }),
      signal: controller.signal,
    });
    clearTimeout(timeout);

    if (!resp.ok) {
      const text = await resp.text().catch(() => '');
      throw new Error(`LLM 调用失败 HTTP ${resp.status}: ${text.slice(0, 300) || resp.statusText}`);
    }

    const data = await resp.json() as {
      choices?: Array<{ message?: { content?: string } }>;
      model?: string;
      usage?: { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number };
    };

    const content = data.choices?.[0]?.message?.content;
    if (!content) {
      throw new Error('LLM 返回空内容');
    }

    return {
      content,
      model: data.model ?? config.model,
      usage: data.usage ? {
        promptTokens: data.usage.prompt_tokens,
        completionTokens: data.usage.completion_tokens,
        totalTokens: data.usage.total_tokens,
      } : undefined,
      latencyMs: Date.now() - start,
    };
  } catch (err) {
    clearTimeout(timeout);
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.includes('abort') || msg.includes('timeout')) {
      throw new Error(`LLM 调用超时`);
    }
    throw err;
  }
}

/**
 * 检查 LLM 是否可用（关联推理前调用）。
 *
 * @returns true 表示配置完整且启用
 */
export function isLLMAvailable(): boolean {
  const config = getLLMConfig();
  return !!(config && config.enabled && config.model);
}

/**
 * 删除 LLM 配置（用户在 UI 上清除配置时调用）。
 */
export function clearLLMConfig(): boolean {
  return deleteToolSecret(LLM_TOOL, LLM_SECRET_NAME);
}

/**
 * 列出所有已配置的 LLM（当前只有一个 'default'，但留接口给未来多 provider）。
 */
export function listLLMConfigs(): LLMProviderConfig[] {
  const secrets = listToolSecrets(LLM_TOOL);
  return secrets.map(s => {
    const meta = s.metadata ?? {};
    return {
      baseUrl: String(meta.baseUrl ?? LLM_PROVIDER_DEFAULTS.defaultBaseUrl),
      model: String(meta.model ?? ''),
      enabled: Boolean(meta.enabled ?? false),
      lastVerifiedAt: meta.lastVerifiedAt ? String(meta.lastVerifiedAt) : undefined,
      availableModels: Array.isArray(meta.availableModels) ? meta.availableModels.map(String) : undefined,
    } as LLMProviderConfig;
  });
}
