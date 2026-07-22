# Salam MVNO selfcare-backend — External Integrations Catalogue

Source: `/Users/yosriyahmed/Documents/Claude/Projects/Salam DMS/selfcare-backend` (Rails 6.1, Ruby 2.7.2, Sidekiq, HTTParty + Savon).
Conventions: all outbound REST uses HTTParty; SOAP uses Savon; credentials come from `Rails.application.credentials[Rails.env]`; tokens are cached in Redis via `Rails.cache`.

---

# 1. External integrations

## Hyperpay (payments)
- Purpose: Primary card payment gateway (VISA/Mastercard/AMEX/Mada) — checkout, status query, refund (RF) and reversal (RV).
- Implementing class(es): `Payments::Hyperpay::Client` — `app/services/payments/hyperpay/client.rb`, `Payments::Hyperpay::Response` — `app/services/payments/hyperpay/response.rb`, notification decryptor `HyperpayNotification`.
- Direction: both (outbound API + inbound encrypted webhook).
- Called from: `PaymentManager` (`app/lib/payment_manager.rb`) via `Api::V1::PaymentController#initiate/#status/#check`; refunds from `Payment::RefundWorker`; callbacks in `CallbacksController#hyperpay` / `#payment`.
- Sync/async: checkout/status sync (inline in request); refunds async (Sidekiq `payment_commit`); webhook async by nature.
- Key methods/endpoints: `checkout` → POST `/checkouts`; `status` → GET `/checkouts/{id}/payment`; `update_status` → GET `/query`; `refund` → POST `/payments/{remote_payment_id}` (RF); `reverse` → same (RV). Bearer token auth; entity IDs per card type (visa_master/amex); notification URL `{sc_base_url}/payment/hyperpay/callback`; webhooks AES-GCM encrypted (X-Initialization-Vector / X-Authentication-Tag headers).

## Tap Payments (payments)
- Purpose: Alternate card gateway with 3-D Secure; also backs the "Salam Pay" invoice channel.
- Implementing class(es): `Payments::Tap::Client` — `app/services/payments/tap/client.rb`, `.../response.rb`.
- Direction: both.
- Called from: `PaymentManager` (vendor selection via `PaymentVendor.select_vendor`); callback `CallbacksController#payment` (`/payment/tap/callback`).
- Sync/async: checkout/status sync; refund via `Payment::RefundWorker` (async).
- Key methods/endpoints: `checkout` → POST `/charges`; `status`/`update_status` → GET `/charges/{id}`; `refund` → POST `/refunds`; `refund_status` → POST `/refunds/list`; `credit_card` → GET `/tokens/{token}`. Bearer secret-key auth.

## Tamara (payments — BNPL)
- Purpose: Buy-now-pay-later installments (pre-eligibility check, checkout, authorize, refund).
- Implementing class(es): `Payments::Tamara::Client` — `app/services/payments/tamara/client.rb`, `.../response.rb`.
- Direction: both.
- Called from: `PaymentManager`; e-commerce checkout flow (Saleor checkouts); callback `CallbacksController#payment` (`/payment/tamara/callback`) which triggers `authorize` on pending status.
- Sync/async: sync outbound; webhook inbound.
- Key methods/endpoints: `payment_options` → POST `/checkout/payment-options-pre-check`; `checkout` → POST `/checkout`; `status` → GET `/merchants/orders/reference-id/{ref}`; `authorize` → POST `/orders/{ref}/authorise`; `refund` → POST `/payments/simplified-refund/{order_id}`. Bearer token.

## Salam Pay (payments)
- Purpose: Salam-branded invoice/payment channel (invoice create + pay URL), x-api-key authenticated.
- Implementing class(es): `Payments::Salam::Client` — `app/services/payments/salam/client.rb`, `.../response.rb`.
- Direction: both.
- Called from: `PaymentManager`; callback `CallbacksController#payment` (`/payment/salam/callback`).
- Sync/async: sync outbound; webhook inbound.
- Key methods/endpoints: `checkout` → POST `/invoices`; `status`/`update_status` → GET `/invoices/{id}`; `refund` → POST `/payments/{remote_payment_id}/refund`. Header `x-api-key`.

## Apollo (payments — stub / partner channel)
- Purpose: No-op payment client for partner (Tygo/Apollo) orders whose payment happened on the partner side; reads status from `payment.extra`. Apollo/Sedco partner APIs are exposed under `/api/apollo/*`, `/api/tygo/*`, `/api/sedco/*` (inbound partner API, not webhook).
- Implementing class(es): `Payments::Apollo::Client` — `app/services/payments/apollo/client.rb`, `.../response.rb`; controllers `app/controllers/api/v1/apollo/*` (plans, numbers, eligibility, semati, checkout, activation, tcc).
- Direction: inbound partner API (outbound calls are no-ops).
- Called from: `PaymentManager#create_for_apollo/#create_for_tygo`.
- Sync/async: sync.
- Key methods/endpoints: `checkout` (no-op), `update_status` (reads local data), `refund` (local).

## Emkan (payments — financing vouchers)
- Purpose: Emkan Finance voucher redemption for device/plan financing (OTP-verified redeem + refund).
- Implementing class(es): `Emkan::Client` — `app/services/emkan/client.rb` (module `app/services/emkan.rb`).
- Direction: outbound only.
- Called from: `Api::V1::Emkan::VouchersController` (`/api/emkan/vouchers/validate_voucher|pre_redeem|redeem`).
- Sync/async: sync.
- Key methods/endpoints: POST `/vouchers/getVoucherDetails`, `/vouchers/preRedeem`, `/vouchers/redeem` (OTP), `/vouchers/preRefund`, `/vouchers/refund`. Basic auth + headers `LNG`, `CHN: MERCHANT`, `MERCHANT_CODE`.

## Hyperbill (other — invoicing/billing)
- Purpose: Hosted "simple invoice" creation/sending for onboarding orders (pay-by-link invoicing).
- Implementing class(es): `Hyperbill::Client` (`HyperbillClient`) — `app/services/hyperbill/client.rb`.
- Direction: both.
- Called from: `Payment::HyperbillSendInvoiceWorker` (queue `payment_commit`), `Api::V1::InvoicesController#send_invoice`; callback `CallbacksController#hyperbill` (`/hyperbill/callback`).
- Sync/async: async (worker) for send flow; webhook inbound marks invoice paid.
- Key methods/endpoints: POST `/login` (token, cached); POST `/simpleInvoice`; GET `/simpleInvoice/send/{no}`, `/simpleInvoice/resend/{no}`, `/simpleInvoice/retrieve/{no}`; DELETE `/simpleInvoice/{no}`.

