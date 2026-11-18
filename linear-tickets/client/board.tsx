import { useState } from "react";
import { Pressable, ScrollView, Text, View } from "react-native";
import type { Issue } from "../shared/contracts";
import type { Tokens } from "./design";
import { boardColumns } from "./board-columns";
import { formatIssueDate } from "./issue-list";
import { issueLabelChips } from "./label-tools";
import { Button, LabelChip, PriorityMark, StatusMark } from "./ui";

/** A column per workflow status, in the list's sort order, as a horizontally scrolling board. */
export function TicketBoard({ t, issues, countsByName, onOpen, onLoadAll, canLoadMore, disabled }: {
  t: Tokens; issues: Issue[]; countsByName: Record<string, number> | null; onOpen: (issue: Issue) => void;
  onLoadAll: () => void; canLoadMore: boolean; disabled: boolean;
}) {
  const [hovered, setHovered] = useState<string | null>(null);
  const colors = t.colors;
  const columns = boardColumns(issues, countsByName);
  const width = t.compact ? 272 : 304;
  return <ScrollView horizontal nestedScrollEnabled showsHorizontalScrollIndicator contentContainerStyle={{ gap: 14, paddingBottom: 8, alignItems: "flex-start" }}>
    {columns.map((column) => {
      const missing = column.total - column.issues.length;
      return <View key={column.name} accessibilityLabel={`${column.name}, ${column.total} tickets`} style={{ width, gap: 10 }}>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 8, paddingHorizontal: 4 }}>
          <StatusMark status={column.name} statusType={column.statusType} t={t} />
          <Text numberOfLines={1} style={{ ...t.heading, flexShrink: 1 }}>{column.name}</Text>
          <Text style={t.muted}>{column.total}</Text>
        </View>
        {column.issues.map((issue) => {
          const chips = issueLabelChips(issue);
          const customers = (issue.customers ?? []).map((customer) => customer.name);
          const active = hovered === issue.id;
          return <Pressable key={issue.id} accessibilityRole="button" accessibilityLabel={`View ${issue.identifier}: ${issue.title}`} disabled={disabled} onPress={() => onOpen(issue)}
            onHoverIn={() => setHovered(issue.id)} onHoverOut={() => setHovered(null)}
            style={({ pressed }) => ({ gap: 8, padding: 12, borderRadius: 12, borderWidth: 1, borderColor: active ? colors.accent : colors.border, backgroundColor: pressed || active ? colors.surface2 : colors.surface1 })}>
            <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
              <Text style={{ ...t.mono, color: colors.foregroundMuted }}>{issue.identifier}</Text>
              <PriorityMark priority={issue.priority} t={t} showLabel />
              <View style={{ flex: 1 }} />
              {issue.dueDate && <Text style={{ ...t.muted, fontSize: 11, color: colors.accent }}>Due {formatIssueDate(issue.dueDate)}</Text>}
            </View>
            <Text numberOfLines={3} style={{ ...t.strong, fontSize: 14 }}>{issue.title}</Text>
            {(!!issue.project || !!chips.length || !!customers.length) && <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 5 }}>
              {!!issue.project && <View style={{ ...t.chip, borderColor: colors.border }}><Text numberOfLines={1} style={{ color: colors.foregroundMuted, fontSize: 11 }}>{issue.project}</Text></View>}
              {chips.map((chip) => <LabelChip key={chip.label} label={chip.label} color={chip.color} t={t} />)}
              {!!customers.length && <LabelChip label={customers.join(", ")} icon="Building2" t={t} />}
            </View>}
            {(issue.blockingCount > 0 || issue.blockedByCount > 0) && <Text style={{ color: colors.accent, fontSize: 11, fontWeight: "700" }}>
              {[issue.blockingCount ? `Blocks ${issue.blockingCount}` : "", issue.blockedByCount ? `Blocked by ${issue.blockedByCount}` : ""].filter(Boolean).join(" · ")}
            </Text>}
          </Pressable>;
        })}
        {missing > 0 && <View style={{ gap: 6, padding: 10, borderRadius: 12, borderWidth: 1, borderStyle: "dashed", borderColor: colors.border }}>
          <Text style={t.muted}>{missing} more not loaded yet.</Text>
          {canLoadMore && <Button title="Load all tickets" icon="Layers" size="sm" onPress={onLoadAll} />}
        </View>}
        {!column.issues.length && missing <= 0 && <Text style={{ ...t.muted, paddingHorizontal: 4 }}>No tickets.</Text>}
      </View>;
    })}
  </ScrollView>;
}
