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
import { useEffect, useRef } from "react";
import { useQuery } from "@tanstack/react-query";
import { useLocation } from "wouter";
import type { AnalyticsScript } from "@shared/schema";

interface AnalyticsScriptsProps {
  placement?: "head" | "body" | "all";
}

// Check if a given path is an internal page (admin or user dashboard)
function isInternalPath(path: string): boolean {
  return path.startsWith('/admin') || path.startsWith('/app');
}

// Storage key for persisting hidden script IDs across sessions
const HIDDEN_SCRIPTS_STORAGE_KEY = 'agentlabs_hidden_analytics_scripts';

// Known widget container selectors that scripts may create
const WIDGET_CONTAINER_SELECTORS = [
  '#vw-container',       // Voice widget container
  '#vw-widget',          // Voice widget element
  '[id^="agentlabs-"]',  // Any AgentLabs prefixed elements
];

// Load hidden script IDs from localStorage (runs synchronously on module load)
function loadHiddenScriptIds(): Set<string> {
  try {
    const stored = localStorage.getItem(HIDDEN_SCRIPTS_STORAGE_KEY);
    if (stored) {
      return new Set(JSON.parse(stored));
    }
  } catch (e) {
    // Ignore storage errors
  }
  return new Set();
}

// Save hidden script IDs to localStorage
function saveHiddenScriptIds(ids: Set<string>): void {
  try {
    localStorage.setItem(HIDDEN_SCRIPTS_STORAGE_KEY, JSON.stringify(Array.from(ids)));
  } catch (e) {
    // Ignore storage errors
  }
}

// Global cache initialized from localStorage for immediate access
const hiddenScriptIdsCache = loadHiddenScriptIds();

// Helper to remove all DOM elements with a specific analytics script ID
function removeAnalyticsElements(scriptId: string): void {
  const elements = document.querySelectorAll(`[data-analytics-id="${scriptId}"]`);
  elements.forEach(el => {
    try {
      el.remove();
    } catch (e) {
      // Ignore removal errors
    }
  });
}

// Helper to remove all known widget containers from the DOM
function removeWidgetContainers(): void {
  WIDGET_CONTAINER_SELECTORS.forEach(selector => {
    try {
      const elements = document.querySelectorAll(selector);
      elements.forEach(el => {
        try {
          el.remove();
        } catch (e) {
          // Ignore removal errors
        }
      });
    } catch (e) {
      // Ignore selector errors
    }
  });
}

// Immediate cleanup function - runs synchronously to remove hidden widgets on internal pages
function performImmediateCleanup(path: string): void {
  if (!isInternalPath(path)) return;
  
  // ALWAYS remove known widget containers on internal pages
  // These widgets should never appear on admin/user dashboards regardless of cache state
  removeWidgetContainers();
  
  // Also remove analytics elements for any cached hidden scripts
  if (hiddenScriptIdsCache.size > 0) {
    hiddenScriptIdsCache.forEach(scriptId => {
      removeAnalyticsElements(scriptId);
    });
  }
}

