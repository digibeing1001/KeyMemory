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
    hasApiKey: Boolean(secret.value && secret.value !== NO_API_KEY_SENTINEL),
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

function normalizeBaseUrl(value: string): string {
  const trimmed = value.trim().replace(/\/+$/, '');
  try {
    const parsed = new URL(trimmed);
    parsed.hash = '';
    parsed.search = '';
    return parsed.toString().replace(/\/+$/, '');
  } catch {
    return trimmed;
  }
}

function sameBaseUrl(left: string | undefined, right: string | undefined): boolean {
  if (!left || !right) return false;
  return normalizeBaseUrl(left) === normalizeBaseUrl(right);
}

/**
 * 仅当请求仍指向保存密钥时使用的同一地址，才允许复用已保存密钥。
 * 这既支持 Web UI 的安全空白占位，也避免用户改地址后把云端密钥发给新主机。
 */
function getSavedApiKeyForBaseUrl(baseUrl: string): string | null {
  const secret = getToolSecret(LLM_TOOL, LLM_SECRET_NAME);
  const savedBaseUrl = secret?.metadata?.baseUrl ? String(secret.metadata.baseUrl) : undefined;
  if (!secret || !sameBaseUrl(savedBaseUrl, baseUrl)) return null;
  if (!secret.value || secret.value === NO_API_KEY_SENTINEL) return null;
  return secret.value;
}

/**
 * 保存 LLM 配置（不包含连通性检测，纯写入）。
 *
 * @param config 配置对象
 * @param apiKey 新 API key（明文，会被 AES-256-GCM 加密后存储）。留空且地址未变时保留已存密钥。
 */