## Merchalink (other — invoicing/billing)
- Purpose: Alternative simple-invoice provider, identical API shape to Hyperbill.
- Implementing class(es): `Merchalink::Client` (`MerchalinkClient`) — `app/services/merchalink/client.rb`, `.../response.rb`, `.../error.rb`.
- Direction: both.
- Called from: `Payment::MerchalinkSendInvoiceWorker`; callback `CallbacksController#merchalink` (`/merchalink/callback`).
- Sync/async: async (worker) + inbound webhook.
- Key methods/endpoints: same as Hyperbill (`/login`, `/simpleInvoice` CRUD/send/resend/retrieve). JWT bearer, token cached.

## TAM (delivery)
- Purpose: Courier for SIM home delivery — order creation.
- Implementing class(es): `Delivery::Tam::Client` — `app/services/delivery/tam/client.rb`; worker `Delivery::TamWorker` — `app/workers/delivery/tam_worker.rb`.
- Direction: both.
- Called from: `DeliveryManager` (`app/lib/delivery_manager.rb`) → `Delivery::TamWorker.perform_async`; callbacks `POST /delivery/tam/callback` (generic) and legacy `POST /tam/callback` → `CallbacksController#tam`.
- Sync/async: async (Sidekiq queue `delivery`).
- Key methods/endpoints: `create` → POST `{base_url}/create_order/` (Basic auth base64 user:pass).

## Barq (delivery)
- Purpose: On-demand courier — merchant order creation; also SIM inventory sync via `InventoryManager`.
- Implementing class(es): `Delivery::Barq::Client` — `app/services/delivery/barq/client.rb`; worker `Delivery::BarqWorker` — `app/workers/delivery/barq_worker.rb`.
- Direction: both.
- Called from: `DeliveryManager` → `Delivery::BarqWorker`; callbacks `POST /delivery/barq/callback` and legacy `POST /barq/callback`.
- Sync/async: async (queue `delivery`).
- Key methods/endpoints: `generate_token` → POST `/merchants/login` (token cached 24h in Redis); `create` → POST `/merchants/orders` (Bearer).

## SMSA Express (delivery)
- Purpose: National courier — B2C shipment creation + pickup-office lookup; sends tracking SMS/email after creation.
- Implementing class(es): `Delivery::Smsa::Client` — `app/services/delivery/smsa/client.rb`, `.../consignee.rb`; worker `Delivery::SmsaWorker` — `app/workers/delivery/smsa_worker.rb`; module stub `app/services/smsa.rb`.
- Direction: both.
- Called from: `DeliveryManager` → `Delivery::SmsaWorker`; store lookup from lookup/stores controllers; callback `POST /delivery/smsa/callback`.
- Sync/async: async (dedicated queue `smsa`); office lookup sync (cached 1h).
- Key methods/endpoints: `stores` → GET `/lookup/smsaoffices`; `create_b2c`/`create` → POST `/shipment/b2c/new`. Custom credential headers.

## iMile (delivery — 3PL/WMS)
- Purpose: Warehouse fulfilment — outbound order creation from iMile-managed stock.
- Implementing class(es): `Delivery::Imile::Client` — `app/services/delivery/imile/client.rb`; worker `Delivery::ImileWorker` — `app/workers/delivery/imile_worker.rb`.
- Direction: outbound only (no callback route observed).
- Called from: `DeliveryManager` → `Delivery::ImileWorker`; inventory via `InventoryManager`.
- Sync/async: async (queue `delivery`).
- Key methods/endpoints: `token` → POST `/auth/accessToken/grant` (cached 1h); `create` → POST `/client/wmsOrder/createOutboundOrder` (signed: customerId + key, signMethod SimpleKey).

## OTO (delivery)
- Purpose: Delivery orchestration platform — order creation + tracking; webhooks are HMAC-signature verified.
- Implementing class(es): `Delivery::Oto::Client` — `app/services/delivery/oto/client.rb`; `Delivery::Oto::SignatureVerifier`; worker `Delivery::OtoWorker` — `app/workers/delivery/oto_worker.rb`.
- Direction: both.
- Called from: `DeliveryManager` → `Delivery::OtoWorker`; callback `POST /delivery/oto/callback` (batched `_json` array or single payload; `CallbacksController#verify_oto_signature!`).
- Sync/async: async (queue `delivery`).
- Key methods/endpoints: `refresh_token!` → POST `/refreshToken`; `create` → POST `/createOrder`; `track` → POST `/orderStatus`. Access token cached with dynamic TTL.

## STCC (delivery)
- Purpose: Courier for SIM delivery (shipment creation); also geofence-based coverage (`stcc_geofence_import.rake`).
- Implementing class(es): `Delivery::Stcc::Client` — `app/services/delivery/stcc/client.rb`, `.../inventory.rb`; worker `Delivery::StccWorker` — `app/workers/delivery/stcc_worker.rb`; module `app/services/stcc.rb`.
- Direction: both.
- Called from: `DeliveryManager` and `DeliveryRequest` model → `Delivery::StccWorker.perform_async`; callbacks `POST /delivery/stcc/callback` and legacy `POST /stcc/callback`.
- Sync/async: async (queue `delivery`).
- Key methods/endpoints: `create` → POST `/shipment/create` (credential headers + configured sender block).

## Manarat (delivery)
- Purpose: Courier with live availability checking (open/closed) and geofenced coverage.
- Implementing class(es): `Delivery::Manarat::Client` — `app/services/delivery/manarat/client.rb`, `.../inventory.rb`; worker `Delivery::ManaratWorker` — `app/workers/delivery/manarat_worker.rb`.
- Direction: both.
- Called from: `DeliveryManager` → worker; availability from delivery-hours/geofence lookups; callbacks `POST /delivery/manarat/callback` and legacy `POST /manarat/callback`.
- Sync/async: async (queue `delivery`); availability check sync.
- Key methods/endpoints: `create` → POST `/shipment/create`; `availability` → GET `/shipment/is_available`.

