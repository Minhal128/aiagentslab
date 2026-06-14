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

import { DiployValidationError } from './errors';

export const diployValidate = {
  required<T>(value: T | null | undefined, fieldName: string): T {
    if (value === null || value === undefined || value === '') {
      throw new DiployValidationError(`${fieldName} is required`);
    }
    return value;
  },

  email(value: string): string {
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(value)) {
      throw new DiployValidationError('Invalid email format');
    }
    return value.toLowerCase().trim();
  },

  phone(value: string): string {
    const cleaned = value.replace(/\D/g, '');
    if (cleaned.length < 10 || cleaned.length > 15) {
      throw new DiployValidationError('Invalid phone number');
    }
    return cleaned.startsWith('+') ? value : `+${cleaned}`;
  },

  minLength(value: string, min: number, fieldName: string): string {
    if (value.length < min) {
      throw new DiployValidationError(`${fieldName} must be at least ${min} characters`);
    }
    return value;
  },

  maxLength(value: string, max: number, fieldName: string): string {
    if (value.length > max) {
      throw new DiployValidationError(`${fieldName} must be at most ${max} characters`);
    }
    return value;
  },

  positiveNumber(value: number, fieldName: string): number {
    if (typeof value !== 'number' || value <= 0) {
      throw new DiployValidationError(`${fieldName} must be a positive number`);
    }
    return value;
  },

  nonNegativeNumber(value: number, fieldName: string): number {
    if (typeof value !== 'number' || value < 0) {
      throw new DiployValidationError(`${fieldName} must be a non-negative number`);
    }
    return value;
  },

  uuid(value: string, fieldName: string = 'ID'): string {
    const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
    if (!uuidRegex.test(value)) {
      throw new DiployValidationError(`Invalid ${fieldName} format`);
    }
    return value;
  },

  inArray<T>(value: T, allowed: T[], fieldName: string): T {
    if (!allowed.includes(value)) {
      throw new DiployValidationError(`${fieldName} must be one of: ${allowed.join(', ')}`);
    }
    return value;
  },

  url(value: string): string {
    try {
      new URL(value);
      return value;
    } catch {
      throw new DiployValidationError('Invalid URL format');
    }
  },

  dateString(value: string, fieldName: string = 'Date'): Date {
    const date = new Date(value);
    if (isNaN(date.getTime())) {
      throw new DiployValidationError(`Invalid ${fieldName} format`);
    }
    return date;
  },

  isString(value: unknown): value is string {
    return typeof value === 'string';
  },

  isNumber(value: unknown): value is number {
    return typeof value === 'number' && !isNaN(value);
  },

  isObject(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
  },

  isArray(value: unknown): value is unknown[] {
    return Array.isArray(value);
  }
};
