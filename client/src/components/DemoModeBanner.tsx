import { useQuery } from "@tanstack/react-query";
import { Monitor, X } from "lucide-react";
import { useState } from "react";

interface DemoModeStatus {
  enabled: boolean;
  message: string;
}

export function DemoModeBanner() {
  const [dismissed, setDismissed] = useState(false);

  const { data: status, isError } = useQuery<DemoModeStatus>({
    queryKey: ["/api/demo-mode/status"],
    staleTime: 5 * 60 * 1000,
    retry: false,
    refetchOnWindowFocus: false,
  });

  if (isError || !status?.enabled || dismissed) {
    return null;
  }

  return (
    <div 
      className="w-full bg-amber-500 dark:bg-amber-600 text-white px-4 py-2 flex items-center justify-center gap-3"
      data-testid="demo-mode-banner"
    >
      <Monitor className="h-4 w-4 shrink-0" />
      <span className="text-sm font-medium">
        Demo Mode Active - Admin save operations are disabled for security
      </span>
      <button
        onClick={() => setDismissed(true)}
        className="ml-2 p-1 hover:bg-amber-600 dark:hover:bg-amber-700 rounded transition-colors"
        aria-label="Dismiss banner"
        data-testid="button-dismiss-demo-banner"
      >
        <X className="h-4 w-4" />
      </button>
    </div>
  );
}

export function useDemoMode() {
  const { data, isError } = useQuery<DemoModeStatus>({
    queryKey: ["/api/demo-mode/status"],
    staleTime: 5 * 60 * 1000,
    retry: false,
    refetchOnWindowFocus: false,
  });

  return {
    isDemoMode: !isError && (data?.enabled ?? false),
    message: data?.message ?? "",
  };
}
