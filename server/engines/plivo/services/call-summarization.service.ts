'use strict';
/**
 * ============================================================
 * Call Summarization Service
 * 
 * Analyzes call transcripts using OpenAI to generate:
 * - Lead quality scoring (0-100)
 * - Sentiment analysis (positive/neutral/negative)
 * - Call summary
 * - Key points extracted
 * - Next actions/follow-ups
 * ============================================================
 */

import OpenAI from 'openai';
import { db } from '../../../db';
import { openaiCredentials, plivoCalls, agents } from '@shared/schema';
import { eq, and } from 'drizzle-orm';
import type { PlivoCallSentiment, CallRecordingSummary } from '../types';
import { AudioBridgeService } from './audio-bridge.service';
import { PlivoCallService } from './plivo-call.service';

interface TranscriptPart {
  role: 'user' | 'assistant';
  text: string;
  timestamp?: Date;
}

interface SummarizationResult {
  summary: string;
  leadQualityScore: number;
  leadClassification: 'hot' | 'warm' | 'cold' | 'lost';
  sentiment: PlivoCallSentiment;
  keyPoints: string[];
  nextActions: string[];
}

export class CallSummarizationService {
  /**
   * Summarize a call after it completes
   */
  static async summarizeCall(callId: string): Promise<CallRecordingSummary | null> {
    console.log(`[Call Summarization] Starting summarization for call ${callId}`);

    try {
      const [call] = await db
        .select()
        .from(plivoCalls)
        .where(eq(plivoCalls.id, callId))
        .limit(1);

      if (!call) {
        console.error(`[Call Summarization] Call not found: ${callId}`);
        return null;
      }

      if (call.status !== 'completed') {
        console.log(`[Call Summarization] Skipping - call status is ${call.status}`);
        return null;
      }

      let rawTranscript = '';

      if (call.transcript && call.transcript.length > 0) {
        rawTranscript = call.transcript;
      } else {
        const sessionData = call.plivoCallUuid 
          ? AudioBridgeService.getSession(call.plivoCallUuid)
          : undefined;
        if (sessionData && sessionData.transcriptParts.length > 0) {
          rawTranscript = sessionData.transcriptParts
            .map(p => `${p.role === 'user' ? 'Customer' : 'Agent'}: ${p.text}`)
            .join('\n');
        }
      }

      if (!rawTranscript || rawTranscript.length < 20) {
        console.log(`[Call Summarization] No transcript available for call ${callId}`);
        const defaultResult: CallRecordingSummary = {
          transcript: rawTranscript || 'No transcript available',
          summary: 'Call completed but no conversation transcript was captured.',
          leadQualityScore: 0,
          sentiment: 'neutral',
          keyPoints: [],
          nextActions: [],
        };
        await PlivoCallService.updateCallSummary(callId, {
          transcript: defaultResult.transcript,
          aiSummary: defaultResult.summary,
          leadQualityScore: defaultResult.leadQualityScore,
          sentiment: defaultResult.sentiment,
          keyPoints: defaultResult.keyPoints,
          nextActions: defaultResult.nextActions,
        });
        return defaultResult;
      }

      let apiKey = '';
      if (call.openaiCredentialId) {
        const [credential] = await db
          .select()
          .from(openaiCredentials)
          .where(eq(openaiCredentials.id, call.openaiCredentialId))
          .limit(1);
        if (credential?.apiKey) {
          apiKey = credential.apiKey;
        }
      }

      if (!apiKey) {
        const [anyCredential] = await db
          .select()
          .from(openaiCredentials)
          .where(eq(openaiCredentials.isActive, true))
          .limit(1);
        if (anyCredential?.apiKey) {
          apiKey = anyCredential.apiKey;
        }
      }

      if (!apiKey) {
        console.error(`[Call Summarization] No OpenAI API key available`);
        return null;
      }

      let agentContext = '';
      if (call.agentId) {
        const [agent] = await db
          .select()
          .from(agents)
          .where(eq(agents.id, call.agentId))
          .limit(1);
        if (agent) {
          agentContext = `Agent Purpose: ${agent.name}\n`;
          if (agent.systemPrompt) {
            const promptPreview = agent.systemPrompt.substring(0, 500);
            agentContext += `Agent Role: ${promptPreview}...\n`;
          }
        }
      }

      const result = await this.analyzeWithOpenAI(apiKey, rawTranscript, agentContext);

      await PlivoCallService.updateCallSummary(callId, {
        transcript: rawTranscript,
        aiSummary: result.summary,
        leadQualityScore: result.leadQualityScore,
        sentiment: result.sentiment,
        leadClassification: result.leadClassification,
        keyPoints: result.keyPoints,
        nextActions: result.nextActions,
      });

      console.log(`[Call Summarization] Completed for call ${callId}: Score ${result.leadQualityScore}, ${result.sentiment}`);

      return {
        transcript: rawTranscript,
        summary: result.summary,
        leadQualityScore: result.leadQualityScore,
        sentiment: result.sentiment,
        keyPoints: result.keyPoints,
        nextActions: result.nextActions,
      };

    } catch (error: any) {
      console.error(`[Call Summarization] Error for call ${callId}:`, error.message);
      return null;
    }
  }

