import { useId, useMemo, useState } from "react";
import {
  Copy,
  KeyRound,
  Play,
  Plus,
  Printer,
  RefreshCw,
  Ruler,
  Search,
  ShieldCheck,
  Square,
  Trash2,
} from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import type { PrinterSharingController } from "../hooks/usePrinterSharing";
import type { RuntimeStatusController } from "@/features/runtime-status/hooks/useRuntimeStatus";
import type { NetworkChannelController } from "@/features/network-channel/hooks/useNetworkChannel";

export interface PrinterSharingPanelProps {
  sharing: PrinterSharingController;
  runtime?: RuntimeStatusController;
  networkChannel?: NetworkChannelController;
}

/** Formats tenths of a millimetre as a compact millimetre label. */
function fmtMm(tenthsMm: number): string {
  const mm = tenthsMm / 10;
  return Number.isInteger(mm) ? String(mm) : mm.toFixed(1);
}

/** Parses a positive millimetre value from a text input, or `null` when invalid. */
function parseMm(value: string): number | null {
  const parsed = Number.parseFloat(value);
  if (!Number.isFinite(parsed) || parsed <= 0) return null;
  return parsed;
}

/** The server side of sharing: local queues, start/stop intent, and certificate identity. */
export function PrinterSharingPanel({
  sharing,
  runtime,
  networkChannel,
}: PrinterSharingPanelProps) {
  const { printers, identity, customMedia, customMediaBusy, busy, error, toggle, refresh, dismissError, addCustomMedia, removeCustomMedia } = sharing;
  const [copyMessage, setCopyMessage] = useState("");
  const [searchQuery, setSearchQuery] = useState("");
  const [showChannelPrompt, setShowChannelPrompt] = useState(false);
  const [channelInput, setChannelInput] = useState("");
  const [channelError, setChannelError] = useState<string | null>(null);
  const [customLabel, setCustomLabel] = useState("");
  const [customWidthMm, setCustomWidthMm] = useState("");
  const [customHeightMm, setCustomHeightMm] = useState("");
  const [customFormError, setCustomFormError] = useState<string | null>(null);
  const searchId = useId();

  const sharedCount = printers?.filter((printer) => printer.shared).length ?? 0;
  const changing = busy !== null;

  const serverSharingService = runtime?.status?.services.find(
    (s: { id: string }) => s.id === "server-sharing",
  );
  const isSharingRunning = serverSharingService?.state === "running";
  const isTransitioning =
    serverSharingService?.state === "starting" ||
    serverSharingService?.state === "stopping";

  const filteredPrinters = useMemo(() => {
    if (!printers) return [];
    if (!searchQuery.trim()) return printers;
    return printers.filter((p) => p.name.toLowerCase().includes(searchQuery.toLowerCase().trim()));
  }, [printers, searchQuery]);

  async function copyFingerprint() {
    if (!identity) return;

    try {
      if (!navigator.clipboard?.writeText) {
        setCopyMessage("剪贴板不可用。请选中指纹以复制它。");
        return;
      }
      await navigator.clipboard.writeText(identity.fingerprint);
      setCopyMessage("指纹已复制。");
    } catch {
      setCopyMessage("无法复制指纹。请选中它以手动复制。");
    }
  }

  async function handleStartSharingClick() {
    if (!runtime) return;

    if (networkChannel && networkChannel.configured === false) {
      setShowChannelPrompt(true);
      return;
    }

    await runtime.start("server-sharing");
  }

  async function handleStopSharingClick() {
    if (!runtime) return;
    await runtime.stop("server-sharing");
  }

  async function handleSaveChannelAndStartSharing(e: React.FormEvent) {
    e.preventDefault();
    if (!channelInput.trim() || !networkChannel || !runtime) return;

    setChannelError(null);
    const saved = await networkChannel.save(channelInput.trim());
    if (saved) {
      setChannelInput("");
      setShowChannelPrompt(false);
      await runtime.start("server-sharing");
    } else {
      setChannelError("无法保存网络通道。请查看下方错误详情。");
    }
  }

  function handleCancelChannelPrompt() {
    setChannelInput("");
    setChannelError(null);
    setShowChannelPrompt(false);
  }

  async function handleAddCustomMedia(e: React.FormEvent) {
    e.preventDefault();
    const label = customLabel.trim();
    const widthMm = parseMm(customWidthMm);
    const heightMm = parseMm(customHeightMm);
    if (!label) {
      setCustomFormError("请输入此纸张尺寸的名称。");
      return;
    }
    if (widthMm === null || heightMm === null) {
      setCustomFormError("宽度和高度必须是正数，单位为毫米。");
      return;
    }
    setCustomFormError(null);
    try {
      await addCustomMedia({
        label,
        widthTenthsMm: Math.round(widthMm * 10),
        heightTenthsMm: Math.round(heightMm * 10),
      });
      setCustomLabel("");
      setCustomWidthMm("");
      setCustomHeightMm("");
    } catch {
      setCustomFormError("无法添加自定义纸张尺寸。详情请查看错误提示。");
    }
  }

  async function handleRemoveCustomMedia(label: string) {
    setCustomFormError(null);
    try {
      await removeCustomMedia(label);
    } catch {
      setCustomFormError("无法移除自定义纸张尺寸。详情请查看错误提示。");
    }
  }

  return (
    <Card
      className="panel sharing-panel space-y-4"
      aria-labelledby="sharing-heading"
      data-has-identity={identity ? "true" : "false"}
    >
      <div className="panel-header flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2.5">
          <div className="flex size-7 items-center justify-center rounded-lg bg-primary/10 text-primary">
            <Printer size={16} />
          </div>
          <div>
            <h2 id="sharing-heading" className="text-base font-semibold leading-none">
              本地打印机
            </h2>
            <p className="hint text-xs mt-1 text-muted-foreground">
              选择允许客户端打印的队列。
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {runtime ? (
            isSharingRunning ? (
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => void handleStopSharingClick()}
                disabled={isTransitioning}
                aria-label="停止共享"
                className="text-xs h-8 text-destructive hover:text-destructive"
              >
                <Square size={13} className="mr-1 fill-destructive" aria-hidden="true" />
                停止共享
              </Button>
            ) : (
              <Button
                type="button"
                variant="default"
                size="sm"
                onClick={() => void handleStartSharingClick()}
                disabled={isTransitioning || sharedCount === 0}
                aria-label="开始共享"
                className="text-xs h-8"
              >
                <Play size={13} className="mr-1 fill-current" aria-hidden="true" />
                开始共享
              </Button>
            )
          ) : null}

          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => void refresh()}
            disabled={changing}
            className="text-xs h-8"
            aria-label="刷新本地打印机"
          >
            <RefreshCw size={14} className={changing ? "animate-spin mr-1.5" : "mr-1.5"} aria-hidden="true" />
            刷新
          </Button>
        </div>
      </div>

      {showChannelPrompt ? (
        <div className="rounded-lg border border-primary/30 bg-primary/5 p-4 space-y-3" role="region" aria-label="共享前设置网络通道">
          <div className="flex items-center gap-2 text-sm font-semibold">
            <KeyRound size={16} className="text-primary" />
            <span>共享前设置网络通道</span>
          </div>
          <p className="text-xs text-muted-foreground">
            需要共享的网络通道，以便只有授权的客户端可以提交打印任务。
          </p>
          {channelError ? (
            <p className="text-xs text-destructive font-medium">{channelError}</p>
          ) : null}
          <form onSubmit={(e) => void handleSaveChannelAndStartSharing(e)} className="space-y-3">
            <Input
              type="password"
              placeholder="输入共享密钥"
              value={channelInput}
              onChange={(e) => setChannelInput(e.target.value)}
              aria-label="网络通道密钥"
              className="text-xs h-8"
              autoFocus
            />
            <div className="flex items-center gap-2 justify-end">
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={handleCancelChannelPrompt}
                className="text-xs h-8"
              >
                取消
              </Button>
              <Button
                type="submit"
                variant="default"
                size="sm"
                disabled={!channelInput.trim()}
                className="text-xs h-8"
              >
                保存并开始共享
              </Button>
            </div>
          </form>
        </div>
      ) : null}

      {error ? (
        <p className="banner sharing-error" role="alert">
          <span className="banner-code">{error.code}</span>
          <span className="banner-message">{error.message}</span>
          <Button type="button" variant="ghost" size="sm" onClick={dismissError}>
            忽略
          </Button>
        </p>
      ) : null}

      <div className="sharing-queue-area">
        {printers === null ? (
          <p className="hint text-xs text-muted-foreground" role="status">
            正在读取本地打印机队列…
          </p>
        ) : null}

        {printers !== null && printers.length === 0 ? (
          <div className="empty-state rounded-lg border border-dashed border-border/80 p-6 text-center text-xs">
            <span className="empty-state-mark mx-auto mb-2 flex size-8 items-center justify-center rounded-lg bg-muted text-muted-foreground" aria-hidden="true">—</span>
            <div>
              <strong className="text-sm font-semibold text-foreground">未找到本地打印机</strong>
              <p className="hint mt-1 text-muted-foreground">请在 Windows 中安装打印机，然后刷新此列表。</p>
            </div>
          </div>
        ) : null}

        {printers !== null && printers.length > 0 ? (
          <div className="sharing-printers space-y-3">
            {printers.length > 5 && (
              <div className="relative">
                <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
                <Input
                  id={searchId}
                  aria-label="搜索打印机"
                  placeholder="搜索打印机"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="pl-8 text-xs h-8"
                />
              </div>
            )}

            <div className="printer-list-heading flex items-center justify-between text-xs font-semibold text-muted-foreground border-b border-border/60 pb-1.5 px-1">
              <span>打印机队列</span>
              <span className="font-mono text-[11px] bg-muted px-2 py-0.5 rounded-full text-foreground">
                {sharedCount} / {printers.length} 已共享
              </span>
            </div>

            {filteredPrinters.length > 0 ? (
              <ul className="printer-list divide-y divide-border/60">
                {filteredPrinters.map((printer, index) => {
                  const printerId = `${searchId}-queue-${index}`;
                  return (
                    <li
                      key={printer.name}
                      className="printer flex items-center justify-between py-2 px-1 hover:bg-muted/30 rounded-md transition-colors"
                      data-printer={printer.name}
                      data-shared={printer.shared}
                    >
                      <div className="printer-choice flex items-center gap-3 select-none">
                        <Checkbox
                          id={printerId}
                          aria-label={`共享 ${printer.name}`}
                          checked={printer.shared}
                          disabled={changing}
                          onCheckedChange={() => void toggle(printer.name)}
                        />
                        <span className="printer-name text-sm font-medium text-foreground">{printer.name}</span>
                      </div>
                      <Badge variant={printer.shared ? "success" : "muted"} className="text-xs">
                        {printer.shared ? "已共享" : "未共享"}
                      </Badge>
                    </li>
                  );
                })}
              </ul>
            ) : (
              <p className="hint printer-filter-empty" role="status">
                没有与“{searchQuery}”匹配的打印机。
              </p>
            )}

            <p className="sharing-count text-xs text-muted-foreground mt-1 px-1">
              {sharedCount === 0
                ? "请至少选择一个队列，然后开始服务器共享。"
                : isSharingRunning
                  ? "已选队列正在与客户端共享。"
                  : "点击“开始共享”后，已选队列将被共享。"}
            </p>
          </div>
        ) : null}
      </div>

      <div className="custom-media rounded-lg border border-border bg-card p-4 space-y-3 mt-2">
        <div className="flex items-center gap-2">
          <Ruler size={16} className="text-primary" aria-hidden="true" />
          <h3 className="text-sm font-semibold text-foreground">自定义纸张尺寸</h3>
        </div>
        <p className="hint text-xs text-muted-foreground">
          添加内置目录之外的纸张尺寸。客户端打印时即可选择它们。
        </p>

        {customMedia === null ? (
          <p className="hint text-xs text-muted-foreground" role="status">
            正在读取自定义纸张尺寸…
          </p>
        ) : customMedia.length === 0 ? (
          <p className="hint text-xs text-muted-foreground">
            未配置自定义纸张尺寸。
          </p>
        ) : (
          <ul className="custom-media-list divide-y divide-border/60">
            {customMedia.map((media) => (
              <li
                key={media.label}
                className="flex items-center justify-between gap-2 py-1.5"
                data-custom-media={media.label}
              >
                <span className="text-sm font-medium text-foreground truncate">{media.label}</span>
                <span className="text-xs font-mono text-muted-foreground shrink-0">
                  {fmtMm(media.widthTenthsMm)} × {fmtMm(media.heightTenthsMm)} mm
                </span>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  aria-label={`移除 ${media.label}`}
                  disabled={customMediaBusy}
                  onClick={() => void handleRemoveCustomMedia(media.label)}
                  className="text-xs h-7 w-7 p-0 text-muted-foreground hover:text-destructive"
                >
                  <Trash2 size={14} aria-hidden="true" />
                </Button>
              </li>
            ))}
          </ul>
        )}

        <form
          onSubmit={(e) => void handleAddCustomMedia(e)}
          className="custom-media-form grid grid-cols-1 gap-2 sm:grid-cols-[1fr_auto_auto_auto] sm:items-end"
        >
          <Input
            placeholder="名称（例如 收据 80x120）"
            value={customLabel}
            onChange={(e) => setCustomLabel(e.target.value)}
            aria-label="自定义纸张尺寸名称"
            className="text-xs h-8"
            maxLength={80}
          />
          <Input
            type="number"
            step="0.1"
            min="50"
            placeholder="宽度（毫米）"
            value={customWidthMm}
            onChange={(e) => setCustomWidthMm(e.target.value)}
            aria-label="自定义纸张尺寸宽度（毫米）"
            className="text-xs h-8 w-28"
          />
          <Input
            type="number"
            step="0.1"
            min="50"
            placeholder="高度（毫米）"
            value={customHeightMm}
            onChange={(e) => setCustomHeightMm(e.target.value)}
            aria-label="自定义纸张尺寸高度（毫米）"
            className="text-xs h-8 w-28"
          />
          <Button
            type="submit"
            variant="outline"
            size="sm"
            disabled={customMediaBusy}
            className="text-xs h-8"
          >
            <Plus size={13} className="mr-1" aria-hidden="true" />
            添加
          </Button>
        </form>
        {customFormError ? (
          <p className="text-xs text-destructive font-medium" role="alert">
            {customFormError}
          </p>
        ) : null}
      </div>

      {identity ? (
        <div className="identity rounded-lg border border-border bg-card p-4 space-y-3 mt-2">
          <div className="identity-heading flex items-start justify-between gap-3">
            <div>
              <div className="flex items-center gap-2">
                <ShieldCheck size={16} className="text-primary" />
                <h3 className="text-sm font-semibold text-foreground">服务器身份</h3>
              </div>
              <p className="hint text-xs text-muted-foreground mt-1">
                客户端在查看共享打印机前会核验此指纹。
              </p>
            </div>
            <Badge variant="info" className="text-xs font-mono">
              端口 {identity.port}
            </Badge>
          </div>

          <div className="fingerprint-row flex flex-col sm:flex-row sm:items-center gap-2">
            <code
              className="fingerprint flex-1 rounded bg-muted/70 p-2 font-mono text-xs text-foreground tracking-wider break-all"
              data-testid="server-fingerprint"
            >
              {identity.fingerprint}
            </code>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => void copyFingerprint()}
              className="shrink-0 text-xs h-8 gap-1.5 self-start sm:self-center"
            >
              <Copy size={13} aria-hidden="true" />
              复制
            </Button>
          </div>

          {copyMessage ? (
            <p className="copy-message text-xs text-emerald-600 dark:text-emerald-400 font-medium" role="status">
              {copyMessage}
            </p>
          ) : null}
        </div>
      ) : null}
    </Card>
  );
}
