/* Salam DMS · MVNO Digital Console — data layer (topology + integrations)
   Generated from static analysis of selfcare-backend release-2.34.1 */

const FLOW_TYPES = {
  api:       {label:"Channel API",      color:"#2563eb"},
  bss:       {label:"BSS / Oracle",     color:"#0d9488"},
  identity:  {label:"Identity / Nafath",color:"#7c3aed"},
  payment:   {label:"Payment rails",    color:"#ea580c"},
  webhook:   {label:"Inbound webhook",  color:"#db2777"},
  delivery:  {label:"Delivery",         color:"#d97706"},
  async:     {label:"Async worker",     color:"#64748b"},
  messaging: {label:"Messaging",        color:"#0891b2"},
  compliance:{label:"ZATCA / compliance",color:"#dc2626"}
};

/* ---- Topology groups & nodes ----
   layout: columns of groups; app.js computes coordinates */
const TOPO_GROUPS = [
  {id:"channels", label:"CHANNELS · FRONT-ENDS", col:0, color:"#2563eb", nodes:[
    {id:"app",     label:"Salam App",        sub:"iOS / Android selfcare"},
    {id:"web",     label:"Web selfcare",     sub:"e-purchase / bills"},
    {id:"sda",     label:"Dealer DMS app",   sub:"seller JWT · indirect orders"},
    {id:"posa",    label:"POSA / QR-POSA",   sub:"till & scanned ICCID"},
    {id:"kiosk",   label:"Sedco kiosk",      sub:"API-key · semati"},
    {id:"partner", label:"Apollo / Tygo",    sub:"partner resellers · API-key"},
    {id:"admin",   label:"ActiveAdmin",      sub:"back-office /admin"}
  ]},
  {id:"core", label:"CORE · SELFCARE-BACKEND (RAILS 6.1)", col:1, color:"#0e9f5a", nodes:[
    {id:"api",     label:"Rails API",        sub:"/api/* · X-Protocol-Version v1–v12", big:true},
    {id:"cbk",     label:"Callbacks",        sub:"/payment /delivery /eChannels/iam"},
    {id:"pg",      label:"PostgreSQL 12",    sub:"88 tables · 4.9M payments"},
    {id:"redis",   label:"Redis",            sub:"cache · IAM tokens · OTP limits"},
    {id:"wrk",     label:"Sidekiq workers",  sub:"43 workers · 22 queues", big:true}
  ]},
  {id:"bss", label:"BSS · GOVERNMENT", col:2, color:"#0d9488", nodes:[
    {id:"Oracle",  label:"Oracle BSS",       sub:"subscription · numbers · activation · billing", big:true},
    {id:"semati",  label:"Semati (CITC)",    sub:"number registry · MNP"},
    {id:"absher",  label:"Absher",           sub:"gov identity OTP"},
    {id:"tcc",     label:"TCC",              sub:"ID↔MSISDN verify · SMS"},
    {id:"sse",     label:"SSE",              sub:"social-security eligibility"},
    {id:"pcalls",  label:"PCalls",           sub:"call registry"}
  ]},
  {id:"identity", label:"IDENTITY", col:2, color:"#7c3aed", nodes:[
    {id:"nafath",  label:"Nafath / IAM",     sub:"digital ID v1 citizens · v2 visitors"}
  ]},
  {id:"payments", label:"PAYMENT RAILS", col:2, color:"#ea580c", nodes:[
    {id:"hyperpay",label:"HyperPay",         sub:"cards · applepay · AES-GCM webhook"},
    {id:"tap",     label:"Tap",              sub:"charges · 3DS · tokens"},
    {id:"tamara",  label:"Tamara",           sub:"BNPL · authorize"},
    {id:"salampay",label:"SalamPay / Merchalink", sub:"invoices · links"},
    {id:"emkan",   label:"EMKAN",            sub:"financing vouchers"},
    {id:"hyperbill",label:"Hyperbill",       sub:"invoice links (sellers/CS)"}
  ]},
  {id:"delivery", label:"DELIVERY VENDORS", col:3, color:"#d97706", nodes:[
    {id:"smsa",    label:"SMSA",             sub:"B2C shipments"},
    {id:"oto",     label:"OTO",              sub:"HMAC-verified callbacks"},
    {id:"barq",    label:"Barq",             sub:"last-mile"},
    {id:"tam",     label:"TAM",              sub:"courier"},
    {id:"imile",   label:"iMile",            sub:"3PL / WMS"},
    {id:"stcc",    label:"STCC",             sub:"courier"},
    {id:"manarat", label:"Manarat",          sub:"courier + availability"}
  ]},
  {id:"commerce", label:"E-COMMERCE", col:3, color:"#2563eb", nodes:[
    {id:"saleor",  label:"Saleor",           sub:"GraphQL device shop"}
  ]},
  {id:"compliance", label:"COMPLIANCE", col:3, color:"#dc2626", nodes:[
    {id:"zatca",   label:"ZATCA (ClearTax)", sub:"e-invoices INV/CRN · TLV QR"}
  ]},
  {id:"messaging", label:"MESSAGING · NOTIFICATIONS", col:3, color:"#0891b2", nodes:[
    {id:"sms",     label:"Unifonic / Msegat",sub:"SMS vendors"},
    {id:"push",    label:"Salam Notification",sub:"push / FCM"},
    {id:"firebase",label:"Firebase RC",      sub:"remote config"},
    {id:"smtp",    label:"SMTP",             sub:"transactional mail"},
    {id:"slack",   label:"Slack",            sub:"ops webhook"}
  ]},
  {id:"ops", label:"TICKETING · ANALYTICS", col:3, color:"#64748b", nodes:[
    {id:"remedy",  label:"BMC Remedy",       sub:"SOAP CreateTicket"},
    {id:"cvm",     label:"CVM",              sub:"retention mnpTrigger"},
    {id:"adjust",  label:"Adjust",           sub:"S2S attribution"},
    {id:"gmaps",   label:"Google Maps",      sub:"geocode delivery"}
  ]}
];

