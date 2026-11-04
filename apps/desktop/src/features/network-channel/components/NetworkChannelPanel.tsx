import { KeyRound, RefreshCw } from "lucide-react";
import { useState, type FormEvent } from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { PasswordInput } from "@/components/ui/input";
import type { NetworkChannelController } from "../hooks/useNetworkChannel";

export interface NetworkChannelPanelProps {
  settings: NetworkChannelController;
}

/** Lets the user set or replace the shared print authorization secret. */
export function NetworkChannelPanel({ settings }: NetworkChannelPanelProps) {
  const [value, setValue] = useState("");
  const [saved, setSaved] = useState(false);
  const { configured, saving, error, save, refresh } = settings;

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSaved(false);
    if (await save(value)) {
      setValue("");
      setSaved(true);
    }
  }

  return (
    <section className="panel feature-panel network-channel-panel" aria-labelledby="network-channel-heading">
      <div className="panel-header flex items-center justify-between">
        <div className="flex items-center gap-2.5">
          <div className="flex size-7 items-center justify-center rounded-lg bg-primary/10 text-primary">
            <KeyRound size={16} />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h2 id="network-channel-heading" className="text-base font-semibold leading-none">
                打印授权
              </h2>
              {configured !== null && (
                <Badge variant={configured ? "success" : "warning"} className="text-[10px]">
                  {configured ? "已配置" : "未设置"}
                </Badge>
              )}
            </div>
            <p className="hint text-xs mt-1 text-muted-foreground">
              客户端与服务器用它来授权打印任务。
            </p>
          </div>
        </div>

        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={() => void refresh()}
          disabled={saving}
          className="text-xs h-8"
        >
          <RefreshCw size={13} className={saving ? "animate-spin mr-1" : "mr-1"} />
          刷新
        </Button>
      </div>

      <p className="hint text-xs text-muted-foreground leading-relaxed">
        {configured === null
          ? "正在检查网络通道状态…"
          : configured
            ? "已配置。输入新值可替换它；已保存的值永远不会显示。"
            : "在客户端提交打印任务前，请先设置网络通道。"}
      </p>

      {error ? (
        <p className="banner" role="alert">
          <span className="banner-code">{error.code}</span>
          <span className="banner-message">{error.message}</span>
        </p>
      ) : null}
      {saved ? (
        <p className="channel-saved" role="status">
          网络通道已更新。已保存的值已从本表单中清除。
        </p>
      ) : null}

      <form onSubmit={(event) => void submit(event)} className="network-channel-form space-y-3 pt-1">
        <div className="space-y-1.5">
          <label htmlFor="network-channel" className="text-xs font-semibold text-foreground block">
            网络通道
          </label>
          <div className="flex flex-col sm:flex-row gap-2">
            <PasswordInput
              id="network-channel"
              name="network-channel"
              visibilityLabel="网络通道"
              autoComplete="new-password"
              placeholder="输入共享的网络通道"
              value={value}
              onChange={(event) => setValue(event.currentTarget.value)}
              required
              disabled={saving}
              className="flex-1 text-xs"
            />
            <Button
              type="submit"
              disabled={saving || value.trim().length === 0}
              className="text-xs h-9 px-4 shrink-0 font-medium"
            >
              {saving ? "正在保存…" : "保存网络通道"}
            </Button>
          </div>
        </div>

        <p className="hint text-[11px] text-muted-foreground">
          客户端与服务器必须使用相同的通道才能授权打印任务。
        </p>
      </form>
    </section>
  );
}
