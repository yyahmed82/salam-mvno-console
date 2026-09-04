# Integrations catalog (auto-generated from the Integrations page — regenerate after editing data.js)

How the platform talks to every external system. Same data the console's Integrations page shows.

## Oracle BSS — BSS / telco
Direction: outbound. Implementation: Oracle::{Subscription,Numbers,Activation,Transaction,Balance,Account,Bills,Esim,Crm,Absher,SelfActivationPortal}. Triggered from: nearly every journey; workers for transactions/activation.
The core BSS: eligibility, number inventory, activation (new/MNP/eSIM/data-SIM), balance, bills, CRM, commissions.

## Nafath / IAM — Identity
Direction: outbound + webhook. Implementation: IamNew. Triggered from: SematiController (app/apollo/sedco mounts).
Digital-ID auth v1 (citizens/residents) & v2 (visitors); result via /eChannels/iam/callback (JWT — not signature-verified).

## Semati (CITC) — Identity / BSS
Direction: outbound. Implementation: via Oracle::Activation semati_* + RegisterNumberOnSematiWorker. Triggered from: activation, MNP, plan switch, OT.
National number registry: register, transfer (MNP), release.

## Absher — Identity
Direction: outbound. Implementation: Oracle::Absher. Triggered from: activation fallback, visitor visa flows.
Government OTP identity verification.

## TCC — Identity / Messaging
Direction: outbound. Implementation: Tcc service + Notifier::SematiSmsWorker (mTLS in prod). Triggered from: v5 customer_info, OT recipient check, SMS by national ID.
Mobile-ownership verification (ID↔MSISDN) and SMS relay.

## HyperPay — Payments
Direction: outbound + webhook. Implementation: PaymentManager + Payments::Hyperpay::*. Triggered from: payment#initiate (default vendor).
Cards/ApplePay. Webhook AES-GCM encrypted (verified). Refunds via RefundWorker.

## Tap — Payments
Direction: outbound + webhook. Implementation: Payments::Tap::*. Triggered from: payment#initiate.
Charges, 3DS, tokenized cards. Webhook weakly verified.

## Tamara — Payments (BNPL)
Direction: outbound + webhook. Implementation: Payments::Tamara::*. Triggered from: payment#initiate, Saleor installments.
BNPL; pending webhook triggers authorize call.

## SalamPay / Merchalink — Payments
Direction: outbound + webhook. Implementation: MerchalinkResponse, PaymentManager. Triggered from: payment#initiate, invoice links.
Proprietary rail + payment links; /merchalink/callback.

## EMKAN — Payments (financing)
Direction: outbound. Implementation: Emkan service. Triggered from: Emkan::VouchersController (Saleor installments).
Financing voucher validate → pre_redeem → redeem (OTP).

## Hyperbill — Payments (invoicing)
Direction: outbound + webhook. Implementation: Payment::HyperbillSendInvoiceWorker. Triggered from: seller invoices, bill links.
Invoice link engine; /hyperbill/callback marks paid (weak verification).

## SMSA — Delivery
Direction: outbound + webhook. Implementation: Delivery::SmsaWorker. Triggered from: DeliveryManager.
B2C shipments + tracking SMS/email; own queue `smsa`.

## OTO — Delivery
Direction: outbound + webhook. Implementation: Delivery::OtoWorker + Delivery::Oto::SignatureVerifier. Triggered from: DeliveryManager.
Only delivery callback with HMAC verification.

## Barq — Delivery
Direction: outbound + webhook. Implementation: Delivery::BarqWorker + concerns/delivery/barq.rb. Triggered from: DeliveryManager.
Login + create order; legacy /barq/callback.

## TAM — Delivery
Direction: outbound + webhook. Implementation: Delivery::TamWorker + concerns/delivery/tam.rb. Triggered from: DeliveryManager.
Courier; static details from credentials.

## iMile — Delivery
Direction: outbound. Implementation: Delivery::ImileWorker. Triggered from: DeliveryManager.
3PL/WMS outbound orders.

## STCC — Delivery
Direction: outbound + webhook. Implementation: Delivery::StccWorker. Triggered from: DeliveryManager.
Courier; legacy /stcc/callback.

## Manarat — Delivery
Direction: outbound + webhook. Implementation: Delivery::ManaratWorker. Triggered from: DeliveryManager + availability check.
Courier; /manarat/callback.

## Saleor — E-commerce
Direction: outbound. Implementation: Saleor::Middleware (GraphQL), SaleorStockProcessor. Triggered from: checkout#saleor (v1/v9), Delivery::SaleorWorker, InstallmentWorker.
Headless device shop: cart, orders, stock, fulfilment.

## ZATCA (ClearTax) — Compliance
Direction: outbound. Implementation: ZatcaManager, ZatcaTransactionWorker(::AfterBssWorker). Triggered from: every completed payment / QR-POSA / seller deduction; refund credit notes.
KSA e-invoicing: INV + CRN, TLV QR, PDF at /zatca/:invoice_number.

## Unifonic / Msegat — Messaging
Direction: outbound. Implementation: Notifier::SmsWorker (vendor switch). Triggered from: ~20 call sites (OTP, orders, transfers).
SMS vendors, mirrored to Slack.

## Firebase Remote Config — Messaging / config
Direction: outbound. Implementation: FirebaseConfigWorker. Triggered from: Setting model saves.
Pushes app settings to Firebase RC.

## Salam Notification — Messaging
Direction: outbound. Implementation: SalamNotificationWorker. Triggered from: NotificationToken, auth controllers.
Push subscriber registry → FCM (prod only).

## SMTP — Messaging
Direction: outbound. Implementation: Notifier::*EmailWorker, mailers. Triggered from: OTP/orders/pickup/abandoned/ZATCA mails.
Transactional email.

## Slack — Messaging (ops)
Direction: outbound. Implementation: Notifier::SlackWorker, slack-notifier. Triggered from: everywhere (setting-gated).
Ops webhook pings.

## BMC Remedy — Ticketing
Direction: outbound. Implementation: Remedy::NewTicketWorker / SematiTicketWorker (Savon SOAP). Triggered from: termination surveys, Semati error 726.
CreateTicket WSDL; retention & error tickets.

## CVM — Retention
Direction: outbound. Implementation: Notifier::CvmWorker. Triggered from: ProfileManager termination.
mnpTrigger retention event.

## Adjust — Analytics
Direction: outbound. Implementation: AdjustManager, Notifier::AdjustWorker. Triggered from: payment success, order events.
S2S attribution (campaign data visible in admin OnboardingOrder Adjusts).

## SSE — Government
Direction: outbound. Implementation: SocialSecurityEligibilityManager. Triggered from: apps#check_social_security_eligibility.
Social-security plan eligibility.

## PCalls — BSS / telco
Direction: outbound. Implementation: PCalls client. Triggered from: call-registry checks.
Call registry status / allow-block.

## Google Maps — Other
Direction: outbound. Implementation: DistanceCalculator, geocoding. Triggered from: stores locator, delivery geofence.
Reverse geocoding + distances.

## URL Mapper — Other (internal)
Direction: outbound. Implementation: UrlMapperWorker. Triggered from: link generation.
Internal AWS API-GW short-link mapping.

