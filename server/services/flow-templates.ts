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
// Predefined flow templates that users can clone
// Each template has proper node structure with data.type, data.label, and data.config

export const flowTemplates = [
  // ============================================
  // Template 1: Lead Qualification
  // ============================================
  {
    id: "template-lead-qualification",
    name: "Lead Qualification",
    description: "Qualify leads by asking about budget, timeline, and decision-making authority. Automatically routes qualified leads for follow-up.",
    isTemplate: true,
    nodes: [
      {
        id: "node-greeting",
        type: "message",
        position: { x: 250, y: 50 },
        data: {
          type: "message",
          label: "Greeting",
          config: {
            type: "message",
            message: "Hi! I'm calling to learn more about your business needs and see if our solutions might be a good fit. This will only take a few minutes. Is now a good time?",
            waitForResponse: true,
          },
        },
      },
      {
        id: "node-ask-company",
        type: "question",
        position: { x: 250, y: 170 },
        data: {
          type: "question",
          label: "Company Name",
          config: {
            type: "question",
            question: "Great! To get started, could you tell me the name of your company?",
            variableName: "company_name",
            waitForResponse: true,
          },
        },
      },
      {
        id: "node-ask-role",
        type: "question",
        position: { x: 250, y: 290 },
        data: {
          type: "question",
          label: "Role/Position",
          config: {
            type: "question",
            question: "And what's your role at the company?",
            variableName: "contact_role",
            waitForResponse: true,
          },
        },
      },
      {
        id: "node-ask-budget",
        type: "question",
        position: { x: 250, y: 410 },
        data: {
          type: "question",
          label: "Budget Range",
          config: {
            type: "question",
            question: "What's your approximate budget for this type of solution? Just a ballpark figure is fine.",
            variableName: "budget_range",
            waitForResponse: true,
          },
        },
      },
      {
        id: "node-ask-timeline",
        type: "question",
        position: { x: 250, y: 530 },
        data: {
          type: "question",
          label: "Timeline",
          config: {
            type: "question",
            question: "When are you looking to implement a solution - in the next month, quarter, or is this for future planning?",
            variableName: "timeline",
            waitForResponse: true,
          },
        },
      },
      {
        id: "node-ask-authority",
        type: "question",
        position: { x: 250, y: 650 },
        data: {
          type: "question",
          label: "Decision Authority",
          config: {
            type: "question",
            question: "Are you the primary decision-maker for this purchase, or will others be involved in the decision?",
            variableName: "decision_authority",
            waitForResponse: true,
          },
        },
      },
      {
        id: "node-check-qualified",
        type: "condition",
        position: { x: 250, y: 770 },
        data: {
          type: "condition",
          label: "Check Qualification",
          config: {
            type: "condition",
            condition: "The lead has a budget above $5000 and timeline within 3 months",
          },
        },
      },
      {
        id: "node-qualified-webhook",
        type: "webhook",
        position: { x: 450, y: 890 },
        data: {
          type: "webhook",
          label: "Send to CRM",
          config: {
            type: "webhook",
            url: "https://your-crm-api.com/leads",
            method: "POST",
            headers: { "Content-Type": "application/json" },
            payload: { status: "qualified", priority: "high" },
            description: "Send qualified lead to CRM for immediate follow-up",
          },
        },
      },
      {
        id: "node-qualified-end",
        type: "end",
        position: { x: 450, y: 1010 },
        data: {
          type: "end",
          label: "Qualified Goodbye",
          config: {
            type: "end",
            endMessage: "Wonderful! Based on what you've shared, I think we have some great options for you. Our sales team will reach out within 24 hours to schedule a detailed demo. Thank you for your time!",
          },
        },
      },
      {
        id: "node-nurture-webhook",
        type: "webhook",
        position: { x: 50, y: 890 },
        data: {
          type: "webhook",
          label: "Add to Nurture",
          config: {
            type: "webhook",
            url: "https://your-crm-api.com/leads",
            method: "POST",
            headers: { "Content-Type": "application/json" },
            payload: { status: "nurture", priority: "normal" },
            description: "Add lead to nurture campaign for future follow-up",
          },
        },
      },
      {
        id: "node-nurture-end",
        type: "end",
        position: { x: 50, y: 1010 },
        data: {
          type: "end",
          label: "Nurture Goodbye",
          config: {
            type: "end",
            endMessage: "Thank you for your time today. We'll keep you on our list and reach out when we have updates that might interest you. Have a great day!",
          },
        },
      },
    ],
    edges: [
      { id: "e1", source: "node-greeting", target: "node-ask-company" },
      { id: "e2", source: "node-ask-company", target: "node-ask-role" },
      { id: "e3", source: "node-ask-role", target: "node-ask-budget" },
      { id: "e4", source: "node-ask-budget", target: "node-ask-timeline" },
      { id: "e5", source: "node-ask-timeline", target: "node-ask-authority" },
      { id: "e6", source: "node-ask-authority", target: "node-check-qualified" },
      { id: "e7", source: "node-check-qualified", sourceHandle: "true", target: "node-qualified-webhook" },
      { id: "e8", source: "node-check-qualified", sourceHandle: "false", target: "node-nurture-webhook" },
      { id: "e9", source: "node-qualified-webhook", target: "node-qualified-end" },
      { id: "e10", source: "node-nurture-webhook", target: "node-nurture-end" },
    ],
  },

  // ============================================
  // Template 2: Appointment Booking
  // ============================================
  {
    id: "template-appointment-booking",
    name: "Appointment Booking",
    description: "Schedule appointments with service selection, date/time collection, and automatic confirmation. Perfect for service businesses.",
    isTemplate: true,
    nodes: [
      {
        id: "node-greeting",
        type: "message",
        position: { x: 250, y: 50 },
        data: {
          type: "message",
          label: "Welcome",
          config: {
            type: "message",
            message: "Hi! Thank you for calling. I'd be happy to help you schedule an appointment. Let me collect a few details to find the best time for you.",
            waitForResponse: false,
          },
        },
      },
      {
        id: "node-ask-name",
        type: "question",
        position: { x: 250, y: 170 },
        data: {
          type: "question",
          label: "Full Name",
          config: {
            type: "question",
            question: "May I have your full name please?",
            variableName: "full_name",
            waitForResponse: true,
          },
        },
      },
      {
        id: "node-ask-phone",
        type: "question",
        position: { x: 250, y: 290 },
        data: {
          type: "question",
          label: "Phone Number",
          config: {
            type: "question",
            question: "And what's the best phone number to reach you?",
            variableName: "phone_number",
            waitForResponse: true,
          },
        },
      },
      {
        id: "node-ask-service",
        type: "question",
        position: { x: 250, y: 410 },
        data: {
          type: "question",
          label: "Service Type",
          config: {
            type: "question",
            question: "Which service are you interested in? We offer Consultation, Demo, Technical Support, or Training sessions.",
            variableName: "service_type",
            waitForResponse: true,
          },
        },
      },
      {
        id: "node-book-appointment",
        type: "appointment",
        position: { x: 250, y: 530 },
        data: {
          type: "appointment",
          label: "Book Appointment",
          config: {
            type: "appointment",
            appointmentType: "General Appointment",
            waitForResponse: true,
          },
        },
      },
      {
        id: "node-confirm",
        type: "message",
        position: { x: 250, y: 650 },
        data: {
          type: "message",
          label: "Confirmation",
          config: {
            type: "message",
            message: "Perfect! Your appointment has been confirmed. You'll receive a confirmation email and SMS reminder before your appointment.",
            waitForResponse: false,
          },
        },
      },
      {
        id: "node-webhook-notify",
        type: "webhook",
        position: { x: 250, y: 770 },
        data: {
          type: "webhook",
          label: "Notify Team",
          config: {
            type: "webhook",
            url: "https://your-calendar-api.com/appointments",
            method: "POST",
            headers: { "Content-Type": "application/json" },
            payload: { event: "appointment_booked" },
            description: "Notify team about new appointment",
          },
        },
      },
      {
        id: "node-end",
        type: "end",
        position: { x: 250, y: 890 },
        data: {
          type: "end",
          label: "Goodbye",
          config: {
            type: "end",
            endMessage: "Thank you for scheduling with us! We look forward to seeing you. Is there anything else I can help you with today? If not, have a wonderful day!",
          },
        },
      },
    ],
    edges: [
      { id: "e1", source: "node-greeting", target: "node-ask-name" },
      { id: "e2", source: "node-ask-name", target: "node-ask-phone" },
      { id: "e3", source: "node-ask-phone", target: "node-ask-service" },
      { id: "e4", source: "node-ask-service", target: "node-book-appointment" },
      { id: "e5", source: "node-book-appointment", target: "node-confirm" },
      { id: "e6", source: "node-confirm", target: "node-webhook-notify" },
      { id: "e7", source: "node-webhook-notify", target: "node-end" },
    ],
  },

  // ============================================
  // Template 3: Customer Satisfaction Survey (NPS)
  // ============================================
  {
    id: "template-nps-survey",
    name: "Customer Satisfaction Survey (NPS)",
    description: "Collect Net Promoter Score and detailed feedback. Routes promoters to testimonial requests and detractors to resolution paths.",
    isTemplate: true,
    nodes: [
      {
        id: "node-greeting",
        type: "message",
        position: { x: 250, y: 50 },
        data: {
          type: "message",
          label: "Introduction",
          config: {
            type: "message",
            message: "Hi! I'm calling from the customer success team. We'd love to hear about your recent experience with our service. This quick survey takes less than 2 minutes. Do you have a moment?",
            waitForResponse: true,
          },
        },
      },
      {
        id: "node-nps-score",
        type: "question",
        position: { x: 250, y: 170 },
        data: {
          type: "question",
          label: "NPS Score",
          config: {
            type: "question",
            question: "On a scale of 0 to 10, how likely are you to recommend our service to a friend or colleague?",
            variableName: "nps_score",
            waitForResponse: true,
          },
        },
      },
      {
        id: "node-ask-reason",
        type: "question",
        position: { x: 250, y: 290 },
        data: {
          type: "question",
          label: "Reason",
          config: {
            type: "question",
            question: "Thank you! Could you briefly share the main reason for your score?",
            variableName: "nps_reason",
            waitForResponse: true,
          },
        },
      },
      {
        id: "node-check-promoter",
        type: "condition",
        position: { x: 250, y: 410 },
        data: {
          type: "condition",
          label: "Check Score",
          config: {
            type: "condition",
            condition: "The NPS score is 9 or 10 (promoter)",
          },
        },
      },
      {
        id: "node-ask-testimonial",
        type: "question",
        position: { x: 450, y: 530 },
        data: {
          type: "question",
          label: "Request Testimonial",
          config: {
            type: "question",
            question: "We're so glad to hear that! Would you be willing to provide a brief testimonial we could share on our website?",
            variableName: "testimonial_consent",
            waitForResponse: true,
          },
        },
      },
      {
        id: "node-promoter-webhook",
        type: "webhook",
        position: { x: 450, y: 650 },
        data: {
          type: "webhook",
          label: "Log Promoter",
          config: {
            type: "webhook",
            url: "https://your-crm.com/feedback",
            method: "POST",
            headers: { "Content-Type": "application/json" },
            payload: { category: "promoter", request_testimonial: true },
            description: "Log promoter feedback and testimonial request",
          },
        },
      },
      {
        id: "node-ask-improvement",
        type: "question",
        position: { x: 50, y: 530 },
        data: {
          type: "question",
          label: "Improvement Ideas",
          config: {
            type: "question",
            question: "We appreciate your honest feedback. What's one thing we could improve to make your experience better?",
            variableName: "improvement_suggestion",
            waitForResponse: true,
          },
        },
      },
      {
        id: "node-offer-callback",
        type: "question",
        position: { x: 50, y: 650 },
        data: {
          type: "question",
          label: "Offer Callback",
          config: {
            type: "question",
            question: "Would you like a member of our support team to follow up with you about your concerns?",
            variableName: "callback_requested",
            waitForResponse: true,
          },
        },
      },
      {
        id: "node-detractor-webhook",
        type: "webhook",
        position: { x: 50, y: 770 },
        data: {
          type: "webhook",
          label: "Log Detractor",
          config: {
            type: "webhook",
            url: "https://your-crm.com/feedback",
            method: "POST",
            headers: { "Content-Type": "application/json" },
            payload: { category: "detractor", priority: "high" },
            description: "Log detractor feedback for follow-up",
          },
        },
      },
      {
        id: "node-promoter-end",
        type: "end",
        position: { x: 450, y: 770 },
        data: {
          type: "end",
          label: "Thank Promoter",
          config: {
            type: "end",
            endMessage: "Thank you so much for your kind feedback and support! We truly appreciate customers like you. Have a wonderful day!",
          },
        },
      },
      {
        id: "node-detractor-end",
        type: "end",
        position: { x: 50, y: 890 },
        data: {
          type: "end",
          label: "Thank Detractor",
          config: {
            type: "end",
            endMessage: "Thank you for taking the time to share your feedback. We're committed to improving and will work on addressing your concerns. Have a great day!",
          },
        },
      },
    ],
    edges: [
      { id: "e1", source: "node-greeting", target: "node-nps-score" },
      { id: "e2", source: "node-nps-score", target: "node-ask-reason" },
      { id: "e3", source: "node-ask-reason", target: "node-check-promoter" },
      { id: "e4", source: "node-check-promoter", sourceHandle: "true", target: "node-ask-testimonial" },
      { id: "e5", source: "node-check-promoter", sourceHandle: "false", target: "node-ask-improvement" },
      { id: "e6", source: "node-ask-testimonial", target: "node-promoter-webhook" },
      { id: "e7", source: "node-promoter-webhook", target: "node-promoter-end" },
      { id: "e8", source: "node-ask-improvement", target: "node-offer-callback" },
      { id: "e9", source: "node-offer-callback", target: "node-detractor-webhook" },
      { id: "e10", source: "node-detractor-webhook", target: "node-detractor-end" },
    ],
  },

  // ============================================
  // Template 4: Order Placement
  // ============================================
  {
    id: "template-order-placement",
    name: "Order Placement",
    description: "Collect order details including product, quantity, and shipping information. Sends order data to your backend via webhook.",
    isTemplate: true,
    nodes: [
      {
        id: "node-greeting",
        type: "message",
        position: { x: 250, y: 50 },
        data: {
          type: "message",
          label: "Welcome",
          config: {
            type: "message",
            message: "Hello! Welcome to our ordering service. I'm here to help you place an order today. Let me collect a few details to process your order.",
            waitForResponse: false,
          },
        },
      },
      {
        id: "node-ask-product",
        type: "question",
        position: { x: 250, y: 170 },
        data: {
          type: "question",
          label: "Product Name",
          config: {
            type: "question",
            question: "What product would you like to order?",
            variableName: "product_name",
            waitForResponse: true,
          },
        },
      },
      {
        id: "node-ask-quantity",
        type: "question",
        position: { x: 250, y: 290 },
        data: {
          type: "question",
          label: "Quantity",
          config: {
            type: "question",
            question: "How many units would you like to order?",
            variableName: "quantity",
            waitForResponse: true,
          },
        },
      },
      {
        id: "node-ask-address",
        type: "question",
        position: { x: 250, y: 410 },
        data: {
          type: "question",
          label: "Delivery Address",
          config: {
            type: "question",
            question: "What is your delivery address including city and zip code?",
            variableName: "delivery_address",
            waitForResponse: true,
          },
        },
      },
      {
        id: "node-ask-email",
        type: "question",
        position: { x: 250, y: 530 },
        data: {
          type: "question",
          label: "Email Address",
          config: {
            type: "question",
            question: "What email address should we send the order confirmation to?",
            variableName: "customer_email",
            waitForResponse: true,
          },
        },
      },
      {
        id: "node-processing",
        type: "message",
        position: { x: 250, y: 650 },
        data: {
          type: "message",
          label: "Processing",
          config: {
            type: "message",
            message: "Thank you! I'm now processing your order. Please hold for just a moment.",
            waitForResponse: false,
          },
        },
      },
      {
        id: "node-submit-order",
        type: "webhook",
        position: { x: 250, y: 770 },
        data: {
          type: "webhook",
          label: "Submit Order",
          config: {
            type: "webhook",
            url: "https://your-order-api.com/orders",
            method: "POST",
            headers: { "Content-Type": "application/json", "X-API-Key": "your-api-key" },
            payload: { source: "phone_order" },
            description: "Submit order to backend. Automatically includes caller_phone, product, quantity, address, email, and conversation data.",
          },
        },
      },
      {
        id: "node-confirmation",
        type: "message",
        position: { x: 250, y: 890 },
        data: {
          type: "message",
          label: "Confirmation",
          config: {
            type: "message",
            message: "Great news! Your order has been successfully submitted. You will receive a confirmation email shortly with your order details and tracking information.",
            waitForResponse: false,
          },
        },
      },
      {
        id: "node-end",
        type: "end",
        position: { x: 250, y: 1010 },
        data: {
          type: "end",
          label: "Goodbye",
          config: {
            type: "end",
            endMessage: "Thank you for your order! Is there anything else I can help you with today? If not, have a wonderful day!",
          },
        },
      },
    ],
    edges: [
      { id: "e1", source: "node-greeting", target: "node-ask-product" },
      { id: "e2", source: "node-ask-product", target: "node-ask-quantity" },
      { id: "e3", source: "node-ask-quantity", target: "node-ask-address" },
      { id: "e4", source: "node-ask-address", target: "node-ask-email" },
      { id: "e5", source: "node-ask-email", target: "node-processing" },
      { id: "e6", source: "node-processing", target: "node-submit-order" },
      { id: "e7", source: "node-submit-order", target: "node-confirmation" },
      { id: "e8", source: "node-confirmation", target: "node-end" },
    ],
  },

  // ============================================
  // Template 5: Call Transfer
  // ============================================
  {
    id: "template-call-transfer",
    name: "Call Transfer / Receptionist",
    description: "Greet callers, identify their needs, and route to the appropriate department or person. Includes fallback to voicemail.",
    isTemplate: true,
    nodes: [
      {
        id: "node-greeting",
        type: "message",
        position: { x: 250, y: 50 },
        data: {
          type: "message",
          label: "Reception Greeting",
          config: {
            type: "message",
            message: "Good day! Thank you for calling. How may I direct your call today?",
            waitForResponse: true,
          },
        },
      },
      {
        id: "node-ask-department",
        type: "question",
        position: { x: 250, y: 170 },
        data: {
          type: "question",
          label: "Department",
          config: {
            type: "question",
            question: "Which department would you like to reach? We have Sales, Support, Billing, or you can ask for a specific person.",
            variableName: "requested_department",
            waitForResponse: true,
          },
        },
      },
      {
        id: "node-check-sales",
        type: "condition",
        position: { x: 250, y: 290 },
        data: {
          type: "condition",
          label: "Is Sales?",
          config: {
            type: "condition",
            condition: "The caller wants to reach Sales or is asking about purchasing, pricing, or products",
          },
        },
      },
      {
        id: "node-transfer-sales",
        type: "transfer",
        position: { x: 50, y: 410 },
        data: {
          type: "transfer",
          label: "Transfer to Sales",
          config: {
            type: "transfer",
            transferNumber: "+1234567890",
            message: "I'll transfer you to our Sales team right away. Please hold.",
          },
        },
      },
      {
        id: "node-check-support",
        type: "condition",
        position: { x: 450, y: 410 },
        data: {
          type: "condition",
          label: "Is Support?",
          config: {
            type: "condition",
            condition: "The caller wants to reach Support or is asking for help with a technical issue",
          },
        },
      },
      {
        id: "node-transfer-support",
        type: "transfer",
        position: { x: 300, y: 530 },
        data: {
          type: "transfer",
          label: "Transfer to Support",
          config: {
            type: "transfer",
            transferNumber: "+1234567891",
            message: "I'll connect you with our Support team. One moment please.",
          },
        },
      },
      {
        id: "node-check-billing",
        type: "condition",
        position: { x: 600, y: 530 },
        data: {
          type: "condition",
          label: "Is Billing?",
          config: {
            type: "condition",
            condition: "The caller wants to reach Billing or is asking about invoices, payments, or accounts",
          },
        },
      },
      {
        id: "node-transfer-billing",
        type: "transfer",
        position: { x: 500, y: 650 },
        data: {
          type: "transfer",
          label: "Transfer to Billing",
          config: {
            type: "transfer",
            transferNumber: "+1234567892",
            message: "I'll transfer you to our Billing department. Please hold.",
          },
        },
      },
      {
        id: "node-take-message",
        type: "question",
        position: { x: 700, y: 650 },
        data: {
          type: "question",
          label: "Take Message",
          config: {
            type: "question",
            question: "I couldn't identify the right department for your request. Can I take a message and have someone call you back?",
            variableName: "callback_message",
            waitForResponse: true,
          },
        },
      },
      {
        id: "node-log-message",
        type: "webhook",
        position: { x: 700, y: 770 },
        data: {
          type: "webhook",
          label: "Log Message",
          config: {
            type: "webhook",
            url: "https://your-api.com/messages",
            method: "POST",
            headers: { "Content-Type": "application/json" },
            payload: { type: "callback_request" },
            description: "Log callback message request",
          },
        },
      },
      {
        id: "node-end-transfer",
        type: "end",
        position: { x: 175, y: 530 },
        data: {
          type: "end",
          label: "Transfer Complete",
          config: {
            type: "end",
            endMessage: "Thank you for calling. Your call is being transferred now.",
          },
        },
      },
      {
        id: "node-end-message",
        type: "end",
        position: { x: 700, y: 890 },
        data: {
          type: "end",
          label: "Message Taken",
          config: {
            type: "end",
            endMessage: "Thank you! We've recorded your message and someone will get back to you within 24 hours. Have a great day!",
          },
        },
      },
    ],
    edges: [
      { id: "e1", source: "node-greeting", target: "node-ask-department" },
      { id: "e2", source: "node-ask-department", target: "node-check-sales" },
      { id: "e3", source: "node-check-sales", sourceHandle: "true", target: "node-transfer-sales" },
      { id: "e4", source: "node-check-sales", sourceHandle: "false", target: "node-check-support" },
      { id: "e5", source: "node-transfer-sales", target: "node-end-transfer" },
      { id: "e6", source: "node-check-support", sourceHandle: "true", target: "node-transfer-support" },
      { id: "e7", source: "node-check-support", sourceHandle: "false", target: "node-check-billing" },
      { id: "e8", source: "node-transfer-support", target: "node-end-transfer" },
      { id: "e9", source: "node-check-billing", sourceHandle: "true", target: "node-transfer-billing" },
      { id: "e10", source: "node-check-billing", sourceHandle: "false", target: "node-take-message" },
      { id: "e11", source: "node-transfer-billing", target: "node-end-transfer" },
      { id: "e12", source: "node-take-message", target: "node-log-message" },
      { id: "e13", source: "node-log-message", target: "node-end-message" },
    ],
  },

  // ============================================
  // Template 6: Event Registration
  // ============================================
  {
    id: "template-event-registration",
    name: "Event Registration",
    description: "Register attendees for events, collect dietary preferences and accessibility needs, and send confirmation.",
    isTemplate: true,
    nodes: [
      {
        id: "node-greeting",
        type: "message",
        position: { x: 250, y: 50 },
        data: {
          type: "message",
          label: "Event Welcome",
          config: {
            type: "message",
            message: "Hi! Thank you for your interest in our upcoming event. I'd be happy to help you register. This will only take a couple of minutes.",
            waitForResponse: false,
          },
        },
      },
      {
        id: "node-ask-name",
        type: "question",
        position: { x: 250, y: 170 },
        data: {
          type: "question",
          label: "Full Name",
          config: {
            type: "question",
            question: "May I have your full name for the registration?",
            variableName: "attendee_name",
            waitForResponse: true,
          },
        },
      },
      {
        id: "node-ask-email",
        type: "question",
        position: { x: 250, y: 290 },
        data: {
          type: "question",
          label: "Email",
          config: {
            type: "question",
            question: "What email address should we send your confirmation and event details to?",
            variableName: "attendee_email",
            waitForResponse: true,
          },
        },
      },
      {
        id: "node-ask-company",
        type: "question",
        position: { x: 250, y: 410 },
        data: {
          type: "question",
          label: "Company",
          config: {
            type: "question",
            question: "Which company or organization are you representing?",
            variableName: "company_name",
            waitForResponse: true,
          },
        },
      },
      {
        id: "node-ask-dietary",
        type: "question",
        position: { x: 250, y: 530 },
        data: {
          type: "question",
          label: "Dietary Preferences",
          config: {
            type: "question",
            question: "Do you have any dietary restrictions or preferences we should know about? For example, vegetarian, vegan, gluten-free, or any allergies?",
            variableName: "dietary_restrictions",
            waitForResponse: true,
          },
        },
      },
      {
        id: "node-ask-accessibility",
        type: "question",
        position: { x: 250, y: 650 },
        data: {
          type: "question",
          label: "Accessibility Needs",
          config: {
            type: "question",
            question: "Do you require any accessibility accommodations?",
            variableName: "accessibility_needs",
            waitForResponse: true,
          },
        },
      },
      {
        id: "node-register-webhook",
        type: "webhook",
        position: { x: 250, y: 770 },
        data: {
          type: "webhook",
          label: "Register Attendee",
          config: {
            type: "webhook",
            url: "https://your-events-api.com/registrations",
            method: "POST",
            headers: { "Content-Type": "application/json" },
            payload: { event_id: "your-event-id", source: "phone" },
            description: "Register attendee in event system",
          },
        },
      },
      {
        id: "node-confirmation",
        type: "message",
        position: { x: 250, y: 890 },
        data: {
          type: "message",
          label: "Confirmation",
          config: {
            type: "message",
            message: "Wonderful! You're all registered. You'll receive a confirmation email shortly with all the event details including venue information, agenda, and parking instructions.",
            waitForResponse: false,
          },
        },
      },
      {
        id: "node-end",
        type: "end",
        position: { x: 250, y: 1010 },
        data: {
          type: "end",
          label: "Goodbye",
          config: {
            type: "end",
            endMessage: "Thank you for registering! We look forward to seeing you at the event. Have a great day!",
          },
        },
      },
    ],
    edges: [
      { id: "e1", source: "node-greeting", target: "node-ask-name" },
      { id: "e2", source: "node-ask-name", target: "node-ask-email" },
      { id: "e3", source: "node-ask-email", target: "node-ask-company" },
      { id: "e4", source: "node-ask-company", target: "node-ask-dietary" },
      { id: "e5", source: "node-ask-dietary", target: "node-ask-accessibility" },
      { id: "e6", source: "node-ask-accessibility", target: "node-register-webhook" },
      { id: "e7", source: "node-register-webhook", target: "node-confirmation" },
      { id: "e8", source: "node-confirmation", target: "node-end" },
    ],
  },

  // ============================================
  // Template 7: Payment Reminder
  // ============================================
  {
    id: "template-payment-reminder",
    name: "Payment Reminder",
    description: "Remind customers about overdue payments, offer payment options, and route to billing support if needed.",
    isTemplate: true,
    nodes: [
      {
        id: "node-greeting",
        type: "message",
        position: { x: 250, y: 50 },
        data: {
          type: "message",
          label: "Introduction",
          config: {
            type: "message",
            message: "Hello! This is a courtesy call from the billing department regarding your account. We noticed there's an outstanding balance. Is this a good time to discuss your payment options?",
            waitForResponse: true,
          },
        },
      },
      {
        id: "node-verify-identity",
        type: "question",
        position: { x: 250, y: 170 },
        data: {
          type: "question",
          label: "Verify Identity",
          config: {
            type: "question",
            question: "For security purposes, may I please verify the last 4 digits of your phone number on file?",
            variableName: "phone_verification",
            waitForResponse: true,
          },
        },
      },
      {
        id: "node-explain-balance",
        type: "message",
        position: { x: 250, y: 290 },
        data: {
          type: "message",
          label: "Balance Info",
          config: {
            type: "message",
            message: "Thank you for confirming. According to our records, your current balance is due. Would you like to make a payment today or discuss payment options?",
            waitForResponse: true,
          },
        },
      },
      {
        id: "node-ask-payment",
        type: "question",
        position: { x: 250, y: 410 },
        data: {
          type: "question",
          label: "Payment Decision",
          config: {
            type: "question",
            question: "Would you like to pay the full balance today, set up a payment plan, or speak with a billing specialist?",
            variableName: "payment_choice",
            waitForResponse: true,
          },
        },
      },
      {
        id: "node-check-fullpay",
        type: "condition",
        position: { x: 250, y: 530 },
        data: {
          type: "condition",
          label: "Full Payment?",
          config: {
            type: "condition",
            condition: "The customer wants to pay the full balance today",
          },
        },
      },
      {
        id: "node-collect-payment",
        type: "message",
        position: { x: 50, y: 650 },
        data: {
          type: "message",
          label: "Payment Link",
          config: {
            type: "message",
            message: "Perfect! I'll send you a secure payment link via text message right now. You can complete the payment at your convenience within the next 24 hours.",
            waitForResponse: false,
          },
        },
      },
      {
        id: "node-send-link-webhook",
        type: "webhook",
        position: { x: 50, y: 770 },
        data: {
          type: "webhook",
          label: "Send Payment Link",
          config: {
            type: "webhook",
            url: "https://your-billing-api.com/send-payment-link",
            method: "POST",
            headers: { "Content-Type": "application/json" },
            payload: { action: "send_payment_link" },
            description: "Send secure payment link to customer",
          },
        },
      },
      {
        id: "node-check-plan",
        type: "condition",
        position: { x: 450, y: 650 },
        data: {
          type: "condition",
          label: "Payment Plan?",
          config: {
            type: "condition",
            condition: "The customer wants to set up a payment plan",
          },
        },
      },
      {
        id: "node-plan-details",
        type: "question",
        position: { x: 300, y: 770 },
        data: {
          type: "question",
          label: "Plan Preference",
          config: {
            type: "question",
            question: "We can split the balance into 2, 3, or 4 monthly payments. Which option works best for you?",
            variableName: "payment_plan_months",
            waitForResponse: true,
          },
        },
      },
      {
        id: "node-plan-webhook",
        type: "webhook",
        position: { x: 300, y: 890 },
        data: {
          type: "webhook",
          label: "Create Plan",
          config: {
            type: "webhook",
            url: "https://your-billing-api.com/payment-plans",
            method: "POST",
            headers: { "Content-Type": "application/json" },
            payload: { action: "create_payment_plan" },
            description: "Create payment plan in billing system",
          },
        },
      },
      {
        id: "node-transfer-billing",
        type: "transfer",
        position: { x: 550, y: 770 },
        data: {
          type: "transfer",
          label: "Transfer to Billing",
          config: {
            type: "transfer",
            transferNumber: "+1234567890",
            message: "I'll connect you with a billing specialist who can help with your specific situation. Please hold.",
          },
        },
      },
      {
        id: "node-end-payment",
        type: "end",
        position: { x: 50, y: 890 },
        data: {
          type: "end",
          label: "Payment Link Sent",
          config: {
            type: "end",
            endMessage: "The payment link has been sent to your phone. Thank you for taking care of this. Have a great day!",
          },
        },
      },
      {
        id: "node-end-plan",
        type: "end",
        position: { x: 300, y: 1010 },
        data: {
          type: "end",
          label: "Plan Created",
          config: {
            type: "end",
            endMessage: "Your payment plan has been set up. You'll receive confirmation details via email. Thank you for working with us!",
          },
        },
      },
      {
        id: "node-end-transfer",
        type: "end",
        position: { x: 550, y: 890 },
        data: {
          type: "end",
          label: "Transfer Complete",
          config: {
            type: "end",
            endMessage: "Transferring you now. Thank you for your patience.",
          },
        },
      },
    ],
    edges: [
      { id: "e1", source: "node-greeting", target: "node-verify-identity" },
      { id: "e2", source: "node-verify-identity", target: "node-explain-balance" },
      { id: "e3", source: "node-explain-balance", target: "node-ask-payment" },
      { id: "e4", source: "node-ask-payment", target: "node-check-fullpay" },
      { id: "e5", source: "node-check-fullpay", sourceHandle: "true", target: "node-collect-payment" },
      { id: "e6", source: "node-check-fullpay", sourceHandle: "false", target: "node-check-plan" },
      { id: "e7", source: "node-collect-payment", target: "node-send-link-webhook" },
      { id: "e8", source: "node-send-link-webhook", target: "node-end-payment" },
      { id: "e9", source: "node-check-plan", sourceHandle: "true", target: "node-plan-details" },
      { id: "e10", source: "node-check-plan", sourceHandle: "false", target: "node-transfer-billing" },
      { id: "e11", source: "node-plan-details", target: "node-plan-webhook" },
      { id: "e12", source: "node-plan-webhook", target: "node-end-plan" },
      { id: "e13", source: "node-transfer-billing", target: "node-end-transfer" },
    ],
  },

  // ============================================
  // Template 8: Simple Data Collection Form
  // ============================================
  {
    id: "template-data-collection",
    name: "Data Collection Form",
    description: "Collect structured data from callers using a form. Perfect for registrations, applications, or information gathering.",
    isTemplate: true,
    nodes: [
      {
        id: "node-greeting",
        type: "message",
        position: { x: 250, y: 50 },
        data: {
          type: "message",
          label: "Welcome",
          config: {
            type: "message",
            message: "Hello! Thank you for calling. I'll need to collect some information from you. This should only take a few minutes.",
            waitForResponse: false,
          },
        },
      },
      {
        id: "node-collect-form",
        type: "form",
        position: { x: 250, y: 170 },
        data: {
          type: "form",
          label: "Collect Information",
          config: {
            type: "form",
            formId: null,
            message: "I'll ask you a few questions now. Please answer each one clearly.",
            waitForResponse: true,
          },
        },
      },
      {
        id: "node-review",
        type: "message",
        position: { x: 250, y: 290 },
        data: {
          type: "message",
          label: "Review Info",
          config: {
            type: "message",
            message: "Thank you for providing that information. Let me review what we collected.",
            waitForResponse: false,
          },
        },
      },
      {
        id: "node-submit-webhook",
        type: "webhook",
        position: { x: 250, y: 410 },
        data: {
          type: "webhook",
          label: "Submit Data",
          config: {
            type: "webhook",
            url: "https://your-api.com/submissions",
            method: "POST",
            headers: { "Content-Type": "application/json" },
            payload: { source: "phone_form" },
            description: "Submit collected form data to backend",
          },
        },
      },
      {
        id: "node-confirmation",
        type: "message",
        position: { x: 250, y: 530 },
        data: {
          type: "message",
          label: "Confirmation",
          config: {
            type: "message",
            message: "All your information has been recorded successfully. You'll receive a confirmation email shortly.",
            waitForResponse: false,
          },
        },
      },
      {
        id: "node-end",
        type: "end",
        position: { x: 250, y: 650 },
        data: {
          type: "end",
          label: "Goodbye",
          config: {
            type: "end",
            endMessage: "Thank you for your time today. Is there anything else I can help you with? If not, have a wonderful day!",
          },
        },
      },
    ],
    edges: [
      { id: "e1", source: "node-greeting", target: "node-collect-form" },
      { id: "e2", source: "node-collect-form", target: "node-review" },
      { id: "e3", source: "node-review", target: "node-submit-webhook" },
      { id: "e4", source: "node-submit-webhook", target: "node-confirmation" },
      { id: "e5", source: "node-confirmation", target: "node-end" },
    ],
  },

  // ============================================
  // Template 9: Full Communication Demo
  // Message -> Appointment -> Send Email -> Send WhatsApp -> End
  // ============================================
  {
    id: "template-full-communication",
    name: "Full Communication Demo",
    description: "A complete demo flow: greets the caller, books an appointment, sends a confirmation email, sends a WhatsApp message, and ends the call.",
    isTemplate: true,
    nodes: [
      {
        id: "node-demo-greeting",
        type: "message",
        position: { x: 250, y: 50 },
        data: {
          type: "message",
          label: "Welcome",
          config: {
            type: "message",
            message: "Hello! Welcome to our service. I can help you book an appointment, and then send you a confirmation via email and WhatsApp. Let's get started!",
            waitForResponse: true,
          },
        },
      },
      {
        id: "node-demo-appointment",
        type: "appointment",
        position: { x: 250, y: 200 },
        data: {
          type: "appointment",
          label: "Book Appointment",
          config: {
            type: "appointment",
            message: "Great! Let me collect some details to book your appointment.",
            serviceName: "Consultation",
            waitForResponse: true,
          },
        },
      },
      {
        id: "node-demo-email",
        type: "send_email",
        position: { x: 250, y: 350 },
        data: {
          type: "send_email",
          label: "Send Confirmation Email",
          config: {
            type: "send_email",
            message: "Perfect! I'll send you a confirmation email now.",
            templateName: "appointment_confirmation",
            recipientEmail: "",
          },
        },
      },
      {
        id: "node-demo-whatsapp",
        type: "send_whatsapp",
        position: { x: 250, y: 500 },
        data: {
          type: "send_whatsapp",
          label: "Send WhatsApp Confirmation",
          config: {
            type: "send_whatsapp",
            message: "I'll also send you a WhatsApp message with the appointment details.",
            templateName: "hello_world",
            language: "en_US",
            templateVariables: [],
          },
        },
      },
      {
        id: "node-demo-end",
        type: "end",
        position: { x: 250, y: 650 },
        data: {
          type: "end",
          label: "Goodbye",
          config: {
            type: "end",
            endMessage: "Your appointment is confirmed and all confirmations have been sent. Thank you for choosing our service. Have a wonderful day!",
          },
        },
      },
    ],
    edges: [
      { id: "e-demo-1", source: "node-demo-greeting", target: "node-demo-appointment" },
      { id: "e-demo-2", source: "node-demo-appointment", target: "node-demo-email" },
      { id: "e-demo-3", source: "node-demo-email", target: "node-demo-whatsapp" },
      { id: "e-demo-4", source: "node-demo-whatsapp", target: "node-demo-end" },
    ],
  },
];