## Saleor (other — headless e-commerce, via Salam middleware)
- Purpose: Device/accessory e-commerce backend. The app talks to a Saleor middleware service (`saleor_mw_url`) for banners, checkout state, stock, order confirmation, invoices, metadata.
- Implementing class(es): `Saleor::Middleware` — `app/services/saleor/middleware.rb`; delivery worker `Delivery::SaleorWorker` — `app/workers/delivery/saleor_worker.rb`; installments `Saleor::InstallmentWorker` — `app/workers/saleor/installment_worker.rb`; helpers `app/lib/saleor_report.rb`, `app/lib/saleor_stock_processor.rb`.
- Direction: outbound (REST to middleware).
- Called from: `Api::V1/V9::CheckoutController`, `Api::V1::SaleorController`, `Api::V1::LookupController` (banners), `Api::V1::PaymentController`, `Payment::CommitWorker` (payment-fail state sync), `Delivery::SaleorWorker` (order confirm on delivery), `Saleor::InstallmentWorker`.
- Sync/async: mixed — checkout/stock/banner calls sync; order confirmation/installment async via Sidekiq.
- Key methods/endpoints: `banners`, `extend_checkout_reservation`, `checkout(checkout_id)`, `update_payment_state`, `confirm_order`, `update_order_address`, `update_order_meta`, `order`, `send_invoice`, `stock(warehouse_id)`, `update_stock` — all on `BASE_CONFIG[:saleor_mw_url]`.

## Optiva BSS (BSS/telco)
- Purpose: Core Salam Mobile BSS (Optiva) — accounts, activation, subscriptions, balance, bills, numbers/MSISDN inventory, eSIM, MNP porting, CRM, transactions/recharge, seller commission. THE central telco backend.
- Implementing class(es): `Optiva::Client` — `app/services/optiva/client.rb` plus domain classes: `account.rb`, `activation.rb`, `balance.rb`, `bills.rb`, `crm.rb`, `esim.rb`, `mnp.rb`, `numbers.rb`, `provision.rb`, `self_activation_portal.rb`, `subscription.rb`, `transaction.rb`, `priceplan_service.rb` (all `app/services/optiva/`); request DTOs in `app/lib/external_requests/*.rb` (NewMobileNumber, NewSimNumber, Eligibility, ChangeSubscription, CancelMobileNumber/SimNumber, IndividualSubscriber, EnhancedNumber, PricePlanOption, ActivationLog, EligibilityLog...).
- Direction: outbound only.
- Called from: virtually every controller (activation, onboarding, numbers, eligibility, datasims, profiles, users, renewal, recharge, bills, MNP, sim_replacement, change_plan, services) and workers (`Payment::CommitWorker`, `ReserveNumberWorker`, `UnreserveNumberWorker`, `Numbers::CommitWorker`, `ChangePlanWorker` via `ChangePlanManager`, `Optiva::CommissionWorker`, `OwnershipTransferPost` via `ProfileManager`/`NumberManager`).
- Sync/async: both — reads/eligibility inline; financial commits, number reservation and plan changes via Sidekiq.
- Key methods/endpoints: gateway base `https://APIGW.SALAMMOBILE.SA:8081/api/uil` (prod) with `x-api-key` header (separate seller key); JSON POST/GET per operation with generated `transactionId`; PDF bill endpoint (base64); notable ops: reserve/unreserve number, create/extend reservation, activation (new number / MNP / data SIM), `create_subscription_transaction` (recharge), `account_transaction` (bill/postpaid payment), `renewal_transaction`, subscription state transitions, commission (SelfActivationPortal), eSIM QR.

## Nafath / IAM (identity)
- Purpose: Saudi national digital-ID authentication (Nafath via IAM/Semati broker). OAuth-style authorize + callback with JWT; v2 supports visitors (passport nationality) for Hajj flows.
- Implementing class(es): `Iam` — `app/services/iam.rb` (legacy OIDC `/authorize`, `/token`); `IamNew` — `app/services/iam_new.rb` (POST `/v1/client/authorize/`, `/v2/client/authorize/`, header `Authorization: apikey ...`, optional `X-USER-IP`); `SematiConfig` — `app/services/semati_config.rb`; token verification `app/controllers/concerns/verify_iam_token.rb`.
- Direction: both (outbound authorize request; inbound browser/system callback `GET/POST /eChannels/iam/callback`).
- Called from: `Api::V1::SematiController` (`/api/semati/authorize|check`), onboarding + change-plan + ownership-transfer flows (services: IssueNewMobileIndividual, IssueNewSimIndividual, ChangePlanTypeIndividual, TransferMobileOwnershipWithinNetwork/BetweenNetworks); callbacks in `CallbacksController#iam`, `#iam_new`, `#iam_completed`, `#iam_login`.
- Sync/async: sync authorize; async user completion via callback; post-callback `Optiva::RegisterNumberOnSematiWorker` registers the number on Semati.
- Key methods/endpoints: as above. Note: callback JWT is decoded without signature verification (security finding).

## Semati / Absher (identity — via Optiva)
- Purpose: SIM-registration compliance (Semati = CITC SIM registry) and Absher OTP verification, both proxied through Optiva endpoints.
- Implementing class(es): `Semati` — `app/services/semati.rb` (`register_semati_number`); `Optiva::Absher` — `app/services/optiva/absher.rb` (+ `absher_response.rb`, `absher_error.rb`); Semati response handling `app/services/optiva/semati_response.rb`, `semati_error.rb`, `responses/semati_person.rb`.
- Direction: outbound.
- Called from: `Optiva::Activation` (semati_new_number, semati_reauth_mobile_number), `Optiva::RegisterNumberOnSematiWorker`, activation controllers (`can_verify_absher`), MNP controller. Semati error 726 triggers `Remedy::SematiTicketWorker`.
- Sync/async: mostly sync; number registration async (queue `change_plan`).
- Key methods/endpoints: Optiva `/semati/*` operations; Absher OTP verify.

## TCC (identity/compliance + messaging)
- Purpose: CITC/TCC gateway — verifies mobile-vs-national-ID ownership and sends regulatory SMS to a person by national ID.
- Implementing class(es): `Tcc::Client` / `Tcc::ClientCert` (client-cert variant, used in prod) — `app/services/tcc/client.rb`, `client_cert.rb`, `response.rb`, `error.rb`.
- Direction: outbound.
- Called from: `Notifier::SematiSmsWorker` (send_sms), `Api::V1::Apollo::TccController` (`/api/apollo/tcc/sms/send`), OTP model (Semati OTPs), MNP + services controllers; `mobile_verify` in verification flows.
- Sync/async: SMS async (queue `sms_notifier`); verify sync.
- Key methods/endpoints: POST `mobile_verify` (nationality_number_id + mobile), POST `send_sms` (nationality_number_id + message); `person_id_type` helper. API key + (prod) mTLS cert.

