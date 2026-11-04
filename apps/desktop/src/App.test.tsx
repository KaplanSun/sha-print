import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { invoke } from "@tauri-apps/api/core";

import App from "./App";
vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));
import * as discovery from "./api/discovery";
import * as ipc from "./api/ipc";
import * as legacyApi from "./api/legacyImport";
import type { LegacyImportReport } from "./api/legacyImport";
import * as networkChannel from "./api/networkChannel";
import * as printFailures from "./api/printFailures";
import * as serverConnections from "./api/serverConnections";
import * as startupApi from "./api/startup";
import * as updatesApi from "./api/updates";
import { CLIENT_VERSION } from "./lib/version";
import type { UpdateStatus } from "./api/updates";
import type {
  LocalPrinters,
  NearbyServers,
  PrintFailure,
  RuntimeStatus,
  ServerIdentity,
} from "./api/types";

vi.mock("./api/updates", () => ({
  getUpdateStatus: vi.fn(),
  checkForUpdates: vi.fn(),
  applyUpdateAndRestart: vi.fn(),
  onUpdateStatus: vi.fn(),
}));

vi.mock("./api/ipc", () => ({
  RUNTIME_STATUS_EVENT: "runtime://status",
  getRuntimeStatus: vi.fn(),
  getDiagnostics: vi.fn(),
  startService: vi.fn(),
  stopService: vi.fn(),
  onRuntimeStatus: vi.fn(),
  listLocalPrinters: vi.fn(),
  setSharedPrinters: vi.fn(),
  listCustomMedia: vi.fn(),
  addCustomMedia: vi.fn(),
  removeCustomMedia: vi.fn(),
  getServerIdentity: vi.fn(),
  getControlMode: vi.fn(),
  shutdownDaemon: vi.fn(),
}));

vi.mock("./api/networkChannel", () => ({
  getNetworkChannelStatus: vi.fn(),
  configureNetworkChannel: vi.fn(),
}));

vi.mock("./api/serverConnections", () => ({
  inspectServerConnection: vi.fn(),
  approveServerConnection: vi.fn(),
  listServerConnectionPrinters: vi.fn(),
  listTrustedServers: vi.fn(),
  probeTrustedServer: vi.fn(),
  forgetTrustedServer: vi.fn(),
  installPrinterQueue: vi.fn(),
  repairPrinterQueue: vi.fn(),
  listRecognisedClientQueues: vi.fn(),
  openPrintersSettings: vi.fn(),
}));

vi.mock("./api/discovery", () => ({
  NEARBY_SERVERS_EVENT: "discovery://servers",
  listNearbyServers: vi.fn(),
  onNearbyServers: vi.fn(),
}));

vi.mock("./api/printFailures", () => ({
  PRINT_FAILURE_EVENT: "runtime://print-failure",
  getPrintFailures: vi.fn(),
  dismissPrintFailure: vi.fn(),
  onPrintFailure: vi.fn(),
}));

vi.mock("./api/startup", () => ({
  getStartupStatus: vi.fn(),
  setStartupEnabled: vi.fn(),
}));

vi.mock("./api/legacyImport", () => ({
  LEGACY_IMPORT_EVENT: "legacy://import",
  getLegacyImportReport: vi.fn(),
  importLegacySettings: vi.fn(),
  onLegacyImport: vi.fn(),
}));

const runtimeWith = (
  proxy: RuntimeStatus["services"][number]["state"],
  sharing: RuntimeStatus["services"][number]["state"],
): RuntimeStatus => ({
  services: [
    { id: "client-proxy", state: proxy, detail: proxy === "running" ? "running" : "" },
    { id: "server-sharing", state: sharing, detail: sharing === "running" ? "running" : "" },
  ],
});

const nearbyWith = (...names: string[]): NearbyServers => ({
  servers: names.map((name, index) => ({
    name,
    address: `192.0.2.${10 + index}:8631`,
    printers: ["Zebra"],
  })),
});

const IDENTITY: ServerIdentity = {
  fingerprint: "5F:3A:00:11:22:33:44:55:66:77:88:99:AA:BB:CC:DD:EE:FF:00:11:22:33:44:55:66:77:88:99:AA:BB:CC:DD",
  port: 48631,
};

const printersWith = (...shared: string[]): LocalPrinters => ({
  printers: ["HP LaserJet", "Zebra", "Canon"].map((name) => ({
    name,
    shared: shared.includes(name),
  })),
});

function serviceCard(container: HTMLElement, id: string): HTMLElement {
  const card = container.querySelector(`[data-service="${id}"]`);
  if (card === null) {
    throw new Error(`no card rendered for ${id}`);
  }
  return card as HTMLElement;
}

type WorkspacePage = "我的打印机" | "共享打印机" | "设置";

function navigateTo(page: WorkspacePage) {
  fireEvent.click(screen.getByRole("button", { name: page }));
}

function printerRow(container: HTMLElement, name: string): HTMLElement {
  const row = container.querySelector(`[data-printer="${name}"]`);
  if (row === null) {
    throw new Error(`no row rendered for ${name}`);
  }
  return row as HTMLElement;
}

/** Waits until the sharing panel has listed the queues. */
async function sharingPanel(container: HTMLElement): Promise<HTMLElement> {
  navigateTo("共享打印机");
  await waitFor(() => expect(printerRow(container, "HP LaserJet")).toBeTruthy());
  return screen.getByRole("region", { name: "本地打印机" });
}

// Testing Library only cleans up automatically when Vitest globals are turned on; this suite
// queries the whole document, so earlier renders must not stay behind.
afterEach(cleanup);

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(ipc.onRuntimeStatus).mockResolvedValue(() => {});
  vi.mocked(ipc.getControlMode).mockResolvedValue("local");
  vi.mocked(updatesApi.getUpdateStatus).mockResolvedValue({
    current_version: "3.1.1",
    update: { state: "idle" },
    waiting_for_jobs: false,
  });
  vi.mocked(updatesApi.onUpdateStatus).mockResolvedValue(() => {});
  vi.mocked(updatesApi.checkForUpdates).mockResolvedValue({
    current_version: "3.1.1",
    update: { state: "idle" },
    waiting_for_jobs: false,
  });
  vi.mocked(updatesApi.applyUpdateAndRestart).mockResolvedValue({
    current_version: "3.1.1",
    update: { state: "ready_to_restart", version: "3.2.0", restart_requested: true },
    waiting_for_jobs: false,
  });
  vi.mocked(ipc.getRuntimeStatus).mockResolvedValue(runtimeWith("running", "stopped"));
  vi.mocked(ipc.getDiagnostics).mockResolvedValue({
    checks: [],
    healthy: true,
    recent_failure: null,
  });
  vi.mocked(ipc.listLocalPrinters).mockResolvedValue(printersWith());
  vi.mocked(ipc.getServerIdentity).mockResolvedValue(IDENTITY);
  vi.mocked(ipc.listCustomMedia).mockResolvedValue({ media: [] });
  vi.mocked(ipc.addCustomMedia).mockResolvedValue({ media: [] });
  vi.mocked(ipc.removeCustomMedia).mockResolvedValue({ media: [] });
  vi.mocked(serverConnections.listRecognisedClientQueues).mockResolvedValue([]);
  vi.mocked(serverConnections.listTrustedServers).mockResolvedValue([]);
  vi.mocked(serverConnections.forgetTrustedServer).mockResolvedValue();
  vi.mocked(networkChannel.getNetworkChannelStatus).mockResolvedValue(false);
  vi.mocked(discovery.listNearbyServers).mockResolvedValue({ servers: [] });
  vi.mocked(discovery.onNearbyServers).mockResolvedValue(() => {});
  vi.mocked(printFailures.getPrintFailures).mockResolvedValue(null);
  vi.mocked(printFailures.onPrintFailure).mockResolvedValue(() => {});
  vi.mocked(startupApi.getStartupStatus).mockResolvedValue({
    supported: true,
    enabled: true,
    command: '"C:\\Program Files\\ShaPrint\\shaprint-desktop.exe" --background',
  });
  vi.mocked(legacyApi.getLegacyImportReport).mockResolvedValue({
    found: false,
    channel: "absent",
    channel_note:
      "The previous ShaPrint app had no Network Channel of its own. Set one here before clients can print.",
    settings: [],
    queues_need_reselection: false,
  });
  vi.mocked(legacyApi.onLegacyImport).mockResolvedValue(() => {});
});

it("opens passive troubleshooting for an installed Client queue without offering mutations", async () => {
  const target = {
    queue_name: "Office (ShaPrint 192.0.2.10-48631)",
    server_address: "192.0.2.10:48631", printer_name: "Office",
  };
  vi.mocked(serverConnections.listRecognisedClientQueues).mockResolvedValue([target]);
  vi.mocked(invoke).mockResolvedValue({
    target, version: "3.4.4", queue_empty: false, test_print_enabled: false,
    repair_enabled: false, attempted_actions: [],
    checks: [
      { check: "spooler", status: "passed", detail: "The native print spooler responded." },
      { check: "client-queue", status: "passed", detail: "The installed Client queue matches the selected Server and shared printer." },
      { check: "pending-jobs", status: "failed", detail: "Print jobs are pending. Wait for them to finish or inspect the native queue before testing or repairing." },
      { check: "client-proxy", status: "passed", detail: "The client proxy reports running." },
    ],
  });
  render(<App />);
  fireEvent.click(await screen.findByRole("button", { name: `对 ${target.queue_name} 进行故障排查` }));
  const dialog = await screen.findByRole("dialog", { name: "故障排查打印机" });
  expect(await within(dialog).findByText(/Print jobs are pending/)).toBeTruthy();
  expect(within(dialog).getByText(target.server_address)).toBeTruthy();
  expect(within(dialog).getByRole("button", { name: "再次检查" })).toBeTruthy();
  expect(within(dialog).queryByRole("button", { name: /test print|repair|start/i })).toBeNull();
  expect(vi.mocked(invoke).mock.calls.map(([command]) => command)).toEqual(["inspect_local_client_queue"]);
});

it("offers Start client proxy when proxy check failed and records outcome after refresh", async () => {
  const target = {
    queue_name: "Office (ShaPrint 192.0.2.10-48631)",
    server_address: "192.0.2.10:48631",
    printer_name: "Office",
  };
  vi.mocked(serverConnections.listRecognisedClientQueues).mockResolvedValue([target]);
  vi.mocked(invoke)
    .mockResolvedValueOnce({
      target,
      version: "3.4.4",
      queue_empty: true,
      test_print_enabled: false,
      repair_enabled: false,
      attempted_actions: [],
      checks: [
        { check: "spooler", status: "passed", detail: "The native print spooler responded." },
        { check: "client-queue", status: "passed", detail: "The installed Client queue matches the selected Server and shared printer." },
        { check: "pending-jobs", status: "passed", detail: "No print jobs are waiting in the local queue." },
        { check: "client-proxy", status: "failed", code: "proxy-stopped", detail: "The client proxy is stopped." },
      ],
    })
    .mockResolvedValueOnce({
      target,
      version: "3.4.4",
      queue_empty: true,
      test_print_enabled: false,
      repair_enabled: true,
      attempted_actions: [],
      checks: [
        { check: "spooler", status: "passed", detail: "The native print spooler responded." },
        { check: "client-queue", status: "passed", detail: "The installed Client queue matches the selected Server and shared printer." },
        { check: "pending-jobs", status: "passed", detail: "No print jobs are waiting in the local queue." },
        { check: "client-proxy", status: "passed", detail: "The client proxy reports running." },
      ],
    });
  vi.mocked(ipc.startService).mockResolvedValue({
    services: {
      "client-proxy": { state: "running", detail: "running", autostart: true },
    },
  } as any);

  render(<App />);
  fireEvent.click(await screen.findByRole("button", { name: `对 ${target.queue_name} 进行故障排查` }));
  const dialog = await screen.findByRole("dialog", { name: "故障排查打印机" });

  const startProxyBtn = await within(dialog).findByRole("button", { name: "启动客户端代理" });
  expect(startProxyBtn).toBeTruthy();

  fireEvent.click(startProxyBtn);

  expect(ipc.startService).toHaveBeenCalledWith("client-proxy");
  expect(await within(dialog).findByText("已尝试的恢复操作")).toBeTruthy();
  expect(within(dialog).getByText("启动客户端代理")).toBeTruthy();
  expect(within(dialog).getByText("成功")).toBeTruthy();
});

it("offers Repair Client queue when repair is eligible and records successful outcome", async () => {
  const target = {
    queue_name: "Office (ShaPrint 192.0.2.10-48631)",
    server_address: "192.0.2.10:48631",
    printer_name: "Office",
  };
  vi.mocked(serverConnections.listRecognisedClientQueues).mockResolvedValue([target]);
  vi.mocked(invoke)
    .mockResolvedValueOnce({
      target,
      version: "3.4.4",
      queue_empty: true,
      test_print_enabled: false,
      repair_enabled: true,
      attempted_actions: [],
      checks: [
        { check: "spooler", status: "passed", detail: "The native print spooler responded." },
        { check: "client-queue", status: "passed", detail: "The installed Client queue matches the selected Server and shared printer." },
        { check: "pending-jobs", status: "passed", detail: "No print jobs are waiting in the local queue." },
        { check: "client-proxy", status: "passed", detail: "The client proxy reports running." },
      ],
    })
    .mockResolvedValueOnce({
      target,
      version: "3.4.4",
      queue_empty: true,
      test_print_enabled: false,
      repair_enabled: true,
      attempted_actions: [],
      checks: [
        { check: "spooler", status: "passed", detail: "The native print spooler responded." },
        { check: "client-queue", status: "passed", detail: "The installed Client queue matches the selected Server and shared printer." },
        { check: "pending-jobs", status: "passed", detail: "No print jobs are waiting in the local queue." },
        { check: "client-proxy", status: "passed", detail: "The client proxy reports running." },
      ],
    });
  vi.mocked(serverConnections.repairPrinterQueue).mockResolvedValue({
    queue_name: target.queue_name,
    printer_name: target.printer_name,
    server_address: target.server_address,
  } as any);

  render(<App />);
  fireEvent.click(await screen.findByRole("button", { name: `对 ${target.queue_name} 进行故障排查` }));
  const dialog = await screen.findByRole("dialog", { name: "故障排查打印机" });

  const repairBtn = await within(dialog).findByRole("button", { name: "修复客户端队列" });
  fireEvent.click(repairBtn);

  expect(serverConnections.repairPrinterQueue).toHaveBeenCalledWith(target.server_address, target.printer_name);
  const attemptedList = await within(dialog).findByLabelText("已尝试的恢复操作");
  expect(within(attemptedList).getByText("修复客户端队列")).toBeTruthy();
  expect(within(attemptedList).getByText("成功")).toBeTruthy();
  expect(within(dialog).getByText(/已尝试的恢复操作并不代表物理打印已恢复/)).toBeTruthy();
});

it("records denied outcome when repair elevation prompt is dismissed or rejected", async () => {
  const target = {
    queue_name: "Office (ShaPrint 192.0.2.10-48631)",
    server_address: "192.0.2.10:48631",
    printer_name: "Office",
  };
  vi.mocked(serverConnections.listRecognisedClientQueues).mockResolvedValue([target]);
  vi.mocked(invoke)
    .mockResolvedValueOnce({
      target,
      version: "3.4.4",
      queue_empty: true,
      test_print_enabled: false,
      repair_enabled: true,
      attempted_actions: [],
      checks: [
        { check: "spooler", status: "passed", detail: "The native print spooler responded." },
        { check: "client-queue", status: "passed", detail: "The installed Client queue matches the selected Server and shared printer." },
        { check: "pending-jobs", status: "passed", detail: "No print jobs are waiting in the local queue." },
        { check: "client-proxy", status: "passed", detail: "The client proxy reports running." },
      ],
    })
    .mockResolvedValueOnce({
      target,
      version: "3.4.4",
      queue_empty: true,
      test_print_enabled: false,
      repair_enabled: true,
      attempted_actions: [],
      checks: [
        { check: "spooler", status: "passed", detail: "The native print spooler responded." },
        { check: "client-queue", status: "passed", detail: "The installed Client queue matches the selected Server and shared printer." },
        { check: "pending-jobs", status: "passed", detail: "No print jobs are waiting in the local queue." },
        { check: "client-proxy", status: "passed", detail: "The client proxy reports running." },
      ],
    });
  vi.mocked(serverConnections.repairPrinterQueue).mockRejectedValue({
    code: "not-authorized",
    message: "administrator permission was not granted to repair the Client queue",
  });

  render(<App />);
  fireEvent.click(await screen.findByRole("button", { name: `对 ${target.queue_name} 进行故障排查` }));
  const dialog = await screen.findByRole("dialog", { name: "故障排查打印机" });

  const repairBtn = await within(dialog).findByRole("button", { name: "修复客户端队列" });
  fireEvent.click(repairBtn);

  const attemptedList = await within(dialog).findByLabelText("已尝试的恢复操作");
  expect(within(attemptedList).getByText("修复客户端队列")).toBeTruthy();
  expect(within(attemptedList).getByText("授权被拒绝")).toBeTruthy();
});

