import { FlaskConical, Network, Printer, Settings2, ShieldAlert, Wrench } from "lucide-react";
import { useState } from "react";
import type { RecognisedClientQueue } from "@/api/types";
import { LocalTroubleshootingDialog } from "@/features/client-connection/components/LocalTroubleshootingDialog";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { CLIENT_VERSION, isNightly } from "@/lib/version";
import {
  AddPrinterDialog,
  InstalledClientQueuesPanel,
  TrustedServersPanel,
  useNearbyServers,
  useRecognisedClientQueues,
  useServerConnections,
  useTrustedServers,
} from "@/features/client-connection";
import { NetworkChannelPanel, useNetworkChannel } from "@/features/network-channel";
import { PrintFailuresPanel, usePrintFailures } from "@/features/print-failures";
import { SoftwareUpdatesPanel } from "@/features/updates/components/SoftwareUpdatesPanel";
import { UpdateNotice, useUpdates } from "@/features/updates";
import { PrinterSharingPanel, usePrinterSharing } from "@/features/printer-sharing";
import {
  RuntimeStatusPanel,
  SystemDiagnosticsDialog,
  useControlMode,
  useRuntimeStatus,
} from "@/features/runtime-status";
import {
  LegacyImportPanel,
  StartupPanel,
  useLegacyImport,
  useStartup,
} from "@/features/settings";
import "./App.css";

const NAV_ITEMS = [
  { id: "my-printers", label: "我的打印机", icon: Printer },
  { id: "share", label: "共享打印机", icon: Network },
  { id: "settings", label: "设置", icon: Settings2 },
] as const;

type PageId = (typeof NAV_ITEMS)[number]["id"];

const PAGE_CONTENT: Record<PageId, { title: string; description: string }> = {
  "my-printers": {
    title: "我的打印机",
    description: "你的应用通过 ShaPrint 可以使用的打印机。",
  },
  share: {
    title: "共享打印机",
    description: "选择本机要在网络上共享的打印机。",
  },
  settings: {
    title: "设置",
    description: "设置网络通道、启动行为与打印服务。",
  },
};

