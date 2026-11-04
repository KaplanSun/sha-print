import { describe, expect, it } from "vitest";

import { printRecovery } from "./availability";
import type { ServiceState, ServiceStatus } from "./types";

function service(id: ServiceStatus["id"], state: ServiceState): ServiceStatus {
  return { id, state, detail: "" };
}

describe("print availability", () => {
  it("says what to start when the always-on print path is stopped", () => {
    expect(printRecovery(service("client-proxy", "stopped"))).toBe(
      "启动客户端代理，即可从此电脑上已安装的队列打印。",
    );
  });

  it("does not call a stopped sharing service a problem", () => {
    // Sharing is off until the user starts it, so a stopped sharing service is the default state,
    // not a print failure to act on.
    expect(printRecovery(service("server-sharing", "stopped"))).toBeNull();
  });

  it("says nothing while a print path is running", () => {
    expect(printRecovery(service("client-proxy", "running"))).toBeNull();
    expect(printRecovery(service("server-sharing", "running"))).toBeNull();
  });

  it("reports a print path that failed as retryable", () => {
    expect(printRecovery(service("client-proxy", "failed"))).toContain("请使用“启动”重试");
    expect(printRecovery(service("server-sharing", "failed"))).toContain(
      "其他 ShaPrint 用户无法打印",
    );
  });

  it("calls out a print path that is still moving through its lifecycle", () => {
    expect(printRecovery(service("client-proxy", "starting"))).toContain("无法从此电脑上已安装的队列打印");
    expect(printRecovery(service("server-sharing", "stopping"))).toContain("无法打印到你的队列");
  });

  it("ignores services that no print depends on", () => {
    expect(printRecovery(service("server-discovery", "stopped"))).toBeNull();
    expect(printRecovery(service("server-discovery", "failed"))).toBeNull();
  });
});
