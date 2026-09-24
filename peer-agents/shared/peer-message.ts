export interface PeerMessage {
  fromAgentId: string;
  message: string;
}

export function parsePeerMessage(text: string): PeerMessage | null {
  const match = /^Peer agent ([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}) says:\n\n([\s\S]*)$/i.exec(text);
  return match ? { fromAgentId: match[1], message: match[2] } : null;
}
