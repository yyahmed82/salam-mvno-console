/* DMS JOURNEY SPEC — the dealer journeys as the production code defines them (17 Sep 2026).
 *
 * Source: the JARs running on the APP nodes on 17 Sep 2026, decompiled and read end to end
 * (project docs DMS-JOURNEYS-CODE.md + DMS-CODE-A…F). This file is the machine-readable
 * extract: per journey the endpoint order the app follows, the systems touched in order, the
 * rows a NORMAL run leaves behind (its "signature"), the places it breaks, and the rule ids
 * (dmsFlowRules.js) that recognise the abnormal shapes. One spec drives DMS ▸ Explore, the
 * journeys board labels and the troubleshoot context — change it here, everything follows.
 *
 * Read-only data. `console` = key in dmsJourneys.JOURNEYS (null = no ledger table, cms_logs only).
 * `sanity` = row number in the CRQ000000185185 30-flow sanity list (the business's own inventory). */
'use strict';

const SYS = {
  app: 'DMS app', gw: 'API gateway', cus: 'dms_customer_service', onb: 'dms_onboarding_service', apc: 'dms_appcontent_service',
  pay: 'dms_payment_service', uil: 'UIL', bss: 'Optiva BSS (direct SOAP — no ledger row)', bssuil: 'Optiva BSS via UIL',
  semati: 'Semati / TCC', absher: 'Absher (ELM)', nafath: 'Nafath', kc: 'Keycloak', wallet: 'trms_wallet_service', sms: 'notification (esmg SMS)',
  magento: 'Magento (app content)', hyperpay: 'HyperPay', vra: 'VRA vouchers', crm: 'AppCrm REST', shop: 'Salam e-shop', ledger: 'RabbitMQ → dms_audit_logs'
};

const FAMILIES = {
  access: { label: 'Dealer access', icon: '🔐', doc: 'DMS-CODE-D-ONBOARDING.md' },
  activation: { label: 'Activation', icon: '▶', doc: 'DMS-CODE-A-ACTIVATION.md' },
  lifecycle: { label: 'Line lifecycle', icon: '⇄', doc: 'DMS-CODE-B-LIFECYCLE.md' },
  money: { label: 'Money', icon: '◈', doc: 'DMS-CODE-C-MONEY.md' },
  inventory: { label: 'SIM inventory & sales', icon: '▣', doc: 'DMS-CODE-A-ACTIVATION.md' }
};

