import { useState, useEffect } from "react";
import {
  Check,
  CheckCircle2,
  Copy,
  KeyRound,
  Laptop,
  Printer,
  Radio,
  RefreshCw,
  ShieldAlert,
  ShieldCheck,
} from "lucide-react";

import type { ClientQueue, NearbyServer } from "@/api/types";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input, PasswordInput } from "@/components/ui/input";
import { ServerVersionBadges } from "./ServerVersionBadges";
import type { NearbyServersController } from "../hooks/useNearbyServers";
import type { ServerConnectionsController } from "../hooks/useServerConnections";
import type { NetworkChannelController } from "@/features/network-channel";

export function chunkFingerprint(fingerprint: string): string {
  if (!fingerprint) return "";
  const parts = fingerprint.split(":");
  if (parts.length <= 1) return fingerprint;
  const chunks: string[] = [];
  for (let i = 0; i < parts.length; i += 4) {
    chunks.push(parts.slice(i, i + 4).join(""));
  }
  return chunks.join(" • ");
}

interface AddPrinterDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  nearby: NearbyServersController;
  connections: ServerConnectionsController;
  networkChannel: NetworkChannelController;
  onInstalled?: (queue: ClientQueue) => void;
  onEnsureProxyRunning?: () => void;
}

type WizardStep = "servers" | "verify" | "printers" | "channel" | "success";

