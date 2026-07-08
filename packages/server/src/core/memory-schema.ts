import type { CreateMemoryInput, Layer, Memory, MemoryKind, SelfCheckResult, UpdateMemoryInput } from '@keymemory/shared';
import { isSpecificProjectName } from '@keymemory/shared';
import type { PrivacyFinding } from './privacy.js';
import { privacyMetadata, redactSensitiveText, redactSensitiveValue } from './privacy.js';

const LONG_KEYWORDS = /preference|rule|principle|decision|project|architecture|repo|framework|偏好|习惯|风格|原则|规则|决定|结论|取舍|架构|方法论|框架|理论|约束|边界|必须|禁止/i;
const SHORT_KEYWORDS = /todo|today|tomorrow|temporary|pending|待办|任务|计划|截止|临时|本周|本周内|今天|明天|近期/i;
const ENTITY_KEYWORDS = /person|entity|人物|人员|同事|客户|团队|负责人|工具|产品/i;

// 内容类型信号（原 auto.ts detectContentType，统一到此处避免两处维护）
const PROJECT_SIGNALS = /(?:项目|周会|会议纪要|决策记录|里程碑|roadmap|版本发布|上线|评审|复盘|冲刺|迭代|sprint|milestone|release|launch)/i;
const ENTITY_SIGNALS = /(?:职位|联系方式|电话|邮箱|偏好|风格|档案|基本信息|技术特长|工作风格|沟通建议|协作)/i;
const KNOWLEDGE_SIGNALS = /(?:方法论|最佳实践|教程|指南|框架|原理|理论|体系|原则|规范|checklist|playbook|howto|how-to)/i;
const TASK_SIGNALS = /(?:待办|本周|今天|明天|后天|截止日期|截止|安排|计划|task|todo|完成|推进|跟进|落实|执行)/i;
const IDEA_SIGNALS = /(?:灵感|想法|想到|如果|试试|也许|假设|猜想|突发奇想|灵光一闪)/i;
const PROJECT_MARKER = /\[\[([^\]]+)\]\]/;

interface ContentSignals {
  isProject: boolean;
  isEntity: boolean;
  isKnowledge: boolean;
  isTask: boolean;
  isIdea: boolean;
}

function detectContentSignals(content: string): ContentSignals {
  const text = content.toLowerCase();
  return {
    isProject: PROJECT_SIGNALS.test(text),
    isEntity: ENTITY_SIGNALS.test(text),
    isKnowledge: KNOWLEDGE_SIGNALS.test(text),
    isTask: TASK_SIGNALS.test(text),
    isIdea: IDEA_SIGNALS.test(text),
  };
}

/**
 * 推断记忆层级（统一入口）。
 *
 * 合并自原 inferMemoryLayer（关键词驱动）和 auto.ts suggestLayer（评分驱动）。
 * 历史问题：两条路径规则不一致——REST 路径只用关键词，MCP/autoRemember 路径只用评分，
 * 导致相同内容因入口不同被分到不同层。
 *
 * 统一后规则优先级：
 * 1. 显式 metadata（importance/category）——最强信号，所有路径共享
 * 2. 实体内容信号（职位/联系方式/档案等）→ entity
 * 3a. 若提供 evaluation（autoRemember 路径）：
 *     - 灵感 + 低分 → flash
 *     - 项目产出 + 中等分 → long
 *     - 知识特征 + 中等分 → long
 *     - 任务特征 → short
 *     - 评分驱动 fallback
 * 3b. 若无 evaluation（REST 路径）：跳过评分逻辑
 * 4. 关键词规则（偏好/规则/原则 → long；待办/今天 → short）
 * 5. 兜底 → short
 *
 * @param evaluation 可选的 SelfCheck 评分。提供时启用 flash 层和评分驱动逻辑。
 */
