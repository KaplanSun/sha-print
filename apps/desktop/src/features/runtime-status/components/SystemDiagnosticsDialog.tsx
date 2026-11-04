import { useCallback, useEffect, useState } from "react";
import { Power, RefreshCw, Server } from "lucide-react";

import { printRecovery } from "@/api/availability";
import { getDiagnostics, shutdownDaemon } from "@/api/ipc";
import {
  toAppError,
  type AppError,
  type ControlMode,
  type DiagnosticCheck,
  type DiagnosticsReport,
  type ServiceId,
  type ServiceState,
  type ServiceStatus,
} from "@/api/types";
import { Badge, type BadgeProps } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import type { RuntimeStatusController } from "../hooks/useRuntimeStatus";

const SERVICE_LABELS: Record<ServiceId, { title: string; description: string }> = {
  "client-proxy": {
    title: "客户端代理",
    description: "将你已安装队列的打印任务转发到受信任的服务器。",
  },
  "server-sharing": {
    title: "服务器共享",
    description: "将你选择的本地打印机队列共享给其他 ShaPrint 用户。",
  },
  "server-discovery": {
    title: "服务器发现",
    description: "在此网络上查找 ShaPrint 服务器，以便你复核并连接。",
  },
};

const STATE_LABELS: Record<ServiceState, string> = {
  stopped: "已停止",
  starting: "启动中…",
  running: "运行中",
  stopping: "停止中…",
  failed: "失败",
};

const STATE_VARIANTS: Record<ServiceState, NonNullable<BadgeProps["variant"]>> = {
  stopped: "muted",
  starting: "warning",
  running: "success",
  stopping: "warning",
  failed: "destructive",
};

const CONTROLS: Record<ServiceState, { canStart: boolean; canStop: boolean }> = {
  stopped: { canStart: true, canStop: false },
  starting: { canStart: false, canStop: true },
  running: { canStart: false, canStop: true },
  stopping: { canStart: false, canStop: false },
  failed: { canStart: true, canStop: false },
};

const CHECK_LABELS: Record<string, { title: string; description: string }> = {
  daemon: {
    title: "守护进程服务",
    description: "评估 shaprintd 是否在运行且有响应。",
  },
  ports: {
    title: "网络端口",
    description: "评估 IPPS 服务器、客户端代理和发现端口是否可用或由 ShaPrint 占用。",
  },
  cups: {
    title: "CUPS 打印系统",
    description: "评估本地 CUPS 打印假脱机是否有响应。",
  },
  trust: {
    title: "机器信任存储",
    description: "评估证书信任存储与配置。",
  },
  credential: {
    title: "网络通道凭据",
    description: "评估共享密钥网络通道是否已配置用于授权打印。",
  },
  firewall: {
    title: "系统防火墙",
    description: "评估入站端口 48631/tcp 与 48633/udp 是否在系统防火墙中被允许。",
  },
};

export interface SystemDiagnosticsDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  runtime: RuntimeStatusController;
  /**
   * Control plane the shell administers. In `machine` mode the services belong to the system
   * daemon, so the dialog also offers stopping the daemon itself and explains its recovery.
   */
  controlMode?: ControlMode;
}

