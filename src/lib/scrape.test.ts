import { describe, expect, it } from "vitest";
import { isPrivateIp } from "./scrape";

describe("isPrivateIp (website import SSRF guard)", () => {
  it.each([
    "127.0.0.1", "10.1.2.3", "172.16.0.1", "192.168.1.1", "169.254.169.254", "100.64.0.1",
    "0.0.0.0", "192.0.0.8", "198.18.0.1", "224.0.0.1",
    "::1", "::", "fe80::1", "fc00::1", "fd12::1", "fec0::1", "::ffff:127.0.0.1", "64:ff9b::a00:1", "::127.0.0.1",
  ])("blocks %s", (ip) => expect(isPrivateIp(ip)).toBe(true));

  it.each(["93.184.216.34", "8.8.8.8", "2606:4700:4700::1111"])("allows public %s", (ip) =>
    expect(isPrivateIp(ip)).toBe(false),
  );
});
