import { useEffect } from "react";

type ToastProps = {
  message: string | null;
  onClose: () => void;
};

export default function Toast({ message, onClose }: ToastProps) {
  useEffect(() => {
    if (!message) return;
    const timer = window.setTimeout(() => onClose(), 2400);
    return () => window.clearTimeout(timer);
  }, [message, onClose]);

  if (!message) return null;

  return (
    <div className="toast" role="status" aria-live="polite">
      {message}
    </div>
  );
}
