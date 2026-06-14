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
import * as React from "react";
import * as ReactDOM from "react-dom";
import { createRoot } from "react-dom/client";
import * as TanStackReactQuery from "@tanstack/react-query";
import * as ReactI18next from "react-i18next";
import App from "./App";
import "./index.css";
import './i18n';

// Expose React globally for plugin bundles
(window as any).React = React;
(window as any).ReactDOM = ReactDOM;

// Expose TanStack Query globally for plugin bundles
(window as any).TanStackReactQuery = TanStackReactQuery;

// Expose react-i18next globally for plugin bundles
// This allows plugins to share the host app's i18n instance and translations
(window as any).__AGENTLABS_REACT_I18NEXT__ = ReactI18next;

createRoot(document.getElementById("root")!).render(<App />);