export function SystemDiagnosticsDialog({
  open,
  onOpenChange,
  runtime,
  controlMode = "local",
}: SystemDiagnosticsDialogProps) {
  const { status, error, busy, unreachable, refresh, start, stop, dismissError } = runtime;
  const [daemonBusy, setDaemonBusy] = useState(false);
  const [daemonError, setDaemonError] = useState<AppError | null>(null);
  const [diagnostics, setDiagnostics] = useState<DiagnosticsReport | null>(null);
  const isMachine = controlMode === "machine";

  const loadDiagnostics = useCallback(async () => {
    try {
      const report = await getDiagnostics();
      setDiagnostics(report);
    } catch {
      // Diagnostic check failure does not block the dialog
    }
  }, []);

  useEffect(() => {
    if (open) {
      void loadDiagnostics();
    }
  }, [open, loadDiagnostics]);

  const stopDaemon = async () => {
    setDaemonBusy(true);
    setDaemonError(null);
    try {
      await shutdownDaemon();
      // The status stream reports the stopped daemon on its next poll.
    } catch (cause) {
      // A declined polkit prompt lands here with `not-authorized`; state was not touched.
      setDaemonError(toAppError(cause));
    } finally {
      setDaemonBusy(false);
    }
  };

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      ariaLabelledBy="diagnostics-title"
      ariaDescribedBy="diagnostics-description"
    >
      <DialogHeader>
        <DialogTitle id="diagnostics-title">打印服务状态</DialogTitle>
        <DialogDescription id="diagnostics-description">
          在此检查客户端代理与打印机共享。客户端代理使已安装队列保持工作；服务器共享仅在你开启后才启动。
        </DialogDescription>
      </DialogHeader>

      <div className="space-y-4 my-2">
        {error ? (
          <div className="diagnostic-error" role="alert">
            <div>
              <span className="font-mono font-bold text-destructive mr-2">{error.code}</span>
              <span>{error.message}</span>
            </div>
            <Button size="sm" variant="ghost" onClick={dismissError}>
              忽略
            </Button>
          </div>
        ) : null}

        {daemonError ? (
          <div className="diagnostic-error" role="alert">
            <div>
              <span className="font-mono font-bold text-destructive mr-2">{daemonError.code}</span>
              <span>{daemonError.message}</span>
            </div>
            <Button size="sm" variant="ghost" onClick={() => setDaemonError(null)}>
              忽略
            </Button>
          </div>
        ) : null}

        {unreachable ? (
          <div className="runtime-unreachable" role="alert">
            <strong>{isMachine ? "机器守护进程不可用" : "运行时不可用"}</strong>
            <p className="text-xs text-muted-foreground mt-1">
              {isMachine
                ? "机器守护进程未响应，因此其打印服务已停止。请启动系统服务（sudo systemctl start shaprintd），然后选择“全部刷新”。"
                : "ShaPrint 运行时未响应。请重新打开桌面应用以重新连接。"}
            </p>
          </div>
        ) : null}

        {status === null && !unreachable ? (
          <p className="diagnostic-loading" role="status">
            <RefreshCw className="size-4 text-primary" aria-hidden="true" />
            正在检查打印服务…
          </p>
        ) : null}

        {status ? (
          <div className="space-y-3">
            {status.services.map((service: ServiceStatus) => {
              const label = SERVICE_LABELS[service.id];
              const controls = CONTROLS[service.state];
              const recovery = printRecovery(service);
              const isBusy = busy === service.id;

              return (
                <section
                  key={service.id}
                  className="diagnostic-service service"
                  data-service={service.id}
                  data-state={service.state}
                  aria-labelledby={`diagnostic-service-${service.id}`}
                >
                  <header className="service-header">
                    <div>
                      <div className="flex items-center gap-2">
                        <Server size={15} className="text-muted-foreground" aria-hidden="true" />
                        <h4 id={`diagnostic-service-${service.id}`} className="font-semibold text-sm">
                          {label?.title ?? service.id}
                        </h4>
                      </div>
                      <p className="service-description">{label?.description}</p>
                    </div>
                    <Badge variant={STATE_VARIANTS[service.state]} role="status">
                      {STATE_LABELS[service.state]}
                    </Badge>
                  </header>

                  {service.detail ? <p className="service-detail">{service.detail}</p> : null}

                  {recovery ? (
                    <p className="service-recovery" role="status">
                      <span className="service-recovery-label">打印受影响</span>
                      {recovery}
                    </p>
                  ) : null}

                  <div className="service-actions">
                    <Button
                      size="sm"
                      variant="outline"
                      className="h-7 text-xs px-3"
                      disabled={isBusy || !controls.canStart}
                      onClick={() => void start(service.id)}
                    >
                      {service.state === "starting" || (isBusy && service.state === "stopped")
                        ? "启动中…"
                        : "启动"}
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      className="h-7 text-xs px-3 text-destructive hover:bg-destructive/10"
                      disabled={isBusy || !controls.canStop}
                      onClick={() => void stop(service.id)}
                    >
                      {service.state === "stopping" || (isBusy && service.state === "running")
                        ? "停止中…"
                        : "停止"}
                    </Button>
                  </div>
                </section>
              );
            })}
          </div>
        ) : null}

        {status?.readiness || status?.failure_code || (status?.shared_printers && status.shared_printers.length > 0) || (status?.client_queues && status.client_queues.length > 0) ? (
          <section
            className="diagnostic-readiness p-3 rounded-lg border bg-muted/30 space-y-2 text-xs"
            aria-labelledby="diagnostic-readiness-title"
          >
            <h4 id="diagnostic-readiness-title" className="font-semibold text-xs text-muted-foreground uppercase tracking-wider">
              系统就绪状态与目标
            </h4>
            {status.readiness ? (
              <div className="flex items-center justify-between">
                <span className="text-muted-foreground">已配置就绪状态：</span>
                <span className="font-mono font-medium" data-testid="readiness-status">{status.readiness}</span>
              </div>
            ) : null}
            {status.failure_code ? (
              <div className="flex items-center justify-between text-destructive">
                <span className="font-medium">故障代码：</span>
                <span className="font-mono font-bold" data-testid="failure-code">{status.failure_code}</span>
              </div>
            ) : null}
            {status.shared_printers && status.shared_printers.length > 0 ? (
              <div>
                <span className="text-muted-foreground">共享打印机：</span>
                <span className="font-medium">{status.shared_printers.join(", ")}</span>
              </div>
            ) : null}
            {status.client_queues && status.client_queues.length > 0 ? (
              <div>
                <span className="text-muted-foreground">客户端队列：</span>
                <span className="font-medium">{status.client_queues.join(", ")}</span>
              </div>
            ) : null}
          </section>
        ) : null}

        {diagnostics?.checks && diagnostics.checks.length > 0 ? (
          <div className="space-y-3">
            <h4 className="font-semibold text-xs text-muted-foreground uppercase tracking-wider">
              子系统诊断
            </h4>
            {diagnostics.checks.map((check: DiagnosticCheck) => {
              const meta = CHECK_LABELS[check.check];
              const isOk = check.status === "ok";
              const isWarning = check.status === "warning";
              return (
                <section
                  key={check.check}
                  className="diagnostic-check service"
                  data-check={check.check}
                  data-status={check.status}
                  aria-labelledby={`diagnostic-check-${check.check}`}
                >
                  <header className="service-header">
                    <div>
                      <h4 id={`diagnostic-check-${check.check}`} className="font-semibold text-sm">
                        {meta?.title ?? check.check}
                      </h4>
                      <p className="service-description">{meta?.description}</p>
                    </div>
                    <Badge variant={isOk ? "success" : isWarning ? "warning" : "destructive"} role="status">
                      {isOk ? "正常" : isWarning ? "未检查" : "失败"}
                    </Badge>
                  </header>

                  <p className="service-detail">{check.detail}</p>

                  {check.code ? (
                    <div className="text-xs font-mono font-bold text-destructive">
                      {check.code}
                    </div>
                  ) : null}

                  {check.recovery ? (
                    <p className="service-recovery" role="status" data-recovery={check.recovery}>
                      <span className="service-recovery-label">恢复</span>
                      {check.recovery}
                    </p>
                  ) : null}
                </section>
              );
            })}
          </div>
        ) : null}

        {isMachine ? (
          <section
            className="diagnostic-service service"
            data-service="machine-daemon"
            aria-labelledby="diagnostic-daemon"
          >
            <header className="service-header">
              <div>
                <div className="flex items-center gap-2">
                  <Power size={15} className="text-muted-foreground" aria-hidden="true" />
                  <h4 id="diagnostic-daemon" className="font-semibold text-sm">
                    机器守护进程
                  </h4>
                </div>
                <p className="service-description">
                  为整台机器运行客户端代理与服务器共享（shaprintd）。
                </p>
              </div>
              <Badge variant="muted" role="status">
                系统服务
              </Badge>
            </header>

            <p className="service-detail">
              停止守护进程将停止这台机器上所有用户的打印。请使用
              <strong>sudo systemctl start shaprintd</strong> 重新启动。
            </p>

            <div className="service-actions">
              <Button
                size="sm"
                variant="outline"
                className="h-7 text-xs px-3"
                disabled={daemonBusy}
                onClick={() => void stopDaemon()}
              >
                {daemonBusy ? "停止中…" : "停止 ShaPrint 守护进程"}
              </Button>
            </div>
          </section>
        ) : null}
      </div>

      <DialogFooter className="flex items-center justify-between sm:justify-between w-full">
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="gap-1.5 text-xs"
          onClick={() => {
            void refresh();
            void loadDiagnostics();
          }}
          disabled={busy !== null}
        >
          <RefreshCw size={13} className={busy ? "animate-spin" : ""} />
          <span>全部刷新</span>
        </Button>
        <Button type="button" size="sm" onClick={() => onOpenChange(false)}>
          关闭
        </Button>
      </DialogFooter>
    </Dialog>
  );
}
