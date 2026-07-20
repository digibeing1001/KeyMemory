import { v4 as uuid } from 'uuid';
import type { Entity, EntityType, Relation } from '@keymemory/shared';
import { getDatabase } from '../db/sqlite.js';
import { isEmbeddingAvailable, cosineSimilarity } from '../embed/onnx.js';
import { getCachedEmbedding } from '../core/embedding-cache.js';

interface ExtractedEntity {
  name: string;
  type: EntityType;
  confidence: number;
}

const ENTITY_PATTERNS = [
  { regex: /@([\p{L}\p{N}_]+)/gu, type: 'person' as EntityType, confidence: 0.95 },
  { regex: /#([\p{L}\p{N}_]+)/gu, type: 'concept' as EntityType, confidence: 0.9 },
];

const PROJECT_PATTERN = /\[\[([^\]]+)\]\]/g;

/**
 * 记忆关系类型（含演化关系）
 *
 * 基础关系（Phase 1-5 已有，规则驱动）：
 * - part_of: 部分关系（记忆 A 是 B 的一部分）
 * - derived_from: 派生关系（A 从 B 派生而来）
 * - relates_to: 关联关系（A 与 B 相关，最宽泛）
 * - supersedes: 取代关系（A 取代了 B）
 * - references: 引用关系（A 引用了 B）
 * - contradicts: 矛盾关系（A 与 B 在同一事项上存在相反表述，由冲突检测自动建立）
 *
 * 演化关系（LLM 推理驱动，四问范式）：
 * - extends: A 延伸了 B（A 是 B 的自然下一步/具体化）
 * - reverses: A 反转了 B（A 推翻/否定了 B）
 * - reinforces: A 补强了 B（A 强化/佐证了 B）
 * - bridges: A 桥接了 B 与某条 C（A 连接了两个本不相关的记忆）
 *
 * 反向关系（自动维护，不需要 LLM 显式判定）：
 * - extended_by: 被...延伸
 * - reversed_by: 被...反转
 * - reinforced_by: 被...补强
 * - bridges_with: 与...桥接
 *
 * 双向回填规则：建立 A extends B 时，自动建立 B extended_by A。
 */
export const MEMORY_RELATION_TYPES = [
  // 基础关系
  'part_of', 'derived_from', 'relates_to', 'supersedes', 'references', 'contradicts',
  // 演化关系（正向，LLM 判定）
  'extends', 'reverses', 'reinforces', 'bridges',
  // 演化关系（反向，自动回填）
  'extended_by', 'reversed_by', 'reinforced_by', 'bridges_with',
] as const;

/** 演化关系的正向→反向映射，用于双向回填 */
export const EVOLUTION_RELATION_PAIRS: Record<string, string> = {
  extends: 'extended_by',
  reverses: 'reversed_by',
  reinforces: 'reinforced_by',
  bridges: 'bridges_with',
};

const ORG_SUFFIXES = ['公司', '集团', '有限公司', '有限责任公司', '股份公司', '工作室', '实验室', '研究所', '研究院', '协会', '联盟', '基金会', '银行', '医院', '大学', '学院', '学校'];
const ORG_SUFFIX_REGEX = new RegExp(`([\\u4e00-\\u9fa5]{2,8}(?:${ORG_SUFFIXES.join('|')}))`, 'g');

const ORG_PREFIXES = ['我们', '我的', '他们', '她的', '他的', '小', '大', '那个', '这个', '某', '一些', '几个', '所有', '整个', '自己', '对方', '其他', '任何', '每个', '各种', '各类'];
const ORG_FALSE_POSITIVES = ['小团队', '大团队', '我们团队', '他们团队', '你们团队', '自己团队', '小部门', '大部门', '我们部门', '某个部门', '整个团队', '整个部门', '小组织', '大组织', '个人开发者', '个人开发者或小团队', '来自个人开发者'];

const KNOWN_ORGS = ['腾讯', '阿里', '阿里巴巴', '字节跳动', '字节', '百度', '京东', '美团', '华为', '小米', '微软', '谷歌', '苹果', '亚马逊', 'Meta', 'OpenAI', 'Google', 'Microsoft', 'Apple', 'Amazon', 'Tesla', 'Nvidia', 'Intel', 'Samsung'];
const KNOWN_ORG_REGEX = new RegExp(`(${KNOWN_ORGS.join('|')})`, 'g');

const PERSON_TITLES = ['老师', '同学', '先生', '女士', '经理', '总监', '老板', '工程师', '设计师', '教授', '博士', '主任', '院长', '校长', 'CEO', 'CTO', 'CFO', 'COO', 'VP'];
const PERSON_VERBS = ['说', '觉得', '认为', '表示', '提到', '告诉', '建议', '推荐', '提醒', '指出', '强调', '发现', '提出', '解释', '确认', '否认', '同意', '反对'];

