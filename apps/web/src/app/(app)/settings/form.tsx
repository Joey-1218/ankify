"use client";

import { useId, useState } from "react";
import { useRouter } from "next/navigation";
import type { AiProvider } from "@ankileet/core";
import { AiKeySetup } from "@/components/ai-key-setup";
import { getTranslations, type Language } from "@/lib/i18n";
import { useLanguage } from "@/components/LanguageProvider";
import { useTheme } from "@/components/ThemeProvider";
import { Button, buttonClasses } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { Input, Select } from "@/components/ui/field";
import { InfoTip } from "@/components/ui/info-tip";

export function AppearanceSettingsForm() {
  const { t } = useLanguage();
  const { theme, setTheme } = useTheme();

  return (
    <div className="max-w-2xl space-y-2">
      <label className="block text-sm font-medium text-fg" htmlFor="appearance-theme">
        {t.theme.label}
      </label>
      <Select
        id="appearance-theme"
        value={theme}
        onValueChange={(value) => setTheme(value as "system" | "light" | "dark")}
      >
        <option value="system">{t.theme.system}</option>
        <option value="light">{t.theme.light}</option>
        <option value="dark">{t.theme.dark}</option>
      </Select>
    </div>
  );
}

const SETTINGS_ACTION_CLASS = "min-w-28";

export function AiSettingsForm({
  initial,
  starter,
}: {
  initial: {
    provider: AiProvider;
    model: string;
    hasApiKey: boolean;
  };
  starter: { enabled: boolean; remaining: number; limit: number; paidBalance?: number };
}) {
  const { t } = useLanguage();
  const onStarter = starter.enabled && !initial.hasApiKey;
  // Users on starter credits don't need the provider form, so it starts
  // collapsed behind "Use my own key".
  const [showKeyForm, setShowKeyForm] = useState(!onStarter);
  const sourceStatus = onStarter ? (
    <p className="rounded-lg border border-accent-solid/30 bg-accent-soft px-3 py-2 text-sm leading-6 text-fg">
      {starter.remaining === 0 && (starter.paidBalance ?? 0) > 0
        ? t.settings.paidActive(starter.paidBalance ?? 0)
        : t.settings.starterActive(starter.remaining, starter.limit)}
    </p>
  ) : null;

  if (onStarter && !showKeyForm) {
    return (
      <div className="max-w-2xl space-y-4">
        {sourceStatus}
        <Button type="button" onClick={() => setShowKeyForm(true)}>
          {t.settings.useOwnKey}
        </Button>
      </div>
    );
  }

  return (
    <div className="max-w-2xl space-y-5">
      {sourceStatus}
      <AiKeySetup
        initial={initial}
        removeConfirm={
          starter.enabled ? t.settings.removeApiKeyConfirmStarter(starter.remaining) : t.settings.removeApiKeyConfirm
        }
      />
    </div>
  );
}

export function LanguageRegionSettingsForm({
  initial,
}: {
  initial: {
    generationLanguage: Language;
  };
}) {
  const router = useRouter();
  const { language, setLanguage, t } = useLanguage();
  const [interfaceLanguage, setInterfaceLanguage] = useState<Language>(language);
  const [generationLanguage, setGenerationLanguage] = useState<Language>(
    initial.generationLanguage,
  );
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  async function save(event: React.FormEvent) {
    event.preventDefault();
    setSaving(true);
    setMsg(null);
    try {
      const response = await fetch("/api/settings", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ generationLanguage }),
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      if (interfaceLanguage !== language) setLanguage(interfaceLanguage);
      setMsg(getTranslations(interfaceLanguage).common.saved);
      router.refresh();
    } catch (error) {
      setMsg(error instanceof Error ? error.message : t.settings.failedToSave);
    } finally {
      setSaving(false);
    }
  }

  return (
    <form onSubmit={save} className="max-w-2xl space-y-5">
      <div className="grid gap-4">
        <div className="space-y-2">
          <div className="flex items-center gap-1.5 text-sm">
            <label htmlFor="interface-language" className="font-medium text-fg">
              {t.settings.interfaceLanguage}
            </label>
            <InfoTip label={t.settings.interfaceLanguageHelp} align="left" />
          </div>
          <Select
            id="interface-language"
            value={interfaceLanguage}
            onValueChange={(value) => setInterfaceLanguage(value as Language)}
          >
            <option value="en">{t.settings.languageEnglish}</option>
            <option value="zh">{t.settings.languageChinese}</option>
          </Select>
        </div>

        <div className="space-y-2">
          <div className="flex items-center gap-1.5 text-sm">
            <label htmlFor="generation-language" className="font-medium text-fg">
              {t.settings.generationLanguage}
            </label>
            <InfoTip label={t.settings.generationLanguageHelp} align="left" />
          </div>
          <Select
            id="generation-language"
            value={generationLanguage}
            onValueChange={(value) => setGenerationLanguage(value as Language)}
          >
            <option value="en">{t.settings.languageEnglish}</option>
            <option value="zh">{t.settings.languageChinese}</option>
          </Select>
        </div>
      </div>

      <div className="flex flex-wrap items-center justify-end gap-2 border-t border-border pt-4">
        {msg && (
          <span className="mr-auto text-sm text-muted" role="status" aria-live="polite">
            {msg}
          </span>
        )}
        <Button
          type="submit"
          variant="primary"
          className={SETTINGS_ACTION_CLASS}
          disabled={saving}
        >
          {saving ? t.common.saving : t.settings.saveLanguageRegion}
        </Button>
      </div>
    </form>
  );
}