it("records denied outcome when error is a primitive string indicating permission denied", async () => {
  const target = {
    queue_name: "Office (ShaPrint 192.0.2.10-48631)",
    server_address: "192.0.2.10:48631",
    printer_name: "Office",
  };
  vi.mocked(serverConnections.listRecognisedClientQueues).mockResolvedValue([target]);
  vi.mocked(invoke)
    .mockResolvedValueOnce({
      target,
      version: "3.4.4",
      queue_empty: true,
      test_print_enabled: false,
      repair_enabled: true,
      attempted_actions: [],
      checks: [
        { check: "spooler", status: "passed", detail: "The native print spooler responded." },
        { check: "client-queue", status: "passed", detail: "The installed Client queue matches the selected Server and shared printer." },
        { check: "pending-jobs", status: "passed", detail: "No print jobs are waiting in the local queue." },
        { check: "client-proxy", status: "passed", detail: "The client proxy reports running." },
      ],
    })
    .mockResolvedValueOnce({
      target,
      version: "3.4.4",
      queue_empty: true,
      test_print_enabled: false,
      repair_enabled: true,
      attempted_actions: [],
      checks: [
        { check: "spooler", status: "passed", detail: "The native print spooler responded." },
        { check: "client-queue", status: "passed", detail: "The installed Client queue matches the selected Server and shared printer." },
        { check: "pending-jobs", status: "passed", detail: "No print jobs are waiting in the local queue." },
        { check: "client-proxy", status: "passed", detail: "The client proxy reports running." },
      ],
    });
  vi.mocked(serverConnections.repairPrinterQueue).mockRejectedValue(
    "Authentication was dismissed"
  );

  render(<App />);
  fireEvent.click(await screen.findByRole("button", { name: `对 ${target.queue_name} 进行故障排查` }));
  const dialog = await screen.findByRole("dialog", { name: "故障排查打印机" });

  const repairBtn = await within(dialog).findByRole("button", { name: "修复客户端队列" });
  fireEvent.click(repairBtn);

  const attemptedList = await within(dialog).findByLabelText("已尝试的恢复操作");
  expect(within(attemptedList).getByText("修复客户端队列")).toBeTruthy();
  expect(within(attemptedList).getByText("授权被拒绝")).toBeTruthy();
});

it.each(["success", "failure"] as const)("finalizes inconclusive results at the UI deadline and ignores late %s", async (outcome) => {
  const target = { queue_name: "Office", server_address: "192.0.2.10:48631", printer_name: "Office" };
  vi.mocked(serverConnections.listRecognisedClientQueues).mockResolvedValue([target]);
  let finishLate: (value: unknown) => void = () => {};
  vi.mocked(invoke).mockImplementation(() => new Promise((resolve, reject) => {
    finishLate = (value) => outcome === "success" ? resolve(value) : reject(new Error("native-driver-detail"));
  }));
  render(<App />);
  const open = await screen.findByRole("button", { name: "对 Office 进行故障排查" });
  vi.useFakeTimers();
  try {
    fireEvent.click(open);
    await act(async () => { await vi.advanceTimersByTimeAsync(15_000); });
    const dialog = screen.getByRole("dialog", { name: "故障排查打印机" });
    expect(within(dialog).queryByText(/Checking the local print path/)).toBeNull();
    expect(within(dialog).getAllByText(/不确定/).length).toBe(9);
    expect(within(dialog).queryByRole("alert")).toBeNull();
    expect(within(dialog).getByText(/测试与修复均被阻止/)).toBeTruthy();
    await act(async () => { finishLate({
      target, version: "3.4.4", queue_empty: true, test_print_enabled: false,
      repair_enabled: false, attempted_actions: [],
      checks: [{ check: "pending-jobs", status: "passed", detail: "Too-late empty-queue evidence" }],
    }); });
    expect(within(dialog).queryByText("Too-late empty-queue evidence")).toBeNull();
    expect(within(dialog).getAllByText(/不确定/).length).toBe(9);
    expect(within(dialog).queryByRole("alert")).toBeNull();
  } finally { vi.useRealTimers(); }
});

it("keeps authoritative completed checks when pending-job inspection reaches its backend budget", async () => {
  const target = { queue_name: "Office", server_address: "192.0.2.10:48631", printer_name: "Office" };
  vi.mocked(serverConnections.listRecognisedClientQueues).mockResolvedValue([target]);
  vi.mocked(invoke).mockImplementation(() => new Promise((resolve) => {
    setTimeout(() => resolve({
      target, version: "3.4.4", queue_empty: false, test_print_enabled: false,
      repair_enabled: false, attempted_actions: [], checks: [
        { check: "spooler", status: "passed", detail: "Completed native spooler evidence" },
        { check: "client-queue", status: "passed", detail: "Completed destination evidence" },
        { check: "pending-jobs", status: "inconclusive", detail: "Pending work remains unknown" },
        { check: "client-proxy", status: "passed", detail: "Completed proxy evidence" },
      ],
    }), 14_000);
  }));
  render(<App />);
  const open = await screen.findByRole("button", { name: "对 Office 进行故障排查" });
  vi.useFakeTimers();
  try {
    fireEvent.click(open);
    await act(async () => { await vi.advanceTimersByTimeAsync(15_000); });
    const dialog = screen.getByRole("dialog", { name: "故障排查打印机" });
    expect(within(dialog).getByText("Completed native spooler evidence")).toBeTruthy();
    expect(within(dialog).getByText("Completed destination evidence")).toBeTruthy();
    expect(within(dialog).getByText("Pending work remains unknown")).toBeTruthy();
    expect(within(dialog).getAllByText(/不确定/).length).toBe(1);
  } finally { vi.useRealTimers(); }
});

it("discards closed-session results and requires a choice before switching Client queues", async () => {
  const office = { queue_name: "Office", server_address: "192.0.2.10:48631", printer_name: "Office" };
  const label = { queue_name: "Labels", server_address: "192.0.2.11:48631", printer_name: "Labels" };
  const result = (target: typeof office, detail: string) => ({
    target, version: "3.4.4", queue_empty: false, test_print_enabled: false,
    repair_enabled: false, attempted_actions: [],
    checks: [{ check: "pending-jobs", status: "inconclusive", detail }],
  });
  let finishOld: (value: ReturnType<typeof result>) => void = () => {};
  vi.mocked(serverConnections.listRecognisedClientQueues).mockResolvedValue([office, label]);
  vi.mocked(invoke).mockImplementationOnce(() => new Promise((resolve) => { finishOld = resolve; }))
    .mockResolvedValue(result(label, "Current queue evidence"));
  render(<App />);
  fireEvent.click(await screen.findByRole("button", { name: "对 Office 进行故障排查" }));
  fireEvent.click(screen.getByRole("button", { name: "对 Labels 进行故障排查" }));
  const switchDialog = screen.getByRole("alertdialog", { name: "切换故障排查打印机" });
  expect(screen.getByRole("dialog", { name: "故障排查打印机" }).textContent).toContain(office.server_address);
  fireEvent.click(within(switchDialog).getByRole("button", { name: "关闭并切换" }));
  expect(await screen.findByText("Current queue evidence")).toBeTruthy();
  await act(async () => { finishOld(result(office, "Stale evidence")); });
  expect(screen.queryByText("Stale evidence")).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "关闭故障排查" }));
  expect(screen.queryByRole("dialog", { name: "故障排查打印机" })).toBeNull();
});

it("reruns local checks and ignores results from a superseded run", async () => {
  const target = { queue_name: "Office", server_address: "192.0.2.10:48631", printer_name: "Office" };
  const snapshot = (detail: string) => ({
    target, version: "3.4.4", queue_empty: true, test_print_enabled: false,
    repair_enabled: false, attempted_actions: [],
    checks: [{ check: "pending-jobs", status: "passed", detail }],
  });
  let finishOld: (value: ReturnType<typeof snapshot>) => void = () => {};
  vi.mocked(serverConnections.listRecognisedClientQueues).mockResolvedValue([target]);
  vi.mocked(invoke).mockImplementationOnce(() => new Promise((resolve) => { finishOld = resolve; }))
    .mockResolvedValue(snapshot("Fresh queue evidence"));
  render(<App />);
  fireEvent.click(await screen.findByRole("button", { name: "对 Office 进行故障排查" }));
  fireEvent.click(screen.getByRole("button", { name: "再次检查" }));
  expect(await screen.findByText("Fresh queue evidence")).toBeTruthy();
  await act(async () => { finishOld(snapshot("Superseded evidence")); });
  expect(screen.queryByText("Superseded evidence")).toBeNull();
  expect(vi.mocked(invoke).mock.calls.map(([command]) => command)).toEqual([
    "inspect_local_client_queue", "inspect_local_client_queue",
  ]);
});

it("opens troubleshooting from a print failure card when target matches an installed queue", async () => {
  const target = { queue_name: "Office Queue", server_address: "192.0.2.10:48631", printer_name: "Office" };
  vi.mocked(serverConnections.listRecognisedClientQueues).mockResolvedValue([target]);
  vi.mocked(printFailures.getPrintFailures).mockResolvedValue({
    path: "client-forwarding",
    code: "server-unavailable",
    printer: "Office",
    message: "could not reach server",
    recovery: "Check server is running",
    observed_at_ms: Date.now(),
  });
  vi.mocked(invoke).mockResolvedValue({
    target, version: "3.4.4", queue_empty: true, test_print_enabled: false,
    repair_enabled: false, attempted_actions: [],
    checks: [
      { check: "spooler", status: "passed", detail: "Spooler ready" },
      { check: "server-reachability", status: "failed", code: "server-unavailable", detail: "Server offline" },
    ],
  });
  render(<App />);

  const troubleshootBtn = await screen.findByRole("button", { name: "故障排查打印机" });
  fireEvent.click(troubleshootBtn);

  const dialog = await screen.findByRole("dialog", { name: "故障排查打印机" });
  expect(within(dialog).getByText(target.queue_name)).toBeTruthy();
  expect(within(dialog).getByText("Server offline")).toBeTruthy();
  expect(vi.mocked(invoke)).toHaveBeenCalledWith("inspect_local_client_queue", { target });
});

it("does not offer troubleshooting from a failure card when target cannot be identified", async () => {
  const target = { queue_name: "Office Queue", server_address: "192.0.2.10:48631", printer_name: "Office" };
  vi.mocked(serverConnections.listRecognisedClientQueues).mockResolvedValue([target]);
  // Server-submission failure on another printer
  vi.mocked(printFailures.getPrintFailures).mockResolvedValue({
    path: "server-submission",
    code: "queue-unavailable",
    printer: "Warehouse",
    message: "could not submit to Windows queue",
    recovery: "Check printer power",
    observed_at_ms: Date.now(),
  });
  render(<App />);

  expect(await screen.findByText(/could not submit to Windows queue/)).toBeTruthy();
  expect(screen.queryByRole("button", { name: "故障排查打印机" })).toBeNull();
});

it("provides navigation to server identity review and network channel settings from classified checks", async () => {
  const target = { queue_name: "Office", server_address: "192.0.2.10:48631", printer_name: "Office" };
  vi.mocked(serverConnections.listRecognisedClientQueues).mockResolvedValue([target]);
  vi.mocked(invoke).mockResolvedValue({
    target, version: "3.4.4", queue_empty: true, test_print_enabled: false,
    repair_enabled: false, attempted_actions: [],
    checks: [
      { check: "server-reachability", status: "passed", detail: "Server responded over TLS" },
      { check: "server-identity", status: "failed", code: "server-identity-changed", detail: "Certificate changed" },
      { check: "shared-printer", status: "not-applicable", detail: "Cannot check unapproved server" },
      { check: "network-channel", status: "failed", code: "not-authorized", detail: "Channel rejected" },
      { check: "firewall", status: "not-applicable", detail: "Optional firewall inspection unavailable" },
    ],
  });
  render(<App />);

  fireEvent.click(await screen.findByRole("button", { name: "对 Office 进行故障排查" }));
  const dialog = await screen.findByRole("dialog", { name: "故障排查打印机" });

  expect(within(dialog).getByText(/Certificate changed/)).toBeTruthy();
  expect(within(dialog).getByText(/Channel rejected/)).toBeTruthy();

  // Test server review navigation
  const reviewBtn = within(dialog).getByRole("button", { name: "复核服务器身份" });
  fireEvent.click(reviewBtn);

  // Dialog closes and server review is opened
  expect(screen.queryByRole("dialog", { name: "故障排查打印机" })).toBeNull();
  expect(vi.mocked(serverConnections.inspectServerConnection)).toHaveBeenCalledWith(target.server_address);
});

it("navigates to network channel settings from troubleshooting dialog", async () => {
  const target = { queue_name: "Office", server_address: "192.0.2.10:48631", printer_name: "Office" };
  vi.mocked(serverConnections.listRecognisedClientQueues).mockResolvedValue([target]);
  vi.mocked(invoke).mockResolvedValue({
    target, version: "3.4.4", queue_empty: true, test_print_enabled: false,
    repair_enabled: false, attempted_actions: [],
    checks: [
      { check: "server-reachability", status: "passed", detail: "Server responded over TLS" },
      { check: "server-identity", status: "passed", detail: "Certificate matches" },
      { check: "shared-printer", status: "passed", detail: "Printer is shared" },
      { check: "network-channel", status: "failed", code: "not-authorized", detail: "Channel rejected" },
    ],
  });
  render(<App />);

  fireEvent.click(await screen.findByRole("button", { name: "对 Office 进行故障排查" }));
  const dialog = await screen.findByRole("dialog", { name: "故障排查打印机" });

  const channelBtn = within(dialog).getByRole("button", { name: "网络通道设置" });
  fireEvent.click(channelBtn);

  // Dialog closes and navigated to settings workspace
  expect(screen.queryByRole("dialog", { name: "故障排查打印机" })).toBeNull();
  expect(screen.getByRole("heading", { name: "设置" })).toBeTruthy();
});

/** A computer that had the previous .NET app installed. */
const LEGACY_REPORT: LegacyImportReport = {
  found: true,
  channel: "imported",
  channel_note: "Your Network Channel was imported from the previous ShaPrint app.",
  settings: [
    {
      key: "auto-update",
      label: "Automatic updates",
      reason: "This app does not update itself yet.",
    },
    {
      key: "client-queues",
      label: "Installed client printers",
      reason:
        "Printer queues are installed again from this app; the previous app's queues are not activated.",
    },
  ],
  queues_need_reselection: true,
};

const FAILURE: PrintFailure = {
  path: "server-submission",
  code: "queue-unavailable",
  message:
    "The job for 'Office Printer' could not be submitted to the Windows printer queue.",
  recovery:
    "Check that the printer is switched on and reachable from this computer, then print again.",
  observed_at_ms: Date.UTC(2026, 0, 2, 3, 4, 5),
};

describe("updater", () => {
  it("shows a ready update banner and queues restart while jobs drain", async () => {
    let publish: ((status: UpdateStatus) => void) | undefined;
    vi.mocked(updatesApi.onUpdateStatus).mockImplementation(async (handler) => {
      publish = handler;
      return () => {};
    });
    render(<App />);
    await waitFor(() => expect(publish).toBeDefined());

    publish?.({
      current_version: "3.1.1",
      update: { state: "ready_to_restart", version: "3.2.0", restart_requested: false },
      waiting_for_jobs: true,
    });

    expect(await screen.findByText("ShaPrint 3.2.0 已就绪")).toBeTruthy();
    expect(screen.getByText(/你的重启已排队.*打印与假脱机清理完成后重启/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "重启已排队" }));
    await waitFor(() => expect(updatesApi.applyUpdateAndRestart).toHaveBeenCalledTimes(1));
  });

  it("reports manual update-check failures in plain language", async () => {
    vi.mocked(updatesApi.checkForUpdates).mockRejectedValue({
      message: "GitHub Releases could not be reached. Check your internet connection and try again.",
    });
    render(<App />);
    navigateTo("设置");

    fireEvent.click(screen.getByRole("button", { name: "检查更新" }));

    const alerts = await screen.findAllByRole("alert");
    expect(alerts.some((el) => el.textContent?.includes("GitHub Releases could not be reached"))).toBe(true);
  });

  it("clears a previous update error when a later status event succeeds", async () => {
    let publish: ((status: UpdateStatus) => void) | undefined;
    vi.mocked(updatesApi.onUpdateStatus).mockImplementation(async (handler) => {
      publish = handler;
      return () => {};
    });
    render(<App />);
    await waitFor(() => expect(publish).toBeDefined());

    await act(async () => publish?.({
      current_version: "3.1.1",
      update: { state: "failed", message: "Check failed." },
      waiting_for_jobs: false,
    }));
    expect((await screen.findByRole("alert")).textContent).toBe("Check failed.");

    await act(async () => publish?.({
      current_version: "3.1.1",
      update: { state: "idle" },
      waiting_for_jobs: false,
    }));
    await waitFor(() => expect(screen.queryByRole("alert")).toBeNull());
  });

  it("displays prominent nightly badges and top bar when running on a nightly build", async () => {
    vi.mocked(updatesApi.getUpdateStatus).mockResolvedValue({
      current_version: "3.4.0-nightly.1",
      update: { state: "idle" },
      waiting_for_jobs: false,
    });
    render(<App />);

    // Top banner and sidebar indicator
    expect(await screen.findByText(/ShaPrint Nightly/i)).toBeTruthy();
    expect(screen.getByText("预发布测试版")).toBeTruthy();
    expect(screen.getByText("Nightly")).toBeTruthy();

    // Settings page software updates panel
    navigateTo("设置");
    expect((await screen.findAllByText("预发布测试版")).length).toBeGreaterThanOrEqual(2);
    expect(screen.getByText("已启用预发布测试版通道")).toBeTruthy();
  });

  it("omits nightly branding and displays stable indicator when on a stable build", async () => {
    vi.mocked(updatesApi.getUpdateStatus).mockResolvedValue({
      current_version: "3.4.0",
      update: { state: "idle" },
      waiting_for_jobs: false,
    });
    render(<App />);
    navigateTo("设置");
    expect(await screen.findByText("稳定版")).toBeTruthy();

    expect(screen.queryByText("预发布测试版")).toBeNull();
    expect(screen.queryByText("Nightly")).toBeNull();

    expect(screen.queryByText("已启用预发布测试版通道")).toBeNull();
  });
});

