import { Laptop, Printer, RefreshCw, ShieldAlert, ShieldCheck, Trash2 } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import type { TrustedServersController } from "../hooks/useTrustedServers";

interface TrustedServersPanelProps {
  trusted: TrustedServersController;
  onReviewServer: (address: string) => void;
}

export function TrustedServersPanel({ trusted, onReviewServer }: TrustedServersPanelProps) {
  const { servers, loading, refreshing, forgetting, error, refresh, forget } = trusted;

  return (
    <section className="panel feature-panel trusted-servers-panel" aria-labelledby="trusted-servers-heading">
      <div className="panel-header flex items-center gap-2.5">
        <div className="flex size-7 items-center justify-center rounded-lg bg-primary/10 text-primary">
          <ShieldCheck size={16} />
        </div>
        <div>
          <h2 id="trusted-servers-heading" className="text-base font-semibold leading-none">
            受信任的服务器
          </h2>
          <p className="hint mt-1 text-xs text-muted-foreground">
            已保存的证书授权会保留在这里，包括其他网络上的服务器。
          </p>
        </div>
      </div>

      {error ? (
        <p className="banner" role="alert">
          <span className="banner-code">{error.code}</span>
          <span className="banner-message">{error.message}</span>
        </p>
      ) : null}

      {loading && servers.length === 0 ? (
        <p className="connection-empty" role="status">
          正在检查已保存的受信任服务器…
        </p>
      ) : servers.length === 0 ? (
        <div className="connection-empty" role="status">
          <strong>还没有受信任的服务器。</strong>
          <p>添加打印机并批准其证书，即可将该服务器保留在这里。</p>
        </div>
      ) : (
        <ul className="trusted-server-list divide-y divide-border/60" aria-label="受信任服务器目录">
          {servers.map((server) => {
            const isOnline = server.status === "online";
            const identityChanged = server.status === "identity_changed";
            const isRefreshing = refreshing[server.address] || server.status === "checking";
            const badge = isOnline
              ? { label: "在线", variant: "success" as const }
              : identityChanged
                ? { label: "身份已变更", variant: "warning" as const }
                : server.status === "checking"
                  ? { label: "检查中", variant: "muted" as const }
                  : { label: "离线", variant: "warning" as const };

            return (
              <li key={server.address} className="trusted-server-row py-4 first:pt-1 last:pb-1">
                <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                  <div className="min-w-0 flex-1 space-y-2">
                    <div className="flex flex-wrap items-center gap-2">
                      <Laptop size={16} className="shrink-0 text-primary" />
                      <code className="break-all rounded bg-muted px-1.5 py-0.5 font-mono text-xs font-semibold text-foreground">
                        {server.address}
                      </code>
                      <Badge variant={badge.variant} role="status">
                        {badge.label}
                      </Badge>
                    </div>

                    {isOnline ? (
                      <>
                        <p className="hint flex items-center gap-1.5 text-xs text-emerald-700 dark:text-emerald-300">
                          <ShieldCheck size={14} /> 证书与已保存的授权一致。
                        </p>
                        <div className="hint flex items-start gap-1.5 text-xs text-muted-foreground">
                          <Printer size={14} className="mt-0.5 shrink-0" />
                          <p>
                            {server.printers.length > 0
                              ? `共享打印机：${server.printers.join(", ")}`
                              : "当前没有共享打印机。"}
                          </p>
                        </div>
                      </>
                    ) : identityChanged ? (
                      <p className="hint flex items-start gap-1.5 text-xs text-amber-800 dark:text-amber-200" role="alert">
                        <ShieldAlert size={14} className="mt-0.5 shrink-0" />
                        <span>
                          证书已变更。已保存指纹：{" "}
                          <code className="break-all font-mono">{server.fingerprint}</code>。当前指纹：{" "}
                          <code className="break-all font-mono">{server.current_fingerprint ?? "不可用"}</code>。
                          在复核身份前，打印机列表将被隐藏。
                        </span>
                      </p>
                    ) : server.status === "offline" ? (
                      <p className="hint text-xs text-muted-foreground">
                        服务器无法访问。其已保存的授权会被保留。
                      </p>
                    ) : (
                      <p className="hint text-xs text-muted-foreground">正在检查已保存的指纹与共享打印机…</p>
                    )}
                  </div>

                  <div className="flex flex-wrap items-center gap-2 lg:justify-end">
                    {isOnline || identityChanged ? (
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        className="text-xs"
                        onClick={() => onReviewServer(server.address)}
                        aria-label={`${identityChanged ? "复核身份" : "复核共享打印机"}：${server.address}`}
                      >
                        {identityChanged ? "复核身份" : "复核打印机"}
                      </Button>
                    ) : null}
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      className="text-xs"
                      onClick={() => void refresh(server.address)}
                      disabled={isRefreshing || Boolean(forgetting[server.address])}
                      aria-label={`刷新 ${server.address} 的状态`}
                    >
                      <RefreshCw size={13} className={isRefreshing ? "animate-spin" : ""} />
                      刷新
                    </Button>
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      className="text-xs text-muted-foreground hover:text-destructive"
                      onClick={() => void forget(server.address)}
                      disabled={Boolean(forgetting[server.address]) || Boolean(refreshing[server.address])}
                      aria-label={`忘记 ${server.address}`}
                    >
                      <Trash2 size={13} />
                      忘记
                    </Button>
                  </div>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
