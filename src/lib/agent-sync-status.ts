/**
 * Client-safe helper for the live-receptionist status line. Kept out of
 * agent-publish.ts because that module is server-only.
 */
export type AgentSyncUiState = "none" | "up_to_date" | "failed";

export function agentSyncUiState(client: {
  retellAgentId: string | null;
  setupFlags?: { agentSyncFailedAt?: string | null } | null;
}): AgentSyncUiState {
  if (!client.retellAgentId) return "none";
  if (client.setupFlags?.agentSyncFailedAt) return "failed";
  return "up_to_date";
}