const TOPO_EDGES = [
  // channels → core
  {f:"app", t:"api", type:"api", label:"selfcare + onboarding APIs"},
  {f:"web", t:"api", type:"api", label:"e-purchase / bills / QR"},
  {f:"sda", t:"api", type:"api", label:"seller orders · wallet deduct"},
  {f:"posa", t:"api", type:"api", label:"ICCID orders · complete_qr_posa"},
  {f:"kiosk", t:"api", type:"api", label:"/api/sedco/semati/*"},
  {f:"partner", t:"api", type:"api", label:"/api/apollo/* checkout·activation"},
  {f:"admin", t:"api", type:"api", label:"refunds · SIM uploads · settings"},
  // core internals
  {f:"api", t:"pg", type:"async", label:"ActiveRecord"},
  {f:"api", t:"redis", type:"async", label:"cache · IAM tokens"},
  {f:"api", t:"wrk", type:"async", label:"enqueue jobs"},
  {f:"cbk", t:"wrk", type:"async", label:"Payment::CommitWorker"},
  {f:"wrk", t:"pg", type:"async", label:"state updates"},
  // BSS
  {f:"api", t:"Oracle", type:"bss", label:"eligibility · numbers · profile · bills"},
  {f:"wrk", t:"Oracle", type:"bss", label:"transactions · activation · plan switch · commission"},
  {f:"Oracle", t:"semati", type:"bss", label:"number registration · MNP port"},
  {f:"api", t:"tcc", type:"bss", label:"mobile_verify (ID↔MSISDN)"},
  {f:"wrk", t:"tcc", type:"messaging", label:"SMS by national ID"},
  {f:"api", t:"sse", type:"bss", label:"social-security eligibility"},
  {f:"api", t:"pcalls", type:"bss", label:"call-registry status"},
  {f:"api", t:"absher", type:"identity", label:"Absher OTP (via Oracle)"},
  // identity
  {f:"api", t:"nafath", type:"identity", label:"authorize v1/v2"},
  {f:"nafath", t:"cbk", type:"webhook", label:"/eChannels/iam/callback (JWT)"},
  // payments
  {f:"api", t:"hyperpay", type:"payment", label:"create checkout"},
  {f:"hyperpay", t:"cbk", type:"webhook", label:"/payment/hyperpay/callback"},
  {f:"api", t:"tap", type:"payment", label:"create charge"},
  {f:"tap", t:"cbk", type:"webhook", label:"/payment/tap/callback"},
  {f:"api", t:"tamara", type:"payment", label:"BNPL checkout + authorize"},
  {f:"tamara", t:"cbk", type:"webhook", label:"/payment/tamara/callback"},
  {f:"api", t:"salampay", type:"payment", label:"invoice / status"},
  {f:"salampay", t:"cbk", type:"webhook", label:"/merchalink/callback"},
  {f:"api", t:"emkan", type:"payment", label:"voucher validate · redeem"},
  {f:"wrk", t:"hyperbill", type:"payment", label:"send invoice link"},
  {f:"hyperbill", t:"cbk", type:"webhook", label:"/hyperbill/callback"},
  {f:"wrk", t:"hyperpay", type:"payment", label:"refunds (RefundWorker)"},
  // delivery
  {f:"wrk", t:"smsa", type:"delivery", label:"B2C shipment"},
  {f:"wrk", t:"oto", type:"delivery", label:"createOrder"},
  {f:"wrk", t:"barq", type:"delivery", label:"create order"},
  {f:"wrk", t:"tam", type:"delivery", label:"create_order"},
  {f:"wrk", t:"imile", type:"delivery", label:"outbound order"},
  {f:"wrk", t:"stcc", type:"delivery", label:"shipment/create"},
  {f:"wrk", t:"manarat", type:"delivery", label:"shipment/create"},
  {f:"smsa", t:"cbk", type:"webhook", label:"/delivery/:vendor/callback"},
  {f:"oto", t:"cbk", type:"webhook", label:"HMAC-verified callback"},
  // commerce
  {f:"api", t:"saleor", type:"api", label:"GraphQL cart · stock"},
  {f:"wrk", t:"saleor", type:"async", label:"confirm order · installments"},
  // compliance
  {f:"wrk", t:"zatca", type:"compliance", label:"e-invoice INV/CRN"},
  {f:"api", t:"zatca", type:"compliance", label:"invoice PDF /zatca/:no"},
  // messaging
  {f:"wrk", t:"sms", type:"messaging", label:"OTP · order SMS"},
  {f:"wrk", t:"push", type:"messaging", label:"subscriber register"},
  {f:"wrk", t:"firebase", type:"messaging", label:"settings → remote config"},
  {f:"wrk", t:"smtp", type:"messaging", label:"transactional mail"},
  {f:"wrk", t:"slack", type:"messaging", label:"ops pings"},
  // ops
  {f:"wrk", t:"remedy", type:"async", label:"retention / semati-726 tickets"},
  {f:"wrk", t:"cvm", type:"async", label:"mnpTrigger on termination"},
  {f:"wrk", t:"adjust", type:"async", label:"purchase attribution"},
  {f:"api", t:"gmaps", type:"api", label:"reverse geocode"}
];

