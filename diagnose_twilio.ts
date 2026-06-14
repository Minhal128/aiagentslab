
import { twilioService } from './server/services/twilio';
import { getTwilioAccountSid } from './server/services/twilio-connector';

async function diagnose() {
    try {
        const accountSid = await getTwilioAccountSid();
        console.log(`Current Account SID in App: ${accountSid}`);

        console.log('Fetching owned numbers from Twilio...');
        const numbers = await twilioService.listOwnedNumbers();

        console.log(`Found ${numbers.length} numbers in Twilio account.`);
        numbers.forEach(n => {
            console.log(`- ${n.phoneNumber} (SID: ${n.sid})`);
        });

        const targetNumber = '+441655509999';
        const found = numbers.find(n => n.phoneNumber === targetNumber);

        if (found) {
            console.log(`✅ Success: Found target number ${targetNumber} in Twilio account!`);
            console.log(`Matching SID is: ${found.sid}`);
        } else {
            console.log(`❌ Error: Target number ${targetNumber} NOT found in Twilio account ${accountSid}.`);
        }
    } catch (err) {
        console.error('Diagnosis failed:', err);
    }
}

diagnose();
