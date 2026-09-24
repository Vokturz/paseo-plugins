export interface PeerTask {
  creatorAgentId: string;
  task: string;
}

// Match the initial prompt sent by create_peer_agent. The agent still receives
// the full instructions; the chat timeline can present just the user's task.
export function parsePeerTask(text: string): PeerTask | null {
  const match = /^Your peer agent ID is ([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\. Use the send_peer_message tool to report progress, ask questions, and send your final result to that agent\.\n\nTask:\n([\s\S]*)$/i.exec(text);
  return match ? { creatorAgentId: match[1], task: match[2] } : null;
}