/* ---- Integrations catalogue (for view 4) ---- */
const INTEGRATIONS = [
 {name:"Oracle BSS", cat:"BSS / telco", dir:"out", cls:"Oracle::{Subscription,Numbers,Activation,Transaction,Balance,Account,Bills,Esim,Crm,Absher,SelfActivationPortal}", from:"nearly every journey; workers for transactions/activation", note:"The core BSS: eligibility, number inventory, activation (new/MNP/eSIM/data-SIM), balance, bills, CRM, commissions."},
 {name:"Nafath / IAM", cat:"Identity", dir:"both", cls:"IamNew", from:"SematiController (app/apollo/sedco mounts)", note:"Digital-ID auth v1 (citizens/residents) & v2 (visitors); result via /eChannels/iam/callback (JWT — not signature-verified)."},
 {name:"Semati (CITC)", cat:"Identity / BSS", dir:"out", cls:"via Oracle::Activation semati_* + RegisterNumberOnSematiWorker", from:"activation, MNP, plan switch, OT", note:"National number registry: register, transfer (MNP), release."},
 {name:"Absher", cat:"Identity", dir:"out", cls:"Oracle::Absher", from:"activation fallback, visitor visa flows", note:"Government OTP identity verification."},
 {name:"TCC", cat:"Identity / Messaging", dir:"out", cls:"Tcc service + Notifier::SematiSmsWorker (mTLS in prod)", from:"v5 customer_info, OT recipient check, SMS by national ID", note:"Mobile-ownership verification (ID↔MSISDN) and SMS relay."},
 {name:"HyperPay", cat:"Payments", dir:"both", cls:"PaymentManager + Payments::Hyperpay::*", from:"payment#initiate (default vendor)", note:"Cards/ApplePay. Webhook AES-GCM encrypted (verified). Refunds via RefundWorker."},
 {name:"Tap", cat:"Payments", dir:"both", cls:"Payments::Tap::*", from:"payment#initiate", note:"Charges, 3DS, tokenized cards. Webhook weakly verified."},
 {name:"Tamara", cat:"Payments (BNPL)", dir:"both", cls:"Payments::Tamara::*", from:"payment#initiate, Saleor installments", note:"BNPL; pending webhook triggers authorize call."},
 {name:"SalamPay / Merchalink", cat:"Payments", dir:"both", cls:"MerchalinkResponse, PaymentManager", from:"payment#initiate, invoice links", note:"Proprietary rail + payment links; /merchalink/callback."},
 {name:"EMKAN", cat:"Payments (financing)", dir:"out", cls:"Emkan service", from:"Emkan::VouchersController (Saleor installments)", note:"Financing voucher validate → pre_redeem → redeem (OTP)."},
 {name:"Hyperbill", cat:"Payments (invoicing)", dir:"both", cls:"Payment::HyperbillSendInvoiceWorker", from:"seller invoices, bill links", note:"Invoice link engine; /hyperbill/callback marks paid (weak verification)."},
 {name:"SMSA", cat:"Delivery", dir:"both", cls:"Delivery::SmsaWorker", from:"DeliveryManager", note:"B2C shipments + tracking SMS/email; own queue `smsa`."},
 {name:"OTO", cat:"Delivery", dir:"both", cls:"Delivery::OtoWorker + Delivery::Oto::SignatureVerifier", from:"DeliveryManager", note:"Only delivery callback with HMAC verification."},
 {name:"Barq", cat:"Delivery", dir:"both", cls:"Delivery::BarqWorker + concerns/delivery/barq.rb", from:"DeliveryManager", note:"Login + create order; legacy /barq/callback."},
 {name:"TAM", cat:"Delivery", dir:"both", cls:"Delivery::TamWorker + concerns/delivery/tam.rb", from:"DeliveryManager", note:"Courier; static details from credentials."},
 {name:"iMile", cat:"Delivery", dir:"out", cls:"Delivery::ImileWorker", from:"DeliveryManager", note:"3PL/WMS outbound orders."},
 {name:"STCC", cat:"Delivery", dir:"both", cls:"Delivery::StccWorker", from:"DeliveryManager", note:"Courier; legacy /stcc/callback."},
 {name:"Manarat", cat:"Delivery", dir:"both", cls:"Delivery::ManaratWorker", from:"DeliveryManager + availability check", note:"Courier; /manarat/callback."},
 {name:"Saleor", cat:"E-commerce", dir:"out", cls:"Saleor::Middleware (GraphQL), SaleorStockProcessor", from:"checkout#saleor (v1/v9), Delivery::SaleorWorker, InstallmentWorker", note:"Headless device shop: cart, orders, stock, fulfilment."},
 {name:"ZATCA (ClearTax)", cat:"Compliance", dir:"out", cls:"ZatcaManager, ZatcaTransactionWorker(::AfterBssWorker)", from:"every completed payment / QR-POSA / seller deduction; refund credit notes", note:"KSA e-invoicing: INV + CRN, TLV QR, PDF at /zatca/:invoice_number."},
 {name:"Unifonic / Msegat", cat:"Messaging", dir:"out", cls:"Notifier::SmsWorker (vendor switch)", from:"~20 call sites (OTP, orders, transfers)", note:"SMS vendors, mirrored to Slack."},
 {name:"Firebase Remote Config", cat:"Messaging / config", dir:"out", cls:"FirebaseConfigWorker", from:"Setting model saves", note:"Pushes app settings to Firebase RC."},
 {name:"Salam Notification", cat:"Messaging", dir:"out", cls:"SalamNotificationWorker", from:"NotificationToken, auth controllers", note:"Push subscriber registry → FCM (prod only)."},
 {name:"SMTP", cat:"Messaging", dir:"out", cls:"Notifier::*EmailWorker, mailers", from:"OTP/orders/pickup/abandoned/ZATCA mails", note:"Transactional email."},
 {name:"Slack", cat:"Messaging (ops)", dir:"out", cls:"Notifier::SlackWorker, slack-notifier", from:"everywhere (setting-gated)", note:"Ops webhook pings."},
 {name:"BMC Remedy", cat:"Ticketing", dir:"out", cls:"Remedy::NewTicketWorker / SematiTicketWorker (Savon SOAP)", from:"termination surveys, Semati error 726", note:"CreateTicket WSDL; retention & error tickets."},
 {name:"CVM", cat:"Retention", dir:"out", cls:"Notifier::CvmWorker", from:"ProfileManager termination", note:"mnpTrigger retention event."},
 {name:"Adjust", cat:"Analytics", dir:"out", cls:"AdjustManager, Notifier::AdjustWorker", from:"payment success, order events", note:"S2S attribution (campaign data visible in admin OnboardingOrder Adjusts)."},
 {name:"SSE", cat:"Government", dir:"out", cls:"SocialSecurityEligibilityManager", from:"apps#check_social_security_eligibility", note:"Social-security plan eligibility."},
 {name:"PCalls", cat:"BSS / telco", dir:"out", cls:"PCalls client", from:"call-registry checks", note:"Call registry status / allow-block."},
 {name:"Google Maps", cat:"Other", dir:"out", cls:"DistanceCalculator, geocoding", from:"stores locator, delivery geofence", note:"Reverse geocoding + distances."},
 {name:"URL Mapper", cat:"Other (internal)", dir:"out", cls:"UrlMapperWorker", from:"link generation", note:"Internal AWS API-GW short-link mapping."}
];

