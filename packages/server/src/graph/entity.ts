import { v4 as uuid } from 'uuid';
import type { Entity, EntityType, Relation } from '@keymemory/shared';
import { getDatabase } from '../db/sqlite.js';

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
export const MEMORY_RELATION_TYPES = ['part_of', 'derived_from', 'relates_to', 'supersedes', 'references'] as const;

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

  const existing = db.prepare(`SELECT * FROM entities WHERE name = ?`).get(name) as Record<string, unknown> | undefined;
  if (existing) {
    return {
      id: existing.id as string,
      name: existing.name as string,
      type: existing.type as EntityType,
      properties: existing.properties ? JSON.parse(existing.properties as string) : undefined,
      createdAt: existing.created_at as string,
      updatedAt: existing.updated_at as string,
    };
  }

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

export function autoAssociate(sourceMemoryId: string, content: string, title: string): void {
  const db = getDatabase();

  // 查找标题/内容中提到的其他活跃记忆标题，建立 relates_to 关系
  const words = title.split(/\s+/).filter(w => w.length >= 4);
  for (const word of words.slice(0, 3)) {
    const matches = db.prepare(`SELECT id FROM memories WHERE status = 'active' AND id != ? AND (title LIKE ? OR content LIKE ?) LIMIT 3`).all(
      sourceMemoryId, `%${word}%`, `%${word}%`
    ) as { id: string }[];
    for (const m of matches) {
      try {
        createMemoryRelation(sourceMemoryId, m.id, 'relates_to', 0.6, 'auto-associate title overlap');
      } catch { /* 忽略重复关联 */ }
    }
  }
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
      connectedEntities.push({
        id: e.id as string,
        name: e.name as string,
        type: e.type as EntityType,
        properties: e.properties ? JSON.parse(e.properties as string) : undefined,
        createdAt: e.created_at as string,
        updatedAt: e.updated_at as string,
      });
    }
  }

  const typedRelations = relations.map(r => ({
    id: r.id as string,
    sourceId: r.source_id as string,
    targetId: r.target_id as string,
    relationType: r.relation_type as string,
    strength: r.strength as number,
    createdAt: r.created_at as string,
  }));

  return {
    entity: {
      id: entity.id as string,
      name: entity.name as string,
      type: entity.type as EntityType,
      properties: entity.properties ? JSON.parse(entity.properties as string) : undefined,
      createdAt: entity.created_at as string,
      updatedAt: entity.updated_at as string,
    },
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
