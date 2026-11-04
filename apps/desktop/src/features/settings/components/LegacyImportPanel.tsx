import { History, RefreshCw } from "lucide-react";

import type { LegacyChannelOutcome } from "@/api/legacyImport";
import type { LegacyImportController } from "../hooks/useLegacyImport";
import { Button } from "@/components/ui/button";

/** Short label for what happened to the previous app's Network Channel. */
const CHANNEL_LABELS: Record<LegacyChannelOutcome, string> = {
  importable: "可导入",
  imported: "已导入",
  "kept-existing": "保留原样",
  absent: "无内容可导入",
  unreadable: "无法打开",
};

export interface LegacyImportPanelProps {
  legacy: LegacyImportController;
}

/**
 * The move from the previous .NET ShaPrint app: what this app took, what it left behind, and the
 * queues the user has to select again. The previous app's queue setup is never activated here.
 */
export function LegacyImportPanel({ legacy }: LegacyImportPanelProps) {
  const { report, error, busy, checkAgain } = legacy;

  return (
    <section className="panel feature-panel legacy-import-panel" aria-labelledby="legacy-import-heading">
      <div className="panel-header flex items-center justify-between">
        <div className="flex items-center gap-2.5">
          <div className="flex size-7 items-center justify-center rounded-lg bg-primary/10 text-primary">
            <History size={16} aria-hidden="true" />
          </div>
          <div>
            <h2 id="legacy-import-heading" className="text-base font-semibold leading-none">
              以前的 ShaPrint 应用
            </h2>
            <p className="hint text-xs mt-1 text-muted-foreground">
              从旧版 ShaPrint 应用迁移过来的内容。
            </p>
          </div>
        </div>

        {report?.found ? (
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => void checkAgain()}
            disabled={busy}
            className="text-xs h-8"
          >
            {busy ? (
              <>
                <RefreshCw size={13} className="animate-spin mr-1" />
                <span>正在导入…</span>
              </>
            ) : (
              "重新导入"
            )}
          </Button>
        ) : null}
      </div>

      {error ? (
        <p className="banner" role="alert">
          <span className="banner-code">{error.code}</span>
          <span className="banner-message">{error.message}</span>
        </p>
      ) : null}

      {report === null ? (
        <p className="hint text-xs text-muted-foreground" role="status">
          正在检查旧版 ShaPrint 应用的设置…
        </p>
      ) : null}

      {report && !report.found ? (
        <p className="hint text-xs text-muted-foreground" role="status">
          在这台电脑上未找到旧版 ShaPrint 应用的设置。
        </p>
      ) : null}

      {report?.found ? (
        <div className="space-y-3 pt-1">
          <div
            className="channel-outcome rounded-lg border border-emerald-500/20 bg-emerald-500/5 p-3 text-xs space-y-1"
            data-channel={report.channel}
          >
            <div className="flex items-center justify-between">
              <span className="channel-outcome-label font-semibold text-emerald-700 dark:text-emerald-400">
                网络通道：{CHANNEL_LABELS[report.channel] ?? report.channel}
              </span>
            </div>
            <p className="channel-outcome-note text-muted-foreground">{report.channel_note}</p>
          </div>

          {report.queues_need_reselection ? (
            <p className="reselect rounded-lg border border-warning/30 bg-warning/10 p-3 text-xs text-warning-foreground" role="status" data-testid="reselect-queues">
              <strong>请重新选择你的打印机。</strong>请在“共享打印机”页选择本地队列，
              并在“连接”页重新安装客户端队列。旧版应用的队列设置不会被启用。
            </p>
          ) : null}

          {report.settings.length > 0 ? (
            <details className="left-behind rounded-lg border border-border bg-card p-3 text-xs">
              <summary className="cursor-pointer font-medium text-muted-foreground hover:text-foreground">
                此应用未迁移的内容（{report.settings.length}）
              </summary>
              <ul className="left-behind-list mt-2 space-y-2 pl-2 border-l border-border">
                {report.settings.map((setting) => (
                  <li key={setting.key} data-setting={setting.key} className="space-y-0.5">
                    <span className="left-behind-label font-semibold text-foreground block">
                      {setting.label}
                    </span>
                    <span className="left-behind-reason text-muted-foreground block text-[11px]">
                      {setting.reason}
                    </span>
                  </li>
                ))}
              </ul>
            </details>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}
