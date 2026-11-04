import { Power } from "lucide-react";

import type { ControlMode } from "@/api/types";
import type { StartupController } from "../hooks/useStartup";

export interface StartupPanelProps {
  startup: StartupController;
  /**
   * Control plane the shell administers. In `machine` mode login startup belongs to the system
   * daemon package, so the panel reports that instead of a per-user Windows registration.
   */
  controlMode?: ControlMode;
}

/**
 * Login startup and what closing the window means. Both belong together: the app starts with the
 * user's session so installed queues keep reaching the client proxy, and its window closes into the
 * tray rather than ending that.
 */
export function StartupPanel({ startup, controlMode = "local" }: StartupPanelProps) {
  const { status, error, busy, setEnabled } = startup;
  const isMachine = controlMode === "machine";

  return (
    <section className="panel feature-panel startup-panel" aria-labelledby="startup-heading">
      <div className="panel-header flex items-center justify-between">
        <div className="flex items-center gap-2.5">
          <div className="flex size-7 items-center justify-center rounded-lg bg-primary/10 text-primary">
            <Power size={16} />
          </div>
          <div>
            <h2 id="startup-heading" className="text-base font-semibold leading-none">
              启动
            </h2>
            <p className="hint text-xs mt-1 text-muted-foreground">
              {isMachine
                ? "ShaPrint 系统服务随本机启动。"
                : "在你登录 Windows 时启动 ShaPrint。"}
            </p>
          </div>
        </div>
      </div>

      {error ? (
        <p className="banner" role="alert">
          <span className="banner-code">{error.code}</span>
          <span className="banner-message">{error.message}</span>
        </p>
      ) : null}

      {status === null ? (
        <p className="hint text-xs text-muted-foreground" role="status">
          正在检查登录设置…
        </p>
      ) : null}

      {status && !status.supported ? (
        <p className="hint text-xs text-muted-foreground">
          {isMachine
            ? "ShaPrint 系统服务拥有本机的启动项，因此此窗口不会注册登录项。关闭窗口仅关闭图形界面——客户端代理与服务器会继续打印。"
            : "在 Windows 上可用时，可在登录时启动 ShaPrint。在此平台上关闭窗口即结束应用。"}
        </p>
      ) : null}

      {status?.supported ? (
        <div className="space-y-3 pt-1">
          <label className="startup-choice flex items-center gap-3 cursor-pointer select-none rounded-lg border border-border bg-card p-3 hover:bg-muted/40 transition-colors">
            <input
              type="checkbox"
              checked={status.enabled}
              disabled={busy}
              onChange={(event) => void setEnabled(event.target.checked)}
              className="size-4 rounded border-input text-primary focus:ring-primary"
            />
            <div className="flex flex-col">
              <span className="text-sm font-medium text-foreground">
                我登录 Windows 时启动 ShaPrint
              </span>
              <span className="text-xs text-muted-foreground mt-0.5">
                在通知区域启动 ShaPrint，使已安装的打印机队列可以继续使用客户端代理。
              </span>
            </div>
          </label>

          {status.command ? (
            <details className="startup-details">
              <summary>查看 Windows 启动项</summary>
              <code className="startup-command">{status.command}</code>
            </details>
          ) : (
            <p className="hint text-xs text-muted-foreground">
              ShaPrint 无法定位其程序，因此无法注册其在登录时启动。
            </p>
          )}

          <p className="hint text-xs text-muted-foreground">
            关闭窗口会使 ShaPrint 在通知区域保持运行，让你已安装的队列仍能打印。请使用该菜单中的 <strong>退出 ShaPrint</strong> 来停止它。
          </p>
        </div>
      ) : null}
    </section>
  );
}
