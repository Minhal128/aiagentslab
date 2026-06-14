import { useEffect, useState } from "react";
import { useLocation } from "wouter";
import { Loader2, CheckCircle2, XCircle } from "lucide-react";
import { apiRequest } from "@/lib/queryClient";

type Status = "loading" | "success" | "error";

function detectType(state: string): string {
  try {
    const b64 = state.replace(/-/g, "+").replace(/_/g, "/");
    const padding = "=".repeat((4 - (b64.length % 4)) % 4);
    const decoded = atob(b64 + padding);
    const parsed = JSON.parse(decoded);
    const parts = (parsed?.payload as string)?.split(":") ?? [];
    return parts[2] || "sheets";
  } catch {
    return "sheets";
  }
}

export default function GoogleCallbackPage() {
  const [, navigate] = useLocation();
  const [status, setStatus] = useState<Status>("loading");
  const [errorMessage, setErrorMessage] = useState<string>("");
  const [integrationType, setIntegrationType] = useState<"sheets" | "calendar">("sheets");

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const code = params.get("code");
    const state = params.get("state");
    const error = params.get("error");

    const type = state ? detectType(state) : "sheets";
    const resolvedType = type === "calendar" ? "calendar" : "sheets";
    setIntegrationType(resolvedType);

    if (error || !code || !state) {
      const errorCode = error || "access_denied";
      setStatus("error");
      setErrorMessage(errorCode === "access_denied" ? "Access was denied by Google." : `Google returned an error: ${errorCode}`);
      const redirectBase = resolvedType === "calendar"
        ? "/app/flows/appointments"
        : "/app/tools";
      setTimeout(() => navigate(`${redirectBase}?google_error=${encodeURIComponent(errorCode)}`), 2500);
      return;
    }

    const endpoint = resolvedType === "calendar"
      ? "/api/google-calendar/exchange"
      : "/api/integrations/google/exchange";

    apiRequest("POST", endpoint, { code, state })
      .then(async (res) => {
        if (!res.ok) {
          const body = await res.json().catch(() => ({}));
          const msg = body?.error || "Token exchange failed.";
          setStatus("error");
          setErrorMessage(msg);
          const errCode = body?.errorCode || "server_error";
          const redirectBase = resolvedType === "calendar"
            ? "/app/flows/appointments"
            : "/app/tools";
          setTimeout(() => navigate(`${redirectBase}?google_error=${encodeURIComponent(errCode)}`), 2500);
        } else {
          setStatus("success");
          if (resolvedType === "calendar") {
            setTimeout(() => navigate("/app/flows/appointments?google_calendar_connected=true"), 1500);
          } else {
            setTimeout(() => navigate("/app/tools?google_connected=true"), 1500);
          }
        }
      })
      .catch(() => {
        setStatus("error");
        setErrorMessage("A network error occurred. Please try again.");
        const redirectBase = resolvedType === "calendar"
          ? "/app/flows/appointments"
          : "/app/tools";
        setTimeout(() => navigate(`${redirectBase}?google_error=server_error`), 2500);
      });
  }, [navigate]);

  const productName = integrationType === "calendar" ? "Google Calendar" : "Google Sheets";

  return (
    <div className="flex flex-col items-center justify-center min-h-screen gap-4 text-center px-4">
      {status === "loading" && (
        <>
          <Loader2 className="w-10 h-10 animate-spin text-primary" />
          <p className="text-lg font-medium">Connecting your {productName} account...</p>
          <p className="text-sm text-muted-foreground">Please wait while we complete the connection.</p>
        </>
      )}
      {status === "success" && (
        <>
          <CheckCircle2 className="w-10 h-10 text-green-500" />
          <p className="text-lg font-medium">{productName} connected!</p>
          <p className="text-sm text-muted-foreground">Redirecting you back...</p>
        </>
      )}
      {status === "error" && (
        <>
          <XCircle className="w-10 h-10 text-destructive" />
          <p className="text-lg font-medium">Connection failed</p>
          <p className="text-sm text-muted-foreground">{errorMessage}</p>
          <p className="text-xs text-muted-foreground">Redirecting you back...</p>
        </>
      )}
    </div>
  );
}
