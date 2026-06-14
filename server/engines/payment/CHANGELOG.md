# Payment Engine Changelog

All notable changes to the Payment Engine will be documented in this file.

## [1.0.0] - 2025-01-XX

### Added
- Initial release of the Payment Engine
- Support for 5 payment gateways: Stripe, Razorpay, PayPal, Paystack, MercadoPago
- Webhook management with DB-stored secrets
- Verify-session fallback endpoints for all gateways
- Refund and dispute handling
- Subscription lifecycle management (renewals, past-due, cancellation)
- Dunning logic for failed payments
- Invoice PDF generation
- Payment notifications (email)
- Admin dashboard for transaction management
- Audit logging for all payment actions
- Reconciliation scheduler for missed webhooks

### Update Instructions
1. Backup your `server/engines/payment/` folder
2. Delete the old `server/engines/payment/` folder
3. Copy the new `server/engines/payment/` folder
4. Run: `npm run db:push` (if database schema changes)
5. Restart the application

### Configuration Migration
- All webhook secrets are now stored in the database (globalSettings table)
- API keys can be configured from Admin Panel > Payment Gateways
- ElevenLabs HMAC secret configurable from Admin Panel
