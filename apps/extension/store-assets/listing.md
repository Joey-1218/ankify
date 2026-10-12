# Chrome Web Store listing: ankileet

Copy each block into the matching field of the Chrome Web Store developer console. The store renders the description as plain text, so the blocks below avoid Markdown inside them.

## Store icon

`icon-128.png` in this folder: 128×128 PNG, with 96×96 artwork centered and 16 px of transparent padding on each side, as the store's image guidelines ask.

## Summary (from the manifest, max 132 characters)

The store takes this from `description` in `apps/extension/manifest.config.ts` (115 characters):

```
Practice LeetCode problems with spaced repetition: track each attempt on the problem page and review when it's due.
```

## Category and language

- Category: Education
- Language: English

## Detailed description

```
Remember the reasoning behind every LeetCode problem you solve.

You solve a problem, move on, and three weeks later you can't remember why your greedy approach failed or which edge case broke your first submission. Re-solving at random wastes time on problems you still remember and misses the ones you're about to forget. ankileet schedules the whole problem and brings it back right before you'd forget it, so you review it the way you learned it: by solving it again on LeetCode.

HOW IT WORKS

1. Practice: open a problem on leetcode.com and click Start practice in the ankileet panel. Every submission is recorded with its verdict and failing test case.
2. Rate: when a review is due, solve the problem again, finish the session, and rate how it went. FSRS-6, a modern spaced-repetition algorithm, schedules the next review. A first practice comes back a day later.
3. Learn: record why an attempt failed, or let session analysis suggest a cause, and see which skills keep slipping across problems.

FEATURES

• Practice sessions on the problem page: ankileet tracks when you start, every submission and its verdict, and how long you actively worked. An Accepted verdict doesn't end the session; you decide when you're done.
• Reviews on schedule: the toolbar popup shows what's due today and opens the problem with its review session ready to start.
• A mistake profile: confirmed causes of failure (approach, invariant, edge cases, complexity, implementation, concept) are counted once per session, so retrying a problem five times doesn't inflate a weakness.
• New problems worth trying: each day ankileet suggests a problem you haven't attempted, chosen from the similar questions of problems you practiced, and says why it picked it.
• Optional AI session analysis with your own key: after a session, ankileet can explain what went wrong from your attempts, code changes, and judge output, using your own Anthropic, OpenAI, DeepSeek, or Google Gemini API key. Suggested mistakes count only after you confirm them.
• Nothing lost offline: practice work is saved in the extension first and syncs as soon as ankileet is reachable.
• A web dashboard at ankileet.com: today's reviews, the problems you're most likely to forget, your review history, and a page for every problem with its sessions, notes, and submissions.
• English or 简体中文 interface.

GETTING STARTED

1. Sign in at https://ankileet.com with your Google account. ankileet is free.
2. Install this extension and click its icon once. It reuses your ankileet sign-in, so there's no token to paste.
3. Open any problem on leetcode.com and click Start practice.

PRIVACY

The extension runs only on leetcode.com problem pages and talks only to leetcode.com and ankileet.com. It reads your submissions only during a practice session you start, and it never reads your browsing history or other sites. ankileet doesn't sell your data or use it for advertising. You can export everything or delete your account from Settings at any time. AI analysis is optional and runs only on an API key you provide. Full privacy policy: https://ankileet.com/privacy

PERMISSIONS

• Storage: keeps your preferences and any practice work waiting to sync.
• Tabs: finds LeetCode problem tabs and notices when a practice tab is closed.
• Alarms: retries syncing in the background.
• Access to leetcode.com: reads the problem you're practicing and your submission results.
• Access to ankileet.com: saves your practice sessions to your account.

Works with leetcode.com (not leetcode.cn). ankileet is an independent project and is not affiliated with or endorsed by LeetCode.
```