describe("workspace navigation", () => {
  it("starts on My printers and keeps Share printers and Settings in their own sections", async () => {
    render(<App />);

    expect(screen.getByRole("heading", { name: "我的打印机", level: 1 })).toBeTruthy();
    expect(screen.getByRole("button", { name: "我的打印机" }).getAttribute("aria-current")).toBe("page");
    expect(screen.queryByRole("region", { name: "本地打印机" })).toBeNull();

    navigateTo("共享打印机");
    expect(await screen.findByRole("heading", { name: "共享打印机", level: 1 })).toBeTruthy();
    expect(await screen.findByRole("region", { name: "本地打印机" })).toBeTruthy();

    navigateTo("设置");
    expect(await screen.findByRole("heading", { name: "设置", level: 1 })).toBeTruthy();
    expect(await screen.findByRole("region", { name: "打印授权" })).toBeTruthy();
    expect(await screen.findByRole("region", { name: "软件更新" })).toBeTruthy();
    expect(await screen.findByRole("region", { name: "启动" })).toBeTruthy();
    expect(await screen.findByRole("region", { name: "打印服务" })).toBeTruthy();
    expect(await screen.findByRole("region", { name: "以前的 ShaPrint 应用" })).toBeTruthy();
  });

  it("navigates from status pill or problem condition directly to service diagnostics dialog", async () => {
    vi.mocked(ipc.getRuntimeStatus).mockResolvedValue(runtimeWith("failed", "stopped"));
    render(<App />);

    const statusPill = await screen.findByRole("button", {
      name: /服务需要处理。打开服务诊断/,
    });
    expect(statusPill).toBeTruthy();
    fireEvent.click(statusPill);

    // Diagnostics dialog opens with detailed technical service controls
    const dialog = await screen.findByRole("dialog", { name: "打印服务状态" });
    expect(dialog).toBeTruthy();
    expect(within(dialog).getByRole("heading", { name: "客户端代理" })).toBeTruthy();
    expect(within(dialog).getByRole("heading", { name: "服务器共享" })).toBeTruthy();
  });
});

describe("workspace service status", () => {
  it("names the active client print path instead of implying every service is running", async () => {
    render(<App />);

    expect(
      await screen.findByRole("button", {
        name: "客户端打印就绪。打开服务诊断",
      }),
    ).toBeTruthy();
  });

  it("reports stopped print paths when neither service is running", async () => {
    vi.mocked(ipc.getRuntimeStatus).mockResolvedValue(runtimeWith("stopped", "stopped"));
    render(<App />);

    expect(
      await screen.findByRole("button", {
        name: "打印通道已停止。打开服务诊断",
      }),
    ).toBeTruthy();
  });
});

describe("guided printer setup", () => {
  it("renders recognised client queues from Windows and allows refresh and retry", async () => {
    vi.mocked(serverConnections.listRecognisedClientQueues).mockResolvedValueOnce([
      {
        queue_name: "Office Laser (ShaPrint 10.0.0.5-8631)",
        server_address: "10.0.0.5:8631",
        printer_name: "Office Laser",
      },
      {
        queue_name: "Office Laser (ShaPrint 192.168.1.50-8631)",
        server_address: "192.168.1.50:8631",
        printer_name: "Office Laser",
      },
    ]);

    render(<App />);

    // Both queues, including same printer name on different servers, are listed on default My printers screen
    await waitFor(() => {
      expect(
        screen.getByText("Office Laser (ShaPrint 10.0.0.5-8631)"),
      ).toBeTruthy();
      expect(
        screen.getByText("Office Laser (ShaPrint 192.168.1.50-8631)"),
      ).toBeTruthy();
    });

    // Refresh button fetches current state again
    vi.mocked(serverConnections.listRecognisedClientQueues).mockResolvedValueOnce([]);
    fireEvent.click(screen.getByRole("button", { name: "刷新已安装队列" }));

    await waitFor(() => {
      expect(
        screen.getByText(
          "Windows 中尚未安装任何 ShaPrint 客户端队列。",
        ),
      ).toBeTruthy();
    });

    // Error and retry state
    vi.mocked(serverConnections.listRecognisedClientQueues).mockRejectedValueOnce(
      new Error("Spooler service unavailable"),
    );
    fireEvent.click(screen.getByRole("button", { name: "刷新已安装队列" }));

    await waitFor(() => {
      expect(
        screen.getByText("Spooler service unavailable"),
      ).toBeTruthy();
      expect(screen.getByRole("button", { name: "重试" })).toBeTruthy();
    });
  });

  it("opens Windows settings or explains manual steps without offering in-app delete button", async () => {
    vi.mocked(serverConnections.listRecognisedClientQueues).mockResolvedValue([
      {
        queue_name: "Office Laser (ShaPrint 10.0.0.5-8631)",
        server_address: "10.0.0.5:8631",
        printer_name: "Office Laser",
      },
    ]);
    vi.mocked(serverConnections.openPrintersSettings).mockResolvedValue();

    render(<App />);

    expect(
      await screen.findByText("Office Laser (ShaPrint 10.0.0.5-8631)"),
    ).toBeTruthy();

    // No in-app delete button
    expect(screen.queryByRole("button", { name: /delete/i })).toBeNull();
    expect(screen.queryByRole("button", { name: /remove/i })).toBeNull();
    expect(screen.queryByRole("button", { name: /uninstall/i })).toBeNull();

    // Manage in Windows action calls desktop shell
    const manageButtons = screen.getAllByRole("button", { name: /在 Windows 中管理/ });
    expect(manageButtons.length).toBeGreaterThan(0);
    fireEvent.click(manageButtons[0]);

    await waitFor(() => {
      expect(serverConnections.openPrintersSettings).toHaveBeenCalled();
    });

    // When opening settings fails, explains manual navigation and provides queue name copy
    vi.mocked(serverConnections.openPrintersSettings).mockRejectedValueOnce(
      new Error("Shell execution failed"),
    );
    fireEvent.click(manageButtons[0]);

    expect(
      await screen.findByText(/无法自动打开 Windows 设置/),
    ).toBeTruthy();
    expect(
      screen.getByText(/Windows 设置 > 蓝牙和其他设备 > 打印机和扫描仪/),
    ).toBeTruthy();

    // Queue name copy button is available
    const copyBtn = screen.getByRole("button", {
      name: "复制队列名称 Office Laser (ShaPrint 10.0.0.5-8631)",
    });
    expect(copyBtn).toBeTruthy();
  });

  it("confirms and repairs an installed queue before refreshing its paper sizes", async () => {
    const queue = {
      queue_name: "Office Laser (ShaPrint 10.0.0.5-8631)",
      server_address: "10.0.0.5:8631",
      printer_name: "Office Laser",
    };
    vi.mocked(serverConnections.listRecognisedClientQueues).mockResolvedValue([queue]);
    vi.mocked(serverConnections.inspectServerConnection).mockResolvedValue({
      address: queue.server_address,
      current_fingerprint: "AA",
      previous_fingerprint: "AA",
      trusted: true,
    });
    vi.mocked(serverConnections.repairPrinterQueue).mockResolvedValue({
      ...queue,
      uri: "ipp://127.0.0.1:48632/ipp/print/server/printer",
    });

    render(<App />);

    const repair = await screen.findByRole("button", {
      name: `修复 ${queue.queue_name} 的纸张尺寸`,
    });
    fireEvent.click(repair);

    const dialog = screen.getByRole("dialog", { name: "修复纸张尺寸？" });
    expect(within(dialog).getByText(/可能重置该打印机的本地打印偏好/)).toBeTruthy();
    expect(serverConnections.repairPrinterQueue).not.toHaveBeenCalled();

    fireEvent.click(within(dialog).getByRole("button", { name: "修复队列" }));

    await waitFor(() => {
      expect(serverConnections.repairPrinterQueue).toHaveBeenCalledWith(
        queue.server_address,
        queue.printer_name,
      );
    });
    expect(
      await screen.findByText(`已修复 ${queue.queue_name}。Windows 已重新加载其纸张尺寸。`),
    ).toBeTruthy();
    expect(serverConnections.listRecognisedClientQueues).toHaveBeenCalledTimes(2);
  });

  it("shows evidence-based Reverify identity action when an installed queue's server identity has changed", async () => {
    vi.mocked(serverConnections.listRecognisedClientQueues).mockResolvedValue([
      {
        queue_name: "Office Laser (ShaPrint 10.0.0.5-8631)",
        server_address: "10.0.0.5:8631",
        printer_name: "Office Laser",
      },
    ]);
    vi.mocked(serverConnections.inspectServerConnection).mockResolvedValue({
      address: "10.0.0.5:8631",
      current_fingerprint: "AA:BB:CC:DD:EE:FF:00:11:22:33:44:55:66:77:88:99:AA:BB:CC:DD:EE:FF:00:11:22:33:44:55:66:77:88:99",
      previous_fingerprint: "11:22:33:44:55:66:77:88:99:AA:BB:CC:DD:EE:FF:00:11:22:33:44:55:66:77:88:99:AA:BB:CC:DD:EE:FF",
      trusted: false,
    });

    render(<App />);

    // Queue remains listed with targeted evidence warning
    expect(
      await screen.findByText("Office Laser (ShaPrint 10.0.0.5-8631)"),
    ).toBeTruthy();
    expect(
      await screen.findByText("服务器身份已变更。在重新验证前，打印已被阻止。"),
    ).toBeTruthy();

    // Does not display speculative Online or Offline badges
    expect(screen.queryByText(/^Online$/i)).toBeNull();
    expect(screen.queryByText(/^Offline$/i)).toBeNull();

    // Reverify identity button opens the guided trust verification flow
    const reverifyBtn = screen.getByRole("button", {
      name: "重新验证 10.0.0.5:8631 的身份",
    });
    expect(reverifyBtn).toBeTruthy();
    expect(
      (
        screen.getByRole("button", {
          name: "修复 Office Laser (ShaPrint 10.0.0.5-8631) 的纸张尺寸",
        }) as HTMLButtonElement
      ).disabled,
    ).toBe(true);
    fireEvent.click(reverifyBtn);

    // Guided setup dialog opens directly to fingerprint verification step
    expect(await screen.findByRole("dialog", { name: "检查服务器身份" })).toBeTruthy();
  });

  it("offers a single guided Add printer entry in My printers workspace without duplicate inline controls", async () => {
    render(<App />);

    // The single guided entry action is available right on the default My printers screen
    expect(screen.getByRole("button", { name: "添加打印机" })).toBeTruthy();

    // The duplicate inline inspection and install path is no longer present
    expect(screen.queryByLabelText("Server address")).toBeNull();
    expect(screen.queryByRole("heading", { name: "按地址添加" })).toBeNull();
    expect(screen.queryByRole("button", { name: "检查证书" })).toBeNull();
  });

  it("keeps trusted servers visible with live status, refresh, printers, and forget actions", async () => {
    const onlineAddress = "print-east.example:48631";
    const offlineAddress = "print-west.example:48631";
    const changedAddress = "print-old.example:48631";
    const forgottenAddress = "print-retired.example:48631";
    const changedFingerprint =
      "AA:BB:CC:DD:EE:FF:00:11:22:33:44:55:66:77:88:99:AA:BB:CC:DD:EE:FF:00:11:22:33:44:55:66:77";
    vi.mocked(serverConnections.listTrustedServers).mockResolvedValue([
      { address: onlineAddress, fingerprint: IDENTITY.fingerprint },
      { address: offlineAddress, fingerprint: IDENTITY.fingerprint },
      { address: changedAddress, fingerprint: IDENTITY.fingerprint },
      { address: forgottenAddress, fingerprint: IDENTITY.fingerprint },
    ]);
    let offlineProbes = 0;
    vi.mocked(serverConnections.probeTrustedServer).mockImplementation(async (address) => {
      if (address === onlineAddress) {
        return {
          address,
          status: "online",
          approved_fingerprint: IDENTITY.fingerprint,
          current_fingerprint: IDENTITY.fingerprint,
          printers: ["Zebra"],
        };
      }
      if (address === offlineAddress) {
        offlineProbes += 1;
        if (offlineProbes > 1) {
          return {
            address,
            status: "online",
            approved_fingerprint: IDENTITY.fingerprint,
            current_fingerprint: IDENTITY.fingerprint,
            printers: ["Receipt printer"],
          };
        }
      }
      if (address === changedAddress) {
        return {
          address,
          status: "identity_changed",
          approved_fingerprint: IDENTITY.fingerprint,
          current_fingerprint: changedFingerprint,
          printers: [],
        };
      }
      return {
        address,
        status: "offline",
        approved_fingerprint: IDENTITY.fingerprint,
        current_fingerprint: null,
        printers: [],
      };
    });

    render(<App />);

    expect(await screen.findByText(onlineAddress)).toBeTruthy();
    expect(screen.getByText(offlineAddress)).toBeTruthy();
    expect(screen.getByText(changedAddress)).toBeTruthy();
    expect(screen.getByText(forgottenAddress)).toBeTruthy();
    expect(screen.getByText("在线")).toBeTruthy();
    expect(screen.getAllByText("离线").length).toBe(2);
    expect(screen.getByText("身份已变更")).toBeTruthy();
    expect(screen.getByText(/共享打印机：Zebra/)).toBeTruthy();
    expect(screen.getByText(changedFingerprint)).toBeTruthy();
    expect(
      screen.getByRole("button", { name: `复核共享打印机：${onlineAddress}` }),
    ).toBeTruthy();
    await waitFor(() => expect(serverConnections.probeTrustedServer).toHaveBeenCalledTimes(4));

    fireEvent.click(screen.getByRole("button", { name: `刷新 ${offlineAddress} 的状态` }));
    await waitFor(() => expect(serverConnections.probeTrustedServer).toHaveBeenCalledTimes(5));
    expect(serverConnections.probeTrustedServer).toHaveBeenLastCalledWith(offlineAddress);
    expect(await screen.findByText(/共享打印机：Receipt printer/)).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: `忘记 ${forgottenAddress}` }));
    await waitFor(() => {
      expect(serverConnections.forgetTrustedServer).toHaveBeenCalledWith(forgottenAddress);
      expect(screen.queryByText(forgottenAddress)).toBeNull();
    });
    expect(screen.getByText(offlineAddress)).toBeTruthy();
    expect(screen.getByText(onlineAddress)).toBeTruthy();
  });

  it("labels advertised printer names as unverified before approval in nearby panel and guided dialog", async () => {
    vi.mocked(discovery.listNearbyServers).mockResolvedValue({
      servers: [
        {
          name: "DESKTOP-ABC",
          address: "192.0.2.10:8631",
          printers: ["Zebra", "Receipt"],
          version: "3.1.3",
        },
      ],
    });

    render(<App />);

    // Open guided setup from My printers
    fireEvent.click(screen.getByRole("button", { name: "添加打印机" }));
    const dialog = await screen.findByRole("dialog", { name: "查找服务器" });
    expect(within(dialog).getByText(/广播（未验证）：Zebra, Receipt/)).toBeTruthy();
  });

  it("completes guided add printer flow from nearby server with observable IPC ordering", async () => {
    vi.mocked(networkChannel.getNetworkChannelStatus).mockResolvedValue(true);
    vi.mocked(discovery.listNearbyServers).mockResolvedValue({
      servers: [
        {
          name: "DESKTOP-ABC",
          address: "192.0.2.10:8631",
          printers: ["Office Laser"],
          version: "3.1.3",
        },
      ],
    });
    const review = {
      address: "192.0.2.10:8631",
      current_fingerprint: IDENTITY.fingerprint,
      previous_fingerprint: null,
      trusted: false,
    };
    vi.mocked(serverConnections.inspectServerConnection).mockResolvedValue(review);
    vi.mocked(serverConnections.approveServerConnection).mockResolvedValue({
      ...review,
      trusted: true,
    });
    vi.mocked(serverConnections.listServerConnectionPrinters).mockResolvedValue({
      address: review.address,
      printers: ["Office Laser"],
    });
    vi.mocked(serverConnections.installPrinterQueue).mockResolvedValue({
      queue_name: "Office Laser (ShaPrint 192.0.2.10-8631)",
      server_address: review.address,
      printer_name: "Office Laser",
      uri: "ipp://127.0.0.1:8632/ipp/print/192.0.2.10%3A8631/Office%20Laser",
    });

    render(<App />);

    // Click Add printer from My printers workspace
    fireEvent.click(screen.getByRole("button", { name: "添加打印机" }));

    // Select nearby server from wizard
    const dialog = await screen.findByRole("dialog", { name: "查找服务器" });
    const serverOption = within(dialog).getByText("DESKTOP-ABC").closest(".wizard-server-option") as HTMLElement;
    fireEvent.click(within(serverOption).getByRole("button", { name: "复核身份" }));

    // Opens dialog, inspects certificate, reaches verification step
    expect(await screen.findByRole("dialog", { name: "检查服务器身份" })).toBeTruthy();
    expect(serverConnections.inspectServerConnection).toHaveBeenCalledWith("192.0.2.10:8631");
    // Authoritative shared-printer queries are blocked until server identity is approved
    expect(serverConnections.listServerConnectionPrinters).not.toHaveBeenCalled();

    // Approve fingerprint
    fireEvent.click(screen.getByRole("button", { name: "批准指纹" }));

    // Now queries printers and advances to printers step
    await waitFor(() => {
      expect(serverConnections.approveServerConnection).toHaveBeenCalledWith(
        review.address,
        review.current_fingerprint,
      );
      expect(serverConnections.listServerConnectionPrinters).toHaveBeenCalledWith(review.address);
    });

    expect(await screen.findByText("Office Laser")).toBeTruthy();

    // Install printer
    fireEvent.click(screen.getByRole("button", { name: "安装" }));

    await waitFor(() => {
      expect(serverConnections.installPrinterQueue).toHaveBeenCalledWith(
        review.address,
        "Office Laser",
      );
    });

    // Success screen names the Windows queue and explains printing via ordinary Windows print dialog
    expect(await screen.findByRole("heading", { name: "打印机已安装" })).toBeTruthy();
    expect(screen.getByText("Office Laser (ShaPrint 192.0.2.10-8631)")).toBeTruthy();
    expect(screen.getByText(/你可以在任何 Windows 打印对话框中选择此打印机/)).toBeTruthy();

    // Verifies listRecognisedClientQueues was automatically refreshed upon installation
    expect(serverConnections.listRecognisedClientQueues).toHaveBeenCalled();

    // When the user clicks Done and closes the dialog, the newly installed queue is visible in My printers
    vi.mocked(serverConnections.listRecognisedClientQueues).mockResolvedValue([
      {
        queue_name: "Office Laser (ShaPrint 192.0.2.10-8631)",
        server_address: review.address,
        printer_name: "Office Laser",
      },
    ]);
    fireEvent.click(screen.getByRole("button", { name: "完成" }));

    expect(await screen.findByText("Office Laser (ShaPrint 192.0.2.10-8631)")).toBeTruthy();
  });

  it("skips repeat approval when server identity matches saved approval (trusted repeat run)", async () => {
    const review = {
      address: "192.0.2.10:8631",
      current_fingerprint: IDENTITY.fingerprint,
      previous_fingerprint: null,
      trusted: true,
    };
    vi.mocked(serverConnections.inspectServerConnection).mockResolvedValue(review);
    vi.mocked(serverConnections.listServerConnectionPrinters).mockResolvedValue({
      address: review.address,
      printers: ["Office Laser"],
    });

    render(<App />);
    fireEvent.click(screen.getByRole("button", { name: "添加打印机" }));

    const dialog = await screen.findByRole("dialog", { name: "查找服务器" });
    fireEvent.change(within(dialog).getByLabelText("或输入服务器地址"), {
      target: { value: "192.0.2.10:8631" },
    });
    fireEvent.click(within(dialog).getByRole("button", { name: "复核身份" }));

    // Automatically jumps to printers step and queries printers without asking for approval
    expect(await screen.findByRole("heading", { name: "选择打印机" })).toBeTruthy();
    expect(serverConnections.approveServerConnection).not.toHaveBeenCalled();
    expect(serverConnections.listServerConnectionPrinters).toHaveBeenCalledWith(review.address);
    expect(await screen.findByText("Office Laser")).toBeTruthy();
  });

  it("blocks printer queries and requires explicit reapproval when server identity has changed", async () => {
    const review = {
      address: "192.0.2.10:8631",
      current_fingerprint:
        "AA:BB:CC:DD:EE:FF:00:11:22:33:44:55:66:77:88:99:AA:BB:CC:DD:EE:FF:00:11:22:33:44:55:66:77",
      previous_fingerprint: IDENTITY.fingerprint,
      trusted: false,
    };
    vi.mocked(serverConnections.inspectServerConnection).mockResolvedValue(review);
    vi.mocked(serverConnections.approveServerConnection).mockResolvedValue({
      ...review,
      trusted: true,
    });
    vi.mocked(serverConnections.listServerConnectionPrinters).mockResolvedValue({
      address: review.address,
      printers: ["Office Laser"],
    });

    render(<App />);
    fireEvent.click(screen.getByRole("button", { name: "添加打印机" }));

    const dialog = await screen.findByRole("dialog", { name: "查找服务器" });
    fireEvent.change(within(dialog).getByLabelText("或输入服务器地址"), {
      target: { value: "192.0.2.10:8631" },
    });
    fireEvent.click(within(dialog).getByRole("button", { name: "复核身份" }));

    // Shows changed warning
    expect(await screen.findByText("服务器身份已变更。")).toBeTruthy();
    const reapproveBtn = screen.getByRole("button", { name: "重新批准指纹" });
    expect(reapproveBtn).toBeTruthy();

    // Authoritative printer query is blocked before reapproval
    expect(serverConnections.listServerConnectionPrinters).not.toHaveBeenCalled();

    // User explicitly reapproves
    fireEvent.click(reapproveBtn);

    await waitFor(() => {
      expect(serverConnections.approveServerConnection).toHaveBeenCalledWith(
        review.address,
        review.current_fingerprint,
      );
      expect(serverConnections.listServerConnectionPrinters).toHaveBeenCalledWith(review.address);
    });
    expect(await screen.findByText("Office Laser")).toBeTruthy();
  });

  it("reflects conditional Network Channel step in wizard progress and requires channel before install", async () => {
    // When channel is not configured
    vi.mocked(networkChannel.getNetworkChannelStatus).mockResolvedValue(false);
    const review = {
      address: "192.0.2.10:8631",
      current_fingerprint: IDENTITY.fingerprint,
      previous_fingerprint: null,
      trusted: true,
    };
    vi.mocked(serverConnections.inspectServerConnection).mockResolvedValue(review);
    vi.mocked(serverConnections.listServerConnectionPrinters).mockResolvedValue({
      address: review.address,
      printers: ["Office Laser"],
    });
    vi.mocked(networkChannel.configureNetworkChannel).mockResolvedValue(true);
    vi.mocked(serverConnections.installPrinterQueue).mockResolvedValue({
      queue_name: "Office Laser (ShaPrint 192.0.2.10-8631)",
      server_address: review.address,
      printer_name: "Office Laser",
      uri: "ipp://127.0.0.1:8632/ipp/print/192.0.2.10%3A8631/Office%20Laser",
    });

    render(<App />);
    fireEvent.click(screen.getByRole("button", { name: "添加打印机" }));

    const dialog = await screen.findByRole("dialog", { name: "查找服务器" });

    // Step list includes Network Channel when not configured
    const stepList = within(dialog).getByRole("list", { name: "打印机设置步骤" });
    expect(within(stepList).getByText("网络通道")).toBeTruthy();

    // Proceed to printers
    fireEvent.change(within(dialog).getByLabelText("或输入服务器地址"), {
      target: { value: "192.0.2.10:8631" },
    });
    fireEvent.click(within(dialog).getByRole("button", { name: "复核身份" }));

    expect(await screen.findByRole("heading", { name: "选择打印机" })).toBeTruthy();
    expect(await screen.findByText("Office Laser")).toBeTruthy();

    // Click install -> prompts for Network Channel
    fireEvent.click(screen.getByRole("button", { name: "安装" }));

    expect(await screen.findByRole("heading", { name: "设置网络通道" })).toBeTruthy();
    expect(within(stepList).getByText("网络通道").closest("li")?.getAttribute("aria-current")).toBe("step");

    // Enter channel and submit
    fireEvent.change(screen.getByLabelText("网络通道"), {
      target: { value: "secret-channel" },
    });
    fireEvent.click(screen.getByRole("button", { name: "保存网络通道并安装" }));

    await waitFor(() => {
      expect(networkChannel.configureNetworkChannel).toHaveBeenCalledWith("secret-channel");
      expect(serverConnections.installPrinterQueue).toHaveBeenCalledWith(
        review.address,
        "Office Laser",
      );
    });

    expect(await screen.findByRole("heading", { name: "打印机已安装" })).toBeTruthy();
  });

  it("resets selection, progress, and error state when reopening the journey after success, cancellation, or failure", async () => {
    vi.mocked(networkChannel.getNetworkChannelStatus).mockResolvedValue(true);
    const review = {
      address: "192.0.2.10:8631",
      current_fingerprint: IDENTITY.fingerprint,
      previous_fingerprint: null,
      trusted: true,
    };
    vi.mocked(serverConnections.inspectServerConnection).mockResolvedValue(review);
    vi.mocked(serverConnections.listServerConnectionPrinters).mockResolvedValue({
      address: review.address,
      printers: ["Office Laser"],
    });
    vi.mocked(serverConnections.installPrinterQueue).mockResolvedValue({
      queue_name: "Office Laser (ShaPrint 192.0.2.10-8631)",
      server_address: review.address,
      printer_name: "Office Laser",
      uri: "ipp://127.0.0.1:8632/ipp/print/192.0.2.10%3A8631/Office%20Laser",
    });

    render(<App />);
    fireEvent.click(screen.getByRole("button", { name: "添加打印机" }));

    let dialog = await screen.findByRole("dialog", { name: "查找服务器" });
    fireEvent.change(within(dialog).getByLabelText("或输入服务器地址"), {
      target: { value: "192.0.2.10:8631" },
    });
    fireEvent.click(within(dialog).getByRole("button", { name: "复核身份" }));

    expect(await screen.findByRole("heading", { name: "选择打印机" })).toBeTruthy();
    expect(await screen.findByText("Office Laser")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "安装" }));
    expect(await screen.findByRole("heading", { name: "打印机已安装" })).toBeTruthy();

    // Click Done to close
    fireEvent.click(screen.getByRole("button", { name: "完成" }));

    // Reopen Add printer
    fireEvent.click(screen.getByRole("button", { name: "添加打印机" }));

    dialog = await screen.findByRole("dialog", { name: "查找服务器" });
    // Starts fresh at step 1 with empty input and no stale installed queue
    expect(within(dialog).getByRole("heading", { name: "查找服务器" })).toBeTruthy();
    expect((within(dialog).getByLabelText("或输入服务器地址") as HTMLInputElement).value).toBe("");
    expect(screen.queryByText("Office Laser (ShaPrint 192.0.2.10-8631)")).toBeNull();
  });

  it("supports keyboard navigation and narrow desktop window layout in guided setup", async () => {
    // Simulate narrow window
    window.innerWidth = 480;

    render(<App />);
    fireEvent.click(screen.getByRole("button", { name: "添加打印机" }));

    const dialog = await screen.findByRole("dialog", { name: "查找服务器" });
    expect(dialog).toBeTruthy();

    // Dialog has proper accessible attributes
    expect(dialog.getAttribute("aria-labelledby")).toBe("add-printer-title");
    expect(dialog.getAttribute("aria-describedby")).toBe("add-printer-description");

    // Close with Escape key
    fireEvent.keyDown(dialog, { key: "Escape" });
    await waitFor(() => {
      expect(screen.queryByRole("dialog")).toBeNull();
    });

    // Reset window width
    window.innerWidth = 1024;
  });
});