## SSE — Social Security Eligibility (BSS/telco / government)
- Purpose: Checks customer's social-security status (subsidised plan eligibility) by national ID.
- Implementing class(es): `Sse::Client` / `Sse::ClientCert` — `app/services/sse/client.rb`, `client_cert.rb`, `response.rb`, `error.rb`; manager `app/lib/social_security_eligibility_manager.rb`.
- Direction: outbound.
- Called from: `Api::V1::UsersController`, `Api::V1::Onboarding::EligibilityController`, `Profile` model, apps orders `check_social_security_eligibility`.
- Sync/async: sync.
- Key methods/endpoints: POST `/check` body `{customerId: <national_id>}`, header `x-api-key`.

## PCalls (BSS/telco — call registry)
- Purpose: Manage promotional-calls privacy registry (allow/block marketing calls) per MSISDN.
- Implementing class(es): `Pcalls::Client` — `app/services/pcalls/client.rb`, `.../response.rb`, `.../error.rb`.
- Direction: outbound.
- Called from: profile/spam settings (`Api::V1::UsersController` spam endpoints).
- Sync/async: sync.
- Key methods/endpoints: GET `/call-registry-external?phoneNumber=`; POST same path `{phoneNumber, allow}`. Basic auth.

## Unifonic (messaging — SMS)
- Purpose: Primary SMS gateway for OTPs and transactional SMS.
- Implementing class(es): `Sms::Unifonic` — `app/services/sms/unifonic.rb` (base `app/services/sms/base.rb`); vendor selection `SmsVendor.current_vendor` (DB-configurable).
- Direction: outbound.
- Called from: `Notifier::SmsWorker` (the single funnel — enqueued from Otp, OtpVerification, User/Guest/AnonymousUser/Seller models, controllers, delivery workers, `OwnershipTransferPost`, `Zatca::Notified`, etc.).
- Sync/async: async (queue `sms_notifier`).
- Key methods/endpoints: POST `{base_url}` with `{Recipient, Body}`.

## Msegat (messaging — SMS)
- Purpose: Secondary/alternative SMS gateway (runtime-selectable vendor).
- Implementing class(es): `Sms::Msegat` — `app/services/sms/msegat.rb`.
- Direction: outbound.
- Called from: `Notifier::SmsWorker` via `SmsVendor.current_vendor`.
- Sync/async: async (queue `sms_notifier`).
- Key methods/endpoints: POST `{base_url}` with `{numbers, msg}`.

## Firebase Remote Config (messaging/config)
- Purpose: Pushes app feature-flag/config changes (from admin `Setting` model) to Firebase Remote Config for the mobile apps.
- Implementing class(es): `Firebase::Client` — `app/services/firebase/client.rb` (+ request/response/error).
- Direction: outbound.
- Called from: `Setting` model → `FirebaseConfigWorker.perform_async`.
- Sync/async: async (queue `firebase_config_updater`, retry: false).
- Key methods/endpoints: OAuth2 JWT-bearer to `https://oauth2.googleapis.com/token` (scope firebase.remoteconfig); GET/PUT `/remoteConfig` with ETag If-Match.

## Salam Notification Service (messaging — push)
- Purpose: Internal push-notification backend (FCM fan-out) — registers/updates device subscribers.
- Implementing class(es): `SalamNotification::Client` — `app/services/salam_notification/client.rb` (module `app/services/salam_notification.rb`); worker `SalamNotificationWorker` — `app/workers/salam_notification_worker.rb`.
- Direction: outbound (internal host `http://172.31.38.183:40387/notify`).
- Called from: `NotificationToken` model (`/api/notifications/token`), user/guest authentication controllers.
- Sync/async: async (queue `salam_notification`, retry: 5, prod only).
- Key methods/endpoints: POST `/subscribers` (device, FCM token, OS, app version), PUT `/subscribers/{device_id}` (falls back to create on BAD_REQUEST).

## Slack (messaging — ops)
- Purpose: Ops notifications (SMS mirror, integration errors, callbacks) to a Slack incoming webhook. Only fires on staging when `Setting.enable_slack_notification`.
- Implementing class(es): `SlackBot` constant — `config/initializers/slack_notifier.rb` (gem `slack-notifier`); worker `Notifier::SlackWorker` — `app/workers/notifier/slack_worker.rb`.
- Direction: outbound.
- Called from: ~30 sites — `CallbacksController`, invoice workers, refund worker, Remedy/CVM workers, `Optiva::Activation`, rake tasks.
- Sync/async: async (queue `slack_ping`).
- Key methods/endpoints: Slack incoming-webhook `ping`.

## Email / SMTP (messaging)
- Purpose: Transactional email — OTP codes, order confirmations, pickup instructions, shipment tracking, abandoned/inactive-order reminders, ZATCA invoice emails, SIM-upload failure alerts.
- Implementing class(es): ActionMailer mailers (`AbandonPurchaseMailer`, `InactiveSimMailer`, `SimUploadMailer`, order mailers) driven by workers `Notifier::EmailWorker`, `OtpEmailWorker`, `OrderEmailWorker`, `OrderPickupEmailWorker`, `ZatcaCustomerEmailWorker` — `app/workers/notifier/*.rb`.
- Direction: outbound.
- Called from: OTP flows, `Payment::CommitWorker` (pickup email), `Delivery::SmsaWorker` (tracking email), reminder workers, `Zatca::Notified`.
- Sync/async: async (queues `email_notifier`, `otp_email_notifier`, `zatca_customer_notification`, etc.).
- Key methods/endpoints: SMTP delivery.

## ZATCA e-invoicing via ClearTax (compliance)
- Purpose: Mandatory Saudi e-invoicing — generates/reports tax invoices (INV) and credit notes (CRN) for payments, seller deductions and QR-POSA completions; customer invoice notification + PDF retrieval.
- Implementing class(es): `Zatca::Client` — `app/services/zatca/client.rb` (+ `request.rb`, `response.rb`, `validator.rb`, `pdf_generator.rb`, `notified.rb`, `error.rb`); orchestrator `ZatcaManager` — `app/lib/zatca_manager.rb`; workers `ZatcaTransactionWorker` (+ nested `AfterBssWorker`) — `app/workers/zatca_transaction_worker.rb`, `Notifier::ZatcaCustomerEmailWorker`.
- Direction: outbound (plus public inbound PDF download `GET /zatca/:invoice_number`).
- Called from: `Payment::CommitWorker` (after BSS commit), `Payment` model (AfterBssWorker), `SelfActivationManager` (seller deductions), `QrPosaOrderCompleter`, `ZatcaManager` (CRN on refunds via `DeliveryManager`).
- Sync/async: async (queue `zatca_transaction`, retry: false — ClearTax handles retry to ZATCA).
- Key methods/endpoints: POST `/einvoices/generate/async` (headers `x-cleartax-auth-token`, `vat: 300047243810003`); `generate_pdf!`; status stored in `extra_zatca` (PENDING/GENERATED/REPORTED). Gated by `Setting.enable_zatca_transactions?` / `enable_zatca_notifications?`.

