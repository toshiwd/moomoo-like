import { createContext, useContext, useEffect, useRef, useState } from "react";
import type { ReactNode } from "react";
import { api } from "./api";
import StartupOverlay from "./components/StartupOverlay";

type BackendReadyState = {
  ready: boolean;
  phase: string;
  message: string;
  error: string | null;
  errorDetails: string | null;
  retry: () => void;
};

const BackendReadyContext = createContext<BackendReadyState | null>(null);

const BACKOFF_STEPS = [200, 500, 1000];
const ERROR_THRESHOLD = 5;

const getDefaultMessage = (phase: string) => {
  if (phase === "ingesting") return "データ準備中";
  return "バックエンド起動待ち";
};

const useBackendReadyInternal = (): BackendReadyState => {
  const [ready, setReady] = useState(false);
  const [phase, setPhase] = useState("starting");
  const [message, setMessage] = useState(getDefaultMessage("starting"));
  const [error, setError] = useState<string | null>(null);
  const [errorDetails, setErrorDetails] = useState<string | null>(null);
  const attemptRef = useRef(0);
  const failureRef = useRef(0);
  const timerRef = useRef<number | null>(null);
  const inFlightRef = useRef(false);
  const readyRef = useRef(false);

  const clearTimer = () => {
    if (timerRef.current !== null) {
      window.clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  };

  const scheduleNext = () => {
    const idx = Math.min(attemptRef.current - 1, BACKOFF_STEPS.length - 1);
    const delay = BACKOFF_STEPS[idx] ?? BACKOFF_STEPS[BACKOFF_STEPS.length - 1];
    clearTimer();
    timerRef.current = window.setTimeout(() => {
      void probe();
    }, delay);
  };

  const setNotReadyState = (nextPhase: string, nextMessage: string) => {
    setPhase(nextPhase);
    setMessage(nextMessage);
  };

  const probe = async () => {
    if (readyRef.current || inFlightRef.current) return;
    inFlightRef.current = true;
    attemptRef.current += 1;
    try {
      const res = await api.get("/health", {
        timeout: 2000,
        validateStatus: () => true
      });
      const data = res.data as {
        ready?: boolean;
        phase?: string;
        message?: string;
        errors?: string[];
      };
      const isHttpOk = res.status >= 200 && res.status < 300;
      const isReady = typeof data?.ready === "boolean" ? data.ready : isHttpOk;
      const nextPhase = data?.phase ?? (isReady ? "ready" : "starting");
      const nextMessage = data?.message ?? getDefaultMessage(nextPhase);

      if (isReady) {
        readyRef.current = true;
        setReady(true);
        setPhase("ready");
        setMessage("準備完了");
        setError(null);
        setErrorDetails(null);
        return;
      }

      if (isHttpOk) {
        failureRef.current = 0;
        setNotReadyState(nextPhase, nextMessage);
        scheduleNext();
        return;
      }

      failureRef.current += 1;
      setNotReadyState(nextPhase, nextMessage);
      if (failureRef.current >= ERROR_THRESHOLD) {
        setError("起動に失敗しました。");
        const details = data?.errors?.length ? data.errors.join("\n") : `status:${res.status}`;
        setErrorDetails(details);
        return;
      }

      if (failureRef.current % 10 === 0) {
        console.warn("backend not ready", res.status);
      }
      scheduleNext();
    } catch (err) {
      failureRef.current += 1;
      if (failureRef.current >= ERROR_THRESHOLD) {
        const detail = err instanceof Error ? err.message : String(err);
        setError("起動に失敗しました。");
        setErrorDetails(detail);
        return;
      }
      if (failureRef.current % 10 === 0) {
        console.warn("backend not ready");
      }
      scheduleNext();
    } finally {
      inFlightRef.current = false;
    }
  };

  const retry = () => {
    failureRef.current = 0;
    attemptRef.current = 0;
    setError(null);
    setErrorDetails(null);
    setNotReadyState("starting", getDefaultMessage("starting"));
    readyRef.current = false;
    clearTimer();
    void probe();
  };

  useEffect(() => {
    void probe();
    return () => clearTimer();
  }, []);

  return { ready, phase, message, error, errorDetails, retry };
};

export function BackendReadyProvider({ children }: { children: ReactNode }) {
  const state = useBackendReadyInternal();
  const [renderOverlay, setRenderOverlay] = useState(true);
  const [overlayVisible, setOverlayVisible] = useState(true);

  useEffect(() => {
    if (state.ready) {
      setOverlayVisible(false);
      const timer = window.setTimeout(() => setRenderOverlay(false), 200);
      return () => window.clearTimeout(timer);
    }
    setRenderOverlay(true);
    setOverlayVisible(true);
    return undefined;
  }, [state.ready]);

  return (
    <BackendReadyContext.Provider value={state}>
      {children}
      {renderOverlay && (
        <StartupOverlay
          visible={overlayVisible}
          subtitle={state.message}
          error={state.error}
          errorDetails={state.errorDetails}
          onRetry={state.retry}
        />
      )}
    </BackendReadyContext.Provider>
  );
}

export function useBackendReadyState() {
  const context = useContext(BackendReadyContext);
  if (!context) {
    return {
      ready: true,
      phase: "ready",
      message: "準備完了",
      error: null,
      errorDetails: null,
      retry: () => undefined
    } satisfies BackendReadyState;
  }
  return context;
}
