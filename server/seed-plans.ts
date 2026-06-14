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
import { db } from "./db";
import { plans } from "@shared/schema";

const PLANS_SEED_DATA = [
  {
    name: "free",
    displayName: "Free",
    description: "Perfect for trying out AI calling. Get started with basic features at no cost.",
    monthlyPrice: "0.00",
    yearlyPrice: "0.00",
    razorpayMonthlyPrice: "0.00",
    razorpayYearlyPrice: "0.00",
    maxAgents: 2,
    maxCampaigns: 3,
    maxContactsPerCampaign: 10,
    maxWebhooks: 2,
    maxKnowledgeBases: 3,
    maxFlows: 2,
    maxPhoneNumbers: 0,
    includedCredits: 50,
    defaultLlmModel: "gpt-4o-mini",
    canChooseLlm: false,
    canPurchaseNumbers: false,
    useSystemPool: true,
    features: {
      basicAnalytics: true,
      callRecording: true,
      transcription: true,
      emailSupport: true,
      apiAccess: false,
      prioritySupport: false,
      customVoices: false,
      advancedAnalytics: false,
      whiteLabel: false,
      dedicatedManager: false,
    },
    isActive: true,
  },
  {
    name: "pro",
    displayName: "Pro",
    description: "For growing businesses. Unlock advanced features, more capacity, and premium support.",
    monthlyPrice: "49.00",
    yearlyPrice: "470.00",
    razorpayMonthlyPrice: "4000.00",
    razorpayYearlyPrice: "38000.00",
    maxAgents: 25,
    maxCampaigns: 50,
    maxContactsPerCampaign: 1000,
    maxWebhooks: 20,
    maxKnowledgeBases: 25,
    maxFlows: 25,
    maxPhoneNumbers: 10,
    includedCredits: 500,
    defaultLlmModel: null,
    canChooseLlm: true,
    canPurchaseNumbers: true,
    useSystemPool: false,
    features: {
      basicAnalytics: true,
      callRecording: true,
      transcription: true,
      emailSupport: true,
      apiAccess: true,
      prioritySupport: true,
      customVoices: true,
      advancedAnalytics: true,
      whiteLabel: false,
      dedicatedManager: false,
      batchCalling: true,
      webhookIntegration: true,
      ragKnowledgeBase: true,
      flowAutomation: true,
      multiLanguage: true,
    },
    isActive: true,
  },
];

async function seedPlans() {
  try {
    console.log("🌱 Starting Plans seed...");
    
    const existingPlans = await db.select().from(plans);
    
    if (existingPlans.length > 0) {
      console.log(`⚠️  Found ${existingPlans.length} existing plans. Skipping seed to prevent duplicates.`);
      console.log("   To re-seed, first delete all plans from the database.");
      return;
    }

    console.log(`📦 Inserting ${PLANS_SEED_DATA.length} subscription plans...`);
    await db.insert(plans).values(PLANS_SEED_DATA);
    
    console.log("✅ Successfully seeded Plans!");
    console.log(`   - Free plan: ${PLANS_SEED_DATA[0].includedCredits} credits included`);
    console.log(`   - Pro plan: $${PLANS_SEED_DATA[1].monthlyPrice}/month, ${PLANS_SEED_DATA[1].includedCredits} credits included`);
    
  } catch (error) {
    console.error("❌ Error seeding Plans:", error);
    throw error;
  }
}

export { seedPlans, PLANS_SEED_DATA };