export function saveLLMConfig(
  config: Omit<LLMProviderConfig, 'lastVerifiedAt' | 'availableModels' | 'hasApiKey'>,
  apiKey?: string,
  availableModels?: string[],
): LLMProviderConfig {
  const existing = getToolSecret(LLM_TOOL, LLM_SECRET_NAME);
  const previousMeta = existing?.metadata ?? {};
  const baseUrl = normalizeBaseUrl(config.baseUrl);
  const suppliedApiKey = apiKey?.trim();
  const canReuseExistingKey = sameBaseUrl(previousMeta.baseUrl ? String(previousMeta.baseUrl) : undefined, baseUrl);
  const preserveVerification = canReuseExistingKey
    && (!suppliedApiKey || suppliedApiKey === existing?.value);
  const verifiedModels = Array.from(new Set((availableModels ?? []).map(String).map(item => item.trim()).filter(Boolean)));
  const secretValue = suppliedApiKey
    || (canReuseExistingKey ? existing?.value : undefined)
    || NO_API_KEY_SENTINEL;

  setToolSecret({
    tool: LLM_TOOL,
    name: LLM_SECRET_NAME,
    value: secretValue,
    metadata: {
      baseUrl,
      model: config.model,
      enabled: config.enabled,
      hasApiKey: secretValue !== NO_API_KEY_SENTINEL,
      // 只有地址和密钥都没变时，上次检测结果才仍然可信。
      lastVerifiedAt: preserveVerification ? previousMeta.lastVerifiedAt : undefined,
      availableModels: verifiedModels.length > 0 ? verifiedModels : (preserveVerification ? previousMeta.availableModels : undefined),
    },
  });

  return {
    baseUrl,
    model: config.model,
    enabled: config.enabled,
    hasApiKey: secretValue !== NO_API_KEY_SENTINEL,
    lastVerifiedAt: preserveVerification && previousMeta.lastVerifiedAt ? String(previousMeta.lastVerifiedAt) : undefined,
    availableModels: verifiedModels.length > 0
      ? verifiedModels
      : (preserveVerification && Array.isArray(previousMeta.availableModels) ? previousMeta.availableModels.map(String) : undefined),
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
  const requestedUrl = baseUrl?.trim() || getLLMConfig()?.baseUrl;
  // apiKey 可选：本地 Ollama 模型不需要 key
  // 如果调用方没传 apiKey，则尝试从已保存配置读取（可能是云端 API）；本地模型保存时 apiKey 为空字符串
  const suppliedApiKey = apiKey?.trim();

  if (!requestedUrl) {
    return { ok: false, models: [], error: 'baseUrl 未配置' };
  }

  const url = normalizeBaseUrl(requestedUrl);
  const key = suppliedApiKey || getSavedApiKeyForBaseUrl(url) || '';
  const modelsUrl = url + LLM_PROVIDER_DEFAULTS.modelsEndpoint;
  const start = Date.now();

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), LLM_PROVIDER_DEFAULTS.timeoutMs);

  try {
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
    // 与 chatWithLLM 保持一致：catch 中也必须清理 timeout，避免定时器泄漏阻止进程退出
    clearTimeout(timeout);
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
  setToolSecret({
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
    hasApiKey: Boolean(existing.value && existing.value !== NO_API_KEY_SENTINEL),
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
  const timeoutMs = request.timeoutMs ?? (request.maxTokens ? 60000 : LLM_PROVIDER_DEFAULTS.timeoutMs);
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (apiKey) {
      headers.Authorization = `Bearer ${apiKey}`;
    }
    const buildBody = (temperature: number) => JSON.stringify({
        model: config.model,
        messages: [
          { role: 'system', content: request.systemPrompt },
          { role: 'user', content: request.userMessage },
        ],
        temperature,
        max_tokens: request.maxTokens ?? 2000,
        stream: false,
      });
    const requestedTemperature = request.temperature ?? 0.1;

    const maxAttempts = 2;
    let lastError: Error | null = null;

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      try {
        let resp = await fetch(chatUrl, {
          method: 'POST',
          headers,
          body: buildBody(requestedTemperature),
          signal: controller.signal,
        });

        if (!resp.ok) {
          const text = await resp.text().catch(() => '');
          // 部分 OpenAI 兼容端点（如某些 Coding 模型）只允许 temperature=1。
          // 仅在服务端明确返回这一限制时重试一次，不掩盖其他 400 配置错误。
          if (resp.status === 400 && requestedTemperature !== 1 && /invalid temperature[\s\S]*only\s+1\s+is\s+allowed/i.test(text)) {
            resp = await fetch(chatUrl, {
              method: 'POST',
              headers,
              body: buildBody(1),
              signal: controller.signal,
            });
          } else if (resp.status >= 500 && attempt < maxAttempts) {
            // 5xx 服务端错误：可重试
            lastError = new Error(`LLM server error: ${resp.status}`);
            await new Promise(r => setTimeout(r, 2000 * attempt));
            continue;
          } else {
            clearTimeout(timeout);
            throw new Error(`LLM 调用失败 HTTP ${resp.status}: ${text.slice(0, 300) || resp.statusText}`);
          }
        }
        if (!resp.ok) {
          const text = await resp.text().catch(() => '');
          clearTimeout(timeout);
          throw new Error(`LLM 调用失败 HTTP ${resp.status}: ${text.slice(0, 300) || resp.statusText}`);
        }

        const data = await resp.json() as {
          choices?: Array<{ message?: { content?: string } }>;
          model?: string;
          usage?: { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number };
        };
        // fetch() 在收到响应头后就会完成；必须等正文完整读取后再取消超时，
        // 否则分块响应可能让界面无限等待。
        clearTimeout(timeout);

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
        // 超时/中止（AbortSignal 触发）不属于可重试的网络错误：重试会远超调用方
        // 设定的 timeoutMs，造成界面长时间假死。直接上抛由外层转换为超时错误。
        if (controller.signal.aborted || (err instanceof Error && /abort|timeout/i.test(err.message))) {
          clearTimeout(timeout);
          throw err;
        }
        // 网络错误（fetch 抛异常）：可重试
        if (attempt < maxAttempts && !(err instanceof Error && err.message.startsWith('LLM 调用失败'))) {
          lastError = err as Error;
          await new Promise(r => setTimeout(r, 2000 * attempt));
          continue;
        }
        throw err;
      }
    }

    throw lastError || new Error('LLM call failed after retries');
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
      hasApiKey: typeof meta.hasApiKey === 'boolean' ? meta.hasApiKey : undefined,
      lastVerifiedAt: meta.lastVerifiedAt ? String(meta.lastVerifiedAt) : undefined,
      availableModels: Array.isArray(meta.availableModels) ? meta.availableModels.map(String) : undefined,
    } as LLMProviderConfig;
  });
}
