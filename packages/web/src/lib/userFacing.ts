import type { Layer, LoopRunStatus } from '@keymemory/shared';

export type UiLanguage = 'zh' | 'en';

const LAYER_NAMES: Record<Layer | 'project', Record<UiLanguage, string>> = {
  flash: { zh: '待整理', en: 'Needs sorting' },
  short: { zh: '近期有用', en: 'Useful soon' },
  long: { zh: '长期保留', en: 'Keep long-term' },
  entity: { zh: '人事物', en: 'People and objects' },
  project: { zh: '项目主题', en: 'Project theme' },
};

const RELATION_NAMES: Record<string, Record<UiLanguage, string>> = {
  relates_to: { zh: '内容相关', en: 'Related' },
  supersedes: { zh: '取代旧说法', en: 'Replaces an older version' },
  derived_from: { zh: '来源于', en: 'Derived from' },
  references: { zh: '引用', en: 'References' },
  part_of: { zh: '属于', en: 'Part of' },
  contradicts: { zh: '可能矛盾', en: 'May contradict' },
  extends: { zh: '补充', en: 'Extends' },
  reverses: { zh: '修正', en: 'Reverses' },
  reinforces: { zh: '相互印证', en: 'Reinforces' },
  bridges: { zh: '跨主题关联', en: 'Bridges topics' },
  extended_by: { zh: '被补充', en: 'Extended by' },
  reversed_by: { zh: '被修正', en: 'Reversed by' },
  reinforced_by: { zh: '被印证', en: 'Reinforced by' },
  bridges_with: { zh: '跨主题关联', en: 'Bridges topics' },
  shared_tag: { zh: '共享主题标签', en: 'Shared topic tag' },
  shared_project: { zh: '同一项目', en: 'Same project' },
  shared_entity: { zh: '涉及相同人或事物', en: 'Shared person or object' },
};

const ORPHAN_REQUIREMENT_NAMES: Record<string, Record<UiLanguage, string>> = {
  entity: { zh: '相关人物或事物', en: 'a related person or object' },
  tag: { zh: '主题标签', en: 'a topic tag' },
  relation: { zh: '关联记忆', en: 'a related memory' },
  mail_thread: { zh: '所属工作邮件', en: 'a work-mail thread' },
};

const DREAM_STATUS_NAMES: Record<string, Record<UiLanguage, string>> = {
  running: { zh: '整理中', en: 'Organizing' },
  completed: { zh: '已完成', en: 'Completed' },
  failed: { zh: '未完成', en: 'Failed' },
  rolled_back: { zh: '已撤销', en: 'Undone' },
};

const LOOP_STATUS_NAMES: Record<LoopRunStatus, Record<UiLanguage, string>> = {
  running: { zh: '进行中', en: 'Running' },
  waiting: { zh: '等待继续', en: 'Waiting' },
  completed: { zh: '已完成', en: 'Completed' },
  failed: { zh: '未完成', en: 'Failed' },
  cancelled: { zh: '已取消', en: 'Cancelled' },
};

function fallbackLabel(value: string): string {
  return value.replaceAll('_', ' ');
}

export function userFacingLayer(layer: string, language: UiLanguage): string {
  return LAYER_NAMES[layer as keyof typeof LAYER_NAMES]?.[language] ?? fallbackLabel(layer);
}

export function userFacingRelation(type: string, language: UiLanguage): string {
  return RELATION_NAMES[type]?.[language] ?? fallbackLabel(type);
}

export function userFacingOrphanRequirement(requirement: string, language: UiLanguage): string {
  return ORPHAN_REQUIREMENT_NAMES[requirement]?.[language] ?? fallbackLabel(requirement);
}

export function userFacingDreamStatus(status: string, language: UiLanguage): string {
  return DREAM_STATUS_NAMES[status]?.[language] ?? fallbackLabel(status);
}

export function userFacingLoopStatus(status: LoopRunStatus, language: UiLanguage): string {
  return LOOP_STATUS_NAMES[status][language];
}
