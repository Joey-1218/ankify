"use client";

import { useCallback, useEffect, useState } from "react";
import {
  BookOpenCheck,
  Check,
  Chrome,
  Circle,
  ExternalLink,
  Sparkles,
  Trophy,
} from "lucide-react";
import type { AiProvider } from "@ankileet/core";
import type { OnboardingProgressDto } from "@ankileet/contracts";
import { AiKeySetup } from "@/components/ai-key-setup";
import { Surface } from "@/components/ui/surface";
import { Button, buttonClasses } from "@/components/ui/button";
import { cn } from "@/lib/utils";

type Copy = {
  eyebrow: string;
  title: string;
  description: string;
  progress: (done: number) => string;
  extensionTitle: string;
  extensionBody: string;
  extensionDone: string;
  install: string;
  aiTitle: string;
  optional: string;
  aiBody: string;
  aiConfigured: string;
  aiSkipped: string;
  connectAi: string;
  skip: string;
  usesAi: string;
  aiUses: string[];
  noAi: string;
  noAiUses: string[];
  cancel: string;
  removeKeyConfirm: string;
  captureTitle: string;
  captureBody: string;
  captureDone: string;
  openSample: string;
  captureLocked: string;
  reviewTitle: string;
  reviewBody: string;
  reviewDone: string;
  reviewLocked: string;
};

const COPY: Record<"en" | "zh", Copy> = {
  en: {
    eyebrow: "Quick setup",
    title: "Start practicing with ankileet",
    description: "Four small steps take you from a new account to your first scheduled review.",
    progress: (done) => `${done} of 4 handled`,
    extensionTitle: "Install and connect the extension",
    extensionBody: "Install it, then click ankileet once so it reuses this web login and tracks your practice on LeetCode.",
    extensionDone: "Extension connected",
    install: "Install extension",
    aiTitle: "Connect AI",
    optional: "Optional",
    aiBody: "Used only to analyze a finished practice session, with your own key. Practice, scheduling, notes, and suggestions work without it.",
    aiConfigured: "AI connected",
    aiSkipped: "Skipped for now",
    connectAi: "Connect AI",
    skip: "Skip for now",
    usesAi: "Uses AI",
    aiUses: ["Explain why a practice session went wrong", "Suggest mistake categories for you to confirm"],
    noAi: "Does not use AI",
    noAiUses: ["Practice sessions on LeetCode", "FSRS scheduling", "Notes, suggestions, and your mistake profile"],
    cancel: "Cancel",
    removeKeyConfirm: "Remove the stored API key? Session analysis stops until you add a new key.",
    captureTitle: "Practice your first problem",
    captureBody: "Open a LeetCode problem and click Start practice in the ankileet panel.",
    captureDone: "First practice started",
    openSample: "Open Two Sum",
    captureLocked: "Connect the extension first.",
    reviewTitle: "Rate your first review",
    reviewBody: "When a problem comes due, solve it again on LeetCode, finish the session, and rate how it went.",
    reviewDone: "First review rated",
    reviewLocked: "Practice a problem first.",
  },
  zh: {
    eyebrow: "快速设置",
    title: "开始用 ankileet 练习",
    description: "四个小步骤，从新账号到第一次安排好的复习。",
    progress: (done) => `已处理 ${done}/4`,
    extensionTitle: "安装并连接扩展",
    extensionBody: "安装后点击一次 ankileet，让扩展复用当前网页登录，并记录你在 LeetCode 上的练习。",
    extensionDone: "扩展已连接",
    install: "安装扩展",
    aiTitle: "连接 AI",
    optional: "可选",
    aiBody: "只用于用你自己的密钥分析已完成的练习；练习、调度、笔记和推荐都不需要 AI。",
    aiConfigured: "AI 已连接",
    aiSkipped: "暂时跳过",
    connectAi: "连接 AI",
    skip: "暂时跳过",
    usesAi: "会使用 AI",
    aiUses: ["解释一次练习出错的原因", "建议错误类别，由你确认"],
    noAi: "不会使用 AI",
    noAiUses: ["在 LeetCode 上的练习", "FSRS 调度", "笔记、推荐和错误画像"],
    cancel: "取消",
    removeKeyConfirm: "移除已保存的 API key？在添加新的 key 前，练习分析将无法使用。",
    captureTitle: "练习第一道题",
    captureBody: "打开一道 LeetCode 题目，在 ankileet 面板中点击开始练习。",
    captureDone: "已开始第一次练习",
    openSample: "打开 Two Sum",
    captureLocked: "请先连接扩展。",
    reviewTitle: "完成第一次复习评分",
    reviewBody: "题目到期后，在 LeetCode 上重新解题，结束练习并评分。",
    reviewDone: "已完成第一次复习评分",
    reviewLocked: "请先练习一道题。",
  },
};

