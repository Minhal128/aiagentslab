# AgentLabs Installation Guide

**Version:** 1.0.0  
**Last Updated:** December 2025

This guide provides comprehensive step-by-step instructions for installing and updating AgentLabs. Written for non-technical users with clear instructions.

---

## Table of Contents

1. [Before You Begin](#before-you-begin)
2. [Fresh Installation](#fresh-installation)
3. [Setup Wizard Walkthrough](#setup-wizard-walkthrough)
4. [Configuring AI Engines](#configuring-ai-engines)
5. [Configuring Telephony](#configuring-telephony)
6. [Configuring Payment Gateways](#configuring-payment-gateways)
7. [Configuring Email (SMTP)](#configuring-email-smtp)
8. [Updating to a New Version](#updating-to-a-new-version)
9. [Backup & Recovery](#backup--recovery)
10. [Production Deployment](#production-deployment)
11. [Frequently Asked Questions](#frequently-asked-questions)
12. [Troubleshooting](#troubleshooting)

---

## Before You Begin

### What You'll Need

| Requirement | Description | How to Get It |
|-------------|-------------|---------------|
| **Hosting Account** | A server to run the application | DigitalOcean, AWS, Railway, Render, or any VPS |
| **Domain Name** | Your website address | GoDaddy, Namecheap, or any registrar |
| **PostgreSQL Database** | Where your data is stored | Usually included with hosting or use Neon |
| **Email Account** | For sending notifications | Gmail with App Password or any SMTP service |

### External Service Accounts

Get accounts with these services before installation:

**AI Engine (Choose at least one):**

| Service | Purpose | Sign Up |
|---------|---------|---------|
| **ElevenLabs** | AI voice (100+ voices) | [elevenlabs.io](https://elevenlabs.io) |
| **OpenAI** | AI voice (alternative) | [platform.openai.com](https://platform.openai.com) |

**Phone Calls (Choose at least one):**

| Service | Purpose | Sign Up |
|---------|---------|---------|
| **Twilio** | Global phone calls | [twilio.com](https://twilio.com) |
| **Plivo** | Alternative (good for India) | [plivo.com](https://plivo.com) |

**Payments (Optional - choose the ones you need):**

| Service | Best For | Sign Up |
|---------|----------|---------|
| **Stripe** | Global | [stripe.com](https://stripe.com) |
| **Razorpay** | India | [razorpay.com](https://razorpay.com) |
| **PayPal** | Global | [developer.paypal.com](https://developer.paypal.com) |
| **Paystack** | Africa | [paystack.com](https://paystack.com) |
| **MercadoPago** | Latin America | [mercadopago.com](https://mercadopago.com) |

### Time Required

- **Basic Installation**: 15-30 minutes
- **Full Configuration**: 1-2 hours (all payment gateways)

---

## Fresh Installation

### Server Requirements

| Resource | Minimum | Recommended |
|----------|---------|-------------|
| **Node.js** | 18.x | 20.x LTS |
| **PostgreSQL** | 14.x | 15.x or 16.x |
| **RAM** | 2 GB | 4 GB |
| **Storage** | 10 GB | 20 GB |

### Step 1: Prepare Your Server

**Using a VPS (DigitalOcean, AWS, Linode, Contabo, Hetzner):**

```bash
# Connect to your server via SSH
ssh root@your-server-ip

# Update system
sudo apt update && sudo apt upgrade -y

# Install required packages
sudo apt install -y curl wget unzip git nano

# Install Node.js 20
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt install -y nodejs

# Install PM2 globally (for running the app)
sudo npm install -g pm2

# Install PostgreSQL
sudo apt install -y postgresql postgresql-contrib

# Install Nginx (for reverse proxy)
sudo apt install -y nginx

# Install Certbot (for SSL)
sudo apt install -y certbot python3-certbot-nginx

# Enable firewall
sudo ufw allow ssh
sudo ufw allow 80
sudo ufw allow 443
sudo ufw enable

# Verify installations
node --version   # Should show v20.x.x
psql --version   # Should show 14 or higher
pm2 --version    # Should show 5.x.x
nginx -v         # Should show nginx version
```

**Recommended VPS Specifications:**

| Provider | Plan | RAM | Storage | Monthly Cost |
|----------|------|-----|---------|--------------|
| DigitalOcean | Basic Droplet | 4 GB | 80 GB | ~$24 |
| Linode | Linode 4GB | 4 GB | 80 GB | ~$24 |
| Contabo | VPS S | 8 GB | 200 GB | ~$7 |
| Hetzner | CX21 | 4 GB | 40 GB | ~$5 |
| AWS Lightsail | 4 GB | 4 GB | 80 GB | ~$20 |

**Using Railway, Render, or Heroku:**
These platforms handle server setup automatically. Just create a new project and upload your files.

### Step 2: Create Database

**On a VPS:**

```bash
# Connect to PostgreSQL
sudo -u postgres psql

# Create database and user (in PostgreSQL shell)
CREATE USER agentlabs WITH PASSWORD 'your_secure_password';
CREATE DATABASE agentlabs OWNER agentlabs;
GRANT ALL PRIVILEGES ON DATABASE agentlabs TO agentlabs;
\q
```

**On Railway/Render:**
Add a PostgreSQL database to your project and copy the connection string provided.

### Step 3: Upload Files

```bash
# Extract the ZIP file
unzip AgentLabs-Production-v1.0.0.zip
cd AgentLabs

# Set permissions
sudo chown -R $USER:$USER .
```

### Step 4: Configure Environment

```bash
# Copy example environment file
cp .env.example .env

# Edit with your values
nano .env
```

**Required settings:**

```bash
# Database (REQUIRED)
DATABASE_URL=postgresql://agentlabs:your_password@localhost:5432/agentlabs

# Application (REQUIRED)
NODE_ENV=production
PORT=5000
APP_URL=https://your-domain.com

# Security Keys (REQUIRED)
# Generate with: openssl rand -base64 32
SESSION_SECRET=paste_random_32_character_string_here
JWT_SECRET=paste_another_random_32_character_string_here
```

### Step 5: Install Dependencies

```bash
npm install
```

Wait 2-5 minutes for completion.

**Note about deprecation warnings:** You may see some deprecation warnings during installation. These are normal and don't affect functionality.

To verify security status:
```bash
npm audit
```

**Expected output:** `found 0 vulnerabilities`

### Step 6: Set Up Database Tables

```bash
npm run db:push
```

You should see messages about tables being created.

### Step 7: Build the Application

```bash
npm run build
```

### Step 8: Start the Application

```bash
# For production (recommended)
npm run start

# Or for development/testing
npm run dev
```

### Step 9: Access the Setup Wizard

1. Open your browser
2. Go to your domain (e.g., `https://your-domain.com`)
3. The Setup Wizard will appear automatically

---

## Setup Wizard Walkthrough

The Setup Wizard runs automatically on first launch.

### Screen 1: Welcome

Click "Continue" or "Start Setup" to begin.

### Screen 2: System Check

The wizard verifies:
- Database connection
- Required environment variables
- System requirements

All items should show green checkmarks. If any show red, fix the issue and click "Check Again".

### Screen 3: Create Admin Account

Fill in your details:

| Field | What to Enter |
|-------|---------------|
| **Email** | Your admin email (used to log in) |
| **Password** | Strong password (8+ characters) |
| **Company Name** | Your business name |

### Screen 4: Complete!

You'll see:
- Your admin email
- Your password (save this!)
- A "Go to Login" button

**Important:** The Setup Wizard automatically seeds:
- 11 supported languages
- Default subscription plans
- Credit packages
- LLM models and voices
- Email templates
- System settings

Your admin account starts with:
- **10,000 credits** for testing
- **Pro plan** access
- **Full admin privileges**

---

## Configuring AI Engines

AgentLabs supports three AI engine configurations. Configure at least one.

### Option 1: ElevenLabs (Recommended)

Best for: High-quality natural voices, global coverage

1. Create account at [elevenlabs.io](https://elevenlabs.io)
2. Go to Profile > API Keys
3. Click "Create API Key"
4. Copy the key

**In AgentLabs:**
1. Login as Admin
2. Go to Settings > ElevenLabs Pool
3. Click "Add Key"
4. Enter a name (e.g., "Primary Key")
5. Paste your API key
6. Click Save

**For high volume:** Add multiple keys for load balancing.

### Option 2: OpenAI Realtime

Best for: Use with Plivo or as alternative AI voice

1. Create account at [platform.openai.com](https://platform.openai.com)
2. Go to API Keys
3. Create a new secret key
4. Copy the key (starts with `sk-`)

**In AgentLabs:**
1. Go to Settings > OpenAI Keys
2. Click "Add Key"
3. Enter a name
4. Paste your API key
5. Set the tier (for rate limiting)
6. Click Save

**Note:** Ensure your OpenAI account has Realtime API access enabled.

---

## Configuring Telephony

Configure at least one telephony provider for phone calls.

### Option 1: Twilio (Recommended for Global)

1. Create account at [twilio.com](https://twilio.com)
2. Complete phone verification
3. Go to Console Dashboard
4. Copy your Account SID and Auth Token

**In AgentLabs:**
1. Go to Settings > Twilio Settings
2. Enter Account SID
3. Enter Auth Token
4. Click Save
5. Click "Test Connection" to verify

**Webhook Configuration:**
Set these URLs in Twilio for your phone numbers:
- Voice URL: `https://your-domain.com/api/webhooks/twilio/voice`
- Status Callback: `https://your-domain.com/api/webhooks/twilio/status`

### Option 2: Plivo (Good for India)

1. Create account at [plivo.com](https://plivo.com)
2. Go to Dashboard
3. Copy Auth ID and Auth Token

**In AgentLabs:**
1. Go to Settings > Plivo Settings
2. Enter Auth ID
3. Enter Auth Token
4. Click Save

**Webhook Configuration:**
- Answer URL: `https://your-domain.com/api/plivo/voice/answer`
- Hangup URL: `https://your-domain.com/api/plivo/voice/status`

---

## Configuring Payment Gateways

Configure the payment gateways your customers will use.

### Stripe (Global)

1. Create account at [stripe.com](https://stripe.com)
2. Go to Developers > API Keys
3. Copy Publishable Key and Secret Key

**In AgentLabs:**
1. Go to Settings > Payments
2. Find Stripe section
3. Enter Secret Key
4. Enter Public Key
5. Click Save

**Webhook Setup (Required):**
1. In Stripe, go to Developers > Webhooks
2. Click "Add endpoint"
3. URL: `https://your-domain.com/api/webhooks/stripe`
4. Select all `invoice.*`, `customer.subscription.*`, `checkout.session.*` events
5. Copy the Signing Secret
6. Add it in AgentLabs Settings

### Razorpay (India)

1. Create account at [razorpay.com](https://razorpay.com)
2. Complete KYC verification
3. Go to Settings > API Keys
4. Generate Key ID and Secret

**In AgentLabs:**
1. Go to Settings > Payments
2. Find Razorpay section
3. Enter Key ID and Secret
4. Click Save

**Webhook Setup:**
- URL: `https://your-domain.com/api/webhooks/razorpay`
- Events: `payment.captured`, `subscription.activated`, `subscription.cancelled`

### PayPal (Global)

1. Create account at [developer.paypal.com](https://developer.paypal.com)
2. Go to Apps & Credentials
3. Create an app (choose Live for production)
4. Copy Client ID and Secret

**In AgentLabs:**
1. Go to Settings > Payments
2. Find PayPal section
3. Enter Client ID
4. Enter Client Secret
5. Select mode (Sandbox for testing, Live for production)
6. Click Save

**Webhook Setup:**
- URL: `https://your-domain.com/api/webhooks/paypal`
- Events: `PAYMENT.CAPTURE.COMPLETED`, `BILLING.SUBSCRIPTION.*`

### Paystack (Africa)

1. Create account at [paystack.com](https://paystack.com)
2. Complete business verification
3. Go to Settings > API Keys
4. Copy Public Key and Secret Key

**In AgentLabs:**
1. Go to Settings > Payments
2. Find Paystack section
3. Enter Public Key
4. Enter Secret Key
5. Click Save

**Webhook Setup:**
- URL: `https://your-domain.com/api/webhooks/paystack`
- Events: `charge.success`, `subscription.create`, `subscription.disable`

### MercadoPago (Latin America)

1. Create account at [mercadopago.com](https://mercadopago.com)
2. Go to Your Credentials (Tus credenciales)
3. Copy Access Token

**In AgentLabs:**
1. Go to Settings > Payments
2. Find MercadoPago section
3. Enter Access Token
4. Click Save

**Webhook Setup:**
- URL: `https://your-domain.com/api/webhooks/mercadopago`
- Topics: `payment`, `subscription_preapproval`

---

## Configuring Email (SMTP)

Email is required for user verification, password resets, and notifications.

### Using Gmail

1. Go to your Google Account > Security
2. Enable 2-Step Verification
3. Go to Security > App Passwords
4. Create an app password for "Mail"
5. Copy the 16-character password

**In AgentLabs Settings:**
- SMTP Host: `smtp.gmail.com`
- SMTP Port: `587`
- SMTP User: your Gmail address
- SMTP Password: the 16-character app password
- From Email: your Gmail address

### Using Other Providers

| Provider | Host | Port |
|----------|------|------|
| SendGrid | smtp.sendgrid.net | 587 |
| Mailgun | smtp.mailgun.org | 587 |
| AWS SES | email-smtp.us-east-1.amazonaws.com | 587 |

### Testing Email

1. Go to Settings > Email
2. Click "Send Test Email"
3. Check your inbox (and spam folder)

---

## Updating to a New Version

When a new version is released, follow these steps.

---

### Quick Update Guide (Simple Steps)

If you have an older version and want to update, follow these simple steps:

**Step 1: Connect to your server**
```bash
ssh root@your-server-ip
```

**Step 2: Stop the application**
```bash
pm2 stop agentlabs
```

**Step 3: Backup your current installation**
```bash
mkdir -p ~/backups
cp -r /var/www/agentlabs ~/backups/agentlabs-backup-$(date +%Y%m%d)
pg_dump -U agentlabs -d agentlabs > ~/backups/db-backup-$(date +%Y%m%d).sql
```

**Step 4: Upload and extract the new version**
```bash
cd /var/www

# Upload the new ZIP file to your server (use FileZilla, scp, or SFTP)
# Then extract it to a temporary folder
unzip AgentLabs-vX.Y.Z.zip -d agentlabs-new
```

**Step 5: Copy your configuration and uploads to the new version**
```bash
# Copy your .env file
cp /var/www/agentlabs/.env /var/www/agentlabs-new/.env

# Copy your uploads folder (if exists)
cp -r /var/www/agentlabs/uploads /var/www/agentlabs-new/uploads 2>/dev/null || true
```

**Step 6: Replace old with new**
```bash
# Rename old folder
mv /var/www/agentlabs /var/www/agentlabs-old

# Rename new folder
mv /var/www/agentlabs-new /var/www/agentlabs

# Go to the new folder
cd /var/www/agentlabs
```

**Step 7: Install dependencies and update database**
```bash
npm install
npm run db:push
npm run build
```

**Step 8: Restart the application**
```bash
pm2 delete agentlabs
pm2 start npm --name "agentlabs" -- run start
pm2 save
```

**Step 9: Verify the update**
- Open your website in a browser
- Press Ctrl+Shift+R to refresh (clears cache)
- Check the version number in Admin Dashboard
- Test that calls and campaigns work correctly

**Step 10: Clean up (optional, after confirming everything works)**
```bash
rm -rf /var/www/agentlabs-old
```

---

### Detailed Update Steps

For more control over the update process, follow these detailed steps.

#### Before Updating

1. **Create a backup** (see Backup section)
2. **Note current version**: Check Admin > Dashboard
3. **Read the changelog**: Check for special instructions

#### Step 1: Stop the Application

```bash
# If using PM2
pm2 stop agentlabs

# If running directly
# Press Ctrl+C
```

#### Step 2: Backup Current Installation

```bash
# Create dated backup folder
mkdir -p ~/backups

# Backup entire application
cp -r /var/www/agentlabs ~/backups/agentlabs-backup-$(date +%Y%m%d)

# Backup database separately (recommended)
pg_dump -h localhost -U agentlabs -d agentlabs > ~/backups/database-backup-$(date +%Y%m%d).sql
```

#### Step 3: Upload New Files

Replace all files EXCEPT:
- `.env` (keep your configuration)
- `uploads/` folder (keep uploaded files)

```bash
# Using rsync (preserves .env and uploads)
rsync -av --exclude='.env' --exclude='uploads/' --exclude='node_modules/' /path/to/new-version/ /var/www/agentlabs/
```

Or using FTP: Upload new files, but do NOT delete/replace `.env` or `uploads/`.

#### Step 4: Clear Old Dependencies

```bash
cd /var/www/agentlabs

# Remove old node_modules to ensure clean install
rm -rf node_modules

# Clear npm cache (helps avoid version conflicts)
npm cache clean --force
```

#### Step 5: Install Updated Dependencies

```bash
npm install
```

Wait for all dependencies to install (2-5 minutes).

#### Step 6: Update Database

```bash
npm run db:push
```

This adds new tables/columns. Your existing data is preserved. If a new payment gateway was added, this creates its required tables.

#### Step 7: Rebuild Application

```bash
npm run build
```

#### Step 8: Clear PM2 Cache and Restart

```bash
# Delete old PM2 process (clears cached state)
pm2 delete agentlabs

# Start fresh
pm2 start npm --name "agentlabs" -- run start

# Save PM2 configuration
pm2 save
```

**Important:** Using `pm2 restart` alone may not pick up all changes. Always use `pm2 delete` then `pm2 start` after major updates.

#### Step 9: Clear Browser Cache

Users may need to clear their browser cache to see frontend changes:
- Press Ctrl+Shift+R (Windows/Linux) or Cmd+Shift+R (Mac)
- Or clear browser cache in settings

#### Step 10: Verify Update

1. Open Admin Dashboard
2. Check version number in top bar (should match new version)
3. Test key features:
   - View users list
   - Create/edit an agent
   - View campaigns
   - Check payment settings
   - Verify external service connections (green indicators)

### Rolling Back If Something Goes Wrong

```bash
# Stop application
pm2 stop agentlabs

# Restore from backup
rm -rf /var/www/agentlabs
cp -r ~/backups/agentlabs-backup-YYYYMMDD /var/www/agentlabs

# Restart
pm2 restart agentlabs
```

---

## Backup & Recovery

### What to Backup

| Component | Contents | Frequency |
|-----------|----------|-----------|
| **Database** | All user data, campaigns, calls | Daily |
| **Uploads Folder** | Knowledge base files, logos | Weekly |
| **Environment File** | Your configuration | After changes |

### Creating Backups

#### Database Backup

```bash
# Create backup folder
mkdir -p ~/backups/database

# Backup database
pg_dump -h localhost -U agentlabs -d agentlabs > ~/backups/database/backup-$(date +%Y%m%d).sql
```

#### Files Backup

```bash
mkdir -p ~/backups/files
cp /var/www/agentlabs/.env ~/backups/files/env-$(date +%Y%m%d)
cp -r /var/www/agentlabs/uploads ~/backups/files/uploads-$(date +%Y%m%d)
```

### Automatic Daily Backups

Create a backup script:

```bash
nano ~/backup-agentlabs.sh
```

Add:

```bash
#!/bin/bash
BACKUP_DIR=~/backups/$(date +%Y%m%d)
mkdir -p $BACKUP_DIR

# Backup database
pg_dump -h localhost -U agentlabs -d agentlabs > $BACKUP_DIR/database.sql

# Backup files
cp /var/www/agentlabs/.env $BACKUP_DIR/
cp -r /var/www/agentlabs/uploads $BACKUP_DIR/

# Remove old backups (keep 30 days)
find ~/backups -type d -mtime +30 -exec rm -rf {} \;

echo "Backup completed: $BACKUP_DIR"
```

Make executable and schedule:

```bash
chmod +x ~/backup-agentlabs.sh

# Add to crontab (runs daily at 2 AM)
crontab -e
# Add: 0 2 * * * ~/backup-agentlabs.sh
```

### Restoring from Backup

```bash
# Stop application
pm2 stop agentlabs

# Restore database
psql -h localhost -U agentlabs -d agentlabs < ~/backups/database/backup-YYYYMMDD.sql

# Restore files
cp ~/backups/files/env-YYYYMMDD /var/www/agentlabs/.env
cp -r ~/backups/files/uploads-YYYYMMDD/* /var/www/agentlabs/uploads/

# Restart
pm2 restart agentlabs
```

---

## Production Deployment

### Using PM2 (Recommended)

```bash
# Install PM2
sudo npm install -g pm2

# Start application
pm2 start npm --name "agentlabs" -- run start

# Configure auto-restart on boot
pm2 startup
pm2 save

# View logs
pm2 logs agentlabs

# Monitor
pm2 monit
```

### Using Nginx Reverse Proxy

```bash
sudo apt install nginx
```

Create `/etc/nginx/sites-available/agentlabs`:

```nginx
server {
    listen 80;
    server_name your-domain.com;

    location / {
        proxy_pass http://localhost:5000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_cache_bypass $http_upgrade;
        proxy_read_timeout 86400;
    }
}
```

Enable:

```bash
sudo ln -s /etc/nginx/sites-available/agentlabs /etc/nginx/sites-enabled/
sudo nginx -t
sudo systemctl reload nginx
```

### SSL with Let's Encrypt

```bash
# Install Certbot
sudo apt install certbot python3-certbot-nginx

# Get certificate
sudo certbot --nginx -d your-domain.com

# Test renewal
sudo certbot renew --dry-run
```

---

## Frequently Asked Questions

### Installation

**Q: How long does installation take?**
A: Basic installation takes 15-30 minutes. Full configuration with all payment gateways takes 1-2 hours.

**Q: Can I install on shared hosting?**
A: No, AgentLabs requires Node.js which most shared hosting doesn't support. Use a VPS or platform like Railway/Render.

**Q: What if I don't have a domain yet?**
A: You can use your server's IP address initially (e.g., `http://123.45.67.89:5000`). Add a domain later.

### Configuration

**Q: Do I need all payment gateways?**
A: No, configure only the ones your customers will use.

**Q: Which AI engine should I use?**
A: Start with ElevenLabs + Twilio for best voice quality and global coverage.

**Q: Can I change settings later?**
A: Yes, all settings can be changed anytime through the Admin Panel.

### Operations

**Q: How do credits work?**
A: 1 credit = 1 minute of call time. Users buy credits or get them through subscription plans.

**Q: What happens when credits run out?**
A: Campaigns automatically pause. Users receive a notification to purchase more.

### Updates

**Q: Will updates delete my data?**
A: No, updates preserve all your data. Always backup before updating as a precaution.

**Q: Can I skip versions?**
A: Yes, you can update from any version to the latest.

---

## Troubleshooting

### Application Won't Start

**Error: "Cannot find module" or dependency errors**
```bash
rm -rf node_modules
npm install
npm run build
```

**Error: "EADDRINUSE - port 5000 already in use"**
```bash
# Find what's using port 5000
lsof -i :5000
# Kill the process
kill -9 [PID]
# Or change PORT in .env
```

**Error: "JavaScript heap out of memory"**
```bash
# Increase Node.js memory limit
export NODE_OPTIONS="--max-old-space-size=4096"
npm run build
```

**Check Node.js version:**
```bash
node --version  # Must be 18.x or higher
```

### Database Errors

**Error: "relation does not exist"**
```bash
# Database tables not created - run migration
npm run db:push
```

**Error: "connection refused" or "ECONNREFUSED"**
```bash
# Check PostgreSQL is running
sudo systemctl status postgresql
sudo systemctl start postgresql

# Verify DATABASE_URL format
# postgresql://user:password@host:5432/database
```

**Error: "permission denied for database"**
```bash
# Grant permissions (in PostgreSQL shell)
sudo -u postgres psql
GRANT ALL PRIVILEGES ON DATABASE agentlabs TO agentlabs;
GRANT ALL ON SCHEMA public TO agentlabs;
\q
```

**Error: "password authentication failed"**
```bash
# Reset password (in PostgreSQL shell)
sudo -u postgres psql
ALTER USER agentlabs WITH PASSWORD 'new_secure_password';
\q
# Update DATABASE_URL in .env with new password
```

### Can't Access Website

**Is application running?**
```bash
pm2 status
# If not running, start it
pm2 start npm --name "agentlabs" -- run start
```

**Firewall blocking port?**
```bash
sudo ufw allow 5000
sudo ufw allow 80
sudo ufw allow 443
```

**502 Bad Gateway with Nginx?**
- Check application is running on correct port
- Verify Nginx proxy_pass matches your PORT
- Check Nginx logs: `sudo tail -f /var/log/nginx/error.log`

### Email Not Sending

**Gmail "Authentication failed":**
1. Ensure 2-Step Verification is enabled
2. Generate App Password (not your regular password)
3. Use the 16-character app password in SMTP_PASS

**Gmail "Less secure app access" error:**
- Use App Password instead (2-Step Verification must be on)
- Do NOT enable "less secure apps" (deprecated)

**Emails going to spam:**
1. Verify sender domain with SPF/DKIM records
2. Use a professional SMTP service (SendGrid, Mailgun)
3. Avoid spam trigger words in subject lines

**SMTP connection timeout:**
```bash
# Check if port 587 is open
telnet smtp.gmail.com 587
# If blocked, try port 465 with SSL
```

### Webhook Errors

**Stripe "Webhook signature verification failed":**
1. Ensure webhook signing secret is correct in Settings
2. Verify webhook URL is exactly: `https://your-domain.com/api/webhooks/stripe`
3. Check for trailing slashes in URL

**Twilio "Invalid signature":**
1. Verify TWILIO_AUTH_TOKEN is correct
2. Ensure webhook URL uses HTTPS (not HTTP)
3. Check URL matches exactly what's configured in Twilio

**PayPal "Webhook 401 Unauthorized":**
1. Verify Client ID and Secret are correct
2. Ensure using Live credentials (not Sandbox) in production
3. Check webhook is registered in PayPal developer dashboard

**Payment webhooks not received:**
1. Verify server is accessible from internet (not localhost)
2. Check webhook URL is correct in gateway dashboard
3. Look for webhook logs in payment gateway dashboard

### Calls Not Working

**Campaign stuck at "Starting":**
1. Check Twilio/Plivo credentials are correct
2. Verify phone numbers are purchased and active
3. Check credits are available
4. Look for errors in logs: `pm2 logs agentlabs`

**Calls immediately disconnect:**
1. Verify webhook URLs are accessible from Twilio/Plivo
2. Check ElevenLabs/OpenAI API key is valid
3. Ensure AI agent is properly configured

**"No available phone numbers":**
1. Purchase phone numbers in Admin > Phone Numbers
2. Check Twilio/Plivo account has sufficient balance
3. Verify geographic permissions are enabled for target countries

**Voice sounds robotic or cuts out:**
1. Check internet connection stability
2. Verify ElevenLabs API quota not exceeded
3. Try different voice model

### Payments Not Processing

**Stripe "No such customer":**
1. Ensure Stripe is in correct mode (Live vs Test)
2. Customer may have been created in different mode

**Razorpay "Invalid signature":**
1. Verify Key Secret is correct (not Key ID)
2. Check webhook secret matches dashboard

**PayPal "Order not approved":**
1. User must complete PayPal checkout flow
2. Check PayPal popup isn't blocked

**General payment issues:**
1. Verify using Live keys in production (not test keys)
2. Check webhook is receiving events (gateway dashboard logs)
3. Ensure webhook signing secrets are configured

### PM2 Issues

**Application not restarting after update:**
```bash
# Clear PM2 cache and restart
pm2 delete agentlabs
pm2 start npm --name "agentlabs" -- run start
pm2 save
```

**View detailed logs:**
```bash
pm2 logs agentlabs --lines 200
```

**Application crashes repeatedly:**
```bash
# Check error logs
pm2 logs agentlabs --err

# Increase memory if needed
pm2 delete agentlabs
pm2 start npm --name "agentlabs" -- run start --node-args="--max-old-space-size=4096"
```

### Getting Help

1. **Check logs first:**
```bash
pm2 logs agentlabs --lines 100
```

2. **Note the exact error message** - Copy the full error text

3. **Contact support via CodeCanyon with:**
   - Your AgentLabs version (Admin Dashboard > top bar)
   - The exact error message
   - Steps to reproduce the issue
   - Your hosting environment (DigitalOcean, AWS, Railway, etc.)
   - Relevant log excerpts

---

## Quick Reference

### Common Commands

```bash
npm run dev          # Start development
npm run start        # Start production
npm run build        # Build application
npm run db:push      # Update database

pm2 start npm --name "agentlabs" -- run start  # Start with PM2
pm2 stop agentlabs   # Stop
pm2 restart agentlabs # Restart
pm2 logs agentlabs   # View logs
```

### Important URLs

| URL | Purpose |
|-----|---------|
| `/` | Main application / Login |
| `/install` | Setup wizard (first run only) |
| `/admin` | Admin panel |
| `/api/system/version` | Check version |
| `/api/system/health` | Health check |

---

*This guide is updated with each release. Check your download package for the latest version.*
