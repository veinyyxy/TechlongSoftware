"use client";

import Link from "next/link";
import { useRef, useState, type ReactNode } from "react";
import { formatDate } from "@/lib/admin/presentation";
import type { ApiResponse } from "@/lib/api/response";
import type { FirstOpenInstanceSummary, FirstOpenInstanceView, FirstOpenLogEvent } from "@/lib/deployments/first-open-admin-store";

type Execution = NonNullable<FirstOpenInstanceSummary["execution"]>;
const executionStates: Record<Execution["status"], { label: string; tone: string }> = {
  waiting: { label: "等待调度", tone: "warning" },
  running: { label: "开通中", tone: "warning" },
  failed: { label: "失败", tone: "danger" },
  unknown: { label: "结果未确认", tone: "warning" },
  succeeded: { label: "已开通", tone: "active" },
};

const stepLabels: Record<Execution["step"], string> = {
  approval: "批准",
  task_start: "任务启动",
  database_initialization: "数据库初始化",
  api_deployment: "API 部署",
  self_check: "技术自检",
  activation: "激活",
};

const eventLabels: Record<FirstOpenLogEvent["status"], string> = {
  started: "开始",
  completed: "完成",
  failed: "失败",
  unknown: "结果未确认",
};

type Props = {
  summary: FirstOpenInstanceSummary;
  instanceName: string;
  fallbackState: { label: string; tone: string };
} & (
  | { mode: "row"; children: ReactNode }
  | { mode: "detail"; initialEvents?: FirstOpenLogEvent[] }
);

export function FirstOpenAdminControls(props: Props) {
  const { summary, instanceName, fallbackState } = props;
  const [view, setView] = useState(summary);
  const [events, setEvents] = useState(props.mode === "detail" ? props.initialEvents : undefined);
  const [pending, setPending] = useState<"approval" | "logs" | null>(null);
  const [error, setError] = useState("");
  const [approvalUncertain, setApprovalUncertain] = useState(false);
  const busy = useRef(false);
  const instancePath = `/admin/instances/${encodeURIComponent(summary.instanceId)}`;
  const endpoint = `/api${instancePath}/first-open`;
  const { execution } = view;
  const state = execution ? executionStates[execution.status] : fallbackState;
  const showApproval = !execution || execution.status === "waiting" || execution.status === "running";
  const canApprove = (!!execution || view.eligible) && !approvalUncertain;

  async function runAction(action: "approval" | "logs") {
    if (busy.current) return;
    busy.current = true;
    setPending(action);
    setError("");
    let approvalMayHaveCommitted = action === "approval";

    async function read<T>(method: "GET" | "POST"): Promise<T> {
      const response = await fetch(endpoint, { method, cache: "no-store" });
      if (method === "POST" && !response.ok && response.status < 500) approvalMayHaveCommitted = false;
      const payload = (await response.json()) as ApiResponse<T>;
      if (!response.ok || !payload.data) {
        throw Error(payload.error?.message ?? (method === "POST" ? "审批未完成，请查看当前实例状态。" : "无法读取开通日志，请稍后刷新。"));
      }
      return payload.data;
    }

    try {
      if (action === "approval") {
        const approved = await read<Execution>("POST");
        approvalMayHaveCommitted = false;
        setView((current) => ({ ...current, execution: approved }));
      }
      if (action === "logs" || events !== undefined) {
        const result = await read<FirstOpenInstanceView>("GET");
        setView(result);
        setEvents(result.events);
        setApprovalUncertain(false);
      }
    } catch (error) {
      if (approvalMayHaveCommitted) {
        setApprovalUncertain(true);
        setError("审批结果未确认。请查看开通过程日志核对当前进度。");
        return;
      }
      const message = error instanceof Error && error.name === "Error" ? error.message : "暂时无法读取，请稍后刷新。";
      setError(message);
    } finally {
      busy.current = false;
      setPending(null);
    }
  }

  const progress = (
    <div className="first-open-status" role="status">
      <span className={`status-pill status-${state.tone}`}>{state.label}</span>
      {execution ? <>
        <span>当前步骤 · {stepLabels[execution.step]}</span>
        <span>执行编号 <code>{execution.id}</code></span>
      </> : null}
    </div>
  );

  const actions = (
    <div className="first-open-actions">
      {showApproval ? (
        <button
          aria-label={`批准并开通 ${instanceName}`}
          className="button button-dark button-small"
          disabled={!canApprove || pending !== null}
          onClick={() => runAction("approval")}
          type="button"
        >
          {pending === "approval" ? "正在提交…" : "批准并开通"}
        </button>
      ) : null}
      {showApproval && !execution && !view.eligible ? <span>尚不满足审批条件</span> : null}
      {props.mode === "row" ? (
        <Link aria-label={`查看开通过程日志 ${instanceName}`} className="button button-ghost button-small" href={`${instancePath}?firstOpenLogs=1#first-open-logs`} prefetch={false}>
          查看开通过程日志
        </Link>
      ) : (
        <button
          aria-controls="first-open-logs"
          aria-expanded={events !== undefined}
          className="button button-ghost button-small"
          disabled={pending !== null}
          onClick={() => runAction("logs")}
          type="button"
        >
          {pending === "logs" ? "正在读取…" : events === undefined ? "查看开通过程日志" : "刷新开通过程日志"}
        </button>
      )}
      {error ? <p className="form-error compact-error" role="alert">{error}</p> : null}
    </div>
  );

  if (props.mode === "row") {
    return <>
      <td>{progress}</td>
      {props.children}
      <td>
        {actions}
        <Link className="table-link" href={instancePath}>查看详情</Link>
      </td>
    </>;
  }

  return (
    <section aria-labelledby="first-open-title" className="module-card">
      <h2 id="first-open-title">首次开通</h2>
      {progress}
      {actions}
      <section aria-busy={pending === "logs"} aria-labelledby="first-open-logs-title" hidden={events === undefined} id="first-open-logs">
        <h3 id="first-open-logs-title">开通过程日志</h3>
        {events?.length ? (
          <ol className="first-open-log" aria-label="开通过程日志">
            {events.map((event, index) => (
              <li key={`${event.step}-${event.at}-${index}`}>
                <strong>{stepLabels[event.step]} · {eventLabels[event.status]}</strong>
                <time dateTime={new Date(event.at).toISOString()}>{formatDate(event.at)} UTC</time>
                {event.errorCode || event.reason ? (
                  <p>{event.errorCode ? <code>{event.errorCode}</code> : null}{event.errorCode && event.reason ? " · " : null}{event.reason}</p>
                ) : null}
              </li>
            ))}
          </ol>
        ) : <p role="status">尚无开通日志</p>}
      </section>
    </section>
  );
}