export function ReviewSettingsForm({ initial }: { initial: { dailyReviewLimit: number; initialReviewDelayHours: number } }) {
  const router = useRouter();
  const { t } = useLanguage();
  const [dailyReviewLimit, setDailyReviewLimit] = useState(initial.dailyReviewLimit);
  const [initialReviewDelayHours, setInitialReviewDelayHours] = useState(initial.initialReviewDelayHours);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setMsg(null);
    try {
      const res = await fetch("/api/settings", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ dailyReviewLimit, initialReviewDelayHours }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setMsg(t.common.saved);
      router.refresh();
    } catch (e) {
      setMsg(e instanceof Error ? e.message : t.settings.failedToSave);
    } finally {
      setSaving(false);
    }
  }

  return (
    <form onSubmit={save} className="max-w-2xl space-y-5">
      <div className="max-w-sm space-y-1">
        <div className="flex items-center gap-1.5 text-sm">
          <label htmlFor="daily-review-limit">{t.settings.dailyReviewLimit}</label>
          <InfoTip label={t.settings.dailyReviewHelp} align="left" />
        </div>
        <Input
          id="daily-review-limit"
          type="number"
          min={1}
          max={100}
          value={dailyReviewLimit}
          onChange={(e) => setDailyReviewLimit(Number(e.target.value))}
          className="tabular-nums"
        />
      </div>

      <div className="max-w-sm space-y-1">
        <div className="flex items-center gap-1.5 text-sm">
          <label htmlFor="initial-review-delay">{t.settings.initialReviewDelay}</label>
          <InfoTip label={t.settings.initialReviewDelayHelp} align="left" />
        </div>
        <Input
          id="initial-review-delay"
          type="number"
          min={1}
          max={168}
          value={initialReviewDelayHours}
          onChange={(e) => setInitialReviewDelayHours(Number(e.target.value))}
          className="tabular-nums"
        />
      </div>

      <div className="flex flex-wrap items-center justify-end gap-2 border-t border-border pt-4">
        {msg && (
          <span className="mr-auto text-sm text-muted" role="status" aria-live="polite">
            {msg}
          </span>
        )}
        <Button
          type="submit"
          variant="primary"
          className={SETTINGS_ACTION_CLASS}
          disabled={saving}
        >
          {saving ? t.common.saving : t.settings.saveReviewSettings}
        </Button>
      </div>
    </form>
  );
}