const WEBHOOKS = [
 {path:"POST /eChannels/iam/callback", caller:"Nafath/IAM", does:"JWT auth result → order/checkout update (+RegisterNumberOnSematiWorker)"},
 {path:"GET /eChannels/iam/callback (+completed/simulator/login)", caller:"Nafath legacy/redirects", does:"OIDC code exchange / landing"},
 {path:"POST|GET /payment/:vendor/callback", caller:"HyperPay·Tap·Tamara·SalamPay", does:"parse_response → Payment status → CommitWorker on success"},
 {path:"POST /hyperpay/callback (legacy)", caller:"HyperPay", does:"AES-GCM decrypt → update payment → commit"},
 {path:"POST /delivery/:vendor/callback", caller:"TAM·Barq·SMSA·OTO·STCC·Manarat", does:"normalize status → DeliveryRequest update → notify (OTO HMAC-verified)"},
 {path:"POST /stcc|/manarat|/barq|/tam /callback (legacy)", caller:"couriers", does:"same via delivery_old"},
 {path:"POST|GET /merchalink/callback", caller:"Merchalink", does:"invoice paid + Slack ping (weak verification)"},
 {path:"POST|GET /hyperbill/callback", caller:"Hyperbill", does:"invoice paid + Slack ping (weak verification)"},
 {path:"GET /zatca/:invoice_number", caller:"customer link", does:"stream ClearTax invoice PDF"}
];

