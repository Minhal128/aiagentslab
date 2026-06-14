/**
 * ============================================================
 * Plugin Bootstrapper
 * 
 * Dynamically loads plugin frontend bundles at runtime.
 * Each plugin bundle self-registers its UI components via
 * the global plugin registry.
 * 
 * This component:
 * 1. Fetches enabled plugins from /api/plugins/capabilities
 * 2. Dynamically imports each plugin's frontend bundle
 * 3. Plugin bundles call window.__AGENTLABS_PLUGIN_REGISTRY__ to register
 * ============================================================
 */

import { useEffect, useState, useRef } from 'react';
import { usePluginRegistry, exposePluginRegistry } from '@/contexts/plugin-registry';
import { AuthStorage } from '@/lib/auth-storage';

interface PluginCapabilities {
  capabilities: Record<string, boolean>;
  pluginBundles?: Record<string, string>;
  sipEngine: boolean;
  sipEnginesAllowed: string[];
  maxConcurrentSipCalls: number;
  restApi: boolean;
  teamManagement: boolean;
}

interface LoadingState {
  loading: boolean;
  loaded: string[];
  failed: string[];
  errors: Record<string, string>;
}

export function PluginBootstrapper({ children }: { children: React.ReactNode }) {
  const registry = usePluginRegistry();
  const [state, setState] = useState<LoadingState>({
    loading: false,
    loaded: [],
    failed: [],
    errors: {},
  });
  const hasLoadedOnceRef = useRef(false);
  const intervalRef = useRef<number | undefined>(undefined);
  const retryCountRef = useRef(0);
  const isFetchingRef = useRef(false); // Prevent concurrent requests
  const MAX_RETRIES = 15; // Allow up to 30 seconds for auth to complete

  useEffect(() => {
    exposePluginRegistry(registry);
  }, [registry]);

  // Track auth state to reset when user logs in
  const lastAuthStateRef = useRef(AuthStorage.isAuthenticated());

  useEffect(() => {
    let mounted = true;
    
    async function loadPlugins() {
      if (!mounted) return;
      
      // Prevent concurrent requests
      if (isFetchingRef.current) return;
      
      const isAuthenticated = AuthStorage.isAuthenticated();
      
      // Reset refs if auth state changed from false to true (user just logged in)
      if (isAuthenticated && !lastAuthStateRef.current) {
        hasLoadedOnceRef.current = false;
        retryCountRef.current = 0;
      }
      lastAuthStateRef.current = isAuthenticated;
      
      if (!isAuthenticated) {
        return;
      }
      
      if (hasLoadedOnceRef.current) {
        // Already loaded, clear interval
        if (intervalRef.current) {
          clearInterval(intervalRef.current);
          intervalRef.current = undefined;
        }
        return;
      }
      
      isFetchingRef.current = true;
      setState(prev => ({ ...prev, loading: true }));
      
      try {
        const headers: Record<string, string> = {};
        const authHeader = AuthStorage.getAuthHeader();
        if (authHeader) {
          headers['Authorization'] = authHeader;
        }
        
        const response = await fetch('/api/plugins/capabilities', {
          headers,
          credentials: 'include',
        });
        
        if (!response.ok) {
          setState(prev => ({ ...prev, loading: false }));
          isFetchingRef.current = false;
          retryCountRef.current++;
          
          // Stop polling after max retries (auth might not complete)
          if (retryCountRef.current >= MAX_RETRIES) {
            hasLoadedOnceRef.current = true;
            if (intervalRef.current) {
              clearInterval(intervalRef.current);
              intervalRef.current = undefined;
            }
          }
          return;
        }

        const data = await response.json();
        const capabilities: PluginCapabilities = data.data;
        const bundles = capabilities.pluginBundles || {};

        console.log('[PluginBootstrapper] Capabilities received:', {
          capabilities: Object.keys(capabilities.capabilities || {}),
          bundles: Object.keys(bundles),
        });

        const loadPromises: Promise<void>[] = [];
        const loadedPlugins: string[] = [];
        const failedPlugins: string[] = [];
        const errors: Record<string, string> = {};

        for (const [pluginName, bundleUrl] of Object.entries(bundles)) {
          if (!capabilities.capabilities[pluginName]) {
            console.log(`[PluginBootstrapper] Skipping ${pluginName} - not in capabilities`);
            continue;
          }

          console.log(`[PluginBootstrapper] Loading bundle for ${pluginName}: ${bundleUrl}`);

          // Use fetch + Function to execute bundle content directly
          // This bypasses any Vite middleware transformation that might occur with script src
          const loadPromise = (async () => {
            try {
              // Verify React globals are available before loading plugins
              if (typeof (window as any).React === 'undefined') {
                throw new Error('window.React is not available. Plugin bundles require React to be exposed globally.');
              }
              if (typeof (window as any).ReactDOM === 'undefined') {
                throw new Error('window.ReactDOM is not available. Plugin bundles require ReactDOM to be exposed globally.');
              }
              
              const bundleResponse = await fetch(bundleUrl, {
                credentials: 'include',
              });
              
              if (!bundleResponse.ok) {
                throw new Error(`Failed to fetch bundle: ${bundleResponse.status}`);
              }
              
              const bundleCode = await bundleResponse.text();
              
              // Log first 200 chars to verify content
              console.log(`[PluginBootstrapper] Bundle content preview for ${pluginName}:`, bundleCode.substring(0, 200));
              
              // Execute the bundle code using Function constructor
              // This is safer than eval() and works for IIFE bundles
              try {
                const executeBundle = new Function(bundleCode);
                executeBundle();
                
                loadedPlugins.push(pluginName);
                registry.markPluginLoaded(pluginName);
                console.log(`[PluginBootstrapper] Loaded plugin: ${pluginName}`);
              } catch (execError: any) {
                console.error(`[PluginBootstrapper] Bundle execution error for ${pluginName}:`, execError?.message || execError?.toString?.() || execError);
                console.error(`[PluginBootstrapper] Stack:`, execError?.stack);
                failedPlugins.push(pluginName);
                errors[pluginName] = execError.message || 'Execution error';
              }
            } catch (fetchError: any) {
              console.error(`[PluginBootstrapper] Failed to fetch plugin ${pluginName}:`, fetchError);
              failedPlugins.push(pluginName);
              errors[pluginName] = fetchError.message || 'Failed to fetch';
            }
          })();

          loadPromises.push(loadPromise);
        }

        await Promise.allSettled(loadPromises);

        setState({
          loading: false,
          loaded: loadedPlugins,
          failed: failedPlugins,
          errors,
        });
        
        // Mark as loaded and clear interval
        hasLoadedOnceRef.current = true;
        isFetchingRef.current = false;
        if (intervalRef.current) {
          clearInterval(intervalRef.current);
          intervalRef.current = undefined;
        }
        
        console.log('[PluginBootstrapper] Plugin loading complete:', {
          loaded: loadedPlugins,
          failed: failedPlugins,
        });

      } catch (err: any) {
        console.error('[PluginBootstrapper] Error loading plugins:', err);
        isFetchingRef.current = false;
        setState(prev => ({ ...prev, loading: false }));
      }
    }
    
    // Initial load
    loadPlugins();
    
    // Poll until loaded
    intervalRef.current = window.setInterval(loadPlugins, 2000);
    
    return () => {
      mounted = false;
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
        intervalRef.current = undefined;
      }
    };
  }, [registry]);

  return <>{children}</>;
}

export function usePluginLoadingState() {
  const registry = usePluginRegistry();
  return {
    isPluginLoaded: registry.isPluginLoaded,
  };
}