/* step: { ep, svc, note } — ep is the URI the app (or the service) calls, in order */
const JOURNEYS = [
  {
    key: 'login', family: 'access', label: 'Dealer login', sanity: [1, 25, 30], console: null,
    purpose: 'Dealer signs in to the app: Keycloak password grant, Nafath for iam_token dealers without a valid Semati session, device registration, QR attendance, then Semati login (fingerprint / OTP / IAM app token) before any regulated transaction.',
    steps: [
      { ep: 'POST /onboarding/user/login', svc: 'onb', note: 'Keycloak password grant (dmsapplication/dmsclient); sessions of the user are pruned BEFORE the password is checked; every failure → 1500 "Invalid Username or Password"; 1502 = user not Active' },
      { ep: '(inside login) Nafath initiate', svc: 'onb', note: 'only iam_token=1 dealers without a valid semati_login_details row; fetches a Magento flag via appcontent first → an appcontent/Magento outage is a login outage' },
      { ep: 'POST /onboarding/user/checkNafathStatus (poll)', svc: 'onb', note: 'nafath_record INITIATED → COMPLETED|REJECTED via UIL /nafath/v1/callback (JWT not signature-verified, callback never logged)' },
      { ep: 'POST /onboarding/user/generateotp → /verifyotp', svc: 'onb', note: '4 digits 1–9, 2 min, 3 attempts (1002–1005); OTP stored in user_onboarding_logs.otp_req' },
      { ep: 'POST /onboarding/device/* (register)', svc: 'onb', note: 'dms_device_registration (duplicates on repeat), limits 1560/1561/1562; binding is app-side only' },
      { ep: 'POST /onboarding/qr/verify | /qr/loginwithoutqr', svc: 'onb', note: 'geofence in statute miles (1505/1509); first login-without-QR of the day auto-approved' },
      { ep: 'POST /cus/semati/login', svc: 'cus', note: 'UIL /tpi/semati/login → Semati /api/login; upserts semati_login_details; 1551 on failure' }
    ],
    systems: ['app', 'gw', 'onb', 'kc', 'apc', 'magento', 'nafath', 'uil', 'sms', 'cus', 'semati', 'ledger'],
    signature: [
      'user_onboarding_logs api_name=/onboarding/user/login response_Code=00 (+3 "Login" notification rows push/sms/email)',
      'user_onboarding_logs /onboarding/user/nafathApi + nafath_logs row; dms_v1.nafath_record status COMPLETED (iam_token dealers)',
      'user_onboarding_logs /onboarding/device/* 00; dms_v1.dms_device_registration row',
      'user_onboarding_logs /onboarding/qr/verify 00; dms_v1.dms_attendance row (login_time)',
      'cms_logs /cus/semati/login 00 + uil_logs /tpi/semati/login; dms_v1.semati_login_details (username, device_id, time)'
    ],
    breaks: [
      'Every dependency failure at login (channel service, missing dms_users_payment_method / qr_scan_login_time row, Keycloak timeout, NPE) → the same 1500 "Invalid Username or Password"',
      'Failed logins evict the dealer\'s live Keycloak sessions (pruning runs before authentication)',
      'Nafath sits in the login critical path; no TTL on INITIATED records',
      'Nightly logout-all at 23:58 kills every session → 00:00 login/Nafath/OTP storm',
      'Semati session gate (757) only enforced under a "preprod" profile; the customer service checks row presence only',
      '/user/resetPassword needs only username + new password (no OTP check server-side)'
    ],
    rules: ['L1', 'L2', 'L3', 'L4', 'L5', 'L6', 'L7', 'L8']
  },
  {
    key: 'activation', family: 'activation', label: 'Physical SIM activation', sanity: [2], console: 'activation',
    purpose: 'Sell and activate a physical SIM for a customer identified by national id / iqama / border number: Semati registration (type 1), BSS account + subscriber, contract (CSA), wallet debit.',
    steps: [
      { ep: 'POST /cus/simactivation/eligibility', svc: 'cus', note: 'Semati /api/eligibility/v2 for id types 1,2 (UIL /tpi/semati/check-eligibility); BSS listAccountsForId (errors swallowed → 00 with empty data)' },
      { ep: 'POST /cus/customer/verifyfingerprintauth', svc: 'cus', note: 'which auth options the app offers for this id type' },
      { ep: 'POST /cus/simactivation/verifybarcode', svc: 'cus', note: 'BSS getCardPackages state==1 (1526); dms_activated_iccids_history (1532 used / self-activation-only)' },
      { ep: 'POST /cus/simactivation/listmobilenumbers | /searchmobilenumber', svc: 'cus', note: 'BSS listMobileNumbers (no reservation yet)' },
      { ep: 'auth: /generateotp + /verifyotp | /generateabshirotp (Semati SMS OTP, direct) | /abshir/createverificationrequest + /checkstatus | IAM app token', svc: 'cus', note: 'exceptionFlag 0/7 finger, 8 Semati OTP, 11 IAM JWT (PersonId claim, no signature check), 13 Absher; /activate never re-checks the OTP' },
      { ep: 'POST /cus/simactivation/dealerexemptedoverride', svc: 'cus', note: 'price override / exemption lookup for the UI' },
      { ep: 'POST /cus/simactivation/activate', svc: 'cus', note: 'ICCID/plan restriction 1501 → Semati session 757 → eligibility (Magento) 1501/1502 → ICCID used 1532 → balance/channel/working hours 1500 → BSS updateEntity → UIL number-reserve → dms_users_plans block 1500 → Semati new-mobile-number (type 1) → BSS createAccount/createIndividualSubscriber (SOAP; on throw: Semati cancel type 4, 1532) → BSS transactions (adj 50071 top-up, 50069 SIM price) → CSA (swallowed) → UIL store-csa + send-attachment → wallet initiate+commit (accountTo 1234567, "Sim Activation"; skipped if exempted / TPP) → dms_activated_iccids_history → 00 (unconditional) → zatca_integration' }
    ],
    systems: ['app', 'gw', 'cus', 'apc', 'magento', 'uil', 'crm', 'semati', 'bss', 'wallet', 'sms', 'ledger'],
    signature: [
      'cms_logs /cus/simactivation/eligibility 00 (+ uil_logs /tpi/semati/check-eligibility)',
      'cms_logs /cus/simactivation/verifybarcode 00 (cardPackageId_req = ICCID)',
      'cms_logs /cus/simactivation/generateotp 00 + /verifyotp 00 (otp_req in clear) — or generateabshirotp / abshir rows',
      'uil_logs /tpi/bss/crm/number-reserve response_Code=0',
      'uil_logs /tpi/semati/new-mobile-number + semati_logs request_type=1 response_Code=600 (msisdn, sim_list, person_id, tcn)',
      'uil_logs /tpi/bss/csa/store-csa, /tpi/bss/csa/send-attachment',
      'cms_logs /cus/simactivation/activate 00 Success (transactionId_resp = BSS subscriber id, payment_id) — same logs_reference_id as the rows above',
      'sim_activation_logs (mobile_number, sim_iccid_number, customer_id_number, price_plan_id, bss_system_id, payment_id, exception_flag, channel_code) + dms_v1.dms_sim_activation_report',
      'dms_v1.dms_activated_iccids_history use_case=SIM_ACTIVATION; dms_v1.zatca_integration Pending; trms_wallet.wallet_payment_initiate PAID comments="Sim Activation"'
    ],
    breaks: [
      'Wallet debit failure is MASKED: 00 Success set unconditionally after the payment block → sim_activation_logs shows a paid activation with empty payment_id (rule M2)',
      'Semati is cancelled (type 4) only when BSS creation throws; failures in BSS transactions / CSA / accountID==null (responseCode=null) / Feign timeout leave Semati registered + BSS active + no debit + ICCID not marked used (rule S1)',
      'BSS number reservation never released on later rejection (plan block, balance) (rule J1)',
      'Hybrid (accountType 2): parent account + dummy postpaid subscriber (plan 100106) remain in BSS on failure',
      'Semati cancel response never checked (rule S8); bypassSemati request field skips Semati with border number 10011234566 (rule S10)',
      'Direct SOAP BSS calls leave no row anywhere — only customer-service.log; a filter/producer failure drops the whole ledger row'
    ],
    rules: ['S1', 'S8', 'S10', 'S11', 'J1', 'J2', 'J3', 'J7', 'J12', 'J13', 'M2']
  },
  {
    key: 'data_sim', family: 'activation', label: 'Additional data SIM', sanity: [4], console: 'activation',
    purpose: 'Attach a data-only SIM (BSS group 11, 9668… number) to an existing voice subscription of the same customer.',
    steps: [
      { ep: 'POST /cus/simactivation/datanumbereligibility', svc: 'cus', note: 'BSS profile; plan must be in additional_data_plans (1532); no active 9668 sub-line (1500)' },
      { ep: 'POST /cus/simactivation/generateotp (useCase datasimactivation) → /verifyotp', svc: 'cus' },
      { ep: 'POST /cus/simactivation/activatedatasim', svc: 'cus', note: 'Semati new-sim (type 2, on the VOICE msisdn) → BSS createIndividualSubscriber with hardcoded plan 100104 (prepaid) / 100010 (postpaid), data number from group 11 → supplementary ADDITIONAL_DATA_MSISDN (swallowed) → 00. No wallet, no CSA.' }
    ],
    systems: ['app', 'cus', 'uil', 'semati', 'bss', 'ledger'],
    signature: [
      'uil_logs /tpi/semati/new-sim + semati_logs request_type=2 600 msisdn=<voice>',
      'cms_logs /cus/simactivation/activatedatasim 00',
      'sim_activation_logs api_name=/cus/simactivation/activatedatasim mobile_number=<data number 9668…> payment_id empty'
    ],
    breaks: ['NO Semati cancel-sim on BSS failure → orphan SIM at the regulator (rule S2)', 'CRM fault message overwritten by "Failure"'],
    rules: ['S2', 'S3']
  },
  {
    key: 'esim', family: 'activation', label: 'eSIM activation (+ eSIM data)', sanity: [5, 6], console: 'activation',
    purpose: 'Same as physical activation on an eSIM profile: reservation extended, IMSI derived, activation code fetched from BSS.',
    steps: [
      { ep: 'POST /cus/e-simactivation/esim-eligibility → esim-listcardpackagesrest → esim-listmobilenumbers', svc: 'cus' },
      { ep: 'auth: esim-generateotp / esim-verifyotp / esim-generateabshirotp', svc: 'cus', note: 'accountType forced to 0 in the OTP SMS; Absher OTP checks Semati code 1003' },
      { ep: 'POST /cus/e-simactivation/esim-activate', svc: 'cus', note: 'PUT /tpi/bss/crm/update-resource-reservation (outside try → 1500/1001 if it throws) → IMSI "420"+iccid[5:] → no working-hours check → Semati type 1 (isESim) → BSS createIndividualSubscriberESim → transactions → CSA → wallet ("E-Sim Activation") → activation code via /tpi/bss/generic-entity/check-mobile-reservation (null on failure, still 00)' },
      { ep: 'POST /cus/e-simactivation/activation-code', svc: 'cus', note: 're-fetch the activation code' },
      { ep: 'POST /cus/e-simactivation/esim-datanumbereligibility → esim-activatedatasim', svc: 'cus', note: 'eSIM data SIM variant' }
    ],
    systems: ['app', 'cus', 'uil', 'crm', 'semati', 'bss', 'wallet', 'ledger'],
    signature: [
      'uil_logs /tpi/bss/crm/update-resource-reservation', 'semati_logs request_type=1 600 sim_list isESim=true',
      'uil_logs store-csa, send-attachment, /tpi/bss/generic-entity/check-mobile-reservation',
      'cms_logs /cus/e-simactivation/esim-activate 00 + sim_activation_logs api_name=/cus/e-simactivation/esim-activate; zatca_integration usecase=esim-activation'
    ],
    breaks: ['Same wallet masking and Semati compensation gaps as physical activation', 'eSimEligibility catch sets responseCode="Failure" (string) on exception', 'activation code null → app cannot install the profile although 00 was returned'],
    rules: ['S1', 'M2', 'J2']
  },
  {
    key: 'reauth', family: 'activation', label: 'Re-authentication', sanity: [], console: 'reauth',
    purpose: 'Re-verify the customer identity of an active line at Semati (regulatory), no BSS change.',
    steps: [{ ep: 'POST /cus/simactivation/reauthenticate (eSIM: /e-simactivation/esim-reauthenticate)', svc: 'cus', note: 'BSS profile/card package (SOAP) → Semati /tpi/semati/new-mobile-number — i.e. request_type 1, NOT type 19; msisdnType must be V (1533)' }],
    systems: ['app', 'cus', 'bss', 'uil', 'semati', 'ledger'],
    signature: ['uil_logs /tpi/semati/new-mobile-number + semati_logs request_type=1 600', 'cms_logs /cus/simactivation/reauthenticate 00 + sim_reauthentication_logs (eSIM variant: cms_logs only)'],
    breaks: ['Indistinguishable from a new registration in semati_logs (type 1) — rule S1 must exclude re-auth rows'],
    rules: ['S1']
  },
  {
    key: 'mnp', family: 'lifecycle', label: 'Port-in (MNP, SIM / eSIM)', sanity: [26], console: 'mnp',
    purpose: 'Port a number from another operator: Semati transfer-operator, BSS parent/sub accounts, port order, wallet debit.',
    steps: [
      { ep: 'POST /cus/mnp/initiate (| /initiateabshir)', svc: 'cus', note: 'Semati eligibility for id types 1,2; 1520 without default number; catch returns a null message' },
      { ep: 'POST /cus/mnp/verifyotp → /mnp/verifybarcode', svc: 'cus' },
      { ep: 'POST /cus/mnp/transportoperator (eSIM: /esim-mnp/esim-transportoperator)', svc: 'cus', note: 'session 757 → Magento eligibility 1501 → Semati transfer-operator (type 18) → BSS createAccount ×2 (SOAP, never deleted on failure) → UIL /tpi/bss/mnp/create-port-order → wallet debit "MNP" → dms_activated_iccids_history MNP → 00; any exception after the port order → Semati cancel (type 4) + 1500 while the Optiva order stands' }
    ],
    systems: ['app', 'cus', 'apc', 'magento', 'uil', 'semati', 'bss', 'bssuil', 'wallet', 'ledger'],
    signature: ['uil_logs /tpi/semati/transfer-operator + semati_logs request_type=18 600', 'uil_logs /tpi/bss/mnp/create-port-order 00', 'cms_logs /cus/mnp/transportoperator 00 + mnp_logs (mobile_number, donor_operator, iccid_number, bss_system_id, payment_id; msisdn_type always "unknown")', 'wallet_payment_initiate PAID comments="MNP"'],
    breaks: ['Wallet or any failure AFTER the port order cancels Semati while the port order and BSS accounts remain (rules S4, S5)', 'eSIM MNP with paymentMode=TPP or exempted plan NPEs after the port order', 'Replay after timeout creates a second Semati transfer + BSS account pair'],
    rules: ['S4', 'S5', 'S8', 'M2', 'M12']
  },
  {
    key: 'sim_swap', family: 'lifecycle', label: 'SIM swap (voice / data / eSIM)', sanity: [7, 12], console: 'sim_swap',
    purpose: 'Replace the SIM of an active line: Semati new-sim then cancel-sim, BSS card package update, wallet fee.',
    steps: [
      { ep: 'POST /cus/simswap/verifybarcode → OTP', svc: 'cus' },
      { ep: 'POST /cus/simswap/swap | /datasimswap | /e-simswap/e-swap | /e-datasimswap', svc: 'cus', note: 'session 757 → BSS profile + card package (SOAP) → Semati new-sim (type 2) → Semati cancel-sim (type 5) → BSS updateCardPackage → wallet debit (2875 halalas literal; eSIM data 500; eSIM swap checks 500 but debits 2875) → dms_activated_iccids_history SIM_SWAP (not for data swaps) → 00' }
    ],
    systems: ['app', 'cus', 'bss', 'uil', 'semati', 'wallet', 'ledger'],
    signature: ['semati_logs request_type=2 600 then request_type=5 600 same msisdn within seconds', 'uil_logs /tpi/semati/new-sim, /tpi/semati/cancel-sim (eSIM: update-resource-reservation, check-mobile-reservation)', 'cms_logs /cus/simswap/swap 00 + sim_swap_logs / data_sim_swap_logs (new_iccid_number, old_iccid_number, old_imsi_number, bss_system_id, payment_id)'],
    breaks: ['Physical swap ignores a non-Success wallet initiate → 00 without payment (rule M2)', 'paymentMode=TPP NPEs AFTER Semati + BSS updates (rule S3/S6-style: swap done, response failed)', 'dms_semati_configurations semati.cancel.sim.check=true lets the swap continue after a failed Semati new-sim', 'Swap never consults ICCID usage history'],
    rules: ['S3', 'S8', 'M2']
  },
  {
    key: 'ownership', family: 'lifecycle', label: 'Transfer of ownership', sanity: [11], console: 'ownership',
    purpose: 'Move a line from customer A to customer B: Semati transfer-ownership, BSS deactivate A / reserve / create B, contract, wallet debit.',
    steps: [
      { ep: 'POST /cus/ownership/getownershipconfiguration → /ownershipbalancecheck', svc: 'cus' },
      { ep: 'POST /cus/ownership/ownershipgenerateotp ×3 (old, new, confirmation) | /generateabshirotp', svc: 'cus', note: 'none re-checked by /update; bypass flag on dms_users skips OTP' },
      { ep: 'POST /cus/ownership/update', svc: 'cus', note: 'session → Absher/IAM identity → Tamkeen count 1501 → restricted_plan_ids 1535 → dms_users_plans block-list 1500 (STILL enforced here) → Semati transfer-ownership (type 17) → BSS deactivate A, number-reserve, create B (1001 with reservation payload), CSA, store-csa/send-attachment → wallet debit "Ownership Transfer" → 00 (overwrites a wallet 1001)' },
      { ep: 'POST /cus/ownership/revert (rollback) · /disable · /addsupplementorydataforcusb', svc: 'cus', note: 'revert = second type 17, no ledger; disable deactivates nothing; addsupplementorydataforcusb always 1500' }
    ],
    systems: ['app', 'cus', 'uil', 'crm', 'semati', 'bss', 'bssuil', 'wallet', 'sms', 'ledger'],
    signature: ['uil_logs get-subscription-profile, get-account-profile/v2, update-account-profile, number-reserve, add-update-supplementary-data, store-csa, send-attachment, /tpi/semati/transfer-ownership', 'semati_logs request_type=17 600', 'cms_logs /cus/ownership/update 00 + transfer_ownership_logs (previous_customer_id_number, new_customer_id_number, mobile_number; finger_print_option="??", location="field is PENDING")', 'wallet_payment_initiate PAID comments="Ownership Transfer"'],
    breaks: ['Wallet 1001 overwritten by 00 Success (update AND revert) → transfer without payment ledgered as success (rule M2)', 'A deactivated, B not created → number reserved, 1001 only in cms_logs.response (rule S6)', 'bypassSemati request field honoured (rule S10)'],
    rules: ['S6', 'S8', 'S10', 'M2']
  },
  {
    key: 'plan_change', family: 'lifecycle', label: 'Change plan (pre↔post)', sanity: [3, 8, 9, 10], console: 'plan_change',
    purpose: 'Change billing type / price plan: Semati change-subscription, BSS conversion, wallet debit, BSS adjustment, contract.',
    steps: [
      { ep: 'POST /cus/priceplan/priceplanchangevalidation', svc: 'cus', note: 'UIL /tpi/bss/crm/price-plan-change-validation; 5003 subscriber not active' },
      { ep: 'POST /cus/priceplan/priceplangenerateotp | /generateabshirotp → /simactivation/verifyotp', svc: 'cus' },
      { ep: 'POST /cus/priceplan/update', svc: 'cus', note: 'session → restricted_plan_ids 1535 → Magento eligibility ("Plan is not allowed" only returns for language=ar) → Semati change-subscription (type 6) → UIL convert-billing-type / update-subscription-price-plan-options → wallet debit "Update price plan" → UIL create-subscription-transaction (adjustment.type*) → update-account-profile, CSA, store-csa/send-attachment → 00 (fake pid 23/7823 for TPP / post→post)' }
    ],
    systems: ['app', 'cus', 'apc', 'magento', 'uil', 'semati', 'bssuil', 'bss', 'wallet', 'ledger'],
    signature: ['semati_logs request_type=6 600', 'uil_logs /tpi/bss/account/convert-billing-type 00 | /tpi/bss/subscription/update-subscription-price-plan-options 00', 'uil_logs /tpi/bss/transaction/create-subscription-transaction 00, update-account-profile, store-csa, send-attachment', 'cms_logs /cus/priceplan/update 00 + price_plan_logs (old_billing_type, new_billing_type, price_plan_id, price_plan_price, bss_system_id)', 'wallet_payment_initiate PAID comments="Update price plan"'],
    breaks: ['Wallet 1001 overwritten by 00 at the end (rule M2)', 'Adjustment failure AFTER a successful debit → error, no refund (rule M4)', 'Semati changed but BSS conversion failed → mismatch; a second type 6 = revert (rule S7)', 'Up to ~15 sequential downstream calls — minutes per request'],
    rules: ['S7', 'S10', 'M2', 'M4']
  },
  {
    key: 'plan_renew', family: 'lifecycle', label: 'Renew Now', sanity: [20], console: 'plan_renew',
    purpose: 'Renew the customer plan from the dealer wallet, with dealer commission.',
    steps: [
      { ep: 'POST /cus/priceplan/get', svc: 'cus', note: 'attempt count from renew_now_log, price from renew_plan_price_config' },
      { ep: 'POST /cus/priceplan/priceplanrenewgenerateotp → verify', svc: 'cus' },
      { ep: 'POST /cus/priceplan/renew', svc: 'cus', note: 'WALLET DEBIT FIRST ("Renew now") → UIL create-subscription-transaction (customer credit) → UIL validate-and-run-base-renewal → renew_now_log → commission credit (COMMISSION/TRMS_COMMISSION, commision_request_report, SMS dealer_sms_log) → 00; no Semati gate, no plan block-list (Skip Plan Validation); attemptCount / isEligibleForCommission are CLIENT-supplied' }
    ],
    systems: ['app', 'cus', 'wallet', 'uil', 'bssuil', 'sms', 'ledger'],
    signature: ['wallet_payment_initiate PAID comments="Renew now"', 'uil_logs /tpi/bss/transaction/create-subscription-transaction 00', 'uil_logs /tpi/bss/balance/validate-and-run-base-renewal', 'cms_logs /cus/priceplan/renew 00 + renew_priceplan_logs (msisdn, price_plan_id, plan_price, attempt_count, is_eligible_for_commission)', 'dms_v1.renew_now_log, commision_request_report; dealer_sms_log; wallet COMMISSION credit'],
    breaks: ['Any BSS failure after the debit leaves the dealer debited with NO refund path (rule M3)', 'Freely replayable — each replay debits again (rule M12)', 'Commission driven by client-supplied flags'],
    rules: ['M3', 'M12']
  },
  {
    key: 'line_termination', family: 'lifecycle', label: 'Line termination', sanity: [19], console: null,
    purpose: 'Terminate a line (or its data-SIM only): BSS state transitions. No Semati call, no ledger table.',
    steps: [
      { ep: 'POST /cus/linedeactivation/get-balance', svc: 'cus' },
      { ep: 'POST /cus/simactivation/generateotp (useCase linedeactivation) → verify', svc: 'cus' },
      { ep: 'POST /cus/linedeactivation/line-deactivation', svc: 'cus', note: 'UIL update-account-profile, list-subscriptions, list-sub-accounts, update-account-state, update-subscription-with-state-transition + direct SOAP state transition of the main line; per-subscription lambda errors overwrite each other' }
    ],
    systems: ['app', 'cus', 'uil', 'bssuil', 'bss', 'ledger'],
    signature: ['cms_logs /cus/linedeactivation/get-balance 00', 'uil_logs update-account-profile, list-subscriptions, list-sub-accounts, update-account-state, update-subscription-with-state-transition', 'cms_logs /cus/linedeactivation/line-deactivation 00 — the ONLY DB trace of the termination'],
    breaks: ['Invisible in every journey table (rule J10 derives it from cms_logs)', 'No Semati session gate; OTP not re-checked'],
    rules: ['J10']
  },
  {
    key: 'addon', family: 'lifecycle', label: 'Add-on purchase / cancel', sanity: [], console: 'addon',
    purpose: 'Sell an add-on (data/international/…) to a customer, paid by the dealer wallet (DEALER) or the customer balance (USER). September 2026 release; AddOnServiceImpl hot-fixed 17 Sep.',
    steps: [
      { ep: 'POST /cus/addon/subscriberinfo → /listavailable (/scopecategories, /internationalcountries)', svc: 'cus', note: 'UIL get-subscription-profile (5003 not active), get-subscription-balance' },
      { ep: 'POST /cus/addon/generateotp | /generateabshirotp → /verifyotp', svc: 'cus', note: 'not re-checked by /purchase' },
      { ep: 'POST /cus/addon/purchase', svc: 'cus', note: 'DEALER: wallet balance check → UIL create-subscription-transaction (BSS credit; prepaid VAT-excluded ÷1.15 literal, postpaid VAT-inclusive) → UIL update-subscription-price-plan-options (option on) → wallet debit "Add-on Purchase" → dms_v1.addon_transaction_history → 00; any failure → 01' },
      { ep: 'POST /cus/addon/listactive → /cancel', svc: 'cus' }
    ],
    systems: ['app', 'cus', 'uil', 'bssuil', 'wallet', 'sms', 'ledger'],
    signature: ['uil_logs get-subscription-profile, get-subscription-balance, create-subscription-transaction 00, update-subscription-price-plan-options 00', 'cms_logs /cus/addon/purchase 00 + addon_logs (msisdn, addon_id, addon_name, addon_price, payment_source, payment_mode, otp_mob — NO dealer columns: attribute via cms_logs.logs_reference_id)', 'dms_v1.addon_transaction_history (DEALER only); wallet PAID comments="Add-on Purchase"'],
    breaks: ['Wallet failure after two BSS writes → 01: customer keeps add-on + credit, dealer not charged (rule M5)', 'Replay re-credits and re-debits (rule M12)'],
    rules: ['M5', 'M12', 'J15']
  },
  {
    key: 'manafith', family: 'lifecycle', label: 'Manafith API log', sanity: [], console: 'manafith',
    purpose: 'The app records the Manafith (Absher/Nafath app) API outcome before a Semati transaction (CHG0030237); the "stop on failure" rule is client-side only.',
    steps: [{ ep: 'POST /cus/manafith/manafith-addlog', svc: 'cus', note: 'writes dms_audit_logs.manaftih_api_logs (id, dealer_name, response, msisdn, flow_name, created_date) DIRECTLY (audit datasource) — no RabbitMQ, no auth' }],
    systems: ['app', 'cus'], signature: ['manaftih_api_logs row + cms_logs /cus/manafith/manafith-addlog 00'],
    breaks: ['Nothing server-side stops the flow on a non-success response (rule J15)'], rules: ['J15']
  },
  {
    key: 'topup', family: 'money', label: 'Top-up / dynamic recharge / full MRC', sanity: [16, 17, 18], console: 'topup',
    purpose: 'Credit a prepaid customer from the dealer wallet.',
    steps: [
      { ep: 'POST /cus/recharge/generateotp → /verifyotp · /transactionauthpolicy/getrechargedailylimit', svc: 'cus', note: 'advisory only — topup never enforces them; daily sum comes from the audit consumer (topup_logs)' },
      { ep: 'POST /cus/recharge/topup (| /recharge/mrc)', svc: 'cus', note: 'validations (dealer, min/max, prepaid only, solo digital, exists) → BSS createSubscriptionTransaction adj 50071 BEFORE the wallet → wallet debit "Topup" → result OVERWRITTEN with 00 Success unconditionally' }
    ],
    systems: ['app', 'cus', 'bss', 'wallet', 'ledger'],
    signature: ['cms_logs /cus/recharge/topup 00 + topup_logs recharge=Y (payment_id never filled for top-ups)', 'wallet_payment_initiate PAID comments="Topup"'],
    breaks: ['Wallet failure invisible: topup_logs records a success, daily limit consumed, customer keeps the BSS credit (rule M1)', 'No idempotency — retry = double top-up (rule M12)', 'Daily cap under-counts during a consumer backlog (rule M11)'],
    rules: ['M1', 'M11', 'M12']
  },
  {
    key: 'evoucher', family: 'money', label: 'E-voucher', sanity: [14, 15], console: 'topup',
    purpose: 'Buy a voucher (VRA) from the dealer wallet and send it by SMS.',
    steps: [{ ep: 'POST /cus/recharge/evoucher → /recharge/send', svc: 'cus', note: 'VRA voucher created + customer SMS BEFORE the wallet debit; voucher number from SimpleDateFormat("HHSSSddyymmMMss") (collision-prone); /send type 1 never sends an SMS' }],
    systems: ['app', 'cus', 'vra', 'sms', 'wallet', 'ledger'],
    signature: ['cms_logs /cus/recharge/evoucher 00 (voucherNo_resp / serialNo_resp hold the PIN) + topup_logs e_voucher=Y payment_id=<wallet id>', 'wallet_payment_initiate PAID comments="Evoucher"'],
    breaks: ['Voucher issued and texted, then wallet fails → error to the dealer, voucher live (rule M9)'], rules: ['M9', 'M12']
  },
  {
    key: 'bill_payment', family: 'money', label: 'Bill payment', sanity: [13], console: null,
    purpose: 'Pay a postpaid bill from the dealer wallet (CRQ000000185185 fix, 22 Jun 2026).',
    steps: [
      { ep: 'POST /cus/bill/generateList → /bill/generate', svc: 'cus', note: 'payable amount per BAN (UIL get-payable-amount)' },
      { ep: 'POST /cus/bill/payment', svc: 'cus', note: 'UIL create-account-transaction adjustment 50069 (literal; response body discarded) BEFORE the wallet → wallet debit "Bill Payment" → dms_v1.payment_history (success only); no try/catch around the money part → 1001 "Internal Server Error!" / 1500; accountId sent to BSS = request idNumber (must be the BAN)' }
    ],
    systems: ['app', 'cus', 'uil', 'bssuil', 'wallet', 'ledger'],
    signature: ['uil_logs /tpi/bss/crm/get-payable-amount, /tpi/bss/transaction/create-account-transaction', 'cms_logs /cus/bill/payment 00 (NO audit ledger table)', 'dms_v1.payment_history row; wallet_payment_initiate PAID comments="Bill Payment"'],
    breaks: ['BSS adjustment before money, no reversal (rule M10)', 'No ledger table — only cms_logs + payment_history'], rules: ['M10', 'M12']
  },
  {
    key: 'wallet_move', family: 'money', label: 'Dealer-to-dealer wallet transfer', sanity: [21, 22, 23, 24, 29], console: 'wallet_move',
    purpose: 'Move money between dealer wallets; statements and transaction history.',
    steps: [
      { ep: 'POST /cus/wallet/wallettransferverification (OTP) → /wallet/wallettransfer', svc: 'cus', note: 'wallet WALLET_TRANSFER — the only type whose "Insufficient balance" branch works; a transfer to an unknown dealer code produces NO audit row (NPE in the filter enrichment)' },
      { ep: 'POST /cus/wallet/agenttransactionreport · /accountagenttransactionreport · wallet /was/account/transactions/an/*', svc: 'cus', note: 'agenttransactionreport is broken (same DTO repeated 100×)' }
    ],
    systems: ['app', 'cus', 'wallet', 'sms', 'ledger'],
    signature: ['cms_logs /cus/wallet/wallettransfer 00 + wallet_money_transfer_logs (reason always empty)', 'wallet_payment_initiate WALLET_TRANSFER PAID (+ wallet_payment_commit child)'],
    breaks: ['Reservation leak: PENDING WALLET_TRANSFER rows when the recon job aborts on a missing account (rule M6)', 'No row locks in the wallet — lost updates between instances'], rules: ['M6', 'M12']
  },
  {
    key: 'wallet_refill', family: 'money', label: 'Wallet refill (admin / HyperPay / SADAD)', sanity: [], console: 'wallet_refill',
    purpose: 'Credit a dealer wallet: admin approval (v2), card via HyperPay, SADAD (no credit path exists).',
    steps: [
      { ep: 'POST /cus/wallet/v2/refill → /getrefillrequestsbystatus → /updaterefillrequests', svc: 'cus', note: 'refill_wallet_requests Pending → Approved written BEFORE the credit; re-approval re-credits; admin source account 1234569' },
      { ep: 'POST /pay/v1/transaction/create → (app pays at HyperPay) → POST /pay/v1/transaction/get', svc: 'pay', note: 'no server callback, no checkout persisted, credited amount taken from the client, re-poll credits twice, success path NPEs after crediting → 1500 and wallet_refill_logs never written; prod bearer token + entity id hard-coded' },
      { ep: 'POST /pay/v1/saadad/create · SADAD callback', svc: 'pay', note: 'callback only prints and answers 0000 — no credit path' }
    ],
    systems: ['app', 'cus', 'pay', 'hyperpay', 'wallet', 'ledger'],
    signature: ['dms_v1.refill_wallet_requests Approved + wallet_payment_initiate HYPERPAY_TOPUP account_from=1234569 (admin) | 1234567 comments="Credit Transaction Hyperpay" (card)', 'cms_logs /pay/v1/transaction/create 00, /pay/v1/transaction/get (≠00 today)'],
    breaks: ['HyperPay: no callback, double credit on re-poll, wallet_refill_logs unreachable (rule M8)', 'Approved-before-credit, re-approval re-credits (rule M7)'], rules: ['M7', 'M8', 'M13']
  },
  {
    key: 'self_activation', family: 'money', label: 'Self-activation portal (dealer money side)', sanity: [], console: 'self_activation',
    purpose: 'Customer self-activates online under a dealer: the portal calls the customer service (through UIL) to check/deduct the dealer balance and pay/refund commission.',
    steps: [{ ep: '/cus/self-activtion-portal/getmsisdnbyusername → /balance → /deductdealerbalance (HMAC username_amount) → /report → /commission | /refundcommission', svc: 'cus', note: 'HMAC replayable; "The Amount is Invalid" returns 00; catch blocks set responseCode="Failure"; refund on port rejection re-executable' }],
    systems: ['app', 'uil', 'cus', 'wallet', 'sms', 'ledger'],
    signature: ['uil_logs /tpi/self-activation-portal/* + cms_logs /cus/self-activtion-portal/* (no journey table)', 'wallet PAID comments="Self Activation" | "Refund"; COMMISSION credits', 'dms_v1.report_request_self_activation (order_status, commission_status, refund_status, payment_id)'],
    breaks: ['Debit/refund without idempotency (rule M12)', 'Commission paid before the report row is saved'], rules: ['M12']
  },
  {
    key: 'sim_inventory', family: 'inventory', label: 'SIM inventory: assign / receive / transfer / QR issuance', sanity: [], console: 'sim_receiving',
    purpose: 'Distributor → dealer SIM ranges, and Salam e-shop order pickup by QR.',
    steps: [
      { ep: 'POST /cus/simreceiving/assignsim → /receive → /assignsimtousers → /transfer', svc: 'cus', note: 'dms_v1 sim_assigning_details / sim_inventory / sim_sub_inventory; /activate never checks inventory ownership' },
      { ep: 'POST /cus/simreceiving/get-qr-details → /issue-sim', svc: 'cus', note: 'UIL /tpi/salam/get-qr-details, /issue-sim → Salam e-shop; dmsReferenceId = 7-digit OTP (7777 if static.otp); DB updates after the shop marked the order issued are swallowed' }
    ],
    systems: ['app', 'cus', 'uil', 'shop', 'ledger'],
    signature: ['cms_logs /cus/simreceiving/receive 00 + sim_receiving_logs', 'uil_logs /tpi/salam/get-qr-details, /tpi/salam/issue-sim; cms_logs /cus/simreceiving/issue-sim 00 + sim_issuance_logs (agent columns empty by construction)', 'dms_v1.sim_issuance_details Pending → Issued; dms_activated_iccids_history SIM_ISSUANCE ×2'],
    breaks: ['Issued at the shop, DB update swallowed → ICCID later refused as used, or not (rule J9)', 'return-assigned-sim deletes before re-inserting without a transaction'], rules: ['J9', 'J12']
  },
  {
    key: 'device_sale', family: 'inventory', label: 'Device sale', sanity: [], console: 'device_sale',
    purpose: 'Sell devices from dealer inventory, paid from the wallet, with invoice/ZATCA.',
    steps: [{ ep: 'POST /cus/devicesales/selldevice (…getinventory, assigninventory, receiveinventory…)', svc: 'cus', note: 'debit per device inside a lambda with a shared response; partial multi-device failures leave earlier devices debited/Sold and the final code can flip back to 00' }],
    systems: ['app', 'cus', 'wallet', 'sms', 'ledger'],
    signature: ['cms_logs /cus/devicesales/selldevice 00 + device_sales_logs (first device)', 'wallet PAID comments="Device Sale" per device; dms_v1.device_assigning_details Sold, zatca_integration'],
    breaks: ['Partial multi-device sale (rule M12-style count mismatch)'], rules: ['M12']
  }
];