function App() {
  const [page, setPage] = useState<PageId>("my-printers");
  const [diagnosticsOpen, setDiagnosticsOpen] = useState(false);
  const [addPrinterOpen, setAddPrinterOpen] = useState(false);
  const [troubleshootingTarget, setTroubleshootingTarget] = useState<RecognisedClientQueue | null>(null);
  const [requestedTroubleshootingTarget, setRequestedTroubleshootingTarget] = useState<RecognisedClientQueue | null>(null);

  const controlMode = useControlMode();
  const runtime = useRuntimeStatus();
  const failures = usePrintFailures();
  const startup = useStartup();
  const legacy = useLegacyImport();
  const sharing = usePrinterSharing();
  const networkChannel = useNetworkChannel();
  const connections = useServerConnections();
  const trustedServers = useTrustedServers();
  const clientQueues = useRecognisedClientQueues();
  const nearby = useNearbyServers();
  const updates = useUpdates();
  const currentAppVersion = updates.status?.current_version || CLIENT_VERSION;
  const isNightlyBuild = isNightly(currentAppVersion);
  const pageContent = PAGE_CONTENT[page];

  const hasFailedService =
    runtime.status?.services.some((s) => s.state === "failed") || runtime.error !== null;
  const isTransitioning =
    runtime.status?.services.some((s) => s.state === "starting" || s.state === "stopping") ||
    runtime.busy !== null;
  const isUnreachable = runtime.unreachable;
  const clientProxyState = runtime.status?.services.find((s) => s.id === "client-proxy")?.state;
  const serverSharingState = runtime.status?.services.find((s) => s.id === "server-sharing")?.state;
  const hasRunningPath = clientProxyState === "running" || serverSharingState === "running";
  const statusLabel = isUnreachable
    ? controlMode === "machine"
      ? "机器守护进程不可用"
      : "运行时不可用"
    : hasFailedService
      ? "服务需要处理"
      : isTransitioning
        ? "服务切换中"
        : runtime.status === null
          ? "正在检查服务"
          : clientProxyState === "running" && serverSharingState === "running"
            ? "客户端与服务端就绪"
            : clientProxyState === "running"
              ? "客户端打印就绪"
              : serverSharingState === "running"
                ? "服务端共享已开启"
                : "打印通道已停止";
  const statusTone =
    isUnreachable || hasFailedService
      ? "problem"
      : isTransitioning || runtime.status === null
        ? "busy"
        : hasRunningPath
          ? "ready"
          : "idle";

  return (
    <div className="app-shell">
      <aside className="sidebar" aria-label="ShaPrint 导航">
        <div className="brand-lockup">
          <span className="brand-mark" aria-hidden="true">
            <Printer size={19} strokeWidth={2.2} />
          </span>
          <span className="brand-copy">
            <span className="flex items-center gap-1.5">
              <span className="brand-name">ShaPrint</span>
              {isNightlyBuild && (
                <Badge
                  variant="warning"
                  className="text-[9px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded border-amber-600/40 bg-amber-500/15 text-amber-900 dark:text-amber-200"
                >
                  Nightly
                </Badge>
              )}
            </span>
            <span className="brand-caption">
              {isNightlyBuild ? `Nightly 预览版 (v${currentAppVersion})` : "打印共享"}
            </span>
          </span>
        </div>

        <nav className="primary-nav" aria-label="主导航">
          <p className="nav-heading">工作区</p>
          {NAV_ITEMS.map(({ id, label, icon: Icon }) => (
            <Button
              key={id}
              type="button"
              variant="ghost"
              className={`nav-button ${page === id ? "nav-button-active" : ""}`}
              aria-current={page === id ? "page" : undefined}
              title={label}
              onClick={() => setPage(id)}
            >
              <Icon aria-hidden="true" size={18} strokeWidth={1.9} />
              <span className="nav-label">{label}</span>
            </Button>
          ))}
        </nav>

        <div className="sidebar-note">
          <span className="sidebar-note-rule" aria-hidden="true" />
          <p>从你常用的打印对话框直接打印。</p>
        </div>
      </aside>

      <main className="workspace">
        {isNightlyBuild && (
          <div
            className="nightly-top-bar flex items-center justify-between px-4 py-1.5 border-b text-xs font-medium bg-amber-500/10 border-amber-500/25 text-amber-950 dark:text-amber-200"
            role="status"
            aria-label="Nightly 预览版构建提示"
          >
            <div className="flex items-center gap-2">
              <FlaskConical size={14} className="text-amber-600 dark:text-amber-400 shrink-0" aria-hidden="true" />
              <span>
                <strong className="font-semibold">ShaPrint Nightly</strong> (v{currentAppVersion}) &bull; 实验性测试通道
              </span>
            </div>
            <span className="text-[11px] font-medium opacity-80 hidden sm:inline">预发布测试版</span>
          </div>
        )}
        <header className="workspace-header">
          <div className="page-heading">
            <h1>{pageContent.title}</h1>
            <p className="page-description">{pageContent.description}</p>
          </div>

          <div className="workspace-header-actions">
            <button
              type="button"
              onClick={() => setDiagnosticsOpen(true)}
              className="system-status-pill"
              data-tone={statusTone}
              title="打开服务诊断"
              aria-label={`${statusLabel}。打开服务诊断`}
            >
              <span className={`status-dot dot-${statusTone}`} aria-hidden="true" />
              <span className="status-label">{statusLabel}</span>
              <Wrench size={13} className="status-icon" aria-hidden="true" />
            </button>
          </div>
        </header>

        <div className="workspace-content">
          <UpdateNotice
            status={updates.status}
            error={updates.error}
            checking={updates.checking}
            onCheck={() => void updates.check()}
            onRestart={() => void updates.restart()}
          />
          <PrintFailuresPanel
            failures={failures}
            clientQueues={clientQueues.queues}
            onTroubleshoot={(target) => {
              if (troubleshootingTarget && troubleshootingTarget.queue_name !== target.queue_name) {
                setRequestedTroubleshootingTarget(target);
              } else if (!troubleshootingTarget) {
                setTroubleshootingTarget(target);
              }
            }}
          />

          <section className="page-stack" aria-label={pageContent.title}>
            {page === "my-printers" ? (
              <>
                <InstalledClientQueuesPanel
                  onTroubleshoot={(target) => {
                    if (troubleshootingTarget && troubleshootingTarget.queue_name !== target.queue_name) {
                      setRequestedTroubleshootingTarget(target);
                    } else if (!troubleshootingTarget) {
                      setTroubleshootingTarget(target);
                    }
                  }}
                  clientQueues={clientQueues}
                  onAddPrinter={() => setAddPrinterOpen(true)}
                  onReverifyServer={(serverAddress) => {
                    setAddPrinterOpen(true);
                    void connections.reviewAddress(serverAddress);
                  }}
                />
                <TrustedServersPanel
                  trusted={trustedServers}
                  onReviewServer={(serverAddress) => {
                    setAddPrinterOpen(true);
                    void connections.reviewAddress(serverAddress);
                  }}
                />
              </>
            ) : null}

            {page === "share" ? (
              <>
                {networkChannel.configured === false ? (
                  <div className="channel-reminder" role="status">
                    <ShieldAlert size={18} aria-hidden="true" />
                    <div>
                      <strong>设置网络通道后客户端才能打印。</strong>
                      <p>该共享密钥用于在你的 ShaPrint 设备之间授权打印任务。</p>
                    </div>
                    <Button type="button" variant="outline" onClick={() => setPage("settings")}>
                      去设置
                    </Button>
                  </div>
                ) : null}
                <PrinterSharingPanel
                  sharing={sharing}
                  runtime={runtime}
                  networkChannel={networkChannel}
                />
              </>
            ) : null}

            {page === "settings" ? (
              <>
                <NetworkChannelPanel settings={networkChannel} />
                <StartupPanel startup={startup} controlMode={controlMode} />
                <SoftwareUpdatesPanel updates={updates} controlMode={controlMode} />
                <RuntimeStatusPanel runtime={runtime} controlMode={controlMode} />
                <LegacyImportPanel legacy={legacy} />
              </>
            ) : null}
          </section>
        </div>

        <footer className="workspace-footer">
          文档保存在你的设备上。ShaPrint 永不显示或记录打印任务内容。
        </footer>
      </main>

      {/* Wizard and Diagnostics Dialogs */}
      <AddPrinterDialog
        open={addPrinterOpen}
        onOpenChange={(nextOpen) => {
          setAddPrinterOpen(nextOpen);
          if (!nextOpen) {
            void clientQueues.refresh();
            void trustedServers.reload();
          }
        }}
        nearby={nearby}
        connections={connections}
        networkChannel={networkChannel}
        onInstalled={() => {
          void clientQueues.refresh();
        }}
        onEnsureProxyRunning={() => {
          const proxy = runtime.status?.services.find((s) => s.id === "client-proxy");
          if (proxy && proxy.state !== "running") {
            void runtime.start("client-proxy");
          }
        }}
      />

      <SystemDiagnosticsDialog
        open={diagnosticsOpen}
        onOpenChange={setDiagnosticsOpen}
        runtime={runtime}
        controlMode={controlMode}
      />
      {troubleshootingTarget ? <LocalTroubleshootingDialog
        key={JSON.stringify(troubleshootingTarget)}
        target={troubleshootingTarget}
        onClose={() => { setTroubleshootingTarget(null); setRequestedTroubleshootingTarget(null); }}
        onReviewServer={(serverAddress) => {
          setTroubleshootingTarget(null);
          setRequestedTroubleshootingTarget(null);
          setAddPrinterOpen(true);
          void connections.reviewAddress(serverAddress);
        }}
        onConfigureNetworkChannel={() => {
          setTroubleshootingTarget(null);
          setRequestedTroubleshootingTarget(null);
          setPage("settings");
        }}
      /> : null}
      {requestedTroubleshootingTarget ? <div role="alertdialog" aria-label="切换故障排查打印机" className="dialog-backdrop fixed inset-0 z-50 flex items-center justify-center bg-black/55">
        <div className="rounded-md border bg-card p-6 text-card-foreground">
          <p>关闭当前故障排查会话后再检查 {requestedTroubleshootingTarget.queue_name}？</p>
          <Button variant="outline" onClick={() => setRequestedTroubleshootingTarget(null)}>保留当前会话</Button>
          <Button onClick={() => {
            setTroubleshootingTarget(requestedTroubleshootingTarget);
            setRequestedTroubleshootingTarget(null);
          }}>关闭并切换</Button>
        </div>
      </div> : null}
    </div>
  );
}

export default App;
