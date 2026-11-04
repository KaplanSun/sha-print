import { Check, Copy, Network, Printer, RefreshCw, ShieldAlert } from "lucide-react";
import { useState } from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { ServerConnectionsController } from "../hooks/useServerConnections";

export function ServerConnectionsPanel({
  connections,
}: {
  connections: ServerConnectionsController;
}) {
  const {
    address,
    setAddress,
    review,
    result,
    installed,
    busy,
    error,
    inspect,
    approve,
    query,
    install,
  } = connections;

  const [copied, setCopied] = useState(false);

  async function handleCopyFingerprint(fp: string) {
    try {
      await navigator.clipboard.writeText(fp);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // clipboard access error
    }
  }

  return (
    <section className="panel feature-panel server-address-panel" aria-labelledby="client-connections-heading">
      <div className="panel-header flex items-center justify-between">
        <div className="flex items-center gap-2.5">
          <div className="flex size-7 items-center justify-center rounded-lg bg-primary/10 text-primary">
            <Network size={16} />
          </div>
          <div>
            <h2 id="client-connections-heading" className="text-base font-semibold leading-none">
              按地址添加
            </h2>
            <p className="hint text-xs mt-1 text-muted-foreground">
              当位于其他子网或发现无结果时使用。
            </p>
          </div>
        </div>
      </div>

      <p className="hint connection-safety-note">
        输入主机或 主机:端口。ShaPrint 会先检查其指纹；在你批准前，打印机保持隐藏。
      </p>

      <form
        onSubmit={(event) => {
          event.preventDefault();
          void inspect();
        }}
        className="space-y-2"
      >
        <label htmlFor="server-address" className="text-xs font-semibold text-foreground block">
          服务器地址
        </label>
        <div className="flex flex-col sm:flex-row gap-2">
          <Input
            id="server-address"
            value={address}
            onChange={(event) => setAddress(event.currentTarget.value)}
            placeholder="printer.local or 192.168.1.20:48631"
            autoComplete="off"
            disabled={busy !== null}
            className="flex-1"
          />
          <Button
            type="submit"
            disabled={busy !== null || address.trim() === ""}
            className="shrink-0 font-medium"
          >
            {busy === "inspect" ? (
              <>
                <RefreshCw size={14} className="animate-spin mr-1.5" />
                <span>正在复核…</span>
              </>
            ) : (
              "检查证书"
            )}
          </Button>
        </div>
      </form>

      {error ? (
        <p className="banner" role="alert">
          <span className="banner-code">{error.code}</span>
          <span className="banner-message">{error.message}</span>
        </p>
      ) : null}

      {review ? (
        <div
          className="identity connection-review space-y-3"
          data-trusted={review.trusted}
          aria-live="polite"
        >
          <div className="flex items-center justify-between">
            <p className="text-sm">
              <strong className="text-foreground">服务器：</strong>{" "}
              <span className="font-mono text-muted-foreground">{review.address}</span>
            </p>
            <Badge variant={review.trusted ? "success" : "warning"}>
              {review.trusted ? "已批准" : "需要复核"}
            </Badge>
          </div>

          {review.previous_fingerprint ? (
            <div className="fingerprint-changed" role="alert">
              <div className="flex items-center gap-1.5 font-semibold">
                <ShieldAlert size={14} />
                <span>此前已批准的指纹：</span>
              </div>
              <code className="block font-mono text-[11px] break-all bg-background/50 p-1 rounded">
                {review.previous_fingerprint}
              </code>
            </div>
          ) : null}

          <div className="space-y-1">
            <div className="flex items-center justify-between text-xs text-muted-foreground">
              <strong>当前提供的 SHA-256 指纹：</strong>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="h-6 px-2 text-[11px]"
                onClick={() => void handleCopyFingerprint(review.current_fingerprint)}
              >
                {copied ? <Check size={12} className="text-emerald-500 mr-1" /> : <Copy size={12} className="mr-1" />}
                {copied ? "已复制" : "复制"}
              </Button>
            </div>
            <code className="block rounded bg-muted/70 p-2 font-mono text-xs text-foreground tracking-wider break-all">
              {review.current_fingerprint}
            </code>
          </div>

          {review.trusted ? (
            <div className="pt-2 flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-t border-border/70">
              <p className="hint text-xs text-muted-foreground">
                此指纹与已保存的授权一致。
              </p>
              <Button
                type="button"
                size="sm"
                onClick={() => void query()}
                disabled={busy !== null}
                className="shrink-0 text-xs"
              >
                {busy === "printers" ? (
                  <>
                    <RefreshCw size={13} className="animate-spin mr-1" />
                    <span>正在加载打印机…</span>
                  </>
                ) : (
                  "显示共享打印机"
                )}
              </Button>
            </div>
          ) : (
            <div className="pt-2 space-y-2 border-t border-border/70">
              <p className="hint text-xs text-muted-foreground">
                {review.previous_fingerprint
                  ? "身份已变更，打印机已被阻止。请先通过可信渠道与服务器所有者核实此新指纹，再重新批准。"
                  : "批准前，请通过可信渠道与服务器所有者核实此指纹。"}
              </p>
              <Button
                type="button"
                size="sm"
                onClick={() => void approve()}
                disabled={busy !== null}
                className="text-xs"
              >
                {busy === "approve"
                  ? "正在保存授权…"
                  : review.previous_fingerprint
                    ? "明确重新批准此指纹"
                    : "批准此指纹"}
              </Button>
            </div>
          )}
        </div>
      ) : null}

      {result ? (
        <div aria-live="polite" className="space-y-3 pt-2">
          <div className="flex items-center gap-2">
            <Printer size={16} className="text-primary" />
            <h3 className="text-sm font-semibold">{result.address} 共享的打印机</h3>
          </div>

          {result.printers.length ? (
            <ul className="printer-list divide-y divide-border/60">
              {result.printers.map((name) => (
                <li
                  key={name}
                  className="printer flex items-center justify-between py-2.5"
                  data-shared-printer={name}
                >
                  <span className="printer-name text-sm font-medium">{name}</span>
                  <Button
                    type="button"
                    size="sm"
                    onClick={() => void install(name)}
                    disabled={busy !== null}
                    aria-label={`为 ${name} 安装 Windows 队列`}
                    className="text-xs h-8"
                  >
                    {busy === "install" ? "正在安装…" : "安装 Windows 队列"}
                  </Button>
                </li>
              ))}
            </ul>
          ) : (
            <p className="hint text-xs text-muted-foreground">
              该服务器当前未共享任何打印机。
            </p>
          )}

          <p className="hint text-xs text-muted-foreground">
            安装会创建一个正常的 Windows 打印机队列，其打印任务通过本应用的本地代理发送。
            Windows 只需一次管理员授权；队列在 ShaPrint 重启后仍可继续使用。
          </p>
        </div>
      ) : null}

      {installed ? (
        <p className="hint text-xs text-emerald-700 dark:text-emerald-400 bg-emerald-500/10 p-3 rounded-lg border border-emerald-500/20" role="status">
          已安装 <strong>{installed.queue_name}</strong>。它现在会出现在 Windows 打印
          对话框中。ShaPrint 会通过客户端代理将其任务路由至 {installed.printer_name}。
        </p>
      ) : null}
    </section>
  );
}
