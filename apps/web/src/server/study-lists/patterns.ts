/**
 * Problem-solving patterns: the technique a built-in list section practices,
 * finer than LeetCode's topic tags ("Sliding Window" covers both fixed- and
 * variable-length windows). Sections that differ only in level share one
 * pattern. Ids are stable: mistake-profile history is keyed by them, so
 * rename the label, never the id. Every section of every built-in list must
 * name a pattern registered here (builtin.test.ts checks).
 */
export const PATTERNS = {
  "sliding_window.fixed": { en: "Fixed-length sliding window", zh: "定长滑动窗口" },
  "sliding_window.variable.longest": { en: "Variable window: longest or largest", zh: "不定长滑窗：求最长/最大" },
  "sliding_window.variable.shortest": { en: "Variable window: shortest or smallest", zh: "不定长滑窗：求最短/最小" },
  "sliding_window.variable.count_at_most": { en: "Variable window: counting, shorter is valid", zh: "不定长滑窗：子数组个数（越短越合法）" },
  "sliding_window.variable.count_at_least": { en: "Variable window: counting, longer is valid", zh: "不定长滑窗：子数组个数（越长越合法）" },
  "sliding_window.variable.count_exact": { en: "Variable window: counting exactly k", zh: "不定长滑窗：恰好型" },
  "sliding_window.variable.other": { en: "Variable window: other", zh: "不定长滑窗：其他" },
  "two_pointers.reverse": { en: "Two pointers: reversing", zh: "双指针：反转字符串" },
  "two_pointers.opposite": { en: "Two pointers moving toward each other", zh: "相向双指针" },
  "two_pointers.same_direction": { en: "Two pointers moving the same way", zh: "同向双指针" },
  "two_pointers.outward": { en: "Two pointers moving apart", zh: "背向双指针" },
  "two_pointers.in_place": { en: "Two pointers: in-place modification", zh: "双指针：原地修改" },
  "two_pointers.matrix": { en: "Two pointers on a matrix", zh: "矩阵上的双指针" },
  "two_sequences.two_pointers": { en: "Two pointers on two sequences", zh: "双序列双指针" },
  "two_sequences.subsequence": { en: "Subsequence checks", zh: "判断子序列" },
  three_pointers: { en: "Three pointers", zh: "三指针" },
  group_loop: { en: "Group loop", zh: "分组循环" },
} as const satisfies Record<string, { en: string; zh: string }>;

export type PatternId = keyof typeof PATTERNS;

export function isPatternId(value: string): value is PatternId {
  return Object.hasOwn(PATTERNS, value);
}
