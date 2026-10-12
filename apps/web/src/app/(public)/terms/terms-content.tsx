"use client";

import Link from "next/link";
import { useLanguage } from "@/components/LanguageProvider";
import { Surface } from "@/components/ui/surface";

const copy = {
  en: {
    title: "Terms of use",
    updated: "Last updated: October 12, 2026",
    intro:
      "These terms cover ankileet (the web app at ankileet.com and its Chrome extension). By using ankileet, you agree to them. If you do not agree, do not use the service.",
    items: [
      ["The service", "ankileet records your LeetCode practice sessions and schedules reviews with spaced repetition. It is an independent project run by its developer and is not endorsed by or affiliated with LeetCode."],
      ["Permitted use", "Use ankileet for lawful personal study. Do not attack, probe, overload, scrape, resell, or interfere with the service or other users, and do not use it to break LeetCode's terms."],
      ["Your account and content", "You sign in with Google and are responsible for activity on your account. You keep ownership of your notes and code and must have the right to store them. Do not store secrets, employer-confidential code, or other sensitive third-party data."],
      ["Third-party services", "Your use of LeetCode, Google, and AI providers remains subject to their own terms and policies. ankileet relies on Vercel and Turso to run."],
      ["AI analysis and costs", "Session analysis is optional and runs only on an API key you supply. You are responsible for that provider's usage, charges, limits, and terms. AI output can be wrong; review it before relying on it, and nothing counts toward your mistake profile until you confirm it."],
      ["Price", "ankileet is currently free. If paid features are ever introduced, they will be described before you are asked to pay."],
      ["Availability", "The service is provided as is, without warranties, and may change, be suspended, or become unavailable. Export important data from Settings and keep your own copies."],
      ["Liability", "To the maximum extent permitted by law, the operator is not liable for indirect or consequential loss, lost data, AI provider charges, interview or exam outcomes, or reliance on generated content."],
      ["Termination", "You may delete your account at any time from Settings. Access may be limited or ended for abuse, security risk, or violation of these terms."],
      ["Changes", "These terms may be updated as the service changes. The date above identifies the current version, and continued use after an update means you accept it."],
    ],
    privacy: "Privacy policy",
  },
  zh: {
    title: "使用条款",
    updated: "最后更新：2026 年 10 月 12 日",
    intro: "本条款适用于 ankileet（ankileet.com 网页及其 Chrome 扩展）。使用 ankileet 即表示你同意本条款；如不同意，请勿使用。",
    items: [
      ["服务内容", "ankileet 记录你在 LeetCode 上的练习，并用间隔重复安排复习。它是由开发者独立运营的项目，未获 LeetCode 背书，也与 LeetCode 无关。"],
      ["允许的用途", "仅将 ankileet 用于合法的个人学习。不得攻击、探测、过载、抓取、转售或干扰服务及其他用户，也不得借此违反 LeetCode 的条款。"],
      ["账号与内容", "你使用 Google 登录，并对账号内的活动负责。你的笔记和代码仍归你所有，你应有权存储它们。请勿存储密钥、雇主机密代码或其他敏感的第三方数据。"],
      ["第三方服务", "你使用 LeetCode、Google 和 AI 提供商时，仍受其各自条款与政策约束。ankileet 依靠 Vercel 和 Turso 运行。"],
      ["AI 分析与费用", "练习分析是可选功能，只使用你提供的 API 密钥。你负责该提供商的使用量、费用、限制和条款。AI 输出可能有误，依赖前请自行核对；任何建议在你确认前都不会计入错误画像。"],
      ["价格", "ankileet 目前免费。如将来推出付费功能，会在你付款前说明。"],
      ["可用性", "服务按现状提供，不作任何保证，可能变更、暂停或不可用。重要数据请在设置中导出并自行保存。"],
      ["责任限制", "在法律允许的最大范围内，运营者不对间接或附带损失、数据丢失、AI 提供商费用、面试或考试结果，或依赖生成内容承担责任。"],
      ["终止", "你可以随时在设置中删除账号。滥用、安全风险或违反条款时，访问可能被限制或终止。"],
      ["变更", "条款会随服务变化更新；上方日期标识当前版本。更新后继续使用即表示你接受新条款。"],
    ],
    privacy: "隐私政策",
  },
} as const;

export function TermsContent() {
  const { language } = useLanguage();
  const t = copy[language];
  return (
    <Surface className="mx-auto max-w-3xl p-6 sm:p-8">
      <h1 className="text-2xl font-semibold">{t.title}</h1>
      <p className="mt-2 text-sm text-muted">{t.updated}</p>
      <p className="mt-5 text-sm leading-7">{t.intro}</p>
      <div className="mt-7 space-y-6">
        {t.items.map(([title, body]) => (
          <section key={title}>
            <h2 className="text-lg font-semibold">{title}</h2>
            <p className="mt-2 text-sm leading-7 text-muted">{body}</p>
          </section>
        ))}
      </div>
      <p className="mt-8 border-t border-border pt-5 text-sm">
        <Link href="/privacy" className="font-medium text-accent underline decoration-accent/40 underline-offset-2 hover:decoration-accent">
          {t.privacy}
        </Link>
      </p>
    </Surface>
  );
}