export function AnalyticsScripts({ placement = "all" }: AnalyticsScriptsProps) {
  const [location] = useLocation();
  const injectedScriptsRef = useRef<Set<string>>(new Set());
  const cleanupFunctionsRef = useRef<Map<string, () => void>>(new Map());
  const lastLocationRef = useRef<string>(location);

  const { data: scripts } = useQuery<AnalyticsScript[]>({
    queryKey: ["/api/public/analytics-scripts"],
    staleTime: 0,
    refetchOnMount: true,
    refetchOnWindowFocus: true,
  });

  // CRITICAL: On mount/location change, immediately clean up hidden script elements
  // This uses the cache loaded from localStorage, so it works even before the API query resolves
  useEffect(() => {
    performImmediateCleanup(location);
  }, [location]);

  // Update the hidden scripts cache when scripts data loads and persist to localStorage
  useEffect(() => {
    if (!scripts) return;
    
    // Update cache with scripts that should be hidden
    let cacheChanged = false;
    scripts.forEach(script => {
      if (script.hideOnInternalPages) {
        if (!hiddenScriptIdsCache.has(script.id)) {
          hiddenScriptIdsCache.add(script.id);
          cacheChanged = true;
        }
      } else {
        if (hiddenScriptIdsCache.has(script.id)) {
          hiddenScriptIdsCache.delete(script.id);
          cacheChanged = true;
        }
      }
    });
    
    // Persist to localStorage for future page loads
    if (cacheChanged) {
      saveHiddenScriptIds(hiddenScriptIdsCache);
    }
    
    // If on internal page, ALWAYS remove widget containers AND hidden script elements
    const onInternalPage = isInternalPath(location);
    if (onInternalPage) {
      // Always remove known widget containers on internal pages first
      removeWidgetContainers();
      
      // Then remove hidden script elements
      scripts.forEach(script => {
        if (script.hideOnInternalPages) {
          removeAnalyticsElements(script.id);
          // Also run stored cleanup functions
          cleanupFunctionsRef.current.forEach((cleanup, key) => {
            if (key.startsWith(script.id)) {
              cleanup();
              cleanupFunctionsRef.current.delete(key);
            }
          });
          // Clear from injected set
          injectedScriptsRef.current.forEach(key => {
            if (key.startsWith(script.id)) {
              injectedScriptsRef.current.delete(key);
            }
          });
        }
      });
    }
  }, [scripts, location]);

  // Cleanup scripts when navigating to/from internal pages
  useEffect(() => {
    const wasInternal = isInternalPath(lastLocationRef.current);
    const isNowInternal = isInternalPath(location);
    
    // If we're navigating to/from internal pages, clear all scripts to reinject correctly
    if (wasInternal !== isNowInternal) {
      cleanupFunctionsRef.current.forEach((cleanup) => {
        cleanup();
      });
      cleanupFunctionsRef.current.clear();
      injectedScriptsRef.current.clear();
      
      // When entering internal pages, ALWAYS remove widget containers and hidden elements
      if (isNowInternal) {
        // Always remove known widget containers on internal pages
        removeWidgetContainers();
        // Also remove elements for cached hidden scripts
        hiddenScriptIdsCache.forEach(scriptId => {
          removeAnalyticsElements(scriptId);
        });
      }
    }
    
    lastLocationRef.current = location;
  }, [location]);

  useEffect(() => {
    if (!scripts || scripts.length === 0) {
      return;
    }

    // Filter out scripts that should be hidden on internal pages
    const onInternalPage = isInternalPath(location);
    const scopedScripts = scripts.filter(s => {
      if (s.hideOnInternalPages && onInternalPage) {
        return false;
      }
      return true;
    });

    const filteredScripts = placement === "all" 
      ? scopedScripts 
      : scopedScripts.filter(s => {
          const placements = Array.isArray(s.placement) ? s.placement : [s.placement];
          return placements.includes(placement);
        });

    const sortedScripts = [...filteredScripts].sort((a, b) => b.loadPriority - a.loadPriority);

    sortedScripts.forEach((script) => {
      const scriptKey = `${script.id}-${script.updatedAt || 'init'}`;
      
      if (injectedScriptsRef.current.has(scriptKey)) {
        return;
      }

      const oldCleanup = cleanupFunctionsRef.current.get(script.id);
      if (oldCleanup) {
        oldCleanup();
        cleanupFunctionsRef.current.delete(script.id);
      }

      const placements = Array.isArray(script.placement) ? script.placement : [script.placement];
      
      if (placement === "all") {
        placements.forEach(p => {
          const cleanup = injectScript(script, p as "head" | "body");
          if (cleanup) {
            const existingCleanup = cleanupFunctionsRef.current.get(`${script.id}-${p}`);
            if (existingCleanup) {
              const combinedCleanup = () => {
                existingCleanup();
                cleanup();
              };
              cleanupFunctionsRef.current.set(`${script.id}-${p}`, combinedCleanup);
            } else {
              cleanupFunctionsRef.current.set(`${script.id}-${p}`, cleanup);
            }
          }
        });
      } else if (placements.includes(placement)) {
        const cleanup = injectScript(script, placement);
        if (cleanup) {
          cleanupFunctionsRef.current.set(`${script.id}-${placement}`, cleanup);
        }
      }
      
      injectedScriptsRef.current.add(scriptKey);
    });

    return () => {
      cleanupFunctionsRef.current.forEach((cleanup) => {
        cleanup();
      });
      cleanupFunctionsRef.current.clear();
      injectedScriptsRef.current.clear();
    };
  }, [scripts, placement, location]);

  return null;
}

