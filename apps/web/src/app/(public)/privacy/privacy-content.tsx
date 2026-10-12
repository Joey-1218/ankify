"use client";

import Link from "next/link";
import { useLanguage } from "@/components/LanguageProvider";
import { Surface } from "@/components/ui/surface";

const copy = {
  en: {
    title: "Privacy policy",
    updated: "Last updated: October 12, 2026",
    intro:
      "ankileet helps you review LeetCode problems with spaced repetition: a Chrome extension records your practice sessions on LeetCode, and the web app at ankileet.com schedules your reviews. ankileet is an independent project run by its developer and is not affiliated with LeetCode. This policy explains what data is processed, why, and what you can do about it.",
    sections: [
      {
        title: "Data we process",
        body: [
          "Your Google account identity, used only to sign you in: your name, email address, profile image, Google account id, and sign-in sessions.",
          "Practice data: the LeetCode problems you practice (title, difficulty, statement, topics, and similar questions), your practice sessions (start and finish times, active time, ratings), the submissions you make during a session (code, language, verdict, runtime and memory, and the failing test case and judge output), and the LeetCode username they were made from, so one session never mixes two LeetCode accounts.",
          "What you create or confirm: notes, review schedule and history, and mistake records you confirm.",
          "Settings: language, time zone, review preferences, and, if you add one, your AI provider, model, and API key. Your API key is encrypted before it is stored.",
          "Usage data: the hosting platform keeps request logs (such as IP address, time, and path) for operation and security, and Vercel Web Analytics and Speed Insights record page views and performance without advertising identifiers. We do not sell personal data or use it for advertising.",
        ],
      },
      {
        title: "Chrome extension",
        body: [
          "The extension runs only on leetcode.com problem pages, and it talks only to leetcode.com and ankileet.com.",
          "When you open a problem page, it sends that problem's identifier to your ankileet account so it can show whether the problem is tracked or due for review.",
          "Only during a practice session that you start does it read your submissions for that problem from LeetCode (through your existing LeetCode login in the browser) and send them to ankileet. It does not read your browsing history or other pages.",
          "It reuses your ankileet web sign-in and stores no password or separate API token. Chrome local storage keeps your preferences and the signed-in account, the extension's own IndexedDB keeps practice work waiting to sync, and short-lived tab tokens stay in session storage. Removing the extension deletes this local data.",
        ],
      },
      {
        title: "AI session analysis",
        body: [
          "Session analysis is optional and runs only with an API key you provide; ankileet never uses its own key or credits for it.",
          "When a session is analyzed, the problem details and the session's evidence (submission verdicts, code revisions or diffs, and judge output, limited in size) are sent to the provider you selected: Anthropic, OpenAI, DeepSeek, or Google Gemini. That provider processes the request under its own terms and privacy policy, and usage is billed to your provider account.",
          "Analysis results are suggestions. A suggested mistake counts toward your mistake profile only after you confirm it.",
        ],
      },
      {
        title: "Who else processes data",
        body: [
          "Service providers that run ankileet: Vercel (hosting, background jobs, and analytics), Turso (database), Google (sign-in), and, only for analysis you enable, the AI provider whose key you saved.",
          "We do not sell, rent, or share your data for advertising, and we do not disclose it to anyone else unless required by law or necessary to protect the service and its users.",
        ],
      },
      {
        title: "Retention, security, and your choices",
        body: [
          "Your data is kept while your account exists. From Settings you can export a full copy (NDJSON) or permanently delete your account and its data. Database backups made for recovery may still contain deleted data until they are replaced.",
          "Data is sent over HTTPS, every database query is scoped to the signed-in user, and saved AI keys are encrypted at rest with AES-256-GCM.",
          "You can remove your saved AI key, sign out, or uninstall the extension at any time. No internet service can guarantee absolute security; sign out of ankileet if a device or browser profile is compromised.",
        ],
      },
    ],
    contact: "Questions or privacy requests",
    contactBody: "Open an issue in the project repository:",
    terms: "Terms of use",
  },
  zh: {
    title: "隐私政策",
    updated: "最后更新：2026 年 10 月 12 日",
    intro:
      "ankileet 用间隔重复帮助你复习 LeetCode 题目：Chrome 扩展记录你在 LeetCode 上的练习，ankileet.com 网页安排复习。ankileet 是由开发者独立运营的项目，与 LeetCode 无关。本政策说明我们处理哪些数据、为什么处理，以及你可以如何管理。",
    sections: [
      {
        title: "我们处理的数据",
        body: [
          "Google 账号身份，仅用于登录：姓名、邮箱、头像、Google 账号 id 和登录会话。",
          "练习数据：你练习的 LeetCode 题目（标题、难度、题面、标签和相似题目）、练习记录（开始与结束时间、有效时长、评分），练习期间的提交（代码、语言、判题结果、运行时间与内存、失败用例和判题输出），以及提交所用的 LeetCode 用户名，以免一次练习混入两个 LeetCode 账号。",
          "你创建或确认的内容：笔记、复习计划与历史，以及你确认的错误记录。",
          "设置：界面语言、时区、复习偏好；如果你添加了 AI 配置，还包括提供商、模型和 API 密钥。API 密钥会先加密再存储。",
          "使用数据：托管平台为运行和安全保留请求日志（例如 IP 地址、时间和路径）；Vercel Web Analytics 与 Speed Insights 记录页面访问和性能，不使用广告标识。我们不会出售个人数据，也不会将其用于广告。",
        ],
      },
      {
        title: "Chrome 扩展",
        body: [
          "扩展只在 leetcode.com 的题目页运行，只与 leetcode.com 和 ankileet.com 通信。",
          "打开题目页时，它会把该题的标识发送到你的 ankileet 账号，以显示这道题是否已在跟踪或到期复习。",
          "只有在你开始练习后，它才会通过浏览器中已有的 LeetCode 登录读取你在该题的提交，并发送到 ankileet。它不会读取你的浏览历史或其他网页。",
          "扩展复用你在 ankileet 网页的登录，不保存密码或单独的 API 令牌。Chrome 本地存储保存偏好设置和已登录账号，扩展自己的 IndexedDB 保存等待同步的练习数据，短期的标签页令牌只保存在会话存储中。卸载扩展会删除这些本地数据。",
        ],
      },
      {
        title: "AI 练习分析",
        body: [
          "练习分析是可选功能，只使用你提供的 API 密钥；ankileet 不会为此使用自己的密钥或额度。",
          "分析一次练习时，题目信息和该练习的证据（判题结果序列、代码版本或差异、判题输出，有长度上限）会发送给你选择的提供商：Anthropic、OpenAI、DeepSeek 或 Google Gemini。该提供商按其自身条款和隐私政策处理请求，费用计入你的提供商账户。",
          "分析结果只是建议。建议的错误只有在你确认后才会计入错误画像。",
        ],
      },
      {
        title: "其他处理数据的服务",
        body: [
          "运行 ankileet 所需的服务提供商：Vercel（托管、后台任务和访问统计）、Turso（数据库）、Google（登录），以及仅在你启用分析时、你保存其密钥的 AI 提供商。",
          "我们不会出售、出租或为广告共享你的数据；除法律要求或为保护服务及用户所必需外，也不会向其他任何人披露。",
        ],
      },
      {
        title: "保留、安全与你的选择",
        body: [
          "账号存在期间会保留你的数据。你可以在设置中导出完整副本（NDJSON），或永久删除账号及其数据。为恢复而制作的数据库备份在被替换前可能仍包含已删除的数据。",
          "数据通过 HTTPS 传输，每次数据库查询都限定在当前登录用户范围内，保存的 AI 密钥使用 AES-256-GCM 加密存储。",
          "你可以随时移除已保存的 AI 密钥、退出登录或卸载扩展。任何互联网服务都无法保证绝对安全；设备或浏览器配置泄露时，请立即退出 ankileet。",
        ],
      },
    ],
    contact: "问题或隐私请求",
    contactBody: "请在项目仓库提交 issue：",
    terms: "使用条款",
  },
} as const;

