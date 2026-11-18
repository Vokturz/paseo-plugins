import { Linking, Pressable, Text, View } from "react-native";
import { Icon } from "@getpaseo/plugin/client/react-native";
import type { CustomerRequest } from "../shared/contracts";
import type { Tokens } from "./design";
import { openExternalUrl } from "./open-link";
import { FieldLabel, LabelChip } from "./ui";

/** Customer requests on the ticket and on its project, with links back to the customer and the source. */
export function CustomerRequests({ t, requests, platform }: { t: Tokens; requests: CustomerRequest[]; platform: string }) {
  if (!requests.length) return null;
  const open = (url: string) => { if (/^https:\/\//.test(url)) void openExternalUrl(url, { platform, linking: Linking }); };
  return <View style={{ gap: 8 }}>
    <FieldLabel title="Customer requests" icon="Building2" hint={`${requests.length}`} t={t} />
    {requests.map((request) => <View key={request.id} style={{ gap: 6, borderWidth: 1, borderColor: t.colors.border, borderRadius: 10, padding: 10, backgroundColor: t.colors.surface0 }}>
      <View style={{ flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: 8 }}>
        <Pressable accessibilityRole="link" accessibilityLabel={`Open customer ${request.customer || "Unknown customer"} in Linear`} disabled={!request.customerUrl} onPress={() => open(request.customerUrl)}>
          <Text style={{ ...t.strong, color: request.customerUrl ? t.colors.accent : t.colors.foreground }}>{request.customer || "Unknown customer"}</Text>
        </Pressable>
        {!!request.tier && <LabelChip label={request.tier} t={t} />}
        {request.important && <LabelChip label="Important" icon="Star" color={t.colors.statusWarning} t={t} />}
        {request.source === "project" && <LabelChip label="On the project" icon="Folder" t={t} />}
        <View style={{ flex: 1 }} />
        {/^https:\/\//.test(request.url) && <Pressable accessibilityRole="link" accessibilityLabel="Open the request's source" onPress={() => open(request.url)} style={({ pressed }) => ({ minWidth: t.touchTarget, minHeight: t.touchTarget, alignItems: "center", justifyContent: "center", opacity: pressed ? 0.6 : 1 })}>
          <Icon name="ExternalLink" size={14} color={t.colors.foregroundMuted} />
        </Pressable>}
      </View>
      {!!request.content && <Text numberOfLines={4} style={t.muted}>{request.content}</Text>}
    </View>)}
  </View>;
}
