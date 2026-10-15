"use client";

import { useId, useState } from "react";
import { useRouter } from "next/navigation";
import type { AiProvider } from "@ankileet/core";
import { useLanguage } from "@/components/LanguageProvider";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { Input } from "@/components/ui/field";
import { Spinner } from "@/components/ui/spinner";
import { AI_PROVIDERS, aiProviderName, type KnownAiProvider } from "@/lib/ai-providers";
import { cn } from "@/lib/utils";

type Step = "configured" | "provider" | "key";
type Saved = { provider: KnownAiProvider; model: string };
type Result =
  | { kind: "ok"; text: string }
  | { kind: "err"; text: string; switchTo?: KnownAiProvider };
type VerifyResponse =
  | { ok: true; provider: KnownAiProvider; model: string }
  | { ok: false; code: string; message: string; detectedProvider?: KnownAiProvider };

const ACTION_CLASS = "min-w-28";

/**
 * Two-step AI key setup shared by Settings and onboarding: choose a provider
 * (with a way back), then add its key. "Verify and save" stores the key only
 * if the provider accepts it; the server picks the analysis model, so there
 * is no model to choose here.
 */
export function AiKeySetup({
  initial,
  removeConfirm,
  onSaved,
}: {
  initial: { provider: AiProvider; model: string; hasApiKey: boolean };
  /** Text of the remove-key confirmation. */
  removeConfirm: string;
  onSaved?: () => void;
}) {
  const router = useRouter();
  const { t } = useLanguage();
  const keyInputId = useId();
  const [saved, setSaved] = useState<Saved | null>(
    initial.hasApiKey && initial.provider ? { provider: initial.provider, model: initial.model } : null,
  );
  const [step, setStep] = useState<Step>(saved ? "configured" : initial.provider ? "key" : "provider");
  const [provider, setProvider] = useState<KnownAiProvider | "">(initial.provider);
  const [apiKey, setApiKey] = useState("");
  const [busy, setBusy] = useState<"verify" | "remove" | null>(null);
  const [result, setResult] = useState<Result | null>(null);
  const [removeOpen, setRemoveOpen] = useState(false);
  const [removeError, setRemoveError] = useState<string | null>(null);

  function chooseProvider(next: KnownAiProvider) {
    if (next !== provider) setApiKey("");
    setProvider(next);
    setResult(null);
    setStep("key");
  }

  function backToProviders() {
    setApiKey("");
    setResult(null);
    setStep("provider");
  }

  function cancelChange() {
    if (!saved) return;
    setApiKey("");
    setResult(null);
    setProvider(saved.provider);
    setStep("configured");
  }

  function failureText(json: Extract<VerifyResponse, { ok: false }>, chosen: KnownAiProvider) {
    const name = aiProviderName(chosen);
    if (json.code === "key_provider_mismatch" && json.detectedProvider) {
      return t.settings.keyMismatch(name, aiProviderName(json.detectedProvider));
    }
    if (json.code === "invalid_api_key") return t.settings.keyRejected(name);
    if (json.code === "no_usable_model") return t.settings.noUsableModel(name);
    if (json.code === "provider_unavailable") return t.settings.providerBusy(name);
    if (json.code === "quota_or_rate_limit") return t.settings.providerQuota(name);
    return t.settings.verifyFailed(json.message || json.code);
  }

  /** Verifies the typed key, or with no key the stored one again. */
  async function verify(target: KnownAiProvider, key?: string) {
    setBusy("verify");
    setResult(null);
    try {
      const res = await fetch("/api/settings/ai-key", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ provider: target, ...(key ? { apiKey: key } : {}) }),
      });
      const json = (await res.json().catch(() => null)) as VerifyResponse | null;
      if (!json) {
        setResult({ kind: "err", text: t.settings.verifyFailed(`HTTP ${res.status}`) });
      } else if (json.ok) {
        setSaved({ provider: json.provider, model: json.model });
        setProvider(json.provider);
        setApiKey("");
        setStep("configured");
        setResult({ kind: "ok", text: t.settings.keyVerified });
        onSaved?.();
        router.refresh();
      } else {
        setResult({
          kind: "err",
          text: failureText(json, target),
          ...(json.code === "key_provider_mismatch" && json.detectedProvider ? { switchTo: json.detectedProvider } : {}),
        });
      }
    } catch (error) {
      setResult({ kind: "err", text: t.settings.verifyFailed(error instanceof Error ? error.message : t.settings.networkError) });
    } finally {
      setBusy(null);
    }
  }

  async function removeKey() {
    setBusy("remove");
    setRemoveError(null);
    try {
      const res = await fetch("/api/settings/ai-key", { method: "DELETE" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setSaved(null);
      setApiKey("");
      setResult(null);
      setRemoveOpen(false);
      setStep(provider ? "key" : "provider");
      router.refresh();
    } catch (error) {
      setRemoveError(error instanceof Error ? error.message : t.settings.failedToSave);
    } finally {
      setBusy(null);
    }
  }

  const message = result && (
    <div
      role={result.kind === "err" ? "alert" : "status"}
      aria-live="polite"
      className={cn(
        "flex flex-wrap items-center justify-between gap-2 rounded-md border px-3 py-2 text-sm",
        result.kind === "ok" ? "border-success/30 bg-success/10 text-success" : "border-danger/30 bg-danger/10 text-danger",
      )}
    >
      <span>{result.text}</span>
      {result.kind === "err" && result.switchTo && (
        <Button size="sm" onClick={() => chooseProvider(result.switchTo!)}>
          {t.settings.useProviderInstead(aiProviderName(result.switchTo))}
        </Button>
      )}
    </div>
  );

  if (step === "configured" && saved) {
    return (
      <div className="space-y-4">
        <ConfirmDialog
          open={removeOpen}
          title={t.settings.removeApiKey}
          description={removeConfirm}
          cancelLabel={t.common.cancel}
          confirmLabel={busy === "remove" ? t.settings.removingApiKey : t.settings.removeApiKey}
          busy={busy === "remove"}
          error={removeError}
          onClose={() => {
            if (busy !== "remove") {
              setRemoveOpen(false);
              setRemoveError(null);
            }
          }}
          onConfirm={() => void removeKey()}
        />
        <dl className="grid gap-3 text-sm sm:grid-cols-[9rem_minmax(0,1fr)]">
          <dt className="text-muted">{t.settings.provider}</dt>
          <dd className="flex flex-wrap items-center gap-3 font-medium text-fg">
            {aiProviderName(saved.provider)}
            <span className="inline-flex items-center gap-1.5 text-xs font-medium text-success">
              <span className="h-1.5 w-1.5 rounded-full bg-success" aria-hidden="true" />
              {t.settings.apiKeySaved}
            </span>
          </dd>
          <dt className="text-muted">{t.settings.analysisModel}</dt>
          <dd>
            <span className="font-mono text-fg">{saved.model}</span>
            <span className="mt-0.5 block text-xs text-muted">{t.settings.modelPickedAutomatically}</span>
          </dd>
        </dl>
        <div className="flex flex-wrap items-center justify-end gap-2 border-t border-border pt-4">
          <Button
            className={cn(ACTION_CLASS, "mr-auto")}
            onClick={() => {
              setRemoveError(null);
              setRemoveOpen(true);
            }}
            disabled={busy !== null}
          >
            {t.settings.removeApiKey}
          </Button>
          <Button className={ACTION_CLASS} onClick={backToProviders} disabled={busy !== null}>
            {t.settings.changeProvider}
          </Button>
          <Button className={ACTION_CLASS} onClick={() => void verify(saved.provider)} disabled={busy !== null}>
            {busy === "verify" ? <Spinner /> : t.settings.verifyAgain}
          </Button>
        </div>
        {message}
      </div>
    );
  }

  if (step === "provider" || !provider) {
    return (
      <div className="space-y-4">
        <div>
          <p className="text-sm font-medium text-fg">{t.settings.chooseProviderStep}</p>
          <p className="mt-1 text-sm text-muted">{t.settings.chooseProviderHelp}</p>
        </div>
        <div className="grid gap-2 sm:grid-cols-2">
          {AI_PROVIDERS.map((option) => (
            <button
              key={option.id}
              type="button"
              onClick={() => chooseProvider(option.id)}
              aria-pressed={option.id === provider}
              className={cn(
                "rounded-lg border px-4 py-3 text-left text-sm font-medium text-fg transition-colors hover:border-accent-solid hover:bg-subtle",
                option.id === provider ? "border-accent-solid bg-accent-soft" : "border-border bg-surface",
              )}
            >
              {option.name}
            </button>
          ))}
        </div>
        {saved && (
          <div className="flex justify-end">
            <Button className={ACTION_CLASS} onClick={cancelChange}>
              {t.common.cancel}
            </Button>
          </div>
        )}
      </div>
    );
  }

  const chosen = AI_PROVIDERS.find((option) => option.id === provider)!;
  return (
    <form
      className="space-y-4"
      onSubmit={(event) => {
        event.preventDefault();
        if (apiKey.trim() && busy === null) void verify(chosen.id, apiKey.trim());
      }}
    >
      <div className="flex items-center justify-between gap-3">
        <p className="text-sm font-medium text-fg">{t.settings.providerSelected(chosen.name)}</p>
        <Button size="sm" variant="ghost" onClick={backToProviders} disabled={busy !== null}>
          {t.settings.back}
        </Button>
      </div>
      <div className="space-y-2">
        <label htmlFor={keyInputId} className="block text-sm font-medium text-fg">
          {t.settings.apiKeyFor(chosen.name)}
        </label>
        <Input
          id={keyInputId}
          name="ankileet-ai-provider-key"
          type="text"
          value={apiKey}
          onChange={(event) => {
            setApiKey(event.target.value);
            if (result?.kind === "err") setResult(null);
          }}
          placeholder={chosen.keyPlaceholder}
          autoComplete="off"
          autoCorrect="off"
          autoCapitalize="none"
          spellCheck={false}
          data-lpignore="true"
          data-1p-ignore="true"
          data-form-type="other"
          style={apiKey ? ({ WebkitTextSecurity: "disc" } as React.CSSProperties) : undefined}
          className="font-mono"
        />
        <a href={chosen.keyUrl} target="_blank" rel="noreferrer" className="inline-block text-sm text-accent hover:underline">
          {t.settings.getKey(chosen.name)}
        </a>
      </div>
      <p className="text-xs leading-5 text-muted">{t.settings.verifyHelp}</p>
      <div className="flex flex-wrap items-center justify-end gap-2 border-t border-border pt-4">
        {saved && (
          <Button className={ACTION_CLASS} onClick={cancelChange} disabled={busy !== null}>
            {t.common.cancel}
          </Button>
        )}
        <Button type="submit" variant="primary" className={ACTION_CLASS} disabled={busy !== null || !apiKey.trim()}>
          {busy === "verify" ? (
            <>
              <Spinner />
              {t.settings.verifying}
            </>
          ) : (
            t.settings.verifyAndSave
          )}
        </Button>
      </div>
      {message}
    </form>
  );
}
