const http = require('http');

const ANTHROPIC_KEY = process.env.ANTHROPIC_API_KEY || '';
const SUPABASE_URL = process.env.SUPABASE_URL || 'https://yuzlfocqovwhqdpitvxj.supabase.co';
const SUPABASE_KEY = process.env.SUPABASE_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Inl1emxmb2Nxb3Z3aHFkcGl0dnhqIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzIyODE3OTgsImV4cCI6MjA4Nzg1Nzc5OH0.zN_GOXI8MI9isqnVRCZvxAmU1ZyXIfWvq-P3SkSh4Vk';
// Approved-reporting portal (stackcollect) — NPS from every touchpoint is
// mirrored here so it lands in the central dashboard at approvedreporting.netlify.app.
// Anon key is public-facing, rate-limited, and restricted by RLS to INSERT only
// on nps_scores — same security model as the bot's own SUPABASE_KEY above.
// If either is unset, the portal mirror silently no-ops.
const STACKCOLLECT_SUPABASE_URL = process.env.STACKCOLLECT_SUPABASE_URL || 'https://gfbswivkhfsegpvfocox.supabase.co';
const STACKCOLLECT_SUPABASE_KEY = process.env.STACKCOLLECT_SUPABASE_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImdmYnN3aXZraGZzZWdwdmZvY294Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTkyMzc4ODQsImV4cCI6MjA3NDgxMzg4NH0.YBuuMRXtMu2sUXBG7nJ6ue5LFgkHD8Dj1OP5Zu_J9_U';
const SLACK_WEBHOOK_URL = process.env.SLACK_WEBHOOK_URL || '';
const CRON_SECRET = process.env.CRON_SECRET || 'stacked-cron-secret';

const KNOWLEDGE_BASE = `
You have access to a comprehensive knowledge base of hospitality technology vendor guides.
The knowledge base docs injected below are your PRIMARY source - always use them.

CRITICAL: Never tell a user you lack information about a product if it appears in the docs below.

The knowledge base covers 260+ vendors across 18 hospitality tech verticals:

POINT OF SALE: Tevalis, Zonal, EPOS Now, Lightspeed, Square, Toast, Aloha (NCR Voyix), Oracle MICROS, Revel Systems, Comtrex, Storekit, Pepper, Zettle, SumUp, PayPoint One, Tabology, ICRTouch, Starmicronics, Agilysys InfoGenesis, Par Brink

RESERVATIONS & WAITLIST: SevenRooms, OpenTable, ResDiary, Collins, Quandoo, Resy, Yelp Waitlist, Nowait, Dojo, Tock, Opentable Connect, Livebookings, Eveve, iKentoo, Carbonara, Hostme, Eat App, Waitwhile, TableSpy

WORKFORCE MANAGEMENT: Fourth, Deputy, Sona, Workforce.com, Planday, Rotaready, Bizimply, S4Labour, Harri, HotSchedules, Humanforce, Homebase, When I Work, Nory, Tanda, RotaMaster, Breathe HR, Mitrefinch

PROPERTY MANAGEMENT (HOTELS): Opera (Oracle), Mews, Apaleo, Clock PMS, Protel, Cloudbeds, Little Hotelier, Guestline, RMS Cloud, Siteminder, Rezlynx, HotelTime, StayNTouch, InnStyle, Beds24, WebRezPro, Preno, Roomkey

REVENUE MANAGEMENT: IDeaS, Duetto, Atomize, Pace Revenue, RevControl, Beonprice, Climber, OTA Insight, RateGain, MaxiPims, RevPAR Guru, Amadeus RMS, Infor EzRMS, Juyo Analytics

ONLINE ORDERING & DELIVERY: Deliveroo, Just Eat, Uber Eats, Stuart, Slerp, Flipdish, Hungrrr, Bopple, Preoday, Orderswift, Mobi, HungryPanda, Deliverect, Otter, Flyt, OrderPay

TABLE MANAGEMENT & QR: Lightspeed Restaurant, Zonal Aztec, Tablebooker, MenuZap, Yoello, Pepper, Ordoo, Qikserve, OrderPay, Tissl, Preoday, Vita Mojo, Acteol

LOYALTY & CRM: Acteol, Airship, Bopple, Como, Punchh, Stampede, Paytronix, SevenRooms CRM, Yoyo, Eagle Eye, Loyalzoo, InLoyalty, LoyaltyLion, Klaviyo, Yumpingo, Mecca

PAYMENTS & FINANCE: Dojo, Stripe, Adyen, SumUp, Zettle, Square, Barclaycard, Worldpay, Elavon, PaymentSense, Tyl (NatWest), Lloyds Cardnet, Nuvei, Valitor, Kobas, Soldo, Pleo, Spendesk, Float

INVENTORY & PROCUREMENT: Marketman, Apicbase, Nutritics, Foodics, Fourth Purchasing, Crunchtime, Produce World, Meez, xtraCHEF, Kitchen CUT, Nory, Kcal, Wasteless, Winnow, Spoiler Alert, Kitro

FOOD WASTE & SUSTAINABILITY: Winnow, Too Good To Go, Olio, Karma, Leanpath, Orbisk, Manna, Copia, FoodSteps, Ecotrak, Dishcraft

GUEST ENGAGEMENT & COMMS: Benbria, Revinate, TrustYou, GuestRevu, Medallia, Qualtrics, Hapi, ReviewPro, GuestTalk, Criton, Zingle, Whistle, Kipsu, Alliants, Impala

HR & PEOPLE TECH: Harri, Nory, Breathe HR, HiBob, Rippling, Personio, Cintra, Eploy, Jobtrain, Access HR, BambooHR, Charlie HR, Factorial, Cezanne HR

SCHEDULING & TRAINING: Typsy, Axonify, Beekeeper, Speakap, Fourth Learning, Flow Learning, Pod Learning, Administrate, iHasco, Elucidat, Perkbox

CHANNEL MANAGEMENT & OTAs: SiteMinder, Cloudbeds, D-EDGE, Fastbooking, Travelclick, RateGain, STAAH, Octorate, Beds24, Seekda, WuBook

ANALYTICS & BI: Juyo Analytics, Avero, Nory, Snowflake, Tableau, Power BI, Domo, Yumpingo, Lightspeed Analytics, Tenzo, Airship

KITCHEN & OPERATIONS: Vita Mojo, Flipdish, Apicbase, Push Operations, Mobi, Qu POS, Pronto, Nomad Go, Tendedbar, Meez

WI-FI & GUEST CONNECTIVITY: Stampede, Airwave, Purple Wi-Fi, Ruckus, Eleven Networks, Mist (Juniper), Aruba, Cisco Meraki

General troubleshooting:
- Restart the affected device first
- Check internet/network connection
- Contact vendor support with account number ready

PSP contacts: Worldpay 0330 333 3967, SumUp 020 3510 0160, Square support.squareup.com/en/gb, Stripe 0800 041 8604, Zettle 020 3455 0690, Dojo 0800 060 8085, Adyen support.adyen.com, Elavon 0345 850 0195
`;

// ─── VENDOR PROFILES ─────────────────────────────────────────────────────
const VENDOR_PROFILES = {
  'lightspeed': `LIGHTSPEED RESTAURANT
Support: 0800 023 2777 | support.lightspeedhq.com/hc/en-gb | Chat available in app
Common issues and fixes:
1. OFFLINE MODE - Till shows "offline": Check internet connection. Go to Settings > Connectivity. If on Wi-Fi, try switching to a wired connection or mobile hotspot. Lightspeed requires a stable connection - it caches recent data so you can still process cash sales. Reconnect and sync when back online.
2. RECEIPT/KITCHEN PRINTER NOT PRINTING: Check printer is powered on and paper loaded. In Back Office > Configuration > Printers, verify the printer IP address matches the printer's actual IP (print a self-test page from the printer to confirm). Restart the Lightspeed app after any printer changes.
3. CARD PAYMENTS FAILING: If integrated payments (via Dojo, Square, or Worldpay), check the card reader is connected and paired. Go to POS Settings > Payment > Card. If reader shows offline, restart it. For persistent issues, contact your payment provider - Lightspeed only handles the integration, not the payment processing itself.
4. MENU NOT SYNCING TO POS: Changes made in Back Office take up to 2 minutes to sync. Force sync: close and reopen the Lightspeed POS app. If still not showing, check you published the changes in Back Office (look for the blue "Publish" button).
5. STAFF CAN'T LOG IN: Check the employee has an active account in Back Office > Employees. Ensure their PIN is set (4 digits). If using card swipe login, re-pair the card reader in Settings. For forgotten PINs, a manager can reset in Back Office.
6. END OF DAY / Z-REPORT MISSING: Ensure all open tables are closed before running end of day. Go to Reports > End of Day in Back Office. If the report won't generate, check no floor tables are in "open" state.
Error codes: ERR_NETWORK = connectivity issue. ERR_SYNC = sync failed, force close and reopen app. 401 = authentication expired, log out and back in.
Pro tips: Always keep the app updated. Use Lightspeed Back Office on desktop for menu changes. Set up automated daily reports by email in Back Office > Reports > Scheduled.`,

  'square': `SQUARE FOR RESTAURANTS
Support: squareup.com/help/gb/en | 0800 098 8008 (UK) | Live chat in Square Dashboard
Common issues and fixes:
1. SQUARE READER NOT CONNECTING: Ensure Bluetooth is enabled on the device. Open Square app > More > Hardware > Square Reader and tap "Connect". If reader not showing, hold the reader button for 3 seconds to enter pairing mode. Try forgetting the device in Bluetooth settings and re-pairing. Charge the reader if LED is flashing red.
2. PAYMENT DECLINED / READER ERROR: First check the card reader has a connection (Wi-Fi or mobile data). If offline, Square can take offline payments (enable in Settings > Offline Payments). For chip/PIN issues, clean the chip reader slot. If contactless fails, ask customer to insert card.
3. OFFLINE PAYMENTS MODE: Go to Account > Settings > Offline Payments > Enable Offline Payments. Transactions are stored and processed when connectivity returns. Note: offline payments carry risk - Square will decline cards if total offline exceeds your limit.
4. END OF DAY REPORT NOT MATCHING: Go to Reports > Transactions and filter by today. Check for any voided or refunded transactions. The "Sales Summary" report shows net sales after refunds. Ensure all staff have closed their drawers if using separate cash drawers.
5. STAFF MANAGEMENT / PASSCODE ISSUES: Go to Team > Team Members. Each member needs a unique passcode for the POS. Reset via Dashboard. Ensure the employee has the correct permissions role assigned - this controls what they can access on the till.
6. SQUARE DASHBOARD NOT LOADING: Clear browser cache, try incognito mode. Check status.squareup.com for any outages. Try logging out and back in. If on the app, force close and reopen.
Error codes: CARD_DECLINED = issuing bank declined (try different card). READER_ERROR = hardware issue, restart reader. NETWORK_ERROR = no internet connection.
Pro tips: Use Square's free virtual terminal for phone orders. Enable tipping prompts in Settings > Checkout > Tipping. Use item modifiers for customisations rather than separate items.`,

  'epos now': `EPOS NOW
Support: 0800 2465 256 | support.eposnow.com | Live chat available 24/7
Common issues and fixes:
1. SYSTEM OFFLINE / GREY SCREEN: Check internet connection first. EPOS Now requires internet to function fully - it does not have a true offline mode. Restart the router, then restart the EPOS Now terminal. If using broadband, check the router admin panel for connectivity issues. If problem persists, use the EPOS Now app on a tablet as a backup.
2. TILL CRASHED / FROZEN SCREEN: Hold the power button for 10 seconds to force restart. If the Windows-based terminal, press Ctrl+Alt+Delete and end the EPOS Now process, then relaunch. Check for Windows updates that may be running in the background.
3. RECEIPT PRINTER NOT WORKING: In Back Office > Devices > Printers, check the printer is listed and active. Verify IP address is correct (print a test page from the printer itself). Ensure the printer is on the same network as the till. Restart both the printer and till. Check paper is loaded correctly and not jammed.
4. CARD MACHINE NOT PAIRING (Paymentsense/Dojo integration): Go to Back Office > Integrations > Card Payment. Click "Re-pair" and follow the on-screen steps. The card machine must be on and connected to Wi-Fi. If using Paymentsense, call 0800 048 4422 for pairing support.
5. SOFTWARE UPDATE FAILED: Updates are pushed overnight. If an update fails, go to Back Office > System > Updates and try manually applying. Ensure the terminal stays powered on and connected overnight. If update won't apply, contact EPOS Now support with your account number.
6. ITEM NOT FOUND / WRONG PRICE: Go to Back Office > Products and search for the item. Check the price and that it is set to "active". If a product is showing wrong price on the till, force a sync: Back Office > System > Sync Data.
Error codes: CONNECTION_TIMEOUT = internet issue. SYNC_FAILED = check Back Office > System > Sync log. LICENSE_ERROR = call support, may be billing issue.
Pro tips: Use EPOS Now Orderpad app on tablets for tableside ordering. Enable "Offline Mode Lite" in settings for basic cash sales during outages. Regularly export your product list as a CSV backup.`,

  'icrtouch': `ICRTOUCH (TouchPoint POS)
Support: icrtouch.com/support | Contact your ICRTouch reseller first | 01227 811 811
Common issues and fixes:
1. TOUCHPOINT OFFLINE / WON'T LOAD: Check network connection between the TouchPoint terminal and the BackOffice server (or cloud). ICRTouch can operate in standalone mode if configured - check with your reseller. Restart the TouchPoint application from the Windows taskbar. If BackOffice server is on-site, check the server is running.
2. KITCHEN DISPLAY (TouchKitchen) NOT SHOWING ORDERS: Check the network connection between the POS terminal and the kitchen display unit. In TouchPoint > Setup > Kitchen, verify the KDS IP address is correct. Restart both the POS terminal and the KDS screen. Check that menu items are assigned to the correct kitchen printer/display group.
3. STOCK DEDUCTING INCORRECTLY: Go to BackOffice > Stock > Stock Management and check item recipe/component links. Verify the stock unit of measure matches the selling unit. Run a stock audit report to identify discrepancies. Check that "negative stock" alerts are enabled in BackOffice > Preferences.
4. END OF DAY Z-REPORT NOT RUNNING: Ensure all open tables/tabs are settled before running Z-report. In TouchPoint > Management > End of Period > Z-Report. If the report shows incorrect totals, check for any "training mode" transactions that may have been accidentally processed. Contact your ICRTouch reseller for Z-report discrepancies.
5. PRINTER OFFLINE IN TOUCHPOINT: Go to Setup > Devices > Printers and check the printer status. Verify the IP address. Assign a static IP to your printers to prevent IP changes after router restarts. ICRTouch uses IP printing - ensure no firewall is blocking communication.
6. STAFF PERMISSIONS NOT APPLYING: In BackOffice > Staff > Staff Members, check the employee's security level. Changes to permissions apply at next login. Ensure the employee is not currently logged into a terminal - log them out first.
Error codes: ICR_CONN_ERR = cannot reach BackOffice server. PRINTER_TIMEOUT = printer not responding on network. AUTH_FAIL = incorrect staff PIN or security level.
Pro tips: ICRTouch resellers handle most support - always contact your reseller first. Use TouchOffice Web for remote Back Office access. Enable receipt reprint from the management menu for lost receipt requests.`,

  'tevalis': `TEVALIS
Support: 01923 294446 | tevalis.com/support | support@tevalis.com
Common issues and fixes:
1. SYSTEM WON'T LOAD / BLACK SCREEN: Check the Tevalis service is running on the server (Windows Services > Tevalis). Restart the Tevalis POS application on the terminal. Check network connectivity between terminals and the central server. If cloud-hosted, check internet connection and Tevalis status page.
2. TABLE PLAN NOT SHOWING CORRECTLY: In Tevalis Back Office > Table Plan, check tables are assigned to the correct floor plan. Refresh the table plan on the POS by logging out and back in. If tables are showing as occupied but empty, a manager can force-close open tables in Back Office > Table Management.
3. CARD INTEGRATION ERRORS (Dojo/Worldpay): Check the payment terminal is paired and showing as connected in Tevalis > Integrations > Payment. Re-pair if needed by going through the payment integration setup. If error code shows on the terminal, note the code and call the payment provider.
4. END OF DAY RECONCILIATION: Run Z-report from Tevalis Management > Reports > End of Day. Ensure all floats are declared and all payment types balanced. If figures don't reconcile, check for any offline transactions stored in the system (Tevalis > Offline Transactions).
5. RECEIPT PRINTER OFFLINE: Tevalis uses IP-based printing. Check the printer IP in Back Office > Devices > Printers. Assign static IPs to all printers. Restart the printer and check it's on the same VLAN as the POS terminals.
6. MENU ITEM NOT APPEARING: In Back Office > Menu > Items, check the item is "active" and assigned to the correct menu level and trade period. Sync the menu by closing and reopening the Tevalis POS or using Back Office > Sync.
Error codes: SRV_UNAVAILABLE = cannot reach Tevalis server. PAY_COMM_ERR = payment terminal not responding. SYNC_ERR = menu sync failed.
Pro tips: Tevalis requires a stable LAN connection between all terminals. Use their Table Ordering App for tableside ordering. Regular database backups are managed via Tevalis Back Office > System > Backup.`,

  'zonal': `ZONAL (Aztec POS)
Support: 0131 554 6200 | zonal.co.uk | support@zonal.co.uk
Common issues and fixes:
1. AZTEC POS OFFLINE / NOT RESPONDING: Check network connectivity on the affected terminal. Zonal Aztec connects to a central server - ensure the server (often in the back office) is running. Restart the Aztec application (not the server). Check Windows Event Viewer on the server for error logs.
2. KITCHEN PRINTER NOT FIRING: In Aztec Back Office > Printing > Kitchen Printers, verify the printer is enabled and the IP address is correct. Check the "print rules" to ensure the menu item category is routed to the kitchen printer. Test with a manual print from Back Office.
3. CARD PAYMENT INTEGRATION (Paymentsense/Dojo): Check the EFT terminal is paired with the till. In Aztec > Tenders > Card, verify the integration is "active". For Paymentsense issues, call 0800 048 4422. For Dojo, call 0800 060 8085.
4. REPORTING DISCREPANCIES: Run the "Detailed Sales Report" in Aztec Back Office to check for voided transactions. Ensure all staff have properly closed their sessions. Check for any "training mode" flag being left on - this creates dummy transactions.
5. STAFF SIGN-IN FAILING: Check the employee profile in Back Office > Staff > Employees. Ensure their PIN is set and account is active. Zonal uses magnetic stripe or PIN login - check the swipe reader is working if staff use cards.
6. PROMOTIONS NOT APPLYING: In Back Office > Promotions, check the promotion is active, date range is correct, and qualifying items are included. Promotions can be triggered automatically or manually - verify the trigger type.
Error codes: DB_CONNECT_FAIL = cannot reach Aztec database. EFT_TIMEOUT = card terminal not responding. PRINT_ERROR = printer unreachable.
Pro tips: Zonal's support is enterprise-level - have your site ID ready when calling. Use Zonal's Aztec Web Analytics for remote reporting. Major changes to menus or pricing should be done outside of trading hours.`,

  'dojo': `DOJO PAYMENTS
Support: 0800 060 8085 | help.dojo.tech | Available 24/7
Common issues and fixes:
1. TERMINAL OFFLINE / NOT CONNECTING: Check the terminal's connectivity status (Wi-Fi icon on screen). If Wi-Fi, go to Settings > Wi-Fi and ensure correct network is selected. If SIM-based, check for signal (go to Settings > Mobile Data). Restart the terminal by holding the power button. If still offline after restart, check your router and try a different network.
2. TRANSACTION DECLINED: Ask the customer to try again with PIN rather than contactless. Check the terminal is showing the correct amount. If card is repeatedly declined, the issue is with the customer's bank - advise them to contact their card provider. For Dojo-specific declines (ERR_40x), restart terminal.
3. SETTLEMENT NOT RUNNING: Dojo auto-settles at midnight by default. To manually settle, go to Dojo Hub > Transactions > End of Day. If settlement is late, funds typically arrive next business day. For missing settlements, call Dojo support with your merchant ID.
4. TERMINAL LOST PAIRING WITH EPOS: In your EPOS system, go to the payment integration settings and select "re-pair". On the Dojo terminal, go to Settings > Integrations > [your EPOS name] and pair. Both devices must be on the same Wi-Fi network for IP-based pairing.
5. SOFTPOS (PHONE AS TERMINAL) NOT WORKING: Ensure NFC is enabled on the phone (Settings > NFC). Update the Dojo SoftPOS app. The phone must be unlocked and the app open to accept payments. If contactless won't read, clean the NFC area and ask customer to hold card flat.
6. REFUND PROCESSING: On the terminal, press the menu button > Transactions > Find Transaction > Refund. Refunds typically take 3-5 business days to reach the customer. Partial refunds are supported. If you can't find the original transaction, call Dojo support.
Error codes: ERR_001 = no connection. ERR_400 = invalid transaction. ERR_500 = internal error, restart terminal. DECLINE_05 = do not honour (customer's bank).
Pro tips: Use Dojo Go (app + reader) for mobile payments. Enable digital receipts to reduce paper. Dojo Hub (hub.dojo.tech) gives full transaction history and reporting.`,

  'worldpay': `WORLDPAY
Support: 0330 333 3967 | worldpay.com/en-gb/support | Available 24/7
Common issues and fixes:
1. TERMINAL OFFLINE: Check broadband connection - Worldpay terminals typically use a fixed broadband line rather than Wi-Fi for reliability. Check the terminal's connectivity indicator. If using Wi-Fi, ensure the terminal is within range and on the correct network. Restart the terminal using the restart option in the terminal menu (not just power off).
2. BATCH SETTLEMENT FAILURE: Worldpay terminals auto-batch overnight. If a batch fails, you'll see an error on the terminal. Go to Worldpay Business Manager > Transactions to check status. Call 0330 333 3967 with your merchant number to investigate missed settlements.
3. CARD DECLINED UNEXPECTEDLY: Run a test transaction on a known good card. If other cards work, the issue is with that specific card/bank. If all cards are declining, check your terminal is not in "test mode" (check with Worldpay support). Verify your merchant account is not suspended.
4. TERMINAL WON'T PRINT RECEIPT: Check paper roll is loaded correctly - thermal paper shiny side facing the print head. Check there's no paper jam. Go to terminal menu > Admin > Print Test to verify printer is working. If no print, the terminal may need a service call.
5. CONTACTLESS NOT WORKING: Ensure contactless is enabled (Worldpay Back Office > Terminal Settings). The customer's card may have exceeded contactless limits - ask them to insert and use PIN. Clean the contactless reader area if foreign object may be blocking it.
6. WRONG AMOUNT CHARGED: Void the transaction immediately if same day (terminal menu > Void). If not same day, process a refund from Worldpay Business Manager or via the terminal. Call 0330 333 3967 for assistance with disputed amounts.
Error codes: LINK DOWN = no network. HOST UNAVAIL = cannot reach Worldpay servers. DECLINED = card issuer declined. VOID OK = void successful.
Pro tips: Keep your merchant ID and terminal serial number accessible for support calls. Use Worldpay Business Manager for online reporting. Enable email receipts via Business Manager to reduce paper consumption.`,

  'sumup': `SUMUP
Support: 020 3510 0160 | help.sumup.com/en-GB | In-app support chat
Common issues and fixes:
1. CARD READER NOT CHARGING: Use the provided USB-C cable and a 5V/1A charger. Avoid fast chargers. Charge for at least 2 hours before first use. The LED indicator: solid red = charging, solid green = full. If reader doesn't charge at all, try a different cable. Readers have a 1-year warranty - contact SumUp for replacement if faulty.
2. BLUETOOTH CONNECTION PROBLEMS: On your phone, go to Bluetooth settings and "Forget" the SumUp reader. In the SumUp app, go to Card Reader and follow the pairing steps again. Keep the phone within 1 metre of the reader during pairing. If using iOS, ensure Bluetooth permissions are granted to the SumUp app.
3. APP CRASHES OR FREEZES: Force close the SumUp app and reopen. Ensure the app is up to date (check App Store or Google Play). Check your phone has enough free storage (at least 1GB free). If persistent, uninstall and reinstall the app - your account data is stored in the cloud.
4. PROCESSING A REFUND: In the SumUp app, go to Sales > find the transaction > select "Refund". Refunds must be within 30 days of the original transaction. The refund goes back to the original payment method. SumUp fees are not refunded when you issue a refund.
5. DAILY / MONTHLY LIMITS: SumUp accounts start with limits that increase as you process more. If you hit your limit, transactions will be declined. Go to SumUp account settings to request a limit increase, or call support. Limits are based on your account verification level.
6. PAYOUT NOT RECEIVED: Go to SumUp app > Payouts to check payout status. Standard payouts take 1-3 business days. Ensure your bank account details are correct in account settings. New accounts may have a 7-day initial hold.
Error codes: ERR_01 = communication error (retry). ERR_05 = declined by bank. ERR_14 = invalid card number. READER_NOT_FOUND = Bluetooth issue.
Pro tips: SumUp Air reader works with phones and tablets. Enable the SumUp POS app for more advanced till features. Use SumUp Invoices for B2B payments.`,

  'zettle': `ZETTLE BY PAYPAL
Support: 020 3455 0690 | zettle.com/gb/help | help.zettle.com
Common issues and fixes:
1. CARD READER NOT RESPONDING: Check the reader has battery (LED indicator - tap the power button once to check). Charge via USB-C. Restart the reader by holding the power button for 5 seconds. In the Zettle app, go to Settings > Card Readers and try reconnecting. If reader not showing, enable Bluetooth on phone and re-pair.
2. NO INTERNET ERROR DURING PAYMENT: Zettle requires internet to process payments. Switch from Wi-Fi to mobile data or vice versa. Check your phone's data connection. If in a venue with poor signal, move to an area with better connectivity. Zettle does not have an offline payment mode.
3. INCORRECT AMOUNT PROCESSED: If already processed, go to Zettle app > History > find transaction > Refund. If not yet processed, cancel the transaction before completion. Always double-check amount on reader screen before customer taps/inserts card.
4. REFUND PROCESS: Go to Zettle app > Transactions > select the transaction > Issue refund. Enter the refund amount. The customer does not need to be present if refunding to original card. Refunds take 5-10 business days to appear in customer's account.
5. ZETTLE POS LIBRARY NOT SYNCING: If using Zettle POS for restaurants/retail, go to Library > sync. If items are missing, check they are active in the Zettle Back Office (my.zettle.com). Add items in Back Office and they will sync to the app.
6. PAYOUT DELAYS: Go to my.zettle.com > Finance > Payouts to check status. Standard payout is next business day for verified accounts. For new accounts, first payout may take up to 5 business days. Ensure bank details are verified in account settings.
Error codes: NET_ERR = no internet. AUTH_FAIL = session expired, log out and back in. DECLINED = card issuer declined. AMOUNT_MISMATCH = card amount doesn't match requested amount.
Pro tips: Use Zettle Go for simple payments, Zettle POS for full EPOS. Connect a receipt printer via Bluetooth for printed receipts. Use multiple readers with staff management for teams.`,

  'deputy': `DEPUTY (WORKFORCE MANAGEMENT)
Support: help.deputy.com | In-app support chat | deputy.com
Common issues and fixes:
1. SCHEDULE NOT PUBLISHING TO STAFF: After creating/editing the schedule, click the "Publish" button (top right in schedule view). Staff receive the notification via email and Deputy app. Check staff have the Deputy app installed and notifications enabled. If staff say they haven't received it, check their email in People > Employees > verify email address is correct.
2. TIMESHEET ERRORS / CLOCKED-IN TIME WRONG: Go to Timesheets > select the employee > click the timesheet to edit. Managers can manually adjust clock in/out times before approval. If employee forgot to clock out, their timesheet will show as "still clocked in" - manually add the clock out time.
3. EMPLOYEE NOT APPEARING IN SCHEDULE: Check the employee is "active" in People > Employees. Ensure they are assigned to the correct location/area. Check their start date is not in the future. If using custom roles, verify the role is available at the location.
4. PAYROLL EXPORT FAILING: Go to Pay > Payroll > Export. Check the payroll period is set correctly and all timesheets in the period are approved. If export fails, check you have the correct payroll integration configured (Xero, QuickBooks, MYOB etc). For integration issues, check the integration settings in Deputy > Settings > Integrations.
5. LEAVE / ABSENCE NOT REFLECTING IN SCHEDULE: Go to Leave > check the leave request is approved. Approved leave should automatically block the employee in the schedule. If not reflecting, check Leave Settings > Blackout rules are not overriding the leave.
6. AWARD INTERPRETATION ERRORS (AU/NZ): Deputy's award interpretation is complex. Go to Settings > Award Rules and verify the correct award is selected for each employee type. Test with a timesheet to see the calculated pay. If interpretation seems wrong, check employee contract type matches the award rule.
Error codes: AUTH_ERROR = session expired, log back in. SYNC_FAILED = integration connection issue. EXPORT_ERR = payroll export failed, check period status.
Pro tips: Use Deputy Kiosk mode on a tablet for clocking in/out. Enable geofencing to restrict clock-ins to venue location. Use Deputy's open shift feature for flexible staffing.`,

  'fourth': `FOURTH (HOTSCHEDULES / WORKFORCE)
Support: 020 3763 5000 | fourth.com/support | support@fourth.com
Common issues and fixes:
1. ROTA NOT VISIBLE TO STAFF: After building the schedule in Fourth, ensure you have "Published" it (not just saved). In HotSchedules, go to Scheduling > Publish Schedule. Staff are notified by email/push notification. If staff say they can't see their schedule, check their app is updated and they are logging into the correct location.
2. MOBILE APP LOGIN ISSUES: Staff should download "HotSchedules" app (not Fourth app). Login uses their HotSchedules credentials. If forgotten, use "Forgot Password" on the login screen. If account is locked, a manager must reset in Fourth > Team > Employees > Reset Password. New employees need to be sent an activation email first.
3. PAYROLL INTEGRATION ERRORS: Go to Fourth > Settings > Payroll Integration. Check the integration is connected and credentials are valid. If exporting to Sage, Xero, or another system, ensure the export period matches the payroll period. For persistent integration errors, call 020 3763 5000.
4. ABSENCE REQUESTS NOT APPEARING: Employees submit absence in the HotSchedules app > My Schedule > Request Time Off. Managers approve in Fourth > Time Off. Check the approval notifications are enabled for managers. Approved absence should automatically update the schedule.
5. REPORTING / LABOUR COST ISSUES: Go to Fourth > Reports > Labour Analysis. Ensure the date range is correct. If labour costs seem wrong, check employee hourly rates are correctly entered in People > Employees. Fourth uses scheduled vs actual hours - ensure timesheets are being approved for accurate actuals.
6. NEW EMPLOYEE ONBOARDING: Add employee in Fourth > People > Add Employee. Complete all mandatory fields. An activation email is sent to the employee's email address. They must activate before they can use the app. If email not received, check spam or resend from employee profile.
Error codes: SSO_FAIL = single sign-on error, try direct login. EXPORT_TIMEOUT = large export taking too long, try smaller date range. SYNC_ERR = integration sync failed.
Pro tips: Use Fourth's demand forecasting to build rotas based on historical covers. Enable push notifications for all staff. Use the Fourth Forecasting module if you have it enabled.`,

  'rotaready': `ROTAREADY
Support: rotaready.com/support | support@rotaready.com | In-app chat
Common issues and fixes:
1. ROTA NOT PUBLISHING: In Rotaready, after building your rota, click "Publish" and select the week(s) to publish. Staff are notified via email and the Rotaready app. If staff can't see the rota, check they have the app installed and have verified their email. In People > Staff, check their notification preferences.
2. PAYROLL EXPORT ISSUES: Go to Payroll > Export. Select the correct pay period and ensure all hours are approved. Rotaready integrates with Sage, Xero, and other payroll systems. If export shows wrong figures, check for unapproved overtime or unpaid breaks not being deducted. Contact support with specific payroll discrepancies.
3. ABSENCE MANAGEMENT: Staff request absence via the Rotaready app > My Requests. Managers approve/decline in Rotaready > Absence > Requests. Approved absence blocks the employee in the rota. Configure absence types and accrual rules in Settings > Absence.
4. NEW STARTERS NOT IN SYSTEM: Add in People > Add Person. Enter name, email, role, and cost centre. Send the welcome email from their profile. They must activate their account before they can clock in or view rotas. If they don't receive the welcome email, check the email address and resend.
5. TIME AND ATTENDANCE DISCREPANCIES: Rotaready clocking uses the app (GPS-based) or a PIN terminal. Go to Attendance > Time Cards to review clock in/out times. Managers can edit time cards before approval. Ensure employees are clocking in via the correct location to avoid GPS mismatch.
6. COST CENTRE / DEPARTMENT ERRORS: Go to Settings > Cost Centres and verify the structure. Each shift can be tagged to a cost centre. If labour costs are appearing in the wrong department, check shift assignments and default cost centres for each employee role.
Error codes: AUTH_ERR = login issue, reset password. SYNC_FAIL = payroll integration issue. GPS_FAIL = cannot verify location for clocking.
Pro tips: Use Rotaready's labour cost percentage tool to monitor spend vs revenue. Enable demand-based scheduling if you have till data integrated. Use the "notes" feature on shifts for specific instructions.`,

  's4labour': `S4LABOUR
Support: s4labour.com/support | support@s4labour.com | 01635 897 298
Common issues and fixes:
1. FORECASTING NOT ACCURATE: S4Labour uses historical sales data for forecasting. If forecasts are off, check the data feed from your EPOS is connected (Settings > Integrations). Ensure sufficient historical data exists (at least 4-8 weeks). Manually adjust forecasts in the Forecast tab by percentage or covers where needed.
2. ROTA ERRORS / SHIFTS NOT SAVING: Check you are working in the correct week and location. After making changes, always save before navigating away. If a shift shows a wage percentage warning, this is advisory - it can still be saved. For recurring issues with saves, clear browser cache.
3. WAGE PERCENTAGE CALCULATIONS WRONG: Go to Settings > Pay Rates and check all employee pay rates are correctly entered. Salaried employees should have their equivalent hourly rate entered. Check the correct trading period / session is being selected for the forecast comparison. Overtime rules may be affecting calculations.
4. CLOCK IN / OUT ISSUES: S4Labour uses a tablet-based clock-in system or integration with your EPOS. If staff can't clock in, check the S4Labour Clock app on the tablet has internet access. Verify the employee is rostered for that location. Managers can manually add clock records in Timesheets > Edit.
5. HR MODULE / EMPLOYEE DOCUMENTS: Go to HR > Documents to upload staff contracts, right to work documents etc. Set expiry reminders for time-limited documents (visas, food hygiene certs). If a document alert is showing, navigate to the employee's HR profile and update the document.
6. PAYROLL EXPORT: Go to Payroll > Export. Choose the pay period and format (Sage, Xero, CSV etc). Ensure all timesheets for the period are approved. If figures don't match expectations, check for manual pay adjustments in Timesheets > Adjustments.
Error codes: INTEG_ERR = EPOS data feed issue. AUTH_FAIL = session expired. EXPORT_LOCK = payroll period already exported, contact admin.
Pro tips: S4Labour is designed for multi-site hospitality. Use the Dashboard for real-time wage % across all sites. Configure the automatic shift-pattern feature to speed up rota building.`,

  'sevenrooms': `SEVENROOMS
Support: support.sevenrooms.com | support@sevenrooms.com | In-platform chat
Common issues and fixes:
1. RESERVATION NOT SHOWING IN SYSTEM: Check the booking was confirmed - the guest should have received a confirmation email. In SevenRooms > Reservations, search by guest name, email, or date. If booked via the widget, check the widget integration is active. If booked through a third party (Google, TripAdvisor), check the channel integration is enabled.
2. BOOKING WIDGET NOT LOADING: Check your website's embed code - it should be the most recent version from SevenRooms > Settings > Widget. Test the widget in an incognito browser window. If widget shows "no availability" incorrectly, check your shift settings and covers availability in SevenRooms > Settings > Shifts.
3. POS INTEGRATION NOT SYNCING SPEND DATA: Go to SevenRooms > Settings > Integrations > POS. Check the integration is active and the API credentials are correct. POS spend data syncs throughout the day - if spend is not appearing on guest profiles, check the POS is sending transaction data (may need POS-side configuration).
4. REPORTING ISSUES: Go to SevenRooms > Analytics for dashboards. For custom reports, use Reports > Custom Reports. If data seems missing, check the date range and location filters. Data refreshes throughout the day - real-time data may have a 15-minute delay.
5. WAITLIST NOT WORKING: Ensure Waitlist is enabled in Settings > Waitlist. Guests can be added manually (New > Waitlist) or self-serve via the widget. If guests are not being notified when a table becomes available, check their phone number is in the system and SMS notifications are enabled.
6. TAGS AND SEGMENTS NOT WORKING: Tags must be applied to guest profiles first. Go to a guest profile and add tags manually, or use bulk tagging via Guest > All Guests > Bulk Actions. For automated tagging, set up Automation rules in Settings > Automation.
Error codes: API_AUTH_FAIL = POS integration credentials expired. WIDGET_CONFIG_ERR = widget settings misconfigured. SYNC_TIMEOUT = POS sync taking too long.
Pro tips: Use SevenRooms Automated Emails to send pre-arrival and post-visit messages. Configure shift pacing to prevent over-seating at peak times. Use the SevenRooms CRM for follow-up marketing campaigns.`,

  'opentable': `OPENTABLE
Support: 020 3826 8100 | help.opentable.com | restaurants@opentable.com
Common issues and fixes:
1. RESERVATIONS NOT SYNCING / MISSING BOOKINGS: In OpenTable > Reservations, pull-to-refresh or press the sync button. If reservations from the widget or app are not appearing, check your OpenTable plan includes real-time syncing. For missing third-party bookings, check the channel is connected in Settings > Channels. If a guest can't see their booking, search by email in the reservation system.
2. GUEST-FACING BOOKING ERRORS / WIDGET DOWN: Check status.opentable.com for any platform issues. In OpenTable Restaurant Centre, go to Settings > Booking Profile and ensure your availability settings are correct. If the widget on your website is broken, re-copy the embed code from Restaurant Centre > Marketing > Booking Widget.
3. POS INTEGRATION NOT UPDATING: OpenTable integrates with Lightspeed, Square, and others. Go to Settings > Integrations > POS and check the integration status. If the POS is not receiving guest count or booking data, reconnect the integration. Some integrations are read-only (OpenTable to POS) and some are two-way.
4. REVIEWS / GUEST FEEDBACK: Guests receive automatic review requests after their visit. To view reviews, go to Guest Centre > Reviews. If negative reviews are concerning, respond via the platform. You cannot remove reviews, but OpenTable may remove ones that violate their guidelines.
5. NO-SHOW HANDLING: Mark no-shows in the reservation system by 11:59pm on the date of the reservation. In OpenTable > Reservations, change the status to "No Show". This automatically sends the guest a no-show notification and may affect their Dining Points. Configure no-show fees in Settings > Reservation Fees if you use prepayment.
6. AVAILABILITY / TABLE MANAGEMENT: Manage available times and covers in Restaurant Centre > Schedule. If you're showing more availability than you want, reduce cover limits in Schedule > Shift settings. Use "Stop Accepting" for today if you need to close availability immediately.
Error codes: SYNC_ERR = reservations not syncing, check internet. API_LIMIT = too many requests, wait and retry. POS_CONN_FAIL = POS integration disconnected.
Pro tips: Use OpenTable's Network to gain exposure to new guests. Enable Experiences for special event bookings. Use the OpenTable Connect programme for commission-free bookings.`,

  'resdiary': `RESDIARY
Support: 0141 271 0770 | resdiary.com | support@resdiary.com
Common issues and fixes:
1. BOOKING WIDGET DOWN OR NOT SHOWING AVAILABILITY: Log in to ResDiary back office and check Settings > Online Booking. Ensure online booking is enabled for the correct services. Check the date/time restrictions. If the widget is on your website, verify the embed code is still the active version. Test in incognito mode.
2. RESERVATIONS NOT CONFIRMED / GUESTS NOT GETTING EMAILS: Go to ResDiary > Communications > Email Settings. Verify confirmation emails are enabled. Check the "From" email address is not blocked by spam filters. For specific bookings, go to Reservations > find booking > check "confirmation sent" tick. Resend from the booking if needed.
3. TABLE PLAN SYNC ISSUES: If tables on the table plan don't match physical layout, go to Settings > Table Plan and edit. Ensure each table has a correct cover count. If tables are showing as occupied when free, check for ghost reservations (bookings that were not properly cancelled) - search in Reservations > All > check that date.
4. REPORTS NOT GENERATING CORRECTLY: ResDiary reports run on confirmed reservations only by default. Go to Reports and check the filter settings - include cancelled, no-shows, or partial-seated as needed. If covers count seems wrong, check for the "walk-in" count which is tracked separately.
5. INTEGRATION ERRORS WITH EPOS OR THIRD PARTIES: Go to Settings > Integrations. Each integration (Lightspeed, Zonal etc) will show its connection status. If disconnected, re-authenticate using the vendor's API credentials. Google Reserve and TripAdvisor integrations are common - check each channel separately.
6. PREPAYMENT / DEPOSITS NOT PROCESSING: ResDiary uses Stripe for deposit processing. Go to Settings > Payments > Stripe and verify your Stripe account is connected. If deposits are failing, check Stripe's dashboard for declined charges. Ensure the deposit amount and trigger conditions (party size, time to booking) are correctly configured.
Error codes: AUTH_FAIL = login session expired. STRIPE_ERR = payment processing issue. WIDGET_UNAVAIL = online booking service error.
Pro tips: Use ResDiary's Yield Management to dynamically adjust availability based on demand. Set up automated waitlist emails. Use custom guest notes fields to capture dietary requirements at booking stage.`,

  'collins': `COLLINS BY DESIGNMYNIGHT
Support: support.designmynight.com | support@designmynight.com
Common issues and fixes:
1. BOOKING NOT CONFIRMED / MISSING CONFIRMATION EMAIL: In Collins > Bookings, search for the booking by name or email. Check the booking status - if "Unconfirmed", it needs manual confirmation. Click the booking and select "Confirm". The guest will then receive their confirmation email. Check your Collins email settings ensure the "From" address is correctly configured.
2. PAYMENT LINKS NOT WORKING: Collins uses Stripe for payment links. Go to Settings > Payments and verify Stripe is connected. Check the payment link hasn't expired (links expire after 24 hours by default). If a payment fails, check Stripe Dashboard for the specific failure reason. Resend a new payment link from the booking.
3. PRE-ORDERS NOT APPEARING: If you have a pre-order menu set up, guests select items during booking. Go to Bookings > select booking > Pre-orders tab to view selections. If pre-orders are missing, check the menu was active when the booking was made. Ensure pre-order prompts are enabled for the booking type in Settings > Booking Types.
4. CRM / GUEST DATA SYNC ISSUES: Collins integrates with Airship, Mailchimp, and others. Go to Settings > Integrations > CRM. If guest data is not syncing, disconnect and reconnect the integration. Check that marketing consent is being captured at booking stage (required for GDPR compliance).
5. REPORTING: Go to Collins > Reports. Standard reports include enquiries, bookings, revenue, and capacity. For custom date ranges, adjust the filters. If revenue is not matching expectations, check for any bookings where payment was not taken or was refunded.
6. WIDGET CUSTOMISATION: Go to Settings > Widget to adjust colours, fields, and booking types shown on your website widget. After changes, the widget updates immediately - no new embed code needed. Test on your live website in incognito mode to confirm changes appear.
Error codes: STRIPE_DECLINED = payment failed, check Stripe dashboard. EMAIL_BOUNCE = guest email invalid or bounced. SLOT_UNAVAIL = requested time fully booked.
Pro tips: Use Collins Enquiries for large group bookings that need a bespoke quote. Enable deposit requirements for bookings over a certain party size to reduce no-shows. Use the cancellation policy feature to enforce notice periods.`,

  'deliverect': `DELIVERECT
Support: support.deliverect.com | support@deliverect.com | In-platform chat
Common issues and fixes:
1. ORDERS NOT COMING THROUGH TO EPOS: Check Deliverect > Order Flow > Live Orders. If orders show in Deliverect but not reaching the EPOS, check the EPOS integration status in Deliverect > Settings > Integrations. Restart the Deliverect service on the EPOS if applicable (e.g. for EPOS Now or ICRTouch). Check the EPOS printer is online as many systems alert via kitchen printers.
2. MENU NOT SYNCED ACROSS CHANNELS: If you've updated your menu in the EPOS or in Deliverect but the delivery channel (Deliveroo, Uber Eats, Just Eat) still shows old items, go to Deliverect > Menus > select menu > Publish to Channels. It can take 15-30 minutes for channels to update. Check the channel directly to confirm.
3. CHANNEL SHOWING AS OFFLINE: Go to Deliverect > Channels and check the status. If a channel is offline, try reconnecting by going to the channel settings and clicking "Reconnect". If Deliveroo or Uber Eats is offline, check their respective restaurant portals to ensure your store is marked as open. Some channels require manual re-authentication.
4. TABLET ISSUES (DELIVERECT TABLET): If using a Deliverect-branded tablet, ensure it has a strong internet connection. Restart the tablet. The Deliverect app auto-updates - check the app version in Settings. If the tablet is stuck, factory reset and reinstall the Deliverect app using your credentials.
5. POS INJECTION FAILING (ORDERS NOT GOING INTO EPOS): Check Deliverect > Diagnostics > POS Connection. If the POS connection is shown as "Error", the EPOS API may need reconfiguring. Common fix: in your EPOS back office, regenerate the API key and update it in Deliverect Settings > Integrations > your EPOS. Contact Deliverect support for EPOS-specific injection issues.
6. MENU ITEM MAPPING ERRORS: Go to Deliverect > Menus > Menu Items. Each item should have the correct PLU code matching your EPOS. If items are "unmapped" or "unlinked", orders for those items won't inject into the EPOS. Map each item by searching for the corresponding EPOS product.
Error codes: POS_INJECT_FAIL = order failed to reach EPOS. CHANNEL_OFFLINE = delivery platform not connected. MENU_SYNC_ERR = menu publish failed.
Pro tips: Use Deliverect's Smart Pricing to adjust prices on delivery channels vs in-house. Enable auto-accept for orders to save time during busy periods. Use Deliverect Analytics to compare channel performance.`,

  'flipdish': `FLIPDISH
Support: flipdish.com/support | support@flipdish.com | In-platform chat
Common issues and fixes:
1. APP ORDERS NOT REACHING EPOS: Check Flipdish > Orders > Live. If orders show in Flipdish but not in the EPOS, check the POS integration in Flipdish > Settings > Integrations. The EPOS must be online and the integration active. For ICRTouch, EPOS Now, and Lightspeed integrations, a middleware service may need restarting.
2. MENU UPDATE DELAYS: After updating menu in Flipdish > Menu Manager, changes go live within 5-10 minutes. If still not updated after 15 minutes, go to Menu Manager > Publish. App users may need to close and reopen the app. For website ordering, hard refresh (Ctrl+Shift+R) to see changes.
3. PAYMENT FAILURES: Flipdish uses Stripe for payment processing. If customers report payment failures, check Stripe Dashboard via Flipdish > Settings > Payments > Stripe Account. Common causes: declined by bank, incorrect card details, 3D Secure authentication failing. Flipdish does not store card details - all payments are handled by Stripe.
4. DRIVER TRACKING NOT WORKING: Driver tracking requires the driver to have the Flipdish Driver app installed and location permissions enabled. Customers see tracking via the order confirmation page. If tracking is not updating, the driver may have location permissions off. Drivers must be assigned to the order in the Flipdish driver portal.
5. PROMOTIONS NOT APPLYING: Go to Flipdish > Marketing > Promotions. Check the promo code is active, not expired, and the qualifying conditions are met (minimum order, eligible items). Promo codes are case-sensitive on some setups. Test with a test order before promoting to customers.
6. STORE SHOWING AS CLOSED WHEN OPEN: Go to Flipdish > Settings > Opening Hours and verify correct hours are set. Check for any "forced closure" that may have been set (Settings > Store Status). If integrating with EPOS, the store status may be pulled from the EPOS - check the EPOS is showing as open.
Error codes: POS_CONN_ERR = EPOS integration issue. STRIPE_DECLINE = payment failed. MENU_PUBLISH_FAIL = menu changes not published.
Pro tips: Use Flipdish's marketing automation for abandoned cart emails. Enable pre-orders for events or collection slots. Use the Flipdish Kiosk for self-service ordering in-venue.`,

  'airship': `AIRSHIP (LOYALTY & CRM)
Support: airship.co.uk | support@airship.co.uk
Common issues and fixes:
1. EMAILS NOT SENDING / DELIVERY ISSUES: Go to Airship > Campaigns and check the campaign status. If "Scheduled" or "Sending", it may still be in progress. Check Airship > Reports > Email Deliverability for bounce rates. High bounce rates indicate bad email addresses in your list. Use Airship > Contacts to clean invalid emails. Check domain authentication (DKIM/SPF) is set up correctly in your DNS.
2. CUSTOMER DATA SYNC NOT WORKING: Airship syncs with EPOS and reservation systems via APIs. Go to Settings > Integrations and check each integration's status. If data is not flowing, re-authenticate the connection. New customers added in the EPOS may take up to 24 hours to appear in Airship.
3. LOYALTY POINTS NOT ACCRUING: Check the loyalty rules in Airship > Loyalty > Rules. Ensure the rule trigger is correct (e.g. "on purchase" via POS). Verify the EPOS integration is sending transaction data. For manual point adjustments, go to a customer profile > Loyalty > Adjust Points.
4. INTEGRATION WITH EPOS FAILING: Go to Settings > Integrations > your EPOS. Check API credentials are correct and not expired. Re-generate API keys in the EPOS if needed and update in Airship. Contact Airship support with specific error messages from the integration log.
5. CUSTOMER SEGMENTS NOT UPDATING: Airship segments are dynamic and rebuild on a schedule (typically overnight). If a segment appears to have wrong counts, wait 24 hours and check again. For immediate refresh, contact Airship support. Verify the segment conditions are correctly defined.
6. AUTOMATIONS NOT TRIGGERING: Go to Airship > Automations and check the automation is "Active". Verify the trigger event matches what's actually happening in your EPOS/booking system. Check that the customer profile has the required data for the trigger (e.g. birthday date for birthday automations).
Error codes: AUTH_ERR = API credentials invalid. SYNC_FAIL = data integration issue. SEND_BLOCK = sending blocked, check compliance settings.
Pro tips: Use Airship's segmentation for targeted win-back campaigns. Enable transactional emails for booking confirmations and receipts. Use A/B testing on subject lines to improve open rates.`,

  'stampede': `STAMPEDE (WIFI & LOYALTY)
Support: stampede.ai | support@stampede.ai | In-platform chat
Common issues and fixes:
1. PORTAL NOT LOADING / ADMIN DASHBOARD INACCESSIBLE: Clear browser cache and try again. Try a different browser. Check stampede.ai status page for any platform issues. If using a company firewall, ensure stampede.ai is whitelisted. Contact support if the dashboard remains inaccessible.
2. GUEST WIFI DOWN / SPLASH PAGE NOT APPEARING: Check the Stampede hardware (router/access point) is powered on and connected. In Stampede portal, go to Locations > your location > Network Status. If the device shows as "offline", it has lost connection to Stampede servers - check the internet connection on the device's network. Restarting the Stampede hardware often resolves this.
3. SPLASH PAGE ISSUES / BRANDING NOT UPDATING: After changing the splash page in Stampede > Locations > Splash Page Editor, changes may take up to 10 minutes to propagate. Force a reconnect by disconnecting from the guest WiFi and reconnecting. If the old splash page still appears, clear your device's WiFi settings for that network.
4. DATA CAPTURE NOT WORKING / NO GUEST SIGN-UPS: Check the capture form fields in Splash Page Editor. Ensure at least one field (email or phone) is set to "required". Verify the correct form is linked to the network. Test by connecting to the guest WiFi yourself and completing the sign-up flow.
5. MAILCHIMP / EMAIL INTEGRATION SYNC FAILING: Go to Settings > Integrations > Mailchimp. If disconnected, click "Reconnect" and re-authorise with your Mailchimp account. Verify the correct Mailchimp list/audience is selected. New contacts sync in near real-time but may take up to an hour.
6. MARKETING CAMPAIGNS NOT SENDING: Go to Stampede > Marketing > Campaigns. Check the campaign is scheduled correctly and the audience segment is not empty. If using SMS, verify you have sufficient SMS credits in your account. Email campaigns require a verified "From" address.
Error codes: DEVICE_OFFLINE = Stampede hardware not connected to internet. AUTH_FAIL = portal login expired. INTEG_ERR = third-party integration disconnected.
Pro tips: Use Stampede's footfall analytics to understand peak times. Enable the loyalty stamp card feature for repeat visit rewards. A/B test different splash page designs to improve sign-up rates.`,

  'nutritics': `NUTRITICS
Support: nutritics.com/support | support@nutritics.com | In-platform chat
Common issues and fixes:
1. ALLERGEN INFORMATION NOT DISPLAYING: In Nutritics, go to Menu > select the item > Allergens tab. Ensure all 14 major allergens are reviewed and the "Contains" or "May Contain" status is set for each. If displaying on a menu or website, check the allergen display settings in Publishing > Allergen Display. If using a QR code menu, ensure the QR code points to the current published version.
2. RECIPE COSTING ERRORS: Go to Recipes > select recipe > check ingredient costs. Costs pull from the Ingredient Library - verify each ingredient has an up-to-date cost per unit entered. Check portion sizes are correctly entered (grams vs kg). If costs seem wrong, run a Recipe Cost Report from Reports > Costing.
3. MENU NOT PUBLISHING TO WEBSITE/TABLETS: After making changes, go to Menu > Publish. Select the channels to publish to (website, app, QR code). If a specific channel isn't updating, check that channel's configuration in Settings > Publishing Channels. For website integration, your web team may need to update the embed code if it was recently changed.
4. DATA IMPORTS FAILING: Nutritics accepts CSV imports for ingredients and recipes. Go to Import > download the CSV template and ensure your data matches the format exactly. Common issues: incorrect column headers, special characters in names, missing required fields. Check the import error log for specific row failures.
5. NUTRITIONAL CALCULATIONS SEEM WRONG: Go to the recipe and check each ingredient's nutritional data. Data comes from the Nutritics database or custom entries. If using a branded ingredient, ensure the nutritional values match the product packaging. Contact Nutritics if you believe a database entry is incorrect.
6. MULTIPLE SITES / MENUS: Use Nutritics > Locations to manage multiple venue menus. Ensure the correct location is selected when editing. Shared recipes can be pushed to multiple locations simultaneously. Location-specific pricing can be set per menu item.
Error codes: AUTH_ERR = session expired. PUBLISH_FAIL = publishing error, check internet. IMPORT_ERR = CSV format issue.
Pro tips: Use Nutritics for PPDS (Natasha's Law) compliance by generating pre-packed food labels. Export PDF allergen matrices for staff training. Use the cost vs revenue tool for menu engineering.`,

  'marketman': `MARKETMAN
Support: marketman.com/support | support@marketman.com | In-platform chat
Common issues and fixes:
1. ORDERS NOT SENDING TO SUPPLIERS: In MarketMan > Purchasing > Orders, check the order status. If "Draft" it hasn't been sent - click "Send". If "Error", the supplier connection may be broken. Go to Settings > Suppliers and check the order method (email, integration, portal). Verify the supplier's email is correct. Check your junk folder - MarketMan sends orders by email for many suppliers.
2. STOCK COUNT ERRORS / WRONG INVENTORY LEVELS: Go to Inventory > Stock Counts. Ensure you're using the latest count. If stock levels don't match physical counts, check for unconfirmed deliveries or unrecorded wastage. Go to Inventory > Deliveries and confirm any pending deliveries. Check Inventory > Wastage log too.
3. RECIPE COSTING INACCURATE: Go to Recipes > select recipe. Check each ingredient's unit and quantity is correct. Ensure the ingredient in the recipe links to the correct supplier product with an up-to-date price. Run Reports > Recipe Costing to see all recipes with current costs.
4. INVOICE SCANNING ISSUES: MarketMan has invoice scanning via app or email. In the app, go to Invoices > Scan. Ensure the invoice is well-lit and flat. If items aren't matching, manually match them to your product list. Email invoices go to your unique MarketMan email address (Settings > Invoices > Email Address).
5. POS SYNC NOT WORKING: MarketMan integrates with many POS systems. Go to Settings > Integrations > POS. If the sync is failing, check API credentials are valid. Sales data syncs typically overnight. If sales-based depletion is not working, check the recipe is linked to the POS item via the PLU/barcode.
6. SUPPLIER PRICE CHANGES NOT UPDATING: Suppliers can update prices in MarketMan. You'll receive a notification. Go to Settings > Price Approvals to review and approve or reject price changes. Once approved, all recipe costings automatically update.
Error codes: SUPPLIER_CONN_ERR = cannot reach supplier portal. SYNC_FAIL = POS integration error. OCR_ERR = invoice scan recognition failed.
Pro tips: Use MarketMan's Budget vs Actual reporting to track food cost percentage. Enable supplier direct ordering to save time. Use the mobile app for delivery receiving and stock counts from the kitchen.`,

  'deliveroo': `DELIVEROO FOR RESTAURANTS
Support: restaurants.deliveroo.co.uk | restaurants@deliveroo.co.uk | 020 3699 9977
Common issues and fixes:
1. TABLET OFFLINE / NOT RECEIVING ORDERS: Check the tablet is connected to the internet (Wi-Fi or mobile data). Restart the Deliveroo Tablet app. If the app is stuck, force close and reopen. Ensure the tablet is plugged in and not in low battery mode. Check Deliveroo Status (deliveroostatus.com) for platform outages. If offline, Deliveroo will alert your account manager.
2. MENU NOT SHOWING CORRECTLY / ITEMS MISSING: Log in to Restaurant Hub (restaurant.deliveroo.co.uk). Go to Menu and check all items are "published" and "available". Unhide any items that should be showing. Menu changes can take 15-30 minutes to go live. If using a third-party menu manager (Deliverect, Otter), make the change there and allow time to sync.
3. ORDER NOT CONFIRMED / CUSTOMER COMPLAINT: In Restaurant Hub > Orders, find the order by ID or date. Check if it was accepted or rejected. If there was a technical issue, contact restaurants@deliveroo.co.uk with the order ID. For customer-facing issues, Deliveroo customer support handles all customer refund requests directly.
4. PAYOUTS / PAYMENT QUERIES: Go to Restaurant Hub > Finance > Payouts. Payouts are typically weekly. Check the payout schedule and ensure your bank details are correct in Hub > Account Settings > Payment Details. For missing payouts, raise a case via Restaurant Hub > Help.
5. BUSY MODE / PAUSING THE STORE: On the Deliveroo tablet, tap the menu button and select "Busy Mode" to increase prep times. To pause orders entirely, go to tablet menu > Pause Orders. Set how long to pause for. To resume, tap the play button. You can also manage this from Restaurant Hub.
6. ITEM UNAVAILABLE / OUT OF STOCK: On the tablet, find the item and mark it as "Unavailable". Or in Restaurant Hub > Menu > find item > toggle "Available". This hides the item from customers immediately. Remember to re-enable when back in stock.
Error codes: ORDER_LATE = order taking too long, Deliveroo may reassign rider. MENU_ERROR = menu publishing issue. DEVICE_OFFLINE = tablet connectivity problem.
Pro tips: Use Deliveroo's "Plus" visibility for better placement. Review your menu photos - high quality images increase conversion. Ensure your opening hours in Restaurant Hub match actual trading hours to avoid penalties.`,

  'uber eats': `UBER EATS FOR RESTAURANTS
Support: ubereats.com/restaurant | uber-restaurants@uber.com | In-app support in Uber Eats Manager
Common issues and fixes:
1. UBER EATS MANAGER NOT LOADING: Clear browser cache and try again. Try a different browser (Chrome recommended). Log out and back in. If the app won't load on mobile, uninstall and reinstall. Check status at uberatsstatus.com for any outages.
2. MENU PAUSING / ITEMS UNAVAILABLE: In Uber Eats Manager > Menu, select the item > set as "Unavailable". To pause the entire store, go to Uber Eats Manager > Store > Pause Store. Set a return time. Scheduled menus can be managed under Uber Eats Manager > Hours.
3. ORDER TABLET OFFLINE: Restart the Uber Eats tablet. Check internet connection. Ensure the Uber Eats Orders app is up to date. If orders are coming through the Manager app but not on the dedicated tablet, re-login on the tablet. Call 0808 134 9883 (UK restaurant support) for urgent tablet issues.
4. PAYOUT QUESTIONS / MISSING PAYMENTS: In Uber Eats Manager > Payments, view the payout schedule and history. Payouts are weekly (typically Wednesday for the previous week). For missing payouts, open a case in Manager > Help. Ensure your bank details are correct in Manager > Payments > Bank Account.
5. RATINGS / REPUTATION: View ratings in Uber Eats Manager > Feedback. Respond to reviews through the platform. Consistently poor ratings can result in reduced visibility or temporary suspension. Focus on accuracy and delivery time to improve ratings.
6. MENU NOT UPDATING AFTER CHANGES: Changes in Uber Eats Manager should go live within 15 minutes. If using Deliverect or another aggregator, make changes there. Hard refresh the Manager app. If still not updating after 30 minutes, contact support.
Error codes: STORE_CLOSED = store is set to closed, check hours. ITEM_UNAVAIL = item marked unavailable. PAYMENT_HOLD = payment held pending review.
Pro tips: Use Uber Eats Manager > Analytics to see your top-selling and worst-rated items. Enable the "Last Minute Deals" feature during slow periods. Respond to customer feedback to show you care.`,

  'just eat': `JUST EAT FOR RESTAURANTS
Support: restaurants.just-eat.co.uk | 0345 600 1111 | In-app support
Common issues and fixes:
1. ORDERS NOT COMING THROUGH TO TABLET: Check the Just Eat tablet is powered on and connected to the internet. The Just Eat app should be running in the foreground. Check the volume is turned up - orders play a sound. If orders are not arriving, check Just Eat status. Log out and back in on the tablet app. If issue persists, call 0345 600 1111.
2. MENU CHANGES NOT GOING LIVE: Log in to Just Eat Partner Centre (restaurants.just-eat.co.uk). Go to Menu and make your changes. Click "Save" then "Publish". Changes can take up to 60 minutes to go live. If using Flyt, Deliverect, or another aggregator, make changes through that platform.
3. TABLET SETUP / REPLACEMENT: If setting up a new tablet, download the "Just Eat Partner" app. Log in with your restaurant credentials. If you need a replacement tablet, call 0345 600 1111 or request via Partner Centre. Just Eat provides tablets free of charge to active restaurant partners.
4. FLYT POS INTEGRATION ISSUES: Flyt connects Just Eat orders directly to your EPOS. If orders are not going into the EPOS, check the Flyt integration in your EPOS settings. Common POS integrations: EPOS Now, ICRTouch. Restart the Flyt service if applicable. For Flyt support, contact Just Eat via 0345 600 1111.
5. PAYOUT QUERIES: Log in to Partner Centre > Payments. Payouts are weekly (Wednesdays). Check your bank details are correct. For missing payouts, raise a query via Partner Centre > Help > Finance. Have your restaurant ID ready.
6. STORE AVAILABILITY / HOURS: In Partner Centre > Opening Hours, ensure your hours are correct. To temporarily close, go to Partner Centre > Manage Availability > Close for Today. For planned closures, update in advance.
Error codes: TABLET_OFFLINE = no internet connection. MENU_PUBLISH_ERR = menu not published. INTEGRATION_ERR = Flyt connection issue.
Pro tips: Respond to customer reviews in Partner Centre to improve reputation. Use Just Eat promotions to attract new customers during quiet periods. Ensure your menu photos are up to date - they significantly impact orders.`,

  'mews': `MEWS (HOTEL PMS)
Support: support.mews.com | mews.com/support | In-platform chat
Common issues and fixes:
1. RESERVATION NOT FOUND: In Mews > Reservations, search by guest name, email, or confirmation number. Check the correct property and date range are selected. Reservations from OTAs (Booking.com, Expedia) take a few minutes to sync via the channel manager. If a reservation is missing, check the channel manager connection in Mews > Connectivity > Channels.
2. PAYMENT FAILURES AT CHECK-IN: Check the payment terminal is paired (Mews > Settings > Integrations > Payment Terminals). If using Adyen, the terminal must be connected to the same network. For card-on-file payments, the guest's card may have expired or been cancelled. Always have an alternative payment method ready.
3. CHECK-IN / KEY ENCODING ISSUES: If the key card encoder is not working, check it's connected to the Mews workstation via USB. In Mews > Settings > Integrations > Key Encoders, check the status. For encoder errors, check the physical connection and restart the Mews Command Client software on the workstation.
4. CHANNEL MANAGER SYNC FAILING: Go to Mews > Connectivity > Channels > select channel. Check the "Health" indicator. If red, reconnect by following the channel's re-authentication steps. For SiteMinder or D-EDGE specifically, re-enter API credentials. Allow 15 minutes for sync after reconnecting.
5. REPORTING: Go to Mews > Commander > Reports. Key reports: Occupancy, Revenue, Check-in/Check-out, and Manager Report. If figures seem wrong, check for any "Test" reservations that may have been left in the system. The Night Audit report should be run daily to close the accounting period.
6. ONLINE CHECK-IN NOT WORKING: Mews digital check-in emails go out automatically before arrival. Check Settings > Online Check-in for the timing configuration. If guests aren't receiving emails, verify the guest's email address in the reservation. Check the email template is active in Settings > Email Templates.
Error codes: CHANNEL_SYNC_ERR = OTA/channel manager issue. PAYMENT_DECLINED = terminal or card issue. KEY_ENCODE_ERR = key encoder not responding.
Pro tips: Use Mews' Revenue Management integration for dynamic pricing. Enable the Mews Guest Portal for self-service check-in and requests. Use Mews Spaces for managing meeting rooms and event spaces alongside bedrooms.`,

  'oracle micros': `ORACLE MICROS / OPERA PMS
Support: oracle.com/hospitality | Oracle Customer Support Portal (support.oracle.com) | 0800 054 9498
Common issues and fixes:
1. MICROS WORKSTATION OFFLINE / GREY SCREEN: Check network connectivity between the workstation and the MICROS server. Restart the MICROS POS application (not the OS). On RES systems, use the MICROS Control Panel to restart services. If the server is on-site, check it is running and not applying updates. Contact your MICROS reseller for urgent server issues.
2. CHECK NOT PRINTING TO KITCHEN: In MICROS EMC (Enterprise Management Console), go to Devices > Printers and check the kitchen printer configuration. Verify the IP address is correct and the printer is reachable on the network. Check the "Menu Item Class" routing - items must be assigned to a printer class that routes to the kitchen. Restart the printer.
3. OPERA PMS INTERFACE ERRORS: If MICROS EPOS is integrated with Opera PMS, check the IFC8 or OHIP interface status. In Opera > Interfaces, check the interface shows as "Running". If down, restart the interface from the Opera back end. For OHIP (cloud) integrations, check the OHIP dashboard in Oracle Cloud.
4. MENU ENGINEERING / PRICE CHANGES: In MICROS EMC > Menu Items, find the item and update the price. Prices update on the next POS sync (typically a few seconds). For large menu changes, use the MICROS Import/Export function. Always test after changes by looking up the item in the POS.
5. END OF DAY / BUSINESS DATE: MICROS uses a "Business Date" concept. Run End of Day (EOD) from EMC > Reporting > End of Day. Ensure all checks are closed before running EOD. If EOD fails, look at the MICROS log files for specific errors. For Oracle Cloud, EOD runs automatically.
6. STAFF PERMISSIONS / EMPLOYEE SETUP: In MICROS EMC > Personnel > Employees, check the employee record. Ensure the correct "Employee Class" is assigned - this controls what the employee can do. If an employee can't do something they should be able to do, check the Employee Class permissions.
Error codes: SEE_LOG = check MICROS log files. TIMEOUT = server communication issue. DB_ERR = database connectivity problem. LICENSE_ERR = license server issue.
Pro tips: Oracle MICROS requires certified resellers for major changes - contact your reseller for system modifications. Regular database maintenance is important. Use MICROS Reporting and Analytics (mymicros.net) for cloud-based reporting.`,

  'winnow': `WINNOW (FOOD WASTE)
Support: winnowsolutions.com/support | support@winnow.com | In-platform chat
Common issues and fixes:
1. SCALES NOT CONNECTING TO TABLET: Check the scales are powered on (green LED). Ensure the Bluetooth or USB connection is established - go to the Winnow app > Settings > Scales and tap "Connect". If using Bluetooth, ensure no other devices are paired to the same scales. Restart the Winnow app and the scales. If USB, check the cable is securely connected.
2. ITEMS NOT BEING RECOGNISED / WRONG CATEGORY: The Winnow Vision system uses AI to identify food items. If an item is frequently misidentified, go to the Winnow portal > Menu and check the item is listed with correct photos/names. You can flag incorrect identifications in the app. The system learns over time - consistent correction improves accuracy.
3. REPORTS NOT GENERATING: Log in to Winnow Portal > Analytics. Check the date range and location filters. If data is missing, check whether the Winnow device was online during that period (Portal > Devices > Connection History). Reports require data to be synced from the device - devices must have internet connectivity.
4. TABLET ISSUES / APP CRASHING: Force close the Winnow app and reopen. Ensure the tablet is charged (keep it plugged in during service). Check for app updates in the Play Store or App Store. If the tablet is very slow, check available storage - clear the app cache if needed. If the tablet is unresponsive, a factory reset may be needed.
5. WASTE ITEM NOT ON THE LIST: During service, staff can add a waste item not in the list by selecting "Other" and typing the item name. These get reviewed and added to the main list by a Winnow admin. In the Winnow Portal > Menu, you can pre-add items to ensure they're available.
6. SETTING TARGETS / BENCHMARKS: Go to Winnow Portal > Targets. Set waste reduction targets by cost or weight. View performance against targets in the Analytics dashboard. Share reports with kitchen teams to drive engagement. Winnow recommends weekly team reviews of waste data.
Error codes: DEVICE_OFFLINE = tablet not connected to internet. SCALE_ERR = scales connectivity issue. SYNC_FAIL = data not syncing to portal.
Pro tips: Hold weekly kitchen waste reviews using Winnow data. Use Winnow's benchmarking data to compare against similar operations. Enable automatic daily email reports for kitchen managers.`
};

// ─── VENDOR SUPPORT URL LOOKUP ────────────────────────────────────────────
const VENDOR_SUPPORT_URLS = {
  // POS
  'tevalis': 'https://support.tevalis.com',
  'zonal': 'https://support.zonal.co.uk',
  'epos now': 'https://www.eposnow.com/us/resource-hub/',
  'lightspeed': 'https://www.lightspeedhq.com/support/',
  'square': 'https://squareup.com/help/gb',
  'toast': 'https://central.toasttab.com/s/',
  'oracle micros': 'https://www.oracle.com/uk/industries/food-beverage/restaurant-pos/',
  'icrtouch': 'https://icrtouch.com/support/',
  'tabology': 'https://support.tabology.com',
  'storekit': 'https://help.storekit.com',
  'pepper': 'https://support.getpepper.io',
  'par brink': 'https://www.partech.com/support',
  'vita mojo': 'https://support.vitamojo.com',
  'revel systems': 'https://help.revelsystems.com',
  'comtrex': 'https://www.comtrex.co.uk/support',
  'paypoint': 'https://www.paypoint.com/support',
  // Payments
  'dojo': 'https://help.dojo.tech',
  'worldpay': 'https://www.worldpay.com/en-gb/support',
  'stripe': 'https://support.stripe.com',
  'zettle': 'https://www.zettle.com/gb/help',
  'sumup': 'https://help.sumup.com/en-GB',
  'adyen': 'https://support.adyen.com',
  'elavon': 'https://www.elavon.co.uk/support',
  'paymentsense': 'https://www.paymentsense.com/support/',
  'barclaycard': 'https://www.barclaycard.co.uk/business/support',
  'tyl': 'https://tyl.co.uk/support',
  'natwest': 'https://tyl.co.uk/support',
  'pleo': 'https://help.pleo.io',
  'soldo': 'https://support.soldo.com',
  // Reservations
  'opentable': 'https://help.opentable.com',
  'resdiary': 'https://support.resdiary.com',
  'collins': 'https://support.designmynight.com',
  'sevenrooms': 'https://support.sevenrooms.com',
  'quandoo': 'https://help.quandoo.com',
  'resy': 'https://help.resy.com',
  'tock': 'https://support.exploretock.com',
  'eat app': 'https://help.eatapp.co',
  'eveve': 'https://support.eveve.com',
  'carbonara': 'https://help.carbonara.app',
  'hostme': 'https://help.hostmeapp.com',
  'waitwhile': 'https://help.waitwhile.com',
  // Workforce
  'fourth': 'https://support.fourth.com',
  'deputy': 'https://support.deputy.com',
  'sona': 'https://support.getsona.com',
  'rotaready': 'https://support.rotaready.com',
  'bizimply': 'https://support.bizimply.com',
  'planday': 'https://support.planday.com',
  's4labour': 'https://www.s4labour.co.uk/support',
  'hotschedules': 'https://help.hotschedules.com',
  'workforce.com': 'https://support.workforce.com',
  'harri': 'https://help.harri.com',
  'nory': 'https://support.nory.ai',
  'humanforce': 'https://support.humanforce.com',
  'homebase': 'https://support.joinhomebase.com',
  'when i work': 'https://help.wheniwork.com',
  'tanda': 'https://help.tanda.co',
  'breathe hr': 'https://support.breathehr.com',
  'mitrefinch': 'https://www.mitrefinch.co.uk/support',
  // Online ordering & delivery
  'deliverect': 'https://support.deliverect.com',
  'flipdish': 'https://help.flipdish.com',
  'slerp': 'https://support.slerp.com',
  'orderswift': 'https://support.orderswift.com',
  'yoello': 'https://help.yoello.com',
  'hungrrr': 'https://support.hungrrr.co.uk',
  'preoday': 'https://support.preoday.com',
  'deliveroo': 'https://restaurant-hub.deliveroo.com/help',
  'uber eats': 'https://help.uber.com/restaurants',
  'just eat': 'https://restaurants.just-eat.co.uk/help',
  'otter': 'https://help.tryotter.com',
  // Loyalty & CRM
  'airship': 'https://support.airship.com',
  'stampede': 'https://support.stampede.ai',
  'yumpingo': 'https://support.yumpingo.com',
  'eagle eye': 'https://eagleeye.com/support',
  'klaviyo': 'https://help.klaviyo.com',
  'punchh': 'https://support.punchh.com',
  'paytronix': 'https://www.paytronix.com/support',
  'loyalzoo': 'https://support.loyalzoo.com',
  'como': 'https://support.como.com',
  // Inventory & procurement
  'apicbase': 'https://support.apicbase.com',
  'nutritics': 'https://support.nutritics.com',
  'crunchtime': 'https://support.crunchtime.com',
  'marketman': 'https://support.marketman.com',
  'kitchen cut': 'https://support.kitchencut.com',
  'winnow': 'https://support.winnowsolutions.com',
  'foodics': 'https://support.foodics.com',
  'growyze': 'https://support.growyze.com',
  'meez': 'https://help.meezrecipes.com',
  // Hotel PMS
  'mews': 'https://help.mews.com',
  'cloudbeds': 'https://help.cloudbeds.com',
  'guestline': 'https://support.guestline.net',
  'clock pms': 'https://help.clock-software.com',
  'opera': 'https://docs.oracle.com/en/industries/hospitality/',
  'apaleo': 'https://help.apaleo.com',
  'little hotelier': 'https://help.littlehotelier.com',
  'siteminder': 'https://help.siteminder.com',
  'beds24': 'https://beds24.com/support',
  // Revenue management
  'ideas': 'https://support.ideas.com',
  'duetto': 'https://support.duettoresearch.com',
  'ota insight': 'https://support.otainsight.com',
  'rategain': 'https://support.rategain.com',
  // Analytics
  'tenzo': 'https://help.tenzo.io',
  'avero': 'https://support.averoinc.com',
  // WiFi
  'purple wi-fi': 'https://support.purple.ai',
  'purple wifi': 'https://support.purple.ai',
  'cisco meraki': 'https://documentation.meraki.com',
  'stampede wifi': 'https://support.stampede.ai',
  // Guest engagement
  'revinate': 'https://support.revinate.com',
  'guestrevu': 'https://support.guestrevu.com',
  'trustyou': 'https://support.trustyou.com',
  'criton': 'https://support.criton.com',
  // HR
  'hibob': 'https://support.hibob.com',
  'personio': 'https://support.personio.de',
  'bamboohr': 'https://help.bamboohr.com',
  'charlie hr': 'https://help.charliehr.com',
  // Training
  'typsy': 'https://help.typsy.com',
  'beekeeper': 'https://support.beekeeper.io',
  'flow learning': 'https://support.flowlearning.co',
};

// ─── VENDOR NAME CACHE (for NPS detection) ────────────────────────────────
// Derived dynamically from Supabase documents table — adding a doc makes
// that vendor automatically eligible for NPS prompts, no code change needed.
let _vendorNameCache = [];
let _vendorCacheAt = 0;

async function getVendorNames() {
  if (Date.now() - _vendorCacheAt < 3600000 && _vendorNameCache.length) return _vendorNameCache;
  try {
    const docs = await sbFetch('/rest/v1/documents?select=filename&limit=1000');
    if (Array.isArray(docs.data) && docs.data.length) {
      const names = [...new Set(docs.data.map(d => {
        // Strip extension and normalise: "Lightspeed_Restaurant_Guide.pdf" → "lightspeed restaurant guide"
        return d.filename.toLowerCase()
          .replace(/\.(txt|pdf|md|docx?|csv)$/i, '')
          .replace(/[_\-]+/g, ' ')
          .trim();
      }))].filter(n => n.length > 2);
      // Also include VENDOR_PROFILES keys and known short-names
      const profileKeys = Object.keys(VENDOR_PROFILES);
      _vendorNameCache = [...new Set([...profileKeys, ...names])];
      _vendorCacheAt = Date.now();
    }
  } catch(e) { /* fall through to stale cache */ }
  // Fallback: at minimum expose profile keys
  if (!_vendorNameCache.length) _vendorNameCache = Object.keys(VENDOR_PROFILES);
  return _vendorNameCache;
}

// ─── SLACK ALERT ──────────────────────────────────────────────────────────
async function sendSlackAlert({ venue, userName, email, issue, turns }) {
  if (!SLACK_WEBHOOK_URL) return;
  const https = require('https');
  const now = new Date().toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
  const text = [
    '🚨 *Escalation Alert — Stacked Chat*',
    `*Venue:* ${venue || 'Unknown'}`,
    `*User:* ${userName || 'Unknown'} (${email || 'no email'})`,
    `*Issue:* ${issue}`,
    `*Conversation length:* ${turns} message${turns !== 1 ? 's' : ''}`,
    `*Time:* ${now}`,
  ].join('\n');
  const body = JSON.stringify({ text });
  const url = new URL(SLACK_WEBHOOK_URL);
  return new Promise((res) => {
    const req = https.request({
      hostname: url.hostname, path: url.pathname + url.search,
      method: 'POST', headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) }
    }, (r) => { r.resume(); r.on('end', res); });
    req.on('error', () => {});
    req.write(body); req.end();
  });
}

async function sendSlackTicketAlert(ticket) {
  if (!SLACK_WEBHOOK_URL) return;
  const https = require('https');
  const now = new Date().toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
  const issue = (ticket.issue || '').substring(0, 300);
  const convoLen = Array.isArray(ticket.conversation) ? ticket.conversation.length : 0;
  const text = [
    '🎫 *New Support Ticket — Stacked Chat*',
    `*Venue:* ${ticket.venue || 'Unknown'}`,
    `*User:* ${ticket.name || 'Unknown'} (${ticket.email || 'no email'})`,
    `*Issue:* ${issue}`,
    `*Conversation length:* ${convoLen} message${convoLen !== 1 ? 's' : ''}`,
    `*Time:* ${now}`,
  ].join('\n');
  const body = JSON.stringify({ text });
  const url = new URL(SLACK_WEBHOOK_URL);
  return new Promise((res) => {
    const req = https.request({
      hostname: url.hostname, path: url.pathname + url.search,
      method: 'POST', headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) }
    }, (r) => { r.resume(); r.on('end', res); });
    req.on('error', () => {});
    req.write(body); req.end();
  });
}

// ─── SUPABASE HELPERS ──────────────────────────────────────────────────────
// Mirror a /save-nps payload into the approved-reporting portal's unified
// nps_scores table. Silent no-op if STACKCOLLECT env vars aren't set.
// Payload shape (from npsSubmit in the client): { vendor, score, comment,
// venue_id, venue, respondent }.
async function mirrorNpsToPortal(payload) {
  if (!STACKCOLLECT_SUPABASE_URL || !STACKCOLLECT_SUPABASE_KEY) return;
  if (!payload || typeof payload.score !== 'number') return;
  const https = require('https');
  const url = new URL(`${STACKCOLLECT_SUPABASE_URL}/rest/v1/nps_scores`);
  const body = JSON.stringify({
    source:           'toast-support-bot',
    touchpoint:       'vendor-chat',
    score:            payload.score,
    comment:          payload.comment || null,
    vendor:           payload.vendor || null,
    respondent_name:  payload.respondent || null,
    company:          payload.venue || null,
    venue_id:         payload.venue_id || null,
  });
  return new Promise((resolve) => {
    const req = https.request({
      hostname: url.hostname, path: url.pathname + url.search, method: 'POST',
      headers: {
        apikey: STACKCOLLECT_SUPABASE_KEY,
        Authorization: `Bearer ${STACKCOLLECT_SUPABASE_KEY}`,
        'Content-Type': 'application/json',
        Prefer: 'return=minimal',
      },
    }, (r) => {
      let d = '';
      r.on('data', c => d += c);
      r.on('end', () => {
        if (r.statusCode >= 400) console.error('[portal] nps_scores insert failed', r.statusCode, d);
        resolve();
      });
    });
    req.on('error', (e) => { console.error('[portal] nps_scores request error', e.message); resolve(); });
    req.write(body);
    req.end();
  });
}

async function sbFetch(path, opts = {}) {
  const https = require('https');
  const url = new URL(`${SUPABASE_URL}${path}`);
  const body = opts.body ? JSON.stringify(opts.body) : null;
  const headers = {
    'apikey': SUPABASE_KEY,
    'Authorization': `Bearer ${SUPABASE_KEY}`,
    'Content-Type': 'application/json',
    'Prefer': 'return=minimal',
    ...opts.headers
  };
  return new Promise((res, rej) => {
    const req = https.request({
      hostname: url.hostname, path: url.pathname + url.search,
      method: opts.method || 'GET', headers
    }, (r) => {
      let d = '';
      r.on('data', c => d += c);
      r.on('end', () => {
        try { res({ status: r.statusCode, data: JSON.parse(d || '[]') }); }
        catch { res({ status: r.statusCode, data: d }); }
      });
    });
    req.on('error', rej);
    if (body) req.write(body);
    req.end();
  });
}

// ─── AUTH: validate a Supabase access token → verified email (or null) ────────
// Used to harden admin write-actions: the caller must hold a real session
// proving they own the email (obtained via the email-code verification flow).
async function verifyAuthEmail(token) {
  if (!token) return null;
  const https = require('https');
  const u = new URL(`${SUPABASE_URL}/auth/v1/user`);
  return new Promise((resolve) => {
    const req = https.request({
      hostname: u.hostname, path: u.pathname, method: 'GET',
      headers: { apikey: SUPABASE_KEY, Authorization: 'Bearer ' + token }
    }, (r) => {
      let d = ''; r.on('data', c => d += c);
      r.on('end', () => {
        try { const j = JSON.parse(d); resolve((r.statusCode < 400 && j && j.email) ? String(j.email).toLowerCase() : null); }
        catch(e) { resolve(null); }
      });
    });
    req.on('error', () => resolve(null));
    req.end();
  });
}

async function getAnalytics() {
  try {
    const [convsR, ticketsR, docsR, healthR] = await Promise.all([
      sbFetch('/rest/v1/conversations?select=id,email,name,venue,messages,created_at&order=created_at.desc&limit=200'),
      sbFetch('/rest/v1/tickets?select=*&order=created_at.desc&limit=100'),
      sbFetch('/rest/v1/documents?select=filename,created_at&order=created_at.desc&limit=1000'),
      sbFetch('/rest/v1/health_checks?select=*&order=checked_at.desc&limit=200'),
    ]);
    const convs = Array.isArray(convsR.data) ? convsR.data : [];
    const tickets = Array.isArray(ticketsR.data) ? ticketsR.data : [];
    const docs = Array.isArray(docsR.data) ? docsR.data : [];
    const healthChecks = Array.isArray(healthR.data) ? healthR.data : [];
    const allMessages = [];
    convs.forEach(c => {
      if (c.messages && Array.isArray(c.messages)) {
        c.messages.filter(m => m.role === 'user').forEach(m => allMessages.push(m.content.toLowerCase()));
      }
    });
    const topicKeywords = {
      'EPOS / Till system': ['epos','till','pos','register','touchscreen','terminal crashed','system down'],
      'Payment terminals': ['payment','card','contactless','worldpay','sumup','square','stripe','zettle'],
      'WiFi / Network': ['wifi','wi-fi','internet','network','broadband','connectivity','offline'],
      'Kitchen printers': ['kitchen','printer','kds','order not printing','print'],
      'Login / Access': ['login','log in','password','pin','access','locked out'],
      'Slow performance': ['slow','lagging','freezing','frozen','unresponsive'],
      'Bookings / Reservations': ['booking','reservation','resy','opentable','sevenrooms'],
      'Payroll / HR': ['payroll','hr','rota','deputy','rotaready','workforce'],
    };
    const topicCounts = {};
    Object.keys(topicKeywords).forEach(topic => {
      topicCounts[topic] = 0;
      allMessages.forEach(msg => { if (topicKeywords[topic].some(kw => msg.includes(kw))) topicCounts[topic]++; });
    });
    const vendors = ['lightspeed','square','zonal','epos now','tevalis','vita mojo','yoello','worldpay','sumup','stripe','zettle','deputy','rotaready','sevenrooms','opentable','resy','nutritics'];
    const vendorCounts = {};
    vendors.forEach(v => { vendorCounts[v] = allMessages.filter(m => m.includes(v)).length; });
    const topTopics = Object.entries(topicCounts).sort((a,b) => b[1]-a[1]).filter(([,c]) => c > 0);
    const topVendors = Object.entries(vendorCounts).sort((a,b) => b[1]-a[1]).filter(([,c]) => c > 0);
    const uniqueDocs = [...new Map(docs.map(d => [d.filename, d])).values()];

    // Build per-venue latest health check summary
    const venueHealthMap = {};
    healthChecks.forEach(hc => {
      const key = hc.venue_id || hc.venue || 'unknown';
      if (!venueHealthMap[key]) venueHealthMap[key] = hc; // already sorted desc, first = latest
    });
    const venueHealth = Object.values(venueHealthMap);

    // System-level issue counts across all recent checks (last 7 days)
    const sevenDaysAgo = Date.now() - 7 * 24 * 60 * 60 * 1000;
    const recentChecks = healthChecks.filter(hc => new Date(hc.checked_at).getTime() > sevenDaysAgo);
    const systemIssueCounts = { epos: 0, payments: 0, wifi: 0, printer: 0, bookings: 0 };
    recentChecks.forEach(hc => {
      if (!hc.answers) return;
      Object.entries(hc.answers).forEach(([sys, val]) => {
        if ((val === 'red' || val === 'amber') && systemIssueCounts.hasOwnProperty(sys)) {
          systemIssueCounts[sys]++;
        }
      });
    });

    // Build venue stats
    const venueMap = {};
    convs.forEach(c => {
      const vk = c.venue || 'Unknown venue';
      if (!venueMap[vk]) venueMap[vk] = { venue: vk, convs: 0, msgs: 0, lastSeen: c.created_at };
      venueMap[vk].convs++;
      venueMap[vk].msgs += (c.messages || []).filter(m => m.role === 'user').length;
      if (new Date(c.created_at) > new Date(venueMap[vk].lastSeen)) venueMap[vk].lastSeen = c.created_at;
    });
    tickets.forEach(t => {
      const vk = t.venue || 'Unknown venue';
      if (!venueMap[vk]) venueMap[vk] = { venue: vk, convs: 0, msgs: 0, lastSeen: t.created_at };
      if (!venueMap[vk].tickets) venueMap[vk].tickets = 0;
      venueMap[vk].tickets++;
      if (t.escalated) { if (!venueMap[vk].escalated) venueMap[vk].escalated = 0; venueMap[vk].escalated++; }
    });
    const venueStats = Object.values(venueMap).sort((a, b) => b.convs - a.convs);

    // Fetch NPS scores per vendor
    let npsData = [];
    try {
      const npsRows = await sbFetch('/rest/v1/nps_scores?select=vendor,score&limit=2000');
      if (Array.isArray(npsRows.data) && npsRows.data.length) {
        const byVendor = {};
        npsRows.data.forEach(({ vendor, score }) => {
          if (!byVendor[vendor]) byVendor[vendor] = [];
          byVendor[vendor].push(score);
        });
        npsData = Object.entries(byVendor).map(([vendor, scores]) => {
          const promoters = scores.filter(s => s >= 9).length;
          const detractors = scores.filter(s => s <= 6).length;
          const nps = Math.round((promoters / scores.length - detractors / scores.length) * 100);
          const avg = (scores.reduce((a,b) => a+b, 0) / scores.length).toFixed(1);
          return { vendor, nps, avg, count: scores.length, promoters, detractors };
        }).sort((a, b) => b.nps - a.nps);
      }
    } catch(e) { /* nps_scores table may not exist yet */ }

    return {
      totalConvs: convs.length, totalMessages: allMessages.length,
      openTickets: tickets.filter(t => t.status === 'open').length,
      escalatedTickets: tickets.filter(t => t.escalated).length,
      totalDocs: uniqueDocs.length,
      topTopics, topVendors, recentConvs: convs.slice(0, 10), tickets, docs: uniqueDocs,
      healthChecks: healthChecks.slice(0, 50), venueHealth, systemIssueCounts,
      totalChecks: healthChecks.length, venueStats, npsData
    };
  } catch(e) { console.error('Analytics error:', e); return { error: e.message }; }
}

// ─── CHAT PAGE BUILDER ─────────────────────────────────────────────────────
// Accepts a branding object and returns a fully branded HTML page.
// Default branding = Stacked. White-label = venue's own logo/colour/botname.
function buildChatPage(b = {}) {
  const logoUrl = b.logo_url || 'https://raw.githubusercontent.com/TOT-STACKED/toast-support-bot/main/assets/Stacked%20(3).svg';
  const primaryColor = b.primary_color || '#e64e1a';
  const botName = b.bot_name || 'Stacked Chat';
  const welcomeMsg = b.welcome_message || 'Stacked Chat knows your business — handbooks, SOPs, supplier info, opening procedures and tech setup. Ask anything and get the right answer in seconds, with its source. Pop your details in to start.';
  const welcomeHeading = b.welcome_heading || 'Your knowledge,<br><span class="accent">on tap.</span>';
  const poweredBy = b.white_label ? '' : '<a href="https://stackedchat.io" target="_blank" rel="noopener" style="display:block;text-align:center;padding:8px;font-size:11px;color:#A8A49C;text-decoration:none;font-family:var(--font-sans);">Powered by <strong style="color:#e64e1a">Stacked Chat</strong></a>';
  const presetVenueId = b.venue_id || '';
  const presetVenueName = (b.venue_name || '').replace(/'/g, '&#39;').replace(/"/g, '&quot;');
  // Inject branding into the template
  return STACKED_CHAT_TEMPLATE
    .replace(/\{\{LOGO_URL\}\}/g, logoUrl)
    .replace(/\{\{PRIMARY_COLOR\}\}/g, primaryColor)
    .replace(/\{\{BOT_NAME\}\}/g, botName)
    .replace(/\{\{WELCOME_MSG\}\}/g, welcomeMsg)
    .replace(/\{\{WELCOME_HEADING\}\}/g, welcomeHeading)
    .replace(/\{\{POWERED_BY\}\}/g, poweredBy)
    .replace(/\{\{VENUE_ID\}\}/g, presetVenueId)
    .replace(/\{\{VENUE_NAME\}\}/g, presetVenueName);
}

// ─── STACKED CHAT PAGE ────────────────────────────────────────────────────
// Gate has venue autocomplete: user types, dropdown shows matching venues,
// they pick one (joins) or hit "Create new venue" (creates).
const STACKED_CHAT_TEMPLATE = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no, viewport-fit=cover">
<title>{{BOT_NAME}}</title>
<link rel="icon" type="image/png" href="https://raw.githubusercontent.com/TOT-STACKED/toast-support-bot/main/assets/Stacked%20(3).svg">
<script src="https://cdnjs.cloudflare.com/ajax/libs/qrcodejs/1.0.0/qrcode.min.js"></script>
<script src="https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js"></script>
<script src="https://cdnjs.cloudflare.com/ajax/libs/mammoth/1.6.0/mammoth.browser.min.js"></script>
<script src="https://cdn.jsdelivr.net/npm/tesseract.js@5/dist/tesseract.min.js"></script>
<link href="https://fonts.googleapis.com/css2?family=Archivo+Black&family=DM+Sans:opsz,wght@9..40,400;9..40,500;9..40,600;9..40,700&family=JetBrains+Mono:wght@400;500;600;700&display=swap" rel="stylesheet">
<style>
  *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
  :root {
    /* Legacy chat-widget tokens (light theme — the chat widget stays
       light/cream because it's seen by stressed operators on-shift.
       Only the new accent orange #E87830, Geist body font, Fraunces
       gate heading, and 4px offset-shadow buttons carry over from the
       /app dashboard rebrand.) */
    --cream: #EDEBE5; --cream-dark: #D6D2C8;
    --orange: {{PRIMARY_COLOR}}; --orange-light: {{PRIMARY_COLOR}}cc;
    --brown: #1A1A1A; --brown-mid: #6B6867;
    /* Answer/"solution" bubble — soft pinky-orange peach (deck chat style) */
    --peach: #F8DBCC; --peach-border: #F0C7B4; --peach-link: #B8480F;
    --white: #ffffff; --green: #2A9D5C; --red: #D64545;
    --purple: #9B8AC2; --purple-light: #B3A6D6;
    --green-brand: #B7D46A; --green-brand-light: #D1E58F;

    /* Accent glow — single source, derived from the live brand orange
       (#E87830 → 230,78,26). Replaces the legacy 230,84,58 / 232,87,60
       glows that no longer matched the button colour. */
    --orange-glow-08: rgba(230,78,26,0.08);
    --orange-glow-15: rgba(230,78,26,0.15);
    --orange-glow-25: rgba(230,78,26,0.25);
    --orange-ring:    rgba(230,78,26,0.14);

    /* Elevation scale */
    --shadow:    0 1px 2px rgba(26,21,16,0.04), 0 2px 12px rgba(26,21,16,0.06);
    --shadow-lg: 0 4px 6px rgba(26,21,16,0.04), 0 16px 40px rgba(26,21,16,0.10);
    --e1: 0 1px 2px rgba(26,21,16,0.05);
    --e2: 0 2px 10px rgba(26,21,16,0.07);
    --e3: 0 8px 28px rgba(26,21,16,0.12);

    /* Radius scale */
    --r-sm: 8px; --r-md: 12px; --r-lg: 16px; --r-xl: 22px; --r-pill: 999px;

    /* Motion */
    --ease: cubic-bezier(0.2, 0.8, 0.2, 1);
    --t-fast: 0.12s; --t-mid: 0.2s; --t-slow: 0.32s;

    /* Brand primary-button offset shadow (carried from the /app system) */
    --btn-offset:        0 4px 0 0 var(--stacked-orange-700);
    --btn-offset-hover:  0 5px 0 0 var(--stacked-orange-700);
    --btn-offset-active: 0 2px 0 0 var(--stacked-orange-700);

    /* Stacked design-system tokens — available for opt-in use but not
       applied as defaults on the chat widget. See colors_and_type.css. */
    --ink-900: #0A0A0A; --ink-800: #131313; --ink-700: #1D1D1D;
    --fg: #F4EFE6; --fg-muted: #928A7C; --fg-dim: #555048;
    --border: #262421;
    --stacked-orange-500: #e64e1a; --stacked-orange-700: #B7351F;
    --stacked-green-500:  #3BD36F; --stacked-green-700:  #1E8A44;
    --stacked-amber-500:  #F5A524;
    --stacked-red-500:    #E5484D;
    --stacked-purple-500: #C7B3F2; --stacked-purple-700: #1D1340;
    --font-sans:    'DM Sans', ui-sans-serif, system-ui, sans-serif;
    --font-display: 'Chunko Bold', 'Archivo Black', 'DM Sans', sans-serif;
    --font-mono:    'JetBrains Mono', ui-monospace, 'SF Mono', monospace;
  }
  ::selection { background: var(--orange); color: #fff; }
  html { height: 100%; height: 100dvh; overflow-x: hidden; overflow-y: hidden; }
  body { height: 100%; height: 100dvh; background: var(--cream); font-family: var(--font-sans); color: var(--brown); overflow: hidden; overscroll-behavior: none; touch-action: pan-y; max-width: 100vw; -webkit-font-smoothing: antialiased; }
  @keyframes staggerIn { from { opacity: 0; transform: translateY(14px); } to { opacity: 1; transform: translateY(0); } }
  @keyframes pulseGlow { 0%,100% { box-shadow: 0 0 0 0 rgba(42,157,92,0.4); } 50% { box-shadow: 0 0 0 4px rgba(42,157,92,0.15); } }
  @keyframes msgIn { from { opacity: 0; transform: translateY(8px) scale(0.98); } to { opacity: 1; transform: translateY(0) scale(1); } }
  @keyframes dotBounce { 0%,60%,100% { transform: translateY(0); opacity: 0.4; } 30% { transform: translateY(-6px); opacity: 1; } }

  /* ─── GATE ─── */
  #gate {
    position: fixed; inset: 0;
    background: #EDEBE5;
    background-image: radial-gradient(ellipse 70% 50% at 50% 0%, rgba(230,78,26,0.07) 0%, transparent 70%),
                      radial-gradient(ellipse 40% 30% at 90% 100%, rgba(230,78,26,0.04) 0%, transparent 60%);
    display: flex; align-items: center; justify-content: center;
    z-index: 100; padding: 16px; overflow-y: auto;
  }
  #gate.hidden { display: none; }
  /* Full-bleed hero photo + cream scrim (shown only when GATE_BG_URL is set;
     otherwise the cream radial-gradient above is the graceful fallback). */
  .gate-bg, .gate-scrim { position: absolute; inset: 0; pointer-events: none; }
  .gate-bg { z-index: 0; background: var(--gate-bg) center/cover no-repeat; filter: saturate(0.9); }
  .gate-scrim { z-index: 1; background:
      linear-gradient(180deg, rgba(237,235,229,0.82) 0%, rgba(237,235,229,0.74) 42%, rgba(237,235,229,0.90) 100%),
      radial-gradient(ellipse 60% 45% at 50% 8%, rgba(230,78,26,0.10) 0%, transparent 70%); }
  #gate:not(.has-bg) .gate-bg, #gate:not(.has-bg) .gate-scrim { display: none; }
  #gate .gate-card { position: relative; z-index: 2; }
  #gate.has-bg .gate-card { box-shadow: 0 8px 10px rgba(26,21,16,0.10), 0 24px 60px rgba(26,21,16,0.22); }
  .gate-card {
    background: #ffffff;
    border: 1px solid #E0DDD5;
    border-radius: 20px;
    padding: 36px 32px;
    width: 100%; max-width: 400px;
    box-shadow: 0 4px 6px rgba(0,0,0,0.04), 0 16px 48px rgba(0,0,0,0.08);
    text-align: left;
  }
  .gate-logo { height: 32px; max-width: 160px; object-fit: contain; margin-bottom: 28px; display: block; opacity: 0; animation: staggerIn 0.5s var(--ease) 0.1s forwards; }
  /* Gate h2 upgraded to Fraunces display (kept from /app rebrand) */
  .gate-card h2 {
    font-family: var(--font-display);
    font-size: 26px; font-weight: 600;
    color: #1A1A1A; letter-spacing: -0.02em;
    margin-bottom: 6px; line-height: 1.1;
    opacity: 0; animation: staggerIn 0.5s var(--ease) 0.2s forwards;
  }
  .gate-sub { display: none; }
  .gate-card h2 .accent { color: var(--orange); }
  .gate-card p {
    font-family: var(--font-sans);
    font-size: 14px; color: #6B6867;
    margin-bottom: 16px; line-height: 1.5; font-weight: 400;
    opacity: 0; animation: staggerIn 0.5s var(--ease) 0.3s forwards;
  }
  .gate-eyebrow {
    font-family: var(--font-mono); font-size: 10px; font-weight: 600;
    letter-spacing: 0.15em; text-transform: uppercase; color: var(--brown-mid);
    display: flex; align-items: center; gap: 8px; margin-bottom: 14px;
    opacity: 0; animation: staggerIn 0.5s var(--ease) 0.15s forwards;
  }
  .gate-eyebrow .accent { color: var(--orange); }
  .gate-eyebrow .ge-dot { width: 6px; height: 6px; border-radius: 50%; background: var(--orange); flex-shrink: 0; }
  .gate-caps {
    font-family: var(--font-mono); font-size: 10px; font-weight: 600;
    letter-spacing: 0.12em; color: var(--brown-mid);
    margin-bottom: 24px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
    opacity: 0.55;
  }
  .gate-input {
    width: 100%; padding: 12px 14px;
    border: 1px solid #D6D2C8;
    border-radius: 10px;
    font-family: var(--font-sans); font-size: 14px;
    color: #1A1A1A;
    background: #F5F3EF;
    margin-bottom: 10px; outline: none;
    transition: border-color 0.15s, background 0.15s, box-shadow 0.15s;
  }
  .gate-input:focus { border-color: var(--orange); background: #fff; box-shadow: 0 0 0 3px rgba(230,78,26,0.12); }
  .gate-input::placeholder { color: #A8A49C; }
  /* Gate CTA upgraded to the 4px offset-shadow button from /app (kept from rebrand) */
  .gate-btn {
    width: 100%; padding: 13px;
    background: var(--orange);
    color: #fff; border: none; border-radius: 10px;
    font-family: var(--font-sans); font-size: 15px; font-weight: 700;
    cursor: pointer; margin-top: 6px;
    transition: transform var(--t-fast), box-shadow var(--t-fast);
    letter-spacing: -0.2px;
    box-shadow: var(--btn-offset);
  }
  .gate-btn:hover { transform: translateY(-1px); box-shadow: var(--btn-offset-hover); }
  .gate-btn:active { transform: translateY(2px); box-shadow: var(--btn-offset-active); }
  .gate-error { font-size: 13px; color: #ff6b6b; margin-top: -4px; margin-bottom: 8px; display: none; font-family: var(--font-sans); }

  /* ─── VENUE AUTOCOMPLETE ─── */
  .venue-wrap { position: relative; margin-bottom: 10px; }
  .venue-wrap .gate-input { margin-bottom: 0; }
  .venue-dropdown {
    position: absolute; top: calc(100% + 4px); left: 0; right: 0;
    background: #fff; border: 1px solid #D6D2C8;
    border-radius: 12px; box-shadow: 0 8px 24px rgba(0,0,0,0.10); z-index: 200;
    overflow: hidden; display: none;
  }
  .venue-dropdown.open { display: block; }
  .venue-option {
    padding: 12px 14px; font-size: 14px; font-family: var(--font-sans);
    color: #1A1A1A; cursor: pointer; text-align: left;
    border-bottom: 1px solid #EDE9E0; transition: background 0.1s;
    display: flex; align-items: center; gap: 10px;
  }
  .venue-option:last-child { border-bottom: none; }
  .venue-option:hover { background: #F0ECE4; }
  .venue-option .venue-dot { width: 7px; height: 7px; border-radius: 50%; background: var(--orange); flex-shrink: 0; }
  .venue-option .venue-dot.new { background: var(--green); }
  .venue-option strong { font-weight: 600; color: #1A1A1A; }
  .venue-option span { font-size: 12px; color: #6B6867; }
  .venue-confirmed {
    background: rgba(42,157,92,0.07); border: 1px solid rgba(42,157,92,0.2);
    border-radius: 10px; padding: 10px 14px; margin-bottom: 10px;
    display: none; align-items: center; gap: 10px; font-size: 14px; font-weight: 500;
    color: #1A1A1A; text-align: left; font-family: var(--font-sans);
  }
  .venue-confirmed.show { display: flex; }
  .venue-confirmed .vc-dot { width: 7px; height: 7px; border-radius: 50%; background: var(--green); flex-shrink: 0; }
  .venue-confirmed .vc-change { margin-left: auto; font-size: 12px; color: var(--orange); cursor: pointer; font-weight: 700; }

  /* ─── APP SHELL ─── */
  #app { display: flex; flex-direction: column; height: 100%; height: 100dvh; width: 100%; max-width: 100vw; overflow: hidden; }
  header { display: flex; align-items: center; justify-content: space-between; padding: 14px 20px; background: var(--white); border-bottom: none; flex-shrink: 0; box-shadow: 0 1px 8px rgba(0,0,0,0.04); width: 100%; max-width: 100vw; position: relative; }
  header::after { content: ''; position: absolute; bottom: 0; left: 0; right: 0; height: 2px; background: linear-gradient(90deg, var(--orange), var(--purple) 50%, var(--green-brand)); opacity: 0.7; }
  .header-logo { height: 28px; max-width: 180px; object-fit: contain; }
  .header-actions { display: flex; gap: 8px; align-items: center; }
  .icon-btn { background: none; border: none; cursor: pointer; padding: 8px; border-radius: 10px; color: var(--brown-mid); font-size: 18px; transition: all 0.25s var(--ease); display: flex; align-items: center; justify-content: center; }
  .icon-btn:hover { background: var(--cream); color: var(--brown); transform: scale(1.08); }
  .user-chip { display: flex; align-items: center; gap: 8px; background: var(--cream); border-radius: 20px; padding: 6px 12px 6px 8px; font-size: 13px; font-weight: 500; color: var(--brown); }
  .user-chip .dot { width: 8px; height: 8px; border-radius: 50%; background: var(--green); animation: pulseGlow 2s ease-in-out infinite; }
  main { flex: 1; overflow: hidden; display: flex; flex-direction: column; min-height: 0; }
  #messages { flex: 1; overflow-y: auto; overflow-x: hidden; padding: 20px 16px 8px; display: flex; flex-direction: column; gap: 16px; scroll-behavior: smooth; width: 100%; }
  .welcome { display: flex; flex-direction: column; align-items: center; justify-content: center; flex: 1; padding: 28px 20px 20px; gap: 0; text-align: center; position: relative; }
  .welcome::before { content: ''; position: absolute; top: 25%; left: 50%; transform: translate(-50%,-50%); width: 260px; height: 260px; background: radial-gradient(circle, rgba(230,78,26,0.06) 0%, transparent 70%); border-radius: 50%; pointer-events: none; }
  .welcome-wordmark { height: 36px; margin-bottom: 16px; max-width: 200px; object-fit: contain; position: relative; z-index: 1; opacity: 0; animation: staggerIn 0.6s var(--ease) 0.1s forwards; }
  .welcome h2 { font-family: var(--font-display); font-size: clamp(34px, 9vw, 52px); font-weight: 400; line-height: 1.02; letter-spacing: -0.02em; color: var(--brown); margin-bottom: 10px; position: relative; z-index: 1; opacity: 0; animation: staggerIn 0.6s var(--ease) 0.2s forwards; }
  .welcome h2 .accent { color: var(--orange); }
  .welcome p { font-family: var(--font-sans); font-size: 14px; color: var(--brown-mid); margin-bottom: 24px; position: relative; z-index: 1; opacity: 0; animation: staggerIn 0.6s var(--ease) 0.35s forwards; }
  /* ─── ASK ROTATOR (kinetic one-liner) ─── */
  .ask-rotator {
    display: flex; align-items: center; gap: 12px;
    width: 100%; max-width: 340px; margin: 4px auto 18px;
    padding: 15px 20px; text-align: left;
    background: var(--white); border: 1px solid var(--cream-dark);
    border-radius: var(--r-lg); box-shadow: var(--shadow);
    cursor: pointer; position: relative; z-index: 1;
    transition: border-color var(--t-mid), box-shadow var(--t-mid), transform var(--t-fast);
    opacity: 0; animation: staggerIn 0.6s var(--ease) 0.4s forwards;
  }
  .ask-rotator:hover { border-color: var(--orange); box-shadow: var(--e2); transform: translateY(-1px); }
  .ask-rotator:active { transform: translateY(0); }
  .ask-rotator .ar-caret { color: var(--orange); font-weight: 700; font-size: 18px; line-height: 1; flex-shrink: 0; }
  .ask-rotator .ar-text {
    font-family: var(--font-sans); font-size: 15px; font-weight: 500;
    color: var(--brown); line-height: 1.4; flex: 1; min-width: 0;
    transition: opacity 0.34s var(--ease), transform 0.34s var(--ease);
  }
  .ask-rotator.swapping .ar-text { opacity: 0; transform: translateY(4px); }

  /* Keep quick-grid as fallback / below carousel */
  .quick-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; width: 100%; max-width: 360px; margin-bottom: 12px; position: relative; z-index: 1; opacity: 0; animation: staggerIn 0.6s var(--ease) 0.6s forwards; }
  .quick-btn { background: var(--white); border: 1px solid var(--cream-dark); border-radius: 14px; padding: 14px 14px 12px; font-family: var(--font-sans); font-size: 13px; font-weight: 600; color: var(--brown); cursor: pointer; text-align: left; transition: all 0.3s var(--ease); line-height: 1.3; display: flex; flex-direction: column; gap: 6px; }
  .quick-btn:hover { border-color: var(--orange); box-shadow: 0 4px 16px rgba(230,78,26,0.12); transform: translateY(-2px); }
  .quick-btn:active { transform: translateY(0); }
  .quick-btn .emoji { font-size: 20px; }
  .msg { display: flex; align-items: flex-start; gap: 10px; max-width: 100%; animation: msgIn 0.4s var(--ease); }
  .msg.user { flex-direction: row-reverse; }
  .msg-avatar { width: 32px; height: 32px; border-radius: 50%; flex-shrink: 0; background: var(--cream-dark); display: flex; align-items: center; justify-content: center; font-size: 13px; font-weight: 600; color: var(--brown); overflow: hidden; }
  .msg-avatar img { width: 100%; height: 100%; object-fit: contain; }
  .msg-bubble { background: var(--peach); color: var(--brown); border: 1px solid var(--peach-border); border-radius: 18px 18px 18px 4px; padding: 12px 16px; font-size: 15px; line-height: 1.55; max-width: min(calc(100vw - 90px), 520px); box-shadow: var(--e1); white-space: pre-wrap; word-wrap: break-word; }
  .msg-bubble a { color: var(--peach-link); font-weight: 600; text-decoration: underline; }
  .msg-bubble strong { font-weight: 700; }
  .msg.user .msg-bubble { background: var(--brown); color: #fff; border: none; border-radius: 18px 18px 4px 18px; box-shadow: var(--e2); }
  .link-row { display: flex; flex-wrap: wrap; gap: 8px; margin-top: -4px; padding-left: 42px; }
  .link-pill { display: inline-flex; align-items: center; gap: 6px; background: var(--orange); border: none; border-radius: var(--r-pill); padding: 8px 14px; font-size: 13px; font-weight: 600; color: #fff; text-decoration: none; transition: transform var(--t-fast), box-shadow var(--t-mid); white-space: nowrap; box-shadow: 0 2px 8px var(--orange-glow-25); }
  .link-pill:hover { background: #C94A30; transform: translateY(-1px); }
  .typing-bubble { display: flex; align-items: flex-start; gap: 10px; }
  .dots { display: flex; gap: 4px; align-items: center; background: var(--peach); border: 1px solid var(--peach-border); border-radius: 18px 18px 18px 4px; padding: 12px 16px; box-shadow: var(--e1); }
  .dot-anim { width: 8px; height: 8px; border-radius: 50%; animation: dotBounce 1.4s ease-in-out infinite; }
  .dot-anim:nth-child(1) { background: var(--orange); animation-delay: 0s; }
  .dot-anim:nth-child(2) { background: var(--purple); animation-delay: 0.15s; }
  .dot-anim:nth-child(3) { background: var(--green-brand); animation-delay: 0.3s; }
  .input-bar { padding: 10px 12px; padding-bottom: calc(10px + env(safe-area-inset-bottom)); background: var(--white); border-top: 1px solid var(--cream-dark); flex-shrink: 0; display: flex; gap: 8px; align-items: flex-end; min-width: 0; }
  #input { flex: 1; min-width: 0; padding: 11px 14px; background: var(--cream); border: 1.5px solid var(--cream-dark); border-radius: 20px; font-family: var(--font-sans); font-size: 15px; color: var(--brown); resize: none; outline: none; max-height: 120px; line-height: 1.4; transition: border-color 0.2s; }
  #input:focus { border-color: var(--orange); background: #fff; box-shadow: 0 0 0 3px rgba(230,78,26,0.1); }
  #input::placeholder { color: var(--brown-mid); opacity: 0.6; }
  #kbAdd { width: 44px; height: 44px; border-radius: 50%; background: var(--cream); border: 1.5px solid var(--cream-dark); cursor: pointer; display: flex; align-items: center; justify-content: center; flex-shrink: 0; transition: all 0.15s; color: var(--brown-mid); padding: 0; }
  #kbAdd:hover { border-color: var(--orange); color: var(--orange); }
  #mic { width: 44px; height: 44px; border-radius: 50%; background: var(--cream); border: 1.5px solid var(--cream-dark); cursor: pointer; display: flex; align-items: center; justify-content: center; flex-shrink: 0; transition: all 0.15s; color: var(--brown-mid); }
  #mic:hover { border-color: var(--orange); color: var(--orange); }
  #mic.listening { background: var(--orange); border-color: var(--orange); color: #fff; animation: pulse 1s infinite; }
  #attachBtn { width: 44px; height: 44px; border-radius: 50%; background: var(--cream); border: 1.5px solid var(--cream-dark); cursor: pointer; display: flex; align-items: center; justify-content: center; flex-shrink: 0; transition: all 0.15s; color: var(--brown-mid); padding: 0; }
  #attachBtn:hover { border-color: var(--orange); color: var(--orange); }
  #attachBtn.has { border-color: var(--orange); color: var(--orange); background: #fff3ee; }
  .attach-preview { padding: 8px 12px 0; display: flex; }
  .attach-chip { position: relative; display: inline-flex; align-items: center; gap: 8px; background: var(--cream); border: 1.5px solid var(--cream-dark); border-radius: 12px; padding: 5px 10px 5px 5px; max-width: 240px; }
  .attach-chip img { width: 40px; height: 40px; border-radius: 8px; object-fit: cover; display: block; }
  .attach-chip .ac-name { font-size: 12px; color: var(--brown-mid); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .attach-chip .ac-x { border: none; background: var(--brown); color: #fff; width: 18px; height: 18px; border-radius: 50%; font-size: 11px; line-height: 1; cursor: pointer; flex-shrink: 0; }
  .msg-img { max-width: 240px; width: 100%; border-radius: 12px; margin-top: 6px; display: block; }
  @keyframes pulse { 0%,100% { box-shadow: 0 0 0 0 rgba(230,78,26,0.4); } 50% { box-shadow: 0 0 0 8px rgba(230,78,26,0); } }
  #send { width: 44px; height: 44px; border-radius: 50%; background: var(--orange); border: none; cursor: pointer; display: flex; align-items: center; justify-content: center; flex-shrink: 0; transition: all 0.25s var(--ease); box-shadow: 0 2px 12px rgba(230,78,26,0.30); }
  #send:hover { background: var(--orange-light); transform: scale(1.08); box-shadow: 0 4px 18px rgba(230,78,26,0.4); }
  #send:active { transform: scale(0.93); box-shadow: 0 1px 6px rgba(230,78,26,0.2); }
  #send svg { width: 18px; height: 18px; fill: #fff; }
  #send:disabled { opacity: 0.35; cursor: default; transform: none; box-shadow: none; }
  .drawer-overlay { position: fixed; inset: 0; background: rgba(0,0,0,0.4); z-index: 50; opacity: 0; pointer-events: none; transition: opacity 0.3s var(--ease); backdrop-filter: blur(2px); }
  .drawer-overlay.open { opacity: 1; pointer-events: all; }
  .drawer { position: fixed; bottom: 0; left: 0; right: 0; background: var(--white); border-radius: 24px 24px 0 0; z-index: 51; max-height: 70vh; transform: translateY(100%); transition: transform 0.3s cubic-bezier(0.32,0.72,0,1); display: flex; flex-direction: column; padding-bottom: env(safe-area-inset-bottom); }
  .drawer.open { transform: translateY(0); }
  .drawer-handle { width: 40px; height: 4px; background: var(--cream-dark); border-radius: 2px; margin: 12px auto 0; }
  .drawer-header { padding: 16px 20px 12px; font-family: var(--font-display); font-size: 18px; font-weight: 700; border-bottom: 1px solid var(--cream-dark); display: flex; align-items: center; justify-content: space-between; }
  .drawer-close { background: none; border: none; font-size: 20px; cursor: pointer; color: var(--brown-mid); padding: 4px; }
  .drawer-body { overflow-y: auto; padding: 16px 20px; flex: 1; }
  .history-item { padding: 14px 0; border-bottom: 1px solid var(--cream-dark); cursor: pointer; }
  .history-item:last-child { border-bottom: none; }
  .history-item:hover .history-preview { color: var(--orange); }
  .history-date { font-family: var(--font-mono); font-size: 11px; letter-spacing: 0.04em; color: var(--brown-mid); margin-bottom: 4px; }
  .history-preview { font-size: 14px; font-weight: 500; color: var(--brown); transition: color 0.15s; }
  .history-count { font-size: 12px; color: var(--brown-mid); margin-top: 2px; }
  .empty-history { text-align: center; padding: 32px 0; color: var(--brown-mid); font-size: 14px; }
  /* ─── TEAM (manage-team drawer) ─── */
  .team-item { display: flex; align-items: center; gap: 12px; padding: 12px 0; border-bottom: 1px solid var(--cream-dark); }
  .team-item:last-child { border-bottom: none; }
  .team-av { width: 34px; height: 34px; border-radius: 50%; background: var(--cream-dark); color: var(--brown); display: flex; align-items: center; justify-content: center; font-weight: 700; font-size: 14px; flex-shrink: 0; }
  .team-meta { flex: 1; min-width: 0; }
  .team-name { font-size: 14px; font-weight: 600; color: var(--brown); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .team-email { font-size: 12px; color: var(--brown-mid); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .team-role { font-family: var(--font-mono); font-size: 10px; font-weight: 600; letter-spacing: 0.08em; padding: 3px 8px; border-radius: 999px; flex-shrink: 0; }
  .team-role.admin { background: var(--orange-glow-15); color: var(--peach-link); }
  .team-role.staff { background: var(--cream); color: var(--brown-mid); }
  .team-action { font-family: var(--font-mono); font-size: 10px; font-weight: 600; letter-spacing: 0.06em; text-transform: uppercase; background: none; border: 1px solid var(--cream-dark); border-radius: 8px; padding: 6px 9px; cursor: pointer; color: var(--brown-mid); white-space: nowrap; transition: border-color 0.15s, color 0.15s; flex-shrink: 0; }
  .team-action:hover { border-color: var(--orange); color: var(--orange); }
  .team-you { font-family: var(--font-mono); font-size: 10px; color: var(--brown-mid); flex-shrink: 0; }
  .team-note { font-size: 12px; color: var(--brown-mid); padding: 4px 0 12px; line-height: 1.5; }
  /* ─── ADMIN (scoped panel) ─── */
  .admin-section-label { font-family: var(--font-mono); font-size: 10px; font-weight: 600; letter-spacing: 0.14em; text-transform: uppercase; color: var(--brown-mid); margin: 18px 0 10px; }
  .admin-section-label:first-child { margin-top: 4px; }
  .stat-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; }
  .stat-card { background: var(--cream); border: 1px solid var(--cream-dark); border-radius: var(--r-md); padding: 12px 14px; }
  .stat-num { font-family: var(--font-display); font-size: 26px; line-height: 1; color: var(--brown); }
  .stat-num .accent { color: var(--orange); }
  .stat-label { font-family: var(--font-mono); font-size: 9px; font-weight: 600; letter-spacing: 0.1em; text-transform: uppercase; color: var(--brown-mid); margin-top: 6px; }
  .kb-row { display: flex; align-items: center; gap: 10px; padding: 11px 0; border-bottom: 1px solid var(--cream-dark); }
  .kb-row:last-child { border-bottom: none; }
  .kb-icon { width: 30px; height: 30px; border-radius: 8px; background: var(--orange-glow-08); color: var(--peach-link); display: flex; align-items: center; justify-content: center; flex-shrink: 0; font-family: var(--font-mono); font-size: 9px; font-weight: 700; }
  .kb-name { flex: 1; min-width: 0; font-size: 14px; font-weight: 500; color: var(--brown); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .kb-chunks { font-family: var(--font-mono); font-size: 10px; color: var(--brown-mid); flex-shrink: 0; }
  .kb-del { background: none; border: none; cursor: pointer; color: var(--brown-mid); padding: 4px; flex-shrink: 0; font-size: 16px; line-height: 1; transition: color 0.15s; }
  .kb-del:hover { color: var(--red); }
  .admin-btn-row { display: flex; flex-wrap: wrap; gap: 8px; margin-top: 14px; }
  .admin-cta { flex: 1 1 30%; min-width: 100px; padding: 11px; border-radius: var(--r-md); font-family: var(--font-sans); font-size: 13px; font-weight: 700; cursor: pointer; text-align: center; border: none; }
  .admin-cta.primary { background: var(--orange); color: #fff; box-shadow: var(--btn-offset); }
  .admin-cta.ghost { background: var(--cream); color: var(--brown); border: 1px solid var(--cream-dark); }
  /* ─── DISH / MENU IMAGE CARDS (bot replies) ─── */
  .dish-img-row { display: flex; padding-left: 42px; margin-top: -4px; }
  .dish-img-card { max-width: 300px; border: 1px solid var(--cream-dark); border-radius: 16px; overflow: hidden; background: var(--white); box-shadow: var(--shadow); }
  .dish-img-card img { width: 100%; display: block; aspect-ratio: 4 / 3; object-fit: cover; background: var(--cream-dark); }
  .dish-img-cap { padding: 9px 13px; font-size: 13px; font-weight: 600; color: var(--brown); }
  .doc-file-row { display: flex; padding-left: 42px; margin-top: -2px; }
  .doc-file-pill { display: inline-flex; align-items: center; gap: 8px; background: var(--white); border: 1.5px solid var(--cream-dark); border-radius: 20px; padding: 8px 14px; font-family: var(--font-sans); font-size: 13px; font-weight: 600; color: var(--brown); text-decoration: none; cursor: pointer; transition: all 0.2s var(--ease); max-width: min(calc(100vw - 90px), 420px); }
  .doc-file-pill:hover { border-color: var(--orange); color: var(--orange); transform: translateY(-1px); box-shadow: 0 2px 8px rgba(230,78,26,0.12); }
  .doc-file-pill svg { flex-shrink: 0; color: var(--orange); }
  .doc-file-pill span { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .topics-list { display: flex; flex-direction: column; gap: 8px; }
  .topic-chip { background: var(--cream); border: 1.5px solid var(--cream-dark); border-left: 3px solid transparent; border-radius: 12px; padding: 12px 16px; font-size: 14px; font-weight: 500; color: var(--brown); cursor: pointer; text-align: left; display: flex; align-items: center; gap: 10px; transition: all 0.25s var(--ease); }
  .topic-chip:hover { border-color: var(--cream-dark); border-left-color: var(--orange); background: var(--white); transform: translateX(2px); }
  .modal-overlay { position: fixed; inset: 0; background: rgba(0,0,0,0.5); z-index: 200; display: flex; align-items: flex-end; opacity: 0; pointer-events: none; transition: opacity 0.3s var(--ease); backdrop-filter: blur(2px); }
  .modal-overlay.open { opacity: 1; pointer-events: all; }
  .modal { background: var(--white); border-radius: 24px 24px 0 0; padding: 24px 24px calc(24px + env(safe-area-inset-bottom)); width: 100%; transform: translateY(100%); transition: transform 0.3s cubic-bezier(0.32,0.72,0,1); }
  .modal-overlay.open .modal { transform: translateY(0); }
  .modal h3 { font-family: var(--font-display); font-size: 20px; margin-bottom: 6px; }
  .modal p { font-size: 14px; color: var(--brown-mid); margin-bottom: 20px; }
  .modal textarea { width: 100%; border: 1.5px solid var(--cream-dark); border-radius: 12px; padding: 12px 14px; font-family: var(--font-sans); font-size: 14px; color: var(--brown); background: var(--cream); resize: none; height: 100px; outline: none; margin-bottom: 14px; transition: border-color 0.2s; }
  .verify-code { width: 100%; border: 1.5px solid var(--cream-dark); border-radius: 12px; padding: 14px; font-family: var(--font-mono); font-size: 28px; font-weight: 600; letter-spacing: 0.4em; text-align: center; color: var(--brown); background: var(--cream); outline: none; margin-bottom: 14px; transition: border-color 0.2s; }
  .verify-code:focus { border-color: var(--orange); background: #fff; box-shadow: 0 0 0 3px var(--orange-glow-15); }
  .modal textarea:focus { border-color: var(--orange); background: #fff; box-shadow: 0 0 0 3px rgba(230,78,26,0.1); }
  .modal-actions { display: flex; gap: 10px; }
  .modal-cancel { flex: 1; padding: 13px; background: var(--cream); border: none; border-radius: 12px; font-family: var(--font-sans); font-size: 15px; font-weight: 500; cursor: pointer; color: var(--brown); }
  .modal-submit { flex: 2; padding: 13px; background: var(--orange); border: none; border-radius: var(--r-md); font-family: var(--font-sans); font-size: 15px; font-weight: 700; cursor: pointer; color: #fff; box-shadow: var(--btn-offset); transition: transform var(--t-fast), box-shadow var(--t-fast); }
  .modal-submit:hover { transform: translateY(-1px); box-shadow: var(--btn-offset-hover); }
  .modal-submit:active { transform: translateY(2px); box-shadow: var(--btn-offset-active); }
  .toast { position: fixed; bottom: calc(80px + env(safe-area-inset-bottom)); left: 50%; transform: translateX(-50%) translateY(20px); background: var(--brown); color: #fff; border-radius: 20px; padding: 10px 20px; font-size: 14px; font-weight: 500; opacity: 0; transition: all 0.3s; z-index: 300; white-space: nowrap; }
  .reminder-banner { display: flex; align-items: center; gap: 12px; background: #f0fdf4; border: 1.5px solid #86efac; border-radius: 14px; padding: 12px 16px; margin: 8px 16px; cursor: pointer; transition: box-shadow 0.15s; }
  .reminder-banner:hover { box-shadow: 0 4px 16px rgba(34,197,94,0.15); }
  .reminder-banner .rem-icon { font-size: 22px; flex-shrink: 0; }
  .reminder-banner .rem-body { flex: 1; }
  .reminder-banner .rem-title { font-family: var(--font-sans); font-size: 13px; font-weight: 700; color: #15803d; }
  .reminder-banner .rem-sub { font-family: var(--font-sans); font-size: 12px; color: #16a34a; }
  .reminder-banner .rem-cta { font-family: var(--font-sans); font-size: 12px; font-weight: 700; color: #15803d; white-space: nowrap; }
  .escalation-banner { display: flex; align-items: flex-start; gap: 12px; background: #fff8f0; border: 1.5px solid #f59e42; border-radius: 16px; padding: 14px 16px; margin: 0 0 4px 42px; max-width: min(calc(100vw - 90px), 520px); }
  .escalation-banner .esc-icon { font-size: 20px; flex-shrink: 0; margin-top: 1px; }
  .escalation-banner .esc-body { flex: 1; }
  .escalation-banner .esc-title { font-family: var(--font-sans); font-size: 13px; font-weight: 700; color: #92400e; margin-bottom: 3px; }
  .escalation-banner .esc-sub { font-family: var(--font-sans); font-size: 12px; color: #b45309; line-height: 1.4; }
  .toast.show { opacity: 1; transform: translateX(-50%) translateY(0); }
  .toast.green { background: var(--green); }
  .social-proof { display: flex; align-items: center; gap: 5px; font-size: 12px; font-family: var(--font-sans); font-weight: 500; color: var(--brown-mid); margin-bottom: 14px; opacity: 0.7; }
  .social-proof .pulse { width: 6px; height: 6px; border-radius: 50%; background: var(--green); flex-shrink: 0; animation: pulse-green 2s infinite; }
  @keyframes pulse-green { 0%,100% { box-shadow: 0 0 0 0 rgba(42,157,92,0.4); } 50% { box-shadow: 0 0 0 5px rgba(42,157,92,0); } }
  .predict-section { width: 100%; max-width: 380px; margin-top: 4px; }
  .predict-label { font-family: var(--font-mono); font-size: 10px; font-weight: 600; letter-spacing: 0.14em; text-transform: uppercase; color: var(--brown-mid); opacity: 0.7; margin-bottom: 8px; text-align: left; padding-left: 2px; }
  .predict-grid { display: flex; flex-direction: column; gap: 8px; }
  .predict-btn { background: var(--white); border: 1.5px solid var(--cream-dark); border-radius: 12px; padding: 10px 14px; font-family: var(--font-sans); font-size: 13px; font-weight: 600; color: var(--brown); cursor: pointer; text-align: left; display: flex; align-items: center; gap: 10px; transition: border-color 0.2s, box-shadow 0.2s; width: 100%; }
  .predict-btn:hover { border-color: var(--orange); box-shadow: 0 2px 12px rgba(0,0,0,0.10); }
  .predict-btn .predict-icon { font-size: 16px; flex-shrink: 0; }
  .predict-tag { margin-left: auto; font-size: 10px; font-weight: 700; letter-spacing: 0.06em; text-transform: uppercase; background: var(--orange); color: #fff; border-radius: 8px; padding: 2px 7px; flex-shrink: 0; }
  .qr-section { margin-top: 8px; display: flex; flex-direction: column; align-items: center; gap: 6px; }
  .qr-box { background: var(--white); border-radius: 16px; padding: 12px; box-shadow: var(--shadow); cursor: pointer; }
  .qr-box canvas, .qr-box img { display: block; border-radius: 4px; }
  .qr-label { font-size: 11px; color: var(--brown-mid); font-weight: 500; text-align: center; opacity: 0.7; }
  #messages::-webkit-scrollbar { width: 4px; }
  #messages::-webkit-scrollbar-track { background: transparent; }
  #messages::-webkit-scrollbar-thumb { background: var(--cream-dark); border-radius: 2px; }
  .logo-strip { flex-shrink: 0; overflow: hidden; background: var(--white); border-bottom: 1px solid var(--cream-dark); padding: 12px 0; position: relative; }
  .logo-strip::before, .logo-strip::after { content: ''; position: absolute; top: 0; bottom: 0; width: 48px; z-index: 2; pointer-events: none; }
  .logo-strip::before { left: 0; background: linear-gradient(to right, var(--white), transparent); }
  .logo-strip::after { right: 0; background: linear-gradient(to left, var(--white), transparent); }
  .logo-track { display: flex; align-items: center; gap: 44px; width: max-content; animation: logoScroll 60s linear infinite; }
  .logo-track:hover { animation-play-state: paused; }
  .logo-text { font-family: var(--font-mono); font-size: 11px; font-weight: 500; letter-spacing: 0.1em; text-transform: uppercase; color: var(--brown); opacity: 0.32; white-space: nowrap; flex-shrink: 0; user-select: none; }
  .logo-dot { width: 4px; height: 4px; background: var(--brown); border-radius: 50%; opacity: 0.15; flex-shrink: 0; }
  .strip-label { font-family: var(--font-mono); font-size: 10px; font-weight: 600; letter-spacing: 0.14em; text-transform: uppercase; color: var(--brown-mid); opacity: 0.5; white-space: nowrap; flex-shrink: 0; }
  @keyframes logoScroll { 0% { transform: translateX(0); } 100% { transform: translateX(-50%); } }
  .video-row{display:flex;flex-direction:column;gap:8px;margin-top:-4px;padding-left:42px}
  .chat-video-card{background:var(--white);border:1.5px solid var(--cream-dark);border-radius:16px;overflow:hidden;cursor:pointer;transition:box-shadow 0.2s;max-width:320px}
  .chat-video-card:hover{box-shadow:0 4px 16px rgba(0,0,0,0.12);border-color:var(--orange)}
  .chat-video-thumb{width:100%;aspect-ratio:16/9;object-fit:cover;background:var(--cream-dark);display:block}
  .chat-video-thumb-empty{width:100%;aspect-ratio:16/9;background:var(--cream-dark);display:flex;align-items:center;justify-content:center;font-size:32px}
  .chat-video-info{padding:10px 12px}
  .chat-video-title{font-size:13px;font-weight:600;color:var(--brown);margin-bottom:2px}
  .chat-video-sub{font-size:11px;color:var(--brown-mid)}
  .cv-modal{position:fixed;inset:0;background:rgba(0,0,0,.85);z-index:300;display:flex;align-items:center;justify-content:center;padding:16px}
  .cv-modal-box{background:var(--white);border-radius:16px;overflow:hidden;width:100%;max-width:640px}
  .cv-modal-hdr{display:flex;align-items:center;justify-content:space-between;padding:12px 16px;border-bottom:1px solid var(--cream-dark)}
  .cv-modal-title{font-size:14px;font-weight:600;color:var(--brown);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;flex:1;margin-right:8px}
  .cv-modal-close{background:none;border:none;font-size:22px;cursor:pointer;color:var(--brown-mid);padding:4px;line-height:1}
  .cv-modal-body{background:#000}
  .cv-modal-body iframe,.cv-modal-body video{display:block;width:100%;aspect-ratio:16/9}
  .video-pill{display:inline-flex;align-items:center;gap:8px;background:var(--orange);color:#fff;border:none;border-radius:20px;padding:10px 16px;font-family:var(--font-sans);font-size:14px;font-weight:700;cursor:pointer;margin-top:4px;transition:transform var(--t-fast),box-shadow var(--t-mid);box-shadow:var(--btn-offset)}
  .video-pill:hover{background:var(--orange-light)}
  .video-pill-row{display:flex;padding-left:42px;margin-top:-4px}

  /* ─── SHIFT CHECK ─── */
  .shift-check-btn {
    display: flex; align-items: center; gap: 6px;
    background: none; border: 1px solid var(--cream-dark);
    border-radius: 20px; padding: 8px 16px;
    font-family: var(--font-sans); font-size: 12px; font-weight: 600;
    color: var(--brown-mid); cursor: pointer; margin-top: 4px;
    transition: border-color 0.15s, color 0.15s;
  }
  .shift-check-btn:hover { border-color: var(--orange); color: var(--brown); }
  .shift-check-btn .sc-icon { font-size: 14px; }

  .sc-step { padding: 16px 0; border-bottom: 1px solid var(--cream-dark); }
  .sc-step:last-child { border-bottom: none; }
  .sc-step-label { font-size: 15px; font-weight: 600; color: var(--brown); margin-bottom: 10px; display: flex; align-items: center; gap: 8px; }
  .sc-step-label .sc-emoji { font-size: 18px; }
  .sc-options { display: flex; gap: 8px; }
  .sc-opt {
    flex: 1; padding: 10px 8px; border-radius: 10px; border: 2px solid var(--cream-dark);
    font-family: var(--font-sans); font-size: 12px; font-weight: 700;
    cursor: pointer; text-align: center; transition: all 0.15s; background: var(--white);
  }
  .sc-opt:hover { border-color: var(--orange); }
  .sc-opt.selected-green { background: #dcfce7; border-color: #16a34a; color: #166534; }
  .sc-opt.selected-amber { background: #fef9c3; border-color: #ca8a04; color: #854d0e; }
  .sc-opt.selected-red { background: #fee2e2; border-color: #dc2626; color: #991b1b; }
  .sc-progress { height: 3px; background: var(--cream-dark); border-radius: 2px; margin-bottom: 16px; overflow: hidden; }
  .sc-progress-fill { height: 100%; background: var(--orange); border-radius: 2px; transition: width 0.3s ease; }
  .sc-summary { text-align: center; padding: 8px 0 4px; }
  .sc-summary-icon { font-size: 40px; margin-bottom: 8px; }
  .sc-summary-title { font-family: var(--font-display); font-size: 20px; font-weight: 700; margin-bottom: 6px; }
  .sc-summary-sub { font-size: 14px; color: var(--brown-mid); margin-bottom: 16px; line-height: 1.5; }
  .sc-issues-list { text-align: left; margin-bottom: 16px; }
  .sc-issue-item { display: flex; align-items: center; gap: 8px; padding: 8px 12px; background: #fee2e2; border-radius: 8px; margin-bottom: 6px; font-size: 13px; font-weight: 600; color: #991b1b; }
  .sc-issue-item.amber { background: #fef9c3; color: #854d0e; }
  .sc-fix-btn { width: 100%; padding: 13px; background: var(--orange); color: #fff; border: none; border-radius: var(--r-md); font-family: var(--font-sans); font-size: 15px; font-weight: 700; cursor: pointer; margin-bottom: 12px; box-shadow: var(--btn-offset); transition: transform var(--t-fast), box-shadow var(--t-fast); }
  .sc-fix-btn:hover { transform: translateY(-1px); box-shadow: var(--btn-offset-hover); }
  .sc-fix-btn:active { transform: translateY(2px); box-shadow: var(--btn-offset-active); }
  .sc-done-btn { width: 100%; padding: 11px; background: var(--cream); color: var(--brown); border: none; border-radius: 12px; font-family: var(--font-sans); font-size: 14px; font-weight: 500; cursor: pointer; }

  /* ─── TIP OF THE DAY (editorial footnote) ─── */
  .tip-note {
    width: 100%; max-width: 420px; margin: 18px auto 0;
    text-align: center; cursor: pointer; position: relative; z-index: 1;
    opacity: 0; animation: staggerIn 0.6s var(--ease) 0.55s forwards;
  }
  .tip-eyebrow { display: flex; align-items: center; gap: 16px; margin-bottom: 12px; }
  .tip-rule { flex: 1; height: 1px; background: var(--cream-dark); }
  .tip-key {
    font-family: var(--font-mono); font-size: 10px; font-weight: 600;
    letter-spacing: 0.18em; text-transform: uppercase;
    color: var(--brown-mid); white-space: nowrap;
  }
  .tip-key .tip-product { color: var(--orange); }
  .tip-text {
    font-family: var(--font-sans); font-size: 14px; font-weight: 500;
    color: var(--brown-mid); line-height: 1.55; max-width: 340px; margin: 0 auto;
  }
  .tip-cta {
    font-family: var(--font-mono); font-size: 10px; font-weight: 600;
    letter-spacing: 0.14em; text-transform: uppercase; color: var(--orange);
    margin-top: 12px; opacity: 0.65; transition: opacity var(--t-mid);
  }
  .tip-note:hover .tip-cta { opacity: 1; }

  /* ─── NPS WIDGET ─── */
  .nps-wrap { padding-left: 42px; margin-top: -4px; }
  .nps-card { background: var(--white); border: 1.5px solid var(--cream-dark); border-radius: 16px; padding: 14px 16px; max-width: 340px; box-shadow: var(--shadow); }
  .nps-q { font-size: 13px; font-weight: 600; color: var(--brown); margin-bottom: 12px; line-height: 1.4; }
  .nps-q strong { color: var(--orange); }
  .nps-labels { display: flex; justify-content: space-between; margin-bottom: 4px; }
  .nps-label { font-size: 10px; color: var(--brown-mid); font-weight: 500; }
  .nps-row { display: flex; gap: 4px; margin-bottom: 10px; }
  .nps-btn { flex: 1; height: 32px; border-radius: 8px; border: 1.5px solid var(--cream-dark); background: var(--white); font-size: 12px; font-weight: 600; color: var(--brown); cursor: pointer; transition: all 0.15s; padding: 0; min-width: 0; }
  .nps-btn:hover { border-color: var(--orange); color: var(--orange); background: var(--orange-glow-08); }
  .nps-btn.selected { background: var(--orange); border-color: var(--orange); color: #fff; }
  .nps-comment { display: none; margin-top: 6px; }
  .nps-comment.show { display: flex; gap: 6px; }
  .nps-input { flex: 1; padding: 8px 10px; border: 1.5px solid var(--cream-dark); border-radius: 10px; font-family: var(--font-sans); font-size: 13px; color: var(--brown); outline: none; background: var(--cream); transition: border-color 0.15s; }
  .nps-input:focus { border-color: var(--orange); background: #fff; }
  .nps-send { padding: 8px 14px; background: var(--orange); border: none; border-radius: var(--r-sm); color: #fff; font-size: 13px; font-weight: 700; cursor: pointer; white-space: nowrap; box-shadow: var(--btn-offset); transition: transform var(--t-fast), box-shadow var(--t-fast); }
  .nps-send:hover { transform: translateY(-1px); box-shadow: var(--btn-offset-hover); }
  .nps-send:active { transform: translateY(2px); box-shadow: var(--btn-offset-active); }
  .nps-done { font-size: 13px; color: var(--green); font-weight: 600; display: none; align-items: center; gap: 6px; padding-top: 4px; }
  .nps-done.show { display: flex; }
</style>
</head>
<body>

<!-- ─── GATE ─── -->
<div id="gate">
  <div class="gate-bg"></div>
  <div class="gate-scrim"></div>
  <div class="gate-card">
    <img class="gate-logo" id="gateWordmark" src="{{LOGO_URL}}" alt="{{BOT_NAME}}">
    <div class="gate-eyebrow"><span class="ge-dot"></span>AN <span class="accent">AI KNOWLEDGE BASE</span> FOR HOSPITALITY</div>
    <h2>Ask your business<br><span class="accent">anything.</span></h2>
    <p>{{WELCOME_MSG}}</p>
    <div class="gate-caps">HANDBOOKS &middot; SOPs &middot; SUPPLIERS &middot; ROTAS &middot; TECH</div>
    <input class="gate-input" type="text" id="gateName" placeholder="Your name" autocomplete="given-name">

    <!-- Venue autocomplete -->
    <div class="venue-wrap">
      <input class="gate-input" type="text" id="gateVenueInput" placeholder="Venue / group name" autocomplete="off"
        oninput="handleVenueInput(this.value)" onfocus="handleVenueInput(this.value)" onblur="delayCloseDropdown()">
      <div class="venue-dropdown" id="venueDropdown"></div>
    </div>
    <div class="venue-confirmed" id="venueConfirmed">
      <div class="vc-dot"></div>
      <span id="venueConfirmedName"></span>
      <span class="vc-change" onclick="resetVenue()">Change</span>
    </div>

    <input class="gate-input" type="tel" id="gatePhone" placeholder="Phone number" autocomplete="tel">
    <input class="gate-input" type="email" id="gateEmail" placeholder="Email address" autocomplete="email">
    <div class="gate-error" id="gateError">Please fill in all fields with a valid email.</div>
    <button class="gate-btn" onclick="submitGate()">Start chatting &rarr;</button>
  </div>
</div>

<!-- ─── APP ─── -->
<div id="app">
  <header>
    <a href="https://stackedchat.io" style="display:flex;flex-direction:column;align-items:flex-start;text-decoration:none;gap:2px;">
      <img class="header-logo" id="headerIcon" src="{{LOGO_URL}}" alt="{{BOT_NAME}}">
      <span style="font-family:var(--font-mono);font-size:10px;font-weight:600;letter-spacing:0.16em;text-transform:uppercase;color:var(--orange);padding-left:2px;margin-top:3px;">CHAT</span>
    </a>
    <div class="header-actions">
      <div class="user-chip"><div class="dot"></div><span id="userLabel">You</span></div>
      <button class="icon-btn" id="adminBtn" onclick="requireAdminVerify(openAdmin)" title="Admin" style="display:none">
        <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/></svg>
      </button>
      <button class="icon-btn" onclick="openHistory()" title="Chat history">
        <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 8v4l3 3M12 2a10 10 0 1 0 0 20A10 10 0 0 0 12 2z"/></svg>
      </button>
      <button class="icon-btn" onclick="openTopics()" title="Topics">
        <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2"><line x1="3" y1="12" x2="21" y2="12"/><line x1="3" y1="6" x2="21" y2="6"/><line x1="3" y1="18" x2="21" y2="18"/></svg>
      </button>
      <button class="icon-btn" onclick="signOut()" title="Sign out">
        <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><path d="M16 17l5-5-5-5M21 12H9"/></svg>
      </button>
    </div>
  </header>


  <main>
    <div id="messages">
      <div class="welcome" id="welcome">
        <h2 id="welcomeGreeting">Hi there.</h2>
        <p id="welcomeSub">How can I help you today?</p>
      </div>
    </div>
  </main>

  <div id="attachPreview" class="attach-preview" style="display:none"></div>
  <div class="input-bar">
    <input type="file" id="kbFile" accept=".pdf,.doc,.docx,.txt,.csv,.md,.png,.jpg,.jpeg,.webp" style="display:none" onchange="handleKbUpload(this.files)" multiple>
    <input type="file" id="vidFile" accept="video/*" style="display:none" onchange="handleVideoUpload(this.files)" multiple>
    <input type="file" id="chatImgFile" accept="image/*" style="display:none" onchange="handleChatImage(this.files)">
    <button id="kbAdd" onclick="requireAdminVerify(function(){document.getElementById('kbFile').click();})" title="Add to knowledge base" style="display:none">
      <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2.2"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
    </button>
    <button id="attachBtn" onclick="document.getElementById('chatImgFile').click()" title="Attach a photo">
      <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2"><path d="M21.44 11.05l-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48"/></svg>
    </button>
    <textarea id="input" placeholder="Ask anything about your business&hellip;" rows="1" onkeydown="handleKey(event)" oninput="autoResize(this)"></textarea>
    <button id="mic" onclick="toggleMic()" title="Voice input">
      <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2"><rect x="9" y="2" width="6" height="11" rx="3"/><path d="M5 10a7 7 0 0 0 14 0M12 19v3M8 22h8"/></svg>
    </button>
    <button id="send" onclick="sendMessage()" title="Send">
      <svg viewBox="0 0 24 24"><path d="M2 21l21-9L2 3v7l15 2-15 2z"/></svg>
    </button>
  </div>
</div>

<!-- ─── HISTORY DRAWER ─── -->
<div class="drawer-overlay" id="histOverlay" onclick="closeHistory()"></div>
<div class="drawer" id="histDrawer">
  <div class="drawer-handle"></div>
  <div class="drawer-header"><span>Chat history</span><button class="drawer-close" onclick="closeHistory()">&times;</button></div>
  <div class="drawer-body" id="histBody"><div class="empty-history">No previous chats yet.</div></div>
</div>

<!-- ─── TOPICS DRAWER ─── -->
<div class="drawer-overlay" id="topicOverlay" onclick="closeTopics()"></div>
<div class="drawer" id="topicDrawer">
  <div class="drawer-handle"></div>
  <div class="drawer-header"><span>Common topics</span><button class="drawer-close" onclick="closeTopics()">&times;</button></div>
  <div class="drawer-body">
    <div class="topics-list">
      <button class="topic-chip" onclick="quickSend('What is our refund and returns policy?'); closeTopics()">&#x1F4D6; Refund &amp; returns policy</button>
      <button class="topic-chip" onclick="quickSend('When do our supplier deliveries arrive?'); closeTopics()">&#x1F377; Supplier delivery times</button>
      <button class="topic-chip" onclick="quickSend('What allergens are in our menu items?'); closeTopics()">&#x1F957; Allergens in our menu</button>
      <button class="topic-chip" onclick="quickSend('What is the opening and closing checklist?'); closeTopics()">&#x1F4CB; Opening &amp; closing checklist</button>
      <button class="topic-chip" onclick="quickSend('How do I request holiday or time off?'); closeTopics()">&#x1F5D3;&#xFE0F; Request holiday / time off</button>
      <button class="topic-chip" onclick="quickSend('What is the uniform and dress code?'); closeTopics()">&#x1F455; Uniform &amp; dress code</button>
      <button class="topic-chip" onclick="quickSend('My payment terminal is offline'); closeTopics()">&#x1F4B3; Payment terminal offline</button>
      <button class="topic-chip" onclick="quickSend('My EPOS system has frozen or crashed'); closeTopics()">&#x1F4BB; EPOS frozen or crashed</button>
    </div>
  </div>
</div>

<!-- ─── ADMIN DRAWER (scoped analytics + knowledge) ─── -->
<div class="drawer-overlay" id="adminOverlay" onclick="closeAdmin()"></div>
<div class="drawer" id="adminDrawer">
  <div class="drawer-handle"></div>
  <div class="drawer-header"><span>Admin</span><button class="drawer-close" onclick="closeAdmin()">&times;</button></div>
  <div class="drawer-body" id="adminBody"><div class="empty-history">Loading&hellip;</div></div>
</div>

<!-- ─── TEAM DRAWER (admin manage-team) ─── -->
<div class="drawer-overlay" id="teamOverlay" onclick="closeTeam()"></div>
<div class="drawer" id="teamDrawer">
  <div class="drawer-handle"></div>
  <div class="drawer-header"><span>Your team</span><button class="drawer-close" onclick="closeTeam()">&times;</button></div>
  <div class="drawer-body" id="teamBody"><div class="empty-history">Loading&hellip;</div></div>
</div>


<!-- ─── ADMIN VERIFY MODAL (email code) ─── -->
<div class="modal-overlay" id="verifyOverlay">
  <div class="modal">
    <h3>Confirm it&#39;s you</h3>
    <div id="verifyStep1">
      <p>Managing knowledge is admin-only. We&#39;ll email a verification code to <strong id="verifyEmail"></strong> to confirm it&#39;s you.</p>
      <div class="modal-actions">
        <button class="modal-cancel" onclick="closeVerify()">Cancel</button>
        <button class="modal-submit" id="verifySendBtn" onclick="sendAuthCode()">Send code</button>
      </div>
    </div>
    <div id="verifyStep2" style="display:none">
      <p>Enter the code we just emailed you.</p>
      <input class="verify-code" id="verifyCodeInput" inputmode="numeric" maxlength="8" placeholder="00000000" autocomplete="one-time-code">
      <div class="modal-actions">
        <button class="modal-cancel" onclick="sendAuthCode()">Resend</button>
        <button class="modal-submit" onclick="verifyAuthCode()">Verify</button>
      </div>
    </div>
  </div>
</div>

<!-- ─── ADD DISH IMAGE MODAL ─── -->
<div class="modal-overlay" id="imgAddOverlay">
  <div class="modal">
    <h3>Add a dish image</h3>
    <p>Upload a photo and name it, so the team can ask the bot to show it.</p>
    <input class="gate-input" id="imgTitle" type="text" placeholder="Name (e.g. Margherita Pizza)">
    <input class="gate-input" id="imgDesc" type="text" placeholder="Short description (optional)">
    <input class="gate-input" id="imgFile" type="file" accept="image/*" style="padding:9px 12px">
    <div class="modal-actions">
      <button class="modal-cancel" onclick="closeImgAdd()">Cancel</button>
      <button class="modal-submit" onclick="submitImage()">Add image</button>
    </div>
  </div>
</div>

<!-- ─── ADD VIDEO LINK MODAL ─── -->
<div class="modal-overlay" id="vidLinkOverlay">
  <div class="modal">
    <h3>Add a video link</h3>
    <p>Paste a YouTube, Vimeo or video URL &mdash; no size limit, ideal for longer training videos.</p>
    <input class="gate-input" id="vidLinkUrl" type="url" placeholder="https://youtube.com/watch?v=&hellip;">
    <input class="gate-input" id="vidLinkTitle" type="text" placeholder="Title (optional)">
    <div class="modal-actions">
      <button class="modal-cancel" onclick="closeVideoLink()">Cancel</button>
      <button class="modal-submit" onclick="handleVideoLink()">Add video</button>
    </div>
  </div>
</div>

<div class="toast" id="toast"></div>

<div class="cv-modal" id="cvModal" style="display:none" onclick="if(event.target===this)closeCvModal()">
  <div class="cv-modal-box">
    <div class="cv-modal-hdr"><span class="cv-modal-title" id="cvModalTitle"></span><button class="cv-modal-close" onclick="closeCvModal()">&#x2715;</button></div>
    <div class="cv-modal-body" id="cvModalBody"></div>
  </div>
</div>

<script>
// ─── CONFIG ───────────────────────────────────────────────────────────────
const SERVER_URL = 'https://toast-support-bot.onrender.com';
const SUPABASE_URL = 'https://yuzlfocqovwhqdpitvxj.supabase.co';
// Preset venue — injected server-side when page is served via /chat/:slug
const PRESET_VENUE_ID = '{{VENUE_ID}}';
const PRESET_VENUE_NAME = '{{VENUE_NAME}}';
// ── GATE HERO BACKGROUND ──────────────────────────────────────────────────
// Paste a hosted image URL here for a full-bleed photo behind the gate
// (a cream scrim keeps the card readable). Leave '' for the brand-gradient
// fallback. Use a direct image link (.jpg/.png/.webp), e.g. a raw GitHub URL.
const GATE_BG_URL = 'https://raw.githubusercontent.com/TOT-STACKED/stacked-chat/main/ChatGPT%20Image%20May%2018%2C%202026%2C%2002_05_23%20PM.png';
const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Inl1emxmb2Nxb3Z3aHFkcGl0dnhqIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzIyODE3OTgsImV4cCI6MjA4Nzg1Nzc5OH0.zN_GOXI8MI9isqnVRCZvxAmU1ZyXIfWvq-P3SkSh4Vk';
const ICON_URL = 'data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iNTYiIGhlaWdodD0iODgiIHZpZXdCb3g9IjAgMCA1NiA4OCIgZmlsbD0ibm9uZSIgeG1sbnM9Imh0dHA6Ly93d3cudzMub3JnLzIwMDAvc3ZnIj4KPHBhdGggZD0iTTU1LjQxNTIgNjIuOTkzNUM1NS40MzM0IDY2LjczMTcgNTQuOTA2MSA3MC4wODA5IDUzLjg0MDcgNzMuMDMzNkM1Mi43NzE2IDc1Ljk5IDUxLjEwOTcgNzguNTI0NiA0OC44NTUyIDgwLjY0MUM0Ni41OTcgODIuNzU3NCA0My43MzUxIDg0LjM3OTIgNDAuMjYyMyA4NS40OTkyQzM2Ljc4OTYgODYuNjE5MiAzMi42NTUgODcuMTkwMiAyNy44NjIyIDg3LjIxMkMyMy4wNjk0IDg3LjIzMDIgMTguOTE2NiA4Ni42OTU2IDE1LjQxMTEgODUuNjA0N0MxMS45MDIgODQuNTEzOCA5LjAyNTYxIDgyLjkxNzQgNi43NzgzMSA4MC44MTkyQzQuNTMxMDEgNzguNzI0NiAyLjg1ODI2IDc2LjIwMDkgMS43NjczNCA3My4yNTU0QzAuNjc2NDIxIDcwLjMxIDAuMTIwMDUxIDY2Ljk2ODEgMC4xMDU1MDYgNjMuMjI5OUw0Ljk4MTQ1ZS0wNSA0OS45ODYxQy0wLjAwNzIyMyA0OC40MDQzIDAuNzgxODc3IDQ3LjYxMTUgMi4zNjAwOCA0Ny42MDQyTDExLjkwNTYgNDcuNTY0MkMxMi41MDkzIDQ4LjE2MDYgMTMuMTcxMSA0OC43MDYxIDEzLjg4MDIgNDkuMjA0M0MxNS44NjkzIDUwLjU5NyAxOC4yOTg0IDUxLjUyNzkgMjEuMTY3NiA1MS45OTdDMjQuMDMzMSA1Mi40NjI1IDI3LjM0MjIgNTIuNDI2MSAzMS4wOTEzIDUxLjg4MDdDMzQuODQ0MSA1MS4zMzUyIDM4LjAxNSA1MC40MzM0IDQwLjYxMTQgNDkuMTcxNUM0MS42ODc4IDQ4LjY0NzkgNDIuNjczMyA0OC4wNjYxIDQzLjU2NzggNDcuNDI5N0w1Mi45MzE2IDQ3LjM4OTdDNTQuNTEzNCA0Ny4zODI0IDU1LjMwNjEgNDguMTY3OSA1NS4zMTM0IDQ5Ljc0OTdMNTUuNDE1MiA2Mi45OTM1WiIgZmlsbD0iI0U2NTQzQSIvPgo8cGF0aCBkPSJNNDMuNTY5NCA0Ny40MzA3QzQyLjY3NDggNDguMDY3IDQxLjY4OTQgNDguNjQ4OSA0MC42MTMgNDkuMTcyNUMzOC4wMTY2IDUwLjQzNDMgMzQuODQ1NyA1MS4zMzYyIDMxLjA5MjkgNTEuODgxNkMyNy4zNDM4IDUyLjQyNzEgMjQuMDM0NiA1Mi40NjM0IDIxLjE2OTIgNTEuOTk4QzE4LjMgNTEuNTI4OSAxNS44NzA5IDUwLjU5OCAxMy44ODE4IDQ5LjIwNTJDMTMuMTcyNyA0OC43MDcgMTIuNTEwOSA0OC4xNjE2IDExLjkwNzIgNDcuNTY1Mkw0My41Njk0IDQ3LjQzMDdaIiBmaWxsPSIjQjczNTFGIi8+CjxwYXRoIGQ9Ik00OS44NjA5IDM3LjkxNjVDNDkuMzUxOCA0MC4zNDU3IDQ4LjMzIDQyLjUxMyA0Ni43OTkxIDQ0LjQyMjFDNDUuOTAwOSA0NS41MzQ4IDQ0LjgyNDUgNDYuNTM4NSA0My41NjYzIDQ3LjQyOTRMMTEuOTA0MSA0Ny41NjM5QzEwLjgwNTkgNDYuNDgzOSA5Ljg3ODYzIDQ1LjI0MDMgOS4xMjIyNiA0My44MzY2QzcuOTQwNDMgNDEuNjQ3NSA3LjEzNjc4IDM5LjA5NDcgNi43MTQ5NiAzNi4xNjc0TDUuMTY5NDkgMjUuODEwOUM0Ljk5MTMgMjQuNTc0NiA1LjUxODU4IDIzLjg2NTUgNi43NTQ5NiAyMy42ODczTDEyLjI2NDEgMjIuODg3M0MxMy4xMjIzIDIzLjUyMzYgMTQuMTAwNSAyNC4wODczIDE1LjE5MTQgMjQuNTc4MkMxNy4yODYgMjUuNTIgMTkuODIwNiAyNi4xNjM3IDIyLjc5ODggMjYuNTEyOEMyNS43NzM0IDI2Ljg1ODIgMjguMzgwNyAyNi44MTQ2IDMwLjYyMDcgMjYuMzgxOUMzMi44NjA3IDI1Ljk0NTUgMzQuNzU4OSAyNS4xNTY0IDM2LjMxODkgMjQuMDE0NkMzNy44NzUzIDIyLjg2OTEgMzkuMDk3MiAyMS40MjE4IDM5Ljk4NDQgMTkuNjY5MUM0MC4xMjYzIDE5LjM4NTQgNDAuMjYwOCAxOS4wOTgxIDQwLjM4MDggMTguOEw0Ni4zMjI3IDE3LjkzODFDNDcuNTU5MSAxNy43NTYzIDQ4LjI2NDUgMTguMjg3MiA0OC40NDY0IDE5LjUyMzZMNDkuOTg4MiAyOS44ODAxQzUwLjQxMzYgMzIuODAzNyA1MC4zNyAzNS40ODM4IDQ5Ljg2MDkgMzcuOTE2NVoiIGZpbGw9IiNFNjU0M0EiLz4KPHBhdGggZD0iTTQwLjM4MTMgMTguODAwOEM0MC4yNjEzIDE5LjA5OSA0MC4xMjY4IDE5LjM4NjIgMzkuOTg1IDE5LjY2OTlDMzkuMDk3NyAyMS40MjI2IDM3Ljg3NTkgMjIuODY5OSAzNi4zMTk1IDI0LjAxNTRDMzQuNzU5NSAyNS4xNTcyIDMyLjg2MTMgMjUuOTQ2MyAzMC42MjEyIDI2LjM4MjdDMjguMzgxMiAyNi44MTU0IDI1Ljc3MzkgMjYuODU5MSAyMi43OTkzIDI2LjUxMzZDMTkuODIxMSAyNi4xNjQ1IDE3LjI4NjUgMjUuNTIwOSAxNS4xOTIgMjQuNTc5QzE0LjEwMSAyNC4wODgxIDEzLjEyMjggMjMuNTI0NSAxMi4yNjQ2IDIyLjg4ODFMNDAuMzgxMyAxOC44MDA4WiIgZmlsbD0iI0I3MzUxRiIvPgo8cGF0aCBkPSJNNDIuNjUwNCA1LjMzMTI4TDQxLjcxOTQgMTMuNTU2OEM0MS40OTA0IDE1LjUwNTkgNDEuMDQ2NyAxNy4yNTUxIDQwLjM4MTIgMTguODAwNUwxMi4yNjQ2IDIyLjg4NzlDMTEuNDc5MSAyMi4zMDYgMTAuNzg4MiAyMS42NjI0IDEwLjE5NTQgMjAuOTYwNkM4Ljk1OTA3IDE5LjQ5MTQgOC4xMTE3OCAxNy44MDA1IDcuNjUzNiAxNS44OTE0QzcuMTk5MDUgMTMuOTc4NyA3LjEwODEzIDExLjg2NTkgNy4zNzcyMyA5LjU0MjI0TDguMzA4MTUgMS4zMTY2OUM4LjQyNDUxIDAuMzM0ODYyIDguOTczNjEgLTAuMDk3ODY5OSA5Ljk1MTggMC4wMTg0OTUxTDQxLjM0ODUgMy42ODc2M0M0Mi4zMzA0IDMuODAwMzYgNDIuNzYzMSA0LjM0OTQ1IDQyLjY1MDQgNS4zMzEyOFoiIGZpbGw9IiNFNjU0M0EiLz4KPC9zdmc+Cg==';

// ─── STATE ────────────────────────────────────────────────────────────────
let user = null;
let messages = [];
let conversationId = null;
let lastBotMsg = '';
let npsShown = false;

// Venue autocomplete state
let selectedVenueId = PRESET_VENUE_ID || null;
let selectedVenueName = PRESET_VENUE_NAME || null;
let selectedIsNew = false;
let venueSearchTimeout = null;
let dropdownBlurTimeout = null;

// ─── INIT ─────────────────────────────────────────────────────────────────
window.addEventListener('DOMContentLoaded', () => {
  if (GATE_BG_URL) {
    document.documentElement.style.setProperty('--gate-bg', 'url("' + GATE_BG_URL + '")');
    document.getElementById('gate').classList.add('has-bg');
  }

  // If this is a branded slug page, hide the venue picker and show a locked badge
  if (PRESET_VENUE_ID && PRESET_VENUE_NAME) {
    const venueWrap = document.querySelector('.venue-wrap');
    const venueConfirmed = document.getElementById('venueConfirmed');
    const venueConfirmedName = document.getElementById('venueConfirmedName');
    const vcChange = document.querySelector('.vc-change');
    if (venueWrap) venueWrap.style.display = 'none';
    if (venueConfirmedName) venueConfirmedName.textContent = PRESET_VENUE_NAME;
    if (venueConfirmed) venueConfirmed.style.display = 'flex';
    if (vcChange) vcChange.style.display = 'none'; // no "Change" link on locked pages
  }

  const saved = localStorage.getItem('stacked_user');
  if (saved) {
    user = JSON.parse(saved);
    showApp();
  }
});

function checkShiftReminder() {
  const hour = new Date().getHours();
  if (hour < 7 || hour >= 11) return; // only show 7am–11am
  const today = new Date().toDateString();
  const lastCheck = localStorage.getItem('stacked_last_shift_check');
  if (lastCheck === today) return; // already done today
  const banner = document.getElementById('shiftReminder');
  if (banner) banner.style.display = 'flex';
}

function dismissReminder() {
  const banner = document.getElementById('shiftReminder');
  if (banner) banner.style.display = 'none';
  openShiftCheck();
}

function markShiftCheckDone() {
  localStorage.setItem('stacked_last_shift_check', new Date().toDateString());
  const banner = document.getElementById('shiftReminder');
  if (banner) banner.style.display = 'none';
}

// ─── VENUE AUTOCOMPLETE ───────────────────────────────────────────────────
async function handleVenueInput(val) {
  clearTimeout(venueSearchTimeout);
  if (val.length < 2) { closeDropdown(); return; }
  venueSearchTimeout = setTimeout(async () => {
    try {
      const r = await fetch(SERVER_URL + '/venues/search?q=' + encodeURIComponent(val));
      const venues = await r.json();
      showDropdown(venues, val);
    } catch(e) {
      // On error just show create option
      showDropdown([], val);
    }
  }, 220);
}

function showDropdown(venues, query) {
  const dd = document.getElementById('venueDropdown');
  dd.innerHTML = '';

  venues.slice(0, 5).forEach(v => {
    const opt = document.createElement('div');
    opt.className = 'venue-option';
    opt.innerHTML = '<div class="venue-dot"></div><div><strong>' + escHtml(v.name) + '</strong></div>';
    opt.onmousedown = (e) => { e.preventDefault(); selectVenue(v.id, v.name, false); };
    dd.appendChild(opt);
  });

  // Always offer "create new" at the bottom
  const createOpt = document.createElement('div');
  createOpt.className = 'venue-option';
  createOpt.innerHTML = '<div class="venue-dot new"></div><div><strong>Create &ldquo;' + escHtml(query) + '&rdquo;</strong> <span>New venue</span></div>';
  createOpt.onmousedown = (e) => { e.preventDefault(); selectVenue(null, query, true); };
  dd.appendChild(createOpt);

  dd.classList.add('open');
}

function closeDropdown() {
  document.getElementById('venueDropdown').classList.remove('open');
}

function delayCloseDropdown() {
  dropdownBlurTimeout = setTimeout(closeDropdown, 200);
}

function selectVenue(id, name, isNew) {
  clearTimeout(dropdownBlurTimeout);
  selectedVenueId = id;
  selectedVenueName = name;
  selectedIsNew = isNew;

  document.getElementById('gateVenueInput').style.display = 'none';
  closeDropdown();

  const confirmed = document.getElementById('venueConfirmed');
  document.getElementById('venueConfirmedName').textContent = isNew ? '+ ' + name + ' (new venue)' : name;
  confirmed.classList.add('show');
}

function resetVenue() {
  selectedVenueId = null;
  selectedVenueName = null;
  selectedIsNew = false;
  document.getElementById('gateVenueInput').style.display = '';
  document.getElementById('gateVenueInput').value = '';
  document.getElementById('gateVenueInput').focus();
  document.getElementById('venueConfirmed').classList.remove('show');
}

function escHtml(s) { return String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); }

// ─── GATE SUBMIT ──────────────────────────────────────────────────────────
async function submitGate() {
  const name = document.getElementById('gateName').value.trim();
  const phone = document.getElementById('gatePhone').value.trim();
  const email = document.getElementById('gateEmail').value.trim();
  const err = document.getElementById('gateError');

  if (!name || !selectedVenueName || !email || !/\\S+@\\S+\\.\\S+/.test(email)) {
    err.textContent = !selectedVenueName
      ? 'Please select or create a venue before continuing.'
      : 'Please fill in all fields with a valid email.';
    err.style.display = 'block';
    return;
  }
  err.style.display = 'none';

  try {
    // Resolve venue_id: create new venue if needed
    const venueRes = await fetch(SERVER_URL + '/venues', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: selectedVenueId, name: selectedVenueName, isNew: selectedIsNew })
    });
    const venueData = await venueRes.json();
    const venueId = venueData.venue_id;

    user = { name, venue: selectedVenueName, venue_id: venueId, phone, email };
    localStorage.setItem('stacked_user', JSON.stringify(user));

    // Save lead and venue member in parallel; capture the assigned role.
    const [, memberRes] = await Promise.all([
      fetch(SERVER_URL + '/save-lead', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, venue: selectedVenueName, venue_id: venueId, phone, email })
      }),
      fetch(SERVER_URL + '/venue-members', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ venue_id: venueId, name, email, phone })
      })
    ]);
    try {
      const md = await memberRes.json();
      user.role = (md && md.role) ? md.role : 'staff';
      localStorage.setItem('stacked_user', JSON.stringify(user));
    } catch(e) { /* role optional */ }
  } catch(e) {
    // Fail gracefully - still let them in
    user = { name, venue: selectedVenueName, venue_id: null, phone, email };
    localStorage.setItem('stacked_user', JSON.stringify(user));
  }

  showApp();
}

function showApp() {
  document.getElementById('gate').classList.add('hidden');
  document.getElementById('userLabel').textContent = user.name.split(' ')[0];
  const isAdmin = user && user.role === 'admin';
  const adminBtn = document.getElementById('adminBtn');
  if (adminBtn) adminBtn.style.display = isAdmin ? 'flex' : 'none';
  const kbAdd = document.getElementById('kbAdd');
  if (kbAdd) kbAdd.style.display = isAdmin ? 'flex' : 'none';
  personaliseWelcome();
  loadHistory();
}

// ─── SUPABASE HELPERS ─────────────────────────────────────────────────────
async function supabaseSelect(table, filter) {
  const url = SUPABASE_URL + '/rest/v1/' + table + '?' + filter + '&order=created_at.desc';
  const r = await fetch(url, { headers: { 'apikey': SUPABASE_KEY, 'Authorization': 'Bearer ' + SUPABASE_KEY } });
  return r.json();
}

// ─── CHAT ─────────────────────────────────────────────────────────────────
function handleKey(e) { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendMessage(); } }
function autoResize(el) { el.style.height = 'auto'; el.style.height = Math.min(el.scrollHeight, 120) + 'px'; }
function quickSend(text) { document.getElementById('input').value = text; sendMessage(); }

const ALL_QUICK_BTNS = [
  { emoji: '💻', label: 'EPOS crashed', msg: 'My EPOS has crashed mid-service' },
  { emoji: '💳', label: 'Payment terminal offline', msg: 'My payment terminal is offline' },
  { emoji: '📶', label: 'WiFi down', msg: 'WiFi is down in my venue' },
  { emoji: '🖨️', label: 'Kitchen printer issue', msg: 'Kitchen printer not receiving orders' },
  { emoji: '📅', label: 'Reservation system down', msg: 'My reservation system is not working' },
  { emoji: '🔒', label: "Cannot log in", msg: 'Staff cannot log in to the system' },
  { emoji: '📱', label: 'Contactless not working', msg: 'Contactless payments not working' },
  { emoji: '🐌', label: 'EPOS running slow', msg: 'EPOS is running slowly mid-service' },
];

async function loadSocialProof() {
  try {
    const r = await fetch(SERVER_URL + '/analytics');
    const data = await r.json();
    const el = document.getElementById('socialProofText');
    if (el) el.textContent = (data.totalMessages || 0).toLocaleString() + ' issues resolved this month';
  } catch(e) {
    const el = document.getElementById('socialProofText');
    if (el) el.textContent = 'Hospitality tech support, powered by AI';
  }
}

const WELCOME_LINES = [
  'How can I help you today?',
  'What do you need to know?',
  'Ask me anything about your business.',
  'What can I dig up for you?',
  'Need a hand? Just ask.',
  'Your knowledge, on tap.',
  "What's the question?",
  'Ready when you are.',
  "Let's get you sorted.",
  'Handbooks, suppliers, tech \\u2014 fire away.',
  'What\\'s playing up today?',
  'Go on, ask me something.'
];
function personaliseWelcome() {
  if (!user) return;
  const first = ((user.name || '').trim().split(' ')[0] || 'there').replace(/[<>&]/g, '');
  const g = document.getElementById('welcomeGreeting');
  if (g) g.innerHTML = 'Hi <span class="accent">' + first + '</span>.';
  const s = document.getElementById('welcomeSub');
  if (s) s.textContent = WELCOME_LINES[Math.floor(Math.random() * WELCOME_LINES.length)];
}

const TIME_ISSUES = {
  morning:   [{ icon:'\☕', text:'Till not opening at start of day', tag:'Common 8-11am' }, { icon:'📶', text:'WiFi not connecting for staff', tag:'Morning issue' }],
  lunch:     [{ icon:'💳', text:'Payment terminal slow during rush', tag:'Common 12-2pm' }, { icon:'🖨️', text:'Kitchen printer missing orders', tag:'Rush hour' }],
  afternoon: [{ icon:'📋', text:'Reservations not syncing', tag:'Common 2-5pm' }, { icon:'🔒', text:'Staff login issues after shift change', tag:'Afternoon' }],
  evening:   [{ icon:'💻', text:'EPOS freezing mid-service', tag:'Common 5-10pm' }, { icon:'📱', text:'Contactless not working at table', tag:'Service issue' }],
  latenight: [{ icon:'🔌', text:'System not closing down properly', tag:'End of night' }, { icon:'📊', text:'Reports not generating', tag:'Close of day' }],
};

async function loadPredictiveFixes() {
  const hour = new Date().getHours();
  const day = new Date().getDay();
  const isWeekend = day === 0 || day === 5 || day === 6;
  let period = 'morning';
  if (hour >= 12 && hour < 14) period = 'lunch';
  else if (hour >= 14 && hour < 17) period = 'afternoon';
  else if (hour >= 17 && hour < 22) period = 'evening';
  else if (hour >= 22 || hour < 6) period = 'latenight';
  let issues = [...TIME_ISSUES[period]];
  try {
    const r = await fetch(SERVER_URL + '/analytics');
    const data = await r.json();
    if (data.topTopics && data.topTopics.length > 0) {
      const topicMap = { 'epos': { icon:'💻', text:'EPOS issues' }, 'payment': { icon:'💳', text:'Payment terminal problems' }, 'wifi': { icon:'📶', text:'WiFi / network issues' }, 'printer': { icon:'🖨️', text:'Printer not working' }, 'login': { icon:'🔒', text:'Login / access issues' }, 'reservation': { icon:'📅', text:'Reservation system issues' } };
      data.topTopics.slice(0, 2).forEach(topic => {
        const key = Object.keys(topicMap).find(k => topic.toLowerCase().includes(k));
        if (key) issues.unshift({ ...topicMap[key], tag: 'Trending now' });
      });
      issues = issues.slice(0, 3);
    }
  } catch(e) {}
  const label = document.getElementById('predictLabel');
  const grid = document.getElementById('predictGrid');
  const section = document.getElementById('predictSection');
  if (!grid || !section) return;
  if (label) label.textContent = 'Common issues ' + (isWeekend ? 'this weekend' : 'today') + ' \· ' + (period === 'evening' ? 'evening service' : period);
  grid.innerHTML = issues.slice(0,3).map(i =>
    '<button class="predict-btn" data-action="predictSend" data-msg="' + i.text.replace(/"/g,'&quot;') + '">' +
    '<span class="predict-icon">' + i.icon + '</span><span>' + i.text + '</span>' +
    '<span class="predict-tag">' + i.tag + '</span></button>'
  ).join('');
  section.style.display = 'block';
}

function renderQRCode() {
  const el = document.getElementById('qrCode');
  if (!el || typeof QRCode === 'undefined') return;
  el.innerHTML = '';
  new QRCode(el, { text: window.location.href.split('?')[0], width: 96, height: 96, colorDark: '#1A1A1A', colorLight: '#ffffff', correctLevel: QRCode.CorrectLevel.M });
}

function renderQuickBtns() {
  const grid = document.getElementById('quickGrid');
  if (!grid) return;
  const shuffled = [...ALL_QUICK_BTNS].sort(() => Math.random() - 0.5).slice(0, 4);
  grid.innerHTML = shuffled.map(b =>
    '<button class="quick-btn" data-action="quickSend" data-msg="' + b.msg.replace(/"/g,'&quot;') + '">' +
    '<span class="emoji">' + b.emoji + '</span>' + b.label + '</button>'
  ).join('');
}

// ─── ASK ROTATOR (kinetic one-liner) ──────────────────────────────────────
const ASK_PROMPTS = [
  'How do I reset the card terminal?',
  'My EPOS has crashed mid-service',
  'The kitchen printer isn\\'t receiving orders',
  'WiFi is down across the venue',
  'What time does the wine delivery arrive?',
  'A guest is asking about allergens',
  'Staff can\\'t log in to the system',
  'Contactless payments aren\\'t working',
  'How do I run the end-of-day report?',
  'The reservation system isn\\'t syncing',
];

let _askIdx = 0;
let _askTimer = null;

function renderCarousel() {
  const btn = document.getElementById('askRotator');
  const txt = document.getElementById('askRotatorText');
  if (!btn || !txt) return;
  const prompts = [...ASK_PROMPTS].sort(() => Math.random() - 0.5);
  _askIdx = 0;
  const paint = () => {
    const q = prompts[_askIdx % prompts.length];
    txt.textContent = '\\u201C' + q + '\\u201D';
    btn.dataset.msg = q;
  };
  paint();
  clearInterval(_askTimer);
  _askTimer = setInterval(() => {
    btn.classList.add('swapping');
    setTimeout(() => {
      _askIdx = (_askIdx + 1) % prompts.length;
      paint();
      btn.classList.remove('swapping');
    }, 340);
  }, 3400);
}

// Stop the rotator when chat starts
function stopCarousel() { clearInterval(_askTimer); }

// ─── TIPS OF THE DAY ──────────────────────────────────────────────────────
const ALL_TIPS = [
  { product: 'Square', text: 'Did you know Square can split a bill by seat? Tap the item, then "Split item" to divide it across covers.' },
  { product: 'Square', text: 'Square offline mode lets you take card payments even when your internet goes down. Transactions sync automatically when you reconnect.' },
  { product: 'Square', text: 'You can print a kitchen ticket and a customer receipt simultaneously on Square — set it up in Printing > Printer Settings.' },
  { product: 'Lightspeed', text: 'Lightspeed’s floor plan view lets you drag and merge tables mid-service. Long-press any table to start.' },
  { product: 'Lightspeed', text: 'You can set automatic happy hour pricing in Lightspeed — go to Settings > Price rules > Time-based discounts.' },
  { product: 'Deputy', text: 'Deputy can auto-approve shift swaps between staff with matching roles — turn it on under Scheduling > Swap settings.' },
  { product: 'Deputy', text: 'Did you know Deputy sends SMS reminders to staff before their shift? Reduce no-shows by enabling it in Notifications.' },
  { product: 'OpenTable', text: 'OpenTable’s shift notes let you brief your floor team before service — add them in Reservations > Shift summary.' },
  { product: 'OpenTable', text: 'You can set a minimum dining duration per table in OpenTable to prevent back-to-back bookings that are too tight.' },
  { product: 'Tevalis', text: 'Tevalis holds orders in a print queue if the kitchen printer goes offline — they all fire through when it reconnects.' },
  { product: 'Deliverect', text: 'Deliverect can auto-pause your delivery platforms if you’re approaching max kitchen capacity. Set a threshold in your hub settings.' },
  { product: 'Tenzo', text: 'Tenzo can show you your revenue per cover by day part — useful for spotting which sessions are underperforming.' },
  { product: 'Airship', text: 'Airship’s birthday campaign can be fully automated — set it once and it sends a personalised offer to every customer on their birthday.' },
  { product: 'SumUp', text: 'SumUp’s Solo terminal has a tipping prompt built in — enable it in your SumUp app under Payment settings.' },
  { product: 'ResDiary', text: 'ResDiary can send automated pre-visit emails with your menu and parking info — set up in Marketing > Pre-visit messages.' },
  { product: 'SevenRooms', text: 'SevenRooms tracks a guest’s lifetime spend and visit history automatically — your team can see it on the host app before they arrive.' },
  { product: 'Nory', text: 'Nory predicts your busiest shifts using weather data and local events — check the forecast view before building your rota.' },
  { product: 'Bizimply', text: 'Bizimply’s clock-in app can enforce geofencing — staff can only clock in when they’re physically at your venue.' },
  { product: 'Planday', text: 'Planday’s punch clock can take a photo on clock-in to prevent buddy punching — enable it in Clock-in settings.' },
  { product: 'Collins', text: 'Collins can automatically add a deposit to large-party bookings — set the threshold in your venue settings.' },
  { product: 'Stampede', text: 'Stampede captures WiFi login data and lets you send automated follow-up messages to guests — connect it to your router in 10 minutes.' },
  { product: 'EPOS Now', text: 'EPOS Now can send automated low-stock alerts by email — set your par levels in Inventory > Stock alerts.' },
  { product: 'Nutritics', text: 'Nutritics can generate allergen info sheets and menus automatically once your recipes are set up — go to Print > Allergen report.' },
  { product: 'Fourth', text: 'Fourth’s labour scheduling can factor in your forecasted covers — link it to your reservation system for smarter rotas.' },
  { product: 'Zonal', text: 'Zonal’s kitchen display can colour-code orders by course — reducing the chance of mains going out before starters are cleared.' },
];

function renderTipOfTheDay() {
  const card = document.getElementById('tipCard');
  const tipText = document.getElementById('tipText');
  const tipProduct = document.getElementById('tipProduct');
  if (!card || !tipText) return;

  // Pick tip seeded by day so everyone sees the same one
  // If venue has a known stack, weight towards their products
  const dayIndex = Math.floor(Date.now() / 86400000); // days since epoch
  let candidates = ALL_TIPS;
  if (user && user.tech_stack) {
    const stackValues = Object.values(user.tech_stack).map(v => v.toLowerCase());
    const matching = ALL_TIPS.filter(t => stackValues.some(s => t.product.toLowerCase().includes(s)));
    if (matching.length >= 3) candidates = matching;
  }
  const tip = candidates[dayIndex % candidates.length];
  window._currentTip = tip;
  tipText.textContent = tip.text;
  tipProduct.textContent = tip.product;
  card.style.display = 'block';
}

// ─── NPS ──────────────────────────────────────────────────────────────────
var _npsScore = null;
var _npsVendor = null;

function showNPS(vendor) {
  _npsVendor = vendor;
  var msgs = document.getElementById('messages');
  var wrap = document.createElement('div'); wrap.className = 'nps-wrap';
  var label = vendor.charAt(0).toUpperCase() + vendor.slice(1);
  var btns = [0,1,2,3,4,5,6,7,8,9,10].map(function(n) {
    return '<button class="nps-btn" onclick="npsSelect(' + n + ')">' + n + '</button>';
  }).join('');
  wrap.innerHTML = '<div class="nps-card">' +
    '<div class="nps-q">How likely are you to recommend <strong>' + label + '</strong> to another hospitality operator?</div>' +
    '<div class="nps-labels"><span class="nps-label">Not at all</span><span class="nps-label">Extremely likely</span></div>' +
    '<div class="nps-row" id="npsRow">' + btns + '</div>' +
    '<div class="nps-comment" id="npsComment">' +
    '<input class="nps-input" id="npsInput" placeholder="What is the main reason? (optional)">' +
    '<button class="nps-send" onclick="npsSubmit()">Send</button>' +
    '</div>' +
    '<div class="nps-done" id="npsDone">&#10003; Thanks &#8212; your rating has been saved</div>' +
    '</div>';
  msgs.appendChild(wrap);
  msgs.scrollTop = msgs.scrollHeight;
}

function npsSelect(score) {
  _npsScore = score;
  document.querySelectorAll('.nps-btn').forEach(function(b, i) { b.classList.toggle('selected', i === score); });
  var comment = document.getElementById('npsComment');
  if (comment) comment.classList.add('show');
  var inp = document.getElementById('npsInput'); if (inp) setTimeout(function(){ inp.focus(); }, 50);
}

async function npsSubmit() {
  if (_npsScore === null) return;
  var comment = (document.getElementById('npsInput') ? document.getElementById('npsInput').value : '').trim();
  try {
    await fetch(SERVER_URL + '/save-nps', {
      method: 'POST', headers: {'Content-Type':'application/json'},
      body: JSON.stringify({ vendor: _npsVendor, score: _npsScore, comment: comment || null, venue_id: user ? user.venue_id : null, venue: user ? user.venue : null, respondent: user ? user.name : null })
    });
  } catch(e) {}
  var cel = document.getElementById('npsComment'); if (cel) cel.style.display = 'none';
  var done = document.getElementById('npsDone'); if (done) done.classList.add('show');
}

function fireTip() {
  if (!window._currentTip) return;
  hideWelcome();
  quickSend(window._currentTip.text + ' Can you tell me more about this?');
}

// ─── SHIFT CHECK ──────────────────────────────────────────────────────────
const SC_STEPS = [
  { id: 'epos',     emoji: '💻', label: 'EPOS / till system' },
  { id: 'payments', emoji: '💳', label: 'Card / payment terminal' },
  { id: 'wifi',     emoji: '📶', label: 'WiFi / internet' },
  { id: 'printer',  emoji: '🖨️', label: 'Kitchen printer' },
  { id: 'bookings', emoji: '📅', label: 'Booking / reservation system' },
];

let scAnswers = {};
let scCurrentStep = 0;
let scMode = 'steps'; // 'steps' | 'summary'

function openShiftCheck() {
  scAnswers = {};
  scCurrentStep = 0;
  scMode = 'steps';
  document.getElementById('scOverlay').classList.add('open');
  document.getElementById('scDrawer').classList.add('open');
  renderScStep();
}

function closeShiftCheck() {
  document.getElementById('scOverlay').classList.remove('open');
  document.getElementById('scDrawer').classList.remove('open');
}

function renderScStep() {
  const body = document.getElementById('scBody');
  const title = document.getElementById('scDrawerTitle');
  const total = SC_STEPS.length;

  if (scMode === 'summary') {
    renderScSummary();
    return;
  }

  const step = SC_STEPS[scCurrentStep];
  const pct = Math.round((scCurrentStep / total) * 100);

  title.textContent = 'Shift check (' + (scCurrentStep + 1) + ' of ' + total + ')';

  body.innerHTML =
    '<div class="sc-progress"><div class="sc-progress-fill" style="width:' + pct + '%"></div></div>' +
    '<div class="sc-step">' +
    '<div class="sc-step-label"><span class="sc-emoji">' + step.emoji + '</span>' + step.label + '</div>' +
    '<div class="sc-options">' +
    '<button class="sc-opt" data-val="green" data-action="scAnswer">✅ All good</button>' +
    '<button class="sc-opt" data-val="amber" data-action="scAnswer">⚠️ Slow / issue</button>' +
    '<button class="sc-opt" data-val="red" data-action="scAnswer">🔴 Down</button>' +
    '</div></div>';

  // Highlight previously selected if user goes back (not implemented but defensive)
  const prev = scAnswers[step.id];
  if (prev) {
    body.querySelectorAll('.sc-opt').forEach(btn => {
      if (btn.dataset.val === prev) btn.classList.add('selected-' + prev);
    });
  }
}

function scAnswer(val) {
  const step = SC_STEPS[scCurrentStep];
  scAnswers[step.id] = val;

  // Highlight selection briefly then advance
  const btns = document.querySelectorAll('.sc-opt');
  btns.forEach(b => { if (b.dataset.val === val) b.classList.add('selected-' + val); });

  setTimeout(() => {
    scCurrentStep++;
    if (scCurrentStep >= SC_STEPS.length) {
      scMode = 'summary';
    }
    renderScStep();
  }, 280);
}

// ─── GLOBAL EVENT DELEGATION ──────────────────────────────────────────────
document.addEventListener('click', function(e) {
  const btn = e.target.closest('[data-action]');
  if (!btn) return;
  const action = btn.dataset.action;
  const msg = btn.dataset.msg ? btn.dataset.msg.replace(/&quot;/g, '"') : null;
  if (action === 'scAnswer') scAnswer(btn.dataset.val);
  if (action === 'predictSend' || action === 'quickSend') { hideWelcome(); quickSend(msg); }
  if (action === 'setRole') setMemberRole(btn.dataset.email, btn.dataset.role);
  if (action === 'kbRemove') kbRemove(btn.dataset.file);
  if (action === 'kbAddClick') { closeAdmin(); const f = document.getElementById('kbFile'); if (f) f.click(); }
  if (action === 'vidAddClick') { closeAdmin(); const vf = document.getElementById('vidFile'); if (vf) vf.click(); }
  if (action === 'vidLinkClick') { closeAdmin(); openVideoLink(); }
  if (action === 'imgAddClick') { closeAdmin(); openImgAdd(); }
  if (action === 'openTeamFromAdmin') { closeAdmin(); openTeam(); }
});

function renderScSummary() {
  const title = document.getElementById('scDrawerTitle');
  title.textContent = 'Shift check complete';

  const issues = SC_STEPS.filter(s => scAnswers[s.id] === 'red');
  const warnings = SC_STEPS.filter(s => scAnswers[s.id] === 'amber');
  const allGood = issues.length === 0 && warnings.length === 0;

  let icon, headline, sub;
  if (allGood) {
    icon = '🟢';
    headline = 'All systems go';
    sub = 'Everything is looking good. Have a great service!';
  } else if (issues.length > 0) {
    icon = '🔴';
    headline = issues.length + ' system' + (issues.length > 1 ? 's' : '') + ' need' + (issues.length === 1 ? 's' : '') + ' attention';
    sub = 'Get these sorted before service starts.';
  } else {
    icon = '⚠️';
    headline = warnings.length + ' thing' + (warnings.length > 1 ? 's' : '') + ' to keep an eye on';
    sub = 'Not critical, but worth monitoring during service.';
  }

  let issueHTML = '';
  issues.forEach(s => { issueHTML += '<div class="sc-issue-item"><span>' + s.emoji + '</span> ' + s.label + ' is down</div>'; });
  warnings.forEach(s => { issueHTML += '<div class="sc-issue-item amber"><span>' + s.emoji + '</span> ' + s.label + ' has an issue</div>'; });

  const hasProblems = issues.length > 0 || warnings.length > 0;

  const body = document.getElementById('scBody');
  body.innerHTML =
    '<div class="sc-summary">' +
    '<div class="sc-summary-icon">' + icon + '</div>' +
    '<div class="sc-summary-title">' + headline + '</div>' +
    '<div class="sc-summary-sub">' + sub + '</div>' +
    '</div>' +
    (hasProblems ? '<div class="sc-issues-list">' + issueHTML + '</div>' : '') +
    (hasProblems
      ? '<button class="sc-fix-btn" onclick="scGetHelp()">Get help with these issues &rarr;</button>'
      : '') +
    '<button class="sc-done-btn" onclick="scFinish()">' + (allGood ? 'Great, start service' : 'Dismiss') + '</button>';

  // Save to Supabase
  saveHealthCheck();
}

async function saveHealthCheck() {
  if (!user) return;
  try {
    const payload = {
      venue: user.venue,
      venue_id: user.venue_id || null,
      name: user.name,
      email: user.email,
      answers: scAnswers,
      has_issues: SC_STEPS.some(s => scAnswers[s.id] === 'red' || scAnswers[s.id] === 'amber'),
      checked_at: new Date().toISOString()
    };
    await fetch(SERVER_URL + '/health-check', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
  } catch(e) { /* fail silently */ }
}

function scGetHelp() {
  closeShiftCheck();
  const issues = SC_STEPS.filter(s => scAnswers[s.id] === 'red' || scAnswers[s.id] === 'amber');
  const issueNames = issues.map(s => s.label.toLowerCase()).join(' and ');
  hideWelcome();
  quickSend('I just did my shift check and I have issues with my ' + issueNames + '. Can you help me troubleshoot?');
}

function scFinish() {
  closeShiftCheck();
  markShiftCheckDone();
  const btn = document.getElementById('shiftCheckBtn');
  if (btn) {
    btn.innerHTML = '✅ Shift check done';
    btn.style.borderColor = '#16a34a';
    btn.style.color = '#166534';
    btn.onclick = null;
    btn.style.cursor = 'default';
  }
}

let recognition = null;
let isListening = false;
const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent) && !window.MSStream;

function toggleMic() {
  const mic = document.getElementById('mic');
  const input = document.getElementById('input');
  if (isIOS) { input.focus(); showToast('Tap the 🎤 mic on your keyboard to speak'); return; }
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SR) { input.focus(); showToast('Tap the 🎤 mic on your keyboard to speak'); return; }
  if (isListening) { recognition?.stop(); return; }
  recognition = new SR();
  recognition.lang = 'en-GB'; recognition.interimResults = false; recognition.maxAlternatives = 1;
  recognition.onstart = () => { isListening = true; mic.classList.add('listening'); };
  recognition.onresult = (e) => { input.value = e.results[0][0].transcript; autoResize(input); };
  recognition.onend = () => { isListening = false; mic.classList.remove('listening'); };
  recognition.onerror = () => { isListening = false; mic.classList.remove('listening'); showToast('Could not hear anything — try again'); };
  recognition.start();
}

// ── Attach a photo for the bot to read (vision) ──────────────────────────
let pendingImage = null; // { dataUrl, data, media_type, name }
function handleChatImage(files) {
  const f = files && files[0]; if (!f) return;
  if (!f.type || f.type.indexOf('image/') !== 0) { showToast('Please choose an image file'); return; }
  const reader = new FileReader();
  reader.onload = function(e) {
    const img = new Image();
    img.onload = function() {
      const MAX = 1024;
      let w = img.width, h = img.height;
      if (w > MAX || h > MAX) { if (w >= h) { h = Math.round(h * MAX / w); w = MAX; } else { w = Math.round(w * MAX / h); h = MAX; } }
      const cv = document.createElement('canvas'); cv.width = w; cv.height = h;
      cv.getContext('2d').drawImage(img, 0, 0, w, h);
      const dataUrl = cv.toDataURL('image/jpeg', 0.8);
      pendingImage = { dataUrl: dataUrl, data: dataUrl.split(',')[1], media_type: 'image/jpeg', name: f.name || 'photo' };
      showAttachPreview();
    };
    img.onerror = function() { showToast('Could not read that image'); };
    img.src = e.target.result;
  };
  reader.onerror = function() { showToast('Could not read that file'); };
  reader.readAsDataURL(f);
  document.getElementById('chatImgFile').value = '';
}
function showAttachPreview() {
  const el = document.getElementById('attachPreview');
  const btn = document.getElementById('attachBtn');
  if (!el) return;
  if (!pendingImage) { el.style.display = 'none'; el.innerHTML = ''; if (btn) btn.classList.remove('has'); return; }
  el.style.display = 'flex';
  el.innerHTML = '<div class="attach-chip"><img src="' + pendingImage.dataUrl + '" alt=""><span class="ac-name">' + teamEsc(pendingImage.name) + '</span><button class="ac-x" onclick="clearAttach()" title="Remove">✕</button></div>';
  if (btn) btn.classList.add('has');
}
function clearAttach() { pendingImage = null; showAttachPreview(); }

async function sendMessage() {
  const input = document.getElementById('input');
  const text = input.value.trim();
  const img = pendingImage;
  if (!text && !img) return;
  hideWelcome();
  input.value = ''; input.style.height = 'auto';
  document.getElementById('send').disabled = true;
  addMessage('user', text, false, null, null, img ? img.dataUrl : null);
  messages.push({ role: 'user', content: text || '📷 (image)' });
  clearAttach();
  const typing = addTyping();
  try {
    const res = await fetch(SERVER_URL + '/chat', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: text, history: messages.slice(-10), venue: user?.venue, venue_id: user?.venue_id, userName: user?.name, image: img ? { data: img.data, media_type: img.media_type } : null })
    });
    const data = await res.json();
    const reply = data.response || "Sorry, I couldn't get a response. Please try again.";
    const supportUrl = data.supportUrl || null;
    lastBotMsg = reply;
    typing.remove();
    let videoData = null, displayReply = reply;
    const vtagStart = reply.indexOf('[STACKEDVIDEO:');
    if (vtagStart > -1) {
      const vtagEnd = reply.lastIndexOf(']'); // use lastIndexOf — titles may contain ] characters
      if (vtagEnd > vtagStart) { try { videoData = JSON.parse(reply.substring(vtagStart + 14, vtagEnd)); } catch(e) {} displayReply = reply.substring(0, vtagStart).trim(); }
    }
    addMessage('assistant', displayReply, true, videoData, supportUrl);
    if (data.images && data.images.length) renderDishImages(data.images);
    if (data.docFile && data.docFile.url) renderDocFile(data.docFile);
    if (data.detectedVendor && !npsShown && (data.forceNPS || messages.filter(m=>m.role==='user').length >= 2)) {
      npsShown = true;
      setTimeout(() => showNPS(data.detectedVendor), 1200);
    }
    messages.push({ role: 'assistant', content: displayReply });
    await saveConversation();
  } catch(e) {
    typing.remove();
    const errMsg = "I'm having trouble connecting right now. Please try again in a moment.";
    addMessage('assistant', errMsg, true);
    messages.push({ role: 'assistant', content: errMsg });
  }
  document.getElementById('send').disabled = false;
  input.focus();
}

function hideWelcome() { stopCarousel(); const w = document.getElementById('welcome'); if (w) w.remove(); }

function addMessage(role, content, showTicket, video, supportUrl, userImg) {
  const msgs = document.getElementById('messages');
  const wrap = document.createElement('div'); wrap.className = 'msg ' + role;
  const avatar = document.createElement('div'); avatar.className = 'msg-avatar';
  if (role === 'assistant') { const img = document.createElement('img'); img.src = ICON_URL; img.alt = 'S'; avatar.appendChild(img); }
  else { avatar.textContent = (user?.name || 'You')[0].toUpperCase(); avatar.style.background = 'var(--orange)'; avatar.style.color = '#fff'; }
  const bubble = document.createElement('div'); bubble.className = 'msg-bubble';
  if (role === 'assistant') {
    var t = content;
    t = t.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
    t = t.replace(/[*][*]([^*]+)[*][*]/g, "<strong>$1</strong>");
    t = t.replace(new RegExp("https?://\\S+", "g"), function(url) {
      url = url.replace(/[.,;:!?)]+$/, "");
      return "<a href=" + url + " target=_blank rel=noopener class=link-pill style=margin:0>" + url + "</a>";
    });
    bubble.innerHTML = t;
  } else {
    if (content) bubble.textContent = content;
    if (userImg) { const im = document.createElement('img'); im.className = 'msg-img'; im.src = userImg; im.alt = 'attached image'; bubble.appendChild(im); }
  }
  wrap.appendChild(avatar); wrap.appendChild(bubble); msgs.appendChild(wrap);
  if (role === 'assistant' && supportUrl) {
    const pillMap = {
      'squareup.com':'📦 Square support','sumup.com':'💳 SumUp support','zettle.com':'💳 Zettle support',
      'worldpay.com':'💳 Worldpay support','stripe.com':'💳 Stripe support','dojo.tech':'💳 Dojo support',
      'adyen.com':'💳 Adyen support','elavon.co.uk':'💳 Elavon support','paymentsense.com':'💳 PaymentSense support',
      'tyl.co.uk':'💳 Tyl support','barclaycard.co.uk':'💳 Barclaycard support','pleo.io':'💳 Pleo support',
      'lightspeedhq.com':'🖥 Lightspeed support','tevalis.com':'🖥 Tevalis support','eposnow.com':'🖥 EPOS Now support',
      'vitamojo.com':'🍽 Vita Mojo support','zonal.co.uk':'🖥 Zonal support','icrtouch.com':'🖥 ICRTouch support',
      'toasttab.com':'🖥 Toast support','tabology.com':'🖥 Tabology support','storekit.com':'🖥 Storekit support',
      'getpepper.io':'🖥 Pepper support','partech.com':'🖥 Par Brink support','revelsystems.com':'🖥 Revel support',
      'opentable.com':'📅 OpenTable support','resdiary.com':'📅 ResDiary support','sevenrooms.com':'📅 SevenRooms support',
      'designmynight.com':'📅 Collins support','resy.com':'📅 Resy support','quandoo.com':'📅 Quandoo support',
      'exploretock.com':'📅 Tock support','eatapp.co':'📅 Eat App support','waitwhile.com':'📅 Waitwhile support',
      'fourth.com':'👥 Fourth support','deputy.com':'👥 Deputy support','getsona.com':'👥 Sona support',
      'rotaready.com':'👥 Rotaready support','bizimply.com':'👥 Bizimply support','planday.com':'👥 Planday support',
      's4labour.co.uk':'👥 S4Labour support','hotschedules.com':'👥 HotSchedules support','workforce.com':'👥 Workforce.com support',
      'harri.com':'👥 Harri support','nory.ai':'👥 Nory support','humanforce.com':'👥 Humanforce support',
      'deliverect.com':'📦 Deliverect support','flipdish.com':'📦 Flipdish support','slerp.com':'📦 Slerp support',
      'orderswift.com':'📦 Orderswift support','yoello.com':'📦 Yoello support','tryotter.com':'📦 Otter support',
      'airship.com':'🎯 Airship support','stampede.ai':'🎯 Stampede support','yumpingo.com':'🎯 Yumpingo support',
      'eagleeye.com':'🎯 Eagle Eye support','klaviyo.com':'🎯 Klaviyo support',
      'apicbase.com':'📋 Apicbase support','nutritics.com':'📋 Nutritics support','crunchtime.com':'📋 Crunchtime support',
      'marketman.com':'📋 Marketman support','kitchencut.com':'📋 Kitchen CUT support','winnowsolutions.com':'📋 Winnow support',
      'mews.com':'🏨 Mews support','cloudbeds.com':'🏨 Cloudbeds support','guestline.net':'🏨 Guestline support',
      'clock-software.com':'🏨 Clock PMS support','oracle.com':'🏨 Opera support',
      'tenzo.io':'📊 Tenzo support','otainsight.com':'📊 OTA Insight support',
      'purple.ai':'📶 Purple Wi-Fi support','meraki.com':'📶 Cisco Meraki support',
      'revinate.com':'💬 Revinate support','guestrevu.com':'💬 GuestRevu support',
      'hibob.com':'👤 HiBob support','personio.de':'👤 Personio support','bamboohr.com':'👤 BambooHR support',
      'typsy.com':'🎓 Typsy support','beekeeper.io':'🎓 Beekeeper support',
    };
    var pillLabel = (function(u) {
      try { var h = new URL(u).hostname.replace('www.',''); var ks = Object.keys(pillMap); for (var k=0;k<ks.length;k++){if(h.includes(ks[k]))return pillMap[ks[k]];} return h; } catch(e){return u;}
    })(supportUrl);
    const lr = document.createElement('div'); lr.className = 'link-row';
    const a = document.createElement('a');
    a.className = 'link-pill'; a.href = supportUrl; a.target = '_blank'; a.rel = 'noopener';
    a.textContent = '↗ ' + pillLabel;
    lr.appendChild(a); msgs.appendChild(lr);
  }
  if (role === 'assistant' && video) {
    const pr = document.createElement('div'); pr.className = 'video-pill-row';
    const pb = document.createElement('button'); pb.className = 'video-pill';
    pb.textContent = '🎬 We have a video on this \— tap to watch';
    pb.dataset.v = encodeURIComponent(JSON.stringify(video));
    pb.onclick = function() { openCvModal(this.dataset.v); };
    pr.appendChild(pb); msgs.appendChild(pr);
  }
  msgs.scrollTop = msgs.scrollHeight;
  return wrap;
}

function addTyping() {
  const msgs = document.getElementById('messages');
  const wrap = document.createElement('div'); wrap.className = 'typing-bubble';
  const avatar = document.createElement('div'); avatar.className = 'msg-avatar';
  const img = document.createElement('img'); img.src = ICON_URL; avatar.appendChild(img);
  const dots = document.createElement('div'); dots.className = 'dots';
  dots.innerHTML = '<div class="dot-anim"></div><div class="dot-anim"></div><div class="dot-anim"></div>';
  wrap.appendChild(avatar); wrap.appendChild(dots); msgs.appendChild(wrap);
  msgs.scrollTop = msgs.scrollHeight;
  return wrap;
}

async function saveConversation() {
  if (!user || messages.length === 0) return;
  try {
    const payload = conversationId
      ? { id: conversationId, messages }
      : { email: user.email, name: user.name, venue: user.venue, venue_id: user.venue_id || null, messages, updated_at: new Date().toISOString() };
    const r = await fetch(SERVER_URL + '/save-conversation', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload)
    });
    const data = await r.json();
    if (data.id && !conversationId) conversationId = data.id;
  } catch(e) {}
}

async function loadHistory() {
  if (!user) return;
  try {
    // If we have a venue_id, load shared venue history; otherwise personal history
    let filter;
    if (user.venue_id) {
      filter = 'venue_id=eq.' + user.venue_id + '&limit=20';
    } else {
      filter = 'email=eq.' + encodeURIComponent(user.email) + '&limit=20';
    }
    const rows = await supabaseSelect('conversations', filter);
    const body = document.getElementById('histBody');
    if (!rows || rows.length === 0) { body.innerHTML = '<div class="empty-history">No previous chats yet.</div>'; return; }
    body.innerHTML = '';
    rows.forEach(row => {
      const d = new Date(row.updated_at || row.created_at);
      const dateStr = d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
      const count = (row.messages || []).filter(m => m.role === 'user').length;
      const item = document.createElement('div'); item.className = 'history-item';
      const author = (row.name && row.name !== user.name) ? ' \· ' + row.name : '';
      item.innerHTML =
        '<div class="history-date">' + dateStr + author + '</div>' +
        '<div class="history-preview">' + escHtml(row.preview || 'Chat session') + '</div>' +
        '<div class="history-count">' + count + ' message' + (count !== 1 ? 's' : '') + '</div>';
      item.onclick = () => loadConversation(row);
      body.appendChild(item);
    });
  } catch(e) {}
}

function loadConversation(row) {
  closeHistory();
  const msgs = document.getElementById('messages');
  msgs.innerHTML = '';
  conversationId = row.id;
  messages = row.messages || [];
  messages.forEach((m, i) => { const isLast = i === messages.length - 1; addMessage(m.role, m.content, m.role === 'assistant' && isLast); });
}

function openHistory() { loadHistory(); document.getElementById('histOverlay').classList.add('open'); document.getElementById('histDrawer').classList.add('open'); }
function closeHistory() { document.getElementById('histOverlay').classList.remove('open'); document.getElementById('histDrawer').classList.remove('open'); }
function openTopics() { document.getElementById('topicOverlay').classList.add('open'); document.getElementById('topicDrawer').classList.add('open'); }
function closeTopics() { document.getElementById('topicOverlay').classList.remove('open'); document.getElementById('topicDrawer').classList.remove('open'); }

// ─── TEAM (admin manage-team) ─────────────────────────────────────────────
function teamEsc(s) { return String(s == null ? '' : s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); }
function openTeam() { loadTeam(); document.getElementById('teamOverlay').classList.add('open'); document.getElementById('teamDrawer').classList.add('open'); }
function closeTeam() { document.getElementById('teamOverlay').classList.remove('open'); document.getElementById('teamDrawer').classList.remove('open'); }
async function loadTeam() {
  const body = document.getElementById('teamBody');
  if (!body) return;
  if (!user || !user.venue_id) { body.innerHTML = '<div class="empty-history">No team to manage yet.</div>'; return; }
  body.innerHTML = '<div class="empty-history">Loading&hellip;</div>';
  try {
    const r = await fetch(SERVER_URL + '/team-list', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ venue_id: user.venue_id }) });
    const data = await r.json();
    const members = (data && data.members) || [];
    if (!members.length) { body.innerHTML = '<div class="empty-history">No team members yet.</div>'; return; }
    const isAdmin = user.role === 'admin';
    const note = isAdmin
      ? '<div class="team-note">Admins can add knowledge and manage the team. Promote a teammate to admin below.</div>'
      : '<div class="team-note">Only admins can manage the team or add knowledge.</div>';
    const rows = members.map(function(m) {
      const me = (m.email || '').toLowerCase() === (user.email || '').toLowerCase();
      const initial = ((m.name || m.email || '?').trim()[0] || '?').toUpperCase();
      const roleLabel = m.role === 'admin' ? 'ADMIN' : 'STAFF';
      let action = '';
      if (me) {
        action = '<span class="team-you">You</span>';
      } else if (isAdmin) {
        action = m.role === 'admin'
          ? '<button class="team-action" data-action="setRole" data-email="' + teamEsc(m.email) + '" data-role="staff">Make staff</button>'
          : '<button class="team-action" data-action="setRole" data-email="' + teamEsc(m.email) + '" data-role="admin">Make admin</button>';
      }
      return '<div class="team-item"><div class="team-av">' + teamEsc(initial) + '</div>' +
        '<div class="team-meta"><div class="team-name">' + teamEsc(m.name || '\\u2014') + '</div>' +
        '<div class="team-email">' + teamEsc(m.email || '') + '</div></div>' +
        '<span class="team-role ' + (m.role === 'admin' ? 'admin' : 'staff') + '">' + roleLabel + '</span>' + action + '</div>';
    }).join('');
    body.innerHTML = note + rows;
  } catch(e) { body.innerHTML = '<div class="empty-history">Couldn\\'t load team.</div>'; }
}
async function setMemberRole(email, role) {
  if (!user || !user.venue_id) return;
  try {
    const r = await fetch(SERVER_URL + '/set-role', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ venue_id: user.venue_id, target_email: email, role: role, token: getAuthToken() }) });
    const data = await r.json();
    if (!data || !data.ok) { showToast((data && data.error) || 'Could not update role'); return; }
    showToast('Role updated', 'green');
    loadTeam();
  } catch(e) { showToast('Could not update role'); }
}

// ─── SIGN OUT ─────────────────────────────────────────────────────────────
function signOut() {
  if (!confirm('Sign out of Stacked Chat?')) return;
  localStorage.removeItem('stacked_user');
  localStorage.removeItem('stacked_auth');
  location.reload();
}

// ─── ADMIN EMAIL VERIFICATION (real login for admin powers) ───────────────
let _pendingAdminAction = null;
function getAuthToken() {
  try {
    const a = JSON.parse(localStorage.getItem('stacked_auth') || 'null');
    if (a && a.token && a.email && user && a.email.toLowerCase() === (user.email || '').toLowerCase() && (Date.now() - (a.ts || 0) < 12 * 60 * 60 * 1000)) return a.token;
  } catch(e) {}
  return null;
}
function requireAdminVerify(fn) {
  if (getAuthToken()) { fn(); return; }
  _pendingAdminAction = fn;
  openVerify();
}
function openVerify() {
  if (!user) return;
  document.getElementById('verifyEmail').textContent = user.email || 'your email';
  document.getElementById('verifyStep1').style.display = 'block';
  document.getElementById('verifyStep2').style.display = 'none';
  document.getElementById('verifyCodeInput').value = '';
  const b = document.getElementById('verifySendBtn'); if (b) { b.disabled = false; b.textContent = 'Send code'; }
  document.getElementById('verifyOverlay').classList.add('open');
}
function closeVerify() { document.getElementById('verifyOverlay').classList.remove('open'); }
async function sendAuthCode() {
  if (!user || !user.email) return;
  const btn = document.getElementById('verifySendBtn');
  if (btn) { btn.disabled = true; btn.textContent = 'Sending\\u2026'; }
  try {
    const r = await fetch(SUPABASE_URL + '/auth/v1/otp', { method:'POST', headers:{'Content-Type':'application/json','apikey':SUPABASE_KEY}, body: JSON.stringify({ email: user.email, create_user: true }) });
    if (!r.ok) { const e = await r.json().catch(function(){return {};}); showToast(e.msg || 'Could not send code'); if (btn) { btn.disabled = false; btn.textContent = 'Send code'; } return; }
    document.getElementById('verifyStep1').style.display = 'none';
    document.getElementById('verifyStep2').style.display = 'block';
    document.getElementById('verifyCodeInput').focus();
  } catch(e) { showToast('Could not send code'); if (btn) { btn.disabled = false; btn.textContent = 'Send code'; } }
}
async function verifyAuthCode() {
  const code = (document.getElementById('verifyCodeInput').value || '').trim();
  if (code.length < 6) { showToast('Enter the code we emailed you'); return; }
  // New users verify with type 'signup', existing users with 'email' — try both.
  let auth = null;
  for (const t of ['email', 'signup', 'magiclink']) {
    try {
      const r = await fetch(SUPABASE_URL + '/auth/v1/verify', { method:'POST', headers:{'Content-Type':'application/json','apikey':SUPABASE_KEY}, body: JSON.stringify({ email: user.email, token: code, type: t }) });
      const d = await r.json();
      if (r.ok && d && d.access_token) { auth = d; break; }
    } catch(e) {}
  }
  if (!auth) { showToast('That code didn\\'t work \\u2014 try again'); return; }
  localStorage.setItem('stacked_auth', JSON.stringify({ email: user.email, token: auth.access_token, ts: Date.now() }));
  closeVerify();
  showToast('Verified \\u2713', 'green');
  const fn = _pendingAdminAction; _pendingAdminAction = null; if (fn) fn();
}

// ─── ADD KNOWLEDGE ("+", admins only) ─────────────────────────────────────
async function extractPdf(file) {
  if (typeof pdfjsLib === 'undefined') throw new Error('PDF reader not loaded');
  try { pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js'; } catch(e) {}
  const buf = await file.arrayBuffer();
  const pdf = await pdfjsLib.getDocument({ data: buf }).promise;
  let out = '';
  for (let p = 1; p <= pdf.numPages; p++) {
    const page = await pdf.getPage(p);
    const tc = await page.getTextContent();
    out += tc.items.map(function(it){ return it.str; }).join(' ') + '\\n';
  }
  return out;
}
async function extractDocx(file) {
  if (typeof mammoth === 'undefined') throw new Error('Doc reader not loaded');
  const buf = await file.arrayBuffer();
  const res = await mammoth.extractRawText({ arrayBuffer: buf });
  return res.value || '';
}
async function extractImage(file) {
  if (typeof Tesseract === 'undefined') throw new Error('Image reader not loaded');
  const out = await Tesseract.recognize(file, 'eng');
  return (out && out.data && out.data.text) ? out.data.text : '';
}
async function handleKbUpload(files) {
  if (!files || !files.length) return;
  if (!user || user.role !== 'admin') { showToast('Only admins can add knowledge'); return; }
  for (let i = 0; i < files.length; i++) {
    const file = files[i];
    const nm = file.name.toLowerCase();
    const isImage = /\\.(png|jpe?g|webp|gif|bmp)$/i.test(nm);
    try {
      showToast('Reading ' + file.name + '\\u2026');
      let text = '';
      if (nm.endsWith('.pdf')) text = await extractPdf(file);
      else if (nm.endsWith('.docx') || nm.endsWith('.doc')) text = await extractDocx(file);
      else if (isImage) { showToast('Reading text from ' + file.name + ' \\u2014 this can take a few seconds\\u2026'); try { text = await extractImage(file); } catch(e) { text = ''; } }
      else text = await file.text();
      text = (text || '').trim();

      // For images, store the actual picture so the bot can DISPLAY it on request
      // (not just answer from its OCR text). Reuses the menu-image library.
      let imageStored = false;
      if (isImage) {
        try {
          showToast('Saving image\\u2026');
          const safe = file.name.replace(/[^a-zA-Z0-9._-]/g, '_');
          const path = 'images/' + encodeURIComponent(user.venue_id) + '/' + Date.now() + '-' + safe;
          const up = await fetch(SUPABASE_URL + '/storage/v1/object/stacked-videos/' + path, { method:'POST', headers:{ 'apikey': SUPABASE_KEY, 'Authorization':'Bearer ' + SUPABASE_KEY, 'Content-Type': file.type || 'image/png', 'x-upsert':'true' }, body: file });
          if (up.ok) {
            const publicUrl = SUPABASE_URL + '/storage/v1/object/public/stacked-videos/' + path;
            const ir = await fetch(SERVER_URL + '/kb-image', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ url: publicUrl, title: file.name, description: text.slice(0, 300), venue_id: user.venue_id, token: getAuthToken() }) });
            const id = await ir.json();
            imageStored = !!(id && id.ok);
          }
        } catch(e) {}
      }

      // Keep the ORIGINAL file too, so the bot can hand over a shareable
      // download link (e.g. forward a PDF to your boss) — not just the text.
      let fileUrl = null;
      try {
        const safeD = file.name.replace(/[^a-zA-Z0-9._-]/g, '_');
        const dpath = 'docs/' + encodeURIComponent(user.venue_id) + '/' + Date.now() + '-' + safeD;
        const dup = await fetch(SUPABASE_URL + '/storage/v1/object/stacked-videos/' + dpath, { method:'POST', headers:{ 'apikey': SUPABASE_KEY, 'Authorization':'Bearer ' + SUPABASE_KEY, 'Content-Type': file.type || 'application/octet-stream', 'x-upsert':'true' }, body: file });
        if (dup.ok) fileUrl = SUPABASE_URL + '/storage/v1/object/public/stacked-videos/' + dpath;
      } catch(e) {}

      // Store the extracted text as a knowledge doc when there is enough to be useful.
      let docStored = false;
      if (text && text.length >= 10) {
        const r = await fetch(SERVER_URL + '/kb-upload', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ filename: file.name, content: text, venue_id: user.venue_id, token: getAuthToken(), file_url: fileUrl }) });
        const data = await r.json();
        docStored = !!(data && data.ok);
      }

      if (imageStored || docStored) {
        hideWelcome();
        let msg;
        if (isImage && imageStored && docStored) msg = '\\u2705 Added **' + file.name + '** \\u2014 I can answer from it and show it when you ask.';
        else if (isImage && imageStored) msg = '\\u2705 Added **' + file.name + '** \\u2014 ask to see it any time.';
        else msg = '\\u2705 Added **' + file.name + '** to your knowledge base. I can answer questions from it now.';
        addMessage('assistant', msg, false);
        messages.push({ role:'assistant', content:'Added ' + file.name + '.' });
      } else {
        showToast('Could not add ' + file.name + ' \\u2014 nothing readable and image could not be saved');
      }
    } catch(e) { showToast('Could not add ' + file.name); }
  }
  const f = document.getElementById('kbFile'); if (f) f.value = '';
}
async function handleVideoUpload(files) {
  if (!files || !files.length) return;
  if (!user || user.role !== 'admin') { showToast('Only admins can add videos'); return; }
  for (let i = 0; i < files.length; i++) {
    const file = files[i];
    if (!file.type || file.type.indexOf('video') !== 0) { showToast('Not a video: ' + file.name); continue; }
    if (file.size > 50 * 1024 * 1024) { showToast(file.name + ' is over 50MB \\u2014 too large'); continue; }
    try {
      showToast('Uploading ' + file.name + '\\u2026');
      const safe = file.name.replace(/[^a-zA-Z0-9._-]/g, '_');
      const path = encodeURIComponent(user.venue_id) + '/' + Date.now() + '-' + safe;
      const up = await fetch(SUPABASE_URL + '/storage/v1/object/stacked-videos/' + path, {
        method: 'POST',
        headers: { 'apikey': SUPABASE_KEY, 'Authorization': 'Bearer ' + SUPABASE_KEY, 'Content-Type': file.type || 'video/mp4', 'x-upsert': 'true' },
        body: file
      });
      if (!up.ok) { showToast('Video storage not set up yet'); continue; }
      const publicUrl = SUPABASE_URL + '/storage/v1/object/public/stacked-videos/' + path;
      const r = await fetch(SERVER_URL + '/kb-video', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ url: publicUrl, title: file.name.replace(/\\.[^.]+$/, ''), venue_id: user.venue_id, token: getAuthToken() }) });
      const data = await r.json();
      if (data && data.ok) {
        hideWelcome();
        addMessage('assistant', '\\u2705 Added video **' + file.name + '** to your knowledge base.', false);
      } else { showToast((data && data.error) || ('Could not add ' + file.name)); }
    } catch(e) { showToast('Could not upload ' + file.name); }
  }
  const vf = document.getElementById('vidFile'); if (vf) vf.value = '';
}
function openVideoLink() {
  document.getElementById('vidLinkUrl').value = '';
  document.getElementById('vidLinkTitle').value = '';
  document.getElementById('vidLinkOverlay').classList.add('open');
}
function closeVideoLink() { document.getElementById('vidLinkOverlay').classList.remove('open'); }
async function handleVideoLink() {
  const link = (document.getElementById('vidLinkUrl').value || '').trim();
  const title = (document.getElementById('vidLinkTitle').value || '').trim();
  if (!/^https?:\\/\\//i.test(link)) { showToast('Paste a valid video URL'); return; }
  try {
    const r = await fetch(SERVER_URL + '/kb-video', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ url: link, title: title || 'Video', venue_id: user.venue_id, token: getAuthToken() }) });
    const d = await r.json();
    if (!d || !d.ok) { showToast((d && d.error) || 'Could not add video'); return; }
    closeVideoLink();
    showToast('Video added', 'green');
    hideWelcome();
    addMessage('assistant', '\\u2705 Added a video to your knowledge base.', false);
  } catch(e) { showToast('Could not add video'); }
}

// ─── DISH / MENU IMAGES (admin uploads named photos; bot shows them) ──────
function renderDishImages(imgs) {
  const msgs = document.getElementById('messages');
  if (!msgs) return;
  imgs.forEach(function(im) {
    const row = document.createElement('div');
    row.className = 'dish-img-row';
    row.innerHTML = '<div class="dish-img-card"><img src="' + teamEsc(im.url) + '" alt="' + teamEsc(im.title || '') + '" loading="lazy"><div class="dish-img-cap">' + teamEsc(im.title || '') + '</div></div>';
    msgs.appendChild(row);
  });
  msgs.scrollTop = msgs.scrollHeight;
}
function renderDocFile(doc) {
  const msgs = document.getElementById('messages');
  if (!msgs || !doc || !doc.url) return;
  const row = document.createElement('div');
  row.className = 'doc-file-row';
  const a = document.createElement('a');
  a.className = 'doc-file-pill';
  a.href = doc.url; a.target = '_blank'; a.rel = 'noopener'; a.setAttribute('download', '');
  a.innerHTML = '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6"/></svg><span>Open / share &mdash; ' + teamEsc(doc.filename || 'document') + '</span>';
  row.appendChild(a);
  msgs.appendChild(row);
  msgs.scrollTop = msgs.scrollHeight;
}
function openImgAdd() {
  document.getElementById('imgTitle').value = '';
  document.getElementById('imgDesc').value = '';
  const f = document.getElementById('imgFile'); if (f) f.value = '';
  document.getElementById('imgAddOverlay').classList.add('open');
}
function closeImgAdd() { document.getElementById('imgAddOverlay').classList.remove('open'); }
async function submitImage() {
  const title = (document.getElementById('imgTitle').value || '').trim();
  const desc = (document.getElementById('imgDesc').value || '').trim();
  const fileEl = document.getElementById('imgFile');
  const file = fileEl && fileEl.files && fileEl.files[0];
  if (!title) { showToast('Give the image a name'); return; }
  if (!file) { showToast('Choose a photo'); return; }
  if (file.size > 10 * 1024 * 1024) { showToast('Image is over 10MB \\u2014 too large'); return; }
  try {
    showToast('Uploading ' + file.name + '\\u2026');
    const safe = file.name.replace(/[^a-zA-Z0-9._-]/g, '_');
    const path = 'images/' + encodeURIComponent(user.venue_id) + '/' + Date.now() + '-' + safe;
    const up = await fetch(SUPABASE_URL + '/storage/v1/object/stacked-videos/' + path, { method:'POST', headers:{ 'apikey': SUPABASE_KEY, 'Authorization':'Bearer ' + SUPABASE_KEY, 'Content-Type': file.type || 'image/jpeg', 'x-upsert':'true' }, body: file });
    if (!up.ok) { showToast('Image storage not set up yet'); return; }
    const publicUrl = SUPABASE_URL + '/storage/v1/object/public/stacked-videos/' + path;
    const r = await fetch(SERVER_URL + '/kb-image', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ url: publicUrl, title: title, description: desc, venue_id: user.venue_id, token: getAuthToken() }) });
    const d = await r.json();
    if (!d || !d.ok) { showToast((d && d.error) || 'Could not add image'); return; }
    closeImgAdd();
    showToast('Image added', 'green');
    hideWelcome();
    addMessage('assistant', '\\u2705 Added **' + title + '** to your menu images \\u2014 ask to see it any time.', false);
  } catch(e) { showToast('Could not add image'); }
}

// ─── ADMIN PANEL (scoped analytics + knowledge, admins only) ──────────────
function openAdmin() { loadAdmin(); document.getElementById('adminOverlay').classList.add('open'); document.getElementById('adminDrawer').classList.add('open'); }
function closeAdmin() { document.getElementById('adminOverlay').classList.remove('open'); document.getElementById('adminDrawer').classList.remove('open'); }
async function loadAdmin() {
  const bodyEl = document.getElementById('adminBody');
  if (!bodyEl) return;
  if (!user || !user.venue_id) { bodyEl.innerHTML = '<div class="empty-history">No workspace yet.</div>'; return; }
  bodyEl.innerHTML = '<div class="empty-history">Loading&hellip;</div>';
  try {
    const r = await fetch(SERVER_URL + '/admin-summary', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ venue_id: user.venue_id, email: user.email }) });
    const d = await r.json();
    if (!d || !d.ok) { bodyEl.innerHTML = '<div class="empty-history">' + teamEsc((d && d.error) || 'Could not load admin') + '</div>'; return; }
    const s = d.stats || {};
    const card = function(n, l) { return '<div class="stat-card"><div class="stat-num">' + n + '</div><div class="stat-label">' + l + '</div></div>'; };
    let stats = '<div class="stat-grid">' +
      card(s.documents || 0, 'Documents') +
      card(s.questions || 0, 'Questions asked') +
      card(s.conversations || 0, 'Conversations') +
      card(s.team || 0, 'Team members') +
      (s.npsCount ? card((s.avgNps != null ? s.avgNps : '\\u2013') + '<span class="accent">/10</span>', 'Avg NPS (' + s.npsCount + ')') : '') +
      '</div>';
    const docs = d.docs || [];
    let kb = '<div class="admin-section-label">Knowledge</div>';
    if (!docs.length) {
      kb += '<div class="team-note">No documents yet. Add a handbook, SOP or policy with the button below.</div>';
    } else {
      kb += docs.map(function(doc) {
        const ext = ((doc.filename.split('.').pop()) || 'DOC').toUpperCase().slice(0, 4);
        return '<div class="kb-row"><div class="kb-icon">' + teamEsc(ext) + '</div><div class="kb-name">' + teamEsc(doc.filename) + '</div><span class="kb-chunks">' + (doc.chunks || 0) + '</span><button class="kb-del" data-action="kbRemove" data-file="' + teamEsc(doc.filename) + '" title="Remove">\\u2715</button></div>';
      }).join('');
    }
    const buttons = '<div class="admin-btn-row"><button class="admin-cta primary" data-action="kbAddClick">+ Add doc</button><button class="admin-cta primary" data-action="imgAddClick">+ Add image</button><button class="admin-cta primary" data-action="vidAddClick">+ Upload video</button><button class="admin-cta primary" data-action="vidLinkClick">+ Video link</button><button class="admin-cta ghost" data-action="openTeamFromAdmin">Manage team</button></div>';
    bodyEl.innerHTML = '<div class="admin-section-label">Overview</div>' + stats + kb + buttons;
  } catch(e) { bodyEl.innerHTML = '<div class="empty-history">Could not load admin.</div>'; }
}
async function kbRemove(filename) {
  if (!confirm('Remove \"' + filename + '\" from your knowledge base?')) return;
  try {
    const r = await fetch(SERVER_URL + '/kb-remove', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ venue_id: user.venue_id, filename: filename, token: getAuthToken() }) });
    const d = await r.json();
    if (!d || !d.ok) { showToast((d && d.error) || 'Could not remove'); return; }
    showToast('Removed', 'green');
    loadAdmin();
  } catch(e) { showToast('Could not remove'); }
}

function showToast(msg, type = '') {
  const t = document.getElementById('toast');
  t.textContent = msg; t.className = 'toast ' + type + ' show';
  setTimeout(() => { t.className = 'toast'; }, 3500);
}

function openCvModal(enc) {
  const v = JSON.parse(decodeURIComponent(enc));
  document.getElementById('cvModalTitle').textContent = v.title || 'Video';
  const body = document.getElementById('cvModalBody');
  while(body.firstChild) body.removeChild(body.firstChild);
  if (v.yt_id) {
    const ifr = document.createElement('iframe');
    ifr.src = 'https://www.youtube.com/embed/' + v.yt_id + '?autoplay=1&rel=0';
    ifr.frameBorder = '0'; ifr.allowFullscreen = true;
    ifr.setAttribute('allow','autoplay; encrypted-media; fullscreen; picture-in-picture');
    ifr.style.cssText = 'display:block;width:100%;aspect-ratio:16/9;border:0';
    body.appendChild(ifr);
  } else if (v.url) {
    const vid = document.createElement('video'); vid.src = v.url; vid.controls = true; vid.autoplay = true;
    vid.style.cssText = 'width:100%;aspect-ratio:16/9'; body.appendChild(vid);
  } else {
    body.textContent = 'Video unavailable.';
  }
  document.getElementById('cvModal').style.display = 'flex';
}

function closeCvModal() {
  document.getElementById('cvModal').style.display = 'none';
  const b = document.getElementById('cvModalBody'); while(b.firstChild) b.removeChild(b.firstChild);
}
</script>
{{POWERED_BY}}
</body>
</html>`;

// ─── OPERATOR APP SHELL ────────────────────────────────────────────────────
// Persistent shell (sidebar + topbar) for the Stacked Chat redesign.
// Routes: triage | issues | health | runbooks | sites | widget
// Hash-routed (#triage, #issues, ...) with localStorage['sc:route'] persistence
// to match prototype behaviour (see shell.jsx). Content area is intentionally
// empty — screens are built in subsequent steps.
const APP_SHELL = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Stacked Chat &mdash; App</title>
<link rel="icon" type="image/svg+xml" href="https://raw.githubusercontent.com/TOT-STACKED/toast-support-bot/main/bowls-orange.svg">
<link href="https://fonts.googleapis.com/css2?family=Fraunces:opsz,wght@9..144,500;9..144,600;9..144,700;9..144,800;9..144,900&family=Geist:wght@400;500;600;700;800&family=Geist+Mono:wght@400;500;600&display=swap" rel="stylesheet">
<style>
*, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
:root {
  --ink-900: #0A0A0A; --ink-800: #131313; --ink-700: #1D1D1D;
  --fg: #F4EFE6; --fg-muted: #928A7C; --fg-dim: #555048;
  --border: #262421;
  --stacked-orange-500: #E87830; --stacked-orange-700: #A34F15;
  --stacked-green-500: #3BD36F; --stacked-green-700: #1E8A44;
  --stacked-amber-500: #F5A524;
  --stacked-red-500: #E5484D;
  --stacked-purple-500: #C7B3F2; --stacked-purple-700: #1D1340;
  --font-sans: 'Geist', ui-sans-serif, system-ui, sans-serif;
  --font-display: 'Fraunces', 'Fraunces Placeholder', ui-serif, Georgia, serif;
  --font-mono: 'Geist Mono', ui-monospace, 'SF Mono', monospace;
  --ease: cubic-bezier(0.2, 0.8, 0.2, 1);
  color-scheme: dark;
}
html, body { height: 100%; overflow: hidden; }
body { background: var(--ink-900); color: var(--fg); font-family: var(--font-sans); -webkit-font-smoothing: antialiased; }
button { font-family: inherit; cursor: pointer; }
::-webkit-scrollbar { width: 10px; height: 10px; }
::-webkit-scrollbar-track { background: var(--ink-900); }
::-webkit-scrollbar-thumb { background: var(--ink-700); border-radius: 5px; }

/* ─── LAYOUT ─────────────────────────────────────────────────────────── */
.app { display: grid; grid-template-columns: 240px 1fr; height: 100%; }

/* ─── LEFT NAV ───────────────────────────────────────────────────────── */
.nav { background: var(--ink-800); border-right: 1px solid var(--border); display: flex; flex-direction: column; padding: 16px 12px; }
.nav-top { display: flex; align-items: center; justify-content: space-between; padding: 4px 8px 18px; }
.nav-top img { height: 20px; }
.nav-tag { font-family: var(--font-mono); font-size: 9px; letter-spacing: 0.24px; background: var(--stacked-orange-500); color: #fff; padding: 3px 7px; border-radius: 3px; font-weight: 800; }

.org-picker { display: flex; align-items: center; gap: 10px; padding: 10px 12px; background: var(--ink-900); border: 1px solid var(--border); border-radius: 10px; margin-bottom: 16px; cursor: pointer; transition: border-color 120ms var(--ease); }
.org-picker:hover { border-color: var(--fg-dim); }
.org-av { width: 30px; height: 30px; border-radius: 8px; background: var(--stacked-orange-500); color: #fff; display: grid; place-items: center; font-family: var(--font-display); font-size: 12px; flex-shrink: 0; font-weight: 700; }
.org-meta { min-width: 0; flex: 1; }
.org-name { font-size: 13px; font-weight: 800; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.org-sub { font-size: 10px; color: var(--fg-muted); font-family: var(--font-mono); }

.new-issue { background: var(--stacked-orange-500); color: #fff; border: 0; padding: 11px 14px; border-radius: 999px; font-weight: 800; font-size: 13px; box-shadow: 0 4px 0 0 var(--stacked-orange-700); margin-bottom: 22px; transition: transform 120ms var(--ease), box-shadow 120ms var(--ease); }
.new-issue:hover { transform: translateY(-1px); box-shadow: 0 5px 0 0 var(--stacked-orange-700); }
.new-issue:active { transform: translateY(2px); box-shadow: 0 2px 0 0 var(--stacked-orange-700); }

.nav-list { display: flex; flex-direction: column; gap: 2px; flex: 1; align-content: flex-start; }
.nav-btn { display: flex; align-items: center; gap: 12px; padding: 10px 12px; background: transparent; border: 0; border-radius: 8px; color: var(--fg-muted); font-size: 13px; font-weight: 600; text-align: left; transition: background 120ms var(--ease), color 120ms var(--ease); width: 100%; }
.nav-btn:hover { background: var(--ink-700); color: var(--fg); }
.nav-btn.active { background: var(--ink-700); color: var(--fg); }
.nav-badge { margin-left: auto; font-size: 10px; font-weight: 900; font-family: var(--font-mono); background: var(--stacked-red-500); color: #fff; padding: 2px 6px; border-radius: 3px; }
.nav-btn.active .nav-badge { background: var(--stacked-orange-500); }

.nav-foot { border-top: 1px solid var(--border); padding-top: 12px; margin-top: 12px; display: grid; gap: 10px; }
.foot-row { display: flex; align-items: center; gap: 8px; padding: 6px 8px; }
.livedot { width: 7px; height: 7px; border-radius: 999px; background: var(--stacked-green-500); box-shadow: 0 0 0 3px rgba(59,211,111,0.22); }
.foot-status { font-size: 11px; color: var(--fg-muted); }
.user-row { display: flex; align-items: center; gap: 10px; padding: 6px 8px; border-radius: 8px; }
.user-av { width: 30px; height: 30px; border-radius: 999px; background: var(--stacked-purple-500); color: var(--stacked-purple-700); display: grid; place-items: center; font-family: var(--font-display); font-size: 12px; font-weight: 700; flex-shrink: 0; }
.user-meta { min-width: 0; flex: 1; }
.user-name { font-size: 12px; font-weight: 700; }
.user-role { font-size: 10px; color: var(--fg-muted); }
.cog { color: var(--fg-muted); background: transparent; border: 0; padding: 4px; border-radius: 6px; display: grid; place-items: center; }
.cog:hover { color: var(--fg); background: var(--ink-700); }

/* ─── MAIN ───────────────────────────────────────────────────────────── */
.main { display: flex; flex-direction: column; min-width: 0; }
.topbar { display: flex; align-items: center; gap: 16px; padding: 14px 22px; border-bottom: 1px solid var(--border); background: var(--ink-900); }
.breadcrumbs { display: flex; align-items: center; gap: 10px; font-size: 13px; }
.breadcrumbs .crumb-org { color: var(--fg-muted); }
.breadcrumbs .crumb-sep { color: var(--fg-dim); }
.breadcrumbs .crumb-cur { font-weight: 700; text-transform: capitalize; }
.search { flex: 1; max-width: 440px; display: flex; align-items: center; gap: 8px; background: var(--ink-800); border: 1px solid var(--border); border-radius: 10px; padding: 7px 12px; transition: border-color 120ms var(--ease); }
.search:focus-within { border-color: var(--fg-dim); }
.search input { flex: 1; background: transparent; border: 0; color: var(--fg); font-family: inherit; font-size: 13px; outline: none; }
.search input::placeholder { color: var(--fg-muted); }
.top-actions { display: flex; gap: 8px; align-items: center; margin-left: auto; }
.icon-btn { width: 34px; height: 34px; background: var(--ink-800); border: 1px solid var(--border); border-radius: 8px; color: var(--fg); position: relative; display: grid; place-items: center; transition: border-color 120ms var(--ease); }
.icon-btn:hover { border-color: var(--fg-dim); }
.bell-dot { position: absolute; top: 6px; right: 6px; width: 7px; height: 7px; border-radius: 999px; background: var(--stacked-red-500); border: 2px solid var(--ink-800); }
.invite-btn { background: var(--ink-800); border: 1px solid var(--border); color: var(--fg); padding: 8px 14px; border-radius: 8px; font-size: 12px; font-weight: 700; transition: border-color 120ms var(--ease); }
.invite-btn:hover { border-color: var(--fg-dim); }

.content { flex: 1; overflow: auto; min-height: 0; padding: 28px 32px 48px; }
.content-placeholder { display: grid; place-items: center; height: 100%; color: var(--fg-dim); font-family: var(--font-display); font-size: 18px; font-weight: 500; letter-spacing: -0.01em; }
.content-placeholder span { color: var(--fg-muted); font-family: var(--font-mono); font-size: 11px; letter-spacing: 0.14px; text-transform: uppercase; font-weight: 800; display: block; margin-top: 6px; text-align: center; }

/* ─── SHARED PRIMITIVES ──────────────────────────────────────────────── */
@keyframes flash { 0%, 100% { opacity: 1; } 50% { opacity: 0.35; } }

/* ─── TRIAGE SCREEN ──────────────────────────────────────────────────── */
.triage { display: grid; gap: 28px; }
.triage-top { display: grid; grid-template-columns: 1fr auto; gap: 40px; align-items: start; }
.eyebrow { font-size: 11px; font-weight: 800; letter-spacing: 0.18px; text-transform: uppercase; color: var(--fg-muted); margin-bottom: 8px; }
.triage-h1 { font-family: var(--font-display); font-size: 46px; letter-spacing: -0.02em; line-height: 1; margin: 0; font-weight: 600; }
.triage-h1 .accent { color: var(--stacked-orange-500); }
.triage-subhead { font-size: 15px; color: var(--fg-muted); margin-top: 12px; max-width: 640px; }
.kpi-strip { display: grid; grid-template-columns: repeat(4, 1fr); gap: 10px; }
.kpi { background: var(--ink-800); border: 1px solid var(--border); border-radius: 12px; padding: 14px 16px; min-width: 140px; }
.kpi-label { font-size: 10px; color: var(--fg-muted); font-weight: 800; letter-spacing: 0.14px; text-transform: uppercase; }
.kpi-big { font-family: var(--font-display); font-size: 38px; line-height: 1; margin-top: 6px; color: var(--fg); font-weight: 600; }
.kpi-big.green { color: var(--stacked-green-500); }
.kpi-big.orange { color: var(--stacked-orange-500); }
.kpi-sub { font-size: 11px; color: var(--fg-muted); margin-top: 4px; }

.active-row { display: grid; grid-template-columns: repeat(auto-fit, minmax(260px, 1fr)); gap: 10px; }
.active-card { background: var(--ink-800); border: 1.5px solid var(--stacked-red-500); border-radius: 14px; padding: 16px 18px; text-align: left; color: inherit; font-family: inherit; display: block; transition: transform 120ms var(--ease), border-color 120ms var(--ease); }
.active-card.watch { border-color: var(--stacked-amber-500); }
.active-card:hover { transform: translateY(-1px); }
.active-head { display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 8px; }
.crit-badge { font-size: 10px; font-weight: 900; font-family: var(--font-mono); letter-spacing: 0.14px; background: var(--stacked-red-500); color: #fff; padding: 3px 7px; border-radius: 3px; }
.crit-badge.watch { background: var(--stacked-amber-500); color: #0F0F0F; }
.active-site { font-size: 11px; color: var(--fg-muted); font-family: var(--font-mono); }
.active-brand { font-family: var(--font-display); font-size: 22px; letter-spacing: -0.01em; margin-bottom: 4px; font-weight: 600; }
.active-inc { font-size: 13px; color: var(--stacked-red-500); font-weight: 700; }
.active-inc.watch { color: var(--stacked-amber-500); }
.mini-prog { height: 3px; background: var(--ink-900); border-radius: 2px; margin-top: 14px; margin-bottom: 6px; overflow: hidden; }
.mini-prog-bar { height: 100%; background: var(--stacked-orange-500); width: 66%; transition: width 800ms var(--ease); }
.active-foot { font-size: 11px; color: var(--fg-muted); display: flex; justify-content: space-between; }
.active-monitor { font-size: 11px; color: var(--fg-muted); margin-top: 14px; }

.const-wrap { background: var(--ink-800); border: 1px solid var(--border); border-radius: 16px; padding: 22px; }
.const-head { display: flex; justify-content: space-between; align-items: flex-end; margin-bottom: 18px; }
.triage-h2 { font-family: var(--font-display); font-size: 28px; letter-spacing: -0.015em; margin: 0; font-weight: 600; }
.legend { display: flex; gap: 18px; font-size: 11px; color: var(--fg-muted); align-items: center; }
.legend-dot { width: 8px; height: 8px; border-radius: 999px; margin-right: 6px; margin-left: 10px; display: inline-block; }
.const-grid { display: grid; grid-template-columns: repeat(6, 1fr); gap: 8px; }
.cell { background: var(--ink-900); border: 1px solid; border-radius: 12px; padding: 14px; text-align: left; color: inherit; font-family: inherit; display: grid; gap: 8px; transition: transform 120ms var(--ease); }
.cell:hover { transform: translateY(-1px); }
.cell.red   { border-color: var(--stacked-red-500);   background: linear-gradient(180deg, rgba(0,0,0,0) 40%, rgba(229,72,77,0.08) 100%); }
.cell.amber { border-color: var(--stacked-amber-500); background: linear-gradient(180deg, rgba(0,0,0,0) 40%, rgba(245,165,36,0.08) 100%); }
.cell.green { border-color: var(--stacked-green-500); background: linear-gradient(180deg, rgba(0,0,0,0) 40%, rgba(59,211,111,0.08) 100%); }
.cell-top { display: flex; align-items: center; gap: 6px; }
.cell-dot { width: 7px; height: 7px; border-radius: 999px; flex-shrink: 0; }
.cell-dot.pulsing { animation: flash 1200ms infinite; }
.cell-dot.red   { background: var(--stacked-red-500); }
.cell-dot.amber { background: var(--stacked-amber-500); }
.cell-dot.green { background: var(--stacked-green-500); }
.cell-brand { font-size: 10px; font-family: var(--font-mono); color: var(--fg-muted); text-transform: uppercase; letter-spacing: 0.12px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.cell-name { font-size: 13px; font-weight: 800; }
.cell-bar { display: flex; gap: 3px; }
.cell-pip { height: 6px; flex: 1; border-radius: 2px; }
.cell-pip.red   { background: var(--stacked-red-500); }
.cell-pip.amber { background: var(--stacked-amber-500); }
.cell-pip.green { background: var(--stacked-green-500); }
.cell-score { display: flex; justify-content: space-between; align-items: flex-end; }
.cell-score-num { font-family: var(--font-display); font-size: 22px; line-height: 1; font-weight: 600; }
.cell-score-num.red   { color: var(--stacked-red-500); }
.cell-score-num.amber { color: var(--stacked-amber-500); }
.cell-score-num.green { color: var(--stacked-green-500); }
.cell-score-label { font-size: 9px; font-family: var(--font-mono); color: var(--fg-muted); letter-spacing: 0.12px; font-weight: 700; }

.feed-wrap { display: block; }
.feed-head { display: flex; justify-content: space-between; align-items: flex-end; margin-bottom: 18px; }
.ghost-btn { background: transparent; border: 1px solid var(--border); color: var(--fg); padding: 8px 14px; border-radius: 999px; font-family: inherit; font-size: 12px; font-weight: 700; transition: border-color 120ms var(--ease); }
.ghost-btn:hover { border-color: var(--fg-dim); }
.feed { background: var(--ink-800); border: 1px solid var(--border); border-radius: 14px; overflow: hidden; }
.feed-row { display: grid; grid-template-columns: 10px 60px 1.4fr 1.6fr 1.4fr 110px; gap: 18px; align-items: center; padding: 14px 18px; border-bottom: 1px solid var(--border); font-size: 13px; font-family: var(--font-mono); }
.feed-row:last-child { border-bottom: 0; }
.feed-pip { width: 8px; height: 8px; border-radius: 999px; }
.feed-pip.ok    { background: var(--stacked-green-500); }
.feed-pip.human { background: var(--stacked-amber-500); }
.feed-time { color: var(--fg-muted); }
.feed-site { font-family: var(--font-sans); font-weight: 700; }
.feed-issue { color: var(--fg-muted); font-family: var(--font-sans); }
.feed-fix { font-weight: 700; }
.feed-fix.ok    { color: var(--stacked-green-500); }
.feed-fix.human { color: var(--stacked-amber-500); }
.feed-open { background: var(--ink-900); border: 1px solid var(--border); color: var(--fg); padding: 6px 10px; border-radius: 6px; font-size: 11px; font-family: inherit; font-weight: 700; }
.feed-open:hover { border-color: var(--fg-dim); }

/* ─── ISSUE SCREEN ───────────────────────────────────────────────────── */
.issue { display: grid; gap: 22px; }

/* Header */
.iss-head { display: grid; grid-template-columns: auto 1fr auto; gap: 24px; align-items: start; }
.iss-back { background: transparent; border: 1px solid var(--border); color: var(--fg-muted); padding: 8px 14px; border-radius: 8px; font-family: inherit; font-size: 12px; font-weight: 700; transition: border-color 120ms var(--ease), color 120ms var(--ease); }
.iss-back:hover { border-color: var(--fg-dim); color: var(--fg); }
.iss-meta { min-width: 0; }
.iss-meta-row { display: flex; align-items: center; gap: 12px; }
.live-badge { font-size: 10px; font-weight: 900; font-family: var(--font-mono); letter-spacing: 0.14px; background: var(--stacked-red-500); color: #fff; padding: 4px 8px; border-radius: 3px; }
.iss-h1 { font-family: var(--font-display); font-size: 32px; letter-spacing: -0.015em; margin: 0; font-weight: 600; }
.iss-sub { font-size: 13px; color: var(--fg-muted); font-family: var(--font-mono); margin-top: 6px; }
.iss-actions { display: flex; gap: 8px; }
.act-ghost { background: var(--ink-800); border: 1px solid var(--border); color: var(--fg); padding: 10px 14px; border-radius: 8px; font-family: inherit; font-size: 12px; font-weight: 700; transition: border-color 120ms var(--ease); }
.act-ghost:hover { border-color: var(--fg-dim); }
.act-primary { background: var(--stacked-orange-500); color: #fff; border: 0; padding: 10px 16px; border-radius: 8px; font-family: inherit; font-size: 12px; font-weight: 800; box-shadow: 0 4px 0 0 var(--stacked-orange-700); transition: transform 120ms var(--ease), box-shadow 120ms var(--ease); }
.act-primary:hover { transform: translateY(-1px); box-shadow: 0 5px 0 0 var(--stacked-orange-700); }
.act-primary:active { transform: translateY(2px); box-shadow: 0 2px 0 0 var(--stacked-orange-700); }

/* Timeline scrubber — novel moment #2 */
.tl { background: var(--ink-800); border: 1px solid var(--border); border-radius: 16px; padding: 22px; }
.tl-head { display: flex; justify-content: space-between; align-items: center; margin-bottom: 18px; }
.tl-head-label { font-size: 11px; font-weight: 800; letter-spacing: 0.14px; text-transform: uppercase; color: var(--fg-muted); }
.tl-head-count { font-size: 11px; font-family: var(--font-mono); color: var(--fg-muted); }
.tl-track { display: grid; grid-template-columns: repeat(7, 1fr); position: relative; margin-bottom: 18px; }
.tl-line { position: absolute; top: 14px; left: 7%; right: 7%; height: 2px; background: var(--border); z-index: 0; }
.tl-step { background: transparent; border: 0; display: grid; gap: 8px; justify-items: center; padding: 0; font-family: inherit; color: inherit; position: relative; z-index: 1; }
.tl-pin { width: 28px; height: 28px; border-radius: 999px; border: 2px solid var(--border); background: var(--ink-900); display: grid; place-items: center; transition: background 120ms var(--ease), border-color 120ms var(--ease); }
.tl-pin.done    { border-color: var(--stacked-green-500); }
.tl-pin.cur     { border-color: var(--stacked-orange-500); }
.tl-pin.done.scrubbed { background: var(--stacked-green-500); }
.tl-pin.cur.scrubbed  { background: var(--stacked-orange-500); }
.tl-pin.idle.scrubbed { background: var(--ink-700); }
.tl-pin .tl-check  { color: var(--stacked-green-500); font-size: 10px; font-weight: 900; }
.tl-pin.done.scrubbed .tl-check { color: #fff; }
.tl-pin .tl-bullet { color: #fff; font-size: 10px; line-height: 1; }
.tl-pin .tl-num    { color: var(--fg-dim); font-size: 9px; font-family: var(--font-mono); font-weight: 700; }
.tl-label { font-size: 12px; font-weight: 700; }
.tl-time  { font-size: 10px; color: var(--fg-muted); font-family: var(--font-mono); }
.tl-detail { background: var(--ink-900); border: 1px solid var(--border); border-radius: 10px; padding: 14px 16px; }
.tl-detail-eyebrow { font-size: 11px; font-family: var(--font-mono); color: var(--stacked-orange-500); letter-spacing: 0.14px; text-transform: uppercase; }
.tl-detail-body { font-size: 15px; color: var(--fg); margin-top: 6px; line-height: 1.5; }

/* Body: conversation + rail */
.iss-body { display: grid; grid-template-columns: 1fr 300px; gap: 16px; align-items: start; }

/* Conversation */
.conv { background: var(--ink-800); border: 1px solid var(--border); border-radius: 16px; padding: 20px; display: flex; flex-direction: column; gap: 14px; }
.cm { display: flex; gap: 10px; align-items: flex-start; }
.cm.op { justify-content: flex-end; }
.bot-av { width: 28px; height: 28px; border-radius: 999px; background: var(--stacked-orange-500); display: grid; place-items: center; flex-shrink: 0; }
.bot-av img { width: 16px; height: 16px; }
.cm-stack { display: grid; gap: 4px; max-width: 540px; }
.cm-name { font-size: 10px; font-family: var(--font-mono); color: var(--fg-muted); letter-spacing: 0.12px; text-transform: uppercase; font-weight: 700; }
.bub-b    { background: var(--ink-700); border: 1px solid var(--border); padding: 10px 14px; border-radius: 14px; border-bottom-left-radius: 4px; font-size: 14px; line-height: 1.55; }
.bub-u    { background: var(--stacked-orange-500); color: #fff; padding: 10px 14px; border-radius: 14px; border-bottom-right-radius: 4px; font-size: 14px; line-height: 1.55; }
.bub-card { background: var(--ink-900); border: 1px solid var(--border); padding: 14px; border-radius: 14px; }
.ev-label { font-family: var(--font-mono); font-size: 11px; letter-spacing: 0.14px; text-transform: uppercase; color: var(--fg-muted); margin-bottom: 8px; font-weight: 700; }
.ev-list { display: grid; gap: 6px; font-family: var(--font-mono); font-size: 12px; }
.ev-list .ok   { color: var(--stacked-green-500); }
.ev-list .warn { color: var(--stacked-amber-500); }
.fix-title { font-family: var(--font-display); font-size: 18px; letter-spacing: -0.01em; margin-bottom: 10px; font-weight: 600; }
.fix-steps { margin: 0; padding-left: 18px; font-size: 14px; line-height: 1.7; }
.fix-steps b { font-weight: 700; }
.pair-code { background: var(--ink-800); border-radius: 10px; padding: 14px; margin-top: 12px; display: flex; align-items: center; justify-content: space-between; gap: 14px; }
.pair-label { font-size: 10px; color: var(--fg-muted); font-family: var(--font-mono); letter-spacing: 0.14px; text-transform: uppercase; font-weight: 700; }
.pair-num { font-family: var(--font-display); font-size: 48px; letter-spacing: 0.12em; color: var(--stacked-orange-500); text-shadow: 0 6px 0 var(--stacked-orange-700); line-height: 1; font-weight: 700; }
.copy-code { background: var(--ink-900); border: 1px solid var(--border); color: var(--fg); padding: 6px 10px; border-radius: 6px; font-size: 11px; font-family: inherit; font-weight: 700; transition: border-color 120ms var(--ease); }
.copy-code:hover { border-color: var(--fg-dim); }
.fix-note { font-size: 12px; color: var(--fg-muted); margin-top: 10px; }
.compose { display: flex; gap: 8px; background: var(--ink-900); border: 1px solid var(--border); border-radius: 999px; padding: 6px 6px 6px 16px; margin-top: 6px; }
.compose input { flex: 1; background: transparent; border: 0; color: var(--fg); font-family: inherit; font-size: 13px; outline: none; }
.compose input::placeholder { color: var(--fg-muted); }
.compose .act-ghost { padding: 10px 14px; }
.send-btn { background: var(--stacked-orange-500); color: #fff; border: 0; border-radius: 999px; padding: 10px 16px; font-family: inherit; font-weight: 800; font-size: 12px; box-shadow: 0 3px 0 0 var(--stacked-orange-700); transition: transform 120ms var(--ease), box-shadow 120ms var(--ease); }
.send-btn:hover { transform: translateY(-1px); box-shadow: 0 4px 0 0 var(--stacked-orange-700); }
.send-btn:active { transform: translateY(1px); box-shadow: 0 2px 0 0 var(--stacked-orange-700); }

/* Context rail */
.rail { display: grid; gap: 12px; }
.rail-block { background: var(--ink-800); border: 1px solid var(--border); border-radius: 14px; padding: 16px; }
.rail-label { font-size: 10px; font-weight: 800; letter-spacing: 0.18px; text-transform: uppercase; color: var(--fg-muted); margin-bottom: 10px; }
.rail-title { font-family: var(--font-display); font-size: 22px; letter-spacing: -0.01em; font-weight: 600; }
.rail-sub   { font-size: 12px; color: var(--fg-muted); font-family: var(--font-mono); margin-bottom: 14px; }
.rail-kv { display: flex; justify-content: space-between; padding: 6px 0; border-bottom: 1px dashed var(--border); font-size: 12px; }
.rail-kv:last-child { border-bottom: 0; }
.rail-kv b { font-weight: 700; }
.rail-kv .amber { color: var(--stacked-amber-500); }
.rail-iss { display: flex; align-items: center; gap: 10px; padding: 6px 0; }
.rail-pip { width: 7px; height: 7px; border-radius: 999px; flex-shrink: 0; }
.rail-pip.ok    { background: var(--stacked-green-500); }
.rail-pip.human { background: var(--stacked-amber-500); }
.rail-day   { font-size: 11px; color: var(--fg-muted); font-family: var(--font-mono); width: 36px; flex-shrink: 0; }
.rail-issue-text { font-size: 12px; flex: 1; }
.rail-runbook-title { font-size: 13px; font-weight: 700; margin-bottom: 6px; }
.rail-runbook-body  { font-size: 12px; color: var(--fg-muted); line-height: 1.55; }
.rail-runbook-open { margin-top: 10px; width: 100%; }

/* ─── HANDOFF SCREEN — novel moment #3 ───────────────────────────────── */
.ho { display: grid; gap: 22px; }
.ho-back { background: transparent; border: 1px solid var(--border); color: var(--fg-muted); padding: 8px 14px; border-radius: 8px; font-family: inherit; font-size: 12px; font-weight: 700; justify-self: start; transition: border-color 120ms var(--ease), color 120ms var(--ease); }
.ho-back:hover { border-color: var(--fg-dim); color: var(--fg); }
.ho-h1 { font-family: var(--font-display); font-size: 40px; letter-spacing: -0.02em; margin: 8px 0 0; font-weight: 600; }
.ho-sub { font-size: 14px; color: var(--fg-muted); margin-top: 8px; max-width: 560px; }

.ho-grid { display: grid; grid-template-columns: 1fr 1.1fr; gap: 16px; align-items: start; }

/* Recipient cards */
.ho-options { display: grid; gap: 10px; }
.ho-opt { background: var(--ink-800); border: 1.5px solid var(--border); border-radius: 14px; padding: 18px; font-family: inherit; color: inherit; text-align: left; transition: border-color 120ms var(--ease), transform 120ms var(--ease); display: block; width: 100%; }
.ho-opt:hover { transform: translateY(-1px); }
.ho-opt.recommended { border-color: var(--stacked-green-500); }
.ho-opt-top { display: flex; align-items: center; gap: 12px; margin-bottom: 12px; }
.ho-av { width: 40px; height: 40px; border-radius: 999px; background: var(--stacked-purple-500); color: var(--stacked-purple-700); display: grid; place-items: center; font-family: var(--font-display); font-size: 13px; font-weight: 700; flex-shrink: 0; }
.ho-opt-meta { flex: 1; text-align: left; min-width: 0; }
.ho-opt-name { font-size: 15px; font-weight: 800; }
.ho-opt-role { font-size: 12px; color: var(--fg-muted); margin-top: 2px; }
.ho-tag { font-size: 10px; font-family: var(--font-mono); padding: 3px 7px; border-radius: 3px; letter-spacing: 0.14px; font-weight: 800; flex-shrink: 0; }
.ho-tag.recommended { background: var(--stacked-green-500); color: #0F0F0F; }
.ho-tag.team        { background: var(--stacked-purple-500); color: #fff; }
.ho-tag.paid        { background: var(--stacked-orange-500); color: #fff; }
.ho-opt-foot { display: flex; justify-content: space-between; font-size: 11px; color: var(--fg-muted); border-top: 1px dashed var(--border); padding-top: 10px; }
.ho-opt-foot b { color: var(--fg); font-weight: 700; }

/* Attached chart */
.ho-chart { background: var(--ink-800); border: 1px solid var(--border); border-radius: 14px; padding: 20px; }
.ho-chart-head { margin-bottom: 14px; }
.ho-chart-title { font-family: var(--font-display); font-size: 22px; letter-spacing: -0.01em; margin-top: 4px; font-weight: 600; }
.ho-row { display: flex; align-items: center; gap: 10px; padding: 8px 0; border-bottom: 1px dashed var(--border); }
.ho-row-glyph { font-family: var(--font-mono); font-size: 12px; width: 16px; flex-shrink: 0; font-weight: 700; }
.ho-row-glyph.ok    { color: var(--stacked-green-500); }
.ho-row-glyph.warn  { color: var(--stacked-amber-500); }
.ho-row-text { font-size: 13px; }
.ho-hypothesis { display: flex; align-items: flex-start; gap: 10px; border-bottom: 0; margin-top: 8px; background: var(--ink-900); padding: 12px 14px; border-radius: 10px; }
.ho-hypothesis .ho-row-glyph { padding-top: 1px; }
.ho-permit { border-top: 1px solid var(--border); margin-top: 14px; padding-top: 14px; display: grid; gap: 6px; }
.ho-check { display: flex; align-items: center; gap: 8px; font-size: 12px; color: var(--fg-muted); cursor: pointer; }
.ho-check input { accent-color: var(--stacked-orange-500); cursor: pointer; }
.ho-send { width: 100%; background: var(--stacked-orange-500); color: #fff; border: 0; padding: 14px 18px; border-radius: 10px; font-family: inherit; font-weight: 800; font-size: 14px; box-shadow: 0 5px 0 0 var(--stacked-orange-700); margin-top: 14px; transition: transform 120ms var(--ease), box-shadow 120ms var(--ease); }
.ho-send:hover:not(.sent) { transform: translateY(-1px); box-shadow: 0 6px 0 0 var(--stacked-orange-700); }
.ho-send:active:not(.sent) { transform: translateY(2px); box-shadow: 0 3px 0 0 var(--stacked-orange-700); }
.ho-send.sent { background: var(--stacked-green-500); color: #0F0F0F; box-shadow: 0 5px 0 0 var(--stacked-green-700); cursor: default; }

/* ─── HEALTH SCREEN ──────────────────────────────────────────────────── */
.hl { display: grid; gap: 22px; }
.hl-head { display: grid; grid-template-columns: 1fr auto; gap: 40px; align-items: start; }
.hl-h1 { font-family: var(--font-display); font-size: 46px; letter-spacing: -0.02em; margin: 8px 0 0; font-weight: 600; }
.hl-sub { font-size: 14px; color: var(--fg-muted); margin-top: 8px; max-width: 560px; }
.hl-sub b { color: var(--fg); font-weight: 700; }
.hl-overall { background: var(--ink-800); border: 1px solid var(--border); border-radius: 14px; padding: 14px 22px; display: grid; gap: 4px; justify-items: center; min-width: 180px; }
.hl-overall-label { font-size: 10px; color: var(--fg-muted); letter-spacing: 0.18px; text-transform: uppercase; font-weight: 800; }
.hl-overall-num { font-family: var(--font-display); font-size: 72px; line-height: 1; letter-spacing: -0.02em; color: var(--stacked-green-500); font-weight: 600; }
.hl-overall-trend { font-size: 11px; color: var(--stacked-green-500); font-family: var(--font-mono); font-weight: 700; }
.hl-panel { background: var(--ink-800); border: 1px solid var(--border); border-radius: 16px; padding: 22px; }
.hl-panel-head { display: flex; justify-content: space-between; align-items: flex-end; margin-bottom: 18px; gap: 18px; }
.hl-panel-title { font-family: var(--font-display); font-size: 22px; letter-spacing: -0.01em; font-weight: 600; }
.hl-panel-meta { font-size: 11px; color: var(--fg-muted); }

/* Heatmap */
.hl-heat { display: grid; gap: 3px; }
.hl-heat-row { display: grid; grid-template-columns: 56px repeat(30, 1fr); gap: 3px; align-items: center; }
.hl-heat-lbl { font-size: 10px; color: var(--fg-muted); font-family: var(--font-mono); }
.hl-heat-cell { height: 16px; border-radius: 2px; }
.hl-heat-cell.l0 { background: rgba(59,211,111,0.18); }
.hl-heat-cell.l1 { background: rgba(245,165,36,0.35); }
.hl-heat-cell.l2 { background: rgba(245,165,36,0.75); }
.hl-heat-cell.l3 { background: var(--stacked-red-500); }
.hl-heat-foot { display: flex; justify-content: space-between; align-items: center; margin-top: 12px; padding-left: 56px; gap: 18px; }
.hl-heat-foot > span { font-size: 10px; color: var(--fg-muted); font-family: var(--font-mono); }
.hl-heat-legend { display: flex; align-items: center; gap: 6px; font-size: 10px; color: var(--fg-muted); }
.hl-heat-legend .sw { width: 10px; height: 10px; display: inline-block; border-radius: 2px; }

/* Vendor grades */
.hl-vgrid { display: grid; grid-template-columns: repeat(auto-fit, minmax(220px, 1fr)); gap: 10px; }
.hl-vcard { background: var(--ink-900); border: 1px solid var(--border); border-radius: 12px; padding: 16px; transition: border-color 120ms var(--ease); }
.hl-vcard:hover { border-color: var(--fg-dim); }
.hl-vtop { display: flex; justify-content: space-between; }
.hl-vcat { font-size: 10px; color: var(--fg-muted); font-family: var(--font-mono); text-transform: uppercase; letter-spacing: 0.14px; font-weight: 700; }
.hl-vtrend { font-size: 11px; font-family: var(--font-mono); font-weight: 700; }
.hl-vtrend.up   { color: var(--stacked-green-500); }
.hl-vtrend.down { color: var(--stacked-red-500); }
.hl-vmid { display: flex; align-items: flex-end; justify-content: space-between; margin-top: 6px; gap: 10px; }
.hl-vname { font-family: var(--font-display); font-size: 22px; letter-spacing: -0.01em; font-weight: 600; }
.hl-vscore { font-family: var(--font-display); font-size: 40px; line-height: 1; font-weight: 600; }
.hl-vscore.green { color: var(--stacked-green-500); }
.hl-vscore.amber { color: var(--stacked-amber-500); }
.hl-vscore.red   { color: var(--stacked-red-500); }
.hl-vbar { height: 6px; background: var(--ink-700); border-radius: 3px; margin-top: 12px; overflow: hidden; }
.hl-vbar-fill { height: 100%; transition: width 400ms var(--ease); }
.hl-vbar-fill.green { background: var(--stacked-green-500); }
.hl-vbar-fill.amber { background: var(--stacked-amber-500); }
.hl-vbar-fill.red   { background: var(--stacked-red-500); }
.hl-vfoot { display: flex; justify-content: space-between; font-size: 11px; color: var(--fg-muted); margin-top: 10px; }
.hl-drill { background: transparent; border: 0; color: var(--stacked-orange-500); font-size: 11px; font-family: inherit; font-weight: 700; }
.hl-drill:hover { text-decoration: underline; }

/* Recommendations */
.hl-rec { border-top: 1px solid var(--border); padding-top: 16px; margin-top: 16px; }
.hl-rec-label { font-size: 10px; font-family: var(--font-mono); color: var(--stacked-orange-500); letter-spacing: 0.14px; font-weight: 700; }
.hl-rec-title { font-family: var(--font-display); font-size: 22px; letter-spacing: -0.01em; margin-top: 4px; font-weight: 600; }
.hl-rec-body  { font-size: 13px; color: var(--fg-muted); margin-top: 6px; line-height: 1.55; max-width: 720px; }
.hl-rec-btn { background: var(--ink-900); border: 1px solid var(--border); color: var(--fg); padding: 10px 14px; border-radius: 8px; font-family: inherit; font-size: 12px; font-weight: 700; margin-top: 12px; transition: border-color 120ms var(--ease); }
.hl-rec-btn:hover { border-color: var(--fg-dim); }

/* ─── RUNBOOKS SCREEN ────────────────────────────────────────────────── */
.rb { display: grid; gap: 22px; }
.rb-head { display: grid; grid-template-columns: 1fr auto; gap: 24px; align-items: end; }
.rb-h1 { font-family: var(--font-display); font-size: 46px; letter-spacing: -0.02em; margin: 8px 0 0; font-weight: 600; }
.rb-sub { font-size: 14px; color: var(--fg-muted); margin-top: 8px; max-width: 560px; }
.rb-add { background: var(--stacked-orange-500); color: #fff; border: 0; padding: 12px 18px; border-radius: 999px; font-family: inherit; font-weight: 800; font-size: 13px; box-shadow: 0 4px 0 0 var(--stacked-orange-700); transition: transform 120ms var(--ease), box-shadow 120ms var(--ease); }
.rb-add:hover { transform: translateY(-1px); box-shadow: 0 5px 0 0 var(--stacked-orange-700); }
.rb-add:active { transform: translateY(2px); box-shadow: 0 2px 0 0 var(--stacked-orange-700); }

.rb-filters { display: flex; gap: 6px; align-items: center; flex-wrap: wrap; }
.rb-chip { background: var(--ink-800); border: 1px solid var(--border); color: var(--fg-muted); padding: 7px 12px; border-radius: 999px; font-family: inherit; font-size: 12px; font-weight: 700; transition: border-color 120ms var(--ease), background 120ms var(--ease), color 120ms var(--ease); }
.rb-chip:hover { border-color: var(--fg-dim); color: var(--fg); }
.rb-chip.on { background: var(--fg); color: var(--ink-900); border-color: var(--fg); }
.rb-chip.on:hover { border-color: var(--fg); }
.rb-spacer { flex: 1; }
.rb-sort { font-size: 12px; color: var(--fg-muted); cursor: pointer; user-select: none; }
.rb-sort:hover { color: var(--fg); }

.rb-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(280px, 1fr)); gap: 12px; }
.rb-card { background: var(--ink-800); border: 1px solid var(--border); border-radius: 14px; padding: 18px; transition: border-color 120ms var(--ease), transform 120ms var(--ease); }
.rb-card:hover { border-color: var(--fg-dim); transform: translateY(-1px); }
.rb-card-top { display: flex; justify-content: space-between; align-items: flex-start; }
.rb-id { font-family: var(--font-mono); font-size: 11px; color: var(--stacked-orange-500); letter-spacing: 0.14px; font-weight: 700; }
.rb-cat-tag { font-size: 10px; font-family: var(--font-mono); letter-spacing: 0.14px; background: var(--ink-700); padding: 3px 7px; border-radius: 3px; color: var(--fg-muted); font-weight: 700; }
.rb-title { font-family: var(--font-display); font-size: 22px; letter-spacing: -0.01em; margin-top: 10px; margin-bottom: 6px; font-weight: 600; }
.rb-desc { font-size: 13px; color: var(--fg-muted); line-height: 1.55; min-height: 56px; }
.rb-stats { display: flex; align-items: flex-end; gap: 18px; margin-top: 14px; padding-top: 14px; border-top: 1px dashed var(--border); }
.rb-st-v { font-family: var(--font-display); font-size: 20px; line-height: 1; font-weight: 600; }
.rb-st-v.green { color: var(--stacked-green-500); }
.rb-st-v.amber { color: var(--stacked-amber-500); }
.rb-st-v.red   { color: var(--stacked-red-500); }
.rb-st-l { font-size: 9px; font-family: var(--font-mono); color: var(--fg-muted); letter-spacing: 0.14px; font-weight: 700; margin-top: 4px; }
.rb-open { margin-left: auto; background: transparent; border: 0; color: var(--stacked-orange-500); font-family: inherit; font-size: 12px; font-weight: 700; }
.rb-open:hover { text-decoration: underline; }

/* ─── SITES SCREEN ───────────────────────────────────────────────────── */
.st { display: grid; gap: 22px; }
.st-h1 { font-family: var(--font-display); font-size: 46px; letter-spacing: -0.02em; margin: 8px 0 0; font-weight: 600; }
.st-table { background: var(--ink-800); border: 1px solid var(--border); border-radius: 14px; overflow: hidden; }
.st-row { display: grid; grid-template-columns: 1.6fr 1fr 1fr 1fr 80px 80px; padding: 14px 18px; border-bottom: 1px solid var(--border); font-size: 13px; align-items: center; }
.st-row:last-child { border-bottom: 0; }
.st-head { font-size: 10px; font-weight: 800; letter-spacing: 0.18px; text-transform: uppercase; color: var(--fg-muted); }
.st-body:hover { background: var(--ink-900); }
.st-site   { font-weight: 700; }
.st-brand  { color: var(--fg-muted); }
.st-gm     { color: var(--fg-muted); }
.st-stack  { color: var(--fg-muted); font-family: var(--font-mono); font-size: 11px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.st-score  { font-family: var(--font-display); font-size: 18px; font-weight: 600; line-height: 1; }
.st-score.green { color: var(--stacked-green-500); }
.st-score.amber { color: var(--stacked-amber-500); }
.st-score.red   { color: var(--stacked-red-500); }
.st-iss    { font-family: var(--font-mono); font-size: 12px; font-weight: 700; }
.st-iss.clean { color: var(--fg-muted); }
.st-iss.open  { color: var(--stacked-red-500); }

/* ─── WIDGET PREVIEW SCREEN ──────────────────────────────────────────── */
.wg { display: grid; gap: 22px; align-items: start; }
.wg-grid { display: grid; grid-template-columns: 1fr 420px; gap: 32px; align-items: start; }
.wg-h1 { font-family: var(--font-display); font-size: 46px; letter-spacing: -0.02em; margin: 8px 0 0; font-weight: 600; }
.wg-sub { font-size: 14px; color: var(--fg-muted); margin-top: 10px; line-height: 1.6; max-width: 520px; }
.wg-features { display: grid; gap: 10px; margin-top: 24px; }
.wg-feat { display: flex; gap: 10px; align-items: center; font-size: 13px; color: var(--fg-muted); }
.wg-feat-check { color: var(--stacked-green-500); font-family: var(--font-mono); font-weight: 800; }
.wg-snippet { background: var(--ink-800); border: 1px solid var(--border); border-radius: 10px; padding: 14px; margin-top: 18px; }
.wg-snippet-label { font-size: 10px; font-family: var(--font-mono); color: var(--fg-muted); letter-spacing: 0.14px; text-transform: uppercase; margin-bottom: 8px; font-weight: 700; }
.wg-snippet-code { font-family: var(--font-mono); font-size: 12px; color: var(--stacked-orange-500); word-break: break-all; }

/* Phone mockup */
.wg-phone-wrap { justify-self: center; }
.wg-phone { width: 300px; background: #0B0B0B; border: 8px solid #1a1a1a; border-radius: 36px; overflow: hidden; box-shadow: 0 20px 60px rgba(0,0,0,0.5); position: relative; }
.wg-notch { position: absolute; top: 8px; left: 50%; transform: translateX(-50%); width: 80px; height: 20px; background: #000; border-radius: 20px; z-index: 2; }
.wg-sb { display: flex; justify-content: space-between; padding: 12px 22px 6px; font-family: var(--font-mono); font-size: 10px; color: var(--fg); background: #0B0B0B; }
.wg-sb-right { display: flex; gap: 4px; align-items: center; font-size: 9px; }
.wg-hdr { display: flex; align-items: center; gap: 10px; padding: 10px 14px; background: var(--ink-800); border-bottom: 1px solid var(--border); }
.wg-hdr-av { width: 26px; height: 26px; border-radius: 999px; background: var(--stacked-orange-500); display: grid; place-items: center; flex-shrink: 0; }
.wg-hdr-av img { width: 14px; height: 14px; }
.wg-hdr-name { font-size: 12px; font-weight: 800; }
.wg-hdr-status { font-size: 10px; color: var(--stacked-green-500); font-weight: 700; }
.wg-hdr-close { margin-left: auto; color: var(--fg-muted); font-size: 16px; cursor: pointer; }
.wg-body { padding: 14px; display: grid; gap: 10px; min-height: 320px; background: var(--ink-900); }
.wg-bub  { background: var(--ink-700); padding: 8px 12px; border-radius: 12px; border-bottom-left-radius: 3px; font-size: 12px; line-height: 1.5; max-width: 85%; }
.wg-bubU { background: var(--stacked-orange-500); color: #fff; padding: 8px 12px; border-radius: 12px; border-bottom-right-radius: 3px; font-size: 12px; line-height: 1.5; max-width: 85%; margin-left: auto; }
.wg-bub-card { background: var(--ink-800); border: 1px solid var(--border); padding: 10px; border-radius: 10px; }
.wg-card-label { font-size: 9px; letter-spacing: 0.14px; color: var(--fg-muted); font-family: var(--font-mono); font-weight: 800; }
.wg-card-title { font-size: 12px; font-weight: 700; margin: 4px 0; }
.wg-card-body  { font-size: 10px; color: var(--fg-muted); line-height: 1.5; }
.wg-comp { display: flex; justify-content: space-between; align-items: center; padding: 10px 14px; background: var(--ink-800); border-top: 1px solid var(--border); }
.wg-comp-ph { font-size: 11px; color: var(--fg-muted); }
.wg-send { width: 28px; height: 28px; border-radius: 999px; background: var(--stacked-orange-500); color: #fff; display: grid; place-items: center; font-size: 14px; font-weight: 800; }
</style>
</head>
<body>
<div class="app">
  <!-- Left nav -->
  <aside class="nav">
    <div class="nav-top">
      <img src="https://raw.githubusercontent.com/TOT-STACKED/toast-support-bot/main/wordmark-orange.svg" alt="Stacked">
      <span class="nav-tag">CHAT</span>
    </div>

    <button class="org-picker" type="button">
      <div class="org-av">PM</div>
      <div class="org-meta">
        <div class="org-name">Pieminister Group</div>
        <div class="org-sub">14 sites · PRO</div>
      </div>
      <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" stroke-width="1.6" style="color:var(--fg-muted)"><path d="M3 5l3 3 3-3M3 8l3-3 3 3"/></svg>
    </button>

    <button class="new-issue" type="button">＋ New issue</button>

    <nav class="nav-list" id="navList">
      <button class="nav-btn" data-route="triage" type="button">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M3 12h4l2-5 3 10 2-4h5"/></svg>
        <span>Triage</span>
        <span class="nav-badge">3</span>
      </button>
      <button class="nav-btn" data-route="issues" type="button">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M8 4h9a2 2 0 012 2v12a2 2 0 01-2 2H8l-5-5V6a2 2 0 012-2h3"/></svg>
        <span>Issues</span>
      </button>
      <button class="nav-btn" data-route="health" type="button">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M4 12a8 8 0 1116 0 8 8 0 01-16 0zM8 12h2l1-3 2 6 1-3h2"/></svg>
        <span>Stack health</span>
      </button>
      <button class="nav-btn" data-route="runbooks" type="button">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M4 4h12a2 2 0 012 2v14H6a2 2 0 01-2-2V4zM7 8h8M7 12h8M7 16h5"/></svg>
        <span>Runbooks</span>
      </button>
      <button class="nav-btn" data-route="sites" type="button">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M3 10l9-6 9 6v10a1 1 0 01-1 1h-4v-6H8v6H4a1 1 0 01-1-1V10z"/></svg>
        <span>Sites</span>
      </button>
      <button class="nav-btn" data-route="widget" type="button">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15a4 4 0 01-4 4H8l-5 3V8a4 4 0 014-4h10a4 4 0 014 4v7z"/></svg>
        <span>Widget preview</span>
      </button>
    </nav>

    <div class="nav-foot">
      <div class="foot-row">
        <span class="livedot"></span>
        <span class="foot-status">All systems · normal</span>
      </div>
      <div class="user-row">
        <div class="user-av">SJ</div>
        <div class="user-meta">
          <div class="user-name">Sam Jennings</div>
          <div class="user-role">Ops Director</div>
        </div>
        <button class="cog" type="button" aria-label="Settings">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 00.3 1.8l.1.1a2 2 0 11-2.8 2.8l-.1-.1a1.7 1.7 0 00-1.8-.3 1.7 1.7 0 00-1 1.5V21a2 2 0 11-4 0v-.1a1.7 1.7 0 00-1.1-1.5 1.7 1.7 0 00-1.8.3l-.1.1a2 2 0 11-2.8-2.8l.1-.1a1.7 1.7 0 00.3-1.8 1.7 1.7 0 00-1.5-1H3a2 2 0 110-4h.1a1.7 1.7 0 001.5-1.1 1.7 1.7 0 00-.3-1.8l-.1-.1a2 2 0 112.8-2.8l.1.1a1.7 1.7 0 001.8.3H9a1.7 1.7 0 001-1.5V3a2 2 0 114 0v.1a1.7 1.7 0 001 1.5 1.7 1.7 0 001.8-.3l.1-.1a2 2 0 112.8 2.8l-.1.1a1.7 1.7 0 00-.3 1.8V9a1.7 1.7 0 001.5 1H21a2 2 0 110 4h-.1a1.7 1.7 0 00-1.5 1z"/></svg>
        </button>
      </div>
    </div>
  </aside>

  <!-- Main column -->
  <main class="main">
    <header class="topbar">
      <div class="breadcrumbs">
        <span class="crumb-org">Pieminister Group</span>
        <svg width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="currentColor" stroke-width="1.5" class="crumb-sep"><path d="M3 2l3 3-3 3"/></svg>
        <span class="crumb-cur" id="crumbCur">Triage</span>
      </div>
      <div class="search">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="color:var(--fg-muted)"><circle cx="11" cy="11" r="7"/><path d="M21 21l-4-4"/></svg>
        <input placeholder="Search issues, sites, vendors&hellip; (⌘K)" id="globalSearch">
      </div>
      <div class="top-actions">
        <button class="icon-btn" type="button" aria-label="Notifications">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M18 8A6 6 0 106 8c0 7-3 9-3 9h18s-3-2-3-9M13.7 21a2 2 0 01-3.4 0"/></svg>
          <span class="bell-dot"></span>
        </button>
        <button class="invite-btn" type="button">Invite team</button>
      </div>
    </header>

    <div class="content" id="content">
      <div class="content-placeholder" id="placeholder" style="display:none">
        <div>
          <span id="placeholderRoute">Coming soon</span>
        </div>
      </div>
    </div>
  </main>
</div>

<script>
(function(){
  var ROUTES = {
    triage:   'Triage',
    issues:   'Issues',
    health:   'Stack health',
    runbooks: 'Runbooks',
    sites:    'Sites',
    widget:   'Widget preview'
  };
  // Sub-routes reached from Triage cards. Left nav collapses these under "Issues".
  var SUB_ROUTES = { issue: 'Issues', handoff: 'Issues' };

  function validRoute(r){ return !!(ROUTES[r] || SUB_ROUTES[r]); }

  function currentRoute(){
    var h = (location.hash || '').replace(/^#\\/?/, '');
    if (validRoute(h)) return h;
    var stored = localStorage.getItem('sc:route');
    if (stored && validRoute(stored)) return stored;
    return 'triage';
  }

  function setRoute(r){
    if (!validRoute(r)) r = 'triage';
    // Persist only top-level routes so a reload of a sub-route still
    // lands them somewhere sensible if they clear the hash.
    if (ROUTES[r]) localStorage.setItem('sc:route', r);
    if (location.hash !== '#' + r) location.hash = r;
    render(r);
  }

  function render(r){
    // Active state on nav buttons — sub-routes (issue/handoff) collapse under "Issues"
    var navKey = SUB_ROUTES[r] ? 'issues' : r;
    var btns = document.querySelectorAll('.nav-btn');
    for (var i = 0; i < btns.length; i++) {
      btns[i].classList.toggle('active', btns[i].getAttribute('data-route') === navKey);
    }
    // Breadcrumb label
    document.getElementById('crumbCur').textContent = ROUTES[r] || SUB_ROUTES[r];

    // Tear down previous screen state (intervals etc)
    if (window._screenTeardown) { try { window._screenTeardown(); } catch(_){} window._screenTeardown = null; }

    var content = document.getElementById('content');
    if (r === 'triage') {
      content.innerHTML = renderTriage();
      wireTriage();
    } else if (r === 'issue') {
      content.innerHTML = renderIssue();
      wireIssue();
    } else if (r === 'handoff') {
      content.innerHTML = renderHandoff();
      wireHandoff();
    } else if (r === 'health') {
      content.innerHTML = renderHealth();
      wireHealth();
    } else if (r === 'runbooks') {
      content.innerHTML = renderRunbooks();
      wireRunbooks();
    } else if (r === 'sites') {
      content.innerHTML = renderSites();
      wireSites();
    } else if (r === 'widget') {
      content.innerHTML = renderWidget();
    } else {
      content.innerHTML =
        '<div class="content-placeholder"><div>' +
        (ROUTES[r] || SUB_ROUTES[r]) + ' screen' +
        '<span>Lands in a later step</span>' +
        '</div></div>';
    }
  }

  // Expose so sub-render wiring can navigate
  window.scSetRoute = setRoute;

  // ─── TRIAGE SCREEN ────────────────────────────────────────────────────
  // Mock data mirrors triage.jsx exactly — swapped for real data in step 7.
  var SITES = [
    { id: 's1',  name: 'Soho, W1',          brand: 'The Pelican',    state: 'ok',       inc: null,                      score: 96 },
    { id: 's2',  name: 'Bristol, BS1',      brand: 'Pieminister',    state: 'critical', inc: 'Kitchen printer offline', score: 68 },
    { id: 's3',  name: 'Spitalfields, E1',  brand: 'Ottolenghi',     state: 'watch',    inc: 'Card retries elevated',   score: 82 },
    { id: 's4',  name: 'Camden, NW1',       brand: 'Honest Burgers', state: 'ok',       inc: null,                      score: 94 },
    { id: 's5',  name: 'Canary Wharf, E14', brand: "Carluccio's",    state: 'ok',       inc: null,                      score: 91 },
    { id: 's6',  name: 'Shoreditch, EC2',   brand: 'The Pelican',    state: 'critical', inc: "Dojo T2 won't connect",   score: 62 },
    { id: 's7',  name: 'Fitzrovia, W1T',    brand: 'Ottolenghi',     state: 'ok',       inc: null,                      score: 98 },
    { id: 's8',  name: 'Kings Cross, N1',   brand: 'Pieminister',    state: 'ok',       inc: null,                      score: 93 },
    { id: 's9',  name: 'Borough, SE1',      brand: 'The Pelican',    state: 'watch',    inc: 'WiFi latency > 120ms',    score: 79 },
    { id: 's10', name: 'Peckham, SE15',     brand: 'Honest Burgers', state: 'ok',       inc: null,                      score: 95 },
    { id: 's11', name: 'Clerkenwell, EC1',  brand: "Carluccio's",    state: 'ok',       inc: null,                      score: 89 },
    { id: 's12', name: 'Mayfair, W1S',      brand: 'Ottolenghi',     state: 'ok',       inc: null,                      score: 97 }
  ];

  var FEED = [
    ['17.58', 'Mayfair · Ottolenghi',        'Square till froze',         'Force-restart · 28s',         'ok'],
    ['17.24', 'Kings Cross · Pieminister',   'Planday clock-in error',    'Token refresh · 18s',         'ok'],
    ['16.02', 'Peckham · Honest Burgers',    'Deliveroo not pushing',     'Handed to Jo at Deliveroo',   'human'],
    ['14.41', "Clerkenwell · Carluccio's",   'SumUp reader unresponsive', 'Reset handshake · 52s',       'ok'],
    ['12.18', 'Fitzrovia · Ottolenghi',      'Printer paper path',        'Guided fix · 1m 12s',         'ok']
  ];

  var PIP_LABELS = ['EPOS','Pay','Net','Print','Rota','Del'];

  function esc(s){ return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); }

  function stateColor(state){ return state === 'critical' ? 'red' : state === 'watch' ? 'amber' : 'green'; }

  function pipColor(site, j){
    // Matches triage.jsx: critical sites flag Pay (j=1) and Print (j=3); watch flags Net (j=2).
    if (site.state === 'critical' && (j === 1 || j === 3)) return 'red';
    if (site.state === 'watch'    && j === 2)              return 'amber';
    return 'green';
  }

  function renderKpi(label, big, sub, tone){
    return '<div class="kpi">' +
      '<div class="kpi-label">' + esc(label) + '</div>' +
      '<div class="kpi-big' + (tone ? ' ' + tone : '') + '">' + esc(big) + '</div>' +
      '<div class="kpi-sub">' + esc(sub) + '</div>' +
    '</div>';
  }

  function renderActiveCrit(s, minutes){
    return '<button class="active-card" data-site="' + esc(s.id) + '" type="button">' +
      '<div class="active-head">' +
        '<span class="crit-badge" data-crit-timer>CRITICAL · ' + minutes + 'm</span>' +
        '<span class="active-site">' + esc(s.name) + '</span>' +
      '</div>' +
      '<div class="active-brand">' + esc(s.brand) + '</div>' +
      '<div class="active-inc">' + esc(s.inc) + '</div>' +
      '<div class="mini-prog"><div class="mini-prog-bar"></div></div>' +
      '<div class="active-foot"><span>Diagnosing&hellip;</span><span>Open chat →</span></div>' +
    '</button>';
  }

  function renderActiveWatch(s){
    return '<button class="active-card watch" data-site="' + esc(s.id) + '" type="button">' +
      '<div class="active-head">' +
        '<span class="crit-badge watch">WATCH</span>' +
        '<span class="active-site">' + esc(s.name) + '</span>' +
      '</div>' +
      '<div class="active-brand">' + esc(s.brand) + '</div>' +
      '<div class="active-inc watch">' + esc(s.inc) + '</div>' +
      '<div class="active-monitor">Monitoring · no action needed yet</div>' +
    '</button>';
  }

  function renderCell(s){
    var c = stateColor(s.state);
    var pulsing = s.state !== 'ok';
    var pips = '';
    for (var j = 0; j < PIP_LABELS.length; j++) {
      pips += '<span class="cell-pip ' + pipColor(s, j) + '" title="' + PIP_LABELS[j] + '"></span>';
    }
    return '<button class="cell ' + c + '" data-site="' + esc(s.id) + '" type="button">' +
      '<div class="cell-top">' +
        '<span class="cell-dot ' + c + (pulsing ? ' pulsing' : '') + '"></span>' +
        '<span class="cell-brand">' + esc(s.brand) + '</span>' +
      '</div>' +
      '<div class="cell-name">' + esc(s.name) + '</div>' +
      '<div class="cell-bar">' + pips + '</div>' +
      '<div class="cell-score">' +
        '<div class="cell-score-num ' + c + '">' + s.score + '</div>' +
        '<div class="cell-score-label">SCORE</div>' +
      '</div>' +
    '</button>';
  }

  function renderFeedRow(r){
    var tone = r[4]; // 'ok' | 'human'
    return '<div class="feed-row">' +
      '<span class="feed-pip ' + tone + '"></span>' +
      '<span class="feed-time">' + esc(r[0]) + '</span>' +
      '<span class="feed-site">' + esc(r[1]) + '</span>' +
      '<span class="feed-issue">' + esc(r[2]) + '</span>' +
      '<span class="feed-fix ' + tone + '">' + esc(r[3]) + '</span>' +
      '<button class="feed-open" type="button">View chart</button>' +
    '</div>';
  }

  function renderTriage(){
    var crit = SITES.filter(function(s){ return s.state === 'critical'; });
    var watch = SITES.filter(function(s){ return s.state === 'watch'; });
    var openCount = crit.length + watch.length;

    var activeHtml = '';
    if (openCount > 0) {
      var parts = [];
      for (var i = 0; i < crit.length; i++) parts.push(renderActiveCrit(crit[i], 2));
      for (var k = 0; k < watch.length; k++) parts.push(renderActiveWatch(watch[k]));
      activeHtml = '<div class="active-row">' + parts.join('') + '</div>';
    }

    var cellsHtml = '';
    for (var m = 0; m < SITES.length; m++) cellsHtml += renderCell(SITES[m]);

    var feedHtml = '';
    for (var n = 0; n < FEED.length; n++) feedHtml += renderFeedRow(FEED[n]);

    return '<div class="triage">' +
      // Header + KPI strip
      '<section class="triage-top">' +
        '<div>' +
          '<div class="eyebrow">Thursday · 21 April · 18.42 BST</div>' +
          '<h1 class="triage-h1">Evening Sam. <span class="accent">2 sites need a look.</span></h1>' +
          '<div class="triage-subhead">Rest of your estate is trading normally. Here\\'s what we\\'ve sorted and what\\'s still open.</div>' +
        '</div>' +
        '<div class="kpi-strip">' +
          renderKpi('Open', String(openCount), 'down 2 since 18.00') +
          renderKpi('AI-resolved today', '27', '96% first-pass', 'green') +
          renderKpi('Avg TTR', '41s', 'vs. 4m industry') +
          renderKpi('Saved to human', '£840', 'est. this week', 'orange') +
        '</div>' +
      '</section>' +

      // Active incidents row
      activeHtml +

      // Constellation grid (novel moment)
      '<section class="const-wrap">' +
        '<div class="const-head">' +
          '<div>' +
            '<div class="eyebrow">Your estate</div>' +
            '<h2 class="triage-h2">The stack constellation</h2>' +
          '</div>' +
          '<div class="legend">' +
            '<span><span class="legend-dot" style="background:var(--stacked-green-500)"></span>Healthy</span>' +
            '<span><span class="legend-dot" style="background:var(--stacked-amber-500)"></span>Watch</span>' +
            '<span><span class="legend-dot" style="background:var(--stacked-red-500)"></span>Critical</span>' +
          '</div>' +
        '</div>' +
        '<div class="const-grid">' + cellsHtml + '</div>' +
      '</section>' +

      // Resolved feed
      '<section class="feed-wrap">' +
        '<div class="feed-head">' +
          '<div>' +
            '<div class="eyebrow">Today · resolved</div>' +
            '<h2 class="triage-h2">Things we already sorted</h2>' +
          '</div>' +
          '<button class="ghost-btn" type="button">See all 27 →</button>' +
        '</div>' +
        '<div class="feed">' + feedHtml + '</div>' +
      '</section>' +
    '</div>';
  }

  function wireTriage(){
    // Emulate the prototype's 1200ms tick that drives the CRITICAL badge minutes.
    var tick = 0;
    var timer = setInterval(function(){
      tick++;
      var badges = document.querySelectorAll('[data-crit-timer]');
      for (var i = 0; i < badges.length; i++) {
        badges[i].textContent = 'CRITICAL · ' + (2 + (tick % 3)) + 'm';
      }
    }, 1200);

    // Click any site (active card or constellation cell) → route to #issue.
    // Real site id wiring lands in step 7 when we replace mock data.
    document.querySelectorAll('[data-site]').forEach(function(el){
      el.addEventListener('click', function(){ window.scSetRoute('issue'); });
    });

    window._screenTeardown = function(){ clearInterval(timer); };
  }

  // ─── ISSUE SCREEN ─────────────────────────────────────────────────────
  // Mock data mirrors issue.jsx exactly — swapped for real data in step 7.
  var ISSUE_STEPS = [
    { t: '18:40:12', label: 'Intake',       desc: 'Operator: "Card terminal at site 6 won\\'t connect. Dojo T2. Already rebooted."', state: 'done' },
    { t: '18:40:14', label: 'Identify',     desc: 'Matched: Dojo T2 pairing-loss (known issue KB-0412, 847 prior cases)',               state: 'done' },
    { t: '18:40:16', label: 'Ping vendor',  desc: 'Dojo status API → site 6 terminal registered, last seen 18:37:02',                   state: 'done' },
    { t: '18:40:18', label: 'Check net',    desc: 'Shoreditch WiFi reachable · 42ms · no loss',                                          state: 'done' },
    { t: '18:40:22', label: 'Propose fix',  desc: 'Unpair & re-pair sequence · confidence 94%',                                          state: 'active' },
    { t: '—',        label: 'Verify',       desc: 'Waiting for operator to confirm code entry',                                          state: 'idle' },
    { t: '—',        label: 'Discharge',    desc: '',                                                                                    state: 'idle' }
  ];

  function renderTimelinePin(step, index, scrub){
    var done = step.state === 'done';
    var cur  = step.state === 'active';
    var base = done ? 'done' : cur ? 'cur' : 'idle';
    var classes = 'tl-pin ' + base + (index === scrub ? ' scrubbed' : '');
    var inner;
    if (done)      inner = '<span class="tl-check">✓</span>';
    else if (cur)  inner = '<span class="tl-bullet">●</span>';
    else           inner = '<span class="tl-num">' + (index + 1) + '</span>';
    return '<button class="tl-step" data-step="' + index + '" type="button">' +
      '<div class="' + classes + '">' + inner + '</div>' +
      '<div class="tl-label">' + esc(step.label) + '</div>' +
      '<div class="tl-time">' + esc(step.t) + '</div>' +
    '</button>';
  }

  function renderBotMsg(innerHtml, isCard){
    return '<div class="cm">' +
      '<div class="bot-av"><img src="https://raw.githubusercontent.com/TOT-STACKED/toast-support-bot/main/bowls-orange.svg" alt=""></div>' +
      '<div class="cm-stack">' +
        '<div class="' + (isCard ? 'bub-card' : 'bub-b') + '">' + innerHtml + '</div>' +
      '</div>' +
    '</div>';
  }

  function renderOpMsg(name, text){
    return '<div class="cm op">' +
      '<div class="cm-stack">' +
        (name ? '<div class="cm-name">' + esc(name) + '</div>' : '') +
        '<div class="bub-u">' + esc(text) + '</div>' +
      '</div>' +
    '</div>';
  }

  function renderIssue(){
    // Default scrub = 4 (the 'active' step — Propose fix). Matches prototype.
    var scrub = 4;

    var pins = '';
    for (var i = 0; i < ISSUE_STEPS.length; i++) {
      pins += renderTimelinePin(ISSUE_STEPS[i], i, scrub);
    }

    var evidenceCard =
      '<div class="ev-label">Evidence · Dojo status API</div>' +
      '<div class="ev-list">' +
        '<div class="ok">✓ terminal.registered = true</div>' +
        '<div class="ok">✓ last_seen = 18:37:02 (3m ago)</div>' +
        '<div class="warn">⚠ paired_handset = null</div>' +
      '</div>';

    var fixCard =
      '<div class="fix-title">Re-pair the T2</div>' +
      '<ol class="fix-steps">' +
        '<li>On the handset: <b>Menu → Settings → Re-pair</b></li>' +
        '<li>Enter the 4-digit code below</li>' +
        '<li>Hold for 5 seconds — it\\'ll beep twice</li>' +
      '</ol>' +
      '<div class="pair-code">' +
        '<div>' +
          '<div class="pair-label">Pairing code</div>' +
          '<div class="pair-num" id="pairNum">7 4 2 9</div>' +
        '</div>' +
        '<button class="copy-code" id="copyCodeBtn" type="button">Copy code</button>' +
      '</div>' +
      '<div class="fix-note">94% of similar cases resolved in &lt; 60s with this fix.</div>';

    return '<div class="issue">' +
      // Header
      '<section class="iss-head">' +
        '<button class="iss-back" id="issBack" type="button">← Back to Triage</button>' +
        '<div class="iss-meta">' +
          '<div class="iss-meta-row">' +
            '<span class="live-badge">LIVE · 2m 14s</span>' +
            '<h1 class="iss-h1">Dojo T2 won\\'t connect</h1>' +
          '</div>' +
          '<div class="iss-sub">The Pelican · Shoreditch EC2 · case #INC-20260421-14 · opened 18:40 BST</div>' +
        '</div>' +
        '<div class="iss-actions">' +
          '<button class="act-ghost" type="button">Copy to WhatsApp</button>' +
          '<button class="act-ghost" type="button">Assign team member</button>' +
          '<button class="act-primary" id="issHandoff" type="button">Hand off to human →</button>' +
        '</div>' +
      '</section>' +

      // Timeline scrubber (novel moment #2)
      '<section class="tl">' +
        '<div class="tl-head">' +
          '<div class="tl-head-label">Diagnostic timeline · scrub to inspect any step</div>' +
          '<div class="tl-head-count" id="tlCount">step ' + (scrub + 1) + ' / ' + ISSUE_STEPS.length + '</div>' +
        '</div>' +
        '<div class="tl-track">' +
          pins +
          '<div class="tl-line"></div>' +
        '</div>' +
        '<div class="tl-detail">' +
          '<div class="tl-detail-eyebrow" id="tlDetailHead">' + esc(ISSUE_STEPS[scrub].t) + ' · ' + esc(ISSUE_STEPS[scrub].label) + '</div>' +
          '<div class="tl-detail-body" id="tlDetailBody">' + esc(ISSUE_STEPS[scrub].desc || 'Not reached yet.') + '</div>' +
        '</div>' +
      '</section>' +

      // Body: conversation + context rail
      '<section class="iss-body">' +
        '<div class="conv">' +
          renderOpMsg('Sam · Ops', "Card terminal at site 6 won't connect. Dojo T2. Already rebooted.") +
          renderBotMsg("Got it. Running the diagnostic — Dojo T2 pairing, Shoreditch EC2. I\\'ll check the vendor first.", false) +
          renderBotMsg(evidenceCard, true) +
          renderBotMsg("Terminal\\'s online — the handset just lost its pairing. Here\\'s the fix:", false) +
          renderBotMsg(fixCard, true) +
          '<div class="compose">' +
            '<input placeholder="Type a reply or describe a new issue…">' +
            '<button class="act-ghost" type="button">Mark fixed ✓</button>' +
            '<button class="send-btn" type="button">Send →</button>' +
          '</div>' +
        '</div>' +

        '<aside class="rail">' +
          '<div class="rail-block">' +
            '<div class="rail-label">Site context</div>' +
            '<div class="rail-title">The Pelican</div>' +
            '<div class="rail-sub">Shoreditch EC2 · trading now · 42 covers</div>' +
            '<div class="rail-kv"><span>Opened</span><b>11.00</b></div>' +
            '<div class="rail-kv"><span>GM on duty</span><b>Lara K.</b></div>' +
            '<div class="rail-kv"><span>Cover</span><b>Tonight · 180</b></div>' +
            '<div class="rail-kv"><span>Tech score</span><b class="amber">62 / 100</b></div>' +
          '</div>' +
          '<div class="rail-block">' +
            '<div class="rail-label">Same site · last 7 days</div>' +
            '<div style="display:grid;gap:4px">' +
              '<div class="rail-iss"><span class="rail-pip ok"></span><span class="rail-day">Wed</span><span class="rail-issue-text">Square till froze</span></div>' +
              '<div class="rail-iss"><span class="rail-pip human"></span><span class="rail-day">Mon</span><span class="rail-issue-text">Deliveroo push failed</span></div>' +
              '<div class="rail-iss"><span class="rail-pip ok"></span><span class="rail-day">Sun</span><span class="rail-issue-text">WiFi dropout</span></div>' +
            '</div>' +
          '</div>' +
          '<div class="rail-block">' +
            '<div class="rail-label">Runbook · KB-0412</div>' +
            '<div class="rail-runbook-title">Dojo T2 pairing loss</div>' +
            '<div class="rail-runbook-body">Most common after firmware update. Re-pair usually fixes it. If third attempt fails — it\\'s the Bluetooth module.</div>' +
            '<button class="act-ghost rail-runbook-open" type="button">Open full runbook →</button>' +
          '</div>' +
        '</aside>' +
      '</section>' +
    '</div>';
  }

  function wireIssue(){
    // Back → triage
    var back = document.getElementById('issBack');
    if (back) back.addEventListener('click', function(){ window.scSetRoute('triage'); });

    // Hand off → handoff screen (step 5 placeholder for now)
    var ho = document.getElementById('issHandoff');
    if (ho) ho.addEventListener('click', function(){ window.scSetRoute('handoff'); });

    // Scrubber: click any pin to update detail panel + scrubbed class
    var scrub = 4;
    var track = document.querySelector('.tl-track');
    if (track) {
      track.addEventListener('click', function(e){
        var btn = e.target.closest('.tl-step');
        if (!btn) return;
        var idx = parseInt(btn.getAttribute('data-step'), 10);
        if (isNaN(idx) || idx === scrub) return;
        // Update scrubbed class on all pins (cheap — 7 nodes)
        var pins = track.querySelectorAll('.tl-pin');
        for (var i = 0; i < pins.length; i++) {
          pins[i].classList.toggle('scrubbed', i === idx);
          // done pin check color swaps depending on scrub — CSS handles it via .done.scrubbed
        }
        scrub = idx;
        var step = ISSUE_STEPS[idx];
        document.getElementById('tlCount').textContent = 'step ' + (idx + 1) + ' / ' + ISSUE_STEPS.length;
        document.getElementById('tlDetailHead').textContent = step.t + ' · ' + step.label;
        document.getElementById('tlDetailBody').textContent = step.desc || 'Not reached yet.';
      });
    }

    // Copy pairing code to clipboard
    var copyBtn = document.getElementById('copyCodeBtn');
    if (copyBtn) {
      copyBtn.addEventListener('click', function(){
        var code = (document.getElementById('pairNum').textContent || '').replace(/\\s+/g, '');
        if (navigator.clipboard && code) {
          navigator.clipboard.writeText(code).then(function(){
            var orig = copyBtn.textContent;
            copyBtn.textContent = 'Copied ✓';
            setTimeout(function(){ copyBtn.textContent = orig; }, 1400);
          });
        }
      });
    }
  }

  // ─── HANDOFF SCREEN — novel moment #3 ─────────────────────────────────
  var HO_RECIPIENTS = [
    { id: 'vendor', name: 'Jo Adewale · Dojo',    role: 'Payments · Tier-2 Support',    eta: '~ 4 min', tag: 'RECOMMENDED', kind: 'recommended', initials: 'JA' },
    { id: 'ops',    name: 'Marcus T. · your ops', role: 'Internal · on-shift now',      eta: '~ 1 min', tag: 'TEAM',        kind: 'team',        initials: 'MT' },
    { id: 'conc',   name: 'Stacked Concierge',    role: 'Chris & team · hospitality',   eta: '~ 8 min', tag: 'PAID',        kind: 'paid',        initials: 'SC' }
  ];

  var HO_STEPS = [
    'Intake · card terminal offline · Dojo T2',
    'Matched KB-0412 (847 prior)',
    'Dojo status API · terminal registered',
    'Shoreditch WiFi reachable · 42ms',
    'Proposed re-pair · code 7429',
    'Operator entered code · terminal did not acknowledge'
  ];

  function renderRecipient(o, i){
    var rec = (i === 0) ? ' recommended' : '';
    return '<button class="ho-opt' + rec + '" data-recipient="' + esc(o.id) + '" type="button">' +
      '<div class="ho-opt-top">' +
        '<div class="ho-av">' + esc(o.initials) + '</div>' +
        '<div class="ho-opt-meta">' +
          '<div class="ho-opt-name">' + esc(o.name) + '</div>' +
          '<div class="ho-opt-role">' + esc(o.role) + '</div>' +
        '</div>' +
        '<span class="ho-tag ' + o.kind + '">' + esc(o.tag) + '</span>' +
      '</div>' +
      '<div class="ho-opt-foot">' +
        '<span>Avg response <b>' + esc(o.eta) + '</b></span>' +
        '<span>Pick →</span>' +
      '</div>' +
    '</button>';
  }

  function renderHandoff(){
    var recipients = HO_RECIPIENTS.map(renderRecipient).join('');

    var chartRows = '';
    for (var i = 0; i < HO_STEPS.length; i++) {
      chartRows += '<div class="ho-row">' +
        '<span class="ho-row-glyph ok">✓</span>' +
        '<span class="ho-row-text">' + esc(HO_STEPS[i]) + '</span>' +
      '</div>';
    }

    return '<div class="ho">' +
      '<button class="ho-back" id="hoBack" type="button">← Back to issue</button>' +

      '<div>' +
        '<div class="eyebrow">Handoff · INC-20260421-14</div>' +
        '<h1 class="ho-h1">Pass the baton to a human.</h1>' +
        '<div class="ho-sub">The AI\\'s attached the full chart. Pick who takes over — the vendor\\'s on-call engineer, your own ops team, or Stacked\\'s concierge.</div>' +
      '</div>' +

      '<div class="ho-grid">' +
        // Recipients column
        '<div class="ho-options">' + recipients + '</div>' +

        // Attached chart column
        '<div class="ho-chart">' +
          '<div class="ho-chart-head">' +
            '<div class="eyebrow">Attached chart · read-only</div>' +
            '<div class="ho-chart-title">What the AI already tried</div>' +
          '</div>' +
          chartRows +
          '<div class="ho-hypothesis">' +
            '<span class="ho-row-glyph warn">!</span>' +
            '<span class="ho-row-text"><b>Hypothesis:</b> Bluetooth module on handset — Dojo will need to dispatch or remote-reset.</span>' +
          '</div>' +
          '<div class="ho-permit">' +
            '<label class="ho-check"><input type="checkbox" checked> Include operator name &amp; contact</label>' +
            '<label class="ho-check"><input type="checkbox" checked> Include site + vendor context</label>' +
            '<label class="ho-check"><input type="checkbox"> Allow recipient to see stack health score</label>' +
          '</div>' +
          '<button class="ho-send" id="hoSend" type="button">Send chart &amp; open thread →</button>' +
        '</div>' +
      '</div>' +
    '</div>';
  }

  function wireHandoff(){
    // Back → issue (not triage — the README says Issue/Handoff are a pair)
    var back = document.getElementById('hoBack');
    if (back) back.addEventListener('click', function(){ window.scSetRoute('issue'); });

    // Recipient click → highlight pick, update send button label so
    // the confirmation names the right recipient.
    var picked = HO_RECIPIENTS[0]; // default to recommended
    document.querySelectorAll('[data-recipient]').forEach(function(el){
      el.addEventListener('click', function(){
        var id = el.getAttribute('data-recipient');
        picked = HO_RECIPIENTS.find(function(x){ return x.id === id; }) || picked;
        // Move the green "recommended" border to the chosen card
        document.querySelectorAll('.ho-opt').forEach(function(c){ c.classList.remove('recommended'); });
        el.classList.add('recommended');
      });
    });

    // Send → confirm state
    var send = document.getElementById('hoSend');
    if (send) {
      send.addEventListener('click', function(){
        if (send.classList.contains('sent')) return;
        send.classList.add('sent');
        // Use just the first name for the confirmation ("Jo", "Marcus", or
        // "Stacked Concierge" which has no separator). Matches the prototype.
        var first = picked.name.split(' ')[0].replace(/·.*$/, '');
        send.textContent = '✓ Sent to ' + first + ' · awaiting reply';
      });
    }
  }

  // ─── HEALTH SCREEN ────────────────────────────────────────────────────
  // Mock data mirrors health.jsx verbatim — swapped for real data in step 7.
  var HEALTH_VENDORS = [
    { name: 'Dojo',       cat: 'Payments', score: 71, trend: -4,  incidents: 12 },
    { name: 'Square',     cat: 'EPOS',     score: 92, trend: 2,   incidents: 3 },
    { name: 'Deliveroo',  cat: 'Delivery', score: 64, trend: -11, incidents: 18 },
    { name: 'Planday',    cat: 'Rota',     score: 88, trend: 1,   incidents: 4 },
    { name: 'SumUp',      cat: 'Payments', score: 84, trend: 3,   incidents: 5 },
    { name: 'Lightspeed', cat: 'EPOS',     score: 79, trend: -2,  incidents: 7 },
    { name: 'Uber Eats',  cat: 'Delivery', score: 81, trend: 4,   incidents: 6 },
    { name: 'Xero',       cat: 'Finance',  score: 96, trend: 1,   incidents: 1 }
  ];

  var HEALTH_RECS = [
    { title: 'Deliveroo is costing you ~£1,240/mo',
      body:  'Push failures at Peckham + Camden are correlated with rush. Consider Uber Eats as primary there — their grade for burger-format sites in London is 91.',
      cta:   'Compare vendors' },
    { title: 'Two sites are out-of-spec on WiFi',
      body:  'Shoreditch EC2 + Borough SE1 see latency spikes when over 40 covers. Both run consumer BT Hubs. A Draytek swap would save roughly 14 incidents/mo.',
      cta:   'Open ticket with IT' },
    { title: 'Staff rota keeps breaking Planday on Mondays',
      body:  '5 of 8 Planday incidents this month were the same error at 09.00. Our runbook KB-0299 has a permanent fix — takes 4 minutes to apply.',
      cta:   'Apply across estate' }
  ];

  function scoreColor(s){ return s >= 90 ? 'green' : s >= 75 ? 'amber' : 'red'; }

  function heatLevel(r, c){
    // Deterministic seed matching the prototype so the heatmap renders
    // the same across reloads (and the same as the React version).
    var seed = (r * 31 + c * 7) % 13;
    return seed > 10 ? 3 : seed > 8 ? 2 : seed > 5 ? 1 : 0;
  }

  function renderHealth(){
    // Heatmap: 14 rows × 30 cols
    var heat = '';
    for (var r = 0; r < 14; r++) {
      var row = '<div class="hl-heat-row">' +
        '<div class="hl-heat-lbl">Site ' + String(r + 1).padStart(2, '0') + '</div>';
      for (var c = 0; c < 30; c++) {
        row += '<div class="hl-heat-cell l' + heatLevel(r, c) + '"></div>';
      }
      row += '</div>';
      heat += row;
    }

    // Vendor grade cards
    var vendors = '';
    for (var i = 0; i < HEALTH_VENDORS.length; i++) {
      var v = HEALTH_VENDORS[i];
      var tone = scoreColor(v.score);
      var trendCls = v.trend > 0 ? 'up' : 'down';
      var trendText = v.trend > 0 ? '▲ +' + v.trend : '▼ ' + v.trend;
      vendors += '<div class="hl-vcard">' +
        '<div class="hl-vtop">' +
          '<span class="hl-vcat">' + esc(v.cat) + '</span>' +
          '<span class="hl-vtrend ' + trendCls + '">' + trendText + '</span>' +
        '</div>' +
        '<div class="hl-vmid">' +
          '<div class="hl-vname">' + esc(v.name) + '</div>' +
          '<div class="hl-vscore ' + tone + '">' + v.score + '</div>' +
        '</div>' +
        '<div class="hl-vbar"><div class="hl-vbar-fill ' + tone + '" style="width:' + v.score + '%"></div></div>' +
        '<div class="hl-vfoot">' +
          '<span>' + v.incidents + ' incidents this month</span>' +
          '<button class="hl-drill" type="button">Drill →</button>' +
        '</div>' +
      '</div>';
    }

    // Recommendations
    var recs = '';
    for (var j = 0; j < HEALTH_RECS.length; j++) {
      var rec = HEALTH_RECS[j];
      recs += '<div class="hl-rec">' +
        '<div class="hl-rec-label">REC · 0' + (j + 1) + '</div>' +
        '<div class="hl-rec-title">' + esc(rec.title) + '</div>' +
        '<div class="hl-rec-body">' + esc(rec.body) + '</div>' +
        '<button class="hl-rec-btn" type="button">' + esc(rec.cta) + ' →</button>' +
      '</div>';
    }

    return '<div class="hl">' +
      // Header + overall score
      '<section class="hl-head">' +
        '<div>' +
          '<div class="eyebrow">Stack health · last 30 days</div>' +
          '<h1 class="hl-h1">Your tech stack, graded.</h1>' +
          '<div class="hl-sub">One honest score per vendor. Based on how often they break on <b>your</b> sites — not marketing.</div>' +
        '</div>' +
        '<div class="hl-overall">' +
          '<div class="hl-overall-label">Estate health</div>' +
          '<div class="hl-overall-num">82</div>' +
          '<div class="hl-overall-trend">▲ +3 vs. last month</div>' +
        '</div>' +
      '</section>' +

      // Incident heatmap
      '<section class="hl-panel">' +
        '<div class="hl-panel-head">' +
          '<div class="hl-panel-title">Incident heatmap</div>' +
          '<div class="hl-panel-meta">Rows = your 14 sites · Columns = last 30 days</div>' +
        '</div>' +
        '<div class="hl-heat">' + heat + '</div>' +
        '<div class="hl-heat-foot">' +
          '<span>← 30d ago</span>' +
          '<div class="hl-heat-legend">Fewer' +
            '<span class="sw" style="background:rgba(59,211,111,0.18)"></span>' +
            '<span class="sw" style="background:rgba(245,165,36,0.35)"></span>' +
            '<span class="sw" style="background:rgba(245,165,36,0.75)"></span>' +
            '<span class="sw" style="background:var(--stacked-red-500)"></span>' +
          'More</div>' +
          '<span>today →</span>' +
        '</div>' +
      '</section>' +

      // Vendor grades
      '<section class="hl-panel">' +
        '<div class="hl-panel-head">' +
          '<div class="hl-panel-title">Vendor grades</div>' +
          '<div class="hl-panel-meta">Based on your estate, your shifts, your customers.</div>' +
        '</div>' +
        '<div class="hl-vgrid">' + vendors + '</div>' +
      '</section>' +

      // Recommendations
      '<section class="hl-panel">' +
        '<div class="hl-panel-head">' +
          '<div class="hl-panel-title">What we\\'d change</div>' +
          '<div class="hl-panel-meta">3 recommendations · auto-generated from your incident data</div>' +
        '</div>' +
        recs +
      '</section>' +
    '</div>';
  }

  function wireHealth(){
    // No heavy interactions in v1. Drill buttons are placeholders.
  }

  // ─── RUNBOOKS SCREEN ──────────────────────────────────────────────────
  var RB_CATS = ['All', 'Payments', 'EPOS', 'Delivery', 'Rota', 'Network', 'Finance'];
  var RB_BOOKS = [
    { id: 'KB-0412', title: 'Dojo T2 pairing loss',              cat: 'Payments', uses: 847,  rate: 94, desc: 'Most common after firmware update. Re-pair sequence usually fixes it.' },
    { id: 'KB-0299', title: 'Planday Monday 09.00 auth fail',    cat: 'Rota',     uses: 412,  rate: 99, desc: 'Known token-refresh race. Apply once per site, stays fixed.' },
    { id: 'KB-0503', title: 'Deliveroo push backlog',            cat: 'Delivery', uses: 318,  rate: 72, desc: 'Queue a manual sync and confirm receipt ID. Vendor ticket if three strikes.' },
    { id: 'KB-0187', title: 'Square till frozen',                cat: 'EPOS',     uses: 1204, rate: 97, desc: 'Hard-close app, re-launch. If repeats — SD card near-full.' },
    { id: 'KB-0622', title: 'SumUp reader unresponsive',         cat: 'Payments', uses: 289,  rate: 88, desc: 'Reset handshake, then re-pair. Battery check at > 5 min idle.' },
    { id: 'KB-0099', title: 'WiFi latency > 120ms at cover',     cat: 'Network',  uses: 156,  rate: 64, desc: 'Usually the router. Move BT handsets off 2.4GHz.' }
  ];

  function rateColor(p){ return p >= 90 ? 'green' : p >= 75 ? 'amber' : 'red'; }

  function renderRunbookCard(b){
    var tone = rateColor(b.rate);
    return '<article class="rb-card" data-cat="' + esc(b.cat) + '">' +
      '<div class="rb-card-top">' +
        '<span class="rb-id">' + esc(b.id) + '</span>' +
        '<span class="rb-cat-tag">' + esc(b.cat) + '</span>' +
      '</div>' +
      '<div class="rb-title">' + esc(b.title) + '</div>' +
      '<div class="rb-desc">' + esc(b.desc) + '</div>' +
      '<div class="rb-stats">' +
        '<div><div class="rb-st-v">' + b.uses.toLocaleString() + '</div><div class="rb-st-l">USES</div></div>' +
        '<div><div class="rb-st-v ' + tone + '">' + b.rate + '%</div><div class="rb-st-l">FIRST-PASS</div></div>' +
        '<button class="rb-open" type="button">Open →</button>' +
      '</div>' +
    '</article>';
  }

  function renderRunbooks(){
    var chips = '';
    for (var i = 0; i < RB_CATS.length; i++) {
      chips += '<button class="rb-chip' + (i === 0 ? ' on' : '') + '" data-filter="' + esc(RB_CATS[i]) + '" type="button">' + esc(RB_CATS[i]) + '</button>';
    }

    var cards = RB_BOOKS.map(renderRunbookCard).join('');

    return '<div class="rb">' +
      '<section class="rb-head">' +
        '<div>' +
          '<div class="eyebrow">Runbook library · 142 entries</div>' +
          '<h1 class="rb-h1">Every fix we\\'ve ever learned.</h1>' +
          '<div class="rb-sub">Your AI reads these. So can you. Add your own — or edit ours.</div>' +
        '</div>' +
        '<button class="rb-add" type="button">＋ New runbook</button>' +
      '</section>' +

      '<div class="rb-filters">' +
        chips +
        '<div class="rb-spacer"></div>' +
        '<div class="rb-sort">Sort: Most used ▾</div>' +
      '</div>' +

      '<div class="rb-grid" id="rbGrid">' + cards + '</div>' +
    '</div>';
  }

  function wireRunbooks(){
    // Filter chips — client-side filter by category
    var filters = document.querySelectorAll('.rb-chip');
    var grid = document.getElementById('rbGrid');
    filters.forEach(function(chip){
      chip.addEventListener('click', function(){
        var target = chip.getAttribute('data-filter');
        filters.forEach(function(c){ c.classList.toggle('on', c === chip); });
        if (!grid) return;
        var cards = grid.querySelectorAll('.rb-card');
        for (var i = 0; i < cards.length; i++) {
          var cat = cards[i].getAttribute('data-cat');
          cards[i].style.display = (target === 'All' || cat === target) ? '' : 'none';
        }
      });
    });
  }

  // ─── SITES SCREEN ─────────────────────────────────────────────────────
  // Mock estate mirrors extras.jsx SitesScreen — swapped in step 7's data pass.
  var ST_ROWS = [
    ['Soho W1',          'The Pelican',     'Lara Kane',    'Square · Dojo · Deliveroo', 96, 0],
    ['Bristol BS1',      'Pieminister',     'Tom Hughes',   'Square · Dojo · Planday',   68, 1],
    ['Spitalfields E1',  'Ottolenghi',      'Priya Sharma', 'Lightspeed · SumUp',        82, 1],
    ['Camden NW1',       'Honest Burgers',  'Omar Nassar',  'Square · Dojo · Uber',      94, 0],
    ['Canary Wharf E14', "Carluccio's",     'Beth Ford',    'Lightspeed · SumUp',        91, 0],
    ['Shoreditch EC2',   'The Pelican',     'Lara Kane',    'Square · Dojo · Deliveroo', 62, 1],
    ['Fitzrovia W1T',    'Ottolenghi',      'Priya Sharma', 'Lightspeed · SumUp',        98, 0],
    ['Kings Cross N1',   'Pieminister',     'Tom Hughes',   'Square · Dojo · Planday',   93, 0]
  ];

  function renderSitesRow(siteName, brand, gm, stack, score, openCount){
    var tone = scoreColor(score);
    var issCls = openCount ? 'open' : 'clean';
    var issText = openCount ? '● ' + openCount + ' open' : '—';
    return '<div class="st-row st-body">' +
      '<span class="st-site">' + esc(siteName) + '</span>' +
      '<span class="st-brand">' + esc(brand || '—') + '</span>' +
      '<span class="st-gm">' + esc(gm || '—') + '</span>' +
      '<span class="st-stack">' + esc(stack || '—') + '</span>' +
      '<span class="st-score ' + tone + '">' + score + '</span>' +
      '<span class="st-iss ' + issCls + '">' + issText + '</span>' +
    '</div>';
  }

  var SITES_HEAD_ROW =
    '<div class="st-row st-head">' +
      '<span>Site</span>' +
      '<span>Brand</span>' +
      '<span>GM</span>' +
      '<span>Stack</span>' +
      '<span>Score</span>' +
      '<span>Issues</span>' +
    '</div>';

  function renderSites(){
    // Render mock rows as a placeholder that's immediately visible.
    // wireSites() swaps them for real data fetched from /analytics,
    // or leaves mocks in place if the fetch fails. Either way the
    // table never looks empty.
    var mockRows = '';
    for (var i = 0; i < ST_ROWS.length; i++) {
      var r = ST_ROWS[i];
      mockRows += renderSitesRow(r[0], r[1], r[2], r[3], r[4], r[5]);
    }

    return '<div class="st">' +
      '<section>' +
        '<div class="eyebrow" id="stEyebrow">Sites &middot; loading&hellip;</div>' +
        '<h1 class="st-h1">Your estate.</h1>' +
      '</section>' +
      '<div class="st-table" id="stTable">' +
        SITES_HEAD_ROW +
        mockRows +
      '</div>' +
    '</div>';
  }

  function wireSites(){
    var eyebrow = document.getElementById('stEyebrow');
    var table = document.getElementById('stTable');
    if (!table) return;

    fetch('/analytics').then(function(r){ return r.json(); }).then(function(data){
      if (!data || data.error) throw new Error(data && data.error || 'bad data');
      var venueStats = Array.isArray(data.venueStats) ? data.venueStats : [];
      var tickets = Array.isArray(data.tickets) ? data.tickets : [];

      // Open tickets per venue
      var openByVenue = {};
      for (var i = 0; i < tickets.length; i++) {
        var t = tickets[i];
        if (t.status === 'open') {
          var k = t.venue || 'Unknown venue';
          openByVenue[k] = (openByVenue[k] || 0) + 1;
        }
      }

      // Sort venues by activity so busiest sites are up top
      var venues = venueStats.slice().sort(function(a, b){
        return (b.convs || 0) - (a.convs || 0);
      });

      if (venues.length === 0) {
        // No real data yet — keep the mock rows and mark the eyebrow honestly.
        if (eyebrow) eyebrow.textContent = 'Sites · sample data (no venues yet)';
        return;
      }

      if (eyebrow) eyebrow.textContent = 'Sites · ' + venues.length + ' registered';

      var rowsHtml = SITES_HEAD_ROW;
      for (var j = 0; j < venues.length; j++) {
        var v = venues[j];
        var open = openByVenue[v.venue] || 0;
        // Simple health score until per-site telemetry exists:
        // 100 baseline, -10 per open ticket, -5 per escalated ticket, floor 10.
        var escalatedCount = v.escalated || 0;
        var score = Math.max(10, 100 - (open * 10) - (escalatedCount * 5));
        // Brand/GM/Stack aren't captured in the venues schema yet — show
        // em-dashes so the column shape is preserved for when they land.
        rowsHtml += renderSitesRow(v.venue || '—', null, null, null, score, open);
      }
      table.innerHTML = rowsHtml;
    }).catch(function(err){
      // Network / API failure — leave the mock rows and tell the user what happened.
      console.error('[sites] could not load real data, showing sample:', err);
      if (eyebrow) eyebrow.textContent = 'Sites · sample data (live feed unavailable)';
    });
  }

  // ─── WIDGET PREVIEW SCREEN ────────────────────────────────────────────
  var WG_FEATURES = [
    'One line of JS on any page',
    'Auto-detects vendor context from the surrounding app',
    'Photo + voice input for messy bar situations',
    'Escalates to your ops team when the AI gets stuck'
  ];

  function renderWidget(){
    var features = '';
    for (var i = 0; i < WG_FEATURES.length; i++) {
      features += '<div class="wg-feat">' +
        '<span class="wg-feat-check">✓</span>' + esc(WG_FEATURES[i]) +
      '</div>';
    }

    return '<div class="wg">' +
      '<div class="wg-grid">' +
        // Left column — copy + install snippet
        '<div>' +
          '<div class="eyebrow">Widget preview · embed anywhere</div>' +
          '<h1 class="wg-h1">The chat that lives in your POS.</h1>' +
          '<div class="wg-sub">Your team doesn\\'t need to leave what they\\'re doing. Drop Stacked Chat into Square, Lightspeed, your intranet, or a bookmark on the GM\\'s phone. Same AI, same handoff, same runbooks — shrunk to pocket size.</div>' +
          '<div class="wg-features">' + features + '</div>' +
          '<div class="wg-snippet">' +
            '<div class="wg-snippet-label">Install</div>' +
            '<div class="wg-snippet-code">&lt;script src="stacked.chat/embed.js" data-key="pm_live_a14k92"&gt;&lt;/script&gt;</div>' +
          '</div>' +
        '</div>' +

        // Right column — phone mockup
        '<div class="wg-phone-wrap">' +
          '<div class="wg-phone">' +
            '<div class="wg-notch"></div>' +
            '<div class="wg-sb">' +
              '<span>18:42</span>' +
              '<span class="wg-sb-right"><span>●●●●</span><span>5G</span></span>' +
            '</div>' +
            '<div class="wg-hdr">' +
              '<div class="wg-hdr-av"><img src="https://raw.githubusercontent.com/TOT-STACKED/toast-support-bot/main/bowls-orange.svg" alt=""></div>' +
              '<div>' +
                '<div class="wg-hdr-name">Stacked Chat</div>' +
                '<div class="wg-hdr-status">● online</div>' +
              '</div>' +
              '<span class="wg-hdr-close">✕</span>' +
            '</div>' +
            '<div class="wg-body">' +
              '<div class="wg-bub">Hey Lara 👋 I saw the Dojo error at 18:40. Try the fix I sent — tap here if it doesn\\'t work.</div>' +
              '<div class="wg-bubU">that fix didn\\'t take, the light\\'s still red</div>' +
              '<div class="wg-bub">Right — I\\'m looping Jo at Dojo. Keep trading, she\\'ll buzz in 4 min. Meanwhile tell card customers to use cash or tap-to-phone.</div>' +
              '<div class="wg-bub-card">' +
                '<div class="wg-card-label">ALTERNATE</div>' +
                '<div class="wg-card-title">Tap-to-phone fallback</div>' +
                '<div class="wg-card-body">Use your iPhone as a reader. I\\'ve sent the activation link to your email.</div>' +
              '</div>' +
            '</div>' +
            '<div class="wg-comp">' +
              '<span class="wg-comp-ph">Type a message…</span>' +
              '<div class="wg-send">→</div>' +
            '</div>' +
          '</div>' +
        '</div>' +
      '</div>' +
    '</div>';
  }

  // Wire nav clicks
  document.getElementById('navList').addEventListener('click', function(e){
    var btn = e.target.closest('.nav-btn');
    if (!btn) return;
    setRoute(btn.getAttribute('data-route'));
  });

  // Hash changes (back/forward)
  window.addEventListener('hashchange', function(){ render(currentRoute()); });

  // ⌘K / Ctrl-K focuses search
  window.addEventListener('keydown', function(e){
    if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
      e.preventDefault();
      document.getElementById('globalSearch').focus();
    }
  });

  // Boot
  var r = currentRoute();
  if (!location.hash) location.hash = r;
  render(r);
})();
</script>
</body>
</html>`;

// ─── ADMIN PAGE ────────────────────────────────────────────────────────────
const ADMIN_PAGE = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<link rel="icon" type="image/svg+xml" href="data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iNTYiIGhlaWdodD0iODgiIHZpZXdCb3g9IjAgMCA1NiA4OCIgZmlsbD0ibm9uZSIgeG1sbnM9Imh0dHA6Ly93d3cudzMub3JnLzIwMDAvc3ZnIj48cGF0aCBkPSJNNTUuNDE1MiA2Mi45OTM1QzU1LjQzMzQgNjYuNzMxNyA1NC45MDYxIDcwLjA4MDkgNTMuODQwNyA3My4wMzM2QzUyLjc3MTYgNzUuOTkgNTEuMTA5NyA3OC41MjQ2IDQ4Ljg1NTIgODAuNjQxQzQ2LjU5NyA4Mi43NTc0IDQzLjczNTEgODQuMzc5MiA0MC4yNjIzIDg1LjQ5OTJDMzYuNzg5NiA4Ni42MTkyIDMyLjY1NSA4Ny4xOTAyIDI3Ljg2MjIgODcuMjEyQzIzLjA2OTQgODcuMjMwMiAxOC45MTY2IDg2LjY5NTYgMTUuNDExMSA4NS42MDQ3QzExLjkwMiA4NC41MTM4IDkuMDI1NjEgODIuOTE3NCA2Ljc3ODMxIDgwLjgxOTJDNC41MzEwMSA3OC43MjQ2IDIuODU4MjYgNzYuMjAwOSAxLjc2NzM0IDczLjI1NTRDMC42NzY0MjEgNzAuMzEgMC4xMjAwNTEgNjYuOTY4MSAwLjEwNTUwNiA2My4yMjk5TDQuOTgxNDVlLTA1IDQ5Ljk4NjFDLTAuMDA3MjIzIDQ4LjQwNDMgMC43ODE4NzcgNDcuNjExNSAyLjM2MDA4IDQ3LjYwNDJMMTEuOTA1NiA0Ny41NjQyQzEyLjUwOTMgNDguMTYwNiAxMy4xNzExIDQ4LjcwNjEgMTMuODgwMiA0OS4yMDQzQzE1Ljg2OTMgNTAuNTk3IDE4LjI5ODQgNTEuNTI3OSAyMS4xNjc2IDUxLjk5N0MyNC4wMzMxIDUyLjQ2MjUgMjcuMzQyMiA1Mi40MjYxIDMxLjA5MTMgNTEuODgwN0MzNC44NDQxIDUxLjMzNTIgMzguMDE1IDUwLjQzMzQgNDAuNjExNCA0OS4xNzE1QzQxLjY4NzggNDguNjQ3OSA0Mi42NzMzIDQ4LjA2NjEgNDMuNTY3OCA0Ny40Mjk3TDUyLjkzMTYgNDcuMzg5N0M1NC41MTM0IDQ3LjM4MjQgNTUuMzA2MSA0OC4xNjc5IDU1LjMxMzQgNDkuNzQ5N0w1NS40MTUyIDYyLjk5MzVaIiBmaWxsPSIjRTY1NDNBIi8+PHBhdGggZD0iTTQzLjU2OTQgNDcuNDMwN0M0Mi42NzQ4IDQ4LjA2NyA0MS42ODk0IDQ4LjY0ODkgNDAuNjEzIDQ5LjE3MjVDMzguMDE2NiA1MC40MzQzIDM0Ljg0NTcgNTEuMzM2MiAzMS4wOTI5IDUxLjg4MTZDMjcuMzQzOCA1Mi40MjcxIDI0LjAzNDYgNTIuNDYzNCAyMS4xNjkyIDUxLjk5OEMxOC4zIDUxLjUyODkgMTUuODcwOSA1MC41OTggMTMuODgxOCA0OS4yMDUyQzEzLjE3MjcgNDguNzA3IDEyLjUxMDkgNDguMTYxNiAxMS45MDcyIDQ3LjU2NTJMNDMuNTY5NCA0Ny40MzA3WiIgZmlsbD0iI0I3MzUxRiIvPjxwYXRoIGQ9Ik00OS44NjA5IDM3LjkxNjVDNDkuMzUxOCA0MC4zNDU3IDQ4LjMzIDQyLjUxMyA0Ni43OTkxIDQ0LjQyMjFDNDUuOTAwOSA0NS41MzQ4IDQ0LjgyNDUgNDYuNTM4NSA0My41NjYzIDQ3LjQyOTRMMTEuOTA0MSA0Ny41NjM5QzEwLjgwNTkgNDYuNDgzOSA5Ljg3ODYzIDQ1LjI0MDMgOS4xMjIyNiA0My44MzY2QzcuOTQwNDMgNDEuNjQ3NSA3LjEzNjc4IDM5LjA5NDcgNi43MTQ5NiAzNi4xNjc0TDUuMTY5NDkgMjUuODEwOUM0Ljk5MTMgMjQuNTc0NiA1LjUxODU4IDIzLjg2NTUgNi43NTQ5NiAyMy42ODczTDEyLjI2NDEgMjIuODg3M0MxMy4xMjIzIDIzLjUyMzYgMTQuMTAwNSAyNC4wODczIDE1LjE5MTQgMjQuNTc4MkMxNy4yODYgMjUuNTIgMTkuODIwNiAyNi4xNjM3IDIyLjc5ODggMjYuNTEyOEMyNS43NzM0IDI2Ljg1ODIgMjguMzgwNyAyNi44MTQ2IDMwLjYyMDcgMjYuMzgxOUMzMi44NjA3IDI1Ljk0NTUgMzQuNzU4OSAyNS4xNTY0IDM2LjMxODkgMjQuMDE0NkMzNy44NzUzIDIyLjg2OTEgMzkuMDk3MiAyMS40MjE4IDM5Ljk4NDQgMTkuNjY5MUM0MC4xMjYzIDE5LjM4NTQgNDAuMjYwOCAxOS4wOTgxIDQwLjM4MDggMTguOEw0Ni4zMjI3IDE3LjkzODFDNDcuNTU5MSAxNy43NTYzIDQ4LjI2NDUgMTguMjg3MiA0OC40NDY0IDE5LjUyMzZMNDkuOTg4MiAyOS44ODAxQzUwLjQxMzYgMzIuODAzNyA1MC4zNyAzNS40ODM4IDQ5Ljg2MDkgMzcuOTE2NVoiIGZpbGw9IiNFNjU0M0EiLz48cGF0aCBkPSJNNDAuMzgxMyAxOC44MDA4QzQwLjI2MTMgMTkuMDk5IDQwLjEyNjggMTkuMzg2MiAzOS45ODUgMTkuNjY5OUMzOS4wOTc3IDIxLjQyMjYgMzcuODc1OSAyMi44Njk5IDM2LjMxOTUgMjQuMDE1NEMzNC43NTk1IDI1LjE1NzIgMzIuODYxMyAyNS45NDYzIDMwLjYyMTIgMjYuMzgyN0MyOC4zODEyIDI2LjgxNTQgMjUuNzczOSAyNi44NTkxIDIyLjc5OTMgMjYuNTEzNkMxOS44MjExIDI2LjE2NDUgMTcuMjg2NSAyNS41MjA5IDE1LjE5MiAyNC41NzlDMTQuMTAxIDI0LjA4ODEgMTMuMTIyOCAyMy41MjQ1IDEyLjI2NDYgMjIuODg4MUw0MC4zODEzIDE4LjgwMDhaIiBmaWxsPSIjQjczNTFGIi8+PHBhdGggZD0iTTQyLjY1MDQgNS4zMzEyOEw0MS43MTk0IDEzLjU1NjhDNDEuNDkwNCAxNS41MDU5IDQxLjA0NjcgMTcuMjU1MSA0MC4zODEyIDE4LjgwMDVMMTIuMjY0NiAyMi44ODc5QzExLjQ3OTEgMjIuMzA2IDEwLjc4ODIgMjEuNjYyNCAxMC4xOTU0IDIwLjk2MDZDOC45NTkwNyAxOS40OTE0IDguMTExNzggMTcuODAwNSA3LjY1MzYgMTUuODkxNEM3LjE5OTA1IDEzLjk3ODcgNy4xMDgxMyAxMS44NjU5IDcuMzc3MjMgOS41NDIyNEw4LjMwODE1IDEuMzE2NjlDOC40MjQ1MSAwLjMzNDg2MiA4Ljk3MzYxIC0wLjA5Nzg2OTkgOS45NTE4IDAuMDE4NDk1MUw0MS4zNDg1IDMuNjg3NjNDNDIuMzMwNCAzLjgwMDM2IDQyLjc2MzEgNC4zNDk0NSA0Mi42NTA0IDUuMzMxMjhaIiBmaWxsPSIjRTY1NDNBIi8+PC9zdmc+Cg==">
<title>Stacked Chat &mdash; Admin</title>
<script src="https://cdnjs.cloudflare.com/ajax/libs/Chart.js/4.4.1/chart.umd.min.js"></script>
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family=Fraunces:opsz,wght@9..144,500;9..144,600;9..144,700;9..144,800;9..144,900&family=Geist:wght@400;500;600;700;800&family=Geist+Mono:wght@400;500;600&display=swap" rel="stylesheet">
<style>
*,*::before,*::after{box-sizing:border-box;margin:0;padding:0}
:root{
  /* Legacy admin tokens (light theme) */
  --blue:#E8573C;--bg:#EDEBE5;--surface:#ffffff;--surface2:#F5F3EF;--border:#D6D2C8;--border2:#C8C4BA;--text:#1A1A1A;--text2:#6B6867;--text3:#A8A49C;--green:#16a34a;--red:#dc2626;
  /* Stacked design-system tokens — see colors_and_type.css */
  --ink-900:#0A0A0A;--ink-800:#131313;--ink-700:#1D1D1D;
  --fg:#F4EFE6;--fg-muted:#928A7C;--fg-dim:#555048;
  --stacked-orange-500:#E87830;--stacked-orange-700:#A34F15;
  --stacked-green-500:#3BD36F;--stacked-green-700:#1E8A44;
  --stacked-amber-500:#F5A524;--stacked-red-500:#E5484D;
  --stacked-purple-500:#C7B3F2;--stacked-purple-700:#1D1340;
  --font-sans:'Geist',ui-sans-serif,system-ui,sans-serif;
  --font-display:'Fraunces','Fraunces Placeholder',ui-serif,Georgia,serif;
  --font-mono:'Geist Mono',ui-monospace,'SF Mono',monospace;
  --ease:cubic-bezier(0.2,0.8,0.2,1);
}
body{background:var(--bg);font-family:'Inter',system-ui,sans-serif;color:var(--text);font-size:14px;line-height:1.5;min-height:100vh}
header{background:var(--surface);border-bottom:1px solid var(--border);height:56px;display:flex;align-items:center;justify-content:space-between;padding:0 24px;position:sticky;top:0;z-index:100}
.header-left{display:flex;align-items:center;gap:16px}
.wordmark{height:32px;max-width:200px;object-fit:contain;filter: brightness(0) saturate(100%) invert(44%) sepia(73%) saturate(700%) hue-rotate(334deg) brightness(107%);}
.divider{width:1px;height:20px;background:var(--border2)}
.header-nav{display:flex;align-items:center;gap:2px}
.nav-item{padding:5px 10px;border-radius:6px;font-size:13px;font-weight:500;color:var(--text2);cursor:pointer;border:none;background:none;font-family:inherit;transition:all 0.1s}
.nav-item:hover{background:var(--surface2);color:var(--text)}
.nav-item.active{background:var(--surface2);color:var(--text);font-weight:600}
.nav-divider{width:1px;height:16px;background:var(--border2);margin:0 4px}
.sub-tab-bar{display:flex;gap:4px;margin:16px 0 20px;border-bottom:1px solid var(--border);padding-bottom:0}
.sub-tab{padding:7px 14px;border-radius:6px 6px 0 0;font-size:13px;font-weight:500;color:var(--text2);cursor:pointer;border:1px solid transparent;border-bottom:none;background:none;font-family:inherit;transition:all 0.1s;margin-bottom:-1px}
.sub-tab:hover{color:var(--text);background:var(--surface2)}
.sub-tab.active{background:var(--surface);color:var(--text);font-weight:600;border-color:var(--border);border-bottom-color:var(--surface)}
.header-right{display:flex;align-items:center;gap:10px}
.update-text{font-size:12px;color:var(--text3)}
.btn{display:inline-flex;align-items:center;gap:6px;padding:6px 12px;border-radius:6px;font-size:13px;font-weight:500;cursor:pointer;border:1px solid var(--border2);background:var(--surface);color:var(--text2);font-family:inherit;transition:all 0.1s}
.btn:hover{border-color:var(--blue);color:var(--blue)}
.btn-primary{background:var(--blue);color:#fff;border-color:var(--blue)}
.btn-primary:hover{background:#0d8ae6;border-color:#0d8ae6;color:#fff}
.container{max-width:1280px;margin:0 auto;padding:24px}
.page-header{margin-bottom:20px;display:flex;align-items:center;justify-content:space-between}
.page-title{font-size:18px;font-weight:600;color:var(--text)}
.page-sub{font-size:13px;color:var(--text3);margin-top:2px}
.tab-panel{display:none}.tab-panel.active{display:block}
.kpi-grid{display:grid;grid-template-columns:repeat(4,1fr);gap:16px;margin-bottom:20px}
.kpi{background:var(--surface);border:1px solid var(--border);border-radius:8px;padding:16px 20px}
.kpi-label{font-size:12px;font-weight:500;color:var(--text3);text-transform:uppercase;letter-spacing:0.05em;margin-bottom:6px}
.kpi-value{font-size:28px;font-weight:700;color:var(--text);line-height:1;letter-spacing:-0.5px}
.grid-2{display:grid;grid-template-columns:1fr 1fr;gap:16px;margin-bottom:16px}
@media(max-width:900px){.grid-2,.kpi-grid{grid-template-columns:1fr}}
.card{background:var(--surface);border:1px solid var(--border);border-radius:8px;padding:20px}
.card-header{display:flex;align-items:center;justify-content:space-between;margin-bottom:16px;padding-bottom:12px;border-bottom:1px solid var(--border)}
.card-title{font-size:13px;font-weight:600;color:var(--text)}
.card-meta{font-size:12px;color:var(--text3)}
.data-row{display:flex;align-items:center;gap:12px;padding:8px 0;border-bottom:1px solid var(--border)}
.data-row:last-child{border-bottom:none}
.rank{font-size:11px;font-weight:600;color:var(--text3);width:20px;flex-shrink:0;text-align:right}
.rank.hi{color:var(--blue)}
.data-label{font-size:13px;font-weight:500;color:var(--text);flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;text-transform:capitalize}
.bar-outer{width:80px;height:4px;background:var(--surface2);border-radius:2px;overflow:hidden;flex-shrink:0}
.bar-inner{height:100%;border-radius:2px;background:var(--blue);transition:width 0.6s ease}
.bar-inner.alt{background:#64748b}
.data-count{font-size:12px;font-weight:600;color:var(--text2);width:24px;text-align:right;flex-shrink:0}
.chart-wrap{position:relative;height:200px}
table{width:100%;border-collapse:collapse;font-size:13px}
thead tr{border-bottom:1px solid var(--border)}
th{text-align:left;padding:8px 12px;font-size:11px;font-weight:600;color:var(--text3);text-transform:uppercase;letter-spacing:0.05em;white-space:nowrap}
td{padding:10px 12px;border-bottom:1px solid var(--border);color:var(--text2);vertical-align:top}
tr:last-child td{border-bottom:none}
tbody tr:hover td{background:var(--surface2)}
.td-primary{color:var(--text);font-weight:500}
.td-muted{font-size:12px;color:var(--text3);margin-top:2px}
.td-truncate{max-width:240px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.badge{display:inline-flex;align-items:center;padding:2px 8px;border-radius:4px;font-size:11px;font-weight:600;letter-spacing:0.02em}
.badge.open{background:#fef3c7;color:#92400e;border:1px solid #fde68a}
.badge.closed{background:#dcfce7;color:#166534;border:1px solid #bbf7d0}
.badge.escalated{background:#fee2e2;color:#991b1b;border:1px solid #fca5a5}
.close-btn{padding:4px 10px;font-size:11px;font-weight:600;border-radius:4px;border:1px solid var(--green);color:var(--green);background:none;cursor:pointer;font-family:inherit;transition:all 0.1s}
.close-btn:hover{background:var(--green);color:#fff}
.filter-bar{display:flex;align-items:center;gap:8px;margin-bottom:16px;flex-wrap:wrap}
.filter-btn{padding:5px 12px;border-radius:6px;font-size:12px;font-weight:600;cursor:pointer;border:1px solid var(--border2);background:var(--surface);color:var(--text2);font-family:inherit;transition:all 0.1s}
.filter-btn:hover{border-color:var(--blue);color:var(--blue)}
.filter-btn.active{background:var(--blue);color:#fff;border-color:var(--blue)}
.filter-btn.red-active.active{background:var(--red);border-color:var(--red)}
.kpi.red .kpi-value{color:var(--red)}
.conv-thread{display:none;margin-top:8px;background:var(--surface2);border:1px solid var(--border);border-radius:8px;padding:10px;max-height:240px;overflow-y:auto}
.conv-item.open .conv-thread{display:block}
.conv-item{cursor:pointer;padding:10px 0;border-bottom:1px solid var(--border)}
.conv-item:last-child{border-bottom:none}
.thread-msg{display:flex;gap:8px;margin-bottom:8px}
.thread-msg:last-child{margin-bottom:0}
.thread-role{font-size:10px;font-weight:700;text-transform:uppercase;color:var(--text3);width:44px;flex-shrink:0;padding-top:2px}
.thread-role.user{color:var(--blue)}
.thread-content{font-size:12px;color:var(--text2);line-height:1.5}
.venue-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(280px,1fr));gap:12px}
.venue-card{background:var(--surface);border:1px solid var(--border);border-radius:8px;padding:16px}
.venue-card-name{font-size:14px;font-weight:600;color:var(--text);margin-bottom:8px;display:flex;align-items:center;gap:8px}
.venue-pill{font-size:10px;font-weight:700;padding:2px 7px;border-radius:4px;background:var(--surface2);color:var(--text3);border:1px solid var(--border)}
.venue-stats{display:flex;gap:16px;margin-top:8px}
.venue-stat{text-align:center}
.venue-stat-num{font-size:18px;font-weight:700;color:var(--text);line-height:1}
.venue-stat-label{font-size:10px;color:var(--text3);margin-top:2px;text-transform:uppercase;letter-spacing:0.05em}
.venue-last{font-size:11px;color:var(--text3);margin-top:8px;padding-top:8px;border-top:1px solid var(--border)}
.conv-item{padding:10px 0;border-bottom:1px solid var(--border)}
.conv-item:last-child{border-bottom:none}
.conv-top{display:flex;align-items:center;gap:8px;margin-bottom:3px}
.conv-name{font-size:13px;font-weight:600;color:var(--text)}
.conv-venue{font-size:11px;background:var(--surface2);color:var(--text3);padding:1px 7px;border-radius:4px;border:1px solid var(--border)}
.conv-date{font-size:11px;color:var(--text3);margin-left:auto}
.conv-preview{font-size:12px;color:var(--text3);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.drop-zone{border:1px dashed var(--border2);border-radius:8px;padding:32px;text-align:center;cursor:pointer;transition:all 0.15s}
.drop-zone:hover,.drop-zone.dragging{border-color:var(--blue);background:#FFF0EE}
.drop-title{font-size:14px;font-weight:600;color:var(--text);margin-bottom:4px;margin-top:8px}
.drop-sub{font-size:12px;color:var(--text3)}
.doc-row{display:flex;align-items:center;justify-content:space-between;padding:10px 0;border-bottom:1px solid var(--border)}
.doc-row:last-child{border-bottom:none}
.doc-left{display:flex;align-items:center;gap:10px}
.doc-icon{width:28px;height:28px;background:var(--surface2);border:1px solid var(--border);border-radius:6px;display:flex;align-items:center;justify-content:center;font-size:12px;flex-shrink:0}
.doc-name{font-size:13px;font-weight:500;color:var(--text)}
.doc-date{font-size:11px;color:var(--text3);margin-top:1px}
.doc-right{display:flex;align-items:center;gap:8px}
.badge-indexed{font-size:11px;font-weight:600;color:var(--green);background:#dcfce7;border:1px solid #bbf7d0;padding:2px 8px;border-radius:4px}
.btn-del{padding:4px 10px;font-size:11px;font-weight:500;border:1px solid var(--border2);border-radius:4px;background:none;color:var(--text3);cursor:pointer;font-family:inherit;transition:all 0.1s}
.btn-del:hover{border-color:var(--red);color:var(--red)}
.upload-item{padding:8px 12px;background:var(--surface2);border-radius:6px;font-size:12px;margin-bottom:6px;border:1px solid var(--border)}
.prog-wrap{height:3px;background:var(--border);border-radius:2px;margin-top:6px;overflow:hidden}
.prog-bar{height:100%;background:var(--blue);width:0;border-radius:2px;transition:width 0.3s}
.toast{position:fixed;bottom:20px;right:20px;background:#1e293b;color:#fff;padding:10px 16px;border-radius:6px;font-size:13px;font-weight:500;transform:translateY(60px);opacity:0;transition:all 0.25s;z-index:999;box-shadow:0 4px 12px rgba(0,0,0,0.15)}
.toast.show{transform:translateY(0);opacity:1}
.toast.green{background:var(--green)}
.toast.red{background:var(--red)}
.empty{text-align:center;padding:32px 16px;color:var(--text3);font-size:13px}
.shimmer{display:inline-block;height:28px;width:48px;background:linear-gradient(90deg,var(--surface2) 25%,var(--border) 50%,var(--surface2) 75%);background-size:200%;animation:shimmer 1.2s infinite;border-radius:4px}
@keyframes shimmer{0%{background-position:200% 0}100%{background-position:-200% 0}}
.video-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(260px,1fr));gap:16px}
.video-card{background:var(--surface);border:1px solid var(--border);border-radius:8px;overflow:hidden;transition:box-shadow .15s}
.video-card:hover{box-shadow:0 4px 12px rgba(0,0,0,.08)}
.video-drop-zone{border:2px dashed var(--border2);border-radius:8px;padding:32px;text-align:center;cursor:pointer;transition:all .15s;margin-bottom:16px}
.video-drop-zone:hover,.video-drop-zone.drag-over{border-color:var(--blue);background:#FFF0EE}
.video-thumb{width:100%;aspect-ratio:16/9;object-fit:cover;background:#000;display:block;cursor:pointer}
.video-thumb-empty{width:100%;aspect-ratio:16/9;background:var(--surface2);display:flex;align-items:center;justify-content:center;font-size:36px;cursor:pointer}
.video-info{padding:12px}
.video-title{font-size:13px;font-weight:600;color:var(--text);margin-bottom:4px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.video-desc{font-size:11px;color:var(--text3);margin-bottom:8px}
.video-footer{display:flex;align-items:center;justify-content:space-between}
.vbadge{font-size:10px;font-weight:700;padding:2px 7px;border-radius:4px;text-transform:uppercase}
.vbadge.youtube{background:#fee2e2;color:#dc2626}.vbadge.mp4{background:#dbeafe;color:#1d4ed8}
.vmodal{position:fixed;inset:0;background:rgba(0,0,0,.85);z-index:9999;display:flex;align-items:center;justify-content:center;padding:20px}
.vmodal-box{background:var(--surface);border-radius:12px;overflow:hidden;width:100%;max-width:860px}
.vmodal-hdr{display:flex;align-items:center;justify-content:space-between;padding:14px 16px;border-bottom:1px solid var(--border)}
.vmodal-title{font-size:14px;font-weight:600;color:var(--text);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;flex:1;margin-right:12px}
.vmodal-close{background:none;border:none;font-size:22px;cursor:pointer;color:var(--text3);padding:4px 8px;line-height:1}
.vmodal-body{background:#000}
.vmodal-body iframe,.vmodal-body video{display:block;width:100%;aspect-ratio:16/9}
</style>
</head>
<body>
<header>
  <div class="header-left">
    <img class="wordmark" src="https://raw.githubusercontent.com/TOT-STACKED/toast-support-bot/main/assets/Stacked%20(3).svg" alt="Stacked">
    <div class="divider"></div>
    <nav class="header-nav">
      <button class="nav-item active" onclick="showTab('dashboard')">Dashboard</button>
      <div class="nav-divider"></div>
      <button class="nav-item" onclick="showTab('conversations')">Conversations</button>
      <button class="nav-item" onclick="showTab('venues')">Venues</button>
      <div class="nav-divider"></div>
      <button class="nav-item" onclick="showTab('content')">&#x1F4DA; Content</button>
      <button class="nav-item" onclick="showTab('health')">&#x2705; Shift Checks</button>
    </nav>
  </div>
  <div class="header-right">
    <span class="update-text" id="lastUpdated">&mdash;</span>
    <button class="btn" onclick="loadAnalytics()">&#x21BB; Refresh</button>
  </div>
</header>

<div class="container">
  <div class="tab-panel active" id="tab-dashboard">
    <div class="page-header"><div><div class="page-title">Overview</div><div class="page-sub">All activity across Stacked Chat</div></div></div>
    <div class="kpi-grid" style="grid-template-columns:repeat(3,1fr)">
      <div class="kpi"><div class="kpi-label">Conversations</div><div class="kpi-value" id="kpiConvs"><span class="shimmer"></span></div></div>
      <div class="kpi"><div class="kpi-label">Messages sent</div><div class="kpi-value" id="kpiMsgs"><span class="shimmer"></span></div></div>
      <div class="kpi"><div class="kpi-label">Docs indexed</div><div class="kpi-value" id="kpiDocs"><span class="shimmer"></span></div></div>
    </div>
    <div class="grid-2">
      <div class="card"><div class="card-header"><span class="card-title">Hot topics</span><span class="card-meta">Most frequent</span></div><div id="hotTopics"><div class="empty">No data yet</div></div></div>
      <div class="card"><div class="card-header"><span class="card-title">Top products mentioned</span><span class="card-meta">Top 10</span></div><div id="topProducts"><div class="empty">No data yet</div></div></div>
    </div>
    <div class="card"><div class="card-header"><span class="card-title">Product NPS scores</span><span class="card-meta">Operator ratings</span></div><div id="npsTable"><div class="empty">No ratings yet — NPS prompts appear after vendor conversations</div></div></div>
    <div class="grid-2">
      <div class="card"><div class="card-header"><span class="card-title">Messages by day</span></div><div class="chart-wrap"><canvas id="actChart"></canvas></div></div>
      <div class="card"><div class="card-header"><span class="card-title">Issue categories</span></div><div class="chart-wrap"><canvas id="donutChart"></canvas></div></div>
    </div>
    <div class="card"><div class="card-header"><span class="card-title">Recent conversations</span><button class="btn" onclick="showTab('conversations')">View all &rarr;</button></div><div id="recentConvs"><div class="empty">No conversations yet</div></div></div>
  </div>

  <div class="tab-panel" id="tab-conversations">
    <div class="page-header"><div><div class="page-title">Conversations</div><div class="page-sub" id="convCount">&mdash;</div></div></div>
    <div class="card"><div id="convsTable"><div class="empty">Loading...</div></div></div>
  </div>

  <div class="tab-panel" id="tab-venues">
    <div class="page-header">
      <div><div class="page-title">Venues</div><div class="page-sub" id="venueCount">&mdash;</div></div>
      <button class="btn btn-primary" onclick="showBrandingModal()">+ Set up branding</button>
    </div>
    <div id="venueGrid" class="venue-grid"><div class="empty">Loading...</div></div>
  </div>

  <!-- Branding Modal -->
  <div id="brandingModal" style="display:none;position:fixed;inset:0;background:rgba(0,0,0,.5);z-index:9999;display:none;align-items:center;justify-content:center;padding:20px">
    <div style="background:var(--surface);border-radius:12px;width:100%;max-width:520px;max-height:90vh;overflow-y:auto">
      <div style="display:flex;align-items:center;justify-content:space-between;padding:20px 24px;border-bottom:1px solid var(--border)">
        <div style="font-size:15px;font-weight:600;color:var(--text)">Venue Branding</div>
        <button onclick="closeBrandingModal()" style="background:none;border:none;font-size:20px;cursor:pointer;color:var(--text3)">&#x2715;</button>
      </div>
      <div style="padding:24px;display:flex;flex-direction:column;gap:14px">
        <div>
          <label style="font-size:12px;font-weight:600;color:var(--text3);text-transform:uppercase;letter-spacing:.05em;display:block;margin-bottom:6px">Venue</label>
          <select id="bVenueSelect" style="width:100%;padding:9px 12px;border:1px solid var(--border2);border-radius:6px;font-size:13px;font-family:inherit;color:var(--text);background:var(--bg)">
            <option value="">Loading venues...</option>
          </select>
        </div>
        <div>
          <label style="font-size:12px;font-weight:600;color:var(--text3);text-transform:uppercase;letter-spacing:.05em;display:block;margin-bottom:6px">Logo URL <span style="font-weight:400;text-transform:none;letter-spacing:0;color:var(--text3);font-size:11px">— must be a direct image link (.png, .svg, .jpg)</span></label>
          <input id="bLogoUrl" type="url" placeholder="https://logo.clearbit.com/yourdomain.com" style="width:100%;padding:9px 12px;border:1px solid var(--border2);border-radius:6px;font-size:13px;font-family:inherit;color:var(--text);background:var(--bg)">
          <div id="bLogoUrlError" style="display:none;margin-top:6px;padding:8px 10px;border-radius:6px;background:#fef2f2;border:1px solid #fecaca;color:#dc2626;font-size:12px;line-height:1.4"></div>
          <div style="font-size:11px;color:var(--text3);margin-top:4px">Link to a PNG or SVG — ideally on a transparent background</div>
        </div>
        <div>
          <label style="font-size:12px;font-weight:600;color:var(--text3);text-transform:uppercase;letter-spacing:.05em;display:block;margin-bottom:6px">Brand colour</label>
          <div style="display:flex;gap:8px;align-items:center">
            <input id="bColorPicker" type="color" value="#E8573C" style="width:44px;height:36px;border:1px solid var(--border2);border-radius:6px;cursor:pointer;padding:2px">
            <input id="bColorHex" type="text" value="#E8573C" placeholder="#E8573C" style="flex:1;padding:9px 12px;border:1px solid var(--border2);border-radius:6px;font-size:13px;font-family:inherit;color:var(--text);background:var(--bg)" oninput="syncColor(this.value)">
          </div>
        </div>
        <div>
          <label style="font-size:12px;font-weight:600;color:var(--text3);text-transform:uppercase;letter-spacing:.05em;display:block;margin-bottom:6px">Bot name</label>
          <input id="bBotName" type="text" placeholder="e.g. Roxy — Côte Support" style="width:100%;padding:9px 12px;border:1px solid var(--border2);border-radius:6px;font-size:13px;font-family:inherit;color:var(--text);background:var(--bg)">
        </div>
        <div>
          <label style="font-size:12px;font-weight:600;color:var(--text3);text-transform:uppercase;letter-spacing:.05em;display:block;margin-bottom:6px">Welcome message (login screen)</label>
          <input id="bWelcomeMsg" type="text" placeholder="e.g. Your dedicated tech support, powered by AI" style="width:100%;padding:9px 12px;border:1px solid var(--border2);border-radius:6px;font-size:13px;font-family:inherit;color:var(--text);background:var(--bg)">
        </div>
        <div>
          <label style="font-size:12px;font-weight:600;color:var(--text3);text-transform:uppercase;letter-spacing:.05em;display:block;margin-bottom:6px">Welcome heading (chat screen)</label>
          <input id="bWelcomeHeading" type="text" placeholder="e.g. What can we fix for you today?" style="width:100%;padding:9px 12px;border:1px solid var(--border2);border-radius:6px;font-size:13px;font-family:inherit;color:var(--text);background:var(--bg)">
        </div>
        <div style="display:flex;align-items:center;gap:10px;padding:12px;background:var(--surface2);border-radius:6px;border:1px solid var(--border)">
          <input type="checkbox" id="bWhiteLabel" style="width:16px;height:16px;cursor:pointer">
          <div>
            <div style="font-size:13px;font-weight:600;color:var(--text)">White-label (hide &ldquo;Powered by Stacked&rdquo;)</div>
            <div style="font-size:11px;color:var(--text3)">Available on Group plan</div>
          </div>
        </div>
        <div id="bPreview" style="border:1px solid var(--border);border-radius:8px;padding:14px;background:var(--surface2);display:flex;align-items:center;gap:12px">
          <img id="bPreviewLogo" src="" style="height:28px;max-width:120px;object-fit:contain;display:none">
          <div>
            <div id="bPreviewName" style="font-size:13px;font-weight:600;color:var(--text)">Bot name preview</div>
            <div id="bPreviewUrl" style="font-size:11px;color:var(--text3);margin-top:2px"></div>
          </div>
          <div id="bPreviewSwatch" style="width:28px;height:28px;border-radius:6px;margin-left:auto;flex-shrink:0;background:#E8573C"></div>
        </div>
        <button class="btn btn-primary" id="bSaveBtn" onclick="saveBranding()" style="width:100%;justify-content:center;padding:10px">Save branding</button>
      </div>
    </div>
  </div>

  <div class="tab-panel" id="tab-content">
    <div class="page-header" style="margin-bottom:0">
      <div><div class="page-title">Content</div><div class="page-sub">Videos and knowledge base docs surfaced in chat</div></div>
    </div>
    <div class="sub-tab-bar">
      <button class="sub-tab active" id="stVideos" onclick="showContentTab('videos')">&#x1F3A5; Videos</button>
      <button class="sub-tab" id="stDocs" onclick="showContentTab('documents')">&#x1F4DA; Knowledge Base</button>
    </div>

    <!-- ── VIDEOS PANEL ───────────────────────────────────────────── -->
    <div id="contentVideos">
      <div class="card" style="margin-bottom:16px">
        <div class="card-header"><span class="card-title">&#x1F4FA; Import from YouTube</span><span class="card-meta">Search by vendor name &mdash; tick &amp; bulk import</span></div>
        <div style="display:flex;gap:8px;margin-bottom:12px;flex-wrap:wrap">
          <input id="ytSearch" type="text" placeholder="e.g. Lightspeed Restaurant, Square POS, Deputy App..." style="flex:1;min-width:240px;padding:8px 12px;border:1px solid var(--border2);border-radius:6px;font-size:13px;font-family:inherit;color:var(--text);background:var(--bg)" onkeydown="if(event.key==='Enter')searchYouTube()">
          <select id="ytCategory" style="padding:8px 12px;border:1px solid var(--border2);border-radius:6px;font-size:13px;font-family:inherit;color:var(--text);background:var(--bg)">
            <option value="">No category</option>
            <option value="epos">EPOS / POS</option>
            <option value="payments">Payments</option>
            <option value="wifi">WiFi / Network</option>
            <option value="printer">Printers / KDS</option>
            <option value="bookings">Bookings / Reservations</option>
            <option value="workforce">Workforce / Rota</option>
            <option value="ordering">Online Ordering</option>
            <option value="loyalty">Loyalty / CRM</option>
            <option value="general">General</option>
          </select>
          <button class="btn btn-primary" id="ytSearchBtn" onclick="searchYouTube()">&#x1F50D; Search</button>
        </div>
        <div id="ytResults" style="display:none">
          <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:10px">
            <span id="ytResultCount" style="font-size:12px;color:var(--text3)"></span>
            <div style="display:flex;gap:8px">
              <button class="btn" onclick="ytSelectAll()">Select all</button>
              <button class="btn btn-primary" id="ytImportBtn" onclick="importSelected()" style="display:none">&#x2B07; Import selected (<span id="ytSelCount">0</span>)</button>
            </div>
          </div>
          <div id="ytGrid" class="video-grid"></div>
        </div>
        <div id="ytNoKey" style="display:none;padding:12px;background:#fef3c7;border:1px solid #fde68a;border-radius:6px;font-size:13px;color:#92400e">
          &#x26A0; Add <strong>YOUTUBE_API_KEY</strong> to your Render environment variables to enable YouTube search.
          <a href="https://console.cloud.google.com/apis/credentials" target="_blank" style="color:#92400e;font-weight:600"> Get a free key &rarr;</a>
        </div>
      </div>
      <div class="card" style="margin-bottom:16px">
        <div class="card-header"><span class="card-title">Add single video</span></div>
        <div class="video-drop-zone" id="videoDrop" ondragover="vDragOver(event)" ondragleave="vDragLeave(event)" ondrop="vDrop(event)" onclick="document.getElementById('videoFileInput').click()">
          <input type="file" id="videoFileInput" accept="video/mp4,video/webm,video/*" style="display:none" onchange="handleVideoFiles(this.files)">
          <div style="font-size:32px">&#x1F3A5;</div>
          <div style="font-size:14px;font-weight:600;color:var(--text);margin-top:8px">Drag &amp; drop an MP4 here</div>
          <div style="font-size:12px;color:var(--text3)">or click to browse &mdash; or paste a URL below</div>
        </div>
        <div id="videoUploadList"></div>
        <div style="display:flex;gap:10px;margin-bottom:10px;flex-wrap:wrap;margin-top:10px">
          <input id="vidUrl" type="url" placeholder="YouTube URL or direct MP4 URL" style="flex:2;min-width:240px;padding:8px 12px;border:1px solid var(--border2);border-radius:6px;font-size:13px;font-family:inherit;color:var(--text);background:var(--bg)">
          <input id="vidTitle" type="text" placeholder="Title" style="flex:1;min-width:160px;padding:8px 12px;border:1px solid var(--border2);border-radius:6px;font-size:13px;font-family:inherit;color:var(--text);background:var(--bg)">
        </div>
        <div style="display:flex;gap:10px;margin-bottom:10px;flex-wrap:wrap">
          <input id="vidDesc" type="text" placeholder="Keywords (e.g. Square POS setup)" style="flex:1;padding:8px 12px;border:1px solid var(--border2);border-radius:6px;font-size:13px;font-family:inherit;color:var(--text);background:var(--bg)">
          <select id="vidCat" style="padding:8px 12px;border:1px solid var(--border2);border-radius:6px;font-size:13px;font-family:inherit;color:var(--text);background:var(--bg)">
            <option value="">No category</option>
            <option value="epos">EPOS / POS</option>
            <option value="payments">Payments</option>
            <option value="wifi">WiFi / Network</option>
            <option value="printer">Printers / KDS</option>
            <option value="bookings">Bookings / Reservations</option>
            <option value="workforce">Workforce / Rota</option>
            <option value="ordering">Online Ordering</option>
            <option value="loyalty">Loyalty / CRM</option>
            <option value="general">General</option>
          </select>
          <button class="btn btn-primary" id="addVidBtn" onclick="addVideo()">+ Add</button>
        </div>
      </div>
      <div class="filter-bar">
        <button class="filter-btn active" onclick="filterVideos('',this)">All</button>
        <button class="filter-btn" onclick="filterVideos('epos',this)">EPOS</button>
        <button class="filter-btn" onclick="filterVideos('payments',this)">Payments</button>
        <button class="filter-btn" onclick="filterVideos('wifi',this)">WiFi</button>
        <button class="filter-btn" onclick="filterVideos('printer',this)">Printers</button>
        <button class="filter-btn" onclick="filterVideos('bookings',this)">Bookings</button>
        <button class="filter-btn" onclick="filterVideos('workforce',this)">Workforce</button>
        <button class="filter-btn" onclick="filterVideos('ordering',this)">Ordering</button>
      </div>
      <div id="videoGrid" class="video-grid"><div class="empty">Loading...</div></div>
    </div>

    <!-- ── KNOWLEDGE BASE PANEL ──────────────────────────────────── -->
    <div id="contentDocs" style="display:none">
    <div class="card" style="margin-bottom:16px">
      <div class="card-header"><span class="card-title">&#x1F310; Scrape vendor help centres</span><span class="card-meta">Fetch and index docs directly from vendor support sites</span></div>
      <div style="margin-bottom:12px;display:flex;gap:8px;flex-wrap:wrap">
        <input id="scrapeUrl" type="url" placeholder="https://help.lightspeedhq.com/hc/en-gb/articles/..." style="flex:2;min-width:240px;padding:8px 12px;border:1px solid var(--border2);border-radius:6px;font-size:13px;font-family:inherit;color:var(--text);background:var(--bg)">
        <input id="scrapeVendor" type="text" placeholder="Vendor name (e.g. Lightspeed)" style="flex:1;min-width:160px;padding:8px 12px;border:1px solid var(--border2);border-radius:6px;font-size:13px;font-family:inherit;color:var(--text);background:var(--bg)">
        <button class="btn btn-primary" onclick="doScrapeUrl()" id="scrapeBtn">&#x1F4E5; Scrape</button>
      </div>
      <div style="font-size:12px;font-weight:600;color:var(--text3);margin-bottom:8px;text-transform:uppercase;letter-spacing:.05em">Quick scrape &mdash; known vendor help centres <span style="font-weight:400;color:var(--text3)">(uses Zendesk API where available &mdash; up to 150 articles per vendor)</span></div>
      <div style="display:flex;flex-wrap:wrap;gap:6px" id="quickScrapeList">
        <button class="filter-btn" onclick="quickScrape('https://support.lightspeedhq.com/hc/en-gb','Lightspeed Restaurant',this)">Lightspeed</button>
        <button class="filter-btn" onclick="quickScrape('https://squareup.com/help/gb/en/article/5148-getting-started-with-square-for-restaurants','Square',this)">Square</button>
        <button class="filter-btn" onclick="quickScrape('https://support.eposnow.com/hc/en-gb','EPOS Now',this)">EPOS Now</button>
        <button class="filter-btn" onclick="quickScrape('https://help.deputy.com/hc/en-us','Deputy',this)">Deputy</button>
        <button class="filter-btn" onclick="quickScrape('https://support.sevenrooms.com/hc/en-us','SevenRooms',this)">SevenRooms</button>
        <button class="filter-btn" onclick="quickScrape('https://help.opentable.com/hc/en-us','OpenTable',this)">OpenTable</button>
        <button class="filter-btn" onclick="quickScrape('https://support.deliverect.com/hc/en-us','Deliverect',this)">Deliverect</button>
        <button class="filter-btn" onclick="quickScrape('https://help.mews.com/hc/en-us','Mews',this)">Mews</button>
        <button class="filter-btn" onclick="quickScrape('https://support.marketman.com/hc/en-us','Marketman',this)">Marketman</button>
        <button class="filter-btn" onclick="quickScrape('https://help.resdiary.com/hc/en-gb','ResDiary',this)">ResDiary</button>
        <button class="filter-btn" onclick="quickScrape('https://support.zonal.co.uk/hc/en-gb','Zonal',this)">Zonal</button>
        <button class="filter-btn" onclick="quickScrape('https://support.tevalis.com/hc/en-gb','Tevalis',this)">Tevalis</button>
        <button class="filter-btn" onclick="quickScrape('https://support.flipdish.com/hc/en-us','Flipdish',this)">Flipdish</button>
        <button class="filter-btn" onclick="quickScrape('https://support.airship.com/hc/en-gb','Airship',this)">Airship</button>
        <button class="filter-btn" onclick="quickScrape('https://support.stampede.ai/hc/en-gb','Stampede',this)">Stampede</button>
        <button class="filter-btn" onclick="quickScrape('https://help.fourth.com/hc/en-gb','Fourth',this)">Fourth</button>
        <button class="filter-btn" onclick="quickScrape('https://support.rotaready.com/hc/en-gb','Rotaready',this)">Rotaready</button>
        <button class="filter-btn" onclick="quickScrape('https://support.collins.uk/hc/en-gb','Collins',this)">Collins</button>
      </div>
      <div id="scrapeStatus" style="margin-top:10px;font-size:13px;padding:8px 0;color:var(--text3)"></div>
    </div>
    <div class="card">
      <div class="drop-zone" id="dropZone" onclick="document.getElementById('fileInput').click()" ondragover="dragOver(event)" ondragleave="dragLeave(event)" ondrop="dropFiles(event)">
        <div style="font-size:28px">&#x1F4C4;</div>
        <div class="drop-title">Drop files to index</div>
        <div class="drop-sub">Supports .txt and .md &mdash; up to 10MB each</div>
      </div>
      <input type="file" id="fileInput" multiple accept=".txt,.md" style="display:none" onchange="handleFiles(this.files)">
      <div id="uploadList" style="margin-top:12px"></div>
      <div style="margin-top:16px;margin-bottom:8px;display:flex;gap:8px">
        <input type="text" id="docSearch" placeholder="Search knowledge base..." oninput="filterDocs(this.value)" style="flex:1;padding:8px 12px;border:1px solid var(--border2);border-radius:6px;font-size:13px;font-family:inherit;color:var(--text);background:var(--bg);outline:none">
        <span id="docCount" style="font-size:12px;color:var(--text3);white-space:nowrap;align-self:center"></span>
      </div>
      <div id="docList" style="margin-top:12px"><div class="empty">Loading documents...</div></div>
    </div>
    </div><!-- end #contentDocs -->

  </div><!-- end #tab-content -->
  <div class="tab-panel" id="tab-health">
    <div class="page-header"><div><div class="page-title">Shift Checks</div><div class="page-sub">Venue health checks logged at start of service</div></div></div>
    <div class="kpi-grid" style="grid-template-columns:repeat(3,1fr)">
      <div class="kpi"><div class="kpi-label">Total checks logged</div><div class="kpi-value" id="hTotalChecks"><span class="shimmer"></span></div></div>
      <div class="kpi"><div class="kpi-label">Checks with issues</div><div class="kpi-value" id="hIssueChecks"><span class="shimmer"></span></div></div>
      <div class="kpi"><div class="kpi-label">Most flagged system</div><div class="kpi-value" style="font-size:18px;padding-top:4px" id="hTopSystem"><span class="shimmer"></span></div></div>
    </div>
    <div class="grid-2">
      <div class="card">
        <div class="card-header"><span class="card-title">System issue frequency</span><span class="card-meta">Last 7 days</span></div>
        <div id="hSystemBars"><div class="empty">No data yet</div></div>
      </div>
      <div class="card">
        <div class="card-header"><span class="card-title">Latest check per venue</span></div>
        <div id="hVenueLatest"><div class="empty">No checks yet</div></div>
      </div>
    </div>
    <div class="card">
      <div class="card-header"><span class="card-title">Recent shift checks</span><span class="card-meta" id="hCheckCount"></span></div>
      <div id="hChecksTable"><div class="empty">Loading...</div></div>
    </div>
  </div>

</div>

<div class="vmodal" id="vmodal" style="display:none" onclick="if(event.target===this)closeVModal()">
  <div class="vmodal-box">
    <div class="vmodal-hdr"><span class="vmodal-title" id="vmodalTitle"></span><button class="vmodal-close" onclick="closeVModal()">&#x2715;</button></div>
    <div class="vmodal-body" id="vmodalBody"></div>
  </div>
</div>
<div class="toast" id="toast"></div>

<script>
function showTab(id) {
  document.querySelectorAll('.nav-item').forEach((t,i) => t.classList.toggle('active', ['dashboard','conversations','venues','content','health'][i]===id));
  document.querySelectorAll('.tab-panel').forEach(p => p.classList.toggle('active', p.id==='tab-'+id));
  if (id==='content') loadVideos();
}
function showContentTab(sub) {
  const showVideos = sub === 'videos';
  document.getElementById('contentVideos').style.display = showVideos ? '' : 'none';
  document.getElementById('contentDocs').style.display = showVideos ? 'none' : '';
  document.getElementById('stVideos').classList.toggle('active', showVideos);
  document.getElementById('stDocs').classList.toggle('active', !showVideos);
}
function esc(s){return String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');}
let actChart, donutChart;

async function doScrapeUrl() {
  const url = document.getElementById('scrapeUrl').value.trim();
  const vendor = document.getElementById('scrapeVendor').value.trim();
  if (!url) { notify('Enter a URL to scrape', 'red'); return; }
  const btn = document.getElementById('scrapeBtn');
  const st = document.getElementById('scrapeStatus');
  btn.disabled = true; btn.textContent = 'Scraping...';
  st.style.color = 'var(--text3)';
  st.textContent = 'Fetching ' + url + ' — this may take up to 30 seconds...';
  try {
    const r = await fetch('/scrape', { method: 'POST', headers: {'Content-Type':'application/json'}, body: JSON.stringify({ url, vendor }) });
    const data = await r.json();
    if (data.ok) {
      const method = data.method === 'zendesk-api' ? 'Zendesk API' : 'HTML';
      notify('Scraped ' + data.chunks + ' chunks from ' + (vendor || url), 'green');
      st.style.color = 'var(--green,#22c55e)';
      st.textContent = '\u2705 Indexed ' + data.chunks + ' chunks (' + Math.round(data.chars/1000) + 'k chars) via ' + method + ' as "' + data.filename + '"';
      document.getElementById('scrapeUrl').value = '';
      document.getElementById('scrapeVendor').value = '';
      setTimeout(loadAnalytics, 1000);
    } else {
      notify('Scrape failed: ' + (data.error || 'unknown'), 'red');
      st.style.color = '#ef4444';
      st.textContent = '\u274C Failed: ' + (data.error || 'Unknown error');
    }
  } catch(e) { notify('Error: ' + e.message, 'red'); st.style.color='#ef4444'; st.textContent='\u274C '+e.message; }
  btn.disabled = false; btn.textContent = '\uD83D\uDCE5 Scrape';
}

async function quickScrape(url, vendor, btn) {
  btn.disabled = true; btn.textContent = vendor + '...';
  const st = document.getElementById('scrapeStatus');
  st.style.color = 'var(--text3)';
  st.textContent = 'Fetching ' + vendor + ' help centre — this may take up to 30 seconds...';
  try {
    const r = await fetch('/scrape', { method: 'POST', headers: {'Content-Type':'application/json'}, body: JSON.stringify({ url, vendor }) });
    const data = await r.json();
    if (data.ok) {
      const method = data.method === 'zendesk-api' ? 'Zendesk API' : 'HTML';
      notify(vendor + ': ' + data.chunks + ' chunks indexed', 'green');
      st.style.color = 'var(--green,#22c55e)';
      st.textContent = '\u2705 ' + vendor + ': indexed ' + data.chunks + ' chunks (' + Math.round(data.chars/1000) + 'k chars) via ' + method + ' \u2014 "' + data.filename + '"';
      btn.textContent = '\u2705 ' + vendor;
      btn.style.background = 'var(--green,#22c55e)'; btn.style.color = '#fff'; btn.style.border = 'none';
      setTimeout(loadAnalytics, 1000);
    } else {
      notify(vendor + ' scrape failed: ' + (data.error||''), 'red');
      st.style.color = '#ef4444';
      st.textContent = '\u274C ' + vendor + ': ' + (data.error || 'Failed');
      btn.disabled = false; btn.textContent = vendor;
    }
  } catch(e) {
    notify('Error: ' + e.message, 'red');
    st.style.color = '#ef4444';
    st.textContent = '\u274C ' + vendor + ': ' + e.message;
    btn.disabled = false; btn.textContent = vendor;
  }
}

async function loadAnalytics() {
  try {
    const r = await fetch('/analytics');
    const a = await r.json();
    if (a.error) { notify('Error: '+a.error,'red'); return; }
    document.getElementById('kpiConvs').textContent = (a.totalConvs||0).toLocaleString();
    document.getElementById('kpiMsgs').textContent = (a.totalMessages||0).toLocaleString();
    document.getElementById('kpiDocs').textContent = (a.totalDocs||0).toLocaleString();
    document.getElementById('lastUpdated').textContent = 'Updated ' + new Date().toLocaleTimeString('en-GB',{hour:'2-digit',minute:'2-digit'});
    document.getElementById('convCount').textContent = a.totalConvs + ' conversation' + (a.totalConvs!==1?'s':'');
    const ht = document.getElementById('hotTopics');
    if (!a.topTopics||!a.topTopics.length) { ht.innerHTML='<div class="empty">No data yet</div>'; }
    else { const max=a.topTopics[0][1]; ht.innerHTML=a.topTopics.slice(0,8).map(([t,c],i)=>'<div class="data-row"><span class="rank'+(i<3?' hi':'')+'">'+( i+1)+'</span><span class="data-label">'+esc(t)+'</span><div class="bar-outer"><div class="bar-inner alt" style="width:'+Math.round(c/max*100)+'%"></div></div><span class="data-count">'+c+'</span></div>').join(''); }
    const tp = document.getElementById('topProducts');
    if (!a.topVendors||!a.topVendors.length) { tp.innerHTML='<div class="empty">No product mentions yet</div>'; }
    else { const max=a.topVendors[0][1]; tp.innerHTML=a.topVendors.slice(0,10).map(([v,c],i)=>'<div class="data-row"><span class="rank'+(i<3?' hi':'')+'">'+( i+1)+'</span><span class="data-label">'+esc(v.charAt(0).toUpperCase()+v.slice(1))+'</span><div class="bar-outer"><div class="bar-inner" style="width:'+Math.round(c/max*100)+'%"></div></div><span class="data-count">'+c+'</span></div>').join(''); }
    const days=['Mon','Tue','Wed','Thu','Fri','Sat','Sun'];const counts=[0,0,0,0,0,0,0];
    (a.recentConvs||[]).forEach(c=>{counts[(new Date(c.created_at).getDay()+6)%7]+=(c.messages||[]).filter(m=>m.role==='user').length;});
    if(actChart)actChart.destroy();
    actChart=new Chart(document.getElementById('actChart').getContext('2d'),{type:'bar',data:{labels:days,datasets:[{data:counts,backgroundColor:'rgba(232,87,60,0.12)',borderColor:'#E8573C',borderWidth:1.5,borderRadius:4,borderSkipped:false}]},options:{responsive:true,maintainAspectRatio:false,plugins:{legend:{display:false}},scales:{y:{beginAtZero:true,grid:{color:'#EDEBE5'},ticks:{color:'#A8A49C',font:{family:'Inter',size:11}}},x:{grid:{display:false},ticks:{color:'#A8A49C',font:{family:'Inter',size:11}}}}}});
    const dL=(a.topTopics||[]).slice(0,6).map(([t])=>t.charAt(0).toUpperCase()+t.slice(1));const dC=(a.topTopics||[]).slice(0,6).map(([,c])=>c);
    if(donutChart)donutChart.destroy();
    if(dL.length){donutChart=new Chart(document.getElementById('donutChart').getContext('2d'),{type:'doughnut',data:{labels:dL,datasets:[{data:dC,backgroundColor:['#E8573C','#F07B5A','#C94A30','#F5A58A','#8B4A40','#A8A49C'],borderWidth:0,hoverOffset:4}]},options:{responsive:true,maintainAspectRatio:false,cutout:'70%',plugins:{legend:{position:'right',labels:{font:{family:'Inter',size:11},color:'#6B6867',padding:10,boxWidth:8,boxHeight:8}}}}});}else{document.getElementById('donutChart').parentElement.innerHTML='<div class="empty">No data yet</div>';}
    const rc=document.getElementById('recentConvs');const convs=(a.recentConvs||[]).slice(0,6);
    if(!convs.length){rc.innerHTML='<div class="empty">No conversations yet</div>';}
    else{rc.innerHTML=convs.map(c=>{const first=(c.messages||[]).find(m=>m.role==='user');const count=(c.messages||[]).filter(m=>m.role==='user').length;const d=new Date(c.created_at).toLocaleDateString('en-GB',{day:'numeric',month:'short'});return '<div class="conv-item"><div class="conv-top"><span class="conv-name">'+esc(c.name||'Unknown')+'</span>'+(c.venue?'<span class="conv-venue">'+esc(c.venue)+'</span>':'')+'<span class="conv-date">'+d+' &middot; '+count+' msg'+(count!==1?'s':'')+'</span></div><div class="conv-preview">'+esc((first?.content||'Chat session').substring(0,100))+'</div></div>';}).join('');}
    const ct=document.getElementById('convsTable');
    if(!a.recentConvs.length){ct.innerHTML='<div class="empty">No conversations yet</div>';}
    else{ct.innerHTML='<div>'+a.recentConvs.map(c=>{const first=(c.messages||[]).find(m=>m.role==='user');const count=(c.messages||[]).filter(m=>m.role==='user').length;const d=new Date(c.created_at).toLocaleDateString('en-GB',{day:'numeric',month:'short'});const thread=(c.messages||[]).map(m=>'<div class="thread-msg"><div class="thread-role '+(m.role==='user'?'user':'')+'">'+esc(m.role==='user'?'You':'Bot')+'</div><div class="thread-content">'+esc((m.content||'').substring(0,300))+'</div></div>').join('');return '<div class="conv-item" onclick="toggleConv(this)" title="Click to expand thread"><div class="conv-top"><span class="conv-name">'+esc(c.name||'Unknown')+'</span>'+(c.venue?'<span class="conv-venue">'+esc(c.venue)+'</span>':'')+'<span class="conv-date">'+d+' &middot; '+count+' msg'+(count!==1?'s':'')+'</span></div><div class="conv-preview">'+esc((first?.content||'Chat session').substring(0,100))+'</div><div class="conv-thread">'+thread+'</div></div>';}).join('')+'</div>';}
    // NPS table
    const npsEl = document.getElementById('npsTable');
    if (!a.npsData || !a.npsData.length) {
      npsEl.innerHTML = '<div class="empty">No ratings yet — NPS prompts appear after vendor conversations</div>';
    } else {
      npsEl.innerHTML = '<table style="width:100%;border-collapse:collapse;font-size:13px">' +
        '<thead><tr style="border-bottom:1px solid var(--border)">' +
        '<th style="text-align:left;padding:8px 4px;font-weight:600;color:var(--text2)">Vendor</th>' +
        '<th style="text-align:center;padding:8px 4px;font-weight:600;color:var(--text2)">NPS</th>' +
        '<th style="text-align:center;padding:8px 4px;font-weight:600;color:var(--text2)">Avg score</th>' +
        '<th style="text-align:center;padding:8px 4px;font-weight:600;color:var(--text2)">Responses</th>' +
        '<th style="padding:8px 4px;font-weight:600;color:var(--text2)">Distribution</th>' +
        '</tr></thead><tbody>' +
        a.npsData.map(function(d) {
          var npsColor = d.nps >= 50 ? 'var(--green)' : d.nps >= 0 ? '#ca8a04' : 'var(--red)';
          var promoterPct = Math.round(d.promoters / d.count * 100);
          var detractorPct = Math.round(d.detractors / d.count * 100);
          var passivePct = 100 - promoterPct - detractorPct;
          var vendorLabel = esc(d.vendor.charAt(0).toUpperCase()+d.vendor.slice(1));
          var npsLabel = (d.nps > 0 ? '+' : '') + d.nps;
          return '<tr style="border-bottom:1px solid var(--border2)">' +
            '<td style="padding:10px 4px;font-weight:600;color:var(--text)">' + vendorLabel + '</td>' +
            '<td style="padding:10px 4px;text-align:center;font-weight:700;color:' + npsColor + '">' + npsLabel + '</td>' +
            '<td style="padding:10px 4px;text-align:center;color:var(--text2)">' + d.avg + '/10</td>' +
            '<td style="padding:10px 4px;text-align:center;color:var(--text2)">' + d.count + '</td>' +
            '<td style="padding:10px 4px;min-width:120px">' +
              '<div style="display:flex;height:8px;border-radius:4px;overflow:hidden;gap:1px">' +
                '<div style="width:' + promoterPct + '%;background:var(--green)" title="Promoters ' + promoterPct + '%"></div>' +
                '<div style="width:' + passivePct + '%;background:#fbbf24" title="Passives ' + passivePct + '%"></div>' +
                '<div style="width:' + detractorPct + '%;background:var(--red)" title="Detractors ' + detractorPct + '%"></div>' +
              '</div>' +
            '</td>' +
          '</tr>';
        }).join('') +
        '</tbody></table>' +
        '<div style="display:flex;gap:16px;padding:10px 4px 0;font-size:11px;color:var(--text3)">' +
        '<span><span style="display:inline-block;width:8px;height:8px;border-radius:2px;background:var(--green);margin-right:4px"></span>Promoters (9-10)</span>' +
        '<span><span style="display:inline-block;width:8px;height:8px;border-radius:2px;background:#fbbf24;margin-right:4px"></span>Passives (7-8)</span>' +
        '<span><span style="display:inline-block;width:8px;height:8px;border-radius:2px;background:var(--red);margin-right:4px"></span>Detractors (0-6)</span>' +
        '</div>';
    }
    renderVenues(a.venueStats || []);
    renderDocs(a.docs);
    renderHealthData(a);
  } catch(e) { notify('Failed: '+e.message,'red'); console.error(e); }
}

function toggleConv(el) { el.classList.toggle('open'); }
function imgErr(el) { el.style.display='none'; }
function renderVenues(venues) {
  const el=document.getElementById('venueGrid');
  const vc=document.getElementById('venueCount');
  if(vc) vc.textContent = venues.length + ' venue' + (venues.length!==1?'s':'') + ' active';
  if(!venues||!venues.length){if(el)el.innerHTML='<div class="empty">No venues yet</div>';return;}
  el.innerHTML=venues.map(v=>{
    const lastD = new Date(v.lastSeen).toLocaleDateString('en-GB',{day:'numeric',month:'short',year:'numeric'});
    return '<div class="venue-card">'+
      '<div class="venue-card-name">&#x1F3E2; '+esc(v.venue)+'</div>'+
      '<div class="venue-stats">'+
        '<div class="venue-stat"><div class="venue-stat-num">'+v.convs+'</div><div class="venue-stat-label">Chats</div></div>'+
        '<div class="venue-stat"><div class="venue-stat-num">'+v.msgs+'</div><div class="venue-stat-label">Messages</div></div>'+
      '</div>'+
      '<div class="venue-last">Last active: '+lastD+'</div>'+
      '</div>';
  }).join('');
  // Load actual venue records for branding links
  fetch('/venues/all').then(r=>r.json()).then(function(venueDbs){
    venueDbs.forEach(function(vdb){
      if(!vdb.slug)return;
      const cards=el.querySelectorAll('.venue-card');
      cards.forEach(function(card){
        if(card.querySelector('.venue-card-name').textContent.trim().replace(/[^\w\s]/g,'').trim().toLowerCase()===vdb.name.toLowerCase()){
          const branded=vdb.primary_color||vdb.logo_url||vdb.bot_name;
          const link='stackedchat.io/chat/'+vdb.slug;
          let extra='<div class="venue-last" style="margin-top:4px;display:flex;align-items:center;gap:8px">';
          extra+='<a href="https://'+link+'" target="_blank" style="font-size:11px;color:var(--blue);text-decoration:none;font-weight:600">/chat/'+vdb.slug+' &rarr;</a>';
          if(branded)extra+='<span style="font-size:10px;font-weight:700;padding:1px 6px;border-radius:4px;background:#dcfce7;color:#166534;border:1px solid #bbf7d0">Branded</span>';
          extra+='</div>';
          card.insertAdjacentHTML('beforeend',extra);
        }
      });
    });
  }).catch(function(){});
}

var allDocs=[];
function filterDocs(q){var f=q?allDocs.filter(function(d){return d.filename.toLowerCase().includes(q.toLowerCase());}):allDocs;var c=document.getElementById('docCount');if(c)c.textContent=f.length+' / '+allDocs.length+' docs';renderDocList(f);}
function renderDocs(docs){allDocs=docs||[];var c=document.getElementById('docCount');if(c)c.textContent=allDocs.length+' docs';renderDocList(allDocs);}

function renderHealthData(a) {
  const checks = a.healthChecks || [];
  const venueHealth = a.venueHealth || [];
  const sic = a.systemIssueCounts || {};

  // KPIs
  const issueChecks = checks.filter(hc => hc.has_issues).length;
  document.getElementById('hTotalChecks').textContent = (a.totalChecks || 0).toLocaleString();
  document.getElementById('hIssueChecks').textContent = issueChecks.toLocaleString();

  // Top flagged system
  const systemLabels = { epos: 'EPOS', payments: 'Payments', wifi: 'WiFi', printer: 'Printer', bookings: 'Bookings' };
  const sortedSystems = Object.entries(sic).sort((a,b) => b[1]-a[1]);
  const topSys = sortedSystems[0];
  document.getElementById('hTopSystem').textContent = topSys && topSys[1] > 0 ? systemLabels[topSys[0]] || topSys[0] : 'None';

  // System bars
  const sbEl = document.getElementById('hSystemBars');
  const maxSic = sortedSystems[0] ? sortedSystems[0][1] : 1;
  if (!sortedSystems.some(([,c]) => c > 0)) {
    sbEl.innerHTML = '<div class="empty">No issues flagged in the last 7 days &#x1F389;</div>';
  } else {
    const sicEmoji = { epos: '💻', payments: '💳', wifi: '📶', printer: '🖨️', bookings: '📅' };
    sbEl.innerHTML = sortedSystems.map(([sys, count]) => {
      const pct = maxSic > 0 ? Math.round(count / maxSic * 100) : 0;
      return '<div class="data-row">' +
        '<span class="rank">' + (sicEmoji[sys] || '') + '</span>' +
        '<span class="data-label">' + (systemLabels[sys] || sys) + '</span>' +
        '<div class="bar-outer"><div class="bar-inner alt" style="width:' + pct + '%"></div></div>' +
        '<span class="data-count">' + count + '</span>' +
        '</div>';
    }).join('');
  }

  // Latest per venue
  const vlEl = document.getElementById('hVenueLatest');
  if (!venueHealth.length) {
    vlEl.innerHTML = '<div class="empty">No checks yet</div>';
  } else {
    vlEl.innerHTML = venueHealth.slice(0,8).map(hc => {
      const allGood = !hc.has_issues;
      const d = new Date(hc.checked_at).toLocaleDateString('en-GB', {day:'numeric',month:'short'});
      const t = new Date(hc.checked_at).toLocaleTimeString('en-GB', {hour:'2-digit',minute:'2-digit'});
      const statusDot = allGood
        ? '<span style="color:#16a34a;font-weight:700">\✅ All good</span>'
        : '<span style="color:#dc2626;font-weight:700">⚠️ Issues flagged</span>';
      return '<div class="conv-item">' +
        '<div class="conv-top">' +
        '<span class="conv-name">' + esc(hc.venue || 'Unknown venue') + '</span>' +
        '<span class="conv-date">' + d + ' ' + t + '</span>' +
        '</div>' +
        '<div class="conv-preview">' + statusDot + ' &middot; checked by ' + esc(hc.name || 'unknown') + '</div>' +
        '</div>';
    }).join('');
  }

  // Full checks table
  const hCheckCount = document.getElementById('hCheckCount');
  if (hCheckCount) hCheckCount.textContent = checks.length + ' check' + (checks.length !== 1 ? 's' : '') + ' logged';

  const htEl = document.getElementById('hChecksTable');
  if (!checks.length) { htEl.innerHTML = '<div class="empty">No shift checks yet. Operators will see the button when they open Stacked Chat.</div>'; return; }

  const systemNames = { epos: 'EPOS', payments: 'Payments', wifi: 'WiFi', printer: 'Printer', bookings: 'Bookings' };
  const statusBadge = v => {
    if (v === 'green') return '<span style="color:#16a34a;font-weight:600">\✅ OK</span>';
    if (v === 'amber') return '<span style="color:#ca8a04;font-weight:600">⚠️ Issue</span>';
    if (v === 'red')   return '<span style="color:#dc2626;font-weight:600">🔴 Down</span>';
    return '&mdash;';
  };

  htEl.innerHTML = '<table><thead><tr>' +
    '<th>Venue</th><th>By</th><th>EPOS</th><th>Payments</th><th>WiFi</th><th>Printer</th><th>Bookings</th><th>Time</th>' +
    '</tr></thead><tbody>' +
    checks.slice(0,30).map(hc => {
      const ans = hc.answers || {};
      const d = new Date(hc.checked_at);
      return '<tr>' +
        '<td><div class="td-primary">' + esc(hc.venue || '&mdash;') + '</div></td>' +
        '<td>' + esc(hc.name || '&mdash;') + '</td>' +
        '<td>' + statusBadge(ans.epos) + '</td>' +
        '<td>' + statusBadge(ans.payments) + '</td>' +
        '<td>' + statusBadge(ans.wifi) + '</td>' +
        '<td>' + statusBadge(ans.printer) + '</td>' +
        '<td>' + statusBadge(ans.bookings) + '</td>' +
        '<td>' + d.toLocaleDateString('en-GB',{day:'numeric',month:'short'}) + ' ' + d.toLocaleTimeString('en-GB',{hour:'2-digit',minute:'2-digit'}) + '</td>' +
        '</tr>';
    }).join('') +
    '</tbody></table>';
}
function renderDocList(docs){const dl=document.getElementById('docList');if(!docs||!docs.length){dl.innerHTML='<div class="empty">No documents uploaded yet</div>';return;}dl.innerHTML=docs.map(d=>{const fn=esc(d.filename),date=new Date(d.created_at).toLocaleDateString('en-GB'),jfn=JSON.stringify(d.filename);return '<div class="doc-row"><div class="doc-left"><div class="doc-icon">&#x1F4C4;</div><div><div class="doc-name">'+fn+'</div><div class="doc-date">'+date+'</div></div></div><div class="doc-right"><span class="badge-indexed">Indexed</span><button class="btn-del" onclick="deleteDoc('+jfn+',this)">Delete</button></div></div>';}).join('');}

async function deleteDoc(fn,btn){if(!confirm('Delete "'+fn+'"?'))return;btn.disabled=true;btn.textContent='Deleting...';try{const r=await fetch('/documents?filename='+encodeURIComponent(fn),{method:'DELETE'});const d=await r.json();if(d.ok){notify(fn+' deleted','green');btn.closest('.doc-row').remove();setTimeout(loadAnalytics,500);}else{notify('Delete failed','red');btn.disabled=false;btn.textContent='Delete';}}catch(e){notify('Error: '+e.message,'red');btn.disabled=false;}}
function dragOver(e){e.preventDefault();document.getElementById('dropZone').classList.add('dragging');}
function dragLeave(){document.getElementById('dropZone').classList.remove('dragging');}
function dropFiles(e){e.preventDefault();document.getElementById('dropZone').classList.remove('dragging');handleFiles(e.dataTransfer.files);}
async function handleFiles(files){const ul=document.getElementById('uploadList');for(const file of files){const id='pb_'+file.name.replace(/\\W/g,'');const item=document.createElement('div');item.className='upload-item';item.innerHTML='<div><strong>'+esc(file.name)+'</strong> <span style="color:#94a3b8">'+(file.size/1024).toFixed(0)+' KB</span><div class="prog-wrap"><div class="prog-bar" id="'+id+'"></div></div></div>';ul.appendChild(item);try{const text=await new Promise((res,rej)=>{const r=new FileReader();r.onload=e=>res(e.target.result);r.onerror=rej;r.readAsText(file);});const pb=document.getElementById(id);if(pb)pb.style.width='50%';await fetch('/upload',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({filename:file.name,content:text})});if(pb)pb.style.width='100%';item.innerHTML+=' <span style="color:#16a34a;font-size:12px;font-weight:600">&#x2713; Indexed</span>';notify(file.name+' indexed!','green');setTimeout(loadAnalytics,1000);}catch(e){item.innerHTML+=' <span style="color:#dc2626;font-size:12px">Failed</span>';notify('Failed: '+file.name,'red');}}}
function notify(msg,type=''){const t=document.getElementById('toast');t.textContent=msg;t.className='toast '+type+' show';setTimeout(()=>t.className='toast',3500);}

function vDragOver(e){e.preventDefault();document.getElementById('videoDrop').classList.add('drag-over');}
function vDragLeave(){document.getElementById('videoDrop').classList.remove('drag-over');}
function vDrop(e){e.preventDefault();document.getElementById('videoDrop').classList.remove('drag-over');handleVideoFiles(e.dataTransfer.files);}
async function handleVideoFiles(files){const list=document.getElementById('videoUploadList');for(const file of files){if(!file.type.startsWith('video/')){notify('Only video files please','red');continue;}const itemId='vup_'+Date.now();const item=document.createElement('div');item.style.cssText='padding:8px 12px;background:var(--surface2);border-radius:6px;font-size:12px;margin-bottom:6px;border:1px solid var(--border)';item.textContent=file.name;list.appendChild(item);try{const b64=await new Promise((res,rej)=>{const reader=new FileReader();reader.onload=e=>res(e.target.result);reader.onerror=rej;reader.readAsDataURL(file);});const r=await fetch('/videos/add',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({url:b64,title:file.name.replace(/\\.[^.]+$/,''),description:'',type:'mp4',is_upload:true})});const data=await r.json();if(data.ok){notify('Video uploaded!','green');loadVideos();}else{notify('Upload error: '+(data.error||'unknown'),'red');}}catch(e){notify('Upload failed: '+e.message,'red');}}}
async function addVideo(){const u=document.getElementById('vidUrl').value.trim();if(!u){notify('Paste a URL first','red');return;}const t=document.getElementById('vidTitle').value.trim();const d=document.getElementById('vidDesc').value.trim();const cat=document.getElementById('vidCat').value;const btn=document.getElementById('addVidBtn');btn.disabled=true;btn.textContent='Adding...';try{const r=await fetch('/videos/add',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({url:u,title:t,description:d,category:cat})});const data=await r.json();if(data.ok){notify('Video added!','green');['vidUrl','vidTitle','vidDesc'].forEach(id=>document.getElementById(id).value='');document.getElementById('vidCat').value='';loadVideos();}else{notify('Error: '+(data.error||'unknown'),'red');}}catch(e){notify('Error: '+e.message,'red');}btn.disabled=false;btn.textContent='+ Add';}

let _ytResults=[];
async function searchYouTube(){
  const q=document.getElementById('ytSearch').value.trim();
  if(!q){notify('Enter a vendor name to search','red');return;}
  const btn=document.getElementById('ytSearchBtn');btn.disabled=true;btn.textContent='Searching...';
  try{
    const r=await fetch('/youtube/search?q='+encodeURIComponent(q)+'&max=12');
    const data=await r.json();
    btn.disabled=false;btn.textContent='🔍 Search';
    if(data.error){
      if(data.error.includes('YOUTUBE_API_KEY')){document.getElementById('ytNoKey').style.display='';document.getElementById('ytResults').style.display='none';}
      else notify('YouTube error: '+data.error,'red');
      return;
    }
    document.getElementById('ytNoKey').style.display='none';
    _ytResults=data.items||[];
    document.getElementById('ytResultCount').textContent=_ytResults.length+' results for "'+q+'"';
    document.getElementById('ytResults').style.display='';
    renderYtGrid(_ytResults);
  }catch(e){btn.disabled=false;btn.textContent='🔍 Search';notify('Search failed: '+e.message,'red');}
}
function renderYtGrid(items){
  const grid=document.getElementById('ytGrid');
  if(!items.length){grid.innerHTML='<div class="empty">No results</div>';return;}
  grid.innerHTML=items.map((v,i)=>'<div class="video-card" id="ytc'+i+'" style="cursor:pointer;position:relative" onclick="ytToggle('+i+',this)">'+
    '<div style="position:absolute;top:8px;left:8px;z-index:2;width:22px;height:22px;border-radius:4px;border:2px solid #fff;background:rgba(0,0,0,0.4);display:flex;align-items:center;justify-content:center" id="ytchk'+i+'"></div>'+
    '<img class="video-thumb" src="'+esc(v.thumbnail)+'" onerror="imgErr(this)">'+
    '<div class="video-info"><div class="video-title">'+esc(v.title)+'</div>'+
    '<div class="video-desc">'+esc(v.channel)+'</div>'+
    '<div class="video-footer"><span class="vbadge youtube">YouTube</span></div></div></div>').join('');
  updateYtSelCount();
}
function ytToggle(i,card){
  const chk=document.getElementById('ytchk'+i);
  const selected=card.dataset.selected==='1';
  if(selected){card.dataset.selected='0';card.style.outline='';chk.innerHTML='';chk.style.background='rgba(0,0,0,0.4)';}
  else{card.dataset.selected='1';card.style.outline='2px solid var(--blue)';chk.innerHTML='✓';chk.style.background='var(--blue)';chk.style.color='#fff';chk.style.fontWeight='700';chk.style.fontSize='13px';}
  updateYtSelCount();
}
function ytSelectAll(){
  document.querySelectorAll('#ytGrid .video-card').forEach((card,i)=>{
    card.dataset.selected='1';card.style.outline='2px solid var(--blue)';
    const chk=document.getElementById('ytchk'+i);if(chk){chk.innerHTML='✓';chk.style.background='var(--blue)';chk.style.color='#fff';chk.style.fontWeight='700';chk.style.fontSize='13px';}
  });
  updateYtSelCount();
}
function updateYtSelCount(){
  const n=document.querySelectorAll('#ytGrid .video-card[data-selected="1"]').length;
  document.getElementById('ytSelCount').textContent=n;
  document.getElementById('ytImportBtn').style.display=n>0?'':'none';
}
async function importSelected(){
  const cat=document.getElementById('ytCategory').value;
  const selected=[];
  document.querySelectorAll('#ytGrid .video-card[data-selected="1"]').forEach(card=>{
    const i=parseInt(card.id.replace('ytc',''));
    if(!isNaN(i)&&_ytResults[i])selected.push(_ytResults[i]);
  });
  if(!selected.length){notify('Select at least one video','red');return;}
  const btn=document.getElementById('ytImportBtn');btn.disabled=true;btn.innerHTML='Importing...';
  try{
    const r=await fetch('/youtube/import',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({videos:selected,category:cat})});
    const data=await r.json();
    if(data.ok){notify('Imported '+data.added+' video'+(data.added!==1?'s':'')+'!','green');loadVideos();document.getElementById('ytResults').style.display='none';document.getElementById('ytSearch').value='';}
    else notify('Import error: '+(data.error||'unknown'),'red');
  }catch(e){notify('Error: '+e.message,'red');}
  btn.disabled=false;btn.innerHTML='&#x2B07; Import selected (<span id="ytSelCount">0</span>)';
}

let _allVideos=[], _videoFilter='';
function filterVideos(cat,btn){
  document.querySelectorAll('.filter-btn').forEach(b=>b.classList.remove('active'));
  if(btn)btn.classList.add('active');
  _videoFilter=cat;
  const filtered=cat?_allVideos.filter(v=>(v.category||'')=== cat):_allVideos;
  renderVideoGrid(filtered);
}
function renderVideoGrid(vids){
  var el=document.getElementById('videoGrid');
  const vc=document.getElementById('videoCount');
  if(vc)vc.textContent=_allVideos.length+' video'+(  _allVideos.length!==1?'s':'')+' in library';
  el.innerHTML='';
  if(!Array.isArray(vids)||!vids.length){var emp=document.createElement('div');emp.className='empty';emp.textContent='No videos'+(  _videoFilter?' in this category':' yet')+'.';el.appendChild(emp);return;}
  const catLabels={epos:'EPOS',payments:'Payments',wifi:'WiFi',printer:'Printers',bookings:'Bookings',workforce:'Workforce',ordering:'Ordering',loyalty:'Loyalty',general:'General'};
  vids.forEach(function(v){var card=document.createElement('div');card.className='video-card';var thumbEl;if(v.thumbnail){thumbEl=document.createElement('img');thumbEl.className='video-thumb';thumbEl.src=v.thumbnail;}else{thumbEl=document.createElement('div');thumbEl.className='video-thumb-empty';thumbEl.textContent=v.type==='youtube'?'▶':'🎬';}thumbEl.dataset.v=encodeURIComponent(JSON.stringify(v));thumbEl.onclick=function(){playVideoEnc(this.dataset.v);};card.appendChild(thumbEl);var info=document.createElement('div');info.className='video-info';var titleEl=document.createElement('div');titleEl.className='video-title';titleEl.textContent=v.title||'Untitled';info.appendChild(titleEl);if(v.description){var descEl=document.createElement('div');descEl.className='video-desc';descEl.textContent=v.description;info.appendChild(descEl);}var footer=document.createElement('div');footer.className='video-footer';var badge=document.createElement('span');badge.className='vbadge '+(v.type||'mp4');badge.textContent=(v.type||'').toLowerCase()==='youtube'?'YouTube':'MP4';var catBadge='';if(v.category&&catLabels[v.category]){var cb=document.createElement('span');cb.className='vbadge';cb.style.cssText='background:var(--surface2);color:var(--text2);border:1px solid var(--border)';cb.textContent=catLabels[v.category];footer.appendChild(cb);}var delBtn=document.createElement('button');delBtn.className='btn-del';delBtn.textContent='Delete';delBtn.dataset.id=v.id;delBtn.onclick=function(){deleteVideo(this.dataset.id,this);};footer.appendChild(badge);footer.appendChild(delBtn);info.appendChild(footer);card.appendChild(info);el.appendChild(card);});
}
async function loadVideos(){var el=document.getElementById('videoGrid');if(!el)return;el.innerHTML='<div class="empty" style="color:var(--text3)">Loading...</div>';try{var r=await fetch('/videos');var vids=await r.json();_allVideos=Array.isArray(vids)?vids:[];renderVideoGrid(_videoFilter?_allVideos.filter(v=>(v.category||'')===_videoFilter):_allVideos);}catch(e){el.innerHTML='<div class="empty" style="color:var(--red)">Error: '+e.message+'</div>';}}
function playVideoEnc(enc){playVideo(JSON.parse(decodeURIComponent(enc)));}
function playVideo(v){document.getElementById('vmodalTitle').textContent=v.title||'Video';var body=document.getElementById('vmodalBody');while(body.firstChild)body.removeChild(body.firstChild);if(v.type==='youtube'&&v.yt_id){var ifr=document.createElement('iframe');ifr.src='https://www.youtube.com/embed/'+v.yt_id+'?autoplay=1&rel=0';ifr.frameBorder='0';ifr.allowFullscreen=true;ifr.setAttribute('allow','autoplay;encrypted-media;fullscreen');ifr.style.cssText='display:block;width:100%;aspect-ratio:16/9';body.appendChild(ifr);}else{var vid=document.createElement('video');vid.src=v.url;vid.controls=true;vid.autoplay=true;vid.style.cssText='width:100%;aspect-ratio:16/9';body.appendChild(vid);}document.getElementById('vmodal').style.display='flex';}
function closeVModal(){document.getElementById('vmodal').style.display='none';var b=document.getElementById('vmodalBody');while(b.firstChild)b.removeChild(b.firstChild);}
async function deleteVideo(id,btn){if(!confirm('Delete this video?'))return;btn.disabled=true;try{await fetch('/videos/'+id,{method:'DELETE'});notify('Deleted','green');loadVideos();}catch(e){notify('Error: '+e.message,'red');btn.disabled=false;}}

// ─── BRANDING MODAL ───────────────────────────────────────────────────────
let _allVenues = [];
async function showBrandingModal() {
  document.getElementById('brandingModal').style.display = 'flex';
  if (!_allVenues.length) {
    try {
      const r = await fetch('/venues/all');
      _allVenues = await r.json();
      const sel = document.getElementById('bVenueSelect');
      sel.innerHTML = '<option value="">Select a venue...</option>' +
        _allVenues.map(v => '<option value="' + esc(v.id) + '" data-slug="' + esc(v.slug||'') + '">' + esc(v.name) + '</option>').join('');
      sel.onchange = function() {
        const opt = this.options[this.selectedIndex];
        const venue = _allVenues.find(v => String(v.id) === this.value);
        if (venue) {
          if (venue.logo_url) document.getElementById('bLogoUrl').value = venue.logo_url;
          if (venue.primary_color) { document.getElementById('bColorHex').value = venue.primary_color; document.getElementById('bColorPicker').value = venue.primary_color; }
          if (venue.bot_name) document.getElementById('bBotName').value = venue.bot_name;
          if (venue.welcome_message) document.getElementById('bWelcomeMsg').value = venue.welcome_message;
          if (venue.welcome_heading) document.getElementById('bWelcomeHeading').value = venue.welcome_heading;
          document.getElementById('bWhiteLabel').checked = !!venue.white_label;
          updatePreview();
        }
      };
    } catch(e) { notify('Could not load venues', 'red'); }
  }
  updatePreview();
}
function closeBrandingModal() { document.getElementById('brandingModal').style.display = 'none'; }
function syncColor(hex) {
  if (/^#[0-9a-fA-F]{6}$/.test(hex)) document.getElementById('bColorPicker').value = hex;
  updatePreview();
}
document.addEventListener('DOMContentLoaded', function() {
  var cp = document.getElementById('bColorPicker');
  if (cp) cp.oninput = function() { document.getElementById('bColorHex').value = this.value; updatePreview(); };
  ['bLogoUrl','bBotName','bWelcomeMsg'].forEach(function(id) {
    var el = document.getElementById(id); if (el) el.oninput = updatePreview;
  });
  var logoInput = document.getElementById('bLogoUrl');
  if (logoInput) {
    logoInput.addEventListener('blur', async function() {
      var url = this.value.trim();
      if (!url) { showLogoUrlError(null); return; }
      var result = await validateLogoUrl(url);
      showLogoUrlError(result.ok ? null : result.msg);
    });
    logoInput.addEventListener('input', function() { showLogoUrlError(null); });
  }
});
function updatePreview() {
  var logo = document.getElementById('bLogoUrl').value.trim();
  var name = document.getElementById('bBotName').value.trim() || 'Your Bot';
  var color = document.getElementById('bColorHex').value.trim() || '#E8573C';
  var sel = document.getElementById('bVenueSelect');
  var opt = sel ? sel.options[sel.selectedIndex] : null;
  var slug = opt ? (opt.dataset ? opt.dataset.slug : '') : '';
  var previewLogo = document.getElementById('bPreviewLogo');
  if (logo) { previewLogo.src = logo; previewLogo.style.display = ''; } else { previewLogo.style.display = 'none'; }
  document.getElementById('bPreviewName').textContent = name;
  document.getElementById('bPreviewSwatch').style.background = color;
  document.getElementById('bPreviewUrl').textContent = slug ? 'stackedchat.io/chat/' + slug : '';
}

// Validate logo URL: check extension + attempt to load as image
function validateLogoUrl(url) {
  return new Promise(function(resolve) {
    if (!url) { resolve({ ok: true }); return; }
    // Clearbit logos and data URIs are OK without extension check
    var isClearbit = /logo\\.clearbit\\.com/i.test(url);
    var isDataUri = /^data:image\\//i.test(url);
    var hasImageExt = /\\.(png|jpg|jpeg|svg|webp|gif)(\\?|$|#)/i.test(url);
    if (!isClearbit && !isDataUri && !hasImageExt) {
      resolve({ ok: false, msg: 'URL doesn\\'t look like an image. Use a direct link ending in .png, .svg, .jpg, or a Clearbit URL like logo.clearbit.com/domain.com' });
      return;
    }
    // Try to load the image
    var img = new Image();
    var done = false;
    var timer = setTimeout(function() { if (!done) { done = true; resolve({ ok: false, msg: 'Image took too long to load. Check the URL is correct and publicly accessible.' }); } }, 6000);
    img.onload = function() { if (!done) { done = true; clearTimeout(timer); resolve({ ok: true }); } };
    img.onerror = function() { if (!done) { done = true; clearTimeout(timer); resolve({ ok: false, msg: 'Image failed to load. Make sure the URL points to an actual image file, not a webpage.' }); } };
    img.src = url;
  });
}

function showLogoUrlError(msg) {
  var el = document.getElementById('bLogoUrlError');
  var input = document.getElementById('bLogoUrl');
  if (msg) {
    el.textContent = msg;
    el.style.display = 'block';
    if (input) input.style.borderColor = '#dc2626';
  } else {
    el.style.display = 'none';
    el.textContent = '';
    if (input) input.style.borderColor = '';
  }
}
async function saveBranding() {
  var venueId = document.getElementById('bVenueSelect').value;
  if (!venueId) { notify('Select a venue first', 'red'); return; }
  var logoUrl = document.getElementById('bLogoUrl').value.trim();
  if (logoUrl) {
    var logoCheck = await validateLogoUrl(logoUrl);
    if (!logoCheck.ok) { showLogoUrlError(logoCheck.msg); notify('Fix the logo URL before saving', 'red'); return; }
  }
  var btn = document.getElementById('bSaveBtn'); btn.disabled = true; btn.textContent = 'Saving...';
  var payload = {
    logo_url: document.getElementById('bLogoUrl').value.trim() || null,
    primary_color: document.getElementById('bColorHex').value.trim() || null,
    bot_name: document.getElementById('bBotName').value.trim() || null,
    welcome_message: document.getElementById('bWelcomeMsg').value.trim() || null,
    welcome_heading: document.getElementById('bWelcomeHeading').value.trim() || null,
    white_label: document.getElementById('bWhiteLabel').checked
  };
  try {
    var r = await fetch('/venue/' + venueId + '/branding', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
    var data = await r.json();
    if (data.ok) {
      notify('Branding saved!', 'green');
      _allVenues = []; // reset cache
      closeBrandingModal();
      loadAnalytics();
    } else { notify('Error: ' + (data.error || 'unknown'), 'red'); }
  } catch(e) { notify('Error: ' + e.message, 'red'); }
  btn.disabled = false; btn.textContent = 'Save branding';
}

loadAnalytics();
loadVideos();
setInterval(loadAnalytics,60000);
</script>
</body>
</html>`;

const PORT = process.env.PORT || 8080;

const server = http.createServer(async (req, res) => {
  const url = req.url;
  const method = req.method;

  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,DELETE,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (method === 'OPTIONS') { res.writeHead(200); res.end(); return; }

  if (url === '/health') {
    res.writeHead(200, {'Content-Type':'application/json'});
    res.end(JSON.stringify({status:'ok'})); return;
  }

  if (url === '/admin' || url === '/admin/') {
    res.writeHead(200, {'Content-Type':'text/html'});
    res.end(ADMIN_PAGE); return;
  }

  // Operator-facing redesign shell (sidebar + topbar, no screens yet).
  // See CLAUDE.md step 2. Screens land at #triage / #issues / etc.
  if (url === '/app' || url === '/app/' || url.startsWith('/app#')) {
    res.writeHead(200, {'Content-Type':'text/html'});
    res.end(APP_SHELL); return;
  }

  if (url === '/analytics') {
    const data = await getAnalytics();
    res.writeHead(200, {'Content-Type':'application/json'});
    res.end(JSON.stringify(data)); return;
  }

  // ─── VENUE SEARCH ──────────────────────────────────────────────────────
  if (method === 'GET' && url.startsWith('/venues/search')) {
    try {
      const params = new URL(url, 'http://localhost');
      const q = params.searchParams.get('q') || '';
      if (q.length < 2) { res.writeHead(200, {'Content-Type':'application/json'}); res.end(JSON.stringify([])); return; }
      // ilike is case-insensitive contains
      const r = await sbFetch('/rest/v1/venues?select=id,name,slug&name=ilike.*' + encodeURIComponent(q) + '*&limit=5', {
        headers: { 'Prefer': 'return=representation' }
      });
      res.writeHead(200, {'Content-Type':'application/json'});
      res.end(JSON.stringify(Array.isArray(r.data) ? r.data : []));
    } catch(e) {
      res.writeHead(200, {'Content-Type':'application/json'});
      res.end(JSON.stringify([]));
    }
    return;
  }

  // ─── VENUE CREATE / JOIN ───────────────────────────────────────────────
  if (method === 'POST' && url === '/venues') {
    let body = '';
    req.on('data', c => body += c);
    req.on('end', async () => {
      try {
        const { id, name, isNew } = JSON.parse(body);

        // If they picked an existing venue, just return its id
        if (!isNew && id) {
          res.writeHead(200, {'Content-Type':'application/json'});
          res.end(JSON.stringify({ venue_id: id })); return;
        }

        // Create new venue
        const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
        const r = await sbFetch('/rest/v1/venues', {
          method: 'POST',
          headers: { 'Prefer': 'return=representation' },
          body: { name, slug, tech_stack: {} }
        });
        const venue = Array.isArray(r.data) ? r.data[0] : null;
        if (venue && venue.id) {
          res.writeHead(200, {'Content-Type':'application/json'});
          res.end(JSON.stringify({ venue_id: venue.id, created: true }));
        } else {
          // Venue may already exist with that slug - try to find it
          const existing = await sbFetch('/rest/v1/venues?select=id,name&slug=eq.' + encodeURIComponent(slug) + '&limit=1');
          const found = Array.isArray(existing.data) ? existing.data[0] : null;
          res.writeHead(200, {'Content-Type':'application/json'});
          res.end(JSON.stringify({ venue_id: found ? found.id : null }));
        }
      } catch(e) {
        console.error('[/venues POST]', e.message);
        res.writeHead(200, {'Content-Type':'application/json'});
        res.end(JSON.stringify({ venue_id: null, error: e.message }));
      }
    }); return;
  }

  // ─── VENUE MEMBERS ─────────────────────────────────────────────────────
  if (method === 'POST' && url === '/venue-members') {
    let body = '';
    req.on('data', c => body += c);
    req.on('end', async () => {
      try {
        const payload = JSON.parse(body);
        // Self-serve roles: the FIRST member of a venue becomes its admin;
        // everyone after is staff. Never downgrade an existing admin.
        let role = 'staff';
        try {
          const ex = await sbFetch('/rest/v1/venue_members?venue_id=eq.' + encodeURIComponent(payload.venue_id || '') + '&select=email,role&limit=200');
          if (Array.isArray(ex.data)) {
            const mine = ex.data.find(m => (m.email || '').toLowerCase() === (payload.email || '').toLowerCase());
            if (mine) role = mine.role || 'staff';        // keep existing role
            else if (ex.data.length === 0) role = 'admin'; // first ever member
          }
        } catch(e) { /* table/role lookup issue — default staff */ }
        payload.role = role;
        // Upsert on email+venue_id to avoid duplicates
        await sbFetch('/rest/v1/venue_members?on_conflict=email,venue_id', {
          method: 'POST',
          headers: { 'Prefer': 'resolution=merge-duplicates,return=minimal' },
          body: payload
        });
        res.writeHead(200, {'Content-Type':'application/json'});
        res.end(JSON.stringify({ok:true, role}));
      } catch(e) {
        res.writeHead(200, {'Content-Type':'application/json'});
        res.end(JSON.stringify({ok:false,error:e.message}));
      }
    }); return;
  }

  // ─── TEAM: list members of a venue (manage-team) ──────────────────────────
  if (method === 'POST' && url === '/team-list') {
    let body = '';
    req.on('data', c => body += c);
    req.on('end', async () => {
      try {
        const { venue_id } = JSON.parse(body);
        const r = await sbFetch('/rest/v1/venue_members?venue_id=eq.' + encodeURIComponent(venue_id || '') + '&select=name,email,role,created_at&order=created_at.asc&limit=200');
        res.writeHead(200, {'Content-Type':'application/json'});
        res.end(JSON.stringify({ ok:true, members: Array.isArray(r.data) ? r.data : [] }));
      } catch(e) {
        res.writeHead(200, {'Content-Type':'application/json'});
        res.end(JSON.stringify({ ok:false, error:e.message, members:[] }));
      }
    }); return;
  }

  // ─── TEAM: change a member's role (admin only; protect the last admin) ────
  if (method === 'POST' && url === '/set-role') {
    let body = '';
    req.on('data', c => body += c);
    req.on('end', async () => {
      try {
        const { venue_id, target_email, role, token } = JSON.parse(body);
        if (!venue_id || !target_email || (role !== 'admin' && role !== 'staff')) {
          res.writeHead(400, {'Content-Type':'application/json'}); res.end(JSON.stringify({ok:false,error:'bad request'})); return;
        }
        const vEmail = await verifyAuthEmail(token);
        if (!vEmail) { res.writeHead(401, {'Content-Type':'application/json'}); res.end(JSON.stringify({ok:false,error:'Please verify your email first'})); return; }
        const r = await sbFetch('/rest/v1/venue_members?venue_id=eq.' + encodeURIComponent(venue_id) + '&select=email,role&limit=200');
        const members = Array.isArray(r.data) ? r.data : [];
        const actor = members.find(m => (m.email || '').toLowerCase() === vEmail);
        if (!actor || actor.role !== 'admin') {
          res.writeHead(403, {'Content-Type':'application/json'}); res.end(JSON.stringify({ok:false,error:'admins only'})); return;
        }
        const admins = members.filter(m => m.role === 'admin');
        const target = members.find(m => (m.email || '').toLowerCase() === (target_email || '').toLowerCase());
        if (role === 'staff' && target && target.role === 'admin' && admins.length <= 1) {
          res.writeHead(409, {'Content-Type':'application/json'}); res.end(JSON.stringify({ok:false,error:"Can't remove the last admin"})); return;
        }
        await sbFetch('/rest/v1/venue_members?venue_id=eq.' + encodeURIComponent(venue_id) + '&email=eq.' + encodeURIComponent(target_email), {
          method: 'PATCH', headers: { 'Prefer':'return=minimal' }, body: { role }
        });
        res.writeHead(200, {'Content-Type':'application/json'});
        res.end(JSON.stringify({ ok:true, role }));
      } catch(e) {
        res.writeHead(200, {'Content-Type':'application/json'});
        res.end(JSON.stringify({ ok:false, error:e.message }));
      }
    }); return;
  }

  // ─── TICKET CLOSE ──────────────────────────────────────────────────────
  if (method === 'POST' && url.startsWith('/ticket/') && url.endsWith('/close')) {
    const id = url.split('/')[2];
    await sbFetch(`/rest/v1/tickets?id=eq.${id}`, {method:'PATCH', body:{status:'closed'}});
    res.writeHead(200, {'Content-Type':'application/json'});
    res.end(JSON.stringify({ok:true})); return;
  }

  // ─── DELETE DOCUMENT ───────────────────────────────────────────────────
  if (method === 'DELETE' && url.startsWith('/documents')) {
    try {
      const params = new URL(url, 'http://localhost');
      const filename = params.searchParams.get('filename');
      if (!filename) { res.writeHead(400, {'Content-Type':'application/json'}); res.end(JSON.stringify({ok:false,error:'No filename provided'})); return; }
      const https = require('https');
      const sbUrl = new URL(`${SUPABASE_URL}/rest/v1/documents?filename=eq.${encodeURIComponent(filename)}`);
      const statusCode = await new Promise((resolve, reject) => {
        const req2 = https.request({
          hostname: sbUrl.hostname, path: sbUrl.pathname + sbUrl.search, method: 'DELETE',
          headers: { 'apikey': SUPABASE_KEY, 'Authorization': `Bearer ${SUPABASE_KEY}`, 'Content-Type': 'application/json', 'Prefer': 'return=minimal' }
        }, (r) => {
          let d = ''; r.on('data', c => d += c); r.on('end', () => resolve(r.statusCode));
        });
        req2.on('error', reject); req2.end();
      });
      res.writeHead(200, {'Content-Type':'application/json'});
      res.end(JSON.stringify(statusCode === 204 || statusCode === 200 ? {ok:true,deleted:filename} : {ok:false,error:'Supabase returned '+statusCode}));
    } catch(e) {
      res.writeHead(500, {'Content-Type':'application/json'});
      res.end(JSON.stringify({ok:false,error:e.message}));
    }
    return;
  }

  // ─── UPLOAD DOCUMENT ───────────────────────────────────────────────────
  if (method === 'POST' && url === '/upload') {
    let body = '';
    req.on('data', c => body += c);
    req.on('end', async () => {
      try {
        const { filename, content } = JSON.parse(body);
        const chunks = chunkText(content, filename);
        for (const chunk of chunks) await sbFetch('/rest/v1/documents', {method:'POST', body:chunk});
        res.writeHead(200, {'Content-Type':'application/json'});
        res.end(JSON.stringify({ok:true, chunks:chunks.length}));
      } catch(e) {
        res.writeHead(500, {'Content-Type':'application/json'});
        res.end(JSON.stringify({error:e.message}));
      }
    }); return;
  }

  // ─── KB UPLOAD (in-chat "+" — admin-only, private to the workspace) ───────
  if (method === 'POST' && url === '/kb-upload') {
    let body = '';
    req.on('data', c => body += c);
    req.on('end', async () => {
      try {
        const { filename, content, venue_id, token, file_url } = JSON.parse(body);
        if (!filename || !content || !venue_id) {
          res.writeHead(400, {'Content-Type':'application/json'}); res.end(JSON.stringify({ok:false,error:'missing fields'})); return;
        }
        // Verified-admin guard: caller must hold a valid session (email-code verified).
        const vEmail = await verifyAuthEmail(token);
        if (!vEmail) { res.writeHead(401, {'Content-Type':'application/json'}); res.end(JSON.stringify({ok:false,error:'Please verify your email first'})); return; }
        const mem = await sbFetch('/rest/v1/venue_members?venue_id=eq.' + encodeURIComponent(venue_id) + '&select=email,role&limit=200');
        const me = (Array.isArray(mem.data) ? mem.data : []).find(m => (m.email || '').toLowerCase() === vEmail);
        if (!me || me.role !== 'admin') {
          res.writeHead(403, {'Content-Type':'application/json'}); res.end(JSON.stringify({ok:false,error:'Only admins can add knowledge'})); return;
        }
        // Resolve (or create) the venue's workspace so the doc stays private to it.
        let workspaceId = null;
        const vr = await sbFetch('/rest/v1/venues?id=eq.' + encodeURIComponent(venue_id) + '&select=workspace_id,slug&limit=1');
        const v = (Array.isArray(vr.data) && vr.data[0]) ? vr.data[0] : null;
        if (v && v.workspace_id) {
          workspaceId = v.workspace_id;
        } else {
          workspaceId = (v && v.slug) ? v.slug : venue_id;
          await sbFetch('/rest/v1/venues?id=eq.' + encodeURIComponent(venue_id), { method:'PATCH', headers:{'Prefer':'return=minimal'}, body:{ workspace_id: workspaceId } });
        }
        const chunks = chunkText(content, filename).map(c => Object.assign(c, { workspace_id: workspaceId }));
        // Store the original file's URL on each chunk so the bot can offer it as a
        // shareable download link. Falls back gracefully if the file_url column
        // hasn't been added yet (run: ALTER TABLE documents ADD COLUMN file_url text;).
        let storeFileUrl = !!file_url;
        for (const chunk of chunks) {
          const bodyWithUrl = storeFileUrl ? Object.assign({}, chunk, { file_url: file_url }) : chunk;
          const ins = await sbFetch('/rest/v1/documents', { method:'POST', headers:{'Prefer':'return=minimal'}, body: bodyWithUrl });
          if (storeFileUrl && ins && ins.status >= 400) {
            storeFileUrl = false; // file_url column not present — keep going without it
            await sbFetch('/rest/v1/documents', { method:'POST', headers:{'Prefer':'return=minimal'}, body: chunk });
          }
        }
        res.writeHead(200, {'Content-Type':'application/json'});
        res.end(JSON.stringify({ ok:true, chunks: chunks.length, workspace_id: workspaceId }));
      } catch(e) {
        res.writeHead(500, {'Content-Type':'application/json'});
        res.end(JSON.stringify({ ok:false, error:e.message }));
      }
    }); return;
  }

  // ─── ADMIN SUMMARY (scoped analytics + knowledge list, admins only) ───────
  if (method === 'POST' && url === '/admin-summary') {
    let body = '';
    req.on('data', c => body += c);
    req.on('end', async () => {
      try {
        const { venue_id, email } = JSON.parse(body);
        if (!venue_id || !email) { res.writeHead(400, {'Content-Type':'application/json'}); res.end(JSON.stringify({ok:false,error:'missing fields'})); return; }
        const mem = await sbFetch('/rest/v1/venue_members?venue_id=eq.' + encodeURIComponent(venue_id) + '&select=email,role&limit=200');
        const members = Array.isArray(mem.data) ? mem.data : [];
        const me = members.find(m => (m.email || '').toLowerCase() === String(email).toLowerCase());
        if (!me || me.role !== 'admin') { res.writeHead(403, {'Content-Type':'application/json'}); res.end(JSON.stringify({ok:false,error:'Only admins can view this'})); return; }
        const vr = await sbFetch('/rest/v1/venues?id=eq.' + encodeURIComponent(venue_id) + '&select=workspace_id&limit=1');
        const ws = (Array.isArray(vr.data) && vr.data[0]) ? (vr.data[0].workspace_id || null) : null;
        let docs = [];
        if (ws) {
          const d = await sbFetch('/rest/v1/documents?workspace_id=eq.' + encodeURIComponent(ws) + '&select=filename&limit=2000');
          const counts = {};
          (Array.isArray(d.data) ? d.data : []).forEach(x => { counts[x.filename] = (counts[x.filename] || 0) + 1; });
          docs = Object.keys(counts).map(f => ({ filename: f, chunks: counts[f] }));
        }
        const conv = await sbFetch('/rest/v1/conversations?venue_id=eq.' + encodeURIComponent(venue_id) + '&select=messages&limit=500');
        const convs = Array.isArray(conv.data) ? conv.data : [];
        let questions = 0;
        convs.forEach(c => { if (Array.isArray(c.messages)) questions += c.messages.filter(m => m.role === 'user').length; });
        const npsR = await sbFetch('/rest/v1/nps_scores?venue_id=eq.' + encodeURIComponent(venue_id) + '&select=score&limit=500');
        const scores = (Array.isArray(npsR.data) ? npsR.data : []).map(x => x.score).filter(s => typeof s === 'number');
        const avgNps = scores.length ? Math.round((scores.reduce((a, b) => a + b, 0) / scores.length) * 10) / 10 : null;
        res.writeHead(200, {'Content-Type':'application/json'});
        res.end(JSON.stringify({ ok:true, workspace_id: ws, stats: { documents: docs.length, conversations: convs.length, questions: questions, team: members.length, avgNps: avgNps, npsCount: scores.length }, docs: docs }));
      } catch(e) {
        res.writeHead(500, {'Content-Type':'application/json'});
        res.end(JSON.stringify({ ok:false, error:e.message }));
      }
    }); return;
  }

  // ─── KB REMOVE (admin removes a doc from THEIR workspace only) ────────────
  if (method === 'POST' && url === '/kb-remove') {
    let body = '';
    req.on('data', c => body += c);
    req.on('end', async () => {
      try {
        const { venue_id, filename, token } = JSON.parse(body);
        if (!venue_id || !filename) { res.writeHead(400, {'Content-Type':'application/json'}); res.end(JSON.stringify({ok:false,error:'missing fields'})); return; }
        const vEmail = await verifyAuthEmail(token);
        if (!vEmail) { res.writeHead(401, {'Content-Type':'application/json'}); res.end(JSON.stringify({ok:false,error:'Please verify your email first'})); return; }
        const mem = await sbFetch('/rest/v1/venue_members?venue_id=eq.' + encodeURIComponent(venue_id) + '&select=email,role&limit=200');
        const me = (Array.isArray(mem.data) ? mem.data : []).find(m => (m.email || '').toLowerCase() === vEmail);
        if (!me || me.role !== 'admin') { res.writeHead(403, {'Content-Type':'application/json'}); res.end(JSON.stringify({ok:false,error:'Only admins can remove knowledge'})); return; }
        const vr = await sbFetch('/rest/v1/venues?id=eq.' + encodeURIComponent(venue_id) + '&select=workspace_id&limit=1');
        const ws = (Array.isArray(vr.data) && vr.data[0]) ? (vr.data[0].workspace_id || null) : null;
        if (!ws) { res.writeHead(400, {'Content-Type':'application/json'}); res.end(JSON.stringify({ok:false,error:'no workspace'})); return; }
        // Scoped delete: only docs in this workspace with this filename.
        await sbFetch('/rest/v1/documents?workspace_id=eq.' + encodeURIComponent(ws) + '&filename=eq.' + encodeURIComponent(filename), { method:'DELETE', headers:{'Prefer':'return=minimal'} });
        res.writeHead(200, {'Content-Type':'application/json'});
        res.end(JSON.stringify({ ok:true }));
      } catch(e) {
        res.writeHead(500, {'Content-Type':'application/json'});
        res.end(JSON.stringify({ ok:false, error:e.message }));
      }
    }); return;
  }

  // ─── KB VIDEO (admin registers a video, scoped to their workspace) ────────
  // File bytes are uploaded client-side to Supabase Storage; this just records
  // the resulting URL in the videos table tagged with the workspace (tenant).
  if (method === 'POST' && url === '/kb-video') {
    let body = '';
    req.on('data', c => body += c);
    req.on('end', async () => {
      try {
        const { url: videoUrl, title, venue_id, token } = JSON.parse(body);
        if (!videoUrl || !venue_id) { res.writeHead(400, {'Content-Type':'application/json'}); res.end(JSON.stringify({ok:false,error:'missing fields'})); return; }
        const vEmail = await verifyAuthEmail(token);
        if (!vEmail) { res.writeHead(401, {'Content-Type':'application/json'}); res.end(JSON.stringify({ok:false,error:'Please verify your email first'})); return; }
        const mem = await sbFetch('/rest/v1/venue_members?venue_id=eq.' + encodeURIComponent(venue_id) + '&select=email,role&limit=200');
        const me = (Array.isArray(mem.data) ? mem.data : []).find(m => (m.email || '').toLowerCase() === vEmail);
        if (!me || me.role !== 'admin') { res.writeHead(403, {'Content-Type':'application/json'}); res.end(JSON.stringify({ok:false,error:'Only admins can add videos'})); return; }
        const vr = await sbFetch('/rest/v1/venues?id=eq.' + encodeURIComponent(venue_id) + '&select=workspace_id,slug&limit=1');
        const v = (Array.isArray(vr.data) && vr.data[0]) ? vr.data[0] : null;
        let workspaceId = (v && v.workspace_id) ? v.workspace_id : null;
        if (!workspaceId) {
          workspaceId = (v && v.slug) ? v.slug : venue_id;
          await sbFetch('/rest/v1/venues?id=eq.' + encodeURIComponent(venue_id), { method:'PATCH', headers:{'Prefer':'return=minimal'}, body:{ workspace_id: workspaceId } });
        }
        let type = 'mp4', thumbnail = '', ytId = null;
        const ytMatch = String(videoUrl).match(/(?:youtube\.com\/watch\?v=|youtu\.be\/|youtube\.com\/embed\/)([a-zA-Z0-9_-]{11})/);
        if (ytMatch) { ytId = ytMatch[1]; type = 'youtube'; thumbnail = 'https://img.youtube.com/vi/' + ytId + '/mqdefault.jpg'; }
        const record = { url: videoUrl, title: title || 'Untitled video', description: '', type, thumbnail, tenant: workspaceId, yt_id: ytId || null };
        const r = await sbFetch('/rest/v1/videos', { method:'POST', headers:{'Prefer':'return=minimal'}, body: record });
        res.writeHead(200, {'Content-Type':'application/json'});
        res.end(JSON.stringify({ ok: r.status < 400, workspace_id: workspaceId }));
      } catch(e) {
        res.writeHead(500, {'Content-Type':'application/json'});
        res.end(JSON.stringify({ ok:false, error:e.message }));
      }
    }); return;
  }

  // ─── KB IMAGE (dish/menu photo the bot can show — admin-only, scoped) ─────
  if (method === 'POST' && url === '/kb-image') {
    let body = '';
    req.on('data', c => body += c);
    req.on('end', async () => {
      try {
        const { url: imgUrl, title, description, venue_id, token } = JSON.parse(body);
        if (!imgUrl || !venue_id || !title) { res.writeHead(400, {'Content-Type':'application/json'}); res.end(JSON.stringify({ok:false,error:'missing fields'})); return; }
        const vEmail = await verifyAuthEmail(token);
        if (!vEmail) { res.writeHead(401, {'Content-Type':'application/json'}); res.end(JSON.stringify({ok:false,error:'Please verify your email first'})); return; }
        const mem = await sbFetch('/rest/v1/venue_members?venue_id=eq.' + encodeURIComponent(venue_id) + '&select=email,role&limit=200');
        const me = (Array.isArray(mem.data) ? mem.data : []).find(m => (m.email || '').toLowerCase() === vEmail);
        if (!me || me.role !== 'admin') { res.writeHead(403, {'Content-Type':'application/json'}); res.end(JSON.stringify({ok:false,error:'Only admins can add images'})); return; }
        const vr = await sbFetch('/rest/v1/venues?id=eq.' + encodeURIComponent(venue_id) + '&select=workspace_id,slug&limit=1');
        const v = (Array.isArray(vr.data) && vr.data[0]) ? vr.data[0] : null;
        let workspaceId = (v && v.workspace_id) ? v.workspace_id : null;
        if (!workspaceId) {
          workspaceId = (v && v.slug) ? v.slug : venue_id;
          await sbFetch('/rest/v1/venues?id=eq.' + encodeURIComponent(venue_id), { method:'PATCH', headers:{'Prefer':'return=minimal'}, body:{ workspace_id: workspaceId } });
        }
        const r = await sbFetch('/rest/v1/images', { method:'POST', headers:{'Prefer':'return=minimal'}, body: { url: imgUrl, title: title, description: description || '', tenant: workspaceId } });
        res.writeHead(200, {'Content-Type':'application/json'});
        res.end(JSON.stringify({ ok: r.status < 400, workspace_id: workspaceId }));
      } catch(e) {
        res.writeHead(500, {'Content-Type':'application/json'});
        res.end(JSON.stringify({ ok:false, error:e.message }));
      }
    }); return;
  }

  // ─── SAVE CONVERSATION ─────────────────────────────────────────────────
  if (method === 'POST' && url === '/save-conversation') {
    let body = '';
    req.on('data', c => body += c);
    req.on('end', async () => {
      try {
        const payload = JSON.parse(body);
        if (payload.id) {
          await sbFetch(`/rest/v1/conversations?id=eq.${payload.id}`, {
            method: 'PATCH',
            headers: { 'Prefer': 'return=representation' },
            body: { messages: payload.messages, updated_at: new Date().toISOString() }
          });
          res.writeHead(200, {'Content-Type':'application/json'}); res.end(JSON.stringify({ok:true,id:payload.id}));
        } else {
          const r = await sbFetch('/rest/v1/conversations', {
            method: 'POST',
            headers: { 'Prefer': 'return=representation' },
            body: payload
          });
          const id = Array.isArray(r.data) ? r.data?.[0]?.id : null;
          res.writeHead(200, {'Content-Type':'application/json'}); res.end(JSON.stringify({ok:true, id}));
        }
      } catch(e) {
        res.writeHead(500); res.end(JSON.stringify({error:e.message}));
      }
    }); return;
  }

  // ─── SAVE TICKET ───────────────────────────────────────────────────────
  if (method === 'POST' && url === '/save-ticket') {
    let body = '';
    req.on('data', c => body += c);
    req.on('end', async () => {
      try {
        const payload = JSON.parse(body);
        await sbFetch('/rest/v1/tickets', { method: 'POST', headers: { 'Prefer': 'return=representation' }, body: payload });
        // Slack notification for user-raised tickets
        sendSlackTicketAlert(payload).catch(e => console.error('Slack ticket alert error:', e));
        res.writeHead(200, {'Content-Type':'application/json'}); res.end(JSON.stringify({ok:true}));
      } catch(e) {
        res.writeHead(500); res.end(JSON.stringify({error:e.message}));
      }
    }); return;
  }

  // ─── SAVE NPS ──────────────────────────────────────────────────────────
  if (method === 'POST' && url === '/save-nps') {
    let body = '';
    req.on('data', c => body += c);
    req.on('end', async () => {
      try {
        const payload = JSON.parse(body);
        await sbFetch('/rest/v1/nps_scores', { method: 'POST', body: payload });
        // Fan-out to the approved-reporting portal. Best-effort, non-blocking —
        // a portal outage must not break the bot's own NPS capture.
        mirrorNpsToPortal(payload).catch(e => console.error('[portal] nps mirror threw', e));
        res.writeHead(200, {'Content-Type':'application/json'}); res.end(JSON.stringify({ok:true}));
      } catch(e) {
        res.writeHead(500); res.end(JSON.stringify({error:e.message}));
      }
    }); return;
  }

  // ─── SAVE LEAD ─────────────────────────────────────────────────────────
  if (method === 'POST' && url === '/save-lead') {
    let body = '';
    req.on('data', c => body += c);
    req.on('end', async () => {
      try {
        const payload = JSON.parse(body);
        await sbFetch('/rest/v1/leads', { method: 'POST', body: payload });
        res.writeHead(200, {'Content-Type':'application/json'}); res.end(JSON.stringify({ok:true}));
      } catch(e) { res.writeHead(500); res.end(JSON.stringify({error:e.message})); }
    }); return;
  }

  // ─── CHAT ──────────────────────────────────────────────────────────────
  if (method === 'POST' && url === '/chat') {
    let body = '';
    req.on('data', c => body += c);
    req.on('end', async () => {
      try {
        const { message, history = [], venue, venue_id, userName, image } = JSON.parse(body);

        // Fetch venue tech stack if we have a venue_id
        let techStackContext = '';
        if (venue_id) {
          try {
            const vr = await sbFetch(`/rest/v1/venues?select=name,tech_stack&id=eq.${venue_id}&limit=1`);
            const venueData = Array.isArray(vr.data) ? vr.data[0] : null;
            if (venueData && venueData.tech_stack && Object.keys(venueData.tech_stack).length > 0) {
              const stack = venueData.tech_stack;
              const stackLines = Object.entries(stack).map(([k,v]) => `- ${k}: ${v}`).join('\n');
              techStackContext = `\n\nVENUE TECH STACK for ${venueData.name}:\n${stackLines}\n\nIMPORTANT: This venue's tech stack is known. Do NOT ask which system they use for any category listed above. Go straight to troubleshooting for their specific product.`;
            }
          } catch(e) { /* proceed without stack context */ }
        }

        const venueContext = venue
          ? `\n\nYou are speaking with ${userName || 'a member of staff'} from ${venue}. Personalise your responses to their venue where relevant.${techStackContext}`
          : techStackContext;

        let docContext = '';
        let docFile = null; // top source doc's shareable file link, if it has one
        // Resolve the asker's workspace (group) so private docs stay isolated.
        let workspaceId = null;
        try {
          if (venue_id) {
            const vR = await sbFetch('/rest/v1/venues?id=eq.' + encodeURIComponent(venue_id) + '&select=workspace_id&limit=1');
            if (Array.isArray(vR.data) && vR.data[0]) workspaceId = vR.data[0].workspace_id || null;
          }
        } catch(e) { /* venues.workspace_id may not exist yet */ }
        try {
          // Scope docs to shared (workspace_id IS NULL) + this workspace's own.
          // IMPORTANT: there are thousands of shared chunks, so a single capped
          // query can crowd out a tenant's few private docs. Fetch the
          // workspace's OWN docs separately (always included) + the shared pool.
          // Falls back to unscoped if the workspace_id column isn't there yet.
          let docsR;
          try {
            const sharedR = await sbFetch('/rest/v1/documents?workspace_id=is.null&select=filename,content,file_url&limit=800');
            if (!sharedR || (sharedR.status && sharedR.status >= 400) || !Array.isArray(sharedR.data)) throw new Error('scoped unavailable');
            let merged = sharedR.data.map(d => Object.assign({ __own: false }, d));
            if (workspaceId) {
              const ownR = await sbFetch('/rest/v1/documents?workspace_id=eq.' + encodeURIComponent(workspaceId) + '&select=filename,content,file_url&limit=400');
              if (Array.isArray(ownR.data) && ownR.data.length) merged = ownR.data.map(d => Object.assign({ __own: true }, d)).concat(merged);
            }
            docsR = { data: merged };
          } catch(scopeErr) {
            const fb = await sbFetch('/rest/v1/documents?select=filename,content&limit=500');
            docsR = { data: (Array.isArray(fb.data) ? fb.data : []).map(d => Object.assign({ __own: false }, d)) };
          }
          if (Array.isArray(docsR.data) && docsR.data.length > 0) {
            const searchText = (message + ' ' + (history.slice(-2).map(m=>m.content).join(' '))).toLowerCase();
            // Drop common/filler words so a venue's own specific doc isn't crowded
            // out of the results by generic shared content that merely matches
            // words like "have", "you", "our", "got".
            const STOP = new Set(['have','has','had','you','your','yours','our','ours','the','and','for','got','get','this','that','these','those','with','can','could','are','was','were','will','would','should','about','what','when','where','which','from','they','them','please','need','want','any','all','its','but','not','how','does','did','who','why','into','out','been','being','some','more','just','than','then','there','here','your','dont','cant','wont','were','our','use','using','one','two']);
            const searchWords = [...new Set(searchText.split(/[\s,?!.;:()\[\]]+/).filter(w => w.length > 2 && !STOP.has(w)))];

            // Score each doc chunk by relevance
            const scored = docsR.data.map(d => {
              const docText = (d.filename + ' ' + d.content).toLowerCase();
              const hits = searchWords.filter(w => docText.includes(w)).length;
              // Find the most relevant section of this doc
              let bestSection = d.content.substring(0, 800);
              if (hits > 0) {
                const lines = d.content.split('\n');
                let bestScore = 0, bestStart = 0;
                for (let i = 0; i < lines.length; i++) {
                  const window = lines.slice(i, i+8).join('\n').toLowerCase();
                  const score = searchWords.filter(w => window.includes(w)).length;
                  if (score > bestScore) { bestScore = score; bestStart = i; }
                }
                bestSection = lines.slice(bestStart, bestStart+12).join('\n');
              }
              return { filename: d.filename, section: bestSection, hits, file_url: d.file_url || null, own: !!d.__own };
            });

            // Always surface the venue's OWN matching docs first (up to 3), then
            // fill the rest from the shared pool — so a tenant's private doc can
            // never be crowded out by the much larger shared corpus.
            const hitDocs = scored.filter(d => d.hits >= 1).sort((a,b) => b.hits-a.hits);
            const ownTop = hitDocs.filter(d => d.own).slice(0, 3);
            const sharedTop = hitDocs.filter(d => !d.own).slice(0, Math.max(0, 5 - ownTop.length));
            const relevant = ownTop.concat(sharedTop);
            if (relevant.length > 0) {
              docContext = '\n\n=== FROM KNOWLEDGE BASE ===\n' +
                relevant.map(d => '[' + d.filename + ']\n' + d.section).join('\n\n');
              // Prefer the top relevant doc's file; if duplicates (an older
              // text-only copy of the same file) push the file-bearing chunk out
              // of the top results, fall back to ANY matching chunk that has a
              // file — so a stale duplicate can never hide the download link.
              const withFile = relevant.find(d => d.file_url) || hitDocs.find(d => d.file_url);
              if (withFile) docFile = { url: withFile.file_url, filename: withFile.filename };
            }
          }
        } catch(e) { /* no docs */ }

        // Also inject vendor profiles if vendor mentioned
        // NPS detection: only use USER messages (not bot replies which mention many vendors)
        let vendorContext = '';
        let detectedVendor = null;
        let npsForced = false;
        try {
          const userMsgsLower = (message + ' ' + (history.slice(-4).filter(m=>m.role==='user').map(m=>m.content).join(' '))).toLowerCase();
          // Also build a broader context including bot replies for knowledge injection (not NPS)
          const allContextLower = (message + ' ' + (history.slice(-2).map(m=>m.content).join(' '))).toLowerCase();
          // First: check current message alone for strongest signal
          const currentMsgLower = message.toLowerCase();
          const currentMatch = Object.entries(VENDOR_PROFILES).filter(([key]) => currentMsgLower.includes(key));
          // Then: check recent user messages
          const userMatch = Object.entries(VENDOR_PROFILES).filter(([key]) => userMsgsLower.includes(key));
          // Use current message match first (strongest signal), then user history
          const matchedProfiles = currentMatch.length > 0 ? currentMatch.slice(0, 2) : userMatch.slice(0, 2);
          // For knowledge injection, also check bot replies
          const allMatched = Object.entries(VENDOR_PROFILES).filter(([key]) => allContextLower.includes(key)).slice(0, 2);
          const profilesForContext = matchedProfiles.length > 0 ? matchedProfiles : allMatched;
          if (profilesForContext.length > 0) {
            vendorContext = '\n\n=== VENDOR KNOWLEDGE ===\n' + profilesForContext.map(([,v]) => v).join('\n\n---\n\n');
          }
          // NPS vendor: prefer what the USER mentioned, fall back to bot's last reply
          if (matchedProfiles.length > 0) {
            detectedVendor = matchedProfiles[0][0];
          }
          // Broader NPS: check documents table against user messages
          if (!detectedVendor) {
            const vendorNames = await getVendorNames();
            const found = vendorNames.find(v => userMsgsLower.includes(v));
            if (found) detectedVendor = found;
          }
          // Last resort: check the bot's most recent reply for a single clear vendor
          // (only if user didn't name one — avoids the multi-vendor suggestion problem)
          if (!detectedVendor && history.length > 0) {
            const lastBotReply = (history.filter(m=>m.role==='assistant').slice(-1)[0]?.content || '').toLowerCase();
            const botVendors = Object.entries(VENDOR_PROFILES).filter(([key]) => lastBotReply.includes(key));
            // Only use bot reply if exactly 1 vendor is strongly referenced (not a list of suggestions)
            if (botVendors.length === 1) detectedVendor = botVendors[0][0];
          }
          // List-free NPS: if the bot just asked which vendor to rate, the
          // user's reply IS the vendor — allow ANY vendor, no allow-list.
          if (!detectedVendor && history.length > 0) {
            const lastBot = (history.filter(m=>m.role==='assistant').slice(-1)[0]?.content || '').toLowerCase();
            const askedToRate = /(which|what)[^.?!]{0,50}(vendor|product|tool|system|supplier)[^.?!]{0,50}(rate|rating|review|feedback|nps)/.test(lastBot)
                              || /(rate|rating|review|feedback|nps)[^.?!]{0,50}(which|what)[^.?!]{0,30}(vendor|product|tool|system|supplier)/.test(lastBot);
            const v = message.trim()
              .replace(/^(the |my |it'?s? |rate |i'?(d| would)? ?(like|want)? ?to ?rate ?|let'?s ?rate ?)/i,'')
              .replace(/[.!?,]+$/,'').trim();
            if (askedToRate && v && v.length <= 40 && v.split(/\s+/).length <= 5) {
              detectedVendor = v.toLowerCase();
              npsForced = true;
            }
          }
        } catch(e) {}

        // ── Pre-fetch videos so the AI knows they exist ───────────────────
        let videoContext = '';
        let preloadedVideos = [];
        try {
          // Scope videos to shared (tenant null/'stacked') + this workspace's own.
          let allVidsR;
          try {
            const vq = workspaceId
              ? '/rest/v1/videos?or=(tenant.is.null,tenant.eq.stacked,tenant.eq.' + encodeURIComponent(workspaceId) + ')&select=id,title,description,category,url,yt_id&order=created_at.desc&limit=200'
              : '/rest/v1/videos?or=(tenant.is.null,tenant.eq.stacked)&select=id,title,description,category,url,yt_id&order=created_at.desc&limit=200';
            allVidsR = await sbFetch(vq);
            if (!allVidsR || (allVidsR.status && allVidsR.status >= 400) || !Array.isArray(allVidsR.data)) throw new Error('scoped videos unavailable');
          } catch(ve) {
            allVidsR = await sbFetch('/rest/v1/videos?select=id,title,description,category,url,yt_id&order=created_at.desc&limit=200');
          }
          if (Array.isArray(allVidsR.data) && allVidsR.data.length > 0) {
            preloadedVideos = allVidsR.data;
            // Score against user message only — not history or AI reply — to stay specific
            const STOP = new Set(['this','that','with','your','have','from','they','will','what','when','about','just','been','some','more','also','into','very','can','how','its','are','was','the','and','for','not','but','you','our','get']);
            const explicitly = /\bvideo\b|\bwatch\b|\btutorial\b|\bguide\b|\bwalkthrough\b|\bdemo\b/i.test(message);
            const msgWords = [...new Set(message.toLowerCase().split(/[\s,?!.;:()\[\]]+/).filter(w => w.length >= 4 && !STOP.has(w)))];
            const scored = preloadedVideos.map(v => {
              const t = ((v.title||'') + ' ' + (v.description||'') + ' ' + (v.category||'')).toLowerCase();
              const hits = msgWords.filter(w => t.includes(w)).length;
              return { v, hits };
            });
            const threshold = explicitly ? 1 : 3;
            const topVideos = scored.filter(s => s.hits >= threshold).sort((a,b) => b.hits - a.hits).slice(0, 2).map(s => s.v);
            if (topVideos.length > 0) {
              videoContext = '\n\nVIDEO LIBRARY — you have a relevant video for this topic:\n' +
                topVideos.map(v => '- "' + v.title + '"' + (v.description ? ' (' + v.description + ')' : '')).join('\n') +
                '\nIMPORTANT: Mention the video title naturally in one sentence (e.g. "I also have a video guide — \\"Title\\" — attached below"). Do NOT say "the system will attach" or use technical language.';
            } else if (preloadedVideos.length > 0) {
              videoContext = '\n\nVIDEO LIBRARY: ' + preloadedVideos.length + ' videos available but none closely match this query. Do not mention videos unless asked.';
            }
          }
        } catch(e) {}

        // ── Dish/menu images: surface a photo ONLY when the user actually asks
        // to SEE one (a photo/picture/image, or "what does it look like"). This
        // prevents a photo popping up unprompted just because the chat mentioned
        // something that happens to match an image name.
        let imageContext = '';
        let matchedImages = [];
        const wantsPhoto = /\b(photo|photos|picture|pictures|image|images|pic|pics|snap|visual)\b/i.test(message) || /\blooks?\s+like\b/i.test(message) || /\bwhat\b.*\blooks?\b/i.test(message);
        if (wantsPhoto) {
          try {
            const imgQ = workspaceId
              ? '/rest/v1/images?or=(tenant.is.null,tenant.eq.' + encodeURIComponent(workspaceId) + ')&select=url,title,description&limit=300'
              : '/rest/v1/images?tenant=is.null&select=url,title,description&limit=300';
            let imgR; try { imgR = await sbFetch(imgQ); if (!imgR || (imgR.status && imgR.status >= 400) || !Array.isArray(imgR.data)) throw 0; } catch(e2) { imgR = { data: [] }; }
            const imgs = Array.isArray(imgR.data) ? imgR.data : [];
            if (imgs.length) {
              const STOPI = new Set(['this','that','with','your','have','show','see','look','like','picture','photo','image','images','send','what','does','the','and','for','our','can','of','me','please']);
              // Only gated by wantsPhoto, so it's safe to use recent turns to
              // resolve "what does it look like" right after naming the item.
              const imgSearch = ((message || '') + ' ' + history.slice(-3).map(m => (typeof m.content === 'string' ? m.content : '')).join(' ')).toLowerCase();
              const words = [...new Set(imgSearch.split(/[\s,?!.;:()\[\]_]+/).filter(w => w.length >= 3 && !STOPI.has(w)))];
              const scored = imgs.map(im => { const t = ((im.title || '') + ' ' + (im.description || '')).toLowerCase(); return { im: im, hits: words.filter(w => t.includes(w)).length }; });
              matchedImages = scored.filter(s => s.hits >= 1).sort((a, b) => b.hits - a.hits).slice(0, 1).map(s => ({ url: s.im.url, title: s.im.title }));
              if (matchedImages.length) {
                imageContext = '\n\nIMAGE LIBRARY — you have a photo that matches this question:\n' +
                  matchedImages.map(m => '- "' + m.title + '"').join('\n') +
                  '\nIMPORTANT: If the photo is relevant, mention it naturally in one short sentence (e.g. "Here is a photo of the ' + matchedImages[0].title + ' below"). The image is attached automatically beneath your reply — never paste a URL or use technical phrases like "the system will attach".';
              }
            }
          } catch(e) {}
        }

        // Tell the model whether a downloadable file link is ACTUALLY attached to
        // this reply, so it never promises a "link below" that isn't there.
        let docFileNote = '';
        const fileIntent = /\b(pdf|document|file|doc|menu|download|forward|share|send|email)\b/i.test(message);
        if (docFile) {
          docFileNote = '\n\nSHAREABLE FILE: A download link for "' + docFile.filename + '" IS attached automatically beneath your reply. If the user wants to share, forward or download it, tell them to open/forward it using that link below.';
        } else if (fileIntent) {
          docFileNote = '\n\nSHAREABLE FILE: There is NO downloadable file link attached to this reply. If the user asks to share/forward/download a document file, do NOT claim a link is below. Explain the document was stored as text only, and an admin can re-add it with the "+" button (Add doc) to make the original file shareable.';
        }

        const systemPrompt = `You are Stacked Chat — a friendly, direct AI assistant for UK hospitality businesses. You answer ANY question about running this business using its own knowledge base: staff handbooks, SOPs, policies, supplier and delivery info, rotas, opening/closing procedures — as well as hospitality technology troubleshooting. Tech support is one of the things you do, not the only thing.

ANSWER FROM THE KNOWLEDGE BASE: Prefer information from the "FROM KNOWLEDGE BASE" and "VENDOR KNOWLEDGE" context below when it's relevant. If a document below clearly relates to what the user is asking about, USE it and share what it contains — do NOT say you have nothing just because their exact wording or a qualifier (a season, a year, "summer", etc.) isn't in the document's title. When your answer draws on a specific document, cite it briefly on its own line at the end, e.g. "Source: Staff Handbook" using the document's filename. If the documents genuinely don't cover the question, say so and answer from general best practice — never invent business-specific facts (policies, contacts, prices, hours) that aren't in the documents.

IMAGES & PHOTOS: You CAN show photos added to this venue's library — when one matches, it attaches automatically beneath your reply (see "IMAGE LIBRARY" below if present). You can also READ an image a user attaches. You CANNOT email/download files or re-send an image the user just uploaded, so never say a flat "I am just a chat assistant, I cannot send images". IMPORTANT — when the user asks to SEE or SHARE a photo: FIRST answer their question fully from the knowledge base if the topic is covered there (give the details you have). NEVER say a document or topic is missing if it appears in the KNOWLEDGE BASE / documents below — it is only the PHOTO that might be missing. ONLY if no photo is attached beneath your reply, add ONE short line that a photo of it is not in the image library yet and an admin can add one with the "+" button. Do not refuse the whole request.

DOCUMENTS & FILES: When your answer is based on an uploaded document that has a shareable file, a download link to that file is attached automatically beneath your reply. If the user asks to send, share, forward or download a document (e.g. "send me the PDF"), answer their question and tell them they can open or forward it using the link below — never say you are unable to send files. If the document has no file link (older uploads stored text only), say it can be re-added by an admin via "+" to make it shareable.

LANGUAGE: Detect the language the user is writing in and reply in that same language. If they write in French, reply in French. If Spanish, reply in Spanish. Default to British English if unclear.

Your personality:
- Calm under pressure (operators often message you during a crisis)
- Straight to the point — no waffle
- Friendly but efficient
- Use British English when responding in English

PRODUCT DETECTION (only for TECH / equipment problems — NOT for handbook, HR, policy, supplier, rota or other general questions):
When a user reports a TECH or equipment fault but does NOT name the specific product or brand (e.g. "my till is broken" or "payments aren't working"), you MUST ask which product they are using before troubleshooting. Ask in a single short friendly question. For non-tech questions, do not ask about products — just answer from the knowledge base.

EXCEPTION: If the venue's tech stack is provided above, skip asking — you already know their system.

For each category, prompt like this:
- EPOS / till issues → "Which EPOS system are you on? For example Square, Lightspeed, Tevalis, EPOS Now, Zonal, ICRTouch, Toast, or another?"
- Payment terminal issues → "Which payment terminal are you using? For example Dojo, Square, SumUp, Zettle, Worldpay, Stripe, Adyen, or Elavon?"
- Reservation / booking issues → "Which reservation system are you using? For example OpenTable, ResDiary, SevenRooms, Collins, Resy, Quandoo, or another?"
- Workforce / rota issues → "Which rota or workforce system are you using? For example Fourth, Deputy, Sona, Rotaready, Bizimply, S4Labour, or another?"
- Ordering / delivery issues → "Which ordering platform is this? For example Deliveroo, Uber Eats, Just Eat, Deliverect, Flipdish, Slerp, or another?"
- Loyalty / CRM issues → "Which loyalty or CRM platform are you using? For example Airship, Stampede, SevenRooms, Eagle Eye, Yumpingo, or another?"
- Inventory / procurement issues → "Which inventory system are you using? For example Apicbase, Marketman, Crunchtime, Nutritics, Kitchen CUT, or another?"
- Hotel PMS issues → "Which property management system are you on? For example Opera, Mews, Guestline, Cloudbeds, Clock PMS, or another?"
- WiFi / connectivity issues → "Is this the venue's main WiFi or a specific device that won't connect?"

Once you know the product, respond with:
- A single bold line with the fastest fix
- Numbered steps, max 5
- A mid-service workaround if relevant
- The vendor support URL inline

NPS / VENDOR RATING REQUESTS:
When a user says they want to rate their tech vendors, rate a product, give feedback, or provide an NPS score:
1. Ask them which specific vendor/product they would like to rate. Be friendly and concise, e.g. "Sure! Which vendor would you like to rate? For example Lightspeed, Square, Tevalis, Dojo, OpenTable, Deputy, or any other product you use."
2. Once they name the vendor — ANY vendor or product, even one not in your support list — reply with a short confirmation like "Great — rating [vendor name] now." and ALWAYS add [NPS:vendorname] on its own line at the very end (use the exact name the user gave, lowercased, e.g. [NPS:tenzo]). Never skip this tag. The system displays the rating widget automatically.
3. Do NOT ask them to rate on a scale yourself — the system handles the rating UI.

Support URLs:
  --- POINT OF SALE ---
  Square: https://squareup.com/help/gb
  Square status: https://status.squareup.com
  SumUp: https://help.sumup.com/en-GB
  Lightspeed: https://www.lightspeedhq.com/support/
  Tevalis: https://support.tevalis.com
  Zonal: https://support.zonal.co.uk
  EPOS Now: https://www.eposnow.com/us/resource-hub/
  Vita Mojo: https://support.vitamojo.com
  ICRTouch: https://icrtouch.com/support/
  Toast: https://central.toasttab.com/s/
  Oracle MICROS: https://www.oracle.com/uk/industries/food-beverage/restaurant-pos/
  Tabology: https://support.tabology.com
  Storekit: https://help.storekit.com
  Pepper: https://support.getpepper.io
  PayPoint One: https://www.paypoint.com/support
  Par Brink: https://www.partech.com/support
  --- PAYMENTS ---
  Dojo: https://help.dojo.tech
  Worldpay: https://www.worldpay.com/en-gb/support
  Stripe: https://support.stripe.com
  Zettle: https://www.zettle.com/gb/help
  Adyen: https://support.adyen.com
  Elavon: https://www.elavon.co.uk/support
  PaymentSense: https://www.paymentsense.com/support/
  Tyl (NatWest): https://tyl.co.uk/support
  Barclaycard: https://www.barclaycard.co.uk/business/support
  --- RESERVATIONS ---
  OpenTable: https://help.opentable.com
  ResDiary: https://support.resdiary.com
  Collins: https://support.designmynight.com
  SevenRooms: https://support.sevenrooms.com
  Quandoo: https://help.quandoo.com
  Resy: https://help.resy.com
  Tock: https://support.exploretock.com
  Eat App: https://help.eatapp.co
  --- WORKFORCE ---
  Fourth: https://support.fourth.com
  Deputy: https://support.deputy.com
  Sona: https://support.getsona.com
  Rotaready: https://support.rotaready.com
  Bizimply: https://support.bizimply.com
  Planday: https://support.planday.com
  S4Labour: https://www.s4labour.co.uk/support
  HotSchedules: https://help.hotschedules.com
  Workforce.com: https://support.workforce.com
  Harri: https://help.harri.com
  Nory: https://support.nory.ai
  Humanforce: https://support.humanforce.com
  --- ONLINE ORDERING & DELIVERY ---
  Deliverect: https://support.deliverect.com
  Deliveroo: https://restaurant-hub.deliveroo.com/help
  Uber Eats: https://help.uber.com/restaurants
  Just Eat: https://restaurants.just-eat.co.uk/help
  Flipdish: https://help.flipdish.com
  Slerp: https://support.slerp.com
  Orderswift: https://support.orderswift.com
  --- LOYALTY & CRM ---
  Airship: https://support.airship.com
  Stampede: https://support.stampede.ai
  Yumpingo: https://support.yumpingo.com
  Eagle Eye: https://eagleeye.com/support
  Klaviyo: https://help.klaviyo.com
  --- INVENTORY ---
  Apicbase: https://support.apicbase.com
  Nutritics: https://support.nutritics.com
  Crunchtime: https://support.crunchtime.com
  Marketman: https://support.marketman.com
  Kitchen CUT: https://support.kitchencut.com
  Winnow: https://support.winnowsolutions.com
  --- HOTEL PMS ---
  Mews: https://help.mews.com
  Cloudbeds: https://help.cloudbeds.com
  Guestline: https://support.guestline.net
  Clock PMS: https://help.clock-software.com
  Opera (Oracle): https://docs.oracle.com/en/industries/hospitality/
  --- ANALYTICS & BI ---
  Tenzo: https://help.tenzo.io
  Yumpingo: https://support.yumpingo.com
  --- WIFI ---
  Stampede: https://support.stampede.ai
  Purple Wi-Fi: https://support.purple.ai
  Cisco Meraki: https://documentation.meraki.com

- ALWAYS include the full vendor support URL (starting with https://) when referencing a support page - never just the domain name

KNOWLEDGE BASE:
${KNOWLEDGE_BASE}${vendorContext}${docContext}${videoContext}${imageContext}${docFileNote}${venueContext}`;

        const messages = history.slice(-8).map(m => ({role:m.role,content:m.content}));
        // Build the current user turn. If an image was attached, send it as a
        // multimodal block so the model can actually SEE it (Claude vision).
        const userContent = (image && image.data && image.media_type)
          ? [
              { type: 'image', source: { type: 'base64', media_type: image.media_type, data: image.data } },
              { type: 'text', text: (message && message.trim()) ? message : 'Please look at this image and help me with it.' }
            ]
          : message;
        const lastMsg = messages[messages.length - 1];
        if (lastMsg && lastMsg.role === 'user') {
          // The client already included this turn in history — upgrade it
          // (attaches the image / ensures the text is present).
          lastMsg.content = userContent;
        } else {
          messages.push({ role: 'user', content: userContent });
        }

        const https = require('https');
        const apiBody = JSON.stringify({
          model: 'claude-sonnet-4-6',
          max_tokens: 1000,
          system: systemPrompt,
          messages
        });

        const apiRes = await new Promise((resolve, reject) => {
          const r = https.request({
            hostname: 'api.anthropic.com', path: '/v1/messages', method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'x-api-key': ANTHROPIC_KEY,
              'anthropic-version': '2023-06-01',
              'Content-Length': Buffer.byteLength(apiBody)
            }
          }, (resp) => {
            let d = ''; resp.on('data', c => d += c); resp.on('end', () => resolve(JSON.parse(d)));
          });
          r.on('error', reject); r.write(apiBody); r.end();
        });

        // If the API didn't return content, log the full response so we can see
        // why (model deprecation, auth issue, rate limit, etc.) instead of
        // silently falling through to the user-facing error string.
        if (!apiRes.content?.[0]?.text) {
          console.error('[chat] Anthropic API returned no content. Response:', JSON.stringify(apiRes));
        }
        const rawReply = apiRes.content?.[0]?.text || 'Sorry, I could not get a response. Please try again.';

        // Detect supportUrl BEFORE cleaning — user message first (most accurate), then Claude's reply.
        // Only surface a vendor support link when the user is genuinely asking for
        // TECH HELP. A product name merely appearing (e.g. "Tech on Toast") must NOT
        // trigger a support pill.
        let supportUrl = null;
        const userMsgLower = message.toLowerCase();
        const techIntent = /\b(not working|isn'?t working|not connecting|won'?t|wont|broken|down|crash(ing|ed)?|error|issue|problem|fault|glitch|fix|setup|set ?up|configure|connect|disconnect|offline|frozen|freeze|stuck|reset|reboot|restart|re-?sync|sync|update|install|uninstall|log ?in|login|logged out|password|printer|terminal|card machine|payment|epos|e-?pos|till|\bpos\b|how do i|how to|troubleshoot|trouble|support|helpline|keeps|not printing|declined)\b/i.test(userMsgLower);
        if (techIntent) {
          // Guard against "tech on toast" matching the Toast POS vendor.
          const vendorScan = userMsgLower.replace(/tech on toast/g, '');
          for (const [vendor, url] of Object.entries(VENDOR_SUPPORT_URLS)) {
            if (vendorScan.includes(vendor)) { supportUrl = url; break; }
          }
          if (!supportUrl) {
            const mlm = rawReply.match(/\]\((https?:\/\/[^)]+)\)/);
            if (mlm) supportUrl = mlm[1];
            else { const pm = rawReply.match(/https?:\/\/[^\s)>\]]+/); if (pm) supportUrl = pm[0]; }
          }
        }

        // Clean reply: strip markdown link syntax (keep label text), remove bare URLs
        let reply = rawReply
          .replace(/\[([^\]]+)\]\((https?:\/\/[^)]+)\)/g, '$1')
          .replace(/https?:\/\/[^\s)>\]]+/g, '')
          .replace(/[ \t]+\n/g, '\n')
          .replace(/\n{3,}/g, '\n\n')
          .trim();

        let relevantVideos = [];
        let finalReply = reply;
        try {
          // Reuse already-fetched videos — score against user message only (not AI reply)
          if (preloadedVideos.length > 0) {
            const STOP = new Set(['this','that','with','your','have','from','they','will','what','when','about','just','been','some','more','also','into','very','can','how','its','are','was','the','and','for','not','but','you','our','get']);
            const explicitly = /\bvideo\b|\bwatch\b|\btutorial\b|\bguide\b|\bwalkthrough\b|\bdemo\b/i.test(message);
            const msgWords = [...new Set(message.toLowerCase().split(/[\s,?!.;:()\[\]]+/).filter(w => w.length >= 4 && !STOP.has(w)))];
            const scored = preloadedVideos.map(v => {
              const t = ((v.title||'') + ' ' + (v.description||'') + ' ' + (v.category||'')).toLowerCase();
              const hits = msgWords.filter(w => t.includes(w)).length;
              return { v, hits };
            });
            const threshold = explicitly ? 1 : 3;
            relevantVideos = scored
              .filter(s => s.hits >= threshold)
              .sort((a,b) => b.hits - a.hits)
              .slice(0, 1)
              .map(s => s.v);
            if (relevantVideos.length > 0) {
              finalReply = reply + '\n\n[STACKEDVIDEO:' + JSON.stringify(relevantVideos[0]) + ']';
            }
          }
        } catch(e) {}

        // ─── ESCALATION REMOVED ──────────────────────────────────────────
        // The "flagged for our team" handoff has been removed entirely.
        // Strip any stray [ESCALATE] tag defensively so it can never leak.
        reply = reply.replace(/\[ESCALATE\]/g, '').trim();
        finalReply = finalReply.replace(/\[ESCALATE\]/g, '').trim();

        // Handle [NPS:vendorname] tag — AI-triggered NPS rating
        const npsMatch = reply.match(/\[NPS:([^\]]+)\]/i);
        if (npsMatch) {
          detectedVendor = npsMatch[1].toLowerCase().trim();
          npsForced = true;
          reply = reply.replace(/\[NPS:[^\]]+\]/gi, '').trim();
          finalReply = finalReply.replace(/\[NPS:[^\]]+\]/gi, '').trim();
        }

        res.writeHead(200, {'Content-Type':'application/json'});
        res.end(JSON.stringify({response:finalReply, supportUrl, escalate: false, videos:relevantVideos, videoCount:relevantVideos.length, images: matchedImages, docFile, detectedVendor, forceNPS: npsForced || !!npsMatch}));
      } catch(e) {
        console.error(e);
        res.writeHead(500, {'Content-Type':'application/json'});
        res.end(JSON.stringify({response:'Server error. Please try again in a moment.', videos:[]}));
      }
    }); return;
  }

  // ─── YOUTUBE INGEST ────────────────────────────────────────────────────
  if (method === 'POST' && url === '/youtube-ingest') {
    let body = ''; req.on('data', chunk => body += chunk);
    req.on('end', async () => {
      res.writeHead(200, {'Content-Type':'application/x-ndjson','Transfer-Encoding':'chunked','Cache-Control':'no-cache'});
      const send = obj => res.write(JSON.stringify(obj) + '\n');
      try {
        const { url: ytUrl } = JSON.parse(body);
        const YTKEY = process.env.YOUTUBE_API_KEY || '';
        const urlObj = new URL(ytUrl);
        const listId = urlObj.searchParams.get('list');
        const videoId = urlObj.searchParams.get('v') || (urlObj.hostname === 'youtu.be' ? urlObj.pathname.slice(1) : null);
        let videoIds = [];
        if (listId && YTKEY) {
          send({type:'progress',pct:5,msg:'Fetching playlist...'});
          videoIds = await fetchPlaylistItems(listId, YTKEY);
          send({type:'progress',pct:15,msg:'Found '+videoIds.length+' videos'});
        } else if (listId && !YTKEY) {
          if (videoId) { videoIds=[videoId]; send({type:'progress',pct:10,msg:'No YOUTUBE_API_KEY - indexing current video only'}); }
          else { send({type:'error',msg:'Playlist requires YOUTUBE_API_KEY in Render env vars.'}); res.end(); return; }
        } else if (videoId) {
          videoIds = [videoId]; send({type:'progress',pct:10,msg:'Single video: '+videoId});
        } else { send({type:'error',msg:'Could not parse video ID from URL'}); res.end(); return; }
        let totalChunks = 0, indexed = 0;
        for (let i = 0; i < videoIds.length; i++) {
          const vid = videoIds[i], pct = Math.round(15 + (i/videoIds.length)*80);
          send({type:'progress',pct,msg:'['+(i+1)+'/'+videoIds.length+'] '+vid+'...'});
          try {
            const {title, transcript} = await fetchYouTubeTranscript(vid);
            if (!transcript || transcript.length < 50) { send({type:'progress',pct,msg:'  Skipped - no captions'}); continue; }
            const filename = (title||vid).substring(0,80) + ' [yt:'+vid+']';
            const chunks = chunkText(transcript, filename);
            for (const chunk of chunks) await sbFetch('/rest/v1/documents', {method:'POST', body:chunk});
            totalChunks += chunks.length; indexed++;
            send({type:'progress',pct,msg:'  OK: "'+(title||vid)+'" - '+chunks.length+' chunks'});
          } catch(e) { send({type:'progress',pct,msg:'  Skipped '+vid+': '+e.message}); }
        }
        send({type:'done', indexed, chunks:totalChunks});
      } catch(e) { send({type:'error',msg:e.message}); }
      res.end();
    }); return;
  }

  // ─── VIDEOS ────────────────────────────────────────────────────────────
  if (method === 'GET' && url === '/videos') {
    try {
      const r = await sbFetch('/rest/v1/videos?select=*&order=created_at.desc&limit=100');
      res.writeHead(200, {'Content-Type':'application/json'});
      res.end(JSON.stringify(Array.isArray(r.data) ? r.data : []));
    } catch(e) { res.writeHead(500, {'Content-Type':'application/json'}); res.end(JSON.stringify({error:e.message})); }
    return;
  }

  if (method === 'POST' && url === '/videos/add') {
    let body = ''; req.on('data', c => body += c);
    req.on('end', async () => {
      try {
        const { url: videoUrl, title, description, tenant, category } = JSON.parse(body);
        if (!videoUrl) { res.writeHead(400, {'Content-Type':'application/json'}); res.end(JSON.stringify({error:'No URL'})); return; }
        let type = 'mp4', thumbnail = '', ytId = null;
        const ytMatch = videoUrl.match(/(?:youtube\.com\/watch\?v=|youtu\.be\/|youtube\.com\/embed\/)([a-zA-Z0-9_-]{11})/);
        if (ytMatch) { ytId = ytMatch[1]; type = 'youtube'; thumbnail = 'https://img.youtube.com/vi/' + ytId + '/mqdefault.jpg'; }
        const record = { url: videoUrl, title: title || ytId || 'Untitled', description: description || '', type, thumbnail, tenant: tenant || 'stacked', yt_id: ytId || null };
        if (category) record.category = category;
        let r = await sbFetch('/rest/v1/videos', { method: 'POST', headers: { 'Prefer': 'return=representation' }, body: record });
        // If category column doesn't exist yet, retry without it
        if (r.status >= 400 && category) {
          delete record.category;
          r = await sbFetch('/rest/v1/videos', { method: 'POST', headers: { 'Prefer': 'return=representation' }, body: record });
        }
        res.writeHead(200, {'Content-Type':'application/json'});
        res.end(JSON.stringify({ ok: r.status < 400, video: Array.isArray(r.data) ? r.data[0] : r.data }));
      } catch(e) { res.writeHead(500, {'Content-Type':'application/json'}); res.end(JSON.stringify({error:e.message})); }
    }); return;
  }

  if (method === 'DELETE' && url.startsWith('/videos/')) {
    try {
      const id = url.split('/videos/')[1];
      await sbFetch('/rest/v1/videos?id=eq.' + id, { method: 'DELETE' });
      res.writeHead(200, {'Content-Type':'application/json'}); res.end(JSON.stringify({ok:true}));
    } catch(e) { res.writeHead(500, {'Content-Type':'application/json'}); res.end(JSON.stringify({error:e.message})); }
    return;
  }

  // ─── YOUTUBE SEARCH ────────────────────────────────────────────────────────
  if (method === 'GET' && url.startsWith('/youtube/search')) {
    const ytKey = process.env.YOUTUBE_API_KEY;
    if (!ytKey) {
      res.writeHead(200, {'Content-Type':'application/json'});
      res.end(JSON.stringify({error:'YOUTUBE_API_KEY not set'})); return;
    }
    try {
      const params = new URL(url, 'http://localhost');
      const q = params.searchParams.get('q') || '';
      const maxResults = Math.min(parseInt(params.searchParams.get('max')||'12'), 25);
      if (!q) { res.writeHead(200, {'Content-Type':'application/json'}); res.end(JSON.stringify({items:[]})); return; }
      const ytUrl = 'https://www.googleapis.com/youtube/v3/search?part=snippet&type=video&maxResults=' + maxResults + '&q=' + encodeURIComponent(q + ' tutorial how to') + '&key=' + ytKey;
      const ytRes = await fetch(ytUrl);
      const ytData = await ytRes.json();
      if (ytData.error) { res.writeHead(200, {'Content-Type':'application/json'}); res.end(JSON.stringify({error:ytData.error.message})); return; }
      const items = (ytData.items || []).map(item => ({
        yt_id: item.id.videoId,
        title: item.snippet.title,
        description: item.snippet.description,
        thumbnail: item.snippet.thumbnails?.medium?.url || ('https://img.youtube.com/vi/' + item.id.videoId + '/mqdefault.jpg'),
        channel: item.snippet.channelTitle,
        url: 'https://www.youtube.com/watch?v=' + item.id.videoId,
        type: 'youtube'
      }));
      res.writeHead(200, {'Content-Type':'application/json'});
      res.end(JSON.stringify({items}));
    } catch(e) {
      res.writeHead(200, {'Content-Type':'application/json'});
      res.end(JSON.stringify({error:e.message}));
    }
    return;
  }

  // ─── YOUTUBE BULK IMPORT ───────────────────────────────────────────────────
  if (method === 'POST' && url === '/youtube/import') {
    let body = ''; req.on('data', c => body += c);
    req.on('end', async () => {
      try {
        const { videos, category } = JSON.parse(body);
        if (!Array.isArray(videos) || !videos.length) {
          res.writeHead(200, {'Content-Type':'application/json'});
          res.end(JSON.stringify({ok:false,error:'No videos provided'})); return;
        }
        let added = 0;
        for (const v of videos) {
          try {
            const record = {
              url: v.url, title: v.title, description: v.description || '',
              type: 'youtube', thumbnail: v.thumbnail, yt_id: v.yt_id,
              tenant: 'stacked'
            };
            if (category) record.category = category;
            const r = await sbFetch('/rest/v1/videos', {
              method: 'POST',
              headers: { 'Prefer': 'return=minimal' },
              body: record
            });
            if (r.status >= 200 && r.status < 300) {
              added++;
            } else {
              console.error('Import Supabase error:', r.status, JSON.stringify(r.data));
              // If category column missing, retry without it
              if (JSON.stringify(r.data).includes('category')) {
                delete record.category;
                const r2 = await sbFetch('/rest/v1/videos', { method: 'POST', headers: { 'Prefer': 'return=minimal' }, body: record });
                if (r2.status >= 200 && r2.status < 300) added++;
              }
            }
          } catch(e) { console.error('Import error:', e.message); }
        }
        res.writeHead(200, {'Content-Type':'application/json'});
        res.end(JSON.stringify({ok:true, added}));
      } catch(e) {
        res.writeHead(200, {'Content-Type':'application/json'});
        res.end(JSON.stringify({ok:false, error:e.message}));
      }
    }); return;
  }

  // ─── HEALTH CHECK SAVE ─────────────────────────────────────────────────
  if (method === 'POST' && url === '/health-check') {
    let body = '';
    req.on('data', c => body += c);
    req.on('end', async () => {
      try {
        const payload = JSON.parse(body);
        await sbFetch('/rest/v1/health_checks', {
          method: 'POST',
          headers: { 'Prefer': 'return=minimal' },
          body: payload
        });
        res.writeHead(200, {'Content-Type':'application/json'});
        res.end(JSON.stringify({ok:true}));
      } catch(e) {
        console.error('[health-check]', e.message);
        res.writeHead(200, {'Content-Type':'application/json'});
        res.end(JSON.stringify({ok:false,error:e.message}));
      }
    }); return;
  }

  // ─── HEALTH CHECKS LIST ────────────────────────────────────────────────
  if (method === 'GET' && url.startsWith('/health-checks')) {
    try {
      const params = new URL(url, 'http://localhost');
      const venueId = params.searchParams.get('venue_id');
      const filter = venueId
        ? '/rest/v1/health_checks?select=*&venue_id=eq.' + encodeURIComponent(venueId) + '&order=checked_at.desc&limit=50'
        : '/rest/v1/health_checks?select=*&order=checked_at.desc&limit=50';
      const r = await sbFetch(filter);
      res.writeHead(200, {'Content-Type':'application/json'});
      res.end(JSON.stringify(Array.isArray(r.data) ? r.data : []));
    } catch(e) {
      res.writeHead(200, {'Content-Type':'application/json'});
      res.end(JSON.stringify([]));
    }
    return;
  }

  // ─── CRON: SHIFT CHECK REMINDER ───────────────────────────────────────
  if (method === 'POST' && url === '/cron/remind') {
    const params = new URL(url, 'http://localhost');
    let body = ''; req.on('data', c => body += c);
    req.on('end', async () => {
      try {
        const { secret } = JSON.parse(body || '{}');
        if (secret !== CRON_SECRET) { res.writeHead(401); res.end('Unauthorised'); return; }
        // Fetch recent active venues
        const vr = await sbFetch('/rest/v1/venues?select=name,id&order=created_at.desc&limit=100');
        const venues = Array.isArray(vr.data) ? vr.data : [];
        const day = new Date().toLocaleDateString('en-GB', { weekday: 'long' });
        const time = new Date().toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
        if (SLACK_WEBHOOK_URL) {
          const text = [
            `☀️ *Good morning — time for your shift check!*`,
            `It's ${day} at ${time}. Before service kicks off, make sure your tech is green across the board.`,
            ``,
            `*${venues.length} venue${venues.length !== 1 ? 's' : ''} active on Stacked Chat.*`,
            `Open the app and hit *Start of shift check* to log your system status.`,
          ].join('\n');
          await sendSlackAlert({ venue: 'All venues', userName: 'Cron', email: '', issue: text, turns: 0 });
        }
        res.writeHead(200, {'Content-Type':'application/json'});
        res.end(JSON.stringify({ ok: true, venueCount: venues.length }));
      } catch(e) {
        res.writeHead(500); res.end(JSON.stringify({ error: e.message }));
      }
    }); return;
  }

  // ─── VENUE BRANDING SAVE ──────────────────────────────────────────────
  if (method === 'POST' && url.startsWith('/venue/') && url.endsWith('/branding')) {
    let body = ''; req.on('data', c => body += c);
    req.on('end', async () => {
      try {
        const id = url.split('/venue/')[1].split('/branding')[0];
        const payload = JSON.parse(body);
        const allowed = ['logo_url','primary_color','bot_name','welcome_message','welcome_heading','white_label'];
        const update = {};
        allowed.forEach(k => { if (payload[k] !== undefined) update[k] = payload[k]; });
        await sbFetch('/rest/v1/venues?id=eq.' + id, { method: 'PATCH', headers: { 'Prefer': 'return=minimal' }, body: update });
        res.writeHead(200, {'Content-Type':'application/json'});
        res.end(JSON.stringify({ ok: true }));
      } catch(e) {
        res.writeHead(200, {'Content-Type':'application/json'});
        res.end(JSON.stringify({ ok: false, error: e.message }));
      }
    }); return;
  }

  // ─── VENUE LIST FOR ADMIN ──────────────────────────────────────────────
  if (method === 'GET' && url === '/venues/all') {
    try {
      const r = await sbFetch('/rest/v1/venues?select=*&order=name.asc&limit=200');
      res.writeHead(200, {'Content-Type':'application/json'});
      res.end(JSON.stringify(Array.isArray(r.data) ? r.data : []));
    } catch(e) {
      res.writeHead(200, {'Content-Type':'application/json'});
      res.end(JSON.stringify([]));
    }
    return;
  }

  // ─── WEB SCRAPER ───────────────────────────────────────────────────────────
  if (method === 'POST' && url === '/scrape') {
    let body = ''; req.on('data', c => body += c);
    req.on('end', async () => {
      try {
        const { url: scrapeUrl, vendor } = JSON.parse(body);
        if (!scrapeUrl) { res.writeHead(400, {'Content-Type':'application/json'}); res.end(JSON.stringify({error:'No URL'})); return; }

        const browserHeaders = {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
          'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
          'Accept-Language': 'en-GB,en;q=0.9',
          'Accept-Encoding': 'gzip, deflate, br',
          'Cache-Control': 'no-cache'
        };

        function stripHtml(html) {
          return html
            .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, ' ')
            .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, ' ')
            .replace(/<nav[^>]*>[\s\S]*?<\/nav>/gi, ' ')
            .replace(/<header[^>]*>[\s\S]*?<\/header>/gi, ' ')
            .replace(/<footer[^>]*>[\s\S]*?<\/footer>/gi, ' ')
            .replace(/<[^>]+>/g, ' ')
            .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&#\d+;/g, ' ')
            .replace(/\s{3,}/g, '\n\n')
            .trim();
        }

        async function saveChunks(text, vendorName, srcUrl) {
          const filename = vendorName + ' - scraped ' + new Date().toISOString().substring(0,10);
          const chunkSize = 1200;
          const chunks = [];
          for (let i = 0; i < Math.min(text.length, 60000); i += chunkSize) {
            chunks.push({ filename, content: text.substring(i, i + chunkSize), chunk_index: chunks.length });
          }
          await sbFetch('/rest/v1/documents?filename=ilike.' + encodeURIComponent('%' + vendorName + '%scraped%'), { method: 'DELETE' }).catch(() => {});
          for (const chunk of chunks) {
            await sbFetch('/rest/v1/documents', { method: 'POST', headers: { 'Prefer': 'return=minimal' }, body: chunk });
          }
          return { chunks: chunks.length, chars: text.length, filename };
        }

        // ── Zendesk Help Centre detection ──────────────────────────────────
        // URLs like https://support.lightspeedhq.com/hc/en-gb
        // or https://help.deputy.com/hc/en-us
        // Zendesk exposes a public JSON API at /api/v2/help_center/<locale>/articles.json
        const parsedUrl = new URL(scrapeUrl);
        const hcMatch = parsedUrl.pathname.match(/^\/hc\/([a-z]{2}(?:-[a-z]{2})?)/i);
        if (hcMatch) {
          const locale = hcMatch[1];
          const baseApi = parsedUrl.origin + '/api/v2/help_center/' + locale + '/articles.json?per_page=30&sort_by=updated_at&sort_order=desc';
          let allText = '';
          let pageUrl = baseApi;
          let pagesFetched = 0;
          const maxPages = 5; // up to 150 articles

          let apiBlocked = false;
          while (pageUrl && pagesFetched < maxPages) {
            const apiRes = await fetch(pageUrl, {
              headers: { ...browserHeaders, 'Accept': 'application/json' },
              signal: AbortSignal.timeout(20000)
            });
            if (!apiRes.ok) {
              // 401/403 = API locked — fall through to HTML scrape silently
              if (pagesFetched === 0) apiBlocked = true;
              break;
            }
            const apiData = await apiRes.json();
            const articles = apiData.articles || [];
            for (const article of articles) {
              const articleText = article.title + '\n' + stripHtml(article.body || '');
              allText += articleText + '\n\n---\n\n';
            }
            pageUrl = apiData.next_page || null;
            pagesFetched++;
          }

          if (!apiBlocked && allText.length >= 100) {
            const result = await saveChunks(allText, vendor || parsedUrl.hostname, scrapeUrl);
            res.writeHead(200, {'Content-Type':'application/json'});
            res.end(JSON.stringify({ ok: true, ...result, method: 'zendesk-api' }));
            return;
          }
          // API blocked or empty — fall through to HTML scrape below
        }

        // ── Standard HTML scrape ───────────────────────────────────────────
        const fetchRes = await fetch(scrapeUrl, {
          headers: browserHeaders,
          signal: AbortSignal.timeout(20000),
          redirect: 'follow'
        });
        if (!fetchRes.ok) throw new Error('HTTP ' + fetchRes.status + ' — site may block scraping or require login');
        const html = await fetchRes.text();
        const text = stripHtml(html);

        if (text.length < 100) throw new Error('Page returned too little content — site requires JavaScript rendering. Try a direct article URL instead of the help centre homepage.');

        const result = await saveChunks(text, vendor || parsedUrl.hostname, scrapeUrl);
        res.writeHead(200, {'Content-Type':'application/json'});
        res.end(JSON.stringify({ ok: true, ...result, method: 'html' }));

      } catch(e) {
        res.writeHead(200, {'Content-Type':'application/json'});
        res.end(JSON.stringify({ ok: false, error: e.message }));
      }
    }); return;
  }

  // ─── BRANDED CHAT PAGE (/chat/:slug) ──────────────────────────────────
  if (method === 'GET' && url.startsWith('/chat/')) {
    const slug = url.split('/chat/')[1].split('?')[0].toLowerCase();
    try {
      const r = await sbFetch('/rest/v1/venues?select=*&slug=eq.' + encodeURIComponent(slug) + '&limit=1');
      const venue = Array.isArray(r.data) && r.data[0] ? r.data[0] : null;
      const branding = venue ? {
        logo_url: venue.logo_url || null,
        primary_color: venue.primary_color || null,
        bot_name: venue.bot_name || null,
        welcome_message: venue.welcome_message || null,
        welcome_heading: venue.welcome_heading || null,
        white_label: venue.white_label || false,
        venue_id: venue.id || null,
        venue_name: venue.name || null
      } : {};
      res.writeHead(200, {'Content-Type':'text/html','Cache-Control':'no-store'});
      res.end(buildChatPage(branding));
    } catch(e) {
      res.writeHead(200, {'Content-Type':'text/html','Cache-Control':'no-store'});
      res.end(buildChatPage());
    }
    return;
  }

  // ─── MAIN CHAT PAGE ────────────────────────────────────────────────────
  if (method === 'GET' && (url === '/' || url === '')) {
    res.writeHead(200, {'Content-Type':'text/html','Cache-Control':'no-store'});
    res.end(buildChatPage()); return;
  }

  res.writeHead(404); res.end('Not found');
});

// ─── UTILITIES ─────────────────────────────────────────────────────────────
function chunkText(text, filename) {
  const chunkSize = 1200;
  const chunks = [];
  for (let i = 0; i < text.length; i += chunkSize) {
    chunks.push({filename, content:text.substring(i, i+chunkSize), chunk_index:chunks.length});
  }
  return chunks;
}

function stripHtml(html) {
  return html
    .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, ' ')
    .replace(/<nav[^>]*>[\s\S]*?<\/nav>/gi, ' ')
    .replace(/<footer[^>]*>[\s\S]*?<\/footer>/gi, ' ')
    .replace(/<header[^>]*>[\s\S]*?<\/header>/gi, ' ')
    .replace(/<\/?(p|div|h[1-6]|li|tr|br|section|article)[^>]*>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&nbsp;/g, ' ').replace(/&quot;/g, '"').replace(/&#39;/g, "'")
    .replace(/&[a-z]+;/gi, ' ')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function extractTitle(html) {
  const m = html.match(/<title[^>]*>([^<]+)<\/title>/i);
  return m ? m[1].trim().replace(/[^a-zA-Z0-9 \-_.,]/g, ' ').replace(/\s+/g,' ').trim() : null;
}

async function fetchPlaylistItems(playlistId, apiKey) {
  const https = require('https'); const ids = []; let pageToken = '';
  do {
    const path = '/youtube/v3/playlistItems?part=contentDetails&maxResults=50&playlistId='
      + encodeURIComponent(playlistId) + '&key=' + apiKey + (pageToken ? '&pageToken='+pageToken : '');
    const data = await new Promise((res,rej) => {
      https.request({hostname:'www.googleapis.com',path,method:'GET'},(resp)=>{
        let d=''; resp.on('data',c=>d+=c); resp.on('end',()=>{try{res(JSON.parse(d));}catch(e){rej(e);}});
      }).on('error',rej).end();
    });
    if (data.error) throw new Error('YouTube API: '+data.error.message);
    (data.items||[]).forEach(item => { if (item.contentDetails&&item.contentDetails.videoId) ids.push(item.contentDetails.videoId); });
    pageToken = data.nextPageToken || '';
  } while (pageToken);
  return ids;
}

async function fetchYouTubeTranscript(videoId) {
  const https = require('https');
  function httpsGet(urlStr, headers, postBody) {
    return new Promise((resolve, reject) => {
      const u = new URL(urlStr);
      const opts = { hostname: u.hostname, path: u.pathname + u.search, method: postBody ? 'POST' : 'GET', headers: { 'User-Agent': 'Mozilla/5.0', ...headers } };
      if (postBody) opts.headers['Content-Length'] = Buffer.byteLength(postBody);
      const req = https.request(opts, (res) => {
        if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) { return httpsGet(res.headers.location, headers).then(resolve).catch(reject); }
        let d = ''; res.on('data', chunk => d += chunk); res.on('end', () => resolve({ status: res.statusCode, body: d }));
      });
      req.on('error', reject);
      if (postBody) req.write(postBody);
      req.end();
    });
  }
  function parseXmlTranscript(xml) {
    return xml.replace(/<text[^>]*>/g,' ').replace(/<\/text>/g,' ').replace(/<[^>]+>/g,' ')
      .replace(/&amp;/g,'&').replace(/&lt;/g,'<').replace(/&gt;/g,'>').replace(/&#39;/g,"'").replace(/&quot;/g,'"').replace(/\s+/g,' ').trim();
  }
  let title = videoId;
  try {
    const body = JSON.stringify({ videoId, context: { client: { clientName: 'ANDROID', clientVersion: '17.31.35', androidSdkVersion: 30, hl: 'en', gl: 'GB' } } });
    const resp = await httpsGet('https://www.youtube.com/youtubei/v1/player?key=AIzaSyA8eiZmM1fanX9f9kJY8m5xNJkPwOAfGaY', { 'Content-Type': 'application/json', 'X-YouTube-Client-Name': '3', 'X-YouTube-Client-Version': '17.31.35' }, body);
    if (resp.status === 200) {
      const data = JSON.parse(resp.body);
      if (data.videoDetails && data.videoDetails.title) title = data.videoDetails.title;
      const tracks = data?.captions?.playerCaptionsTracklistRenderer?.captionTracks || [];
      const track = tracks.find(t => t.languageCode === 'en' || t.languageCode === 'en-GB') || tracks[0];
      if (track && track.baseUrl) {
        const xmlResp = await httpsGet(track.baseUrl, {});
        if (xmlResp.status === 200 && xmlResp.body.length > 50) {
          const transcript = parseXmlTranscript(xmlResp.body);
          if (transcript.length > 50) return { title, transcript: '=== ' + title + ' ===\n\n' + transcript };
        }
      }
    }
  } catch(e) {}
  throw new Error('Could not fetch transcript. Try uploading a .txt transcript manually.');
}

server.listen(PORT, () => console.log(`Stacked Chat server running on port ${PORT}`));