export function inferMemoryLayer(
  title: string,
  content: string,
  metadata?: Record<string, unknown>,
  evaluation?: SelfCheckResult,
): Layer {
  const text = `${title} ${content}`.toLowerCase();

  // 1. 显式 metadata 优先（最强信号）
  const importance = metadata?.importance as string | undefined;
  if (importance === 'high') return 'long';
  if (importance === 'low') return 'short';

  const category = metadata?.category as string | undefined;
  if (category === 'preference' || category === 'decision') return 'long';
  if (category === 'person' || category === 'entity') return 'entity';
  if (category === 'task' || category === 'todo') return 'short';

  // 2. 内容类型信号（实体层最具体，优先判定）
  const signals = detectContentSignals(content);
  if (signals.isEntity) return 'entity';

  // 3. 评分驱动逻辑（仅 autoRemember 路径提供 evaluation 时生效）
  if (evaluation) {
    // 闪念：灵感特征 + 评分明显低。flash 层门槛收紧，避免中性内容被衰减删除。
    if (signals.isIdea && evaluation.total < 0.5) return 'flash';
    if (evaluation.total < 0.35) return 'flash';

    // 长期记忆：项目产出 + 显式 [[项目]] 标记 + 中等以上评分
    if (signals.isProject && PROJECT_MARKER.test(content) && evaluation.total >= 0.6) return 'long';

    // 长期知识：知识特征明显且评分中等以上
    if (signals.isKnowledge && evaluation.total >= 0.65) return 'long';

    // 短期任务
    if (signals.isTask) return 'short';

    // 评分驱动 fallback
    if (evaluation.total >= 0.75) return 'long';
    if (evaluation.total >= 0.4) return 'short';
    return 'flash';
  }

  // 4. 关键词规则（无评分时使用）
  if (ENTITY_KEYWORDS.test(text)) return 'entity';
  if (LONG_KEYWORDS.test(text)) return 'long';
  if (SHORT_KEYWORDS.test(text)) return 'short';
  return 'short';
}

const KIND_KEYWORDS: { kind: MemoryKind; patterns: RegExp[] }[] = [
  { kind: 'preference', patterns: [/偏好|喜欢|不喜欢|习惯|风格|prefer|preference|habit|style/i] },
  { kind: 'decision', patterns: [/决定|结论|取舍|选择|因为|所以|decision|decided|conclusion|tradeoff/i] },
  { kind: 'task', patterns: [/待办|任务|计划|截止|完成|推进|todo|task|follow[- ]?up|deadline/i] },
  { kind: 'procedure', patterns: [/流程|步骤|命令|配置|脚本|workflow|procedure|command|setup|config/i] },
  { kind: 'constraint', patterns: [/必须|不能|约束|规则|边界|禁止|must|cannot|rule|constraint|required/i] },
  { kind: 'relationship', patterns: [/关系|同事|客户|团队|负责人|partner|customer|teammate|owner/i] },
  { kind: 'event', patterns: [/会议|复盘|上线|发布|事故|里程碑|meeting|launch|release|incident|milestone/i] },
  { kind: 'concept', patterns: [/概念|原则|方法论|框架|理论|学习|concept|principle|framework|theory/i] },
  { kind: 'project_fact', patterns: [/项目|版本|需求|PRD|roadmap|sprint|project|requirement/i] },
];

export function inferMemoryKind(content: string, title = ''): MemoryKind {
  const text = `${title}\n${content}`;
  for (const item of KIND_KEYWORDS) {
    if (item.patterns.some(pattern => pattern.test(text))) return item.kind;
  }
  if (/\[\[[^\]]+\]\]/.test(text)) return 'project_fact';
  return 'raw_note';
}

export function extractProjectPathFromContent(content: string): string | undefined {
  const match = content.match(/\[\[([^\]]+)\]\]/);
  if (match?.[1]?.trim()) return normalizeInferredProjectPath(match[1]);
  return inferProjectPathFromContent(content);
}

