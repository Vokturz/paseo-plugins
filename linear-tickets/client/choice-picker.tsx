import type { ReactNode } from "react";
import { useState } from "react";
import { Pressable, ScrollView, Text, TextInput, View } from "react-native";
import { Icon } from "@getpaseo/plugin/client/react-native";
import type { Tokens } from "./design";

export function ChoicePicker({ label, placeholder, options, value, onChange, t, disabled = false, leading, icon }: {
  label: string; placeholder: string; options: { id: string; label: string; description?: string }[];
  value: string; onChange: (id: string) => void; t: Tokens; disabled?: boolean; leading?: ReactNode; icon?: string;
}) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [hovered, setHovered] = useState<string | null>(null);
  const colors = t.colors;
  const selected = options.find((option) => option.id === value);
  const visible = options.filter((option) => `${option.label} ${option.description ?? ""}`.toLowerCase().includes(search.trim().toLowerCase()));
  return <View style={{ gap: 8 }}>
    <Pressable accessibilityRole="button" accessibilityLabel={`${label}: ${selected?.label ?? placeholder}`} accessibilityState={{ expanded: open, disabled }} disabled={disabled} onPress={() => setOpen(!open)}
      style={{ paddingHorizontal: 13, paddingVertical: 11, minHeight: 50, borderRadius: t.radius.md, borderWidth: 1, borderColor: open ? colors.accent : colors.border, backgroundColor: colors.surface0, opacity: disabled ? 0.5 : 1, flexDirection: "row", alignItems: "center", gap: 11 }}>
      {leading ?? (icon ? <Icon name={icon} size={17} color={selected ? colors.accent : colors.foregroundMuted} /> : null)}
      <View style={{ flex: 1, gap: 2, minWidth: 0 }}>
        <Text numberOfLines={1} style={{ color: selected ? colors.foreground : colors.foregroundMuted, fontSize: 14 }}>{selected?.label ?? placeholder}</Text>
        {!!selected?.description && <Text numberOfLines={1} style={{ color: colors.foregroundMuted, fontSize: 12 }}>{selected.description}</Text>}
      </View>
      <Icon name={open ? "ChevronUp" : "ChevronDown"} size={16} color={colors.foregroundMuted} />
    </Pressable>
    {open && !disabled && <View style={{ borderRadius: t.radius.lg, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface0, padding: 8, gap: 6 }}>
      {options.length > 6 && <View style={{ flexDirection: "row", alignItems: "center", gap: 8, paddingHorizontal: 10, borderRadius: t.radius.sm, backgroundColor: colors.surface1 }}>
        <Icon name="Search" size={14} color={colors.foregroundMuted} />
        <TextInput accessibilityLabel={`Search ${label.toLowerCase()}`} placeholder={`Search ${label.toLowerCase()}…`} placeholderTextColor={colors.foregroundMuted} value={search} onChangeText={setSearch} autoCapitalize="none" autoCorrect={false}
          style={{ color: colors.foreground, paddingVertical: 9, fontSize: 13, flex: 1, minWidth: 0 }} />
        {!!search && <Pressable accessibilityRole="button" accessibilityLabel="Clear search" onPress={() => setSearch("")}><Icon name="X" size={14} color={colors.foregroundMuted} /></Pressable>}
      </View>}
      <ScrollView style={{ maxHeight: 260 }} nestedScrollEnabled keyboardShouldPersistTaps="handled">
        {visible.map((option) => <Pressable key={option.id} accessibilityRole="button" accessibilityState={{ selected: option.id === value }} onPress={() => { onChange(option.id); setOpen(false); setSearch(""); }}
          onHoverIn={() => setHovered(option.id)} onHoverOut={() => setHovered(null)}
          style={{ paddingHorizontal: 10, paddingVertical: 9, borderRadius: t.radius.sm, backgroundColor: option.id === value ? colors.surface2 : hovered === option.id ? colors.surface1 : colors.surface0, gap: 2 }}>
          <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
            <Text numberOfLines={1} style={{ color: option.id === value ? colors.accent : colors.foreground, fontSize: 14, flex: 1 }}>{option.label}</Text>
            {option.id === value && <Icon name="Check" size={15} color={colors.accent} />}
          </View>
          {!!option.description && <Text numberOfLines={1} style={{ color: colors.foregroundMuted, fontSize: 12, paddingLeft: 2 }}>{option.description}</Text>}
        </Pressable>)}
        {!visible.length && <Text style={{ color: colors.foregroundMuted, padding: 12, fontSize: 13 }}>No matching {label.toLowerCase()}.</Text>}
      </ScrollView>
    </View>}
  </View>;
}