## BMC Remedy (ticketing)
- Purpose: Creates CRM/ITSM tickets in Salam's BMC Remedy via SOAP `CreateTicket` WSDL — customer-retention tickets on termination and Semati-error (726) activation tickets.
- Implementing class(es): `Remedy::Client` — `app/services/remedy/client.rb` (Savon; WSDLs `CreateTicket_production.wsdl.xml` / `CreateTicket_1.wsdl.xml` at repo root); workers `Remedy::NewTicketWorker`, `Remedy::SematiTicketWorker` — `app/workers/remedy/`.
- Direction: outbound (SOAP).
- Called from: `Api::V1::SurveysController` (termination survey → NewTicketWorker), `Api::V12::ActivationController` (Semati error → SematiTicketWorker), `Api::V1::Remedy::OtpController` (`/api/remedy/otp/*`).
- Sync/async: async (queue `sms_notifier`, retry 3 / default).
- Key methods/endpoints: SOAP op `:create` with `AuthenticationInfo` header (user SMWIUser); assigned group `MVNO-CC-Back Office` (SGP000000003212).

## CVM (other — customer value management)
- Purpose: Notifies the CVM/retention system when a customer initiates termination (MNP trigger) so a retention call can be made.
- Implementing class(es): `Cvm::Client` — `app/services/cvm/client.rb` (+ response/error).
- Direction: outbound.
- Called from: `ProfileManager` (terminate flow) → `Notifier::CvmWorker`.
- Sync/async: async (queue `sms_notifier`, retry 3).
- Key methods/endpoints: POST `/mnpTrigger` `{MSISDN, RequestTimestamp, OrderId}` (verify: false). Request/response logged to `TerminationLog.cvm`.

## Adjust (analytics)
- Purpose: Server-to-server mobile attribution events (purchases, activations) to Adjust per sub-platform (iOS/Android/Huawei).
- Implementing class(es): `Adjust::Client` — `app/services/adjust/client.rb` (+ response/error); `AdjustManager` — `app/lib/adjust_manager.rb`; worker `Notifier::AdjustWorker`.
- Direction: outbound.
- Called from: onboarding orders `POST /api/onboarding/orders/:id/adjust` → `AdjustManager` → `Notifier::AdjustWorker`.
- Sync/async: async (queue `sms_notifier`).
- Key methods/endpoints: POST `/event` with app_token/event_token/revenue/currency + device ids (gps_adid, idfa/idfv), Bearer security token.

## Google Maps (other — geocoding)
- Purpose: Reverse-geocoding of delivery coordinates to addresses.
- Implementing class(es): `GoogleMaps::ReverseGeocodeService` — `app/services/google_maps/reverse_geocode_service.rb`.
- Direction: outbound.
- Called from: delivery-info / geofence flows.
- Sync/async: sync.
- Key methods/endpoints: Google Geocoding API (latlng reverse lookup, API key).

## URL Mapper (other — internal AWS service)
- Purpose: Sends URL-shortener/mapping payloads to an internal AWS API Gateway (LocalStack-style endpoint).
- Implementing class(es): `UrlMapperWorker` — `app/workers/url_mapper_worker.rb`.
- Direction: outbound.
- Called from: link-generation flows (perform_async with payload).
- Sync/async: async (queue `url_mapper`, retry: false, fails silently).
- Key methods/endpoints: POST `http://172.31.48.7:4566/restapis/51au7scjmw/local/_user_request_/url-mapper`.

## Lokalise (other — dev tooling)
- Purpose: Translation management — pulls/pushes `config/locales` YAML (ar/en) via `lokalise_rails`.
- Implementing class(es): `config/lokalise_rails.rb` (gem config; API token + project id in credentials).
- Direction: outbound (build/dev-time, not runtime user flows).
- Sync/async: rake-task driven.

## MVNO FTP / SCP export (other — reporting)
- Purpose: Ships CSV reports (Saleor order logs, stocks, folder exports) to Salam's FTP server via `sshpass scp` to `/mvnoftp/StartApps/...`.
- Implementing class(es): rake tasks `lib/tasks/saleor_records_to_csv.rake`, `saleor_records_to_csv2.rake`, `saleor_stocks_to_csv.rake`, `ftp_folders_exporter.rake` (+ CSV generators `onboarding_order_records_to_csv.rake`, `activation_log_records_to_csv.rake`, `eligibility_log_records_to_csv.rake` which write local CSVs consumed by the exporter).
- Direction: outbound (SCP).
- Called from: cron (`config/schedule.rb`) + manual rake.
- Sync/async: scheduled batch.

## Inventory Manager (internal fan-out)
- Purpose: Abstraction that pushes uploaded SIM ICCID batches into the right vendor inventory (Barq, iMile, OTO, TAM, SMSA, Saleor, Manarat, STCC) — 1000-record chunks.
- Implementing class(es): `InventoryManager` — `app/services/inventory_manager.rb`; fed by `RawSimWorker` (ActiveAdmin SIM uploads).
- Direction: outbound (delegates to vendor clients above).
- Sync/async: async (host-specific `*_raw_sim` queue).

---

# 2. Incoming webhooks/callbacks

All handled by `app/controllers/callbacks_controller.rb` unless noted. All process synchronously and return 200.

