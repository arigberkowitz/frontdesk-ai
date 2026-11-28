/**
 * Outbound AI calls through Retell, in one place.
 *
 * Prod, 27 Nov 2026 6:44 PM PT: "Call my phone" failed for the test business
 * with `400 No outbound agent id set up for phone number.` We only ever bound
 * the AI to a number as an INBOUND agent, and Retell's create-phone-call needs
 * an outbound agent too — either bound to the number or passed per call as
 * `override_agent_id`. Every outbound path now passes the business's own agent
 * per call (so numbers bought before this fix work with no vendor change), and
 * new/re-synced numbers also get it bound as the outbound agent.
 */

/** Bind the business's agent as both the inbound and the outbound agent. */
export function agentBindings(agentId: string): {
  inbound_agents: Array<{ agent_id: string; weight: number }>;
  outbound_agents: Array<{ agent_id: string; weight: number }>;
} {
  return {
    inbound_agents: [{ agent_id: agentId, weight: 1 }],
    outbound_agents: [{ agent_id: agentId, weight: 1 }],
  };
}

/** The per-call agent. Does not bind anything to the number (Retell: one-time override). */
export function outboundAgent(agentId: string): { override_agent_id: string } {
  return { override_agent_id: agentId };
}

const GENERIC = "Couldn't place the call.";

/** Strip anything that looks like a credential and cap the length. */
function safeDetail(raw: string): string {
  return raw
    .replace(/\b(?:key|sk|rk|pk|bearer|token)[_\s:=-]*[A-Za-z0-9._-]{8,}/gi, "[redacted]")
    .replace(/\b[A-Za-z0-9_-]{32,}\b/g, "[redacted]")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 140);
}

/**
 * What to tell the owner when Retell refuses to place a call. Known causes get
 * a plain-English next step; anything else shows the provider's own words
 * (sanitised) instead of guessing "your number can't dial out".
 */
export function placeCallErrorMessage(err: unknown): string {
  const raw = err instanceof Error ? err.message : String(err ?? "");
  const m = raw.toLowerCase();
  if (/no outbound agent/.test(m)) {
    return `${GENERIC} Your AI's number isn't set up for outgoing calls yet. We're fixing that on our side; try again in a minute or tap Re-sync agent.`;
  }
  if (/402|payment|billing|insufficient|balance|credit/.test(m)) {
    return `${GENERIC} Calling is paused on our side while we sort out a billing issue with our phone provider. It's not you; we've been alerted.`;
  }
  if (/\b429\b|too many|concurren|rate.?limit/.test(m)) {
    return `${GENERIC} Too many calls are running at once. Try again in a minute.`;
  }
  if (/to_number|invalid.*(phone|number)|e\.?164|not.*(allowed|supported).*(country|destination)|only us numbers/.test(m)) {
    return `${GENERIC} That number can't be called from here. Use a full US number with the area code.`;
  }
  if (/from_number|phone number.*(not found|doesn't exist|does not exist)|404/.test(m)) {
    return `${GENERIC} Your AI's phone number isn't active with our phone provider. Re-sync your agent or contact support.`;
  }
  const detail = safeDetail(raw);
  return detail ? `${GENERIC} Our phone provider said: ${detail}` : GENERIC;
}
