'use strict';
/**
 * CallInsightsService - AI-powered call transcript analysis
 * 
 * Uses OpenAI Chat Completions API to analyze call transcripts
 * and generate structured insights including sentiment, classification,
 * key points, and recommended next actions.
 */

import OpenAI from 'openai';
import { logger } from '../utils/logger';

export interface CallInsights {
  aiSummary: string;
  sentiment: 'positive' | 'neutral' | 'negative';
  classification: 'hot' | 'warm' | 'cold' | 'lost';
  keyPoints?: string[];
  nextActions?: string[];
}

export interface CallMetadata {
  callId: string;
  fromNumber?: string;
  toNumber?: string;
  agentName?: string;
  duration?: number;
}

const SYSTEM_PROMPT = `You are an AI call analyst. Analyze the following call transcript and provide structured insights.

Respond ONLY with valid JSON in this exact format:
{
  "aiSummary": "2-3 sentence summary of the call conversation and outcome",
  "sentiment": "positive" | "neutral" | "negative",
  "classification": "hot" | "warm" | "cold" | "lost",
  "keyPoints": ["key point 1", "key point 2"],
  "nextActions": ["recommended action 1", "recommended action 2"]
}

Classification guide:
- "hot": Caller showed strong interest, ready to buy/proceed
- "warm": Caller showed moderate interest, needs follow-up
- "cold": Caller showed little interest, unlikely to convert
- "lost": Caller explicitly declined or hung up early

Sentiment guide:
- "positive": Friendly tone, expressed satisfaction
- "neutral": Professional/matter-of-fact tone
- "negative": Frustrated, complained, or was hostile`;

export class CallInsightsService {
  private static openai: OpenAI | null = null;

  private static getOpenAIClient(apiKey?: string): OpenAI {
    // If a specific API key is provided, create a new client for it
    if (apiKey) {
      return new OpenAI({ apiKey });
    }
    
    // Otherwise use the cached client with env var
    if (!this.openai) {
      const envApiKey = process.env.OPENAI_API_KEY;
      if (!envApiKey) {
        throw new Error('OPENAI_API_KEY environment variable is not set');
      }
      this.openai = new OpenAI({ apiKey: envApiKey });
    }
    return this.openai;
  }

  static async analyzeTranscript(
    transcript: string,
    metadata: CallMetadata,
    apiKey?: string
  ): Promise<CallInsights | null> {
    const source = 'CallInsightsService';
    
    if (!transcript || transcript.trim().length === 0) {
      logger.warn('Empty transcript provided for analysis', { callId: metadata.callId }, source);
      return null;
    }

    try {
      const openai = this.getOpenAIClient(apiKey);
      
      const userMessage = this.buildUserMessage(transcript, metadata);
      
      logger.info(`Analyzing transcript for call ${metadata.callId}`, {
        transcriptLength: transcript.length,
        duration: metadata.duration
      }, source);

      const response = await openai.chat.completions.create({
        model: 'gpt-4o-mini',
        messages: [
          { role: 'system', content: SYSTEM_PROMPT },
          { role: 'user', content: userMessage }
        ],
        response_format: { type: 'json_object' },
        max_tokens: 500,
        temperature: 0.3
      });

      const content = response.choices[0]?.message?.content;
      
      if (!content) {
        logger.error('Empty response from OpenAI', { callId: metadata.callId }, source);
        return null;
      }

      const insights = JSON.parse(content) as CallInsights;
      
      if (!this.validateInsights(insights)) {
        logger.error('Invalid insights structure from OpenAI', { callId: metadata.callId, content }, source);
        return null;
      }

      logger.info(`Successfully analyzed call ${metadata.callId}`, {
        sentiment: insights.sentiment,
        classification: insights.classification
      }, source);

      return insights;

    } catch (error: any) {
      logger.error(`Failed to analyze transcript for call ${metadata.callId}`, {
        error: error.message,
        code: error.code
      }, source);
      return null;
    }
  }

  private static buildUserMessage(transcript: string, metadata: CallMetadata): string {
    let message = '';
    
    if (metadata.agentName) {
      message += `Agent: ${metadata.agentName}\n`;
    }
    if (metadata.fromNumber) {
      message += `Caller: ${metadata.fromNumber}\n`;
    }
    if (metadata.duration) {
      message += `Duration: ${Math.floor(metadata.duration / 60)}m ${metadata.duration % 60}s\n`;
    }
    if (message) {
      message += '\n';
    }
    
    message += `Transcript:\n${transcript}`;
    
    return message;
  }

  private static validateInsights(insights: any): insights is CallInsights {
    if (!insights || typeof insights !== 'object') {
      return false;
    }
    
    if (typeof insights.aiSummary !== 'string' || insights.aiSummary.length === 0) {
      return false;
    }
    
    const validSentiments = ['positive', 'neutral', 'negative'];
    if (!validSentiments.includes(insights.sentiment)) {
      return false;
    }
    
    const validClassifications = ['hot', 'warm', 'cold', 'lost'];
    if (!validClassifications.includes(insights.classification)) {
      return false;
    }
    
    if (insights.keyPoints !== undefined && !Array.isArray(insights.keyPoints)) {
      return false;
    }
    
    if (insights.nextActions !== undefined && !Array.isArray(insights.nextActions)) {
      return false;
    }
    
    return true;
  }
}