export function OnboardingCard({
  initialProgress,
  initialAi,
  installUrl,
  language,
}: {
  initialProgress: OnboardingProgressDto;
  initialAi: {
    provider: AiProvider;
    model: string;
    hasApiKey: boolean;
  };
  installUrl: string;
  language: "en" | "zh";
}) {
  const t = COPY[language];
  const [progress, setProgress] = useState(initialProgress);
  const [showAi, setShowAi] = useState(false);
  const [aiBusy, setAiBusy] = useState(false);
  const [aiMessage, setAiMessage] = useState<{ kind: "ok" | "error"; text: string } | null>(null);

  const refreshProgress = useCallback(async () => {
    const response = await fetch("/api/onboarding", { cache: "no-store" }).catch(() => null);
    if (!response?.ok) return;
    const data = (await response.json()) as { onboarding: OnboardingProgressDto };
    setProgress(data.onboarding);
  }, []);

  useEffect(() => {
    const refreshOnFocus = () => void refreshProgress();
    window.addEventListener("focus", refreshOnFocus);
    return () => window.removeEventListener("focus", refreshOnFocus);
  }, [refreshProgress]);

  const aiHandled = progress.aiChoice !== "not_started";
  const doneCount = [
    Boolean(progress.extensionConnectedAt),
    aiHandled,
    Boolean(progress.firstCaptureAt),
    Boolean(progress.firstReviewAt),
  ].filter(Boolean).length;

  async function skipAi() {
    setAiBusy(true);
    try {
      const response = await fetch("/api/onboarding", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action: "skip_ai" }),
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const data = (await response.json()) as { onboarding: OnboardingProgressDto };
      setProgress(data.onboarding);
      setShowAi(false);
      setAiMessage(null);
    } catch (error) {
      setAiMessage({
        kind: "error",
        text: error instanceof Error ? error.message : "Could not update onboarding.",
      });
    } finally {
      setAiBusy(false);
    }
  }

  if (progress.complete) return null;

  return (
    <Surface className="overflow-hidden border-accent-solid/25">
      <div className="border-b border-border bg-accent-soft/30 px-5 py-5 sm:px-6">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.16em] text-accent">{t.eyebrow}</p>
            <h1 className="mt-2 text-2xl font-semibold tracking-tight">{t.title}</h1>
            <p className="mt-1.5 max-w-2xl text-sm leading-6 text-muted">{t.description}</p>
          </div>
          <span className="rounded-full border border-accent-solid/20 bg-surface px-3 py-1 text-xs font-medium text-accent tabular-nums">
            {t.progress(doneCount)}
          </span>
        </div>
        <div className="mt-4 h-1.5 overflow-hidden rounded-full bg-border/70">
          <div
            className="h-full rounded-full bg-accent-solid transition-[width]"
            style={{ width: `${(doneCount / 4) * 100}%` }}
          />
        </div>
      </div>

      <div className="divide-y divide-border">
        <OnboardingStep
          icon={Chrome}
          done={Boolean(progress.extensionConnectedAt)}
          title={t.extensionTitle}
          description={progress.extensionConnectedAt ? t.extensionDone : t.extensionBody}
        >
          {!progress.extensionConnectedAt && (
            <a
              href={installUrl}
              target="_blank"
              rel="noreferrer"
              className={buttonClasses({ variant: "primary", size: "sm" })}
            >
              {t.install}
              <ExternalLink className="size-3.5" aria-hidden="true" />
            </a>
          )}
        </OnboardingStep>

        <OnboardingStep
          icon={Sparkles}
          done={aiHandled}
          title={t.aiTitle}
          badge={t.optional}
          description={
            progress.aiChoice === "configured"
              ? t.aiConfigured
              : progress.aiChoice === "skipped"
                ? t.aiSkipped
                : t.aiBody
          }
        >
          {!showAi && progress.aiChoice !== "configured" && (
            <div className="flex flex-wrap gap-2">
              <Button size="sm" variant={progress.aiChoice === "skipped" ? "secondary" : "primary"} onClick={() => setShowAi(true)}>
                {t.connectAi}
              </Button>
              {progress.aiChoice === "not_started" && (
                <Button size="sm" onClick={() => void skipAi()} disabled={aiBusy}>
                  {t.skip}
                </Button>
              )}
            </div>
          )}
          {showAi && (
            <div className="mt-3 rounded-xl border border-border bg-subtle/60 p-4">
              <div className="grid gap-4 lg:grid-cols-2">
                <AiUsage title={t.usesAi} items={t.aiUses} tone="accent" />
                <AiUsage title={t.noAi} items={t.noAiUses} tone="neutral" />
              </div>
              <div className="mt-5">
                <AiKeySetup
                  initial={initialAi}
                  removeConfirm={t.removeKeyConfirm}
                  onSaved={() => {
                    void refreshProgress();
                    window.setTimeout(() => setShowAi(false), 900);
                  }}
                />
              </div>
              <div className="mt-4 flex flex-wrap items-center gap-2">
                <Button size="sm" disabled={aiBusy} onClick={() => setShowAi(false)}>{t.cancel}</Button>
                {progress.aiChoice === "not_started" && (
                  <Button size="sm" variant="ghost" disabled={aiBusy} onClick={() => void skipAi()}>{t.skip}</Button>
                )}
              </div>
              {aiMessage && (
                <p className={cn("mt-3 text-sm", aiMessage.kind === "ok" ? "text-success" : "text-danger")}>
                  {aiMessage.text}
                </p>
              )}
            </div>
          )}
        </OnboardingStep>

        <OnboardingStep
          icon={BookOpenCheck}
          done={Boolean(progress.firstCaptureAt)}
          title={t.captureTitle}
          description={progress.firstCaptureAt ? t.captureDone : t.captureBody}
        >
          {!progress.firstCaptureAt && (
            progress.extensionConnectedAt ? (
              <a
                href="https://leetcode.com/problems/two-sum/"
                target="_blank"
                rel="noreferrer"
                className={buttonClasses({ variant: "primary", size: "sm" })}
              >
                {t.openSample}
                <ExternalLink className="size-3.5" aria-hidden="true" />
              </a>
            ) : (
              <span className="text-xs text-muted">{t.captureLocked}</span>
            )
          )}
        </OnboardingStep>

        <OnboardingStep
          icon={Trophy}
          done={Boolean(progress.firstReviewAt)}
          title={t.reviewTitle}
          description={progress.firstReviewAt ? t.reviewDone : t.reviewBody}
        >
          {!progress.firstReviewAt && !progress.firstCaptureAt && <span className="text-xs text-muted">{t.reviewLocked}</span>}
        </OnboardingStep>
      </div>
    </Surface>
  );
}