| # | Verb + Path | Controller#action | External caller | What it does |
|---|-------------|-------------------|-----------------|--------------|
| 1 | GET `/eChannels/iam/callback` | `callbacks#iam` | Nafath/IAM (Semati broker, legacy OIDC) | Exchanges code for token, verifies user identity, resumes onboarding |
| 2 | POST `/eChannels/iam/callback` | `callbacks#iam_new` | Nafath/IAM v1/v2 | Receives JWT result of digital-ID auth (JWT decoded WITHOUT signature verification), updates order/checkout state, enqueues `Optiva::RegisterNumberOnSematiWorker` |
| 3 | GET `/eChannels/iam/callback_completed` | `callbacks#iam_completed` | Nafath browser redirect | Completion landing after auth |
| 4 | GET `/eChannels/iam/simulator` | `callbacks#iam_simulator` | dev-only simulator | Simulates IAM callback in non-prod |
| 5 | GET `/semati/login` | `callbacks#iam_login` | Semati/IAM redirect | Login-flow entry redirect |
| 6 | POST/GET `/payment/:vendor/callback` (hyperpay, tap, tamara, salam) | `callbacks#payment` | Payment gateways | `PaymentManager.new(vendor:).parse_response` → updates `Payment` status; on success enqueues `Payment::CommitWorker`; Tamara pending → `authorize` call |
| 7 | POST `/hyperpay/callback` (legacy) | `callbacks#hyperpay` | Hyperpay | Decrypts AES-GCM notification (IV + auth-tag headers), updates payment, commits |
| 8 | POST `/delivery/:vendor/callback` (tam, barq, smsa, oto, stcc, manarat) | `callbacks#delivery` | Couriers | Parses status payload (OTO: batched array + HMAC `Delivery::Oto::SignatureVerifier.verify!`), `DeliveryManager.process_callback` → updates `DeliveryRequest` state, notifies customer |
| 9 | POST `/stcc/callback` (legacy) | `callbacks#stcc` | STCC | `delivery_old('stcc')` → `DeliveryManager.process_callback` |
| 10 | POST `/manarat/callback` (legacy) | `callbacks#manarat` | Manarat | same pattern |
| 11 | POST `/barq/callback` (legacy) | `callbacks#barq` | Barq | same pattern |
| 12 | POST `/tam/callback` (legacy) | `callbacks#tam` | TAM | same pattern |
| 13 | POST/GET `/merchalink/callback` | `callbacks#merchalink` | Merchalink | Marks `Invoice` paid, Slack-pings; weak/no signature verification (TODO in code) |
| 14 | POST/GET `/hyperbill/callback` | `callbacks#hyperbill` | Hyperbill | Marks `Invoice` paid, Slack-pings; weak/no signature verification |
| 15 | GET `/zatca/:invoice_number` | `zatca#generate` (`app/controllers/zatca_controller.rb`) | Customer/invoice link (public) | Finds payment by ZATCA invoice number, calls ClearTax `generate_pdf!`, streams PDF |

Also inbound-API (not webhooks, but external systems calling in): partner APIs `/api/apollo/*`, `/api/tygo/*`, `/api/sedco/*` (Tygo/Apollo/Sedco kiosks & partners: plans, numbers, eligibility, semati authorize, checkout, activation, TCC SMS).

Security notes: only OTO (HMAC) and Hyperpay (AES-GCM payload) verify authenticity; Tap/Merchalink/Hyperbill/legacy delivery callbacks have weak or no verification; IAM JWT not signature-verified.

---

# 3. Background jobs (Sidekiq)

Queues (`config/sidekiq_config.yml`, concurrency 5/10 staging/20 prod):
`payment_commit, zatca_transaction, numbers_commit, reserve_number, delivery, unreserve_number, delivery_request, change_plan, smsa, zatca_customer_notification, installment_worker, default, <hostname>_raw_sim, email_notifier, otp_email_notifier, sms_notifier, inactivated_order_email_notifier, abandon_order_email_notifier, url_mapper, slack_ping, firebase_config_updater, salam_notification`

Cron (`config/schedule.rb` via whenever) — daily 12:00 AM:
- `rake custom:onboarding_order_records_to_csv` — onboarding orders → CSV export
- `rake export_data:activation_log_to_csv` — activation log → CSV
- `rake export_eligibility_data:eligibility_log_to_csv` — eligibility log → CSV
(Related non-cron rake tasks scp CSVs to MVNO FTP: `saleor_records_to_csv*`, `saleor_stocks_to_csv`, `ftp_folders_exporter`.)

Middleware: `app/workers/client_middleware.rb` / `server_middleware.rb` propagate `Current` request context (lang/platform) into jobs.

