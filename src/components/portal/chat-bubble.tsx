"use client";

import { useEffect } from "react";

/**
 * The chat bubble, everywhere in the portal, whenever the switch is on.
 *
 * Mounted from the portal layout so it survives navigation between pages —
 * the layout doesn't remount, so neither does the widget, and a conversation
 * started on Overview is still there on Settings. It loads the very same
 * `/widget.js` a customer's website loads, so what the owner sees here is
 * exactly what their visitors get.
 *
 * Off means gone: the layout doesn't render this at all, and the effect's
 * cleanup removes both the script and the bubble if the switch flips while
 * the page is open.
 */
export function ChatBubble({ clientId, appUrl }: { clientId: string; appUrl: string }) {
  useEffect(() => {
    if (document.getElementById("frontdesk-chat")) return;
    const s = document.createElement("script");
    s.src = `${appUrl}/widget.js`;
    s.async = true;
    s.setAttribute("data-client", clientId);
    document.body.appendChild(s);
    return () => {
      s.remove();
      document.getElementById("frontdesk-chat")?.remove();
    };
  }, [clientId, appUrl]);
  return null;
}
