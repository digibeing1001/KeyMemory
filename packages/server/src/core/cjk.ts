/**
 * KM-103/D3：中文全文检索分词
 *
 * 根因：memories_fts 使用 FTS5 trigram 分词器（substring 匹配，最小 3 字符）。
 * 中文查询会被 buildSafeFtsQuery 拆成词元后逐个短语匹配：双字词（如“青龙”）
 * 长度 < 3 无法命中 trigram 索引，导致中文检索几乎必然 0 命中后降级 LIKE。
 *
 * 方案（不依赖外部分词器，纯确定性）：
 * - 查询侧：把中文连续段切为 trigram 词元（“青龙调度器” → “青龙调 龙调度 调度器”）做 OR 匹配；
 *   trigram 索引对 substring 匹配天然支持，无需重建索引，存量数据立即生效。
 * - 索引侧：保留 appendCjkBigrams 追加（对 trigram 无害，为将来更换分词器预留）。
 *
 * 双字中文词（“缓存”）在 trigram 下不可精确索引，仍由 LIKE 降级路接住；
 * 本方案先解决三字及以上中文词与长句的 FTS 命中问题（主要场景）。
 */

const CJK_CHAR = /[\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff]/;
const CJK_RUN = /[\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff]+/g;

export function containsCjk(text: string): boolean {
  return CJK_CHAR.test(text);
}

/** 提取文本中所有中文连续段并切为 trigram（<3 字的段保留原文），去重后返回。 */
export function cjkTrigrams(text: string): string[] {
  const grams = new Set<string>();
  for (const match of text.matchAll(CJK_RUN)) {
    const run = match[0];
    if (run.length < 3) {
      grams.add(run);
      continue;
    }
    for (let i = 0; i <= run.length - 3; i++) {
      grams.add(run.slice(i, i + 3));
    }
  }
  return Array.from(grams);
}

/** 兼容旧引用：返回 trigram 词元（命名保留 bigrams 以免破坏已编译调用方）。 */
export function cjkBigrams(text: string): string[] {
  return cjkTrigrams(text);
}

/**
 * 索引侧：返回“原文 + 空格分隔 bigram”。无中文时原样返回。
 * bigram 数量上限 4000，防止超长内容无限膨胀索引。
 */
export function appendCjkBigrams(text: string): string {
  if (!text || !containsCjk(text)) return text;
  const grams = cjkBigrams(text.slice(0, 8000)).slice(0, 4000);
  if (grams.length === 0) return text;
  return `${text} ${grams.join(' ')}`;
}
