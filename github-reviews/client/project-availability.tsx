import type { PluginSurfaceProps } from "@getpaseo/plugin/client";
import { Icon } from "@getpaseo/plugin/client/react-native";
import { Text, View } from "react-native";
import type { RepositoryProjects } from "../shared/projects";

export function ProjectAvailability({ theme, match }: { theme: PluginSurfaceProps["theme"]; match?: RepositoryProjects }) {
  const c = theme.colors;
  if (match?.status === "available") return <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 6 }}>
    {match.projects.map((project) => <View key={project.projectId} accessibilityLabel={`Local project ${project.name}, ${project.path}`}
      style={{ flexDirection: "row", alignItems: "center", gap: 5, maxWidth: "100%", borderRadius: 8, paddingHorizontal: 8, paddingVertical: 4, backgroundColor: c.surface2 }}>
      <Icon name="FolderCheck" size={13} color={c.statusSuccess} />
      <Text numberOfLines={1} style={{ color: c.foreground, fontSize: 12, flexShrink: 1 }}>Project: {project.name}</Text>
    </View>)}
  </View>;
  const unknown = !match || match.status === "unknown";
  return <View style={{ flexDirection: "row", alignItems: "center", gap: 5 }}>
    <Icon name={unknown ? "CircleHelp" : "Folder"} size={13} color={unknown ? c.statusWarning : c.foregroundMuted} />
    <Text style={{ color: unknown ? c.statusWarning : c.foregroundMuted, fontSize: 12 }}>{unknown ? "Project check unavailable" : "No local project"}</Text>
  </View>;
}
