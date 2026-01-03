type StartupOverlayProps = {
  visible: boolean;
  subtitle: string;
  error: string | null;
  errorDetails?: string | null;
  attemptCount: number;
  elapsedMs: number;
  onRetry: () => void;
};

export default function StartupOverlay({
  visible,
  subtitle,
  error,
  errorDetails,
  attemptCount,
  elapsedMs,
  onRetry
}: StartupOverlayProps) {
  const isError = Boolean(error);
  const elapsedSeconds = Math.max(0, Math.floor(elapsedMs / 1000));
  const progress = Math.min(0.9, elapsedMs / 60000);
  const progressPct = `${Math.round(progress * 100)}%`;

  return (
    <div className={`startup-overlay ${visible ? "is-visible" : "is-hidden"}`}>
      <div className="startup-card" role="status" aria-live="polite">
        <div className="startup-title">データを読み込み中…</div>
        <div className="startup-subtitle">
          {isError ? "起動に失敗しました" : subtitle}
        </div>
        {!isError && (
          <div className="startup-progress">
            <div className="startup-progress-bar" style={{ width: progressPct }} />
            <div className="startup-progress-meta">
              接続試行 {attemptCount} 回 / 経過 {elapsedSeconds}s
            </div>
          </div>
        )}
        {!isError && (
          <div className="startup-body">
            <div className="startup-spinner" aria-hidden="true" />
            <div className="startup-skeleton">
              <div className="startup-line" />
              <div className="startup-line" />
              <div className="startup-line short" />
            </div>
          </div>
        )}
        {isError && (
          <div className="startup-error">
            <div className="startup-error-message">{error}</div>
            <button type="button" className="startup-retry" onClick={onRetry}>
              再試行
            </button>
            {errorDetails && (
              <details className="startup-details">
                <summary>詳細</summary>
                <pre>{errorDetails}</pre>
              </details>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
