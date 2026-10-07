import { readFileSync, existsSync } from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { describe, expect, it, vi } from "vitest";

/**
 * "Add to Home Screen" + the push service worker, checked as shipped files:
 * the manifest is installable (name, standalone, 192 + 512 + maskable icons
 * that really are those sizes), only the portal links it, and the service
 * worker shows pushes, opens only portal URLs on tap, and never intercepts
 * fetches (no cached business data).
 */

const ROOT = path.resolve(__dirname, "../../..");
const PUBLIC = path.join(ROOT, "public");
const manifest = JSON.parse(readFileSync(path.join(PUBLIC, "portal.webmanifest"), "utf8"));

function pngSize(file: string): [number, number] {
  const buf = readFileSync(file);
  expect(buf.subarray(1, 4).toString()).toBe("PNG");
  return [buf.readUInt32BE(16), buf.readUInt32BE(20)];
}

describe("portal web manifest", () => {
  it("has what browsers need to offer an install", () => {
    expect(manifest.name).toBe("FrontDesk AI");
    expect(manifest.short_name.length).toBeLessThanOrEqual(12); // fits under a home-screen icon
    expect(manifest.display).toBe("standalone");
    expect(manifest.start_url.startsWith("/portal")).toBe(true);
    expect(manifest.start_url.startsWith(manifest.scope)).toBe(true);
    // Light only, like the portal.
    expect(manifest.background_color).toBe("#f5f6fb");
    expect(manifest.theme_color).toBe("#f5f6fb");
  });

  it("ships real icons at the sizes it claims, including a maskable one", () => {
    const purposes = new Set<string>();
    for (const icon of manifest.icons as { src: string; sizes: string; purpose?: string }[]) {
      const file = path.join(PUBLIC, icon.src);
      expect(existsSync(file), icon.src).toBe(true);
      const [w, h] = pngSize(file);
      expect(`${w}x${h}`).toBe(icon.sizes);
      purposes.add(icon.purpose ?? "any");
    }
    expect(manifest.icons.some((i: { sizes: string }) => i.sizes === "192x192")).toBe(true);
    expect(manifest.icons.some((i: { sizes: string }) => i.sizes === "512x512")).toBe(true);
    expect(purposes.has("maskable")).toBe(true);
    expect(pngSize(path.join(PUBLIC, "icons/apple-touch-icon.png"))).toEqual([180, 180]);
  });

  it("is linked from the portal layout only", () => {
    const layout = readFileSync(path.join(ROOT, "src/app/portal/layout.tsx"), "utf8");
    expect(layout).toContain('manifest: "/portal.webmanifest"');
    expect(layout).toMatch(/appleWebApp:\s*\{\s*capable: true/);
    const root = readFileSync(path.join(ROOT, "src/app/layout.tsx"), "utf8");
    expect(root).not.toContain("webmanifest");
    expect(existsSync(path.join(ROOT, "src/app/manifest.ts"))).toBe(false);
  });

  it("static files bypass the auth proxy (browsers fetch manifests without cookies)", () => {
    const proxy = readFileSync(path.join(ROOT, "src/proxy.ts"), "utf8");
    const matcher = proxy.match(/"\/\(\(\?!_next\|(.*?)\)\.\*\)"/)?.[1] ?? "";
    expect(matcher).toContain("webmanifest");
    expect(matcher).toContain("js(?!on)");
    expect(matcher).toContain("png");
  });
});

describe("service worker (public/sw.js)", () => {
  function load() {
    const listeners: Record<string, (e: unknown) => void> = {};
    const showNotification = vi.fn(async () => {});
    const openWindow = vi.fn(async () => null);
    const self = {
      location: { origin: "https://app.test" },
      registration: { showNotification },
      clients: { matchAll: vi.fn(async () => []), openWindow, claim: vi.fn() },
      skipWaiting: vi.fn(),
      addEventListener: (type: string, fn: (e: unknown) => void) => {
        listeners[type] = fn;
      },
    };
    vm.runInNewContext(readFileSync(path.join(PUBLIC, "sw.js"), "utf8"), { self, URL });
    return { listeners, showNotification, openWindow };
  }

  it("never intercepts fetches", () => {
    expect(load().listeners.fetch).toBeUndefined();
  });

  it("shows the pushed notification and keeps its target inside /portal", async () => {
    const { listeners, showNotification } = load();
    let waited: Promise<unknown> = Promise.resolve();
    const payload = { title: "New booking: Sam", body: "Tue 2:00 PM", url: "https://evil.test/x", tag: "booking-1" };
    listeners.push({ data: { json: () => payload, text: () => "" }, waitUntil: (p: Promise<unknown>) => (waited = p) });
    await waited;
    expect(showNotification).toHaveBeenCalledWith(
      "New booking: Sam",
      expect.objectContaining({ body: "Tue 2:00 PM", tag: "booking-1", data: { url: "/portal" } }),
    );
  });

  it("a tap opens the notification's portal page", async () => {
    const { listeners, openWindow } = load();
    let waited: Promise<unknown> = Promise.resolve();
    listeners.notificationclick({
      notification: { close: vi.fn(), data: { url: "/portal/messages/14155550100" } },
      waitUntil: (p: Promise<unknown>) => (waited = p),
    });
    await waited;
    expect(openWindow).toHaveBeenCalledWith("/portal/messages/14155550100");
  });
});