const PERSON_FALSE_POSITIVES = ['问题', '事情', '东西', '地方', '方面', '时候', '方法', '原因', '结果', '情况', '部分', '内容', '关系', '条件', '特点', '功能', '系统', '项目', '产品', '用户', '数据', '信息', '技术', '代码', '文件', '版本', '模块', '组件', '接口', '服务', '平台', '框架', '工具', '资源', '环境', '配置', '设置', '操作', '过程', '步骤', '方案', '策略', '规则', '模式', '结构', '类型', '状态', '属性', '参数', '变量', '对象', '实例', '元素', '节点', '标签', '分类', '目录', '路径', '链接', '页面', '视图', '模型', '视图', '控制', '逻辑', '算法', '流程', '事件', '请求', '响应', '错误', '异常', '警告', '通知', '消息', '记录', '日志', '报告', '统计', '分析', '测试', '调试', '部署', '发布', '更新', '升级', '迁移', '重构', '优化', '修复', '合并', '删除', '创建', '添加', '修改', '查询', '搜索', '过滤', '排序', '分组', '计算', '转换', '处理', '生成', '解析', '验证', '授权', '认证', '加密', '解密', '压缩', '解压', '编码', '解码', '序列化', '反序列化'];

const LOCATION_PATTERNS = [
  { regex: /([\u4e00-\u9fa5]{2,6}(?:省|市|区|县|镇|乡|村|街|路|巷|弄|号|楼|层|室))/g, confidence: 0.85 },
  { regex: /((?:北京|上海|广州|深圳|杭州|成都|武汉|南京|西安|重庆|苏州|天津|长沙|郑州|东莞|青岛|沈阳|宁波|昆明|厦门|福州|无锡|合肥|大连|珠海|佛山|济南|哈尔滨|长春|太原|贵阳|南宁|南昌|石家庄|兰州|海口|三亚|香港|澳门|台北))/g, confidence: 0.9 },
];

const TIME_PATTERNS = [
  { regex: /(\d{4}年\d{1,2}月\d{1,2}日)/g, confidence: 0.95 },
  { regex: /(\d{4}年\d{1,2}月)/g, confidence: 0.9 },
  { regex: /(\d{4}-\d{2}-\d{2})/g, confidence: 0.95 },
  { regex: /((?:今天|昨天|前天|明天|后天|上周|下周|本周|上个月|下个月|今年|去年|前年|明年))/g, confidence: 0.8 },
  { regex: /((?:Q[1-4]|第[一二三四]季度)(?:\s*\d{4})?)/g, confidence: 0.85 },
];

const EVENT_PATTERNS = [
  { regex: /([\u4e00-\u9fa5]{2,8}(?:会议|大会|峰会|论坛|展览|展会|活动|发布会|研讨会|培训|讲座|沙龙|比赛|竞赛|面试|评审|复盘|回顾|规划|冲刺|迭代|版本发布|上线|发布))/g, confidence: 0.7 },
];

const TECH_TERMS = [
  'React', 'Vue', 'Angular', 'Svelte', 'Next.js', 'Nuxt', 'Gatsby', 'Vite', 'Webpack', 'Tailwind', 'Sass', 'Less',
  'Node.js', 'Python', 'JavaScript', 'TypeScript', 'Go', 'Rust', 'Java', 'Kotlin', 'Swift', 'C\\+\\+', 'C#', 'Ruby', 'PHP', 'Dart', 'Lua', 'R', 'Scala', 'Elixir', 'Haskell',
  'PostgreSQL', 'MySQL', 'SQLite', 'MongoDB', 'Redis', 'Elasticsearch', 'Cassandra', 'CockroachDB', 'TiDB', 'ClickHouse',
  'Docker', 'Kubernetes', 'Terraform', 'AWS', 'Azure', 'GCP', 'GitHub', 'GitLab', 'Jenkins', 'CircleCI',
  'GraphQL', 'REST', 'gRPC', 'WebSocket', 'MQTT',
  'Linux', 'macOS', 'Windows', 'iOS', 'Android',
  'Nginx', 'Apache', 'Caddy',
  'Git', 'SVN', 'Mercurial',
  'Bun', 'Deno', 'pnpm', 'yarn', 'npm',
  'Electron', 'Tauri', 'Flutter', 'React Native', 'Unity', 'Unreal',
  'Claude', 'GPT', 'LLM', 'RAG', 'Fine-tuning', 'Embedding', 'Transformer',
  'SQLite', 'Supabase', 'Firebase', 'Prisma', 'Drizzle',
];
const TECH_REGEX = new RegExp(`(${TECH_TERMS.join('|')})`, 'g');

