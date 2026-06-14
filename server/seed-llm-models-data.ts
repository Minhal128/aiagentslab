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

export const MODELS_SEED_DATA = [
  // Free Tier Models - Cheapest options for Free plan users
  {
    modelId: "gpt-4o-mini",
    name: "GPT-4o Mini (OpenAI)",
    provider: "openai",
    tier: "free",
    sortOrder: 1,
    isActive: true,
  },
  {
    modelId: "gpt-3.5-turbo",
    name: "GPT-3.5 Turbo (OpenAI)",
    provider: "openai",
    tier: "free",
    sortOrder: 2,
    isActive: true,
  },
  {
    modelId: "claude-3-haiku",
    name: "Claude 3 Haiku (Anthropic)",
    provider: "anthropic",
    tier: "free",
    sortOrder: 3,
    isActive: true,
  },
  {
    modelId: "gemini-2.5-flash-lite",
    name: "Gemini 2.5 Flash Lite (Google)",
    provider: "google",
    tier: "free",
    sortOrder: 4,
    isActive: true,
  },
  {
    modelId: "gemini-2.0-flash-lite",
    name: "Gemini 2.0 Flash Lite (Google)",
    provider: "google",
    tier: "free",
    sortOrder: 5,
    isActive: true,
  },
  {
    modelId: "glm-45-air-fp8",
    name: "GLM-4.5-Air (ElevenLabs)",
    provider: "elevenlabs",
    tier: "free",
    sortOrder: 6,
    isActive: true,
  },
  {
    modelId: "qwen3-30b-a3b",
    name: "Qwen3-30B-A3B (ElevenLabs)",
    provider: "elevenlabs",
    tier: "free",
    sortOrder: 7,
    isActive: true,
  },

  // Pro Tier Models - Premium options for Pro plan users
  {
    modelId: "gpt-4o",
    name: "GPT-4o (OpenAI)",
    provider: "openai",
    tier: "pro",
    sortOrder: 10,
    isActive: true,
  },
  {
    modelId: "gpt-4-turbo",
    name: "GPT-4 Turbo (OpenAI)",
    provider: "openai",
    tier: "pro",
    sortOrder: 11,
    isActive: true,
  },
  {
    modelId: "claude-3-5-sonnet",
    name: "Claude 3.5 Sonnet (Anthropic)",
    provider: "anthropic",
    tier: "pro",
    sortOrder: 12,
    isActive: true,
  },
  {
    modelId: "gemini-2.5-flash",
    name: "Gemini 2.5 Flash (Google)",
    provider: "google",
    tier: "pro",
    sortOrder: 13,
    isActive: true,
  },
  {
    modelId: "gemini-2.0-flash",
    name: "Gemini 2.0 Flash (Google)",
    provider: "google",
    tier: "pro",
    sortOrder: 14,
    isActive: true,
  },
  {
    modelId: "gpt-oss-120b",
    name: "GPT-OSS-120B (ElevenLabs)",
    provider: "elevenlabs",
    tier: "pro",
    sortOrder: 15,
    isActive: true,
  },
  // Note: scribe_v2_realtime was removed - it's a transcription model, not valid for ElevenLabs Conversational AI
];