const RULE_META = {
  M1: { sev: 'P2', family: 'money', title: 'Top-up success without wallet debit' },
  M2: { sev: 'P2', family: 'money', title: 'Journey success without payment' },
  M3: { sev: 'P2', family: 'money', title: 'Renew Now debited, not renewed' },
  M4: { sev: 'P2', family: 'money', title: 'Change plan: adjustment failed after debit' },
  M5: { sev: 'P2', family: 'money', title: 'Add-on: BSS credited, no purchase row' },
  M6: { sev: 'P3', family: 'money', title: 'Stuck / unreconciled wallet initiates' },
  M7: { sev: 'P3', family: 'money', title: 'Refill approved with ≠1 credit or pending > 1 h' },
  M8: { sev: 'P3', family: 'money', title: 'HyperPay checkout without credit / duplicate credit' },
  M9: { sev: 'P2', family: 'money', title: 'E-voucher issued but unpaid' },
  M10: { sev: 'P2', family: 'money', title: 'Bill payment wallet ↔ payment_history mismatch' },
  M11: { sev: 'P4', family: 'money', title: 'Daily top-up cap exceeded' },
  M12: { sev: 'P3', family: 'money', title: 'Duplicate money movement (replay)' },
  M13: { sev: 'P3', family: 'money', title: 'Negative wallet balance' },
  S1: { sev: 'P2', family: 'regulator', title: 'Orphan Semati registration (type 1 without activation or cancel)' },
  S2: { sev: 'P2', family: 'regulator', title: 'Orphan data SIM at Semati (type 2, no activation)' },
  S3: { sev: 'P2', family: 'regulator', title: 'SIM swap half-done (type 2 without type 5)' },
  S4: { sev: 'P2', family: 'regulator', title: 'MNP moved at Semati, no port order' },
  S5: { sev: 'P2', family: 'regulator', title: 'Port order created but response failed / cancelled after' },
  S6: { sev: 'P2', family: 'regulator', title: 'Ownership moved at Semati, no ledger success' },
  S7: { sev: 'P2', family: 'regulator', title: 'Plan changed at Semati, not converted at BSS' },
  S8: { sev: 'P2', family: 'regulator', title: 'Failed Semati compensation (cancel ≠ 600)' },
  S9: { sev: 'P3', family: 'regulator', title: 'Compensation storm (cancel ratio)' },
  S10: { sev: 'P2', family: 'regulator', title: 'Activation without Semati / bypassSemati in use' },
  S11: { sev: 'P3', family: 'regulator', title: 'Semati executed but caller got an error' },
  S12: { sev: 'P3', family: 'regulator', title: 'Semati rejection rate by request type' },
  S13: { sev: 'P3', family: 'regulator', title: 'Semati latency' },
  J1: { sev: 'P3', family: 'integrity', title: 'Dangling BSS number reservation' },
  J2: { sev: 'P3', family: 'integrity', title: 'Journey row missing for a 00 call' },
  J3: { sev: 'P3', family: 'integrity', title: 'UIL Semati call with no customer-service row' },
  J4: { sev: 'P4', family: 'integrity', title: 'Filter enrichment loss (channel_id NULL)' },
  J5: { sev: 'P2', family: 'integrity', title: 'Ledger silence (no rows arriving)' },
  J6: { sev: 'P3', family: 'integrity', title: 'Consumer dropping messages' },
  J7: { sev: 'P4', family: 'integrity', title: 'Re-used ICCID attempts' },
  J8: { sev: 'P4', family: 'integrity', title: 'Absher verification stuck' },
  J9: { sev: 'P4', family: 'integrity', title: 'Issued SIM without usage record' },
  J10: { sev: 'P3', family: 'integrity', title: 'Line termination without pre-steps / reuse after termination' },
  J11: { sev: 'P4', family: 'integrity', title: 'Duplicate journey rows (redelivery)' },
  J12: { sev: 'P2', family: 'integrity', title: 'Static OTP 7777 in production' },
  J13: { sev: 'P3', family: 'integrity', title: 'OTP brute force / bypass' },
  J14: { sev: 'P3', family: 'integrity', title: 'Downstream timeouts (UIL 5002 / SOAP)' },
  J15: { sev: 'P4', family: 'integrity', title: 'Add-on without verified OTP / Manafith failure ignored' },
  L1: { sev: 'P3', family: 'access', title: 'Login failure burst per username' },
  L2: { sev: 'P3', family: 'access', title: '"Invalid Username or Password" masking a dependency outage' },
  L3: { sev: 'P3', family: 'access', title: 'Not-active (1502) spike' },
  L4: { sev: 'P4', family: 'access', title: 'Login without Semati login' },
  L5: { sev: 'P3', family: 'access', title: 'Nafath stuck INITIATED / rejected ratio' },
  L6: { sev: 'P3', family: 'access', title: 'OTP generated, never verified (SMS path)' },
  L7: { sev: 'P4', family: 'access', title: 'Device slot exhaustion / QR geofence failures' },
  L8: { sev: 'P4', family: 'access', title: 'Midnight login storm (logout-all)' },
  L9: { sev: 'P4', family: 'access', title: 'Active channel without owner / attendance left open' }
};

function spec() {
  return { generated: '2026-09-17', source: 'production JARs of 17 Sep 2026 (APP node 172.31.43.136), decompiled', doc: 'DMS-JOURNEYS-CODE.md',
    systems: SYS, families: FAMILIES, journeys: JOURNEYS, rules: RULE_META };
}
module.exports = { spec, JOURNEYS, FAMILIES, RULE_META, SYS };
