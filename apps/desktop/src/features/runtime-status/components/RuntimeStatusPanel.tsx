import { RefreshCw } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import type { ControlMode } from "@/api/types";
import type { RuntimeStatusController } from "../hooks/useRuntimeStatus";
import { ServiceStatusCard } from "./ServiceStatusCard";

export interface RuntimeStatusPanelProps {
  runtime: RuntimeStatusController;
  /** Control plane the shell administers; `machine` means the services belong to the daemon. */
  controlMode?: ControlMode;
}

/** Live status of the client and server print paths, with lifecycle controls. */
export function RuntimeStatusPanel({ runtime, controlMode = "local" }: RuntimeStatusPanelProps) {
  const { status, error, busy, unreachable, dismissError } = runtime;

  return (
    <Card className="panel feature-panel runtime-panel" aria-labelledby="services-heading">
      <div className="panel-header">
        <div>
          <h2 id="services-heading">打印服务</h2>
          <p className="hint">
            客户端代理承载你已安装的队列。服务器共享在你启动之前保持关闭。
          </p>
        </div>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={() => void runtime.refresh()}
          disabled={busy !== null}
        >
          <RefreshCw size={15} aria-hidden="true" />
          刷新
        </Button>
      </div>

      {error ? (
        <p className="banner" role="alert">
          <span className="banner-code">{error.code}</span>
          <span className="banner-message">{error.message}</span>
          <Button type="button" variant="ghost" size="sm" onClick={dismissError}>
            忽略
          </Button>
        </p>
      ) : null}

      {unreachable ? (
        <p className="runtime-unreachable" role="alert">
          {controlMode === "machine"
            ? "机器守护进程不可达，因此其打印服务已停止。请启动系统服务（sudo systemctl start shaprintd），然后刷新。"
            : "此窗口无法连接到 ShaPrint 运行时。请重新打开桌面应用以查看并控制其服务。"}
        </p>
      ) : null}

      {status === null && !unreachable ? (
        <p className="hint" role="status">正在读取服务状态…</p>
      ) : null}

      {status ? (
        <ul className="service-list">
          {status.services.map((service) => (
            <li key={service.id}>
              <ServiceStatusCard
                service={service}
                busy={busy === service.id}
                onStart={() => void runtime.start(service.id)}
                onStop={() => void runtime.stop(service.id)}
              />
            </li>
          ))}
        </ul>
      ) : null}
    </Card>
  );
}
