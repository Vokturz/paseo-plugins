import type { PluginSurfaceProps } from "@getpaseo/plugin/client";
import { usePaseo, useRpc, useSettings } from "@getpaseo/plugin/client";
import { Icon } from "@getpaseo/plugin/client/react-native";
import { useCallback, useEffect, useRef, useState } from "react";
import { ActivityIndicator, ScrollView, Text, TextInput, View } from "react-native";
import { MAX_REVIEW_PROMPT_LENGTH, reviewerSchema, reviewerSettings, type ReviewerConfig } from "../shared/reviewer";
import { defaultReviewPromptRpc } from "../shared/contracts";
import { ChoicePicker } from "./choice-picker";
import { tokensFor } from "./design";
import { Button, Callout, Divider, FieldLabel, ProviderMark, SectionHeading, Skeleton, SurfaceProvider } from "./ui";
import { loadReviewerModels, reasoningForModel, reviewerOptionsIssue, selectedReviewerModel, type ReviewerMode, type ReviewerModel } from "../shared/reviewer-models";

type ReviewerDraft = Omit<ReviewerConfig, "prompt"> & { prompt: string; useDefaultPrompt: boolean; revision: string };

export function ReviewerSetupSurface({ theme, layout, onBack }: PluginSurfaceProps & { onBack: () => void }) {
  const t = tokensFor(theme, layout);
  const c = t.colors;
  const paseo = usePaseo();
  const settings = useSettings(reviewerSettings);
  const getDefaultPrompt = useRpc(defaultReviewPromptRpc);
  const [draft, setDraft] = useState<ReviewerDraft | null>(null);
  const [defaultPrompt, setDefaultPrompt] = useState<string | null>(null);
  const [defaultError, setDefaultError] = useState<string | null>(null);
  const [defaultLoading, setDefaultLoading] = useState(true);
  const [models, setModels] = useState<ReviewerModel[]>([]);
  const [modes, setModes] = useState<Record<string, ReviewerMode[]>>({});
  const [modelsLoading, setModelsLoading] = useState(true);
  const [modelsError, setModelsError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const generation = useRef(0);

  useEffect(() => {
    if (settings.status === "ready" && !draft && (settings.values.prompt !== null || defaultPrompt !== null)) {
      setDraft({ ...settings.values, prompt: settings.values.prompt ?? defaultPrompt!, useDefaultPrompt: settings.values.prompt === null, revision: settings.revision });
    }
  }, [settings, draft, defaultPrompt]);

  const reloadDefaultPrompt = useCallback(async () => {
    setDefaultLoading(true); setDefaultError(null);
    try {
      const { prompt } = await getDefaultPrompt({});
      setDefaultPrompt(prompt);
      return prompt;
    } catch (error) {
      setDefaultError(error instanceof Error ? error.message : "Could not load the default review prompt.");
      return null;
    } finally { setDefaultLoading(false); }
  }, [getDefaultPrompt]);
  useEffect(() => { void reloadDefaultPrompt(); }, [reloadDefaultPrompt]);

  const reloadModels = useCallback(async () => {
    const request = ++generation.current;
    setModelsLoading(true); setModelsError(null);
    try {
      const result = await loadReviewerModels(paseo.providers);
      if (generation.current !== request) return;
      setModels(result.models);
      setModes(result.modes);
      const failures = [
        result.failedProviders.length ? `Could not load models for ${result.failedProviders.join(", ")}.` : "",
        result.failedModeProviders.length ? `Could not load agent modes for ${result.failedModeProviders.join(", ")}.` : "",
      ].filter(Boolean);
      if (failures.length) setModelsError(`${failures.join(" ")} Reload to try again.`);
    } catch (error) {
      if (generation.current === request) setModelsError(error instanceof Error ? error.message : "Could not load models.");
    } finally { if (generation.current === request) setModelsLoading(false); }
  }, [paseo]);

  useEffect(() => {
    void reloadModels();
    return () => { generation.current++; };
  }, [reloadModels]);

  const change = (patch: Partial<ReviewerDraft>) => {
    setDraft((current) => current ? { ...current, ...patch } : null);
    setSaved(false); setError(null);
  };
  const activeModel = draft ? selectedReviewerModel(models, draft) : null;
  const activeModes = draft?.provider ? modes[draft.provider] ?? [] : [];
  const thinkingOptions = activeModel?.thinkingOptions ?? [];
  const defaultThinking = thinkingOptions.find((option) => option.id === activeModel?.defaultThinkingOptionId) ?? thinkingOptions.find((option) => option.isDefault);
  const optionsIssue = draft && !modelsLoading ? reviewerOptionsIssue(draft, activeModel, activeModes) : null;
  const unavailableMode = draft?.modeId && !activeModes.some((mode) => mode.id === draft.modeId) ? draft.modeId : null;
  const unavailableThinking = draft?.thinkingOptionId && !thinkingOptions.some((option) => option.id === draft.thinkingOptionId) ? draft.thinkingOptionId : null;
  const providers = [...new Set(models.map((model) => model.provider))];
  const conflict = settings.status === "ready" && draft !== null && settings.revision !== draft.revision;
  const canSave = Boolean(draft && activeModel && !modelsLoading && settings.status === "ready" && !settings.saving && !conflict && !optionsIssue && draft.prompt.trim());

  const save = async () => {
    if (!draft || !canSave) return;
    const parsed = reviewerSchema.safeParse({ ...draft, prompt: draft.useDefaultPrompt ? null : draft.prompt });
    if (!parsed.success) { setError(parsed.error.issues[0].message); return; }
    setError(null); setSaved(false);
    if (await settings.save(parsed.data, draft.revision)) { setDraft(null); setSaved(true); }
  };

  const readyMessage = !draft?.provider || !draft.model ? "Choose a provider and model."
    : !activeModel ? "Choose an available model." : optionsIssue ? "Choose available agent mode and reasoning options." : !draft.prompt.trim() ? "Add review instructions." : "Model selected. Ready to save.";

  return <SurfaceProvider t={t} busy={settings.saving}><ScrollView style={{ flex: 1, backgroundColor: c.surface0 }} keyboardShouldPersistTaps="handled"
    contentContainerStyle={{ padding: layout.compact ? 16 : 28, gap: layout.compact ? 18 : 22, width: "100%", maxWidth: 1280, alignSelf: "center" }}>
      <View style={{ flexDirection: "row", flexWrap: "wrap", alignItems: "center", justifyContent: "space-between", gap: 16, paddingBottom: 20, borderBottomWidth: 1, borderBottomColor: c.border }}>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 15, flex: 1, minWidth: 230 }}>
          <View style={{ width: 52, height: 52, borderRadius: 17, backgroundColor: c.surface1, borderWidth: 1, borderColor: c.border, alignItems: "center", justifyContent: "center" }}>
            <Icon name="GitPullRequest" size={26} color={c.accent} />
          </View>
          <View style={{ gap: 3, flex: 1 }}>
            <Text style={{ ...t.eyebrow, textTransform: "uppercase" }}>GitHub · Code review</Text>
            <Text accessibilityRole="header" style={t.title}>Reviewer setup</Text>
            <Text style={t.muted}>Choose who reviews and what to look for.</Text>
          </View>
        </View>
        <Button title="Back to pull requests" icon="ArrowLeft" onPress={onBack} />
      </View>

      {settings.status === "loading" && <View style={{ flexDirection: "row", alignItems: "center", gap: 9 }}>
        <ActivityIndicator accessibilityLabel="Loading reviewer settings" color={c.accent} /><Text style={t.muted}>Loading reviewer settings…</Text>
      </View>}
      {defaultError && <Callout t={t} tone="danger" message={defaultError} action={<Button title="Reload default prompt" icon="RefreshCw" size="sm" disabled={defaultLoading} onPress={() => void reloadDefaultPrompt()} />} />}
      {!draft && settings.status === "ready" && defaultLoading && <Text style={t.muted}>Loading default review prompt…</Text>}
      {(settings.status === "error" || settings.status === "invalid") && <View style={{ gap: 10 }}>
        <Callout t={t} tone="danger" message={settings.error} />
        <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
          <Button title="Reload reviewer settings" icon="RefreshCw" size="sm" onPress={() => void settings.reload()} />
          {settings.status === "invalid" && <Button title="Reset reviewer settings" icon="RotateCcw" size="sm" onPress={() => void settings.reset()} />}
        </View>
      </View>}

      {draft && <View style={{ flexDirection: layout.compact ? "column" : "row", gap: 18, alignItems: "flex-start" }}>
        <View style={{ ...t.card, gap: 14, flex: layout.compact ? undefined : 1, width: layout.compact ? "100%" : undefined, minWidth: 0 }}>
          <SectionHeading title="Set your reviewer up" subtitle="Choose who takes the lead." icon="Bot" t={t} />
          {modelsError && <Callout t={t} message={modelsError} action={<Button title="Reload" icon="RefreshCw" size="sm" disabled={modelsLoading} onPress={() => void reloadModels()} />} />}
          <FieldLabel title="Provider" icon="Bot" hint={`${models.length} model${models.length === 1 ? "" : "s"} available`} t={t} />
          <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
            {providers.map((provider) => <Button key={provider} leading={<ProviderMark provider={provider} theme={theme} size={15} />}
              title={`${provider} · ${models.filter((model) => model.provider === provider).length}`} chosen={draft.provider === provider} disabled={modelsLoading}
              onPress={() => { if (draft.provider !== provider) change({ provider, model: null, modeId: null, thinkingOptionId: null }); }} />)}
          </View>
          {modelsLoading && <View accessibilityLabel="Loading reviewer models" style={{ gap: 9 }}><Skeleton t={t} width="40%" height={12} /><Skeleton t={t} width="100%" height={48} radius={10} /></View>}
          {!modelsLoading && !models.length && <Callout t={t} tone="info" message="Configure an agent provider in Paseo, then reload the models." />}
          {draft.provider && draft.model && !activeModel && !modelsLoading && <Callout t={t} message={`Saved model ${draft.provider} / ${draft.model} is unavailable. Reload models or choose another.`} />}
          {draft.provider && <>
            <FieldLabel title="Model" icon="Cpu" t={t} />
            <ChoicePicker key={draft.provider} label="Models" icon="Cpu" placeholder="Choose a model" t={t}
              options={models.filter((model) => model.provider === draft.provider).map((model) => ({ ...model, description: [model.id, model.description].filter(Boolean).join(" · ") }))}
              value={draft.model ?? ""} onChange={(model) => change({ model, thinkingOptionId: reasoningForModel(models.find((candidate) => candidate.provider === draft.provider && candidate.id === model) ?? null, draft.thinkingOptionId) })}
              leading={<ProviderMark provider={draft.provider} theme={theme} size={15} />} disabled={settings.saving || modelsLoading} />
            {(activeModes.length > 0 || draft.modeId !== null) && <>
              <FieldLabel title="Agent mode" icon="SlidersHorizontal" t={t} />
              <ChoicePicker label="Modes" icon="SlidersHorizontal" placeholder="Use provider default" t={t}
                options={[{ id: "", label: "Provider default", description: "Use the default mode configured in Paseo." }, ...activeModes,
                  ...(unavailableMode ? [{ id: unavailableMode, label: `Unavailable: ${unavailableMode}` }] : [])]}
                value={draft.modeId ?? ""} onChange={(modeId) => change({ modeId: modeId || null })} disabled={settings.saving || modelsLoading} />
            </>}
            {(thinkingOptions.length > 0 || draft.thinkingOptionId !== null) && <>
              <FieldLabel title="Reasoning" icon="BrainCircuit" t={t} />
              <ChoicePicker label="Reasoning" icon="BrainCircuit" placeholder="Use model default" t={t}
                options={[{ id: "", label: "Model default", description: defaultThinking ? `Use ${defaultThinking.label}.` : "Use the model's default reasoning." }, ...thinkingOptions,
                  ...(unavailableThinking ? [{ id: unavailableThinking, label: `Unavailable: ${unavailableThinking}` }] : [])]}
                value={draft.thinkingOptionId ?? ""} onChange={(thinkingOptionId) => change({ thinkingOptionId: thinkingOptionId || null })} disabled={settings.saving || modelsLoading} />
              <Text style={t.muted}>Reasoning levels come directly from this model’s Paseo provider.</Text>
            </>}
            {optionsIssue && <Callout t={t} message={optionsIssue} />}
          </>}
          <Button title="Reload models" icon="RefreshCw" size="sm" disabled={modelsLoading} onPress={() => void reloadModels()} />
          <Divider t={t} spaced />
          <View style={{ flexDirection: "row", alignItems: "center", gap: 7 }}>
            <Icon name="HardDrive" size={13} color={c.foregroundMuted} />
            <Text style={{ ...t.muted, flex: 1 }}>Saved on this host and shared across both PR lists.</Text>
          </View>
        </View>

        <View style={{ ...t.card, gap: 14, flex: layout.compact ? undefined : 1, width: layout.compact ? "100%" : undefined, minWidth: 0 }}>
          <SectionHeading title="Review instructions" subtitle="Tell the reviewer what matters for your code." icon="PenLine" t={t} />
          <FieldLabel title="Review prompt" icon="MessageSquare" t={t} />
          <Text style={t.muted}>{draft.useDefaultPrompt ? "Using DEFAULT_REVIEW_PROMPT.md. Reviews read the current file at launch and may publish confirmed findings to GitHub." : "Using your custom prompt. It controls the review instructions and GitHub publication."}</Text>
          <TextInput accessibilityLabel="Review prompt" value={draft.prompt} onChangeText={(prompt) => change({ prompt, useDefaultPrompt: false })} multiline textAlignVertical="top"
            editable={!settings.saving} maxLength={MAX_REVIEW_PROMPT_LENGTH} placeholder="How the reviewer should examine this pull request…" placeholderTextColor={c.foregroundMuted}
            style={{ ...t.input, ...t.mono, minHeight: 300, textAlignVertical: "top" }} />
          <View style={{ flexDirection: "row", flexWrap: "wrap", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
            <Text style={t.muted}>{draft.prompt.length.toLocaleString()} / {MAX_REVIEW_PROMPT_LENGTH.toLocaleString()} characters</Text>
            <Button title="Restore default prompt" icon="RotateCcw" size="sm" disabled={defaultLoading} onPress={() => void reloadDefaultPrompt().then((prompt) => { if (prompt !== null) change({ prompt, useDefaultPrompt: true }); })} />
          </View>
          {conflict && <Callout t={t} message="Reviewer settings changed in another client. Discard your changes to load the latest saved setup." />}
          {error && <Callout t={t} tone="danger" message={error} />}
          {settings.saveError && <Callout t={t} tone="danger" message={settings.saveError} action={<Button title="Reload" icon="RefreshCw" size="sm" onPress={() => void settings.reload()} />} />}
          <View style={{ borderTopWidth: 1, borderTopColor: c.border, paddingTop: 16, marginTop: 4, gap: 12 }}>
            <View accessibilityLiveRegion="polite" style={{ flexDirection: "row", alignItems: "center", gap: 7 }}>
              <Icon name={saved || canSave ? "CircleCheck" : "CircleDashed"} size={14} color={saved || canSave ? c.statusSuccess : c.foregroundMuted} />
              <Text style={{ ...t.muted, flex: 1 }}>{saved ? "Reviewer setup saved locally." : readyMessage}</Text>
            </View>
            <Button title={settings.saving ? "Saving…" : "Save reviewer setup"} icon="Check" primary stretch disabled={!canSave} onPress={() => void save()} />
            <Button title="Discard changes" icon="Undo2" size="sm" onPress={() => { setDraft(null); setError(null); setSaved(false); }} />
          </View>
        </View>
      </View>}
  </ScrollView></SurfaceProvider>;
}