export function StudyPlanSettingsForm({ initial }: { initial: { dailyMinutes: number; maxNewPerDay: number; hidePatternsOnToday: boolean } }) {
  const router = useRouter();
  const { t } = useLanguage();
  const [dailyMinutes, setDailyMinutes] = useState(initial.dailyMinutes);
  const [maxNewPerDay, setMaxNewPerDay] = useState(initial.maxNewPerDay);
  const [hidePatternsOnToday, setHidePatternsOnToday] = useState(initial.hidePatternsOnToday);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setMsg(null);
    try {
      const res = await fetch("/api/settings", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ studyPlan: { dailyMinutes, maxNewPerDay, hidePatternsOnToday } }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setMsg(t.common.saved);
      router.refresh();
    } catch (e) {
      setMsg(e instanceof Error ? e.message : t.settings.failedToSave);
    } finally {
      setSaving(false);
    }
  }

  return (
    <form onSubmit={save} className="max-w-2xl space-y-5">
      <div className="max-w-sm space-y-1">
        <div className="flex items-center gap-1.5 text-sm">
          <label htmlFor="daily-minutes">{t.settings.dailyMinutes}</label>
          <InfoTip label={t.settings.dailyMinutesHelp} align="left" />
        </div>
        <Input
          id="daily-minutes"
          type="number"
          min={10}
          max={960}
          step={5}
          value={dailyMinutes}
          onChange={(e) => setDailyMinutes(Number(e.target.value))}
          className="tabular-nums"
        />
      </div>

      <div className="max-w-sm space-y-1">
        <div className="flex items-center gap-1.5 text-sm">
          <label htmlFor="max-new-per-day">{t.settings.maxNewPerDay}</label>
          <InfoTip label={t.settings.maxNewPerDayHelp} align="left" />
        </div>
        <Input
          id="max-new-per-day"
          type="number"
          min={0}
          max={100}
          value={maxNewPerDay}
          onChange={(e) => setMaxNewPerDay(Number(e.target.value))}
          className="tabular-nums"
        />
      </div>

      <label className="flex cursor-pointer items-start gap-2 text-sm">
        <input
          type="checkbox"
          checked={hidePatternsOnToday}
          onChange={(event) => setHidePatternsOnToday(event.target.checked)}
          className="mt-1 h-4 w-4 shrink-0 cursor-pointer rounded border-border accent-accent"
        />
        <span>
          {t.settings.hidePatterns}
          <span className="mt-1 block text-muted">{t.settings.hidePatternsHelp}</span>
        </span>
      </label>

      <div className="flex flex-wrap items-center justify-end gap-2 border-t border-border pt-4">
        {msg && (
          <span className="mr-auto text-sm text-muted" role="status" aria-live="polite">
            {msg}
          </span>
        )}
        <Button type="submit" variant="primary" className={SETTINGS_ACTION_CLASS} disabled={saving}>
          {saving ? t.common.saving : t.settings.saveStudyPlan}
        </Button>
      </div>
    </form>
  );
}

/** Whether session analysis can run, and whether automation can be configured. */
export type AnalysisAvailability = "disabled" | "needs_key" | "manual_only" | "automatic";

export function AnalysisSettingsForm({
  initial,
  availability,
}: {
  initial: { automatic: boolean };
  availability: AnalysisAvailability;
}) {
  const router = useRouter();
  const { t } = useLanguage();
  const [automatic, setAutomatic] = useState(initial.automatic);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  if (availability !== "automatic") {
    const text =
      availability === "disabled" ? t.settings.analysisUnavailable
      : availability === "needs_key" ? t.settings.analysisNeedsKey
      : t.settings.analysisManualOnly;
    return <p className="max-w-2xl text-sm leading-6 text-muted">{text}</p>;
  }

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setMsg(null);
    try {
      const res = await fetch("/api/settings", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ analysisAutomatic: automatic }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setMsg(t.common.saved);
      router.refresh();
    } catch (e) {
      setMsg(e instanceof Error ? e.message : t.settings.failedToSave);
    } finally {
      setSaving(false);
    }
  }

  return (
    <form onSubmit={save} className="max-w-2xl space-y-5">
      <label className="flex cursor-pointer items-start gap-2 text-sm">
        <input
          type="checkbox"
          checked={automatic}
          onChange={(event) => setAutomatic(event.target.checked)}
          className="mt-1 h-4 w-4 shrink-0 cursor-pointer rounded border-border accent-accent"
        />
        <span>
          {t.settings.analysisAutomatic}
          <span className="mt-1 block text-muted">{t.settings.analysisAutomaticHelp}</span>
        </span>
      </label>
      <div className="flex flex-wrap items-center justify-end gap-2 border-t border-border pt-4">
        {msg && (
          <span className="mr-auto text-sm text-muted" role="status" aria-live="polite">
            {msg}
          </span>
        )}
        <Button type="submit" variant="primary" className={SETTINGS_ACTION_CLASS} disabled={saving}>
          {saving ? t.common.saving : t.settings.saveAnalysisSettings}
        </Button>
      </div>
    </form>
  );
}

