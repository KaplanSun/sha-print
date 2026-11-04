import { FlaskConical, RefreshCw, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import type { ControlMode } from "@/api/types";
import { isNightly } from "@/lib/version";
import type { useUpdates } from "../hooks/useUpdates";

export interface SoftwareUpdatesPanelProps {
  updates: ReturnType<typeof useUpdates>;
  /**
   * Control plane the shell administers. In `machine` mode the installation is a system package,
   * so updates arrive through the package manager rather than through this window.
   */
  controlMode?: ControlMode;
}

export function SoftwareUpdatesPanel({ updates, controlMode = "local" }: SoftwareUpdatesPanelProps) {
  const { status, error, checking, check, restart } = updates;
  const update = status?.update;
  const isReady = update?.state === "ready_to_restart";
  const nightly = isNightly(status?.current_version);
  const isMachine = controlMode === "machine";

  return (
    <Card className="panel space-y-3" aria-labelledby="software-updates-heading">
      <div className="panel-header flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2.5">
          <div className="flex size-7 items-center justify-center rounded-lg bg-primary/10 text-primary">
            <Sparkles size={16} />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h2 id="software-updates-heading" className="text-base font-semibold leading-none">
                软件更新
              </h2>
              {status?.current_version && (
                <Badge
                  variant={nightly ? "warning" : "muted"}
                  className="text-[10px] tracking-wide"
                >
                  {nightly ? "预发布测试版" : "稳定版"}
                </Badge>
              )}
            </div>
            <p className="hint text-xs mt-1 text-muted-foreground">
              当前版本 {status?.current_version ? `v${status.current_version}` : "已安装"}。{" "}
              {isMachine
                ? "更新由你的软件包管理器安装。"
                : "更新会自动下载并校验。"}
            </p>
          </div>
        </div>

        {!isMachine ? (
          <div className="flex items-center gap-2">
            {isReady ? (
              <Button
                type="button"
                variant="default"
                size="sm"
                onClick={() => void restart()}
                className="text-xs h-8"
              >
                {status?.waiting_for_jobs ? "重启已排队" : "立即重启"}
              </Button>
            ) : (
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => void check()}
                disabled={checking || update?.state === "checking"}
                className="text-xs h-8"
                aria-label="检查更新"
              >
                <RefreshCw
                  size={14}
                  className={checking || update?.state === "checking" ? "animate-spin mr-1.5" : "mr-1.5"}
                  aria-hidden="true"
                />
                {checking || update?.state === "checking" ? "正在检查…" : "检查更新"}
              </Button>
            )}
          </div>
        ) : null}
      </div>

      {error ? (
        <p className="text-xs text-destructive font-medium" role="alert">
          {error}
        </p>
      ) : null}

      {isMachine ? (
        <div className="rounded-md border border-border bg-muted/40 p-2.5 text-xs space-y-1">
          <strong className="text-foreground">更新由你的软件包管理器安装。</strong>
          <p className="text-muted-foreground">
            ShaPrint 在这台机器上作为系统软件包安装，因此请以你更新其他软件的方式安装更新（例如 <strong>sudo dnf upgrade shaprint</strong>）。该软件包会为你重启机器守护进程。
          </p>
        </div>
      ) : null}

      {nightly ? (
        <div
          className="rounded-lg border border-amber-500/30 bg-amber-500/10 p-3 text-xs text-amber-950 dark:text-amber-200 space-y-1"
          role="region"
          aria-label="预发布测试版通道提示"
        >
          <div className="flex items-center gap-1.5 font-semibold text-amber-900 dark:text-amber-300">
            <FlaskConical size={14} className="shrink-0" aria-hidden="true" />
            <span>已启用预发布测试版通道</span>
          </div>
          <p className="text-muted-foreground dark:text-amber-200/80 leading-relaxed text-[11px]">
            此安装会检查专门的预发布测试版源以获取新的测试构建。固定的代理端口与已保存的配置会保留。要回到稳定版，请手动安装稳定版。
          </p>
        </div>
      ) : null}

      {isReady && !isMachine ? (
        <div className="rounded-md bg-emerald-500/10 border border-emerald-500/30 p-2.5 text-xs text-emerald-800 dark:text-emerald-200">
          <strong>ShaPrint {update.version} 已就绪，可以安装。</strong>
          <p className="mt-0.5 text-muted-foreground">
            {status?.waiting_for_jobs
              ? "在活动打印任务耗尽期间，你的重启已排队。"
              : "重启 ShaPrint 以应用最新版本。"}
          </p>
        </div>
      ) : null}
    </Card>
  );
}