export function PrivacyContent() {
  const { language } = useLanguage();
  const t = copy[language];

  return (
    <Surface className="mx-auto max-w-3xl p-6 sm:p-8">
      <h1 className="text-2xl font-semibold">{t.title}</h1>
      <p className="mt-2 text-sm text-muted">{t.updated}</p>
      <p className="mt-5 text-sm leading-7">{t.intro}</p>
      <div className="mt-7 space-y-7">
        {t.sections.map((section) => (
          <section key={section.title}>
            <h2 className="text-lg font-semibold">{section.title}</h2>
            <ul className="mt-3 list-disc space-y-2 pl-5 text-sm leading-7 text-muted">
              {section.body.map((item) => <li key={item}>{item}</li>)}
            </ul>
          </section>
        ))}
        <section>
          <h2 className="text-lg font-semibold">{t.contact}</h2>
          <p className="mt-3 text-sm text-muted">
            {t.contactBody}{" "}
            <a
              href="https://github.com/Joey-1218/ankify/issues"
              className="font-medium text-accent underline decoration-accent/40 underline-offset-2 hover:decoration-accent"
              rel="noreferrer"
            >
              github.com/Joey-1218/ankify/issues
            </a>
          </p>
        </section>
      </div>
      <p className="mt-8 border-t border-border pt-5 text-sm">
        <Link href="/terms" className="font-medium text-accent underline decoration-accent/40 underline-offset-2 hover:decoration-accent">
          {t.terms}
        </Link>
      </p>
    </Surface>
  );
}
