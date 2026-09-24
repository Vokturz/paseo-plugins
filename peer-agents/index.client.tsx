import type { PluginClientContext } from "@getpaseo/plugin/client";
import { PeerMessageCard, parsePeerMessage, peerMessageSchema } from "./client/peer-message";
import { PeerTaskCard, parsePeerTask, peerTaskSchema } from "./client/peer-task";
import { PeerCreationCard, parsePeerCreation, peerCreationSchema } from "./client/peer-creation";

export default function contribute(client: PluginClientContext) {
  client.addTimelineTransformer({
    id: "peer-creation",
    query: { itemType: "tool_call" },
    transform({ item }) {
      const creation = parsePeerCreation(item);
      if (!creation) return undefined;
      return { items: [{ type: "plugin", kind: "peer-creation", version: 1, data: {
        status: creation.status,
        agentId: creation.agentId,
        workspaceId: creation.workspaceId,
        projectName: creation.projectName,
        task: creation.task,
        title: creation.title,
      } }] };
    },
  });
  client.addTimelineRenderer({
    kind: "peer-creation",
    version: 1,
    schema: peerCreationSchema,
    Component: PeerCreationCard,
  });
  client.addTimelineTransformer({
    id: "peer-task",
    query: { itemType: "user_message" },
    transform({ item }) {
      const task = parsePeerTask(item.text);
      if (!task) return undefined;
      return { items: [{ type: "plugin", kind: "peer-task", version: 1, data: { creatorAgentId: task.creatorAgentId, task: task.task } }] };
    },
  });
  client.addTimelineRenderer({
    kind: "peer-task",
    version: 1,
    schema: peerTaskSchema,
    Component: PeerTaskCard,
  });
  client.addTimelineTransformer({
    id: "peer-message",
    query: { itemType: "user_message" },
    transform({ item }) {
      const message = parsePeerMessage(item.text);
      if (!message) return undefined;
      return { items: [{ type: "plugin", kind: "peer-message", version: 1, data: { fromAgentId: message.fromAgentId, message: message.message } }] };
    },
  });
  client.addTimelineRenderer({
    kind: "peer-message",
    version: 1,
    schema: peerMessageSchema,
    Component: PeerMessageCard,
  });
  return () => {};
}