| Worker (class — file) | Queue | Does | Triggered by | External calls |
|---|---|---|---|---|
| `Payment::CommitWorker` — `app/workers/payment/commit_worker.rb` | payment_commit | Post-payment orchestration: BSS recharge/bill/postpaid transactions, order completion, number commit, delivery creation, checkout completion (change-plan/replacement/saleor/OT/renewal), enqueues ZATCA | `Payment` model on success callback (perform_async/perform_in) | Optiva::Transaction, Saleor::Middleware, DeliveryManager, enqueues Numbers::CommitWorker, ChangePlanWorker, ZatcaTransactionWorker, OrderPickupEmailWorker |
| `Payment::RefundWorker` — `payment/refund_worker.rb` | payment_commit | Executes gateway refund via PaymentManager | `Refund` model | Hyperpay/Tap/Tamara/Salam refund APIs, Slack |
| `Payment::HyperbillSendInvoiceWorker` — `payment/hyperbill_send_invoice_worker.rb` | payment_commit | Invoice state machine: create → send → resend | `Api::V1::InvoicesController#send_invoice` | Hyperbill, Slack |
| `Payment::MerchalinkSendInvoiceWorker` — `payment/merchalink_send_invoice_worker.rb` | payment_commit | Same for Merchalink | invoice flows | Merchalink, Slack |
| `ZatcaTransactionWorker` (+ nested `AfterBssWorker`) — `zatca_transaction_worker.rb` | zatca_transaction (retry: false) | Submits e-invoice (payment / seller_deduction / qr_posa_completion; INV or CRN) via ZatcaManager | Payment::CommitWorker, Payment model, SelfActivationManager, QrPosaOrderCompleter, ZatcaManager (refund CRN), DeliveryManager | ZATCA via ClearTax |
| `ChangePlanWorker` — `change_plan_worker.rb` | change_plan (retry: false) | Runs `ChangePlanManager.switch!` (plan migration in BSS) | Payment::CommitWorker (change-plan checkout paid) | Optiva BSS |
| `Numbers::CommitWorker` — `numbers/commit_worker.rb` | numbers_commit | Extends number reservation, sets expiry, updates contact details in BSS | Payment::CommitWorker, OwnershipTransferPost, SelfActivationManager, QrPosaOrderCompleter | Optiva (NumberManager) |
| `ReserveNumberWorker` — `reserve_number_worker.rb` | reserve_number | Reserves MSISDN in Optiva | `Number` model | Optiva::Numbers |
| `UnreserveNumberWorker` — `unreserve_number_worker.rb` | unreserve_number | Releases reservation (new NumberManager path or legacy `unreserve_2`) | `Number` model | Optiva |
| `Delivery::TamWorker` — `delivery/tam_worker.rb` | delivery | Creates TAM shipment for DeliveryRequest | DeliveryManager.perform | TAM |
| `Delivery::BarqWorker` — `delivery/barq_worker.rb` | delivery | Creates Barq order | DeliveryManager | Barq |
| `Delivery::SmsaWorker` — `delivery/smsa_worker.rb` | smsa | Creates SMSA B2C shipment, sends tracking SMS+email | DeliveryManager | SMSA, SmsWorker, mailer |
| `Delivery::OtoWorker` — `delivery/oto_worker.rb` | delivery | Creates OTO order | DeliveryManager | OTO |
| `Delivery::ImileWorker` — `delivery/imile_worker.rb` | delivery | Creates iMile WMS outbound order | DeliveryManager | iMile |
| `Delivery::StccWorker` — `delivery/stcc_worker.rb` | delivery | Creates STCC shipment | DeliveryManager, `DeliveryRequest` model | STCC |
| `Delivery::ManaratWorker` — `delivery/manarat_worker.rb` | delivery | Creates Manarat shipment | DeliveryManager | Manarat |
| `Delivery::SaleorWorker` — `delivery/saleor_worker.rb` | delivery | Confirms Saleor order post-payment, sets external id, sends confirmation SMS, completes checkout | DeliveryManager.create_from_saleor_checkout | Saleor middleware, SmsWorker |
| `Delivery::PosaWorker` — `delivery/posa_worker.rb` | delivery | Dummy (POSA SIM already handed to customer) | DeliveryManager | none |
| `Saleor::InstallmentWorker` — `saleor/installment_worker.rb` | installment_worker | Confirms Saleor order for installment purchases, stores saleor_order_id | installment checkout flow | Saleor middleware |
| `Notifier::SmsWorker` — `notifier/sms_worker.rb` | sms_notifier | Sends SMS via current vendor, mirrors to Slack | ~20 call sites (OTP, orders, transfers, deliveries, ZATCA) | Unifonic/Msegat, Slack |
| `Notifier::SematiSmsWorker` — `notifier/semati_sms_worker.rb` | sms_notifier | Sends SMS via TCC by national ID (prod: mTLS client) | Otp model, MNP/services/apollo controllers | TCC, Slack |
| `Notifier::EmailWorker` / `OtpEmailWorker` / `OrderEmailWorker` / `OrderPickupEmailWorker` — `notifier/*.rb` | email_notifier / otp_email_notifier | Transactional emails (OTP, order, shipment id, pickup info) | OTP flows, SmsaWorker, Payment::CommitWorker | SMTP |
| `Notifier::ZatcaCustomerEmailWorker` — `notifier/zatca_customer_email_worker.rb` | zatca_customer_notification | Emails ZATCA invoice to customer | `Zatca::Notified` | SMTP |
| `Notifier::AbandonedOrderWorker` — `notifier/abandoned_order_worker.rb` | abandon_order_email_notifier | Escalating abandoned-cart reminders (6h/24h), email+SMS, self-reschedules | OnboardingOrder model | SMTP, SmsWorker |
| `Notifier::InactivatedOrderWorker` — `notifier/inactivated_order_worker.rb` | inactivated_order_email_notifier | Reminds customer to activate delivered SIM (self-reschedules) | OnboardingOrder model | SMTP, SmsWorker |
| `Notifier::OwnershipTransferReminderWorker` — `notifier/ownership_transfer_reminder_worker.rb` | abandon_order_email_notifier | Repeated OT-acceptance reminders until expiry | OnboardingOrderManager | SmsWorker |
| `Notifier::SlackWorker` — `notifier/slack_worker.rb` | slack_ping | Slack webhook ping (staging + setting-gated) | everywhere | Slack |
| `Notifier::AdjustWorker` — `notifier/adjust_worker.rb` | sms_notifier | Sends S2S attribution event | AdjustManager (order adjust endpoint) | Adjust |
| `Notifier::CvmWorker` — `notifier/cvm_worker.rb` | sms_notifier (retry 3) | Retention MNP trigger on termination, logs to TerminationLog | ProfileManager | CVM, Slack |
| `Remedy::NewTicketWorker` — `remedy/new_ticket_worker.rb` | sms_notifier (retry 3) | Creates retention ticket ("Customer SR/WO") on termination survey | SurveysController | Remedy SOAP, Slack |
| `Remedy::SematiTicketWorker` — `remedy/semati_ticket_worker.rb` | sms_notifier | Creates ticket for Semati activation error 726 | V12 ActivationController | Remedy SOAP, Slack |
| `Optiva::CommissionWorker` — `optiva/commission_worker.rb` | default | Posts seller commission for activation/MNP to BSS portal | SelfActivationManager | Optiva SelfActivationPortal |
| `Optiva::RegisterNumberOnSematiWorker` — `optiva/register_number_on_semati_worker.rb` | change_plan (retry 1) | Registers MSISDN on Semati after IAM auth | `verify_iam_token` concern (IAM callback) | Semati via Optiva |
| `Optiva::TestWorker` — `optiva/test_worker.rb` | default | Dev/test utility | manual | Optiva |
| `OwnershipTransferPre` — `ownership_transfer_pre.rb` | default | OT pre-acceptance step (old-user suspension — currently commented out) | OwnershipTransferManager | (Optiva, disabled) |
| `OwnershipTransferPost` — `ownership_transfer_post.rb` | default | OT post-acceptance: terminates old user in BSS, re-reserves number, notifies old owner | Payment::CommitWorker → OwnershipTransferManager.post_acceptance | Optiva (ProfileManager/NumberManager), SmsWorker, Numbers::CommitWorker |
| `RawSimWorker` — `raw_sim_worker.rb` | `<hostname>_raw_sim` | Parses uploaded SIM CSVs, creates RawSims, pushes 1000-chunks to vendor inventory (special QR-POSA path) | ActiveAdmin `app/admin/sim_uploads.rb` | InventoryManager → Barq/iMile/OTO/Saleor etc., SMTP on failure |
| `FirebaseConfigWorker` — `firebase_config_worker.rb` | firebase_config_updater (retry: false) | Pushes Setting changes to Firebase Remote Config | Setting model | Firebase |
| `SalamNotificationWorker` — `salam_notification_worker.rb` | salam_notification (retry 5) | Registers/updates push subscriber (prod only) | NotificationToken model, auth controllers | Salam Notification service |
| `UrlMapperWorker` — `url_mapper_worker.rb` | url_mapper (retry: false) | POSTs URL mapping to internal AWS API GW | link generation | URL-mapper service |

