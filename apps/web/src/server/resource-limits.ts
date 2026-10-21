/** Hard database-backed storage caps used even when public signup is enabled. */
export const MAX_PROBLEMS_PER_USER = 2_000;
export const MAX_SUBMISSIONS_PER_PROBLEM = 500;
export const MAX_CARDS_PER_PROBLEM = 200;
export const MAX_QUIZ_SESSIONS_PER_PROBLEM = 100;
/** Suggestion candidates (verified LeetCode metadata) kept per user. */
export const MAX_SUGGESTION_CANDIDATES_PER_USER = 5_000;
/** Custom and followed built-in study lists per user. */
export const MAX_STUDY_LISTS_PER_USER = 50;
/** Problems per custom study list (the largest built-in list has 607). */
export const MAX_ITEMS_PER_STUDY_LIST = 2_000;
