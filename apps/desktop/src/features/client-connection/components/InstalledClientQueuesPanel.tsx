import { useEffect, useState } from "react";
import { Check, Copy, ExternalLink, Plus, RefreshCw, ShieldAlert, Wrench } from "lucide-react";
import { Button } from "../../../components/ui/button";
import {
  inspectServerConnection,
  openPrintersSettings,
  repairPrinterQueue,
} from "../../../api/serverConnections";
import type { RecognisedClientQueue } from "../../../api/types";
import {
  Dialog,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "../../../components/ui/dialog";
import type { UseRecognisedClientQueues } from "../hooks/useRecognisedClientQueues";

interface InstalledClientQueuesPanelProps {
  clientQueues: UseRecognisedClientQueues;
  onAddPrinter: () => void;
  onReverifyServer?: (serverAddress: string) => void;
  onTroubleshoot?: (queue: RecognisedClientQueue) => void;
}

export function InstalledClientQueuesPanel({
  clientQueues,
  onAddPrinter,
  onReverifyServer,
  onTroubleshoot,
}: InstalledClientQueuesPanelProps) {
  const { queues, loading, error, refresh } = clientQueues;
  const [copiedQueue, setCopiedQueue] = useState<string | null>(null);
  const [manageError, setManageError] = useState<string | null>(null);
  const [serverChangedMap, setServerChangedMap] = useState<Record<string, boolean>>({});
  const [repairTarget, setRepairTarget] = useState<RecognisedClientQueue | null>(null);
  const [repairing, setRepairing] = useState(false);
  const [repairError, setRepairError] = useState<string | null>(null);
  const [repairSuccess, setRepairSuccess] = useState<string | null>(null);

  // Check known server identities for installed queues with evidence attribution
  useEffect(() => {
    let active = true;

    async function checkServerIdentities() {
      if (queues.length === 0) return;
      const uniqueAddresses = Array.from(new Set(queues.map((q) => q.server_address)));

      for (const address of uniqueAddresses) {
        try {
          const review = await inspectServerConnection(address);
          if (active && review.previous_fingerprint && review.trusted === false) {
            setServerChangedMap((prev) => ({ ...prev, [address]: true }));
          } else if (active && review.trusted) {
            setServerChangedMap((prev) => ({ ...prev, [address]: false }));
          }
        } catch {
          // Unknown reachability must not speculate as offline or changed
        }
      }
    }

    void checkServerIdentities();

    return () => {
      active = false;
    };
  }, [queues]);

  async function handleCopyQueueName(queueName: string) {
    try {
      await navigator.clipboard.writeText(queueName);
      setCopiedQueue(queueName);
      setTimeout(() => setCopiedQueue(null), 2000);
    } catch {
      // Clipboard write failed
    }
  }

  async function handleManageInWindows() {
    setManageError(null);
    try {
      await openPrintersSettings();
    } catch (err) {
      setManageError(
        "无法自动打开 Windows 设置。请手动打开“Windows 设置 > 蓝牙和其他设备 > 打印机和扫描仪”来管理已安装的队列。",
      );
    }
  }

  async function handleRepair() {
    if (!repairTarget) return;
    setRepairing(true);
    setRepairError(null);
    setRepairSuccess(null);
    try {
      await repairPrinterQueue(repairTarget.server_address, repairTarget.printer_name);
      const repairedName = repairTarget.queue_name;
      setRepairTarget(null);
      setRepairSuccess(`已修复 ${repairedName}。Windows 已重新加载其纸张尺寸。`);
      await refresh();
    } catch (cause) {
      setRepairError(
        typeof cause === "object" && cause !== null && "message" in cause
          ? String((cause as { message: unknown }).message)
          : "无法修复 Windows 打印机队列。",
      );
    } finally {
      setRepairing(false);
    }
  }

  return (
    <section className="card space-y-4" aria-labelledby="installed-queues-title">
      <div className="flex items-center justify-between gap-2">
        <div>
          <h2 id="installed-queues-title" className="text-base font-semibold">
            我的打印机
          </h2>
          <p className="text-xs text-muted-foreground">
            你的 Windows 应用可通过 ShaPrint 使用的打印机。
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button
            type="button"
            variant="default"
            size="sm"
            onClick={onAddPrinter}
            aria-label="添加打印机"
          >
            <Plus className="size-3.5 mr-1" />
            添加打印机
          </Button>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => void refresh()}
            disabled={loading}
            aria-label="刷新已安装队列"
          >
            <RefreshCw className={`size-3.5 mr-1 ${loading ? "animate-spin" : ""}`} />
            刷新
          </Button>
        </div>
      </div>

      {loading && queues.length === 0 ? (
        <div className="rounded-lg border border-dashed p-4 text-center text-sm text-muted-foreground">
          正在检查 Windows 打印机队列…
        </div>
      ) : null}

      {error ? (
        <div className="rounded-lg border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive flex items-center justify-between">
          <span>{error}</span>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => void refresh()}
          >
            重试
          </Button>
        </div>
      ) : null}

      {manageError ? (
        <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 p-3 text-xs text-amber-800 dark:text-amber-200">
          <p className="font-medium">{manageError}</p>
          <p className="mt-1 text-[11px] text-muted-foreground">
            复制下方队列名称，可直接在 Windows 中搜索。
          </p>
        </div>
      ) : null}

      {repairSuccess ? (
        <div className="rounded-lg border border-green-600/30 bg-green-600/10 p-3 text-xs text-green-800 dark:text-green-200">
          {repairSuccess}
        </div>
      ) : null}

      {!loading && !error && queues.length === 0 ? (
        <div className="rounded-lg border border-dashed p-8 text-center space-y-3">
          <p className="text-sm text-muted-foreground">
            Windows 中尚未安装任何 ShaPrint 客户端队列。
          </p>
          <Button
            type="button"
            onClick={onAddPrinter}
            aria-label="立即添加打印机"
          >
            <Plus className="size-4 mr-1.5" />
            添加打印机
          </Button>
        </div>
      ) : null}

      {queues.length > 0 ? (
        <div className="space-y-3">
          <div className="flex items-center justify-between text-xs text-muted-foreground">
            <span>Windows 管理的队列（{queues.length}）</span>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="h-7 text-xs text-primary"
              onClick={() => void handleManageInWindows()}
            >
              <ExternalLink className="size-3 mr-1" />
              在 Windows 中管理
            </Button>
          </div>

          <ul className="space-y-2" aria-label="已安装的打印机队列">
            {queues.map((queue) => {
              const identityChanged = serverChangedMap[queue.server_address] === true;

              return (
                <li
                  key={queue.queue_name}
                  className={`rounded-lg border p-3 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 ${
                    identityChanged ? "border-amber-500/50 bg-amber-500/5" : "bg-card"
                  }`}
                >
                  <div className="space-y-1">
                    <div className="flex items-center gap-2">
                      <strong className="block text-sm font-medium">{queue.queue_name}</strong>
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        className="h-6 px-1.5 text-xs text-muted-foreground hover:text-foreground"
                        onClick={() => void handleCopyQueueName(queue.queue_name)}
                        aria-label={`复制队列名称 ${queue.queue_name}`}
                      >
                        {copiedQueue === queue.queue_name ? (
                          <Check className="size-3 text-green-600" />
                        ) : (
                          <Copy className="size-3" />
                        )}
                      </Button>
                    </div>
                    <div className="text-xs text-muted-foreground">
                      共享打印机：<span className="font-semibold">{queue.printer_name}</span>（位于{" "}
                      <span>{queue.server_address}</span>）
                    </div>

                    {identityChanged ? (
                      <div className="flex items-center gap-1.5 text-xs text-amber-700 dark:text-amber-300 font-medium pt-1">
                        <ShieldAlert className="size-3.5 shrink-0" />
                        <span>服务器身份已变更。在重新验证前，打印已被阻止。</span>
                      </div>
                    ) : null}
                  </div>

                  <div className="flex items-center gap-2 self-end sm:self-auto">
                    {onTroubleshoot ? <Button type="button" variant="outline" size="sm"
                      onClick={() => onTroubleshoot(queue)} aria-label={`对 ${queue.queue_name} 进行故障排查`}>
                      故障排查
                    </Button> : null}
                    {identityChanged && onReverifyServer ? (
                      <Button
                        type="button"
                        variant="default"
                        size="sm"
                        className="h-8 text-xs bg-amber-600 hover:bg-amber-700 text-white"
                        onClick={() => onReverifyServer(queue.server_address)}
                        aria-label={`重新验证 ${queue.server_address} 的身份`}
                      >
                        <ShieldAlert className="size-3 mr-1" />
                        重新验证身份
                      </Button>
                    ) : null}

                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      className="h-8 text-xs"
                      disabled={identityChanged}
                      onClick={() => {
                        setRepairError(null);
                        setRepairTarget(queue);
                      }}
                      aria-label={`修复 ${queue.queue_name} 的纸张尺寸`}
                    >
                      <Wrench className="size-3 mr-1" />
                      修复纸张尺寸
                    </Button>

                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      className="h-8 text-xs"
                      onClick={() => void handleManageInWindows()}
                    >
                      <ExternalLink className="size-3 mr-1" />
                      在 Windows 中管理
                    </Button>
                  </div>
                </li>
              );
            })}
          </ul>
        </div>
      ) : null}

      <Dialog
        open={repairTarget !== null}
        onOpenChange={(open) => {
          if (!open && !repairing) {
            setRepairTarget(null);
            setRepairError(null);
          }
        }}
        ariaLabelledBy="repair-queue-title"
        ariaDescribedBy="repair-queue-description"
      >
        <DialogHeader>
          <DialogTitle id="repair-queue-title">修复纸张尺寸？</DialogTitle>
          <DialogDescription id="repair-queue-description">
            ShaPrint 将移除并重新安装 {repairTarget?.queue_name}。Windows 将请求
            管理员权限，并可能重置该打印机的本地打印偏好。
            请先完成或取消待处理的打印任务。
          </DialogDescription>
        </DialogHeader>
        {repairError ? (
          <div className="rounded-lg border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive">
            {repairError}
          </div>
        ) : null}
        <DialogFooter>
          <Button
            type="button"
            variant="outline"
            disabled={repairing}
            onClick={() => {
              setRepairTarget(null);
              setRepairError(null);
            }}
          >
            取消
          </Button>
          <Button type="button" disabled={repairing} onClick={() => void handleRepair()}>
            {repairing ? "正在修复…" : "修复队列"}
          </Button>
        </DialogFooter>
      </Dialog>
    </section>
  );
}