describe("runtime status panel", () => {
  it("shows the live state of the proxy and sharing services", async () => {
    const { container } = render(<App />);
    navigateTo("设置");

    await waitFor(() => expect(container.querySelector('[data-service="client-proxy"]')).not.toBeNull());

    expect(serviceCard(container, "client-proxy").dataset.state).toBe("running");
    expect(serviceCard(container, "server-sharing").dataset.state).toBe("stopped");
    expect(screen.getByText("客户端代理")).toBeTruthy();
    expect(screen.getByText("服务器共享")).toBeTruthy();
  });

  it("follows status events published by the shell", async () => {
    let publish: ((status: RuntimeStatus) => void) | undefined;
    vi.mocked(ipc.onRuntimeStatus).mockImplementation(async (handler) => {
      publish = handler;
      return () => {};
    });
    const { container } = render(<App />);
    navigateTo("设置");

    await waitFor(() => expect(publish).toBeDefined());
    publish?.(runtimeWith("failed", "running"));

    await waitFor(() => expect(serviceCard(container, "client-proxy").dataset.state).toBe("failed"));
    expect(serviceCard(container, "server-sharing").dataset.state).toBe("running");

    // A failed service can be retried; a running one can only be stopped.
    const failed = serviceCard(container, "client-proxy");
    expect(within(failed).getByRole("button", { name: "启动" }).hasAttribute("disabled")).toBe(false);
    expect(within(failed).getByRole("button", { name: "停止" }).hasAttribute("disabled")).toBe(true);
    const running = serviceCard(container, "server-sharing");
    expect(within(running).getByRole("button", { name: "启动" }).hasAttribute("disabled")).toBe(true);
    expect(within(running).getByRole("button", { name: "停止" }).hasAttribute("disabled")).toBe(false);
  });

  it("renders the status returned by a service action", async () => {
    vi.mocked(ipc.startService).mockResolvedValue(runtimeWith("running", "running"));
    const { container } = render(<App />);
    navigateTo("设置");

    await waitFor(() => expect(container.querySelector('[data-service="server-sharing"]')).not.toBeNull());
    const sharing = serviceCard(container, "server-sharing");
    fireEvent.click(within(sharing).getByRole("button", { name: "启动" }));

    await waitFor(() => expect(sharing.dataset.state).toBe("running"));
    expect(ipc.startService).toHaveBeenCalledWith("server-sharing");
  });

  it("explains denied Client access and offers Start again", async () => {
    vi.mocked(ipc.startService)
      .mockRejectedValueOnce({ code: "unsupported", message: "Clients cannot connect through the Windows firewall: administrator permission was not granted. Approve the Windows prompt, then try again." })
      .mockResolvedValueOnce(runtimeWith("running", "running"));
    const { container } = render(<App />);
    navigateTo("设置");
    const server = await screen.findByRole("region", { name: "打印服务" });
    const sharing = serviceCard(container, "server-sharing");

    fireEvent.click(within(sharing).getByRole("button", { name: "启动" }));
    const alert = await within(server).findByRole("alert");
    expect(alert.textContent).toContain("Clients cannot connect");
    expect(sharing.dataset.state).toBe("stopped");

    fireEvent.click(within(sharing).getByRole("button", { name: "启动" }));
    await waitFor(() => expect(sharing.dataset.state).toBe("running"));
    expect(ipc.startService).toHaveBeenCalledTimes(2);
    expect(within(server).queryByRole("alert")).toBeNull();
  });

  it("shows the stable error code when a lifecycle action is rejected", async () => {
    vi.mocked(ipc.getRuntimeStatus).mockResolvedValue(runtimeWith("stopped", "stopped"));
    vi.mocked(ipc.startService).mockRejectedValue({
      code: "invalid-state",
      message: "select at least one printer to share before starting",
    });
    const { container } = render(<App />);
    navigateTo("设置");

    await waitFor(() => expect(container.querySelector('[data-service="client-proxy"]')).not.toBeNull());
    const proxy = serviceCard(container, "client-proxy");
    fireEvent.click(within(proxy).getByRole("button", { name: "启动" }));

    const panel = screen.getByRole("region", { name: "打印服务" });
    const alert = await within(panel).findByRole("alert");
    expect(alert.textContent).toContain("invalid-state");
    expect(alert.textContent).toContain("select at least one printer to share before starting");
    // The panel re-reads the status after a rejection so it cannot show a stale state.
    await waitFor(() => expect(ipc.getRuntimeStatus).toHaveBeenCalledTimes(2));
  });

  it("explains when the shell runtime cannot be reached", async () => {
    vi.mocked(ipc.getRuntimeStatus).mockRejectedValue(new Error("ipc unavailable"));
    vi.mocked(ipc.listLocalPrinters).mockRejectedValue(new Error("ipc unavailable"));
    vi.mocked(ipc.getServerIdentity).mockRejectedValue(new Error("ipc unavailable"));
    render(<App />);
    navigateTo("设置");

    const hint = await screen.findByText(/此窗口无法连接到 ShaPrint 运行时/);
    expect(hint).toBeTruthy();
  });

  it("names the recovery action while a print path is not doing its job", async () => {
    let publish: ((status: RuntimeStatus) => void) | undefined;
    vi.mocked(ipc.onRuntimeStatus).mockImplementation(async (handler) => {
      publish = handler;
      return () => {};
    });
    const { container } = render(<App />);
    navigateTo("设置");

    await waitFor(() => expect(publish).toBeDefined());

    // The client proxy is the always-on print path: while it is stopped, its card says what to
    // start. Server sharing is off by default, so a stopped sharing service is not reported.
    publish?.(runtimeWith("stopped", "stopped"));
    await waitFor(() =>
      expect(serviceCard(container, "client-proxy").textContent).toContain("打印受影响"),
    );
    expect(serviceCard(container, "client-proxy").textContent).toContain("启动客户端代理");
    expect(serviceCard(container, "server-sharing").textContent).not.toContain("打印受影响");

    // A failure is worth reporting wherever it happens.
    publish?.(runtimeWith("running", "failed"));
    await waitFor(() =>
      expect(serviceCard(container, "server-sharing").textContent).toContain("打印受影响"),
    );
    expect(serviceCard(container, "server-sharing").textContent).toContain("请使用“启动”重试");
    expect(serviceCard(container, "client-proxy").textContent).not.toContain("打印受影响");
  });
});

