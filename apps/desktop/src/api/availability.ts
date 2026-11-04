/**
 * What a user can do about a supervised service that is not currently available for printing.
 *
 * Availability is derived from the live runtime status the shell already publishes, so the window
 * can say why a print cannot proceed without waiting for a failed attempt: a stopped client proxy
 * means the queue's request never reaches this app at all.
 */

import type { ServiceId, ServiceStatus } from "./types";

/** How one print path is reported while it is not doing its job. */
interface PrintPath {
  /** Shown while the service is starting or stopping. */
  moving: string;
  /** Shown when the service failed to start, or stopped unexpectedly. */
  failed: string;
  /**
   * Shown when the service is stopped and starting it is the user's move. Absent when a stopped
   * service is the documented default rather than a problem.
   */
  stopped?: string;
}

const PRINT_PATHS: Partial<Record<ServiceId, PrintPath>> = {
  "client-proxy": {
    moving: "客户端代理状态变化期间，无法从此电脑上已安装的队列打印。",
    failed:
      "无法从此电脑上已安装的队列打印。客户端代理启动失败或意外停止；请使用“启动”重试。",
    stopped: "启动客户端代理，即可从此电脑上已安装的队列打印。",
  },
  "server-sharing": {
    moving: "服务器共享状态变化期间，其他 ShaPrint 用户无法打印到你的队列。",
    // Sharing is off until the user starts it, so a stopped sharing service is not a problem to
    // report; only a failure is.
    failed:
      "其他 ShaPrint 用户无法打印到你所选的队列。服务器共享启动失败或意外停止；请使用“启动”重试。",
  },
};

/**
 * The action that restores printing through `service`.
 *
 * Returns `null` when the service is running, when a stopped service is the user's own choice or
 * the documented default, and when the service is not part of a print path at all (for example
 * server discovery, which only feeds the nearby-server list).
 */
export function printRecovery(service: ServiceStatus): string | null {
  const path = PRINT_PATHS[service.id];
  if (!path || service.state === "running") {
    return null;
  }
  if (service.state === "failed") {
    return path.failed;
  }
  if (service.state === "stopped") {
    return path.stopped ?? null;
  }
  return path.moving;
}