const QUEUES = "payment_commit · zatca_transaction · numbers_commit · reserve_number · unreserve_number · delivery · delivery_request · smsa · change_plan · zatca_customer_notification · installment_worker · default · <host>_raw_sim · email_notifier · otp_email_notifier · sms_notifier · inactivated_order_email_notifier · abandon_order_email_notifier · url_mapper · slack_ping · firebase_config_updater · salam_notification";

const WORKERS = [
 {w:"Payment::CommitWorker", q:"payment_commit", does:"post-payment orchestration: BSS transactions, order completion, delivery creation, checkout completion; fans out to Numbers::CommitWorker, ChangePlanWorker, ZatcaTransactionWorker"},
 {w:"Payment::RefundWorker", q:"payment_commit", does:"gateway refunds + ZATCA credit note"},
 {w:"Payment::Hyperbill/MerchalinkSendInvoiceWorker", q:"payment_commit", does:"invoice create → send → resend"},
 {w:"ZatcaTransactionWorker (+AfterBssWorker)", q:"zatca_transaction", does:"e-invoice INV/CRN via ClearTax (retry: false)"},
 {w:"ChangePlanWorker", q:"change_plan", does:"ChangePlanManager.switch! — BSS plan migration"},
 {w:"Numbers::CommitWorker / ReserveNumberWorker / UnreserveNumberWorker", q:"numbers_commit / reserve_number / unreserve_number", does:"MSISDN reserve, release, extend + BSS contact update"},
 {w:"Delivery::{Tam,Barq,Smsa,Oto,Imile,Stcc,Manarat,Saleor,Posa}Worker", q:"delivery / smsa", does:"create vendor shipments; Saleor order confirm; POSA no-op"},
 {w:"Saleor::InstallmentWorker", q:"installment_worker", does:"confirm Saleor order for installment purchases"},
 {w:"Notifier::SmsWorker / SematiSmsWorker", q:"sms_notifier", does:"SMS via Unifonic/Msegat or TCC (by national ID)"},
 {w:"Notifier::{Email,OtpEmail,OrderEmail,OrderPickupEmail,ZatcaCustomerEmail}Worker", q:"email queues", does:"transactional mail"},
 {w:"Notifier::AbandonedOrderWorker / InactivatedOrderWorker / OwnershipTransferReminderWorker", q:"abandon/inactivated queues", does:"self-rescheduling reminder campaigns"},
 {w:"Notifier::{Slack,Adjust,Cvm}Worker", q:"slack_ping / sms_notifier", does:"ops ping · attribution · retention trigger"},
 {w:"Remedy::NewTicketWorker / SematiTicketWorker", q:"sms_notifier", does:"BMC Remedy SOAP tickets (retention, Semati 726)"},
 {w:"Oracle::CommissionWorker / RegisterNumberOnSematiWorker", q:"default / change_plan", does:"seller commission · Semati registration"},
 {w:"OwnershipTransferPre / OwnershipTransferPost", q:"default", does:"OT old-owner suspension (disabled) / termination + re-reserve"},
 {w:"RawSimWorker", q:"<host>_raw_sim", does:"SIM CSV uploads → RawSims → InventoryManager fan-out to vendor inventories"},
 {w:"FirebaseConfigWorker / SalamNotificationWorker / UrlMapperWorker", q:"own queues", does:"remote config push · push registry · short links"}
];

const CRON = [
 "daily 00:00 — rake custom:onboarding_order_records_to_csv (orders → CSV → MVNO FTP)",
 "daily 00:00 — rake export_data:activation_log_to_csv",
 "daily 00:00 — rake export_eligibility_data:eligibility_log_to_csv"
];