describe("print problems panel", () => {
  it("shows the stable code, the problem, and the next step", async () => {
    vi.mocked(printFailures.getPrintFailures).mockResolvedValue(FAILURE);
    render(<App />);

    const panel = await screen.findByRole("region", { name: "打印问题" });
    expect(await within(panel).findByText(FAILURE.message)).toBeTruthy();
    expect(within(panel).getByText("queue-unavailable")).toBeTruthy();
    expect(within(panel).getByText(FAILURE.recovery)).toBeTruthy();
    expect(within(panel).getByText("将任务提交到打印机队列")).toBeTruthy();
  });

  it("follows the failures the shell publishes", async () => {
    let publish: ((failure: PrintFailure | null) => void) | undefined;
    vi.mocked(printFailures.onPrintFailure).mockImplementation(async (handler) => {
      publish = handler;
      return () => {};
    });
    render(<App />);

    const panel = await screen.findByRole("region", { name: "打印问题" });
    await waitFor(() => expect(publish).toBeDefined());
    publish?.({ ...FAILURE, path: "client-forwarding", code: "server-unavailable" });

    expect(await within(panel).findByText("server-unavailable")).toBeTruthy();
    expect(within(panel).getByText("将任务发送到服务器")).toBeTruthy();
  });

  it("does not claim the print path is clear when failures cannot be read", async () => {
    vi.mocked(printFailures.getPrintFailures).mockRejectedValue({
      code: "internal",
      message: "print failures unavailable",
    });
    render(<App />);

    const panel = await screen.findByRole("region", { name: "打印问题" });
    expect(await within(panel).findByRole("alert")).toBeTruthy();
    expect(within(panel).queryByText(/近期没有打印失败/i)).toBeNull();
  });

  it("dismisses a failure and returns to the calm state", async () => {
    vi.mocked(printFailures.getPrintFailures).mockResolvedValue(FAILURE);
    vi.mocked(printFailures.dismissPrintFailure).mockResolvedValue(null);
    render(<App />);

    const panel = await screen.findByRole("region", { name: "打印问题" });
    fireEvent.click(within(panel).getByRole("button", { name: "忽略" }));

    await waitFor(() => expect(printFailures.dismissPrintFailure).toHaveBeenCalledTimes(1));
    expect(await within(panel).findByText(/近期没有打印失败/i)).toBeTruthy();
    expect(within(panel).queryByText(FAILURE.message)).toBeNull();
  });

  it("says nothing is wrong before a job fails", async () => {
    render(<App />);

    const panel = await screen.findByRole("region", { name: "打印问题" });
    expect(within(panel).getByText(/近期没有打印失败/i)).toBeTruthy();
    expect(within(panel).queryByRole("button", { name: "忽略" })).toBeNull();
  });
});

describe("shared printers panel", () => {
  it("lists the local queues and shows which of them are shared", async () => {
    vi.mocked(ipc.listLocalPrinters).mockResolvedValue(printersWith("HP LaserJet", "Canon"));
    const { container } = render(<App />);

    await sharingPanel(container);

    expect(printerRow(container, "HP LaserJet").dataset.shared).toBe("true");
    expect(printerRow(container, "Zebra").dataset.shared).toBe("false");
    expect(printerRow(container, "Canon").dataset.shared).toBe("true");
    expect(within(printerRow(container, "Zebra")).getByText("未共享")).toBeTruthy();
    expect(screen.getByText(/2 \/ 3 已共享/)).toBeTruthy();
  });

  it("explains when a printer search has no matches", async () => {
    vi.mocked(ipc.listLocalPrinters).mockResolvedValue({
      printers: Array.from({ length: 6 }, (_, index) => ({
        name: `Office printer ${index + 1}`,
        shared: false,
      })),
    });
    render(<App />);
    navigateTo("共享打印机");

    const panel = await screen.findByRole("region", { name: "本地打印机" });
    fireEvent.change(within(panel).getByRole("textbox", { name: "搜索打印机" }), {
      target: { value: "plotter" },
    });

    expect(await within(panel).findByText("没有与“plotter”匹配的打印机。")).toBeTruthy();
  });

  it("shares the queues the user selects", async () => {
    vi.mocked(ipc.setSharedPrinters).mockResolvedValue(printersWith("Zebra"));
    const { container } = render(<App />);

    await sharingPanel(container);
    fireEvent.click(within(printerRow(container, "Zebra")).getByRole("checkbox"));

    expect(ipc.setSharedPrinters).toHaveBeenCalledWith(["Zebra"]);
    await waitFor(() => expect(printerRow(container, "Zebra").dataset.shared).toBe("true"));
    expect(printerRow(container, "HP LaserJet").dataset.shared).toBe("false");
  });

  it("lists and adds custom paper sizes in the sharing panel", async () => {
    vi.mocked(ipc.listCustomMedia).mockResolvedValue({
      media: [{ label: "Receipt 80x120", widthTenthsMm: 800, heightTenthsMm: 1200 }],
    });
    vi.mocked(ipc.addCustomMedia).mockResolvedValue({
      media: [
        { label: "Receipt 80x120", widthTenthsMm: 800, heightTenthsMm: 1200 },
        { label: "Label 100x150", widthTenthsMm: 1000, heightTenthsMm: 1500 },
      ],
    });
    const { container } = render(<App />);

    await sharingPanel(container);
    const panel = screen.getByRole("region", { name: "本地打印机" });

    const heading = await within(panel).findByRole("heading", {
      name: "自定义纸张尺寸",
    });
    expect(heading).toBeTruthy();
    expect(within(panel).getByText("Receipt 80x120")).toBeTruthy();
    expect(within(panel).getByText(/80 × 120 mm/)).toBeTruthy();

    fireEvent.change(
      within(panel).getByLabelText("自定义纸张尺寸名称"),
      { target: { value: "Label 100x150" } },
    );
    fireEvent.change(
      within(panel).getByLabelText("自定义纸张尺寸宽度（毫米）"),
      { target: { value: "100" } },
    );
    fireEvent.change(
      within(panel).getByLabelText("自定义纸张尺寸高度（毫米）"),
      { target: { value: "150" } },
    );
    fireEvent.click(within(panel).getByRole("button", { name: "添加" }));

    await waitFor(() => {
      expect(ipc.addCustomMedia).toHaveBeenCalledWith({
        label: "Label 100x150",
        widthTenthsMm: 1000,
        heightTenthsMm: 1500,
      });
    });
    expect(await within(panel).findByText("Label 100x150")).toBeTruthy();
  });

  it("shows the certificate fingerprint a client has to approve", async () => {
    render(<App />);
    navigateTo("共享打印机");

    const fingerprint = await screen.findByTestId("server-fingerprint");
    expect(fingerprint.textContent).toBe(IDENTITY.fingerprint);
    expect(screen.getByText("端口 48631")).toBeTruthy();
    expect(screen.getByText(/客户端在查看共享打印机前会核验此指纹/)).toBeTruthy();
  });

  it("copies the server fingerprint only after the user asks", async () => {
    const originalClipboard = Object.getOwnPropertyDescriptor(navigator, "clipboard");
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText },
    });

    try {
      render(<App />);
      navigateTo("共享打印机");
      await screen.findByTestId("server-fingerprint");
      fireEvent.click(screen.getByRole("button", { name: "复制" }));

      expect(await screen.findByText("指纹已复制。")).toBeTruthy();
      expect(writeText).toHaveBeenCalledWith(IDENTITY.fingerprint);
    } finally {
      if (originalClipboard) {
        Object.defineProperty(navigator, "clipboard", originalClipboard);
      } else {
        Reflect.deleteProperty(navigator, "clipboard");
      }
    }
  });

  it("starts Server Sharing without a separate firewall action", async () => {
    vi.mocked(ipc.startService).mockResolvedValue(runtimeWith("running", "running"));
    const { container } = render(<App />);
    await sharingPanel(container);

    expect(screen.queryByRole("button", { name: "Allow client connections" })).toBeNull();
    navigateTo("设置");
    const server = serviceCard(container, "server-sharing");
    fireEvent.click(within(server).getByRole("button", { name: "启动" }));

    await waitFor(() => expect(server.dataset.state).toBe("running"));
    expect(ipc.startService).toHaveBeenCalledWith("server-sharing");
  });

  it("starts and stops sharing from user intent in Share printers workspace", async () => {
    vi.mocked(networkChannel.getNetworkChannelStatus).mockResolvedValue(true);
    vi.mocked(ipc.listLocalPrinters).mockResolvedValue(printersWith("HP LaserJet"));
    vi.mocked(ipc.startService).mockResolvedValue(runtimeWith("running", "running"));
    vi.mocked(ipc.stopService).mockResolvedValue(runtimeWith("running", "stopped"));

    render(<App />);
    navigateTo("共享打印机");

    // Local queues already has a shared printer (HP LaserJet)
    const startBtn = await screen.findByRole("button", { name: "开始共享" });
    expect(startBtn).toBeTruthy();
    fireEvent.click(startBtn);

    await waitFor(() => {
      expect(ipc.startService).toHaveBeenCalledWith("server-sharing");
    });

    // When running, shows Stop sharing
    const stopBtn = await screen.findByRole("button", { name: "停止共享" });
    expect(stopBtn).toBeTruthy();
    fireEvent.click(stopBtn);

    await waitFor(() => {
      expect(ipc.stopService).toHaveBeenCalledWith("server-sharing");
    });
  });

  it("prompts for Network Channel when starting sharing without a configured channel", async () => {
    vi.mocked(networkChannel.getNetworkChannelStatus).mockResolvedValue(false);
    vi.mocked(ipc.listLocalPrinters).mockResolvedValue(printersWith("HP LaserJet"));
    vi.mocked(networkChannel.configureNetworkChannel).mockResolvedValue(true);
    vi.mocked(ipc.startService).mockResolvedValue(runtimeWith("running", "running"));

    render(<App />);
    navigateTo("共享打印机");

    const startBtn = await screen.findByRole("button", { name: "开始共享" });
    fireEvent.click(startBtn);

    // Shows contextual prompt
    expect(
      await screen.findByRole("region", { name: "共享前设置网络通道" }),
    ).toBeTruthy();

    // Cancel prompt leaves sharing off and preserves selection
    fireEvent.click(screen.getByRole("button", { name: "取消" }));
    expect(
      screen.queryByRole("region", { name: "共享前设置网络通道" }),
    ).toBeNull();
    expect(ipc.startService).not.toHaveBeenCalled();

    // Entering secret saves and starts sharing
    fireEvent.click(screen.getByRole("button", { name: "开始共享" }));
    fireEvent.change(screen.getByLabelText("网络通道密钥"), {
      target: { value: "secret123" },
    });
    fireEvent.click(screen.getByRole("button", { name: "保存并开始共享" }));

    await waitFor(() => {
      expect(networkChannel.configureNetworkChannel).toHaveBeenCalledWith("secret123");
      expect(ipc.startService).toHaveBeenCalledWith("server-sharing");
    });
  });

  it("shows the stable error code when a change is rejected and re-reads the queues", async () => {
    vi.mocked(ipc.setSharedPrinters).mockRejectedValue({
      code: "invalid-input",
      message: "'Ghost' is not a local printer queue",
    });
    const { container } = render(<App />);

    await sharingPanel(container);
    fireEvent.click(within(printerRow(container, "Zebra")).getByRole("checkbox"));

    const panel = screen.getByRole("region", { name: "本地打印机" });
    const alert = await within(panel).findByRole("alert");
    expect(alert.textContent).toContain("invalid-input");
    expect(alert.textContent).toContain("'Ghost' is not a local printer queue");
    // A rejected change re-reads the queues, so the checkbox cannot show a state the server is not
    // in.
    await waitFor(() => expect(ipc.listLocalPrinters).toHaveBeenCalledTimes(2));
    expect(printerRow(container, "Zebra").dataset.shared).toBe("false");
  });

  it("explains when this platform cannot list printer queues", async () => {
    vi.mocked(ipc.listLocalPrinters).mockRejectedValue({
      code: "unsupported",
      message: "listing local printer queues is only supported on Windows",
    });
    render(<App />);
    navigateTo("共享打印机");

    const panel = await screen.findByRole("region", { name: "本地打印机" });
    const alert = await within(panel).findByRole("alert");
    expect(alert.textContent).toContain("unsupported");
    expect(alert.textContent).toContain("only supported on Windows");
  });
});
describe("Network Channel panel", () => {
  it("gives the visibility button a field-specific name and keyboard focus", async () => {
    render(<App />);
    navigateTo("设置");

    const panel = await screen.findByRole("region", { name: "打印授权" });
    const input = within(panel).getByLabelText("网络通道") as HTMLInputElement;
    const showButton = within(panel).getByRole("button", { name: "显示 网络通道" });

    expect(input.type).toBe("password");
    expect(showButton.tabIndex).toBe(0);
    fireEvent.click(showButton);
    expect(input.type).toBe("text");
    expect(within(panel).getByRole("button", { name: "隐藏 网络通道" })).toBeTruthy();
  });

  it("saves a server channel without displaying the secret again", async () => {
    vi.mocked(networkChannel.configureNetworkChannel).mockResolvedValue(true);
    render(<App />);
    navigateTo("设置");

    const input = screen.getByLabelText("网络通道") as HTMLInputElement;
    const value = `network-${Date.now()}-${Math.random()}`;
    fireEvent.change(input, { target: { value } });
    fireEvent.click(screen.getByRole("button", { name: "保存网络通道" }));

    expect(await screen.findByText(/网络通道已更新/)).toBeTruthy();
    expect(networkChannel.configureNetworkChannel).toHaveBeenCalledWith(value);
    expect(input.value).toBe("");
    expect(screen.queryByText(value)).toBeNull();
  });
});

