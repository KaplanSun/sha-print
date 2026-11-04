import { useEffect, useRef, useState } from "react";
import { startService } from "@/api/ipc";
import { repairPrinterQueue } from "@/api/serverConnections";
import { closeTestPrintSession, confirmTestPrint, refreshTestPrintSession, sendTestPrint, inspectLocalClientQueue, type LocalTroubleshootingSnapshot, type UserSymptom } from "@/api/troubleshooting";
import type { RecognisedClientQueue } from "@/api/types";
import { Button } from "@/components/ui/button";
import { Dialog, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { buildTroubleshootingReport, CHECK_LABELS, actionLabel, actionOutcomeLabel, checkLabel, checkStatusLabel } from "@/lib/troubleshooting-report";
import { CLIENT_VERSION } from "@/lib/version";

const SYMPTOM_GUIDANCE: Record<UserSymptom, string> = {
  clipping: "将“请求介质”与打印机纸盒及服务器队列中的“已装载介质”进行对比。检查诊断页上的可打印边距与外边框图案（2 毫米、5 毫米、10 毫米）。此症状用于引导排查，不构成硬件故障的结论。",
  shifted: "将“请求介质”与“已装载介质”进行对比，并检查打印机纸盒中的纸张对齐导轨。检查诊断页上 50 毫米的中心对齐十字。此症状用于引导排查，不构成对齐故障的结论。",
  "incorrect-size": "将“请求介质”与打印机纸盒及服务器队列设置中的“已装载介质”进行对比。检查页面缩放与纸张尺寸。此症状用于引导排查，不构成缩放故障的结论。",
  blank: "检查打印机的墨盒、碳粉或色带耗材及打印头状态。尝试在服务器上直接打印本机测试页。本地接受仅确认假脱机已提交，不能确认标记引擎已传输。此症状用于引导排查，不构成通信故障的结论。",
};

function classifyActionOutcome(error: unknown): "denied" | "failed" | "partial" {
  const errObj = error && typeof error === "object" ? (error as { code?: string; message?: string }) : null;
  const code = errObj?.code?.toLowerCase() ?? "";
  const msg = (typeof error === "string" ? error : errObj?.message ?? "").toLowerCase();
  if (code === "partial" || msg.includes("partial")) {
    return "partial";
  }
  if (
    code === "not-authorized" ||
    msg.includes("permission was not granted") ||
    msg.includes("administrator permission") ||
    msg.includes("authentication was not granted") ||
    msg.includes("authentication was dismissed") ||
    msg.includes("not authorized") ||
    msg.includes("denied")
  ) {
    return "denied";
  }
  return "failed";
}

export function LocalTroubleshootingDialog({ target, onClose, onReviewServer, onConfigureNetworkChannel }: {
  target: RecognisedClientQueue;
  onClose: () => void;
  onReviewServer?: (serverAddress: string) => void;
  onConfigureNetworkChannel?: () => void;
}) {
  const [run, setRun] = useState(0);
  const [snapshot, setSnapshot] = useState<LocalTroubleshootingSnapshot | null>(null);
  const [error, setError] = useState(false);
  const [isExecutingAction, setIsExecutingAction] = useState(false);
  const attemptedActionsRef = useRef<{ action: string; outcome: string }[]>([]);
  const activeRef = useRef(true);
  const sessionIdRef = useRef<number | undefined>(undefined);
  const actionBusyRef = useRef(false);
  const copyBusyRef = useRef(false);
  const [testError, setTestError] = useState(false);
  const [testActionPending, setTestActionPending] = useState(false);
  const [symptom, setSymptom] = useState<UserSymptom | "">("");
  const [reportOpen, setReportOpen] = useState(false);
  const [copyState, setCopyState] = useState<"idle" | "copied" | "failed">("idle");

  const patchSnapshot = (patch: Partial<LocalTroubleshootingSnapshot>) => {
    setSnapshot((current) => (current ? { ...current, ...patch } : current));
  };
  // A copied indicator must not outlive the findings it describes.
  useEffect(() => {
    setCopyState("idle");
  }, [snapshot]);
  useEffect(() => () => {
    if (sessionIdRef.current !== undefined) void closeTestPrintSession(sessionIdRef.current).catch(() => {});
  }, [target]);

  useEffect(() => {
    activeRef.current = true;
    let active = true;
    let settled = false;
    setSnapshot(null);
    setError(false);
    const timer = window.setTimeout(() => {
      if (!active || settled) return;
      settled = true;
      setSnapshot({
        target, version: CLIENT_VERSION, queue_empty: false,
        test_print_enabled: false, repair_enabled: false,
        attempted_actions: [...attemptedActionsRef.current],
        checks: Object.keys(CHECK_LABELS).map((check) => ({
          check, status: "inconclusive", code: "timeout",
          detail: "此检查未能在 15 秒内完成。其结果未知。",
        })),
      });
    }, 15_000);
    const sessionId = sessionIdRef.current;
    const opening = sessionId === undefined;
    const checking = sessionId === undefined ? inspectLocalClientQueue(target) : refreshTestPrintSession(sessionId);
    void checking.then(
      (result) => {
        if (!active || settled) {
          if (opening && result.session_id !== undefined) void closeTestPrintSession(result.session_id).catch(() => {});
          return;
        }
        sessionIdRef.current = result.session_id;
        settled = true;
        window.clearTimeout(timer);
        setSnapshot({
          ...result,
          attempted_actions: [...attemptedActionsRef.current, ...result.attempted_actions],
        });
      },
      () => {
        if (!active || settled) return;
        settled = true;
        window.clearTimeout(timer);
        setError(true);
      },
    );
    return () => {
      active = false;
      activeRef.current = false;
      window.clearTimeout(timer);
    };
  }, [target, run]);

  const handleTestAction = async (
    result?: "correct" | "no-output" | "incorrect",
    chosenSymptom?: UserSymptom,
  ) => {
    const id = sessionIdRef.current;
    if (id === undefined || actionBusyRef.current) return;
    actionBusyRef.current = true;
    setTestActionPending(true);
    setIsExecutingAction(true);
    setTestError(false);
    if (!result) {
      patchSnapshot({
        test_print_enabled: false,
        submission: "checking",
        physical_result: "unconfirmed",
        user_symptom: undefined,
      });
    }
    try {
      const next = result
        ? await confirmTestPrint(id, result, chosenSymptom)
        : await sendTestPrint(id);
      if (!activeRef.current || sessionIdRef.current !== id) return;
      setSnapshot({
        ...next,
        attempted_actions: [...attemptedActionsRef.current, ...next.attempted_actions],
      });
      // The select mirrors the recorded classification exactly: a send clears it.
      setSymptom(next.user_symptom ?? "");
    } catch {
      if (!activeRef.current) return;
      // A transport failure does not establish whether the spooler accepted work.
      if (!result) {
        patchSnapshot({
          test_print_enabled: false,
          submission: "uncertain",
          physical_result: "unconfirmed",
        });
      }
      setTestError(true);
    } finally {
      actionBusyRef.current = false;
      if (activeRef.current) {
        setIsExecutingAction(false);
        setTestActionPending(false);
      }
    }
  };

  const handleSymptomChange = (newSymptom: UserSymptom | "") => {
    // A pending confirmation owns the select; a change made now would be silently
    // dropped by the busy guard and then overwritten by the pending response.
    if (actionBusyRef.current) return;
    setSymptom(newSymptom);
    void handleTestAction("incorrect", newSymptom || undefined);
  };

  const handleStartProxy = async () => {
    if (isExecutingAction) return;
    setIsExecutingAction(true);
    let outcome: "success" | "denied" | "failed" | "partial" = "success";
    try {
      await startService("client-proxy");
    } catch (err) {
      outcome = classifyActionOutcome(err);
    }
    if (!activeRef.current) return;
    attemptedActionsRef.current = [
      ...attemptedActionsRef.current,
      { action: "start-client-proxy", outcome },
    ];
    setIsExecutingAction(false);
    setRun((v) => v + 1);
  };

  const handleRepairQueue = async () => {
    if (isExecutingAction) return;
    setIsExecutingAction(true);
    let outcome: "success" | "denied" | "failed" | "partial" = "success";
    try {
      await repairPrinterQueue(target.server_address, target.printer_name);
    } catch (err) {
      outcome = classifyActionOutcome(err);
    }
    if (!activeRef.current) return;
    attemptedActionsRef.current = [
      ...attemptedActionsRef.current,
      { action: "repair-client-queue", outcome },
    ];
    setIsExecutingAction(false);
    setRun((v) => v + 1);
  };

  // Copying never falls back to another channel automatically: a failure is shown
  // so the user can select the preview text by hand instead.
  const handleCopyReport = async () => {
    if (!snapshot || copyBusyRef.current) return;
    copyBusyRef.current = true;
    try {
      await navigator.clipboard.writeText(buildTroubleshootingReport(snapshot));
      setCopyState("copied");
    } catch {
      setCopyState("failed");
    } finally {
      copyBusyRef.current = false;
    }
  };

  return (
    <Dialog open onOpenChange={(open) => { if (!open) onClose(); }}
      ariaLabelledBy="troubleshoot-title" ariaDescribedBy="troubleshoot-description">
      <DialogHeader>
        <DialogTitle id="troubleshoot-title">故障排查打印机</DialogTitle>
        <DialogDescription id="troubleshoot-description">
          检查此客户端队列，无需打印或更改配置。
        </DialogDescription>
      </DialogHeader>
      <dl className="text-sm space-y-1 mb-4">
        <div><dt className="inline font-semibold">客户端队列：</dt><dd className="inline">{target.queue_name}</dd></div>
        <div><dt className="inline font-semibold">共享打印机：</dt><dd className="inline">{target.printer_name}</dd></div>
        <div><dt className="inline font-semibold">服务器：</dt><dd className="inline">{target.server_address}</dd></div>
      </dl>
      <div aria-live="polite">
        {!snapshot && !error ? <p role="status">正在检查本地打印链路。结果将在 15 秒内显示。</p> : null}
        {error ? <p role="alert">本地检查无法完成。队列状态未知，因此测试与修复仍被阻止。请检查 ShaPrint 后重试。</p> : null}
        {snapshot ? <>
          <ul className="space-y-3">
            {snapshot.checks.map((check) => (
              <li key={check.check} className="rounded-md border p-3 text-sm">
                <p className="font-semibold">
                  {checkLabel(check.check)}{" "}
                  <span className="font-normal">
                    ({checkStatusLabel(check.status)})
                  </span>
                </p>
                <p>{check.detail}</p>
                {check.check === "client-proxy" && check.status === "failed" ? (
                  <div className="mt-2">
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      className="text-xs h-7"
                      disabled={isExecutingAction}
                      onClick={() => void handleStartProxy()}
                    >
                      启动客户端代理
                    </Button>
                  </div>
                ) : null}
                {check.check === "client-queue" && snapshot.repair_enabled ? (
                  <div className="mt-2">
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      className="text-xs h-7"
                      disabled={isExecutingAction}
                      onClick={() => void handleRepairQueue()}
                    >
                      修复客户端队列
                    </Button>
                  </div>
                ) : null}
                {check.check === "server-identity" &&
                (check.status === "failed" || check.code === "server-identity-changed" || check.code === "server-untrusted") &&
                onReviewServer ? (
                  <div className="mt-2">
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      className="text-xs h-7"
                      onClick={() => onReviewServer(target.server_address)}
                    >
                      复核服务器身份
                    </Button>
                  </div>
                ) : null}
                {check.check === "network-channel" &&
                (check.status === "failed" || check.status === "inconclusive" || check.code === "not-authorized") &&
                onConfigureNetworkChannel ? (
                  <div className="mt-2">
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      className="text-xs h-7"
                      onClick={onConfigureNetworkChannel}
                    >
                      网络通道设置
                    </Button>
                  </div>
                ) : null}
              </li>
            ))}
          </ul>
          {snapshot.session_id !== undefined ? (
            <section className="mt-4 space-y-3 rounded-md border p-3 text-sm" aria-label="引导式测试打印">
              <p>请求介质：{snapshot.requested_media ?? "不可用"}</p>
              <p>一页、一份、灰度、单面。已保存的队列默认值保持不变。</p>
              {snapshot.attempted_actions.some((action) => action.action === "send-test-print" || action.action === "retry-test-print") || snapshot.submission === "uncertain" ? <p>再次发送前，请先重新检查并确认客户端队列为空。本地队列为空并不代表下游已取消。即使此队列为空，之前的任务仍可能在下游打印。重试会再发送一页。</p> : null}
              <Button type="button" disabled={!snapshot.test_print_enabled || isExecutingAction} onClick={() => void handleTestAction()}>
                {snapshot.attempted_actions.some((action) => action.action === "send-test-print" || action.action === "retry-test-print") ? "重试测试打印" : "发送测试打印"}
              </Button>
              {testActionPending ? <p role="status">正在检查前置条件并提交。请勿再次发送。</p> : null}
              {testError ? <p role="alert">无法确认结果。再次检查前请先检查本机队列。未自动重试发送。</p> : null}
              {snapshot.submission === "accepted" ? <p>本机假脱机已接受测试打印。在您确认之前，物理输出仍未确认。</p> : null}
              {snapshot.submission === "uncertain" ? <p>提交状态不确定。打印任务可能仍在打印。在您确认之前，物理输出仍未确认。请勿认为超时已将其取消。</p> : null}
              {snapshot.submission === "rejected" ? <p>测试打印在提交文档前被拒绝。请检查本机队列及其打印偏好，然后再次检查。</p> : null}
              {snapshot.submission === "blocked" ? <p>前置条件已变化。未发送测试打印。请查看新的检查结果与请求介质，然后再次检查。</p> : null}
              {snapshot.submission === "accepted" || snapshot.submission === "uncertain" ? <>
                <p>诊断页发生了什么？请在回答前等待延迟输出。</p>
                <div className="flex flex-wrap gap-2">
                  <Button type="button" disabled={isExecutingAction} onClick={() => void handleTestAction("correct")}>打印正确</Button>
                  <Button type="button" variant="outline" disabled={isExecutingAction} onClick={() => void handleTestAction("no-output")}>无输出</Button>
                  <Button type="button" variant="outline" disabled={isExecutingAction} onClick={() => void handleTestAction("incorrect")}>输出不正确</Button>
                </div>
              </> : null}
              {snapshot.physical_result === "correct" ? <p>您已确认物理输出正确。</p> : null}
              {snapshot.physical_result === "no-output" ? <p>您报告无输出。本地假脱机接受仅确认任务进入了本地队列，不能确认打印任务是否到达服务器或物理打印机。请检查本机客户端队列中的待处理任务、服务器上的 ShaPrint，并检查物理打印机的状态与纸盒。在再次发送前请等待延迟输出，因为之前的打印任务仍可能产生一页。</p> : null}
              {snapshot.physical_result === "incorrect" ? <>
                <label className="block">观察到的症状
                  <select aria-label="观察到的症状" value={symptom} onChange={(event) => handleSymptomChange(event.target.value as UserSymptom | "")} disabled={isExecutingAction} className="block border rounded p-2">
                    <option value="">选择症状</option>
                    <option value="clipping">裁切</option><option value="shifted">位置偏移</option>
                    <option value="incorrect-size">尺寸不正确</option><option value="blank">空白输出</option>
                  </select>
                </label>
                {symptom ? <p>{SYMPTOM_GUIDANCE[symptom]}</p> : null}
              </> : null}
            </section>
          ) : null}
          {!snapshot.queue_empty ? <p className="mt-3 text-sm">在此客户端队列确认为空之前，测试与修复均被阻止。</p> : null}
          <p className="mt-3 text-sm text-muted-foreground">若要查看待处理任务，请打开“Windows 设置 &gt; 打印机和扫描仪 &gt; 你的打印机 &gt; 打开打印队列”，或打开你 Linux 桌面上的打印机队列。等待任务完成，或在其中管理。</p>
          {snapshot.attempted_actions.length > 0 ? (
            <div className="mt-4 rounded-md border p-3 text-sm bg-muted/40" aria-label="已尝试的恢复操作">
              <h4 className="font-semibold mb-2">已尝试的恢复操作</h4>
              <ul className="space-y-1">
                {snapshot.attempted_actions.map((item, idx) => (
                  <li key={idx} className="flex justify-between items-center text-xs">
                    <span className="font-medium">{actionLabel(item.action)}</span>
                    <span className="text-muted-foreground">{actionOutcomeLabel(item.outcome)}</span>
                  </li>
                ))}
              </ul>
              <p className="mt-2 text-xs text-muted-foreground">
                已尝试的恢复操作并不代表物理打印已恢复。
              </p>
            </div>
          ) : null}
          <div className="mt-4 rounded-md border p-3 text-sm bg-muted/40" aria-label="故障排查报告">
            <div className="flex flex-wrap items-center gap-2">
              <Button
                type="button"
                size="sm"
                variant="outline"
                className="text-xs h-7"
                aria-expanded={reportOpen}
                onClick={() => setReportOpen((open) => !open)}
              >
                {reportOpen ? "隐藏报告" : "预览报告"}
              </Button>
              {reportOpen ? (
                <Button
                  type="button"
                  size="sm"
                  className="text-xs h-7"
                  onClick={() => void handleCopyReport()}
                >
                  复制报告
                </Button>
              ) : null}
            </div>
            {reportOpen ? (
              <>
                <pre className="mt-2 whitespace-pre-wrap text-xs" tabIndex={0}>
                  {buildTroubleshootingReport(snapshot)}
                </pre>
                {copyState === "copied" ? (
                  <p role="status" className="mt-2 text-xs">报告已复制到剪贴板。</p>
                ) : null}
                {copyState === "failed" ? (
                  <p role="alert" className="mt-2 text-xs">复制失败。请选中上方报告文本并手动复制。</p>
                ) : null}
              </>
            ) : null}
          </div>
          {isExecutingAction && !testActionPending ? (
            <p className="mt-2 text-xs text-muted-foreground" role="status">
              正在执行恢复操作…
            </p>
          ) : null}
        </> : null}
      </div>
      <p className="mt-3 text-xs text-muted-foreground">检查仅展示已观察到的证据，不确认物理输出。关闭将丢弃本次会话，且不会取消已提交的打印任务。请在系统原生队列中管理取消操作。本地取消可能无法停止已转发到服务器或打印机的任务。</p>
      <div className="flex justify-end gap-2 mt-4">
        <Button
          type="button"
          variant="outline"
          disabled={isExecutingAction}
          onClick={() => setRun((value) => value + 1)}
        >
          再次检查
        </Button>
        <Button type="button" onClick={onClose}>关闭故障排查</Button>
      </div>
    </Dialog>
  );
}
