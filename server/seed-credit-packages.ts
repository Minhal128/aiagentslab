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
import { creditPackages } from "@shared/schema";

const CREDIT_PACKAGES_SEED_DATA = [
  {
    name: "Starter Pack",
    description: "100 credits - Perfect for testing and small campaigns",
    credits: 100,
    price: "9.99",
    razorpayPrice: "799.00",
    isActive: true,
  },
  {
    name: "Growth Pack",
    description: "500 credits - Best value for growing teams. Save 10%!",
    credits: 500,
    price: "44.99",
    razorpayPrice: "3599.00",
    isActive: true,
  },
  {
    name: "Business Pack",
    description: "1,000 credits - Ideal for regular campaigns. Save 15%!",
    credits: 1000,
    price: "84.99",
    razorpayPrice: "6799.00",
    isActive: true,
  },
  {
    name: "Professional Pack",
    description: "2,500 credits - For power users. Save 20%!",
    credits: 2500,
    price: "199.99",
    razorpayPrice: "15999.00",
    isActive: true,
  },
  {
    name: "Enterprise Pack",
    description: "5,000 credits - Maximum savings for high-volume needs. Save 25%!",
    credits: 5000,
    price: "374.99",
    razorpayPrice: "29999.00",
    isActive: true,
  },
  {
    name: "Mega Pack",
    description: "10,000 credits - Best value for enterprise. Save 30%!",
    credits: 10000,
    price: "699.99",
    razorpayPrice: "55999.00",
    isActive: true,
  },
];

async function seedCreditPackages() {
  try {
    console.log("🌱 Starting Credit Packages seed...");
    
    const existingPackages = await db.select().from(creditPackages);
    
    if (existingPackages.length > 0) {
      console.log(`⚠️  Found ${existingPackages.length} existing credit packages. Skipping seed to prevent duplicates.`);
      console.log("   To re-seed, first delete all credit packages from the database.");
      return;
    }

    console.log(`📦 Inserting ${CREDIT_PACKAGES_SEED_DATA.length} credit packages...`);
    await db.insert(creditPackages).values(CREDIT_PACKAGES_SEED_DATA);
    
    console.log("✅ Successfully seeded Credit Packages!");
    CREDIT_PACKAGES_SEED_DATA.forEach(pkg => {
      const pricePerCredit = (parseFloat(pkg.price) / pkg.credits).toFixed(4);
      console.log(`   - ${pkg.name}: ${pkg.credits} credits @ $${pkg.price} ($${pricePerCredit}/credit)`);
    });
    
  } catch (error) {
    console.error("❌ Error seeding Credit Packages:", error);
    throw error;
  }
}

export { seedCreditPackages, CREDIT_PACKAGES_SEED_DATA };
