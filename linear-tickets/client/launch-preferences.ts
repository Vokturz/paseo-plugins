export type LaunchPreference = { model: string; modeId?: string; thinkingOptionId?: string };
export type LaunchModel = {
  id: string;
  provider: string;
  thinkingOptions: { id: string; isDefault?: boolean }[];
  defaultThinkingOptionId?: string;
};

export function restoreLaunchSelection(
  provider: string,
  preference: LaunchPreference | undefined,
  models: LaunchModel[],
  modes: Record<string, { id: string }[]>,
) {
  const model = preference && models.find((candidate) => candidate.provider === provider && candidate.id === preference.model);
  if (!model) return { model: "", modeId: "", thinkingOptionId: "" };
  const modeId = preference.modeId && modes[provider]?.some((mode) => mode.id === preference.modeId) ? preference.modeId : "";
  const savedThinking = preference.thinkingOptionId;
  const thinkingOptionId = savedThinking && model.thinkingOptions.some((option) => option.id === savedThinking)
    ? savedThinking
    : model.defaultThinkingOptionId ?? model.thinkingOptions.find((option) => option.isDefault)?.id ?? "";
  return { model: model.id, modeId, thinkingOptionId };
}
