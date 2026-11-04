import type { LocalTroubleshootingSnapshot } from "@/api/troubleshooting";

/** Public label maps shared by the dialog and the copyable session report. */
export const CHECK_LABELS: Record<string, string> = {
  spooler: "本机打印假脱机",
  "client-queue": "客户端队列目标",
  "pending-jobs": "待处理的打印任务",
  "client-proxy": "客户端代理",
  "server-reachability": "服务器可达性",
  "server-identity": "服务器身份",
  "shared-printer": "共享打印机可用性",
  "network-channel": "网络通道授权",
  firewall: "防火墙检查",
};

export const STATUS_LABELS: Record<string, string> = {
  passed: "通过",
  failed: "失败",
  inconclusive: "不确定",
  "not-applicable": "不适用",
};

export const ACTION_LABELS: Record<string, string> = {
  "start-client-proxy": "启动客户端代理",
  "repair-client-queue": "修复客户端队列",
  "send-test-print": "发送测试打印",
  "retry-test-print": "重试测试打印",
};

export const OUTCOME_LABELS: Record<string, string> = {
  success: "成功",
  denied: "授权被拒绝",
  failed: "失败",
  partial: "部分完成",
  accepted: "本机假脱机已接受",
  rejected: "提交前被拒绝",
  uncertain: "提交状态不确定",
  blocked: "被最新检查阻止",
};

const label = (map: Record<string, string>, key: string) => map[key] ?? key;

/** Human label for a check/action/outcome id, falling back to the stable id itself. */
export const checkLabel = (id: string) => label(CHECK_LABELS, id);
export const checkStatusLabel = (status: string) => label(STATUS_LABELS, status);
export const actionLabel = (action: string) => label(ACTION_LABELS, action);
export const actionOutcomeLabel = (outcome: string) => label(OUTCOME_LABELS, outcome);

/**
 * Concise, session-only help-request report composed strictly from the bounded
 * public session snapshot. Check prose (`detail`) is deliberately excluded so
 * raw driver or system text can never reach the preview or the clipboard;
 * failures carry their stable error code instead.
 */
export function buildTroubleshootingReport(snapshot: LocalTroubleshootingSnapshot): string {
  const lines: string[] = [
    "ShaPrint 故障排查报告",
    `应用版本：${snapshot.version}`,
    `客户端队列：${snapshot.target.queue_name}`,
    `共享打印机：${snapshot.target.printer_name}`,
    `服务器：${snapshot.target.server_address}`,
  ];
  if (snapshot.requested_media) {
    lines.push(`请求介质：${snapshot.requested_media}`);
  }
  if (snapshot.submission) {
    lines.push(`提交状态：${snapshot.submission}`);
  }
  if (snapshot.physical_result) {
    lines.push(`物理输出结果：${snapshot.physical_result}`);
  }
  if (snapshot.user_symptom) {
    lines.push(`观察到的症状：${snapshot.user_symptom}`);
  }
  lines.push("", "检查项：");
  if (snapshot.checks.length === 0) {
    lines.push("- 无记录");
  } else {
    for (const check of snapshot.checks) {
      const code = check.code ? ` [${check.code}]` : "";
      lines.push(`- ${checkLabel(check.check)}：${checkStatusLabel(check.status)}${code}`);
    }
  }
  lines.push("", "已尝试的操作：");
  if (snapshot.attempted_actions.length === 0) {
    lines.push("- 无记录");
  } else {
    for (const action of snapshot.attempted_actions) {
      lines.push(`- ${actionLabel(action.action)}：${actionOutcomeLabel(action.outcome)}`);
    }
  }
  lines.push("", "仅本次会话的报告。ShaPrint 不保留故障排查历史。");
  return lines.join("\n");
}
