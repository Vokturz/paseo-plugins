import type { ReactNode } from "react";
import { useState } from "react";
import { Pressable, ScrollView, Text, TextInput, View } from "react-native";
import type { PluginSurfaceProps } from "@getpaseo/plugin/client";
import { Icon } from "@getpaseo/plugin/client/react-native";

export function ChoicePicker({ label, placeholder, options, value, onChange, theme, disabled = false, leading }: {
  label: string; placeholder: string; options: { id: string; label: string; description?: string }[];
  value: string; onChange: (id: string) => void; theme: PluginSurfaceProps["theme"]; disabled?: boolean; leading?: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const colors = theme.colors;
  const selected = options.find((option) => option.id === value);
  const visible = options.filter((option) => `${option.label} ${option.description ?? ""}`.toLowerCase().includes(search.trim().toLowerCase()));
  return <View style={{ gap: 8 }}>
    <Pressable accessibilityRole="button" accessibilityLabel={`${label}: ${selected?.label ?? placeholder}`} accessibilityState={{ expanded: open, disabled }} disabled={disabled} onPress={() => setOpen(!open)}
      style={{ padding: 14, minHeight: 52, borderRadius: 10, borderWidth: 1, borderColor: open ? colors.accent : colors.border, backgroundColor: colors.surface0, opacity: disabled ? 0.5 : 1, flexDirection: "row", alignItems: "center", gap: 12 }}>
      {leading ?? <Icon name={label === "Projects" ? "Folder" : label === "Branches" ? "GitBranch" : "Cpu"} size={18} color={selected ? colors.accent : colors.foregroundMuted} />}
      <View style={{ flex: 1, gap: 3 }}>
        <Text style={{ color: selected ? colors.foreground : colors.foregroundMuted, fontSize: 14 }}>{selected?.label ?? placeholder}</Text>
        {!!selected?.description && <Text numberOfLines={1} style={{ color: colors.foregroundMuted, fontSize: 12 }}>{selected.description}</Text>}
      </View>
      <Icon name={open ? "ChevronUp" : "ChevronDown"} size={16} color={colors.foregroundMuted} />
    </Pressable>
    {open && !disabled && <View style={{ borderRadius: 8, borderWidth: 1, borderColor: colors.surface2, backgroundColor: colors.surface0, padding: 8, gap: 6 }}>
      <View style={{ flexDirection: "row", alignItems: "center", paddingLeft: 10, borderRadius: 6, backgroundColor: colors.surface1 }}>
        <Icon name="Search" size={15} color={colors.foregroundMuted} />
        <TextInput accessibilityLabel={`Search ${label.toLowerCase()}`} placeholder={`Search ${label.toLowerCase()}…`} placeholderTextColor={colors.foregroundMuted} value={search} onChangeText={setSearch} autoCapitalize="none" autoCorrect={false}
          style={{ color: colors.foreground, padding: 10, flex: 1, minWidth: 0 }} />
      </View>
      <ScrollView style={{ maxHeight: 240 }} nestedScrollEnabled keyboardShouldPersistTaps="handled">
        {visible.map((option) => <Pressable key={option.id} accessibilityRole="button" accessibilityState={{ selected: option.id === value }} onPress={() => { onChange(option.id); setOpen(false); setSearch(""); }}
          style={{ padding: 10, borderRadius: 6, backgroundColor: option.id === value ? colors.surface2 : colors.surface0, gap: 3 }}>
          <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
            <Text style={{ color: option.id === value ? colors.accent : colors.foreground, fontSize: 14, flex: 1 }}>{option.label}</Text>
            {option.id === value && <Icon name="Check" size={15} color={colors.accent} />}
          </View>
          {!!option.description && <Text numberOfLines={1} style={{ color: colors.foregroundMuted, fontSize: 12 }}>{option.description}</Text>}
        </Pressable>)}
        {!visible.length && <Text style={{ color: colors.foregroundMuted, padding: 12 }}>No matching {label.toLowerCase()}.</Text>}
      </ScrollView>
    </View>}
  </View>;
}
