import type { PluginClientContext } from "@getpaseo/plugin/client";
import { LinearTicketsSurface } from "./client/linear-tickets";

export default function contribute(client: PluginClientContext) {
  client.addSurface("linear-tickets", LinearTicketsSurface);
  // Sidebar and Command Center icons must be Lucide names: the host validates them with
  // resolvePluginIcon() and rejects anything else, so the Linear brand mark (used inside the
  // surface) cannot be rendered here. SquareKanban is the closest Lucide stand-in.
  client.addSidebarItem({ id: "linear-tickets", title: "Linear tickets", icon: "SquareKanban", surface: "linear-tickets" });
  client.addCommandCenterItem({
    id: "open-linear-tickets", title: "Open assigned Linear tickets", icon: "SquareKanban", context: "global",
    onSelect({ openSurface }) { openSurface("linear-tickets"); },
  });
  return () => {};
}
