import { describe, expect, it } from "vitest";
import { agentSyncUiState } from "./agent-sync-status";

describe("agentSyncUiState", () => {
  it("is none when there is no live agent", () => {
    expect(agentSyncUiState({ retellAgentId: null })).toBe("none");
    expect(agentSyncUiState({ retellAgentId: null, setupFlags: { agentSyncFailedAt: "2026-11-27T00:00:00.000Z" } })).toBe(
      "none",
    );
  });

  it("is up_to_date when the agent exists and the last push succeeded", () => {
    expect(agentSyncUiState({ retellAgentId: "ag_1" })).toBe("up_to_date");
    expect(agentSyncUiState({ retellAgentId: "ag_1", setupFlags: { agentSyncFailedAt: null } })).toBe(
      "up_to_date",
    );
  });

  it("is failed when the last push was recorded as a failure", () => {
    expect(
      agentSyncUiState({
        retellAgentId: "ag_1",
        setupFlags: { agentSyncFailedAt: "2026-11-27T00:00:00.000Z" },
      }),
    ).toBe("failed");
  });
});