export function AccountDataForm({
  email,
  paidBalance,
}: {
  email: string;
  paidBalance: number;
}) {
  const { t } = useLanguage();
  const [paidCredits, setPaidCredits] = useState(paidBalance);
  const [forfeitAcknowledged, setForfeitAcknowledged] = useState(false);
  const [confirmationEmail, setConfirmationEmail] = useState("");
  const confirmationId = useId();
  const [deleting, setDeleting] = useState(false);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const matches = confirmationEmail.trim().toLowerCase() === email.toLowerCase();
  const canDelete = matches && (paidCredits === 0 || forfeitAcknowledged);

  async function deleteAccount() {
    if (!canDelete) return;
    setDeleting(true);
    setMessage(null);
    try {
      const response = await fetch("/api/account", {
        method: "DELETE",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          email: confirmationEmail.trim(),
          confirmation: "DELETE",
          acknowledgeCreditForfeit: paidCredits > 0 && forfeitAcknowledged,
        }),
      });
      if (!response.ok) {
        const body = (await response.json().catch(() => null)) as
          | { error?: string; paidBalance?: number }
          | null;
        if (body?.error === "credit_forfeit_unacknowledged") {
          // The balance changed (e.g. a purchase completed); ask again.
          setPaidCredits(body.paidBalance ?? 1);
          setForfeitAcknowledged(false);
          setDeleteDialogOpen(false);
          setDeleting(false);
          return;
        }
        throw new Error(body?.error ?? `HTTP ${response.status}`);
      }
      window.location.assign("/login?deleted=1");
    } catch (error) {
      setMessage(
        error instanceof Error ? error.message : t.settings.deleteAccountFailed,
      );
      setDeleting(false);
    }
  }

  return (
    <div className="max-w-2xl space-y-5">
      <ConfirmDialog
        open={deleteDialogOpen}
        title={t.settings.deleteAccount}
        description={
          paidCredits > 0
            ? `${t.settings.deleteAccountConfirm} ${t.settings.deleteForfeitsCredits(paidCredits)}`
            : t.settings.deleteAccountConfirm
        }
        cancelLabel={t.common.cancel}
        confirmLabel={deleting ? t.settings.deletingAccount : t.settings.deleteAccount}
        busy={deleting}
        error={message}
        onClose={() => {
          if (!deleting) {
            setDeleteDialogOpen(false);
            setMessage(null);
          }
        }}
        onConfirm={() => void deleteAccount()}
      />
      <div className="grid gap-2 sm:grid-cols-[auto_minmax(0,1fr)] sm:items-center sm:gap-4">
        <a
          href="/api/account/export"
          download
          className={buttonClasses({
            variant: "secondary",
            className: SETTINGS_ACTION_CLASS,
          })}
        >
          {t.settings.exportData}
        </a>
        <p className="text-sm text-muted">{t.settings.exportDataHelp}</p>
      </div>

      <details className="group overflow-hidden rounded-lg border border-border bg-surface">
        <summary className="flex cursor-pointer list-none items-center justify-between gap-3 px-4 py-3 text-sm font-medium text-muted transition hover:bg-subtle hover:text-fg [&::-webkit-details-marker]:hidden">
          <span>{t.settings.advancedAccountActions}</span>
          <svg
            aria-hidden="true"
            viewBox="0 0 20 20"
            fill="none"
            className="h-4 w-4 shrink-0 transition-transform group-open:rotate-180"
          >
            <path
              d="m6 8 4 4 4-4"
              stroke="currentColor"
              strokeWidth="1.5"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </summary>
        <div className="space-y-3 border-t border-border bg-danger/5 p-4">
          <div>
            <h3 className="text-sm font-medium text-danger">
              {t.settings.deleteAccount}
            </h3>
            <p className="mt-1 text-sm text-muted">
              {t.settings.deleteAccountHelp}
            </p>
          </div>
          {paidCredits > 0 && (
            <div className="max-w-xl space-y-2 rounded-lg border border-warning/30 bg-warning/10 px-3 py-2 text-sm leading-6 text-fg">
              <p>{t.settings.deleteForfeitWarning(paidCredits)}</p>
              <label className="flex cursor-pointer items-start gap-2">
                <input
                  type="checkbox"
                  checked={forfeitAcknowledged}
                  onChange={(event) => setForfeitAcknowledged(event.target.checked)}
                  className="mt-1 h-4 w-4 shrink-0 cursor-pointer rounded border-border accent-accent"
                />
                <span>{t.settings.deleteForfeitAcknowledge(paidCredits)}</span>
              </label>
            </div>
          )}
          {/* The instruction stays visible while typing; a placeholder would vanish. */}
          <label htmlFor={confirmationId} className="block text-sm text-muted">
            {t.settings.typeEmailToDelete(email)}
          </label>
          <div className="flex max-w-xl flex-col gap-2 sm:flex-row">
            <Input
              id={confirmationId}
              type="email"
              value={confirmationEmail}
              onChange={(event) => setConfirmationEmail(event.target.value)}
              autoComplete="off"
              className="min-w-0 flex-1"
            />
            <Button
              variant="danger"
              onClick={() => {
                setMessage(null);
                setDeleteDialogOpen(true);
              }}
              disabled={!canDelete || deleting}
              className={`${SETTINGS_ACTION_CLASS} shrink-0`}
            >
              {deleting ? t.settings.deletingAccount : t.settings.deleteAccount}
            </Button>
          </div>
          {message && !deleteDialogOpen && (
            <p className="text-sm text-danger" role="alert">
              {message}
            </p>
          )}
        </div>
      </details>
    </div>
  );
}