function injectScript(script: AnalyticsScript, targetPlacement: "head" | "body"): (() => void) | null {
  const targetElement = targetPlacement === "head" ? document.head : document.body;
  const insertedElements: Element[] = [];
  
  const scriptPlacements = Array.isArray(script.placement) ? script.placement : [script.placement];
  const isDualPlacement = scriptPlacements.includes("head") && scriptPlacements.includes("body");

  const headCode = ((script as any).headCode || '').trim();
  const bodyCode = ((script as any).bodyCode || '').trim();
  const legacyCode = (script.code || '').trim();
  const hasNewFields = headCode || bodyCode;
  
  let codeToInject: string;
  let usingNewFields = false;
  if (hasNewFields) {
    codeToInject = targetPlacement === "head" ? headCode : bodyCode;
    usingNewFields = true;
  } else if (legacyCode) {
    codeToInject = legacyCode;
  } else {
    return null;
  }
  
  if (!codeToInject) {
    return null;
  }

  try {
    // Parse the operator-authored snippet inside an inert document via
    // DOMParser so no <script> executes at parse time and no resource
    // (img/iframe) is fetched while we walk the tree. We then rebuild
    // each allowed tag with createElement + setAttribute / textContent
    // before attaching it to the live document. (Task #193 hardening.)
    const parsed = new DOMParser().parseFromString(
      `<!doctype html><html><head></head><body>${codeToInject}</body></html>`,
      "text/html",
    );
    const elements = Array.from(parsed.body.children);

    elements.forEach((element) => {
      const tagName = element.tagName.toLowerCase();
      
      if (tagName === "script") {
        if (!usingNewFields && isDualPlacement && targetPlacement !== "head") {
          return;
        }
        const newScript = document.createElement("script");
        
        Array.from(element.attributes).forEach((attr) => {
          newScript.setAttribute(attr.name, attr.value);
        });

        if (script.async) {
          newScript.async = true;
        }
        if (script.defer) {
          newScript.defer = true;
        }

        newScript.setAttribute("data-analytics-id", script.id);
        newScript.setAttribute("data-analytics-name", script.name);
        newScript.setAttribute("data-analytics-placement", targetPlacement);

        if (element.textContent) {
          newScript.textContent = element.textContent;
        }

        targetElement.appendChild(newScript);
        insertedElements.push(newScript);
      } else if (tagName === "noscript") {
        if (!usingNewFields && isDualPlacement && targetPlacement !== "body") {
          return;
        }
        const newNoscript = document.createElement("noscript");
        Array.from(element.attributes).forEach((attr) => {
          newNoscript.setAttribute(attr.name, attr.value);
        });
        Array.from(element.childNodes).forEach((child) => {
          newNoscript.appendChild(child.cloneNode(true));
        });
        newNoscript.setAttribute("data-analytics-id", script.id);
        newNoscript.setAttribute("data-analytics-placement", targetPlacement);
        document.body.appendChild(newNoscript);
        insertedElements.push(newNoscript);
      } else if (tagName === "link" || tagName === "style" || tagName === "meta") {
        if (!usingNewFields && isDualPlacement && targetPlacement !== "head") {
          return;
        }
        if (tagName === "link") {
          const newLink = document.createElement("link");
          Array.from(element.attributes).forEach((attr) => {
            newLink.setAttribute(attr.name, attr.value);
          });
          newLink.setAttribute("data-analytics-id", script.id);
          newLink.setAttribute("data-analytics-placement", targetPlacement);
          targetElement.appendChild(newLink);
          insertedElements.push(newLink);
        } else if (tagName === "style") {
          const newStyle = document.createElement("style");
          newStyle.textContent = element.textContent;
          newStyle.setAttribute("data-analytics-id", script.id);
          newStyle.setAttribute("data-analytics-placement", targetPlacement);
          targetElement.appendChild(newStyle);
          insertedElements.push(newStyle);
        } else {
          const newMeta = document.createElement("meta");
          Array.from(element.attributes).forEach((attr) => {
            newMeta.setAttribute(attr.name, attr.value);
          });
          newMeta.setAttribute("data-analytics-id", script.id);
          newMeta.setAttribute("data-analytics-placement", targetPlacement);
          targetElement.appendChild(newMeta);
          insertedElements.push(newMeta);
        }
      } else {
        // Strict allowlist: only <script>, <noscript>, <link>, <style>,
        // <meta> may be injected by an analytics tag. Anything else
        // authored by a super-admin in the analytics editor (e.g.
        // <iframe>, <img>, raw <div>) is dropped on the floor rather
        // than cloned into the live document. This is the XSS hardening
        // requested by Task #193.
        console.warn(
          `[AnalyticsScripts] Dropping disallowed tag <${tagName}> from "${script.name}"`,
        );
      }
    });

    const rawScriptMatch = codeToInject.match(/<script[^>]*>([\s\S]*?)<\/script>/gi);
    if (!rawScriptMatch && codeToInject.trim() && !codeToInject.includes("<")) {
      if (usingNewFields || !isDualPlacement || targetPlacement === "head") {
        const rawScript = document.createElement("script");
        rawScript.textContent = codeToInject;
        if (script.async) {
          rawScript.async = true;
        }
        if (script.defer) {
          rawScript.defer = true;
        }
        rawScript.setAttribute("data-analytics-id", script.id);
        rawScript.setAttribute("data-analytics-name", script.name);
        rawScript.setAttribute("data-analytics-placement", targetPlacement);
        targetElement.appendChild(rawScript);
        insertedElements.push(rawScript);
      }
    }

    return () => {
      insertedElements.forEach((el) => {
        try {
          el.remove();
        } catch (e) {
        }
      });
    };
  } catch (error) {
    console.error(`Failed to inject analytics script "${script.name}":`, error);
    return null;
  }
}

export default AnalyticsScripts;