function OnboardingStep({
  icon: Icon,
  done,
  title,
  description,
  badge,
  children,
}: {
  icon: typeof Chrome;
  done: boolean;
  title: string;
  description: string;
  badge?: string;
  children?: React.ReactNode;
}) {
  return (
    <section className="grid gap-3 px-5 py-4 sm:grid-cols-[2.25rem_minmax(0,1fr)] sm:items-start sm:px-6">
      <div className={cn(
        "grid size-9 place-items-center rounded-full border",
        done ? "border-success/25 bg-success/10 text-success" : "border-border bg-subtle text-muted",
      )}>
        {done ? <Check className="size-4.5" aria-hidden="true" /> : <Icon className="size-4.5" aria-hidden="true" />}
      </div>
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-2">
          <h2 className="text-sm font-semibold">{title}</h2>
          {badge && <span className="rounded-full bg-subtle px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide text-muted">{badge}</span>}
        </div>
        <p className={cn("mt-1 text-sm leading-6", done ? "text-success" : "text-muted")}>{description}</p>
        {children && <div className="mt-3">{children}</div>}
      </div>
    </section>
  );
}

function AiUsage({
  title,
  items,
  tone,
}: {
  title: string;
  items: string[];
  tone: "accent" | "neutral";
}) {
  return (
    <div>
      <h3 className={cn("text-xs font-semibold uppercase tracking-wide", tone === "accent" ? "text-accent" : "text-muted")}>
        {title}
      </h3>
      <ul className="mt-2 space-y-1.5">
        {items.map((item) => (
          <li key={item} className="flex gap-2 text-xs leading-5 text-muted">
            {tone === "accent" ? <Sparkles className="mt-0.5 size-3.5 shrink-0 text-accent" aria-hidden="true" /> : <Circle className="mt-1 size-2.5 shrink-0" aria-hidden="true" />}
            <span>{item}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