export function AddPrinterDialog({
  open,
  onOpenChange,
  nearby,
  connections,
  networkChannel,
  onInstalled,
  onEnsureProxyRunning,
}: AddPrinterDialogProps) {
  const [step, setStep] = useState<WizardStep>("servers");
  const [manualAddress, setManualAddress] = useState("");
  const [selectedPrinter, setSelectedPrinter] = useState<string | null>(null);
  const [channelInput, setChannelInput] = useState("");
  const [copyStatus, setCopyStatus] = useState(false);

  const { review, result, installed, busy, error } = connections;
  const needsChannel = networkChannel.configured === false;
  const steps = needsChannel
    ? (["服务器", "身份", "打印机", "网络通道"] as const)
    : (["服务器", "身份", "打印机"] as const);

  const currentStepIndex =
    step === "servers" ? 0 : step === "verify" ? 1 : step === "printers" ? 2 : 3;

  // Reset dialog state when closed or opened
  useEffect(() => {
    if (open) {
      setSelectedPrinter(null);
      setCopyStatus(false);
      setChannelInput("");
      setManualAddress("");
    } else {
      setStep("servers");
      connections.reset();
    }
  }, [open]);

  // When review updates
  useEffect(() => {
    if (!review) return;

    if (review.trusted) {
      // If already trusted, query printers automatically and jump to printers step
      void connections.query();
      setStep("printers");
    } else {
      // If untrusted/new/changed, show verification step
      setStep("verify");
    }
  }, [review]);

  // When result arrives
  useEffect(() => {
    if (result && step !== "success" && step !== "channel") {
      setStep("printers");
    }
  }, [result, step]);

  // When queue installed successfully
  useEffect(() => {
    if (installed) {
      onInstalled?.(installed);
      onEnsureProxyRunning?.();
      setStep("success");
    }
  }, [installed]);

  async function handleSelectServer(address: string) {
    await connections.reviewAddress(address);
  }

  async function handleManualSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!manualAddress.trim()) return;
    await connections.reviewAddress(manualAddress.trim());
  }

  async function handleApproveAndContinue() {
    await connections.approve();
    await connections.query();
    setStep("printers");
  }

  async function handleInstallPrinter(printerName: string) {
    setSelectedPrinter(printerName);

    // If local network channel is not configured, prompt for it before installing
    if (networkChannel.configured === false) {
      setStep("channel");
      return;
    }

    onEnsureProxyRunning?.();
    await connections.install(printerName);
  }

  async function handleSaveChannelAndInstall(e: React.FormEvent) {
    e.preventDefault();
    if (!channelInput.trim() || !selectedPrinter) return;

    const saved = await networkChannel.save(channelInput);
    if (saved) {
      setChannelInput("");
      onEnsureProxyRunning?.();
      await connections.install(selectedPrinter);
    }
  }

  async function handleCopyFingerprint() {
    if (!review?.current_fingerprint) return;
    try {
      await navigator.clipboard.writeText(review.current_fingerprint);
      setCopyStatus(true);
      setTimeout(() => setCopyStatus(false), 2000);
    } catch {
      // Clipboard write failed
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      ariaLabelledBy="add-printer-title"
      ariaDescribedBy="add-printer-description"
    >
      <DialogHeader className="printer-wizard-header">
        <DialogTitle id="add-printer-title">
          {step === "servers" && "查找服务器"}
          {step === "verify" && "检查服务器身份"}
          {step === "printers" && "选择打印机"}
          {step === "channel" && "设置网络通道"}
          {step === "success" && "打印机已安装"}
        </DialogTitle>
        <DialogDescription id="add-printer-description">
          {step === "servers" &&
            "选择一个附近的 ShaPrint 服务器，或输入其地址。在你批准其指纹前，打印机保持隐藏。"}
          {step === "verify" &&
            "批准前，请将该指纹与服务器所有者核对。批准后，ShaPrint 才能列出共享打印机。"}
          {step === "printers" &&
            `选择 ${review?.address ?? "该服务器"} 共享的打印机。`}
          {step === "channel" &&
            "该服务器需要一个网络通道来授权打印任务。请使用服务器上配置的相同值。"}
          {step === "success" &&
            "Windows 打印机队列已安装。你可以在任何 Windows 打印对话框中选择它。"}
        </DialogDescription>
      </DialogHeader>

      <ol className="wizard-progress" aria-label="打印机设置步骤">
        {steps.map((label, index) => {
          const complete = step === "success" || index < currentStepIndex;
          const current = step !== "success" && index === currentStepIndex;
          return (
            <li
              key={label}
              className={`wizard-step${complete ? " is-complete" : ""}${current ? " is-current" : ""}`}
              aria-current={current ? "step" : undefined}
            >
              <span className="wizard-step-marker" aria-hidden="true">
                {complete ? <Check size={12} /> : index + 1}
              </span>
              <span>{label}</span>
            </li>
          );
        })}
      </ol>

      {error ? (
        <div className="wizard-error" role="alert">
          <span className="banner-code">{error.code}</span>
          <span>{error.message}</span>
        </div>
      ) : null}
      {step === "channel" && networkChannel.error ? (
        <div className="wizard-error" role="alert">
          <span className="banner-code">{networkChannel.error.code}</span>
          <span>{networkChannel.error.message}</span>
        </div>
      ) : null}

      {/* STEP 1: Select Server */}
      {step === "servers" && (
        <div className="space-y-4 my-2">
          <div className="space-y-2">
            <div className="wizard-section-heading">
              <span className="wizard-section-title">
                <Radio size={15} aria-hidden="true" />
                附近服务器
              </span>
              <span className="wizard-server-count" role="status">
                发现 {nearby.servers.length} 台服务器
              </span>
            </div>

            {nearby.servers.length === 0 ? (
              <div className="connection-empty wizard-empty" role="status">
                <strong>本网络上未发现服务器。</strong>
                <p>请在下方输入服务器地址。发现功能不跨子网。</p>
              </div>
            ) : (
              <div className="max-h-56 overflow-y-auto space-y-2 pr-1">
                {nearby.servers.map((server: NearbyServer) => {
                  return (
                    <div
                      key={server.address}
                      className="wizard-server-option"
                    >
                      <div className="min-w-0 pr-2">
                        <div className="flex flex-wrap items-center gap-2">
                          <Laptop size={16} className="text-primary shrink-0" />
                          <span className="font-semibold text-sm truncate">{server.name}</span>
                          <ServerVersionBadges version={server.version} />
                        </div>
                        <div className="text-xs text-muted-foreground mt-0.5 font-mono">
                          {server.address}
                        </div>
                        <div className="text-[11px] text-muted-foreground mt-1">
                          {server.printers.length > 0
                            ? `广播（未验证）：${server.printers.join(", ")}`
                            : "共享 0 台打印机"}
                        </div>
                      </div>
                      <Button
                        size="sm"
                        onClick={() => void handleSelectServer(server.address)}
                        disabled={busy !== null}
                      >
                        {busy === "inspect" && connections.address === server.address
                          ? "正在复核…"
                          : "复核身份"}
                      </Button>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          <div className="manual-server-entry">
            <label htmlFor="wizard-server-address" className="wizard-field-label">
              或输入服务器地址
            </label>
            <form onSubmit={(e) => void handleManualSubmit(e)} className="flex gap-2">
              <Input
                id="wizard-server-address"
                placeholder="printer.local or 192.168.1.50:48631"
                value={manualAddress}
                onChange={(e) => setManualAddress(e.target.value)}
                autoComplete="off"
                disabled={busy !== null}
              />
              <Button type="submit" disabled={busy !== null || !manualAddress.trim()}>
                {busy === "inspect" ? "正在复核…" : "复核身份"}
              </Button>
            </form>
          </div>
        </div>
      )}

      {/* STEP 2: Verify Identity */}
      {step === "verify" && review && (
        <div className="space-y-4 my-2">
          {review.previous_fingerprint ? (
            <div className="wizard-trust-warning" role="alert">
              <ShieldAlert size={18} className="shrink-0" aria-hidden="true" />
              <div>
                <strong>服务器身份已变更。</strong>
                <p>
                  此指纹与你之前批准的指纹不匹配。请通过可信渠道与服务器所有者核实变更后再重新批准。
                </p>
              </div>
            </div>
          ) : (
            <div className="wizard-trust-note" role="status">
              <ShieldCheck size={18} className="shrink-0 text-primary" aria-hidden="true" />
              <div>
                <strong>新服务器</strong>
                <p>
                  将该指纹与服务器电脑上显示的代码核对。在批准匹配前，打印机保持隐藏。
                </p>
              </div>
            </div>
          )}

          <div className="wizard-fingerprint">
            <div className="flex items-center justify-between text-xs text-muted-foreground">
              <span>服务器地址</span>
              <span className="font-mono font-semibold text-foreground">{review.address}</span>
            </div>

            <div>
              <span className="wizard-field-label block mb-1">服务器指纹（SHA-256）</span>
              <div className="wizard-fingerprint-value">
                <span>{chunkFingerprint(review.current_fingerprint)}</span>
                <Button
                  size="sm"
                  variant="ghost"
                  className="h-7 px-2 shrink-0"
                  onClick={() => void handleCopyFingerprint()}
                >
                  {copyStatus ? <Check size={13} className="text-emerald-500" /> : <Copy size={13} />}
                  <span className="text-[11px] ml-1" aria-live="polite">
                    {copyStatus ? "已复制" : "复制"}
                  </span>
                </Button>
              </div>
            </div>
          </div>

          <div className="flex justify-end gap-2 pt-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => setStep("servers")}
              disabled={busy !== null}
            >
              上一步
            </Button>
            <Button
              type="button"
              size="sm"
              onClick={() => void handleApproveAndContinue()}
              disabled={busy !== null}
            >
              {busy === "approve"
                ? "正在保存授权…"
                : review.previous_fingerprint
                  ? "重新批准指纹"
                  : "批准指纹"}
            </Button>
          </div>
        </div>
      )}

      {/* STEP 3: Choose Printer */}
      {step === "printers" && (
        <div className="space-y-4 my-2">
          <div className="wizard-approved-server" role="status">
            <span>已批准服务器：{connections.address}</span>
            <Badge variant="success">指纹已批准</Badge>
          </div>

          <div className="space-y-2">
            <h3 className="wizard-section-title">共享打印机</h3>

            {busy === "printers" ? (
              <p className="wizard-loading" role="status">
                <RefreshCw className="size-4 text-primary" aria-hidden="true" />
                正在加载共享打印机…
              </p>
            ) : !result || result.printers.length === 0 ? (
              <div className="connection-empty" role="status">
                <strong>还没有共享的打印机。</strong>
                <p>请服务器所有者在他们的“共享打印机”页面选择本地打印机队列。</p>
              </div>
            ) : (
              <div className="space-y-2 max-h-56 overflow-y-auto pr-1">
                {result.printers.map((name: string) => (
                  <div
                    key={name}
                    className="wizard-printer-option"
                  >
                    <div className="flex items-center gap-2.5">
                      <Printer size={17} className="text-primary shrink-0" />
                      <div>
                        <span className="font-semibold text-sm">{name}</span>
                        <p className="text-[11px] text-muted-foreground">
                          通过本地代理安装为 Windows 队列
                        </p>
                      </div>
                    </div>
                    <Button
                      size="sm"
                      disabled={busy !== null}
                      onClick={() => void handleInstallPrinter(name)}
                    >
                      {busy === "install" && selectedPrinter === name ? "正在安装…" : "安装"}
                    </Button>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {/* STEP 4: Network Channel Prompt */}
      {step === "channel" && (
        <form onSubmit={(e) => void handleSaveChannelAndInstall(e)} className="space-y-4 my-2">
          <div className="wizard-channel-note">
            <KeyRound size={18} className="shrink-0 text-warning" aria-hidden="true" />
            <div>
              <strong>需要网络通道</strong>
              <p>
                请输入服务器上配置的相同值。它用于在这些电脑之间授权打印任务。
              </p>
            </div>
          </div>

          <div className="space-y-1.5">
            <label htmlFor="wizard-network-channel" className="wizard-field-label">
              网络通道
            </label>
            <PasswordInput
              id="wizard-network-channel"
              visibilityLabel="网络通道"
              autoComplete="new-password"
              placeholder="输入共享的网络通道"
              value={channelInput}
              onChange={(e) => setChannelInput(e.target.value)}
              required
              disabled={networkChannel.saving || busy !== null}
            />
          </div>

          <div className="flex justify-end gap-2 pt-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => setStep("printers")}
              disabled={networkChannel.saving || busy !== null}
            >
              上一步
            </Button>
            <Button
              type="submit"
              size="sm"
              disabled={networkChannel.saving || !channelInput.trim() || busy !== null}
            >
              {networkChannel.saving ? "正在保存…" : "保存网络通道并安装"}
            </Button>
          </div>
        </form>
      )}

      {/* STEP 5: Success */}
      {step === "success" && installed && (
        <div className="wizard-success">
          <div className="wizard-success-heading" role="status">
            <CheckCircle2 size={22} aria-hidden="true" />
            <div>
              <h3>{installed.queue_name}</h3>
              <p>已安装。你可以在任何 Windows 打印对话框中选择此打印机。</p>
            </div>
          </div>

          <dl className="wizard-install-details" aria-label="已安装打印机详情">
            <div>
              <dt>共享打印机</dt>
              <dd>{installed.printer_name}</dd>
            </div>
            <div>
              <dt>服务器</dt>
              <dd>{installed.server_address}</dd>
            </div>
          </dl>

          <div className="wizard-success-actions">
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                setStep("printers");
              }}
            >
              继续安装
            </Button>
            <Button size="sm" onClick={() => onOpenChange(false)}>
              完成
            </Button>
          </div>
        </div>
      )}
    </Dialog>
  );
}