describe("nearby servers panel", () => {
  it("lists a server that advertises itself and reviews it without typing an address", async () => {
    vi.mocked(discovery.listNearbyServers).mockResolvedValue(nearbyWith("DESKTOP-ABC"));
    vi.mocked(serverConnections.inspectServerConnection).mockResolvedValue({
      address: "192.0.2.10:8631",
      current_fingerprint:
        "11:22:33:44:55:66:77:88:99:AA:BB:CC:DD:EE:FF:00:11:22:33:44:55:66:77:88:99:AA:BB:CC:DD:EE:FF",
      previous_fingerprint: null,
      trusted: false,
    });
    render(<App />);

    fireEvent.click(screen.getByRole("button", { name: "添加打印机" }));

    const dialog = await screen.findByRole("dialog", { name: "查找服务器" });
    expect(await within(dialog).findByText("DESKTOP-ABC")).toBeTruthy();
    expect(within(dialog).getByText("192.0.2.10:8631")).toBeTruthy();
    expect(within(dialog).getByText(/广播（未验证）：Zebra/)).toBeTruthy();

    const serverOption = within(dialog).getByText("DESKTOP-ABC").closest(".wizard-server-option") as HTMLElement;
    fireEvent.click(within(serverOption).getByRole("button", { name: "复核身份" }));

    // Reviewing a discovered server opens the guided setup dialog and inspects its certificate
    await waitFor(() =>
      expect(serverConnections.inspectServerConnection).toHaveBeenCalledWith("192.0.2.10:8631"),
    );
    expect(await screen.findByRole("dialog", { name: "检查服务器身份" })).toBeTruthy();
    expect(serverConnections.listServerConnectionPrinters).not.toHaveBeenCalled();
  });

  it("follows the servers the shell publishes", async () => {
    let publish: ((servers: NearbyServers) => void) | undefined;
    vi.mocked(discovery.onNearbyServers).mockImplementation(async (handler) => {
      publish = handler;
      return () => {};
    });
    render(<App />);

    fireEvent.click(screen.getByRole("button", { name: "添加打印机" }));

    const dialog = await screen.findByRole("dialog", { name: "查找服务器" });
    await waitFor(() => expect(publish).toBeDefined());
    publish?.(nearbyWith("DESKTOP-ZULU"));

    expect(await within(dialog).findByText("DESKTOP-ZULU")).toBeTruthy();
  });

  it("keeps working by address when discovery finds nothing", async () => {
    render(<App />);

    fireEvent.click(screen.getByRole("button", { name: "添加打印机" }));

    const dialog = await screen.findByRole("dialog", { name: "查找服务器" });
    expect(
      await within(dialog).findByText(/本网络上未发现服务器/),
    ).toBeTruthy();
    // Clicking Add printer allows manual address entry
    expect(within(dialog).getByLabelText("或输入服务器地址")).toBeTruthy();
  });

  it("exposes the advertised version and displays a non-blocking version drift badge when server is newer", async () => {
    vi.mocked(discovery.listNearbyServers).mockResolvedValue({
      servers: [
        {
          name: "DESKTOP-MATCH",
          address: "192.0.2.10:8631",
          printers: ["Zebra"],
          version: CLIENT_VERSION,
        },
        {
          name: "DESKTOP-NEWER",
          address: "192.0.2.11:8631",
          printers: ["Canon"],
          version: "4.0.0",
        },
        {
          name: "DESKTOP-LEGACY",
          address: "192.0.2.12:8631",
          printers: ["HP"],
          version: null,
        },
      ],
    });
    vi.mocked(serverConnections.inspectServerConnection).mockResolvedValue({
      address: "192.0.2.11:8631",
      current_fingerprint:
        "11:22:33:44:55:66:77:88:99:AA:BB:CC:DD:EE:FF:00:11:22:33:44:55:66:77:88:99:AA:BB:CC:DD:EE:FF",
      previous_fingerprint: null,
      trusted: false,
    });

    render(<App />);

    fireEvent.click(screen.getByRole("button", { name: "添加打印机" }));

    const dialog = await screen.findByRole("dialog", { name: "查找服务器" });

    // Matching version server displays version badge without drift badge
    expect(await within(dialog).findByText("DESKTOP-MATCH")).toBeTruthy();
    expect(within(dialog).getByText(`v${CLIENT_VERSION}`)).toBeTruthy();

    // Legacy server displays without version badge or drift badge
    expect(await within(dialog).findByText("DESKTOP-LEGACY")).toBeTruthy();

    // Newer server displays version badge AND version-drift advisory badge
    expect(await within(dialog).findByText("DESKTOP-NEWER")).toBeTruthy();
    expect(within(dialog).getByText("v4.0.0")).toBeTruthy();
    const driftBadge = within(dialog).getByText(/Newer server release/);
    expect(driftBadge).toBeTruthy();

    // Version drift does not block review identity action
    const newerServerItem = within(dialog).getByText("DESKTOP-NEWER").closest(".wizard-server-option") as HTMLElement;
    const reviewButton = within(newerServerItem).getByRole("button", { name: "复核身份" });
    expect((reviewButton as HTMLButtonElement).disabled).toBe(false);
    fireEvent.click(reviewButton);

    await waitFor(() =>
      expect(serverConnections.inspectServerConnection).toHaveBeenCalledWith("192.0.2.11:8631"),
    );
  });
});

describe("startup panel", () => {
  it("reports that ShaPrint starts with the user's login and how to quit it", async () => {
    render(<App />);
    navigateTo("设置");

    const panel = await screen.findByRole("region", { name: "启动" });
    const toggle = (await within(panel).findByLabelText(
      /我登录 Windows 时启动 ShaPrint/,
    )) as HTMLInputElement;
    expect(toggle.checked).toBe(true);
    expect(panel.textContent).toContain("shaprint-desktop.exe");
    expect(panel.textContent).toContain("退出 ShaPrint");
  });

  it("turns login startup off without asking for administrator permission", async () => {
    vi.mocked(startupApi.setStartupEnabled).mockResolvedValue({
      supported: true,
      enabled: false,
      command: '"C:\\Program Files\\ShaPrint\\shaprint-desktop.exe" --background',
    });
    render(<App />);
    navigateTo("设置");

    const panel = await screen.findByRole("region", { name: "启动" });
    const toggle = (await within(panel).findByLabelText(
      /我登录 Windows 时启动 ShaPrint/,
    )) as HTMLInputElement;
    fireEvent.click(toggle);

    await waitFor(() => expect(startupApi.setStartupEnabled).toHaveBeenCalledWith(false));
    await waitFor(() => expect(toggle.checked).toBe(false));
    // Enabling or disabling login startup never elevates.
  });

  it("says when this platform cannot register login startup", async () => {
    vi.mocked(startupApi.getStartupStatus).mockResolvedValue({
      supported: false,
      enabled: false,
      command: "",
    });
    render(<App />);
    navigateTo("设置");

    const panel = await screen.findByRole("region", { name: "启动" });
    expect(
      await within(panel).findByText(/在 Windows 上可用时，可在登录时启动 ShaPrint/),
    ).toBeTruthy();
    expect(
      within(panel).queryByLabelText(/我登录 Windows 时启动 ShaPrint/),
    ).toBeNull();
  });
});

describe("machine control mode", () => {
  it("offers stopping the machine daemon and keeps state when authorization is declined", async () => {
    vi.mocked(ipc.getControlMode).mockResolvedValue("machine");
    vi.mocked(ipc.shutdownDaemon).mockRejectedValue({
      code: "not-authorized",
      message:
        "Administrator authentication is required to stop the machine daemon (polkit action org.shaprint.control.stop); approve the authentication prompt and retry. No changes were made.",
    });
    render(<App />);

    fireEvent.click(
      await screen.findByRole("button", {
        name: "客户端打印就绪。打开服务诊断",
      }),
    );
    const dialog = await screen.findByRole("dialog", { name: "打印服务状态" });

    fireEvent.click(await within(dialog).findByRole("button", { name: "停止 ShaPrint 守护进程" }));

    const alert = await within(dialog).findByRole("alert");
    expect(alert.textContent).toContain("not-authorized");
    expect(alert.textContent).toContain("org.shaprint.control.stop");
    expect(alert.textContent).toContain("No changes were made.");
    expect(ipc.shutdownDaemon).toHaveBeenCalledTimes(1);
    // The declined prompt changed nothing: the Client proxy is still reported running.
    const proxy = within(dialog).getByRole("region", { name: "客户端代理" });
    expect(proxy.getAttribute("data-state")).toBe("running");
    expect(within(dialog).getByRole("button", { name: "停止 ShaPrint 守护进程" })).toBeTruthy();
  });

  it("explains an unreachable machine daemon with the command that starts it again", async () => {
    vi.mocked(ipc.getControlMode).mockResolvedValue("machine");
    vi.mocked(ipc.getRuntimeStatus).mockRejectedValue({
      code: "server-unavailable",
      message: "the machine control socket is not reachable",
    });
    render(<App />);

    fireEvent.click(
      await screen.findByRole("button", {
        name: /机器守护进程不可用。打开服务诊断/,
      }),
    );
    const dialog = await screen.findByRole("dialog", { name: "打印服务状态" });

    expect(within(dialog).getByText("机器守护进程不可用")).toBeTruthy();
    const recovery = await within(dialog).findAllByText(/sudo systemctl start shaprintd/);
    expect(recovery.length).toBeGreaterThan(0);
  });

  it("reports that the system service owns startup instead of a Windows login entry", async () => {
    vi.mocked(ipc.getControlMode).mockResolvedValue("machine");
    vi.mocked(startupApi.getStartupStatus).mockResolvedValue({
      supported: false,
      enabled: false,
      command: "",
    });
    render(<App />);
    navigateTo("设置");

    const panel = await screen.findByRole("region", { name: "启动" });
    expect(await within(panel).findByText(/ShaPrint 系统服务随本机启动/)).toBeTruthy();
    expect(await within(panel).findByText(/关闭窗口仅关闭图形界面/)).toBeTruthy();
    expect(within(panel).queryByText(/sign in to Windows/i)).toBeNull();
    expect(
      within(panel).queryByLabelText(/我登录 Windows 时启动 ShaPrint/),
    ).toBeNull();
  });

  it("points machine-mode updates at the package manager instead of the in-app updater", async () => {
    vi.mocked(ipc.getControlMode).mockResolvedValue("machine");
    render(<App />);
    navigateTo("设置");

    const panel = await screen.findByRole("region", { name: "软件更新" });
    const notes = await within(panel).findAllByText(/更新由你的软件包管理器安装/);
    expect(notes.length).toBeGreaterThan(0);
    expect((await within(panel).findAllByText(/sudo dnf upgrade shaprint/)).length).toBeGreaterThan(0);
    expect(within(panel).queryByRole("button", { name: "检查更新" })).toBeNull();
    expect(within(panel).queryByText(/Restart Now/i)).toBeNull();
  });

  it("keeps the in-app wording when the shell administers the local runtime", async () => {
    vi.mocked(ipc.getControlMode).mockResolvedValue("local");
    render(<App />);
    navigateTo("设置");

    const panel = await screen.findByRole("region", { name: "软件更新" });
    expect(within(panel).getByRole("button", { name: "检查更新" })).toBeTruthy();
    const startupPanel = await screen.findByRole("region", { name: "启动" });
    expect(startupPanel.textContent).toContain("我登录 Windows 时启动 ShaPrint");
  });
});

describe("previous app panel", () => {
  it("reports the Network Channel it took and asks for the printers again", async () => {
    vi.mocked(legacyApi.getLegacyImportReport).mockResolvedValue(LEGACY_REPORT);
    render(<App />);
    navigateTo("设置");

    const panel = await screen.findByRole("region", { name: "以前的 ShaPrint 应用" });
    expect(await within(panel).findByText(LEGACY_REPORT.channel_note)).toBeTruthy();
    expect(within(panel).getByText(/网络通道：已导入/)).toBeTruthy();
    // The previous app's queues are never activated: the user selects them again here.
    expect(within(panel).getByTestId("reselect-queues").textContent).toContain(
      "请重新选择你的打印机",
    );
    expect(within(panel).getByText("Automatic updates")).toBeTruthy();
    expect(within(panel).getByText(/does not update itself yet/)).toBeTruthy();
  });

  it("follows the import the shell finishes", async () => {
    let publish: ((report: LegacyImportReport) => void) | undefined;
    vi.mocked(legacyApi.onLegacyImport).mockImplementation(async (handler) => {
      publish = handler;
      return () => {};
    });
    render(<App />);
    navigateTo("设置");

    const panel = await screen.findByRole("region", { name: "以前的 ShaPrint 应用" });
    await waitFor(() => expect(publish).toBeDefined());
    publish?.(LEGACY_REPORT);

    expect(await within(panel).findByText(LEGACY_REPORT.channel_note)).toBeTruthy();
  });

  it("says nothing was found when there was no previous app", async () => {
    render(<App />);
    navigateTo("设置");

    const panel = await screen.findByRole("region", { name: "以前的 ShaPrint 应用" });
    expect(
      await within(panel).findByText(/在这台电脑上未找到旧版 ShaPrint 应用的设置/),
    ).toBeTruthy();
    expect(within(panel).queryByTestId("reselect-queues")).toBeNull();
    expect(within(panel).queryByRole("button", { name: "重新导入" })).toBeNull();
  });

  it("checks again without asking for administrator permission", async () => {
    vi.mocked(legacyApi.getLegacyImportReport).mockResolvedValue({
      ...LEGACY_REPORT,
      channel: "importable",
      channel_note: "The previous ShaPrint app's Network Channel is ready to be imported.",
    });
    vi.mocked(legacyApi.importLegacySettings).mockResolvedValue(LEGACY_REPORT);
    render(<App />);
    navigateTo("设置");

    const panel = await screen.findByRole("region", { name: "以前的 ShaPrint 应用" });
    fireEvent.click(await within(panel).findByRole("button", { name: "重新导入" }));

    await waitFor(() => expect(legacyApi.importLegacySettings).toHaveBeenCalledTimes(1));
    expect(await within(panel).findByText(LEGACY_REPORT.channel_note)).toBeTruthy();
  });
});

describe("system diagnostics and readiness", () => {
  it("keeps opening and refreshing diagnostics passive and shows uninspected firewall rules as not checked", async () => {
    vi.mocked(ipc.getDiagnostics).mockResolvedValue({
      checks: [{
        check: "firewall",
        status: "warning",
        code: "not-authorized",
        detail: "firewall rules were not inspected; administrator access is required",
        recovery: "Inspect firewall rules explicitly when needed.",
      }],
      healthy: false,
      recent_failure: null,
    });
    render(<App />);
    fireEvent.click(await screen.findByRole("button", {
      name: /客户端打印就绪。打开服务诊断/,
    }));
    const dialog = await screen.findByRole("dialog", { name: "打印服务状态" });
    expect(await within(dialog).findByText("未检查")).toBeTruthy();
    expect(within(dialog).queryByText("Failed")).toBeNull();
    for (const count of [2, 3]) {
      fireEvent.click(within(dialog).getByRole("button", { name: "全部刷新" }));
      await waitFor(() => expect(ipc.getDiagnostics).toHaveBeenCalledTimes(count));
    }
    expect(ipc.startService).not.toHaveBeenCalled();
    expect(ipc.stopService).not.toHaveBeenCalled();
    expect(networkChannel.configureNetworkChannel).not.toHaveBeenCalled();
    expect(serverConnections.approveServerConnection).not.toHaveBeenCalled();
    expect(serverConnections.installPrinterQueue).not.toHaveBeenCalled();
  });

  it("presents subsystem diagnostics with failure codes and concrete recovery actions matching CLI semantics", async () => {
    vi.mocked(ipc.getDiagnostics).mockResolvedValue({
      checks: [
        {
          check: "daemon",
          status: "failed",
          code: "server-unavailable",
          detail: "shaprintd is not running",
          recovery: "Start the system service: sudo systemctl start shaprintd",
        },
        {
          check: "ports",
          status: "failed",
          code: "invalid-state",
          detail: "port 48631 is occupied by conflicting process 'other-print' (PID 1234)",
          recovery: "Stop the conflicting process (PID 1234, 'other-print')",
        },
        {
          check: "cups",
          status: "failed",
          code: "queue-unavailable",
          detail: "cannot connect to the local CUPS service",
          recovery: "Start the CUPS service: sudo systemctl start cups",
        },
        {
          check: "credential",
          status: "failed",
          code: "not-authorized",
          detail: "machine Network Channel is not configured",
          recovery: "Configure the Network Channel: sudo shaprintctl network-channel set",
        },
        {
          check: "firewall",
          status: "failed",
          code: "not-authorized",
          detail: "inbound ports 48631/tcp and 48633/udp are blocked",
          recovery:
            "Open required ports: sudo firewall-cmd --permanent --add-port=48631/tcp --add-port=48633/udp && sudo firewall-cmd --reload",
        },
      ],
      healthy: false,
      recent_failure: null,
    });

    render(<App />);

    fireEvent.click(
      await screen.findByRole("button", {
        name: /客户端打印就绪。打开服务诊断/,
      }),
    );

    const dialog = await screen.findByRole("dialog", { name: "打印服务状态" });
    expect(dialog).toBeTruthy();

    // Subsystem checks are rendered
    expect(within(dialog).getByRole("heading", { name: "守护进程服务" })).toBeTruthy();
    expect(within(dialog).getByRole("heading", { name: "网络端口" })).toBeTruthy();
    expect(within(dialog).getByRole("heading", { name: "CUPS 打印系统" })).toBeTruthy();
    expect(within(dialog).getByRole("heading", { name: "网络通道凭据" })).toBeTruthy();
    expect(within(dialog).getByRole("heading", { name: "系统防火墙" })).toBeTruthy();

    // Failure codes are presented
    expect(within(dialog).getByText("server-unavailable")).toBeTruthy();
    expect(within(dialog).getByText("invalid-state")).toBeTruthy();
    expect(within(dialog).getByText("queue-unavailable")).toBeTruthy();

    // Concrete recovery actions match CLI semantics
    expect(within(dialog).getByText(/sudo systemctl start shaprintd/)).toBeTruthy();
    expect(
      within(dialog).getByText(/Stop the conflicting process \(PID 1234, 'other-print'\)/),
    ).toBeTruthy();
    expect(within(dialog).getByText(/sudo systemctl start cups/)).toBeTruthy();
    expect(within(dialog).getByText(/sudo shaprintctl network-channel set/)).toBeTruthy();
    expect(within(dialog).getByText(/sudo firewall-cmd --permanent --add-port=48631\/tcp/)).toBeTruthy();
  });

  it("reports configured readiness, shared printers, and client queues from status snapshot", async () => {
    vi.mocked(ipc.getRuntimeStatus).mockResolvedValue({
      services: [
        { id: "client-proxy", state: "running", detail: "running" },
        { id: "server-sharing", state: "running", detail: "sharing 2 printers" },
      ],
      readiness: "client-and-server-ready",
      shared_printers: ["HP-LaserJet-Shared", "Receipt-Printer"],
      client_queues: ["Office-Color-Queue"],
      failure_code: null,
    });

    render(<App />);

    fireEvent.click(
      await screen.findByRole("button", {
        name: /客户端与服务端就绪。打开服务诊断/,
      }),
    );

    const dialog = await screen.findByRole("dialog", { name: "打印服务状态" });
    expect(within(dialog).getByTestId("readiness-status").textContent).toBe("client-and-server-ready");
    expect(within(dialog).getByText(/HP-LaserJet-Shared, Receipt-Printer/)).toBeTruthy();
    expect(within(dialog).getByText(/Office-Color-Queue/)).toBeTruthy();
  });

  it("never exposes secret Network Channel values or keyed URIs in the diagnostics dialog", async () => {
    const SECRET_CHANNEL = "super-secret-network-channel-do-not-leak";
    const KEYED_URI = "ipps://192.168.1.100:48631/ipp/print/printer?key=secret-token-12345";

    vi.mocked(ipc.getDiagnostics).mockResolvedValue({
      checks: [
        {
          check: "credential",
          status: "ok",
          code: null,
          detail: "machine Network Channel is configured",
          recovery: null,
        },
      ],
      healthy: true,
      recent_failure: null,
    });

    render(<App />);

    fireEvent.click(
      await screen.findByRole("button", {
        name: /客户端打印就绪。打开服务诊断/,
      }),
    );

    const dialog = await screen.findByRole("dialog", { name: "打印服务状态" });
    expect(dialog.textContent).not.toContain(SECRET_CHANNEL);
    expect(dialog.textContent).not.toContain(KEYED_URI);
    expect(dialog.textContent).not.toContain("secret-token");
  });
});