Totals: 43 worker classes (42 files + nested `ZatcaTransactionWorker::AfterBssWorker`), 22 queues, 3 cron entries.

---

# 4. Topology summary (adjacency list)

Nodes: `App` (Rails API), `Worker(<queue>)` (Sidekiq), `Admin` (ActiveAdmin), `Cron`, external systems.

**Payments**
- App → Hyperpay: create checkout / query status
- Hyperpay → App: encrypted payment webhook (`/payment/hyperpay/callback`)
- App → Tap: create charge / charge status / tokenized card lookup
- Tap → App: charge webhook (`/payment/tap/callback`)
- App → Tamara: BNPL pre-check + checkout; App → Tamara: authorize (on pending webhook)
- Tamara → App: payment webhook (`/payment/tamara/callback`)
- App → SalamPay: create invoice / status
- SalamPay → App: payment webhook (`/payment/salam/callback`)
- App → Emkan: voucher validate / pre-redeem / redeem (OTP) / refund
- Worker(payment_commit:RefundWorker) → Hyperpay|Tap|Tamara|SalamPay: refund/reverse
- Worker(payment_commit:CommitWorker) → BSS(Optiva): create_subscription_transaction (recharge/renewal), account_transaction (bill/postpaid/OT)
- Worker(payment_commit:CommitWorker) → Worker(zatca_transaction): enqueue e-invoice
- Worker(payment_commit:CommitWorker) → Saleor: update_payment_state (fail sync)
- Worker(payment_commit:Hyperbill/MerchalinkSendInvoiceWorker) → Hyperbill|Merchalink: create/send invoice
- Hyperbill → App: invoice-paid webhook (`/hyperbill/callback`)
- Merchalink → App: invoice-paid webhook (`/merchalink/callback`)

**Compliance**
- Worker(zatca_transaction) → ZATCA (via ClearTax): generate e-invoice async (INV/CRN)
- App → ZATCA (ClearTax): generate invoice PDF (`GET /zatca/:invoice_number`)
- Worker(zatca_customer_notification) → SMTP: invoice email; Zatca::Notified → Worker(sms_notifier) → SMS

**BSS / telco**
- App → BSS(Optiva): eligibility, number search/reserve, activation (new/MNP/data-SIM/eSIM), subscription state, balance, bills(PDF), CRM, price plans, Absher OTP, Semati registration
- Worker(reserve_number|unreserve_number|numbers_commit) → BSS(Optiva): reserve / release / extend reservation + contact update
- Worker(change_plan:ChangePlanWorker) → BSS(Optiva): plan switch
- Worker(default:Optiva::CommissionWorker) → BSS(Optiva): seller commission
- Worker(default:OwnershipTransferPost) → BSS(Optiva): terminate old owner + re-reserve number
- App → SSE: social-security eligibility check
- App → PCalls: call-registry status / allow-block
- App → TCC: mobile_verify (ID-vs-MSISDN)

**Identity**
- App → IAM/Nafath (Semati broker): authorize v1/v2 (new line, SIM, change plan, OT, visitor-Hajj)
- Nafath/IAM → App: auth callback (`GET/POST /eChannels/iam/callback`, `/callback_completed`, `/semati/login`)
- Worker(change_plan:RegisterNumberOnSematiWorker) → Semati(Optiva): register number after auth
- App → Absher (via Optiva): OTP identity verification

**Delivery**
- App(DeliveryManager) → Worker(delivery|smsa): enqueue per vendor
- Worker(delivery:TamWorker) → TAM: create_order
- Worker(delivery:BarqWorker) → Barq: login + create order
- Worker(smsa:SmsaWorker) → SMSA: create B2C shipment; → Worker(sms_notifier)+SMTP: tracking notice
- Worker(delivery:OtoWorker) → OTO: createOrder / orderStatus
- Worker(delivery:ImileWorker) → iMile: createOutboundOrder
- Worker(delivery:StccWorker) → STCC: shipment/create
- Worker(delivery:ManaratWorker) → Manarat: shipment/create (+ App → Manarat: is_available)
- TAM|Barq|SMSA|OTO|STCC|Manarat → App: delivery status webhook (`/delivery/:vendor/callback`, OTO HMAC-verified)
- App → SMSA: pickup-office lookup

**E-commerce**
- App → Saleor(middleware): banners, checkout, stock, extend reservation
- Worker(delivery:SaleorWorker) → Saleor: confirm order + metadata; → Worker(sms_notifier): confirmation SMS
- Worker(installment_worker) → Saleor: confirm installment order
- Cron/rake → MVNO FTP: Saleor order/stock CSV via SCP

**Messaging / notifications**
- Worker(sms_notifier:SmsWorker) → Unifonic|Msegat: send SMS
- Worker(sms_notifier:SematiSmsWorker) → TCC: send SMS by national ID
- Worker(email_notifier|otp_email_notifier|abandon/inactivated queues) → SMTP: transactional mail
- Worker(slack_ping) → Slack: ops webhook
- Worker(firebase_config_updater) → Firebase Remote Config: PUT config (from Admin Setting)
- Worker(salam_notification) → Salam Notification svc: subscriber register/update (→ FCM push)
- Worker(url_mapper) → URL-mapper (internal AWS APIGW): POST mapping

**Ticketing / retention / analytics**
- Worker(sms_notifier:Remedy::NewTicketWorker|SematiTicketWorker) → BMC Remedy (SOAP CreateTicket): retention / Semati-error tickets
- Worker(sms_notifier:CvmWorker) → CVM: mnpTrigger on termination
- Worker(sms_notifier:AdjustWorker) → Adjust: S2S attribution event
- App → Google Maps: reverse geocode delivery coords

**Partners (inbound APIs)**
- Tygo/Apollo partner → App: `/api/apollo/*`, `/api/tygo/*` (plans, numbers, semati, checkout, activation, TCC SMS)
- Sedco kiosk → App: `/api/sedco/*` (semati authorize/check/token)

**Admin / batch**
- Admin → Worker(<host>_raw_sim:RawSimWorker) → InventoryManager → Barq|iMile|OTO|Saleor|...: SIM inventory sync
- Cron (daily 00:00) → rake CSV exports (onboarding orders, activation log, eligibility log) → MVNO FTP (via exporter tasks)
- Lokalise → repo locales (dev-time translation sync)