function isFalsePositive(match: string, type: EntityType, context: string): boolean {
  if (type === 'organization') {
    for (const fp of ORG_FALSE_POSITIVES) {
      if (match === fp || match.includes(fp)) return true;
    }
    for (const prefix of ORG_PREFIXES) {
      if (match.startsWith(prefix) && !KNOWN_ORGS.some(org => match.includes(org))) {
        const suffix = match.slice(prefix.length);
        if (ORG_SUFFIXES.some(s => suffix === s)) return true;
      }
    }
  }

  if (type === 'person') {
    for (const fp of PERSON_FALSE_POSITIVES) {
      if (match === fp) return true;
    }
  }

  if (type === 'event') {
    const eventFalsePositives = ['没有会议', '无会议', '取消会议', '不参加会议', '避免活动', '停止活动'];
    for (const fp of eventFalsePositives) {
      if (context.includes(fp)) return true;
    }
  }

  return false;
}

function getContext(content: string, index: number, windowSize: number = 20): string {
  const start = Math.max(0, index - windowSize);
  const end = Math.min(content.length, index + windowSize);
  return content.slice(start, end);
}

export function extractEntities(content: string): ExtractedEntity[] {
  const entities: ExtractedEntity[] = [];
  const seen = new Map<string, number>();

  function addEntity(name: string, type: EntityType, confidence: number, index: number = 0): void {
    const key = `${type}:${name}`;
    const existingConf = seen.get(key);
    if (existingConf !== undefined && existingConf >= confidence) return;

    if (isFalsePositive(name, type, getContext(content, index))) return;

    seen.set(key, confidence);
    const existingIdx = entities.findIndex(e => e.name === name && e.type === type);
    if (existingIdx >= 0) {
      entities[existingIdx].confidence = Math.max(entities[existingIdx].confidence, confidence);
    } else {
      entities.push({ name, type, confidence });
    }
  }

  for (const pattern of ENTITY_PATTERNS) {
    let match;
    while ((match = pattern.regex.exec(content)) !== null) {
      addEntity(match[1], pattern.type, pattern.confidence, match.index);
    }
  }

  let match;
  const personWithTitleRegex = new RegExp(`([\\u4e00-\\u9fa5]{2,4})(?:${PERSON_TITLES.join('|')})`, 'g');
  while ((match = personWithTitleRegex.exec(content)) !== null) {
    const name = match[1];
    if (!PERSON_FALSE_POSITIVES.includes(name) && name.length >= 2 && name.length <= 4) {
      addEntity(name, 'person', 0.85, match.index);
    }
  }

  const personWithVerbRegex = new RegExp(`(?:^|[^a-zA-Z\\u4e00-\\u9fa5])([\\u4e00-\\u9fa5]{2,3})(?:${PERSON_VERBS.join('|')})`, 'g');
  while ((match = personWithVerbRegex.exec(content)) !== null) {
    const name = match[1];
    if (!PERSON_FALSE_POSITIVES.includes(name) && name.length >= 2 && name.length <= 3) {
      addEntity(name, 'person', 0.6, match.index);
    }
  }

  while ((match = KNOWN_ORG_REGEX.exec(content)) !== null) {
    addEntity(match[1], 'organization', 0.95, match.index);
  }

  while ((match = ORG_SUFFIX_REGEX.exec(content)) !== null) {
    const name = match[1];
    addEntity(name, 'organization', 0.8, match.index);
  }

  for (const locPattern of LOCATION_PATTERNS) {
    while ((match = locPattern.regex.exec(content)) !== null) {
      addEntity(match[1], 'location', locPattern.confidence, match.index);
    }
  }

  for (const timePattern of TIME_PATTERNS) {
    while ((match = timePattern.regex.exec(content)) !== null) {
      addEntity(match[1], 'time', timePattern.confidence, match.index);
    }
  }

  for (const evtPattern of EVENT_PATTERNS) {
    while ((match = evtPattern.regex.exec(content)) !== null) {
      addEntity(match[1], 'event', evtPattern.confidence, match.index);
    }
  }

  while ((match = TECH_REGEX.exec(content)) !== null) {
    addEntity(match[1], 'tool', 0.9, match.index);
  }

  const emailPattern = /[\w.+-]+@[\w-]+\.[\w.-]+/g;
  while ((match = emailPattern.exec(content)) !== null) {
    addEntity(match[0].toLowerCase(), 'tool', 0.95, match.index);
  }

  const urlPattern = /https?:\/\/[\w\-._~:/?#\[\]@!$&'()*+,;=%]+/g;
  while ((match = urlPattern.exec(content)) !== null) {
    try {
      const hostname = new URL(match[0]).hostname;
      addEntity(hostname, 'tool', 0.7, match.index);
    } catch (err) { console.error('[Entity] Failed to link memory entity:', (err as Error).message); }
  }

  return entities.filter(e => e.confidence >= 0.5);
}

export function extractProjects(content: string): string[] {
  const projects: string[] = [];
  let match;
  while ((match = PROJECT_PATTERN.exec(content)) !== null) {
    projects.push(match[1]);
  }
  return projects;
}

export function ensureEntity(name: string, type: EntityType): Entity {
  const db = getDatabase();
  const now = new Date().toISOString();

  // 1. 按 name 精确查找
  const existing = db.prepare(`SELECT * FROM entities WHERE name = ?`).get(name) as Record<string, unknown> | undefined;
  if (existing) {
    return rowToEntity(existing);
  }

  // 2. 按别名查找——这个名字可能是某个已有实体的别名。
  //    例如用户存记忆时用了"张三"，后来用"小张"提取出实体，
  //    如果"小张"已注册为"张三"的别名，就复用同一个实体，避免创建重复实体。
  const byAlias = db.prepare(`
    SELECT e.* FROM entities e
    JOIN entity_aliases ea ON ea.entity_id = e.id
    WHERE ea.alias = ?
  `).get(name) as Record<string, unknown> | undefined;
  if (byAlias) {
    return rowToEntity(byAlias);
  }

  // 3. 都没找到，创建新实体
  const id = uuid();
  db.prepare(`
    INSERT INTO entities (id, name, type, properties, created_at, updated_at)
    VALUES (?, ?, ?, NULL, ?, ?)
  `).run(id, name, type, now, now);

  return { id, name, type, createdAt: now, updatedAt: now };
}

export function linkMemoryEntity(memoryId: string, entityId: string, projectId?: string): void {
  const db = getDatabase();
  if (projectId) {
    db.prepare(`
      INSERT OR IGNORE INTO memory_entities (memory_id, entity_id, project_id) VALUES (?, ?, ?)
    `).run(memoryId, entityId, projectId);
  } else {
    // Fallback: try to get project_id from memory
    const mem = db.prepare('SELECT project_id FROM memories WHERE id = ?').get(memoryId) as { project_id: string } | undefined;
    db.prepare(`
      INSERT OR IGNORE INTO memory_entities (memory_id, entity_id, project_id) VALUES (?, ?, ?)
    `).run(memoryId, entityId, mem?.project_id ?? '');
  }
}

export function processContent(memoryId: string, content: string): { entities: Entity[]; projects: string[] } {
  const extractedEntities = extractEntities(content);
  const projects = extractProjects(content);
  const db = getDatabase();

  const entities: Entity[] = [];
  for (const ext of extractedEntities) {
    const entity = ensureEntity(ext.name, ext.type);
    linkMemoryEntity(memoryId, entity.id);
    entities.push(entity);
  }

  return { entities, projects };
}

export function createMemoryRelation(sourceId: string, targetId: string, relationType: string, strength = 1.0, reason?: string): Relation {
  if (!MEMORY_RELATION_TYPES.includes(relationType as typeof MEMORY_RELATION_TYPES[number])) {
    throw new Error(`Invalid relation type: ${relationType}. Must be one of: ${MEMORY_RELATION_TYPES.join(', ')}`);
  }
  if (sourceId === targetId) {
    throw new Error('Memory relation cannot point to itself');
  }
  if (!Number.isFinite(strength) || strength < 0 || strength > 1) {
    throw new Error('Memory relation strength must be a number between 0 and 1');
  }

  const db = getDatabase();
  const id = uuid();
  const now = new Date().toISOString();

  db.prepare(`
    INSERT INTO memory_relations (id, source_memory_id, target_memory_id, relation_type, strength, reason, created_at)
    VALUES (@id, @sourceId, @targetId, @relationType, @strength, @reason, @createdAt)
    ON CONFLICT(source_memory_id, target_memory_id, relation_type)
    DO UPDATE SET strength = excluded.strength, reason = excluded.reason, created_at = excluded.created_at
  `).run({
    id,
    sourceId,
    targetId,
    relationType,
    strength,
    reason: reason ?? null,
    createdAt: now,
  });

  // 演化关系双向回填：建立 A extends B 时，自动建立 B extended_by A
  // 反向关系不需要再次回填（避免无限递归）
  const reverseType = EVOLUTION_RELATION_PAIRS[relationType];
  if (reverseType) {
    const reverseId = uuid();
    db.prepare(`
      INSERT INTO memory_relations (id, source_memory_id, target_memory_id, relation_type, strength, reason, created_at)
      VALUES (@id, @sourceId, @targetId, @relationType, @strength, @reason, @createdAt)
      ON CONFLICT(source_memory_id, target_memory_id, relation_type)
      DO UPDATE SET strength = excluded.strength, reason = excluded.reason, created_at = excluded.created_at
    `).run({
      id: reverseId,
      sourceId: targetId,       // 反向：B → A
      targetId: sourceId,
      relationType: reverseType,
      strength,
      reason: reason ? `[反向回填] ${reason}` : '[反向回填]',
      createdAt: now,
    });
  }

  const row = db.prepare(`
    SELECT id, source_memory_id, target_memory_id, relation_type, strength, reason, created_at
    FROM memory_relations
    WHERE source_memory_id = ? AND target_memory_id = ? AND relation_type = ?
  `).get(sourceId, targetId, relationType) as {
    id: string;
    source_memory_id: string;
    target_memory_id: string;
    relation_type: string;
    strength: number;
    reason: string | null;
    created_at: string;
  };

  return {
    id: row.id,
    sourceId: row.source_memory_id,
    targetId: row.target_memory_id,
    relationType: row.relation_type,
    strength: row.strength,
    reason: row.reason ?? undefined,
    createdAt: row.created_at,
  };
}

export const createRelation = createMemoryRelation;

export function findRelatedMemories(memoryId: string, relationType?: string): { memoryId: string; title: string; layer: string; sourceId: string; targetId: string; direction: 'outgoing' | 'incoming'; relationType: string; strength: number; reason?: string }[] {
  const db = getDatabase();
  const conditions = ['(r.source_memory_id = @memoryId OR r.target_memory_id = @memoryId)'];
  const params: Record<string, unknown> = { memoryId };

  if (relationType) {
    if (!MEMORY_RELATION_TYPES.includes(relationType as typeof MEMORY_RELATION_TYPES[number])) {
      throw new Error(`Invalid relation type: ${relationType}. Must be one of: ${MEMORY_RELATION_TYPES.join(', ')}`);
    }
    conditions.push('r.relation_type = @relationType');
    params.relationType = relationType;
  }

  const rows = db.prepare(`
    SELECT r.source_memory_id, r.target_memory_id, r.relation_type, r.strength, r.reason,
           m.id as mid, m.title, m.layer
    FROM memory_relations r
    JOIN memories m
      ON m.id = CASE
        WHEN r.source_memory_id = @memoryId THEN r.target_memory_id
        ELSE r.source_memory_id
      END
    WHERE ${conditions.join(' AND ')}
      AND m.status != 'deleted'
    ORDER BY r.strength DESC, r.created_at DESC
  `).all(params) as { source_memory_id: string; target_memory_id: string; relation_type: string; strength: number; reason: string | null; mid: string; title: string; layer: string }[];

  return rows.map(r => ({
    memoryId: r.mid,
    title: r.title,
    layer: r.layer,
    sourceId: r.source_memory_id,
    targetId: r.target_memory_id,
    direction: r.source_memory_id === memoryId ? 'outgoing' as const : 'incoming' as const,
    relationType: r.relation_type,
    strength: r.strength,
    reason: r.reason ?? undefined,
  })).filter(r => r.memoryId);
}

/**
 * 自动建立记忆间的关联关系。
 *
 * 采用双路策略，取代旧的"标题词 LIKE 匹配"：
 * 1. **实体共现**：通过 memory_entities 关联表查找与当前记忆共享实体的其他活跃记忆。
 *    共享实体越多，关联越强。这是结构化信号，精确度高。
 * 2. **Embedding 语义相似度**：若 embedding 已就绪，与近期 200 条活跃记忆比对，
 *    对 cosine ≥ 0.75 的 top-5 建立 relates_to 关系。这是语义信号，覆盖实体未覆盖的情况。
 *
 * 设计决策：
 * - 函数为 async：调用方需保证 ensureEmbedding 已完成（rest.ts 用 .then 链，auto.ts 用 await）
 * - upsert 语义：strength 只增不减，避免重新关联时降级已有强关联
 * - 无 fallback 文本匹配：实体+embedding 已足够覆盖，无关联说明记忆确实独特
 * - 内部确保实体已链接：若通过未调 processContent 的路径创建，自动补链接
 *
 * 性能：
 * - 实体共现：单条 GROUP BY SQL，有索引 (memory_id, entity_id)
 * - Embedding：200 候选 × cosine(512维) ≈ 0.1ms，可忽略
 */
export async function autoAssociate(memoryId: string): Promise<void> {
  const db = getDatabase();

  // 读取记忆基本信息
  const mem = db.prepare('SELECT id, title, content, status FROM memories WHERE id = ?').get(memoryId) as { id: string; title: string; content: string; status: string } | undefined;
  if (!mem || mem.status !== 'active') return;

  // 1. 确保实体已链接（防御性：若调用方未走 processContent，此处补齐）
  const linkCount = db.prepare('SELECT COUNT(*) as n FROM memory_entities WHERE memory_id = ?').get(memoryId) as { n: number };
  if (linkCount.n === 0) {
    processContent(memoryId, mem.content);
  }

  // 2. 实体共现关联：共享实体的其他活跃记忆
  //    SQL 语义：me1 是当前记忆的实体链接，me2 是其他记忆对同一实体的链接
  //    COUNT(*) = 共享实体数。GROUP BY 后按共享数倒序取 top 10。
  const coOccurs = db.prepare(`
    SELECT me2.memory_id as id, COUNT(*) as shared
    FROM memory_entities me1
    JOIN memory_entities me2
      ON me1.entity_id = me2.entity_id
      AND me2.memory_id != me1.memory_id
    JOIN memories m ON m.id = me2.memory_id AND m.status = 'active'
    WHERE me1.memory_id = ?
    GROUP BY me2.memory_id
    ORDER BY shared DESC
    LIMIT 10
  `).all(memoryId) as { id: string; shared: number }[];

  for (const c of coOccurs) {
    // 1 共享实体 = 0.5，每多 1 个 +0.15，上限 0.95
    const strength = Math.min(0.5 + (c.shared - 1) * 0.15, 0.95);
    upsertRelation(memoryId, c.id, 'relates_to', strength, `auto-associate: ${c.shared} shared entities`);
  }

  // 3. Embedding 语义相似度关联
  //    只在 embedding 可用且当前记忆已嵌入时执行
  if (isEmbeddingAvailable()) {
    const sourceVec = getCachedEmbedding(memoryId);
    if (sourceVec) {
      // 取近期活跃记忆作候选（last_hit_at 优先，让近期命中的记忆优先参与关联）
      const candidates = db.prepare(`
        SELECT m.id
        FROM memories m
        INNER JOIN embeddings e ON e.memory_id = m.id
        WHERE m.status = 'active' AND m.id != ?
        ORDER BY m.last_hit_at DESC, m.updated_at DESC
        LIMIT 200
      `).all(memoryId) as { id: string }[];

      const scored: { id: string; sim: number }[] = [];
      for (const cand of candidates) {
        const vec = getCachedEmbedding(cand.id);
        if (!vec) continue;
        const sim = cosineSimilarity(sourceVec, vec);
        if (sim >= 0.75) scored.push({ id: cand.id, sim });
      }
      scored.sort((a, b) => b.sim - a.sim);

      for (const s of scored.slice(0, 5)) {
        // strength 直接用相似度，但封顶 0.95（保留空间给人工/强规则关联）
        upsertRelation(memoryId, s.id, 'relates_to', Math.min(s.sim, 0.95), `auto-associate: semantic ${s.sim.toFixed(2)}`);
      }
    }
  }
}

/**
 * Upsert 记忆关联，strength 只增不减。
 *
 * 与 createMemoryRelation 的区别：
 * - createMemoryRelation：覆盖式更新（excluded 直接覆盖），适合显式调用方明确意图
 * - upsertRelation：递增式更新（取 MAX），适合 autoAssociate 这种可能多次触发的场景
 *
 * 当新 strength > 旧 strength 时，同步更新 reason 和 created_at；
 * 否则保留旧值（避免无谓写入）。
 */
function upsertRelation(sourceId: string, targetId: string, relationType: typeof MEMORY_RELATION_TYPES[number], strength: number, reason: string): void {
  if (sourceId === targetId) return;
  if (!Number.isFinite(strength) || strength < 0 || strength > 1) return;

  const db = getDatabase();
  const id = uuid();
  const now = new Date().toISOString();

  db.prepare(`
    INSERT INTO memory_relations (id, source_memory_id, target_memory_id, relation_type, strength, reason, created_at)
    VALUES (@id, @sourceId, @targetId, @relationType, @strength, @reason, @createdAt)
    ON CONFLICT(source_memory_id, target_memory_id, relation_type)
    DO UPDATE SET
      strength = CASE
        WHEN excluded.strength > memory_relations.strength THEN excluded.strength
        ELSE memory_relations.strength
      END,
      reason = CASE
        WHEN excluded.strength > memory_relations.strength THEN excluded.reason
        ELSE memory_relations.reason
      END,
      created_at = CASE
        WHEN excluded.strength > memory_relations.strength THEN excluded.created_at
        ELSE memory_relations.created_at
      END
  `).run({
    id,
    sourceId,
    targetId,
    relationType,
    strength,
    reason,
    createdAt: now,
  });
}

export function listEntities(type?: EntityType): Entity[] {
  const db = getDatabase();
  const query = type 
    ? `SELECT * FROM entities WHERE type = ? ORDER BY name`
    : `SELECT * FROM entities ORDER BY name`;
  
  const rows = db.prepare(query).all(...(type ? [type] : [])) as Record<string, unknown>[];
  
  return rows.map(r => ({
    id: r.id as string,
    name: r.name as string,
    type: r.type as EntityType,
    properties: r.properties ? JSON.parse(r.properties as string) : undefined,
    createdAt: r.created_at as string,
    updatedAt: r.updated_at as string,
  }));
}

export function getMemoryEntities(memoryId: string): Entity[] {
  const db = getDatabase();
  
  const rows = db.prepare(`
    SELECT e.* FROM entities e
    JOIN memory_entities me ON e.id = me.entity_id
    WHERE me.memory_id = ?
    ORDER BY e.name
  `).all(memoryId) as Record<string, unknown>[];
  
  return rows.map(r => ({
    id: r.id as string,
    name: r.name as string,
    type: r.type as EntityType,
    properties: r.properties ? JSON.parse(r.properties as string) : undefined,
    createdAt: r.created_at as string,
    updatedAt: r.updated_at as string,
  }));
}

export function getEntityGraph(entityId: string): { entity: Entity; relations: Relation[]; connectedEntities: Entity[] } {
  const db = getDatabase();

  const entity = db.prepare(`SELECT * FROM entities WHERE id = ?`).get(entityId) as Record<string, unknown> | undefined;
  if (!entity) throw new Error('Entity not found');

  const relations = db.prepare(`
    SELECT * FROM relations WHERE source_id = ? OR target_id = ?
  `).all(entityId, entityId) as Record<string, unknown>[];

  const connectedIds = new Set<string>();
  for (const r of relations) {
    if (r.source_id !== entityId) connectedIds.add(r.source_id as string);
    if (r.target_id !== entityId) connectedIds.add(r.target_id as string);
  }

  const connectedEntities: Entity[] = [];
  for (const cid of connectedIds) {
    const e = db.prepare(`SELECT * FROM entities WHERE id = ?`).get(cid) as Record<string, unknown> | undefined;
    if (e) {
      connectedEntities.push(rowToEntity(e));
    }
  }

  return {
    entity: rowToEntity(entity),
    relations: relations.map(r => ({
      id: r.id as string,
      sourceId: r.source_id as string,
      targetId: r.target_id as string,
      relationType: r.relation_type as string,
      strength: r.strength as number,
      createdAt: r.created_at as string,
    })),
    connectedEntities,
  };
}

// ─────────────────────────────────────────────────────────────
// 别名管理 + 实体合并
// ─────────────────────────────────────────────────────────────

function rowToEntity(row: Record<string, unknown>): Entity {
  return {
    id: row.id as string,
    name: row.name as string,
    type: row.type as EntityType,
    properties: row.properties ? JSON.parse(row.properties as string) : undefined,
    createdAt: row.created_at as string,
    updatedAt: row.updated_at as string,
  };
}

export function addEntityAlias(entityId: string, alias: string): { id: string; entityId: string; alias: string } {
  const db = getDatabase();
  const entity = db.prepare(`SELECT id FROM entities WHERE id = ?`).get(entityId);
  if (!entity) throw new Error(`Entity not found: ${entityId}`);

  // 防止把别名注册到别的实体上——先检查这个别名是否已存在
  const existingAlias = db.prepare(`
    SELECT entity_id FROM entity_aliases WHERE alias = ?
  `).get(alias) as { entity_id: string } | undefined;
  if (existingAlias) {
    if (existingAlias.entity_id === entityId) return { id: '', entityId, alias }; // 已是本实体的别名，幂等返回
    throw new Error(`Alias "${alias}" is already registered to another entity`);
  }

  // 也不能与别的实体的 name 冲突
  const existingEntity = db.prepare(`SELECT id FROM entities WHERE name = ?`).get(alias) as { id: string } | undefined;
  if (existingEntity && existingEntity.id !== entityId) {
    throw new Error(`Alias "${alias}" conflicts with an existing entity name`);
  }

  const id = uuid();
  const now = new Date().toISOString();
  db.prepare(`INSERT INTO entity_aliases (id, entity_id, alias, created_at) VALUES (?, ?, ?, ?)`).run(id, entityId, alias, now);
  return { id, entityId, alias };
}

export function removeEntityAlias(entityId: string, alias: string): boolean {
  const db = getDatabase();
  const result = db.prepare(`DELETE FROM entity_aliases WHERE entity_id = ? AND alias = ?`).run(entityId, alias);
  return result.changes > 0;
}

export function listEntityAliases(entityId: string): { id: string; alias: string; createdAt: string }[] {
  const db = getDatabase();
  const rows = db.prepare(`SELECT id, alias, created_at FROM entity_aliases WHERE entity_id = ? ORDER BY created_at`).all(entityId) as Record<string, unknown>[];
  return rows.map(r => ({
    id: r.id as string,
    alias: r.alias as string,
    createdAt: r.created_at as string,
  }));
}

/**
 * 把 sourceEntity 合并到 targetEntity：
 * - sourceEntity 的所有 memory_entities 关联转移到 targetEntity（INSERT OR IGNORE 避免重复）
 * - sourceEntity 的所有别名转移到 targetEntity
 * - sourceEntity 的 name 作为 targetEntity 的别名
 * - sourceEntity 的所有 relations 转移到 targetEntity（source_id 或 target_id 指向 source 的改为指向 target）
 * - 删除 sourceEntity（ON DELETE CASCADE 会自动清理残留的 entity_aliases）
 *
 * 这是多 agent 场景下消除重复实体的关键操作：
 * 不同 agent 可能用不同名字创建同一实体（如 "React" vs "ReactJS"），
 * 合并后记忆关联和别名统一到同一实体，检索时不会漏掉。
 */
export function mergeEntities(sourceId: string, targetId: string): { merged: boolean; targetId: string; transferredAliases: number; transferredLinks: number; transferredRelations: number } {
  if (sourceId === targetId) throw new Error('Cannot merge an entity into itself');
  const db = getDatabase();

  const source = db.prepare(`SELECT * FROM entities WHERE id = ?`).get(sourceId) as Record<string, unknown> | undefined;
  const target = db.prepare(`SELECT * FROM entities WHERE id = ?`).get(targetId) as Record<string, unknown> | undefined;
  if (!source) throw new Error(`Source entity not found: ${sourceId}`);
  if (!target) throw new Error(`Target entity not found: ${targetId}`);

  return db.transaction(() => {
    // 1. 转移 memory_entities 关联
    const transferLinks = db.prepare(`
      INSERT OR IGNORE INTO memory_entities (memory_id, entity_id, project_id, context)
      SELECT memory_id, @targetId, project_id, context
      FROM memory_entities WHERE entity_id = @sourceId
    `);
    const linksResult = transferLinks.run({ sourceId, targetId });
    const transferredLinks = linksResult.changes;

    // 2. 转移别名（source 的别名 + source 的 name 作为 target 的别名）
    const transferAliases = db.prepare(`
      INSERT OR IGNORE INTO entity_aliases (id, entity_id, alias, created_at)
      SELECT id, @targetId, alias, created_at
      FROM entity_aliases WHERE entity_id = @sourceId
    `);
    transferAliases.run({ sourceId, targetId });

    // source 的 name 作为 target 的别名
    const sourceName = source.name as string;
    const targetName = target.name as string;
    if (sourceName !== targetName) {
      try {
        const aliasId = uuid();
        const now = new Date().toISOString();
        db.prepare(`INSERT OR IGNORE INTO entity_aliases (id, entity_id, alias, created_at) VALUES (?, ?, ?, ?)`).run(aliasId, targetId, sourceName, now);
      } catch { /* 如果别名冲突（比如 target 已有这个别名），忽略 */ }
    }

    // 统计转移后的别名数
    const aliasCount = db.prepare(`SELECT COUNT(*) as cnt FROM entity_aliases WHERE entity_id = ?`).get(targetId) as { cnt: number };

    // 3. 转移 relations（实体间关系，不是 memory_relations）
    // source_id 指向 source 的改为 target（但不能与 target 自连）
    const relAsSource = db.prepare(`
      UPDATE relations SET source_id = @targetId
      WHERE source_id = @sourceId AND target_id != @targetId
    `);
    const relAsTarget = db.prepare(`
      UPDATE relations SET target_id = @targetId
      WHERE target_id = @sourceId AND source_id != @targetId
    `);
    const relSourceResult = relAsSource.run({ sourceId, targetId });
    const relTargetResult = relAsTarget.run({ sourceId, targetId });
    const transferredRelations = relSourceResult.changes + relTargetResult.changes;

    // 删除 source 自连的 relations（source->target 或 target->source 会导致自连）
    db.prepare(`DELETE FROM relations WHERE source_id = @targetId AND target_id = @targetId`).run({ targetId });

    // 4. 删除 source 实体（ON DELETE CASCADE 会自动清理 entity_aliases 中残留的 source 行）
    db.prepare(`DELETE FROM entities WHERE id = ?`).run(sourceId);

    return {
      merged: true,
      targetId,
      transferredAliases: aliasCount.cnt,
      transferredLinks,
      transferredRelations,
    };
  })();
}

/**
 * 查找可能的重复实体（同名不同 ID，或名字高度相似），
 * 供 agent 或 dream 流程调用 mergeEntities 合并。
 */
export function findDuplicateEntities(): { sourceId: string; sourceName: string; targetId: string; targetName: string; type: string }[] {
  const db = getDatabase();
  // 按 name 找重复（不同 ID 同名）
  const rows = db.prepare(`
    SELECT a.id as sourceId, a.name as sourceName, b.id as targetId, b.name as targetName, a.type as type
    FROM entities a
    JOIN entities b ON a.name = b.name AND a.id < b.id
    ORDER BY a.name
  `).all() as { sourceId: string; sourceName: string; targetId: string; targetName: string; type: string }[];

  // 按别名找重复：alias 指向的实体 name 与 alias 对应的另一个实体 name 不同
  const aliasDupes = db.prepare(`
    SELECT DISTINCT ea.entity_id as targetId, e2.name as sourceName, e2.id as sourceId, e2.type as type
    FROM entity_aliases ea
    JOIN entities e2 ON e2.name = ea.alias AND e2.id != ea.entity_id
  `).all() as { targetId: string; sourceName: string; sourceId: string; type: string }[];

  return [
    ...rows.map(r => ({ sourceId: r.sourceId, sourceName: r.sourceName, targetId: r.targetId, targetName: r.targetName, type: r.type })),
    ...aliasDupes.map(r => ({ sourceId: r.sourceId, sourceName: r.sourceName, targetId: r.targetId, targetName: r.sourceName, type: r.type })),
  ];
}
