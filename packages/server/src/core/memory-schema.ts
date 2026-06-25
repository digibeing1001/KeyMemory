import type { CreateMemoryInput, Layer, Memory, MemoryKind, UpdateMemoryInput } from '@keymemory/shared';
import { isSpecificProjectName } from '@keymemory/shared';
import type { PrivacyFinding } from './privacy.js';
import { privacyMetadata, redactSensitiveText, redactSensitiveValue } from './privacy.js';

const LONG_KEYWORDS = /preference|rule|principle|decision|project|architecture|repo|framework|偏好|习惯|风格|原则|规则|决定|结论|取舍|架构|方法论|框架|理论|约束|边界|必须|禁止/i;
const SHORT_KEYWORDS = /todo|today|tomorrow|temporary|pending|待办|任务|计划|截止|临时|本周|本周内|今天|明天|近期/i;
const ENTITY_KEYWORDS = /person|entity|人物|人员|同事|客户|团队|负责人|工具|产品/i;

/**
 * 推断记忆层级。规则：
 *  - 显式 metadata.importance: high→long, low→short
 *  - metadata.category: preference/decision→long; person/entity→entity; task/todo→short
 *  - 实体关键词命中→entity
 *  - 长期价值关键词（偏好/规则/原则/决定/架构/方法论）→long
 *  - 临时关键词（待办/今天/明天/本周/临时）→short
 *  - 兜底→short（不再用"长度>200→long"误投长内容到长期层）
 * 注：长度不再参与推断，避免长正文一律被划入长期层。
 */
export function inferMemoryLayer(title: string, content: string, metadata?: Record<string, unknown>): Layer {
  const text = `${title} ${content}`.toLowerCase();
  const importance = metadata?.importance as string | undefined;
  if (importance === 'high') return 'long';
  if (importance === 'low') return 'short';

  const category = metadata?.category as string | undefined;
  if (category === 'preference' || category === 'decision') return 'long';
  if (category === 'person' || category === 'entity') return 'entity';
  if (category === 'task' || category === 'todo') return 'short';

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

function addUnique(values: string[], value: string): void {
  const key = value.toLowerCase();
  if (!values.some(v => v.toLowerCase() === key)) values.push(value);
}

export function normalizeMemoryInput(input: CreateMemoryInput): CreateMemoryInput {
  const titleResult = redactSensitiveText(input.title);
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
  const tags = [...(input.tags ?? [])];
  addUnique(tags, `kind:${kind}`);
  if (inferredProjectPath) {
    addUnique(tags, inferredProjectPath);
    addUnique(tags, `project:${inferredProjectPath}`);
  }
  addUnique(tags, input.projectId || inferredProjectPath ? 'scope:project' : 'scope:global');
  if (privacy) addUnique(tags, 'sensitivity:redacted');

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
    const result = redactSensitiveText(input.title);
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

  const privacy = privacyMetadata(findings);
  if (privacy) {
    const tags = [...(input.tags ?? existing.tags ?? [])];
    addUnique(tags, 'sensitivity:redacted');
    output.tags = tags;
    output.metadata = {
      ...(existing.metadata ?? {}),
      ...(output.metadata ?? {}),
      privacy,
    };
  }

  return output;
}