  /**
   * Analyze transcript using OpenAI Chat Completions API
   */
  private static async analyzeWithOpenAI(
    apiKey: string,
    transcript: string,
    agentContext: string
  ): Promise<SummarizationResult> {
    const openai = new OpenAI({ apiKey });

    const systemPrompt = `You are an expert call analyst. Analyze the following call transcript and provide a comprehensive assessment.

${agentContext}

Provide your analysis in the following JSON format:
{
  "summary": "A 2-3 sentence summary of the call, including the main topic and outcome",
  "leadQualityScore": <number 0-100, where 100 is a hot qualified lead ready to buy, 50 is interested but not ready, 0 is not interested at all>,
  "leadClassification": "<hot|warm|cold|lost>",
  "sentiment": "<positive|neutral|negative>",
  "keyPoints": ["Key point 1", "Key point 2", ...],
  "nextActions": ["Recommended follow-up action 1", "Action 2", ...]
}

Scoring Guidelines:
- 80-100 (Hot): Expressed strong buying intent, agreed to purchase/meeting, provided contact info
- 60-79 (Warm): Showed interest, asked questions, but no commitment yet
- 30-59 (Cold): Minimal interest, skeptical, needs more nurturing
- 0-29 (Lost): Not interested, hung up early, wrong number, do-not-call

Sentiment Guidelines:
- Positive: Engaged, friendly, interested, satisfied
- Neutral: Professional but no strong emotion either way
- Negative: Frustrated, angry, dismissive, complained`;

    try {
      const response = await openai.chat.completions.create({
        model: 'gpt-4o-mini',
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: `Please analyze this call transcript:\n\n${transcript}` }
        ],
        response_format: { type: 'json_object' },
        temperature: 0.3,
        max_tokens: 1000,
      });

      const content = response.choices[0]?.message?.content;
      if (!content) {
        throw new Error('No response from OpenAI');
      }

      const analysis = JSON.parse(content);

      return {
        summary: analysis.summary || 'Unable to generate summary',
        leadQualityScore: Math.min(100, Math.max(0, Number(analysis.leadQualityScore) || 0)),
        leadClassification: analysis.leadClassification || 'cold',
        sentiment: this.normalizeSentiment(analysis.sentiment),
        keyPoints: Array.isArray(analysis.keyPoints) ? analysis.keyPoints : [],
        nextActions: Array.isArray(analysis.nextActions) ? analysis.nextActions : [],
      };

    } catch (error: any) {
      console.error(`[Call Summarization] OpenAI analysis failed:`, error.message);
      return {
        summary: 'Analysis failed - please review transcript manually',
        leadQualityScore: 0,
        leadClassification: 'cold',
        sentiment: 'neutral',
        keyPoints: [],
        nextActions: ['Review call transcript manually'],
      };
    }
  }

  /**
   * Normalize sentiment value to expected enum
   */
  private static normalizeSentiment(sentiment: string): PlivoCallSentiment {
    const normalized = (sentiment || '').toLowerCase();
    if (normalized === 'positive') return 'positive';
    if (normalized === 'negative') return 'negative';
    return 'neutral';
  }

  /**
   * Batch summarize multiple calls (for backfill or campaign summary)
   */
  static async summarizeCampaignCalls(campaignId: string): Promise<{
    processed: number;
    failed: number;
    averageScore: number;
  }> {
    console.log(`[Call Summarization] Starting batch summarization for campaign ${campaignId}`);

    const calls = await db
      .select()
      .from(plivoCalls)
      .where(
        and(
          eq(plivoCalls.campaignId, campaignId),
          eq(plivoCalls.status, 'completed')
        )
      );

    let processed = 0;
    let failed = 0;
    let totalScore = 0;

    for (const call of calls) {
      if (call.aiSummary) {
        if (call.leadQualityScore !== null) {
          totalScore += call.leadQualityScore;
          processed++;
        }
        continue;
      }

      const result = await this.summarizeCall(call.id);
      if (result) {
        totalScore += result.leadQualityScore;
        processed++;
      } else {
        failed++;
      }

      await new Promise(resolve => setTimeout(resolve, 500));
    }

    const averageScore = processed > 0 ? Math.round(totalScore / processed) : 0;

    console.log(`[Call Summarization] Campaign ${campaignId} complete: ${processed} processed, ${failed} failed, avg score ${averageScore}`);

    return { processed, failed, averageScore };
  }
}
