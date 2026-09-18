import type { PluginClientContext } from "@getpaseo/plugin/client";
import { LinearTicketsSurface } from "./client/linear-tickets";

export default function contribute(client: PluginClientContext) {
  client.addSurface("linear-tickets", LinearTicketsSurface);
  client.addSidebarItem({ id: "linear-tickets", title: "Linear tickets", icon: "ListTodo", surface: "linear-tickets" });
  client.addCommandCenterItem({
    id: "open-linear-tickets", title: "Open assigned Linear tickets", icon: "ListTodo", context: "global",
    onSelect({ openSurface }) { openSurface("linear-tickets"); },
  });
  return () => {};
}