it("sends one explicit native test print and asks for its physical result", async () => {
  const target = { queue_name: "Office", server_address: "192.0.2.10:48631", printer_name: "Office" };
  vi.mocked(serverConnections.listRecognisedClientQueues).mockResolvedValue([target]);
  const ready = {
    target, version: CLIENT_VERSION, queue_empty: true, test_print_enabled: true,
    repair_enabled: false, attempted_actions: [], checks: [], session_id: 7,
    requested_media: "iso_a4_210x297mm", submission: "not-sent", physical_result: "unconfirmed",
  };
  let finishSend: (value: unknown) => void = () => {};
  vi.mocked(invoke).mockImplementation((command) => {
    if (command === "send_test_print") return new Promise((resolve) => { finishSend = resolve; });
    if (command === "confirm_test_print") return Promise.resolve({ ...ready, test_print_enabled: false, submission: "accepted", physical_result: "correct" });
    return Promise.resolve(ready);
  });
  render(<App />);
  fireEvent.click(await screen.findByRole("button", { name: "对 Office 进行故障排查" }));
  const send = await screen.findByRole("button", { name: "发送测试打印" });
  expect(screen.getByText(/请求介质：iso_a4_210x297mm/)).toBeTruthy();
  expect(vi.mocked(invoke).mock.calls.some(([command]) => command === "send_test_print")).toBe(false);
  fireEvent.click(send); fireEvent.click(send);
  expect(send.hasAttribute("disabled")).toBe(true);
  expect(vi.mocked(invoke).mock.calls.filter(([command]) => command === "send_test_print")).toHaveLength(1);
  await act(async () => { finishSend({ ...ready, submission: "accepted", test_print_enabled: false }); });
  expect(screen.getByText(/物理输出仍未确认/)).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "打印正确" }));
  expect(await screen.findByText(/您已确认物理输出正确/)).toBeTruthy();
  expect(vi.mocked(invoke)).toHaveBeenCalledWith("confirm_test_print", { sessionId: 7, result: "correct" });
});

it.each(["accepted", "uncertain", "rejected"])("keeps %s submission separate from physical results and requires fresh checks to retry", async (submission) => {
  const target = { queue_name: "Office", server_address: "192.0.2.10:48631", printer_name: "Office" };
  vi.mocked(serverConnections.listRecognisedClientQueues).mockResolvedValue([target]);
  const ready = { target, version: CLIENT_VERSION, queue_empty: true, test_print_enabled: true,
    repair_enabled: false, attempted_actions: [], checks: [], session_id: 9,
    requested_media: "iso_a4_210x297mm", submission: "not-sent", physical_result: "unconfirmed" };
  const sent = { ...ready, submission, test_print_enabled: false, attempted_actions: [{ action: "send-test-print", outcome: submission }] };
  vi.mocked(invoke).mockImplementation((command, args) => {
    if (command === "send_test_print") return Promise.resolve(sent);
    if (command === "refresh_test_print_session") return Promise.resolve({ ...sent, test_print_enabled: true });
    if (command === "confirm_test_print") return Promise.resolve({ ...sent, physical_result: (args as { result: string }).result });
    return Promise.resolve(ready);
  });
  render(<App />);
  fireEvent.click(await screen.findByRole("button", { name: "对 Office 进行故障排查" }));
  fireEvent.click(await screen.findByRole("button", { name: "发送测试打印" }));
  await waitFor(() => expect(screen.getByRole("button", { name: "再次检查" }).hasAttribute("disabled")).toBe(false));
  expect(screen.getByRole("button", { name: "重试测试打印" }).hasAttribute("disabled")).toBe(true);
  expect(screen.getByText(/之前的任务仍可能在下游打印/)).toBeTruthy();
  if (submission === "rejected") {
    expect(screen.queryByRole("button", { name: "打印正确" })).toBeNull();
  } else {
    fireEvent.click(screen.getByRole("button", { name: "无输出" }));
    expect(await screen.findByText(/您报告无输出/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "输出不正确" }));
    const symptoms = await screen.findByRole("combobox", { name: "观察到的症状" });
    fireEvent.change(symptoms, { target: { value: "clipping" } });
    expect(screen.getByText(/将“请求介质”与打印机纸盒及服务器队列中的“已装载介质”进行对比/)).toBeTruthy();
  }
  await waitFor(() => expect(screen.getByRole("button", { name: "再次检查" }).hasAttribute("disabled")).toBe(false));
  fireEvent.click(screen.getByRole("button", { name: "再次检查" }));
  await waitFor(() => expect(screen.getByRole("button", { name: "重试测试打印" }).hasAttribute("disabled")).toBe(false));
  expect(vi.mocked(invoke).mock.calls.filter(([command]) => command === "send_test_print")).toHaveLength(1);
});

it("discards a late send callback after closure and reopening", async () => {
  const target = { queue_name: "Office", server_address: "192.0.2.10:48631", printer_name: "Office" };
  vi.mocked(serverConnections.listRecognisedClientQueues).mockResolvedValue([target]);
  const ready = { target, version: CLIENT_VERSION, queue_empty: true, test_print_enabled: true,
    repair_enabled: false, attempted_actions: [], checks: [], session_id: 10,
    requested_media: "iso_a4_210x297mm", submission: "not-sent", physical_result: "unconfirmed" };
  let finish: (value: unknown) => void = () => {};
  vi.mocked(invoke).mockImplementation((command) => command === "send_test_print"
    ? new Promise((resolve) => { finish = resolve; }) : Promise.resolve(ready));
  render(<App />);
  fireEvent.click(await screen.findByRole("button", { name: "对 Office 进行故障排查" }));
  fireEvent.click(await screen.findByRole("button", { name: "发送测试打印" }));
  fireEvent.click(screen.getByRole("button", { name: "关闭故障排查" }));
  expect(vi.mocked(invoke)).toHaveBeenCalledWith("close_test_print_session", { sessionId: 10 });
  fireEvent.click(screen.getByRole("button", { name: "对 Office 进行故障排查" }));
  await screen.findByRole("button", { name: "发送测试打印" });
  await act(async () => { finish({ ...ready, submission: "accepted", test_print_enabled: false }); });
  expect(screen.queryByRole("button", { name: "打印正确" })).toBeNull();
  expect(vi.mocked(invoke).mock.calls.filter(([command]) => command === "send_test_print")).toHaveLength(1);
});

it.each([
  ["clipping", /外边框图案（2 毫米、5 毫米、10 毫米）/, /将“请求介质”.*“已装载介质”进行对比/],
  ["shifted", /50 毫米的中心对齐十字/, /将“请求介质”.*“已装载介质”进行对比/],
  ["incorrect-size", /页面缩放与纸张尺寸/, /将“请求介质”.*“已装载介质”进行对比/],
  ["blank", /墨盒、碳粉或色带耗材/, /尝试在服务器上直接打印本机测试页/],
])("reports the %s symptom and records it without claiming a root cause", async (symptom, specific, media) => {
  const target = { queue_name: "Office", server_address: "192.0.2.10:48631", printer_name: "Office" };
  vi.mocked(serverConnections.listRecognisedClientQueues).mockResolvedValue([target]);
  const ready = { target, version: CLIENT_VERSION, queue_empty: true, test_print_enabled: false,
    repair_enabled: false, attempted_actions: [{ action: "send-test-print", outcome: "accepted" }],
    checks: [], session_id: 11, requested_media: "iso_a4_210x297mm",
    submission: "accepted", physical_result: "unconfirmed" };
  vi.mocked(invoke).mockImplementation((command, args) => {
    if (command === "confirm_test_print") {
      const { symptom: chosen } = (args ?? {}) as { symptom?: string };
      return Promise.resolve({ ...ready, physical_result: "incorrect", user_symptom: chosen });
    }
    return Promise.resolve(ready);
  });
  render(<App />);
  fireEvent.click(await screen.findByRole("button", { name: "对 Office 进行故障排查" }));
  fireEvent.click(await screen.findByRole("button", { name: "输出不正确" }));
  const select = await screen.findByRole("combobox", { name: "观察到的症状" });
  expect(screen.queryByText(specific)).toBeNull();
  fireEvent.change(select, { target: { value: symptom } });
  expect(await screen.findByText(specific)).toBeTruthy();
  expect(screen.getByText(media)).toBeTruthy();
  expect(screen.getAllByText(/此症状用于引导排查，不构成/i).length).toBeGreaterThan(0);
  expect(vi.mocked(invoke)).toHaveBeenCalledWith("confirm_test_print", {
    sessionId: 11, result: "incorrect", symptom,
  });
  // Returning to no symptom clears the classification and the guidance.
  fireEvent.change(select, { target: { value: "" } });
  await waitFor(() => expect(screen.queryByText(specific)).toBeNull());
  expect(vi.mocked(invoke)).toHaveBeenCalledWith("confirm_test_print", {
    sessionId: 11, result: "incorrect",
  });
});

it("keeps the symptom select locked while a confirmation is pending so no selection is dropped", async () => {
  const target = { queue_name: "Office", server_address: "192.0.2.10:48631", printer_name: "Office" };
  vi.mocked(serverConnections.listRecognisedClientQueues).mockResolvedValue([target]);
  const ready = { target, version: CLIENT_VERSION, queue_empty: true, test_print_enabled: false,
    repair_enabled: false, attempted_actions: [{ action: "send-test-print", outcome: "accepted" }],
    checks: [], session_id: 15, requested_media: "iso_a4_210x297mm",
    submission: "accepted", physical_result: "unconfirmed" };
  let finishConfirm: (value: unknown) => void = () => {};
  vi.mocked(invoke).mockImplementation((command) => {
    if (command === "confirm_test_print") {
      return new Promise((resolve) => { finishConfirm = resolve; });
    }
    return Promise.resolve(ready);
  });
  render(<App />);
  fireEvent.click(await screen.findByRole("button", { name: "对 Office 进行故障排查" }));
  fireEvent.click(await screen.findByRole("button", { name: "输出不正确" }));
  await act(async () => { finishConfirm({ ...ready, physical_result: "incorrect" }); });
  const select = await screen.findByRole("combobox", { name: "观察到的症状" });
  await waitFor(() => expect(select.hasAttribute("disabled")).toBe(false));
  fireEvent.change(select, { target: { value: "blank" } });
  expect(select.hasAttribute("disabled")).toBe(true);
  // A change dispatched while the confirmation owns the select is ignored entirely.
  fireEvent.change(select, { target: { value: "clipping" } });
  expect(vi.mocked(invoke).mock.calls.filter(([command]) => command === "confirm_test_print")).toHaveLength(2);
  await act(async () => { finishConfirm({ ...ready, physical_result: "incorrect", user_symptom: "blank" }); });
  await waitFor(() => expect(select.hasAttribute("disabled")).toBe(false));
  expect((select as HTMLSelectElement).value).toBe("blank");
  expect(screen.getByText(/墨盒、碳粉或色带耗材/)).toBeTruthy();
});

it("explains no-output and delayed output across every visibility limit", async () => {
  const target = { queue_name: "Office", server_address: "192.0.2.10:48631", printer_name: "Office" };
  vi.mocked(serverConnections.listRecognisedClientQueues).mockResolvedValue([target]);
  const ready = { target, version: CLIENT_VERSION, queue_empty: true, test_print_enabled: false,
    repair_enabled: false, attempted_actions: [{ action: "send-test-print", outcome: "accepted" }],
    checks: [], session_id: 12, requested_media: "iso_a4_210x297mm",
    submission: "accepted", physical_result: "unconfirmed" };
  vi.mocked(invoke).mockImplementation((command) => command === "confirm_test_print"
    ? Promise.resolve({ ...ready, physical_result: "no-output" })
    : Promise.resolve(ready));
  render(<App />);
  fireEvent.click(await screen.findByRole("button", { name: "对 Office 进行故障排查" }));
  expect(await screen.findByText(/请在回答前等待延迟输出/)).toBeTruthy();
  fireEvent.click(await screen.findByRole("button", { name: "无输出" }));
  const guidance = await screen.findByText(/您报告无输出/);
  expect(guidance.textContent).toContain("本机客户端队列");
  expect(guidance.textContent).toContain("服务器上的 ShaPrint");
  expect(guidance.textContent).toContain("物理打印机");
  expect(guidance.textContent).toContain("仍可能产生一页");
  expect(vi.mocked(invoke).mock.calls.filter(([command]) => command === "send_test_print")).toHaveLength(0);
});

it("offers an explicit retry only after fresh checks and the duplicate-output warning", async () => {
  const target = { queue_name: "Office", server_address: "192.0.2.10:48631", printer_name: "Office" };
  vi.mocked(serverConnections.listRecognisedClientQueues).mockResolvedValue([target]);
  const ready = { target, version: CLIENT_VERSION, queue_empty: true, test_print_enabled: true,
    repair_enabled: false, attempted_actions: [], checks: [], session_id: 13,
    requested_media: "iso_a4_210x297mm", submission: "not-sent", physical_result: "unconfirmed" };
  const sent = { ...ready, submission: "accepted", test_print_enabled: false,
    attempted_actions: [{ action: "send-test-print", outcome: "accepted" }] };
  const sends = { count: 0 };
  vi.mocked(invoke).mockImplementation((command, args) => {
    if (command === "send_test_print") {
      sends.count += 1;
      return Promise.resolve({ ...sent, attempted_actions: [
        { action: "send-test-print", outcome: "accepted" },
        { action: "retry-test-print", outcome: "accepted" },
      ] });
    }
    if (command === "refresh_test_print_session") {
      return Promise.resolve({ ...sent, test_print_enabled: true });
    }
    if (command === "confirm_test_print") {
      return Promise.resolve({ ...sent, physical_result: (args as { result: string }).result });
    }
    return Promise.resolve(ready);
  });
  render(<App />);
  fireEvent.click(await screen.findByRole("button", { name: "对 Office 进行故障排查" }));
  fireEvent.click(await screen.findByRole("button", { name: "发送测试打印" }));
  expect(await screen.findByText(/本地队列为空并不代表下游已取消/)).toBeTruthy();
  expect(screen.getByText(/之前的任务仍可能在下游打印/)).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "无输出" }));
  expect(await screen.findByText(/您报告无输出/)).toBeTruthy();
  await waitFor(() => expect(screen.getByRole("button", { name: "再次检查" }).hasAttribute("disabled")).toBe(false));
  fireEvent.click(screen.getByRole("button", { name: "再次检查" }));
  const retry = await screen.findByRole("button", { name: "重试测试打印" });
  await waitFor(() => expect(retry.hasAttribute("disabled")).toBe(false));
  expect(sends.count).toBe(1);
  expect(screen.getByText(/本地队列为空并不代表下游已取消/)).toBeTruthy();
  fireEvent.click(retry);
  await waitFor(() => expect(sends.count).toBe(2));
  expect(screen.getByRole("button", { name: "重试测试打印" }).hasAttribute("disabled")).toBe(true);
  // A retry clears the earlier classification: the next incorrect report starts unclassified.
  await waitFor(() => expect(screen.getByRole("button", { name: "输出不正确" }).hasAttribute("disabled")).toBe(false));
  fireEvent.click(screen.getByRole("button", { name: "输出不正确" }));
  const selectAfterRetry = await screen.findByRole("combobox", { name: "观察到的症状" });
  expect((selectAfterRetry as HTMLSelectElement).value).toBe("");
});

