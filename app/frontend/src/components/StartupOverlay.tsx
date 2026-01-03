type StartupOverlayProps = {
  visible: boolean;
  subtitle: string;
  error: string | null;
  errorDetails?: string | null;
  onRetry: () => void;
};

export default function StartupOverlay({
  visible,
  subtitle,
  error,
  errorDetails,
  onRetry
}: StartupOverlayProps) {
  const isError = Boolean(error);

  return (
    <div className={`startup-overlay ${visible ? "is-visible" : "is-hidden"}`}>
      <div className="startup-card" role="status" aria-live="polite">
        <div className="startup-title">データを読み込み中…</div>
        <div className="startup-subtitle">
          {isError ? "起動に失敗しました" : subtitle}
        </div>
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