function normalizeInferredProjectPath(value: string): string | undefined {
  const cleaned = value
    .replace(/^[\s"'「『《【]+|[\s"'」』》】。；;，,]+$/g, '')
    .replace(/\s*(?:中|里|下|内|里面|之中)$/u, '')
    .replace(/\s*(?:项目|工程|产品|仓库|repo|project)$/iu, '')
    .replace(/\s*(?:\/|\\|>|::|->|→|›|＞|／)\s*/gu, '/')
    .trim();
  if (cleaned.length < 2 || cleaned.length > 120) return undefined;
  if (/^(这个|那个|当前|本次|新的|一个|项目|工程|产品|仓库)$/u.test(cleaned)) return undefined;
  const parts = cleaned.split('/').map(part => part.trim()).filter(Boolean);
  if (parts.length === 0 || parts.some(part => part.length > 50)) return undefined;
  // 根级项目（单段）必须是具体名字，过滤 dev/test/notes 等无指向性通用名；
  // 子项目（多段，有父级上下文）允许通用名作叶子，如 Legacy/Default、HTTP/MCP/Other
  if (parts.length === 1 && !isSpecificProjectName(parts[0])) return undefined;
  return parts.join('/');
}

export function inferProjectPathFromContent(content: string, title = ''): string | undefined {
  const text = `${title}\n${content}`;
  const patterns: RegExp[] = [
    /(?:projectPath|project_path|project\s*path)\s*[:=：]\s*([^\n\r。；;，,]+)/i,
    /(?:项目路径|项目目录|项目名|项目名称|所属项目|归属项目|当前项目|项目|工程|产品|仓库|workspace|repo|project)\s*[:=：]\s*([^\n\r。；;，,]+)/i,
    /(?:项目|工程|产品|仓库|workspace|repo|project)[「『《【"']([^」』》】"']{2,120})[」』》】"']/i,
    /(?:所属|归属|落到|归到|放到|记录到)\s*(?:项目|工程|产品|仓库|workspace|repo|project)?\s*[「『《【"']([^」』》】"']{2,120})[」』》】"']/i,
  ];
  for (const pattern of patterns) {
    const match = text.match(pattern);
    const normalized = match?.[1] ? normalizeInferredProjectPath(match[1]) : undefined;
    if (normalized) return normalized;
  }
  return undefined;
}

/**
 * 标签清洗规则。
 *
 * 设计原则：标签是 agent 检索记忆的"快捷命中词"，必须简短、有意义、可聚类。
 * 用户反馈：标签云里充斥 scope:global、project:Migrated/Hermes、~/dev/xxx 路径、
 * 日期版本号等无意义标签，把整个标签体系搞得乱糟糟。
 *
 * 过滤规则：
 *  - 长度 2-30 字符：太短无意义，太长不是标签而是句子
 *  - 禁止路径分隔符 / \ ~：路径不是标签
 *  - 禁止换行符：多行文本不是标签
 *  - 禁止命名空间前缀 type:/source:/kind:/scope:/domain:/project: 等
 *  - 禁止纯标点/纯数字
 *  - 禁止日期版本号（v2026-06-05、verified-2026-06-05）
 *  - 禁止流程状态（step-2-done、8-of-8-pass、cli-stage）
 *  - 禁止含括号的长描述
 */
const TAG_NAMESPACE_PREFIXES = /^(type|source|kind|scope|domain|project|sensitivity|layer|status):/i;
const TAG_DATE_VERSION = /^v?\d{4}-\d{2}-\d{2}|^verified-\d{4}|^fixed-\d{4}|^global-rules-\d{4}/i;
const TAG_PROCESS_STATE = /^(step-\d|cli-stage|final-result|pull-after-build|smoke-verification|\d+-of-\d+-pass)/i;

export function isMeaningfulTag(tag: string): boolean {
  const trimmed = tag.trim();
  if (trimmed.length < 2 || trimmed.length > 30) return false;
  if (/^sensitivity:redacted$/i.test(trimmed)) return true;
  if (TAG_NAMESPACE_PREFIXES.test(trimmed)) return false;
  if (TAG_DATE_VERSION.test(trimmed)) return false;
  if (TAG_PROCESS_STATE.test(trimmed)) return false;
  if (/[\/\\~]/.test(trimmed)) return false;
  if (/[\r\n]/.test(trimmed)) return false;
  if (/^[\d\W_]+$/.test(trimmed)) return false;
  if (trimmed.includes('（') || trimmed.includes('(')) return false;
  return true;
}

export function cleanTag(tag: string): string {
  return tag.trim().replace(/^["'""''「『]+|["'""''」』]+$/g, '');
}

/**
 * 规范化标签数组：清洗 + 去重 + 过滤无意义标签。
 *
 * 在 normalizeMemoryInput / normalizeMemoryUpdate 中调用，
 * 确保所有写入路径（MCP/REST/CLI/migration/adapter）的标签都经过清洗。
 */
export function normalizeTags(tags: string[] | undefined): string[] {
  if (!tags || tags.length === 0) return [];
  const seen = new Set<string>();
  const result: string[] = [];
  for (const tag of tags) {
    const cleaned = cleanTag(tag);
    const key = cleaned.toLowerCase();
    if (!seen.has(key) && isMeaningfulTag(cleaned)) {
      seen.add(key);
      result.push(cleaned);
    }
  }
  return result.slice(0, 8); // 最多 8 个标签，避免标签碎片化
}

/**
 * 标题前缀清洗。
 *
 * 用户反馈：agent 写入时喜欢加 "闪念:" "灵感:" "想法:" 等标签前缀，
 * 但用户希望标题直接写内容，不要这些无意义前缀。
 *
 * 处理模式（循环剥离，最多 3 层）：
 *  - [闪念] xxx   → xxx
 *  - 闪念: xxx    → xxx
 *  - 闪念：xxx    → xxx
 *
 * 关键词集合：闪念、灵感、想法、思考、洞察、感悟、心得、备忘、笔记、记录、参考、
 *           idea、thought、note、flash
 *
 * 设计权衡：
 *  - 只处理 "关键词 + 分隔符（冒号/中文冒号/方括号）" 形式
 *  - 不剥离 "闪念 xxx"（空格分隔）以避免误伤 "闪念机制" 等正常短语
 *  - 不剥离 "闪念来源" / "灵感库" 等无分隔符的合成词
 *  - 循环剥离以应对 "闪念: 灵感: xxx" 这种叠加前缀
 */
const TITLE_PREFIX_KEYWORDS = [
  '闪念', '灵感', '想法', '思考', '洞察', '感悟', '心得', '备忘', '笔记', '记录', '参考',
  'idea', 'thought', 'note', 'flash',
];
const TITLE_PREFIX_PATTERN = new RegExp(
  '^\\s*(?:' +
    '\\[(' + TITLE_PREFIX_KEYWORDS.join('|') + ')\\]\\s*' +      // [闪念] xxx
    '|' +
    '(' + TITLE_PREFIX_KEYWORDS.join('|') + ')\\s*[:：]\\s*' +   // 闪念: xxx / 闪念：xxx
  ')',
  'iu'
);

export function stripTitlePrefix(title: string): string {
  let stripped = title;
  for (let i = 0; i < 3; i++) {
    const next = stripped.replace(TITLE_PREFIX_PATTERN, '');
    if (next === stripped) break;
    stripped = next;
  }
  return stripped.trimStart();
}

export function normalizeMemoryInput(input: CreateMemoryInput): CreateMemoryInput {
  const titleResult = redactSensitiveText(stripTitlePrefix(input.title));
  const contentResult = redactSensitiveText(input.content);
  const inferredProjectPath = input.projectPath ?? inferProjectPathFromContent(contentResult.text, titleResult.text);
  const metadataFindings: PrivacyFinding[] = [];
  const redactedMetadata = input.metadata
    ? redactSensitiveValue(input.metadata, metadataFindings) as Record<string, unknown>
    : undefined;
  const privacy = privacyMetadata([...titleResult.findings, ...contentResult.findings, ...metadataFindings]);
  const kind = inferMemoryKind(contentResult.text, titleResult.text);
  // 未显式指定 layer 时按内容/元数据推断，避免上游一律传 long
  const layer = input.layer ?? inferMemoryLayer(titleResult.text, contentResult.text, redactedMetadata ?? input.metadata);
  // Keep ordinary schema fields out of tags, but add the redaction tag when
  // sensitive material was actually detected so search, health checks, and UI
  // review can find privacy-relevant memories without parsing metadata.
  const tags = normalizeTags([...(input.tags ?? []), ...(privacy ? ['sensitivity:redacted'] : [])]);

  const metadata = {
    schemaVersion: 2,
    memoryKind: kind,
    validFrom: new Date().toISOString(),
    evidence: {
      source: input.source ?? 'manual',
      sourceId: input.sourceId,
    },
    ...(inferredProjectPath && !input.projectPath ? { projectRouting: { inferredPath: inferredProjectPath, method: 'content-pattern' } } : {}),
    ...(redactedMetadata ?? {}),
    ...(privacy ? { privacy } : {}),
  };

  return { ...input, layer, projectPath: input.projectPath ?? inferredProjectPath, title: titleResult.text, content: contentResult.text, tags, metadata };
}

export function normalizeMemoryUpdate(input: UpdateMemoryInput, existing: Memory): UpdateMemoryInput {
  const findings: PrivacyFinding[] = [];
  const output: UpdateMemoryInput = { ...input };

  if (input.title !== undefined) {
    const result = redactSensitiveText(stripTitlePrefix(input.title));
    output.title = result.text;
    findings.push(...result.findings);
  }
  if (input.content !== undefined) {
    const result = redactSensitiveText(input.content);
    output.content = result.text;
    findings.push(...result.findings);
  }
  if (input.metadata !== undefined) {
    output.metadata = redactSensitiveValue(input.metadata, findings) as Record<string, unknown>;
  }

  // 标签清洗：对传入的 tags 做规范化（过滤命名空间/路径/超长/日期版本等无意义标签）
  if (input.tags !== undefined) {
    output.tags = normalizeTags(input.tags);
  }

  const privacy = privacyMetadata(findings);
  if (privacy) {
    output.metadata = {
      ...(existing.metadata ?? {}),
      ...(output.metadata ?? {}),
      privacy,
    };
  }

  return output;
}
