/**
 * ============================================================
 * © 2025 Diploy — a brand of Bisht Technologies Private Limited
 * Original Author: BTPL Engineering Team
 * Website: https://diploy.in
 * Contact: cs@diploy.in
 *
 * Distributed under the Envato / CodeCanyon License Agreement.
 * Licensed to the purchaser for use as defined by the
 * Envato Market (CodeCanyon) Regular or Extended License.
 *
 * You are NOT permitted to redistribute, resell, sublicense,
 * or share this source code, in whole or in part.
 * Respect the author's rights and Envato licensing terms.
 * ============================================================
 */
import { QueryClient, QueryFunction } from "@tanstack/react-query";
import { AuthStorage } from "./auth-storage";

let isRefreshing = false;
let refreshPromise: Promise<boolean> | null = null;

async function refreshAccessToken(): Promise<boolean> {
  if (isRefreshing && refreshPromise) {
    return refreshPromise;
  }

  // Refresh token is sent automatically via HttpOnly cookie (credentials: 'include')
  // No need to check localStorage - the cookie will be there if user is authenticated

  isRefreshing = true;
  refreshPromise = (async () => {
    try {
      const response = await fetch('/api/auth/refresh', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include', // Sends HttpOnly refresh_token cookie automatically
      });

      if (!response.ok) {
        AuthStorage.clearAuth();
        return false;
      }

      const data = await response.json();
      AuthStorage.setToken(data.token);
      if (data.expiresIn) {
        AuthStorage.setTokenExpiry(data.expiresIn);
      }
      AuthStorage.updateLastActivity();
      return true;
    } catch (error) {
      console.error('[QueryClient] Token refresh failed:', error);
      AuthStorage.clearAuth();
      return false;
    } finally {
      isRefreshing = false;
      refreshPromise = null;
    }
  })();

  return refreshPromise;
}

async function ensureValidToken(): Promise<boolean> {
  if (!AuthStorage.isAuthenticated()) {
    return false;
  }

  if (AuthStorage.isSessionTimedOut()) {
    // Clear appropriate auth based on login type
    if (AuthStorage.isTeamMember()) {
      AuthStorage.clearTeamAuth();
    } else {
      AuthStorage.clearAuth();
    }
    return false;
  }

  // Team members use session tokens that don't need JWT refresh
  // Only regular users need JWT refresh
  if (AuthStorage.isTeamMember()) {
    AuthStorage.updateLastActivity();
    return true;
  }

  if (AuthStorage.isTokenExpired()) {
    const refreshed = await refreshAccessToken();
    return refreshed;
  }

  return true;
}

// Custom error class that preserves HTTP status and response data
export class ApiError extends Error {
  status: number;
  data: any;
  conflictType?: string;
  connectedAgentName?: string;
  campaignName?: string;
  campaignStatus?: string;
  
  constructor(message: string, status: number, data?: any) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.data = data;
    
    // Extract conflict-specific fields for easier access
    if (data) {
      this.conflictType = data.conflictType;
      this.connectedAgentName = data.connectedAgentName;
      this.campaignName = data.campaignName;
      this.campaignStatus = data.campaignStatus;
    }
  }
}

const HTTP_STATUS_MESSAGES: Record<number, string> = {
  400: 'Invalid request. Please check your input and try again.',
  401: 'Session expired. Please log in again.',
  403: 'You do not have permission to perform this action.',
  404: 'The requested resource was not found.',
  408: 'Request timed out. Please try again.',
  429: 'Too many requests. Please wait a moment and try again.',
  500: 'An unexpected server error occurred. Please try again later.',
  502: 'Server is temporarily unavailable. Please try again in a moment.',
  503: 'Service is temporarily unavailable. Please try again later.',
  504: 'Server took too long to respond. Please check your settings and try again.',
};

async function throwIfResNotOk(res: Response) {
  if (!res.ok) {
    const text = await res.text();
    let message = text || res.statusText;
    let data: any = null;
    
    // Try to parse JSON error response and extract the error message
    try {
      data = JSON.parse(text);
      message = data.error || data.message || text;
    } catch {
      if (text && (text.includes('<html') || text.includes('<!DOCTYPE') || text.includes('<HTML'))) {
        message = HTTP_STATUS_MESSAGES[res.status] || `Request failed (${res.status}). Please try again.`;
      }
    }
    
    // Throw ApiError with status and full response data
    throw new ApiError(message, res.status, data);
  }
}

export async function apiRequest(
  method: string,
  url: string,
  data?: unknown | undefined,
): Promise<Response> {
  await ensureValidToken();
  
  const headers: Record<string, string> = {};
  
  if (data) {
    headers["Content-Type"] = "application/json";
  }
  
  const authHeader = AuthStorage.getAuthHeader();
  if (authHeader) {
    headers["Authorization"] = authHeader;
  }

  let res = await fetch(url, {
    method,
    headers,
    body: data ? JSON.stringify(data) : undefined,
    credentials: "include",
  });

  // Try token refresh on 401 if user is authenticated (refresh token is in HttpOnly cookie)
  if (res.status === 401 && AuthStorage.isAuthenticated()) {
    const refreshed = await refreshAccessToken();
    if (refreshed) {
      const newAuthHeader = AuthStorage.getAuthHeader();
      if (newAuthHeader) {
        headers["Authorization"] = newAuthHeader;
      }
      res = await fetch(url, {
        method,
        headers,
        body: data ? JSON.stringify(data) : undefined,
        credentials: "include",
      });
    }
  }

  await throwIfResNotOk(res);
  return res;
}

type UnauthorizedBehavior = "returnNull" | "throw";
export const getQueryFn: <T>(options: {
  on401: UnauthorizedBehavior;
}) => QueryFunction<T> =
  ({ on401: unauthorizedBehavior }) =>
  async ({ queryKey }) => {
    await ensureValidToken();
    
    const headers: Record<string, string> = {};
    
    const authHeader = AuthStorage.getAuthHeader();
    if (authHeader) {
      headers["Authorization"] = authHeader;
    }

    let res = await fetch(queryKey.join("/") as string, {
      headers,
      credentials: "include",
    });

    // Try token refresh on 401 if user is authenticated (refresh token is in HttpOnly cookie)
    if (res.status === 401 && AuthStorage.isAuthenticated()) {
      const refreshed = await refreshAccessToken();
      if (refreshed) {
        const newAuthHeader = AuthStorage.getAuthHeader();
        if (newAuthHeader) {
          headers["Authorization"] = newAuthHeader;
        }
        res = await fetch(queryKey.join("/") as string, {
          headers,
          credentials: "include",
        });
      }
    }

    if (unauthorizedBehavior === "returnNull" && res.status === 401) {
      return null;
    }

    await throwIfResNotOk(res);
    return await res.json();
  };

export { refreshAccessToken, ensureValidToken };

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      queryFn: getQueryFn({ on401: "throw" }),
      refetchInterval: false,
      refetchOnWindowFocus: false,
      staleTime: Infinity,
      retry: false,
    },
    mutations: {
      retry: false,
    },
  },
});

// Expose queryClient on window for plugins to use the same cache instance
// This ensures plugins share the same React Query cache as the main app
if (typeof window !== 'undefined') {
  (window as any).queryClient = queryClient;
  (window as any).apiRequest = apiRequest;
  (window as any).getAuthHeader = () => AuthStorage.getAuthHeader();
}
