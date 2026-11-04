import type { UpdateStatus } from "@/api/updates";

interface UpdateNoticeProps {
  status: UpdateStatus | null;
  error: string | null;
  checking: boolean;
  onCheck: () => void;
  onRestart: () => void;
}

export function UpdateNotice({ status, error, checking, onCheck, onRestart }: UpdateNoticeProps) {
  const update = status?.update;
  const ready = update?.state === "ready_to_restart";
  const failure = update?.state === "failed" ? update.message : error;
  if (!ready && !failure && update?.state !== "checking" && !checking) return null;

  return (
    <section className="update-notice" aria-label="软件更新">
      <div className="update-copy" aria-live="polite">
        {ready ? (
          <>
            <strong>ShaPrint {update.version} 已就绪</strong>
            <p>{status?.waiting_for_jobs
              ? "你的重启已排队。ShaPrint 将在打印与假脱机清理完成后重启。"
              : "更新已下载并校验。你可以在方便时重启。"}</p>
          </>
        ) : failure ? (
          <>
            <strong>更新未能完成</strong>
            <p role="alert">{failure}</p>
          </>
        ) : (
          <>
            <strong>正在检查更新</strong>
            <p>检查期间 ShaPrint 会继续保持打印可用。</p>
          </>
        )}
      </div>
      <div className="update-actions">
        {ready ? (
          <button type="button" className="update-primary" onClick={onRestart}>
            {status?.waiting_for_jobs ? "重启已排队" : "立即重启"}
          </button>
        ) : (
          <button type="button" onClick={onCheck} disabled={checking || update?.state === "checking"}>
            {checking || update?.state === "checking" ? "正在检查…" : "检查更新"}
          </button>
        )}
      </div>
    </section>
  );
}
