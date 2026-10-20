import type { PaseoApi } from "@getpaseo/client";

export type ReviewerOption = { id: string; label: string; description?: string; isDefault?: boolean };
export type ReviewerModel = { provider: string; id: string; label: string; description?: string; thinkingOptions: ReviewerOption[]; defaultThinkingOptionId?: string };
export type ReviewerMode = { id: string; label: string; description?: string; icon?: string };
type ModelSource = Pick<PaseoApi["providers"], "listAvailable" | "listModels" | "listModes">;

export async function loadReviewerModels(source: ModelSource): Promise<{ models: ReviewerModel[]; modes: Record<string, ReviewerMode[]>; failedProviders: string[]; failedModeProviders: string[] }> {
  const available = await source.listAvailable();
  if (available.error) throw new Error(available.error);
  const providers = [...new Set(available.providers.filter((provider) => provider.available).map((provider) => provider.provider))];
  const results = await Promise.allSettled(providers.map(async (provider) => {
    const [modelResult, modeResult] = await Promise.allSettled([source.listModels(provider), source.listModes(provider)]);
    if (modelResult.status === "rejected") throw modelResult.reason;
    const result = modelResult.value;
    if (result.error) throw new Error(result.error);
    const models = (result.models ?? []).filter((model) => model.isSelectable !== false).map((model) => ({
      provider, id: model.id, label: model.label, description: model.description,
      thinkingOptions: model.thinkingOptions ?? [], defaultThinkingOptionId: model.defaultThinkingOptionId,
    }));
    const modeFailed = modeResult.status === "rejected" || Boolean(modeResult.value.error);
    const modes = modeResult.status === "fulfilled" && !modeResult.value.error ? (modeResult.value.modes ?? []).map((mode) => ({ id: mode.id, label: mode.label, description: mode.description, icon: mode.icon })) : [];
    return { provider, models, modes, modeFailed };
  }));
  const unique = new Map<string, ReviewerModel>();
  for (const result of results) if (result.status === "fulfilled") for (const model of result.value.models) {
    const key = JSON.stringify([model.provider, model.id]);
    if (!unique.has(key)) unique.set(key, model);
  }
  return {
    models: [...unique.values()],
    modes: Object.fromEntries(results.flatMap((result) => result.status === "fulfilled" ? [[result.value.provider, result.value.modes]] : [])),
    failedProviders: results.flatMap((result, index) => result.status === "rejected" ? [providers[index]] : []),
    failedModeProviders: results.flatMap((result) => result.status === "fulfilled" && result.value.modeFailed ? [result.value.provider] : []),
  };
}

export function reasoningForModel(model: ReviewerModel | null, thinkingOptionId: string | null): string | null {
  return thinkingOptionId && model?.thinkingOptions.some((option) => option.id === thinkingOptionId) ? thinkingOptionId : null;
}

export function reviewerOptionsIssue(selection: { modeId: string | null; thinkingOptionId: string | null }, model: ReviewerModel | null, modes: ReviewerMode[]): string | null {
  if (selection.modeId !== null && !modes.some((mode) => mode.id === selection.modeId)) return `Agent mode ${selection.modeId} is unavailable. Reload the choices or select another mode.`;
  if (selection.thinkingOptionId !== null && !model?.thinkingOptions.some((option) => option.id === selection.thinkingOptionId)) return `Reasoning option ${selection.thinkingOptionId} is unavailable for this model. Choose another reasoning option.`;
  return null;
}

export function selectedReviewerModel(models: ReviewerModel[], selection: { provider: string | null; model: string | null }): ReviewerModel | null {
  return models.find((model) => model.provider === selection.provider && model.id === selection.model) ?? null;
}
