import { CONFLICT_PATTERNS } from '@keymemory/shared';

export type ConflictMemory = { id: string; title: string; content: string };
export type ConflictMatch = {
  positive: ConflictMemory;
  negative: ConflictMemory;
  positiveWord: string;
  negativeWord: string;
};

const NOISY_ENTITY = /^(?:今天|昨天|明天|现在|目前|系统|项目|任务|工作|用户|时间|Windows|Git|API|\d{4}(?:[-年]\d{1,2})?.*)$/iu;
const TOPIC_STOP = new Set(['今天', '现在', '目前', '已经', '需要', '一个', '这个', '系统', '项目', '任务', '工作', '用户', '内容', '记忆']);

function topicTokens(value: string, entityName: string): Set<string> {
  const text = value.toLocaleLowerCase().replaceAll(entityName.toLocaleLowerCase(), ' ');
  const result = new Set<string>();
  for (const word of text.match(/[a-z][a-z0-9._-]{2,}/g) ?? []) if (!TOPIC_STOP.has(word)) result.add(word);
  for (const chunk of text.match(/[\u4e00-\u9fff]{2,}/g) ?? []) {
    for (let index = 0; index < chunk.length - 1; index++) {
      const pair = chunk.slice(index, index + 2);
      if (!TOPIC_STOP.has(pair)) result.add(pair);
    }
  }
  return result;
}

function sharesTopic(left: ConflictMemory, right: ConflictMemory, entityName: string): boolean {
  const leftTokens = topicTokens(`${left.title} ${left.content}`, entityName);
  const rightTokens = topicTokens(`${right.title} ${right.content}`, entityName);
  return [...leftTokens].filter(token => rightTokens.has(token)).length >= 2;
}

/** 高精度的规则候选；最终仍作为“待确认”，不会自动改写原记忆。 */
export function findConflictMatch(entityName: string, memories: ConflictMemory[]): ConflictMatch | null {
  if (entityName.trim().length < 2 || NOISY_ENTITY.test(entityName.trim())) return null;
  for (const [positiveSet, negativeSet] of CONFLICT_PATTERNS) {
    for (const positive of memories) {
      if (negativeSet.some(word => positive.content.includes(word))) continue;
      const positiveWord = positiveSet.find(word => positive.content.includes(word));
      if (!positiveWord) continue;
      for (const negative of memories) {
        if (negative.id === positive.id || !sharesTopic(positive, negative, entityName)) continue;
        const negativeWord = negativeSet.find(word => negative.content.includes(word));
        if (negativeWord) return { positive, negative, positiveWord, negativeWord };
      }
    }
  }
  return null;
}
