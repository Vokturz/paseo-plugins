import type { PluginSurfaceProps, SettingsState } from "@getpaseo/plugin/client";
import { useState, type ReactNode } from "react";
import { Icon } from "@getpaseo/plugin/client/react-native";
import { Pressable, Text, View } from "react-native";
import { filterSummary, filtersSchema, timeWindowOptions, type Filters } from "../shared/filters";
import { ChoiceGrid, FilterChoice } from "./filter-choice";
import { OwnerPicker } from "./owner-picker";

type Props = { theme: PluginSurfaceProps["theme"]; settings: SettingsState<typeof filtersSchema>; leading?: ReactNode };
type Draft = Filters & { revision: string };

export function FiltersPanel({ theme, settings, leading }: Props) {
  const c = theme.colors;
  const [draft, setDraft] = useState<Draft | null>(null);
  const [error, setError] = useState<string | null>(null);
  const button = (label: string, action: () => void, disabled = false, selected = false) => <Pressable accessibilityRole="button" accessibilityLabel={label}
    accessibilityState={{ disabled, selected }} disabled={disabled} onPress={action}
    style={({ pressed }) => ({ alignSelf: "flex-start", minHeight: 38, justifyContent: "center", paddingHorizontal: 12, borderRadius: 9, borderWidth: 1,
      borderColor: selected ? c.accent : c.border, backgroundColor: selected || pressed ? c.surface2 : c.surface1, opacity: disabled ? 0.45 : 1 })}>
    <Text style={{ color: selected ? c.accent : c.foreground, fontSize: 13, fontWeight: "600" }}>{label}</Text>
  </Pressable>;
  const save = async () => {
    if (!draft) return;
    setError(null);
    try {
      const parsed = filtersSchema.safeParse(draft);
      if (!parsed.success) { setError(parsed.error.issues[0].message); return; }
      if (await settings.save(parsed.data, draft.revision)) setDraft(null);
    } catch (error) { setError(error instanceof Error ? error.message : "Could not save filters."); }
  };

  const summary = settings.status === "ready" ? `${settings.values.owners.length === 0 ? "All owners" : settings.values.owners.length === 1 ? settings.values.owners[0] : `${settings.values.owners.length} owners`} · ${settings.values.days === null ? "Any time" : `${settings.values.dateField === "created" ? "Created" : "Updated"}: last ${settings.values.days}d`}` : "Filters";
  return <View style={{ gap: 10 }}>
    <View style={{ flexDirection: "row", alignItems: "flex-start", flexWrap: "wrap", gap: 8 }}>
      {leading}
      {settings.status === "ready" && <Pressable accessibilityRole="button" accessibilityLabel={`${draft ? "Close" : "Edit"} filters: ${filterSummary(settings.values)}`}
        accessibilityState={{ expanded: Boolean(draft), disabled: settings.saving }} disabled={settings.saving}
        onPress={() => { setError(null); setDraft(draft ? null : { ...settings.values, revision: settings.revision }); }}
        style={({ pressed }) => ({ flexDirection: "row", alignItems: "center", gap: 7, maxWidth: "100%", minHeight: 40, paddingHorizontal: 11,
          borderRadius: 10, borderWidth: 1, borderColor: draft ? c.accent : c.border, backgroundColor: pressed || draft ? c.surface2 : c.surface1, opacity: settings.saving ? 0.5 : 1 })}>
        <Icon name="SlidersHorizontal" size={14} color={c.foregroundMuted} />
        <Text numberOfLines={1} style={{ color: c.foregroundMuted, fontSize: 12, flexShrink: 1 }}>{draft ? "Close filters" : summary}</Text>
        <Icon name={draft ? "ChevronUp" : "ChevronDown"} size={13} color={c.foregroundMuted} />
      </Pressable>}
      {settings.status === "loading" && <Text style={{ color: c.foregroundMuted, fontSize: 12, paddingVertical: 12 }}>Loading filters…</Text>}
    </View>
    {(draft || settings.status === "error" || settings.status === "invalid" || settings.saveError) && <View style={{ borderWidth: 1, borderColor: c.border, backgroundColor: c.surface1, borderRadius: 12, padding: 16, gap: 12 }}>
      <Text style={{ color: c.foreground, fontSize: 14, fontWeight: "600" }}>Filters</Text>
      <Text style={{ color: c.foregroundMuted, fontSize: 12, lineHeight: 19 }}>Saved locally on this Paseo host. Applies to both PR lists.</Text>
      {(settings.status === "error" || settings.status === "invalid") && <>
        <Text accessibilityRole="alert" style={{ color: c.statusDanger }}>{settings.error}</Text>
        <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
          {button("Retry loading filters", () => void settings.reload(), settings.saving)}
          {settings.status === "invalid" && button("Reset saved filters", () => void settings.reset(), settings.saving)}
        </View>
      </>}
      {draft && <>
        <Text style={{ color: c.foreground, fontSize: 13, fontWeight: "600" }}>Organizations or users</Text>
        <OwnerPicker theme={theme} selected={draft.owners} onChange={(owners) => setDraft({ ...draft, owners })} disabled={settings.saving} />
        <Text style={{ color: c.foreground, fontSize: 13, fontWeight: "600" }}>Time window</Text>
        <View accessibilityRole="radiogroup" accessibilityLabel="Date field">
          <ChoiceGrid>
            <FilterChoice theme={theme} label="Updated" icon="RefreshCw" radio checked={draft.dateField === "updated"} onPress={() => setDraft({ ...draft, dateField: "updated" })} disabled={settings.saving} />
            <FilterChoice theme={theme} label="Created" icon="Calendar" radio checked={draft.dateField === "created"} onPress={() => setDraft({ ...draft, dateField: "created" })} disabled={settings.saving} />
          </ChoiceGrid>
        </View>
        <View accessibilityRole="radiogroup" accessibilityLabel="Time window">
          <ChoiceGrid>
            {timeWindowOptions(settings.status === "ready" ? settings.values.days : draft.days).map((option) => <FilterChoice key={option.days ?? "any"} theme={theme} label={option.label}
              radio checked={draft.days === option.days} onPress={() => setDraft({ ...draft, days: option.days })} disabled={settings.saving} />)}
          </ChoiceGrid>
        </View>
        {settings.status === "ready" && settings.revision !== draft.revision && <Text accessibilityRole="alert" style={{ color: c.statusWarning }}>Saved filters changed while you were editing. Cancel and reopen to edit the latest values.</Text>}
        {error && <Text accessibilityRole="alert" style={{ color: c.statusDanger }}>{error}</Text>}
        <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
          {button(settings.saving ? "Saving…" : "Save filters", () => void save(), settings.saving || settings.status !== "ready" || settings.revision !== draft.revision)}
          {button("Cancel", () => { setDraft(null); setError(null); }, settings.saving)}
          {button("Clear filters", () => setDraft({ ...draft, owners: [], days: null, dateField: "updated" }), settings.saving)}
        </View>
      </>}
      {settings.saveError && <>
        <Text accessibilityRole="alert" style={{ color: c.statusDanger }}>{settings.saveError}</Text>
        {button("Reload saved filters", () => void settings.reload(), settings.saving)}
      </>}
    </View>}
  </View>;
}
