'use strict';
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

/**
 * Re-export invoice service from the centralized payment engine.
 * This ensures a single source of truth for invoice generation.
 */
export { 
  InvoiceService, 
  invoiceService, 
  generateInvoiceForTransaction,
  type LineItem,
  type CompanyInfo
} from '../engines/payment/invoice-service';