it.each([
  ["newly busy queue", { check: "pending-jobs", status: "failed", detail: "Print jobs are pending.", code: "invalid-state" }, false, "在此客户端队列确认为空之前"],
  ["changed server trust", { check: "server-identity", status: "failed", detail: "The server certificate has changed since it was approved.", code: "server-identity-changed" }, true, "The server certificate has changed"],
])("keeps the retry blocked after fresh checks report a %s", async (_label, failedCheck, queueEmpty, expectedDetail) => {
  const target = { queue_name: "Office", server_address: "192.0.2.10:48631", printer_name: "Office" };
  vi.mocked(serverConnections.listRecognisedClientQueues).mockResolvedValue([target]);
  const ready = { target, version: CLIENT_VERSION, queue_empty: true, test_print_enabled: true,
    repair_enabled: false, attempted_actions: [], checks: [], session_id: 14,
    requested_media: "iso_a4_210x297mm", submission: "not-sent", physical_result: "unconfirmed" };
  const sent = { ...ready, submission: "accepted", test_print_enabled: false,
    attempted_actions: [{ action: "send-test-print", outcome: "accepted" }] };
  const sends = { count: 0 };
  vi.mocked(invoke).mockImplementation((command, args) => {
    if (command === "send_test_print") {
      sends.count += 1;
      return Promise.resolve(sent);
    }
    if (command === "confirm_test_print") {
      return Promise.resolve({ ...sent, physical_result: (args as { result: string }).result });
    }
    if (command === "refresh_test_print_session") {
      return Promise.resolve({ ...sent, queue_empty: queueEmpty, test_print_enabled: false, checks: [failedCheck] });
    }
    return Promise.resolve(ready);
  });
  render(<App />);
  fireEvent.click(await screen.findByRole("button", { name: "对 Office 进行故障排查" }));
  fireEvent.click(await screen.findByRole("button", { name: "发送测试打印" }));
  fireEvent.click(await screen.findByRole("button", { name: "无输出" }));
  await screen.findByText(/您报告无输出/);
  await waitFor(() => expect(screen.getByRole("button", { name: "再次检查" }).hasAttribute("disabled")).toBe(false));
  fireEvent.click(screen.getByRole("button", { name: "再次检查" }));
  const retry = await screen.findByRole("button", { name: "重试测试打印" });
  await waitFor(() => expect(screen.getByText(expectedDetail, { exact: false })).toBeTruthy());
  expect(retry.hasAttribute("disabled")).toBe(true);
  expect(sends.count).toBe(1);
});

const reportFixture = () => {
  const target = { queue_name: "Office", server_address: "192.0.2.10:48631", printer_name: "Office" };
  const passive = {
    target, version: CLIENT_VERSION, queue_empty: false, test_print_enabled: false,
    repair_enabled: false, attempted_actions: [] as { action: string; outcome: string }[],
    checks: [
      { check: "spooler", status: "passed", code: null, detail: "The native print spooler responded." },
      { check: "pending-jobs", status: "failed", code: "invalid-state", detail: "Print jobs are pending." },
      { check: "server-identity", status: "failed", code: "server-identity-changed", detail: "The server certificate has changed." },
    ],
  };
  return { target, passive };
};

it("previews and copies a passive-diagnostics report without needing a test print session", async () => {
  const { target, passive } = reportFixture();
  vi.mocked(serverConnections.listRecognisedClientQueues).mockResolvedValue([target]);
  vi.mocked(invoke).mockResolvedValue(passive);
  const writeText = vi.fn().mockResolvedValue(undefined);
  Object.assign(navigator, { clipboard: { writeText } });
  render(<App />);
  fireEvent.click(await screen.findByRole("button", { name: "对 Office 进行故障排查" }));
  fireEvent.click(await screen.findByRole("button", { name: "预览报告" }));
  const report = await screen.findByText(/ShaPrint 故障排查报告/);
  const text = report.closest("pre")?.textContent ?? "";
  expect(text).toContain(`应用版本：${CLIENT_VERSION}`);
  expect(text).toContain("客户端队列：Office");
  expect(text).toContain("服务器：192.0.2.10:48631");
  expect(text).toContain("- 本机打印假脱机：通过");
  expect(text).toContain("- 待处理的打印任务：失败 [invalid-state]");
  expect(text).toContain("- 服务器身份：失败 [server-identity-changed]");
  expect(text).toContain("已尝试的操作：");
  expect(text).toContain("- 无记录");
  expect(text).toContain("仅本次会话的报告");
  // Passive findings carry no test print session: those lines are absent, not invented.
  expect(text).not.toContain("Submission:");
  expect(text).not.toContain("Physical result:");
  fireEvent.click(screen.getByRole("button", { name: "复制报告" }));
  await screen.findByText(/报告已复制到剪贴板/);
  expect(writeText).toHaveBeenCalledTimes(1);
  expect(writeText).toHaveBeenCalledWith(text);
});

it("includes later session outcomes in the report as they become available", async () => {
  const { target, passive } = reportFixture();
  vi.mocked(serverConnections.listRecognisedClientQueues).mockResolvedValue([target]);
  const withSession = {
    ...passive, session_id: 21, requested_media: "iso_a4_210x297mm",
    submission: "uncertain", physical_result: "incorrect", user_symptom: "clipping" as const,
    attempted_actions: [
      { action: "send-test-print", outcome: "accepted" },
      { action: "retry-test-print", outcome: "blocked" },
    ],
  };
  vi.mocked(invoke).mockResolvedValue(withSession);
  render(<App />);
  fireEvent.click(await screen.findByRole("button", { name: "对 Office 进行故障排查" }));
  fireEvent.click(await screen.findByRole("button", { name: "预览报告" }));
  const text = (await screen.findByText(/ShaPrint 故障排查报告/)).closest("pre")?.textContent ?? "";
  expect(text).toContain("请求介质：iso_a4_210x297mm");
  expect(text).toContain("提交状态：uncertain");
  expect(text).toContain("物理输出结果：incorrect");
  expect(text).toContain("观察到的症状：clipping");
  expect(text).toContain("- 发送测试打印：本机假脱机已接受");
  expect(text).toContain("- 重试测试打印：被最新检查阻止");
  expect(text).not.toContain("- 无记录");
});

it("keeps check prose and protected values out of the previewed report", async () => {
  const { target, passive } = reportFixture();
  vi.mocked(serverConnections.listRecognisedClientQueues).mockResolvedValue([target]);
  const secret = `channel-${Math.random().toString(36).slice(2)}`;
  const keyedUri = `ipps://192.0.2.10:48631/ipp/print/Office?key=${secret}`;
  const tainted = {
    ...passive,
    checks: [
      ...passive.checks,
      { check: "network-channel", status: "failed", code: "not-authorized", detail: `driver said ${secret} at ${keyedUri}` },
    ],
  };
  vi.mocked(invoke).mockResolvedValue(tainted);
  render(<App />);
  fireEvent.click(await screen.findByRole("button", { name: "对 Office 进行故障排查" }));
  fireEvent.click(await screen.findByRole("button", { name: "预览报告" }));
  const text = (await screen.findByText(/ShaPrint 故障排查报告/)).closest("pre")?.textContent ?? "";
  expect(text).not.toContain(secret);
  expect(text).not.toContain("ipps://");
  expect(text).not.toContain("driver said");
  expect(text).toContain("- 网络通道授权：失败 [not-authorized]");
});

it("shows copy failure visibly instead of an unsafe fallback", async () => {
  const { target, passive } = reportFixture();
  vi.mocked(serverConnections.listRecognisedClientQueues).mockResolvedValue([target]);
  vi.mocked(invoke).mockResolvedValue(passive);
  const writeText = vi.fn().mockRejectedValue(new Error("clipboard denied"));
  Object.assign(navigator, { clipboard: { writeText } });
  render(<App />);
  fireEvent.click(await screen.findByRole("button", { name: "对 Office 进行故障排查" }));
  fireEvent.click(await screen.findByRole("button", { name: "预览报告" }));
  fireEvent.click(screen.getByRole("button", { name: "复制报告" }));
  const alert = await screen.findByRole("alert");
  expect(alert.textContent).toContain("复制失败。请选中上方报告文本并手动复制。");
  expect(writeText).toHaveBeenCalledTimes(1);
  expect(screen.queryByText(/报告已复制到剪贴板/)).toBeNull();
  // The preview remains the only payload; nothing was printed, saved, or resent.
  expect(vi.mocked(invoke).mock.calls.some(([command]) => command === "send_test_print")).toBe(false);
});

it("qualifies the assembled journey through the visible flow and reflects it in the copied report", async () => {
  const target = { queue_name: "Office", server_address: "192.0.2.10:48631", printer_name: "Office" };
  vi.mocked(serverConnections.listRecognisedClientQueues).mockResolvedValue([target]);
  const canary = `channel-${Math.random().toString(36).slice(2)}`;
  // Journey state evolves exactly as the backend session contract would.
  const state = {
    proxyRunning: false,
    submission: "not-sent" as string,
    physical: "unconfirmed" as string,
    symptom: undefined as string | undefined,
    attempts: [] as { action: string; outcome: string }[],
  };
  const snapshotOf = () => ({
    target, version: CLIENT_VERSION,
    queue_empty: state.proxyRunning,
    // Mirrors the backend: sending is disabled while a response is awaited, and a
    // physical-result confirmation re-enables it after fresh checks.
    test_print_enabled:
      state.proxyRunning && !(state.submission === "accepted" && state.physical === "unconfirmed"),
    repair_enabled: false,
    session_id: 30,
    requested_media: "iso_a4_210x297mm",
    submission: state.submission,
    physical_result: state.physical,
    user_symptom: state.symptom,
    attempted_actions: [...state.attempts],
    checks: [{
      check: "client-proxy",
      status: state.proxyRunning ? "passed" : "failed",
      code: state.proxyRunning ? null : "invalid-state",
      // The generated canary proves check prose cannot reach the copied report.
      detail: `The client proxy is not running. ${canary}`,
    }],
  });
  vi.mocked(ipc.startService).mockImplementation(async () => {
    state.proxyRunning = true;
    return runtimeWith("running", "stopped");
  });
  vi.mocked(invoke).mockImplementation((command, args) => {
    if (command === "send_test_print") {
      state.attempts.push(
        state.attempts.length === 0
          ? { action: "send-test-print", outcome: "accepted" }
          : { action: "retry-test-print", outcome: "accepted" },
      );
      state.submission = "accepted";
      state.physical = "unconfirmed";
      state.symptom = undefined;
      return Promise.resolve(snapshotOf());
    }
    if (command === "confirm_test_print") {
      const { result, symptom } = (args ?? {}) as { result: string; symptom?: string };
      state.physical = result;
      state.symptom = result === "incorrect" ? symptom : undefined;
      return Promise.resolve(snapshotOf());
    }
    return Promise.resolve(snapshotOf());
  });
  const writeText = vi.fn().mockResolvedValue(undefined);
  Object.assign(navigator, { clipboard: { writeText } });
  render(<App />);

  // Diagnosis observes the stopped proxy; the explicit recovery action is recorded.
  fireEvent.click(await screen.findByRole("button", { name: "对 Office 进行故障排查" }));
  const dialog = await screen.findByRole("dialog", { name: "故障排查打印机" });
  expect(within(dialog).getByText(/The client proxy is not running/)).toBeTruthy();
  expect(screen.getByRole("button", { name: "发送测试打印" }).hasAttribute("disabled")).toBe(true);
  fireEvent.click(screen.getByRole("button", { name: "启动客户端代理" }));
  await waitFor(() => expect(screen.getByRole("button", { name: "发送测试打印" }).hasAttribute("disabled")).toBe(false));

  // Native send, no-output report, then incorrect output with a symptom.
  fireEvent.click(screen.getByRole("button", { name: "发送测试打印" }));
  expect(await screen.findByText(/物理输出仍未确认/)).toBeTruthy();
  await waitFor(() => expect(screen.getByRole("button", { name: "无输出" }).hasAttribute("disabled")).toBe(false));
  fireEvent.click(screen.getByRole("button", { name: "无输出" }));
  expect(await screen.findByText(/您报告无输出/)).toBeTruthy();
  await waitFor(() => expect(screen.getByRole("button", { name: "输出不正确" }).hasAttribute("disabled")).toBe(false));
  fireEvent.click(screen.getByRole("button", { name: "输出不正确" }));
  fireEvent.change(await screen.findByRole("combobox", { name: "观察到的症状" }), { target: { value: "blank" } });
  expect(await screen.findByText(/墨盒、碳粉或色带耗材/)).toBeTruthy();

  // Fresh checks, then the explicit retry relabeled as such.
  await waitFor(() => expect(screen.getByRole("button", { name: "再次检查" }).hasAttribute("disabled")).toBe(false));
  fireEvent.click(screen.getByRole("button", { name: "再次检查" }));
  const retry = await screen.findByRole("button", { name: "重试测试打印" });
  await waitFor(() => expect(retry.hasAttribute("disabled")).toBe(false));
  fireEvent.click(retry);
  await waitFor(() => expect(screen.getByText(/物理输出仍未确认/)).toBeTruthy());

  // The copied report reflects the integrated outcomes of the whole journey.
  await waitFor(() => expect(screen.getByRole("button", { name: "输出不正确" }).hasAttribute("disabled")).toBe(false));
  fireEvent.click(screen.getByRole("button", { name: "输出不正确" }));
  fireEvent.change(await screen.findByRole("combobox", { name: "观察到的症状" }), { target: { value: "blank" } });
  await screen.findByText(/墨盒、碳粉或色带耗材/);
  fireEvent.click(screen.getByRole("button", { name: "预览报告" }));
  const report = await screen.findByText(/ShaPrint 故障排查报告/);
  const text = report.closest("pre")?.textContent ?? "";
  expect(text).toContain(`应用版本：${CLIENT_VERSION}`);
  expect(text).toContain("- 客户端代理：通过");
  expect(text).toContain("- 启动客户端代理：成功");
  expect(text).toContain("- 发送测试打印：本机假脱机已接受");
  expect(text).toContain("- 重试测试打印：本机假脱机已接受");
  expect(text).toContain("提交状态：accepted");
  expect(text).toContain("观察到的症状：blank");
  // Check prose never reaches the report the user copies.
  expect(text).not.toContain(canary);
  fireEvent.click(screen.getByRole("button", { name: "复制报告" }));
  await screen.findByText(/报告已复制到剪贴板/);
  expect(writeText).toHaveBeenCalledWith(text);
});

it("records a denied client-proxy recovery without unlocking the send action", async () => {
  const target = { queue_name: "Office", server_address: "192.0.2.10:48631", printer_name: "Office" };
  vi.mocked(serverConnections.listRecognisedClientQueues).mockResolvedValue([target]);
  const failed = {
    target, version: CLIENT_VERSION, queue_empty: false, test_print_enabled: false,
    repair_enabled: false, attempted_actions: [], session_id: 31,
    requested_media: "iso_a4_210x297mm", submission: "not-sent", physical_result: "unconfirmed",
    checks: [{ check: "client-proxy", status: "failed", code: "invalid-state", detail: "The client proxy is not running." }],
  };
  vi.mocked(invoke).mockResolvedValue(failed);
  vi.mocked(ipc.startService).mockRejectedValue({ code: "not-authorized", message: "administrator permission was not granted" });
  render(<App />);
  fireEvent.click(await screen.findByRole("button", { name: "对 Office 进行故障排查" }));
  const dialog = await screen.findByRole("dialog", { name: "故障排查打印机" });
  fireEvent.click(within(dialog).getByRole("button", { name: "启动客户端代理" }));
  const attempted = await within(dialog).findByLabelText("已尝试的恢复操作");
  expect(within(attempted).getByText("启动客户端代理")).toBeTruthy();
  expect(within(attempted).getByText("授权被拒绝")).toBeTruthy();
  await waitFor(() => expect(screen.getByRole("button", { name: "发送测试打印" }).hasAttribute("disabled")).toBe(true));
  expect(screen.getByText(/The client proxy is not running/)).toBeTruthy();
});

it("records a partially completed recovery accurately instead of claiming success", async () => {
  const target = { queue_name: "Office", server_address: "192.0.2.10:48631", printer_name: "Office" };
  vi.mocked(serverConnections.listRecognisedClientQueues).mockResolvedValue([target]);
  const repairable = {
    target, version: CLIENT_VERSION, queue_empty: true, test_print_enabled: false,
    repair_enabled: true, attempted_actions: [], session_id: 32,
    requested_media: "iso_a4_210x297mm", submission: "not-sent", physical_result: "unconfirmed",
    checks: [{ check: "client-queue", status: "passed", code: null, detail: "The installed Client queue matches the selected Server and shared printer." }],
  };
  vi.mocked(invoke).mockResolvedValue(repairable);
  vi.mocked(serverConnections.repairPrinterQueue).mockRejectedValue(
    new Error("the queue repair partially completed"),
  );
  render(<App />);
  fireEvent.click(await screen.findByRole("button", { name: "对 Office 进行故障排查" }));
  const dialog = await screen.findByRole("dialog", { name: "故障排查打印机" });
  fireEvent.click(within(dialog).getByRole("button", { name: "修复客户端队列" }));
  const attempted = await within(dialog).findByLabelText("已尝试的恢复操作");
  expect(within(attempted).getByText("修复客户端队列")).toBeTruthy();
  expect(within(attempted).getByText("部分完成")).toBeTruthy();
  expect(within(dialog).getByText(/已尝试的恢复操作并不代表物理打印已恢复/)).toBeTruthy();
});
