import { printRecovery } from "@/api/availability";
import type { ServiceId, ServiceState, ServiceStatus } from "@/api/types";
import { Badge, type BadgeProps } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";

/** User-facing name and purpose of each supervised service. */
const SERVICE_LABELS: Partial<Record<ServiceId, { title: string; description: string }>> = {
  "client-proxy": {
    title: "客户端代理",
    description: "将你已安装队列的打印任务转发到受信任的服务器。",
  },
  "server-sharing": {
    title: "服务器共享",
    description: "将你选择的本地打印机队列共享给其他 ShaPrint 用户。",
  },
  "server-discovery": {
    title: "服务器发现",
    description: "在此网络上查找 ShaPrint 服务器，以便你复核并连接。",
  },
};

const STATE_LABELS: Record<ServiceState, string> = {
  stopped: "已停止",
  starting: "启动中",
  running: "运行中",
  stopping: "停止中",
  failed: "失败",
};

const STATE_VARIANTS: Record<ServiceState, NonNullable<BadgeProps["variant"]>> = {
  stopped: "muted",
  starting: "warning",
  running: "success",
  stopping: "warning",
  failed: "destructive",
};

/** Which control is legal in each state; the shell rejects anything else as `invalid-state`. */
const CONTROLS: Record<ServiceState, { canStart: boolean; canStop: boolean }> = {
  stopped: { canStart: true, canStop: false },
  starting: { canStart: false, canStop: true },
  running: { canStart: false, canStop: true },
  stopping: { canStart: false, canStop: false },
  failed: { canStart: true, canStop: false },
};

export interface ServiceStatusCardProps {
  service: ServiceStatus;
  busy: boolean;
  onStart: () => void;
  onStop: () => void;
}

/** One service with its live state and the controls that own its lifecycle. */
export function ServiceStatusCard({ service, busy, onStart, onStop }: ServiceStatusCardProps) {
  const label = SERVICE_LABELS[service.id];
  const serviceName = label?.title ?? service.id;
  const headingId = `${service.id}-service-heading`;
  const controls = CONTROLS[service.state];
  const recovery = printRecovery(service);
  const startLabel =
    service.state === "starting" || (busy && service.state === "stopped") ? "启动中…" : "启动";
  const stopLabel =
    service.state === "stopping" || (busy && service.state === "running") ? "停止中…" : "停止";

  return (
    <section
      className="service"
      data-service={service.id}
      data-state={service.state}
      aria-labelledby={headingId}
    >
      <header className="service-header">
        <div>
          <h3 id={headingId}>{serviceName}</h3>
          {label ? <p className="service-description">{label.description}</p> : null}
        </div>
        <Badge className="service-state-badge" variant={STATE_VARIANTS[service.state]} role="status">
          {STATE_LABELS[service.state] ?? service.state}
        </Badge>
      </header>

      {service.detail ? <p className="service-detail">{service.detail}</p> : null}

      {recovery ? (
        <p className="service-recovery" role="status">
          <span className="service-recovery-label">打印受影响</span>
          {recovery}
        </p>
      ) : null}

      <div className="service-actions">
        <Button type="button" size="sm" onClick={onStart} disabled={busy || !controls.canStart}>
          {startLabel}
        </Button>
        <Button
          type="button"
          size="sm"
          variant="outline"
          onClick={onStop}
          disabled={busy || !controls.canStop}
        >
          {stopLabel}
        </Button>
      </div>
    </section>
  );
}
