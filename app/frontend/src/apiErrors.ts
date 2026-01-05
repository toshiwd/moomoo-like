export type ApiErrorInfo = {
  url: string;
  method: string;
  status: number | null;
  response: string | null;
  requestId: string | null;
  time: string;
};

export const formatApiErrorText = (info: ApiErrorInfo) => {
  const lines = [
    `Endpoint: ${info.url}`,
    `Method: ${info.method}`,
    `Status: ${info.status ?? "unknown"}`,
    `Response: ${info.response ?? "unknown"}`,
    `Request ID: ${info.requestId ?? "unknown"}`,
    `Time: ${info.time}`
  ];
  return lines.join("\n");
};
