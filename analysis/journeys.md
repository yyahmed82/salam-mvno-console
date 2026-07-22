# Salam MVNO selfcare-backend — End-to-End User Journeys

Source: `/Users/yosriyahmed/Documents/Claude/Projects/Salam DMS/selfcare-backend` (Rails 6.1, release-2.34.1).
Derived from `config/routes.rb`, `config/routes/apollo.rb`, `config/routes/sedco.rb`, all controllers (`api/v1..v12`, `apollo`, `sedco` namespaces), `app/lib/*` managers, `app/services/*`, `app/workers/*`, and the two AASM models (`OnboardingOrder`, `Checkout`).

**API versioning:** all routes live under `/api/...` with **no version segment in the path**. The version is selected by the `X-Protocol-Version` request header via `ApiVersion` (`app/lib/api_version.rb`, `matches?` = header ≥ scope version; `v1` is the default). Endpoints below are written as `VERB /api/<path>` plus the controller version that handles them.

**Auth principals** (ApiGuard JWT in `Access-Token` header unless noted):
- `anonymous_user` — device-bound token from `POST /api/auth/device` (guest browsing / pre-purchase).
- `user` — registered subscriber (password + OTP login).
- `guest` — OTP-only subscriber session.
- `seller` — dealer JWT in `Seller-Authorization` header (`JsonWebToken`).
- `api_key` — server-to-server key (`Api::V1::Apps::*`, Apollo/Tygo, Sedco, Remedy, VAS use `AppsController` / `authenticate_with_api_key!`).

**Core external integrations:** Optiva BSS (`Optiva::Subscription/Numbers/Activation/Transaction/Balance/Account/Bills/Esim/Crm/Absher/SelfActivationPortal`), Nafath/IAM (`IamNew`, callbacks at `/eChannels/iam/callback`), Absher, payment gateways (HyperPay, STC Pay, Salam/Merchalink, Tamara, Tap, Barq, TAM, Manarat via `PaymentManager` + `/payment/:vendor/callback`), Hyperbill (invoice links), delivery vendors (SMSA, OTO, iMile, Barq, TAM, Manarat, STCC via `DeliveryManager` + `/delivery/:vendor/callback`), Saleor GraphQL e-commerce, EMKAN/Tamara/Tasheel installments, ZATCA e-invoicing, TCC (SMS / mobile-ownership verification), Firebase, Adjust, Slack.

---

## Journey: Guest browsing & plans listing (app/web)
Anonymous device gets a token and browses plans, numbers, lookups and stores before buying.

| # | Step | Endpoint | Controller#action | Services/Lib | Integrations | DB tables | State transition |
|---|------|----------|-------------------|--------------|--------------|-----------|------------------|
| 1 | Device auth | `POST /api/auth/device` | `Api::V1::AnonymousUsers::AuthenticationController#create` | ApiGuard `create_token_and_set_header` | — | `anonymous_users` | — |
| 2 | List plans | `GET /api/plans`, `GET /api/plans/prepaid`, `GET /api/plans/postpaid`, `GET /api/plans/:id` | `Api::V1::PlansController#index/prepaid/postpaid/show` | — | — | `plans`, `plan_categories`, `plan_channels`, `prices` | — |
| 3 | Plan filters | `GET /api/plans/categories`, `/api/plans/sort_options`, `/api/plans/filter_options`, `/api/plans/sort_filter_options` | `Api::V1::PlansController#…` | — | — | `plan_categories` | — |
| 4 | Browse numbers/vanities | `GET /api/numbers`, `GET /api/numbers/vanities`, `GET /api/numbers/enhanced_numbers` | `Api::V1::NumbersController#index/vanities/enhanced_numbers` | `NumberManager`, `Optiva::Numbers` | Optiva BSS | `vanities`, `tmp_numbers` | — |
| 5 | Lookups | `GET /api/lookup/nationalities`, `/api/lookup/nationalities_and_id_types`, `/api/lookup/operators`, `/api/lookup/recharge_options`, `/api/lookup/home_delivery_areas`, `/api/lookup/home_delivery_areas/:area_id/cities`, `/api/lookup/home_delivery_cities`, `/api/lookup/app_config`, `/api/lookup/delivery_times`, `/api/lookup/esim_devices`, `/api/lookup/social_networks`, `/api/lookup/countries/:region`, `/api/lookup/credit_denominations` | `Api::V1::LookupController#…` | `DeliveryDay` | — | `nationalities`, `mnp_operators` (lookup), `recharge_options`, `delivery_areas`, `delivery_cities`, `settings`, `countries`, `credit_denominations`, `social_networks` | — |
| 6 | Store locator | `GET /api/stores/get_stores` | `Api::V1::StoresController#get_stores` | `StoresProcessor`, `DistanceCalculator` | Google Maps | `stores`, `store_types` | — |
| 7 | Categories/surveys/banners | `GET /api/categories`, `GET/POST /api/surveys`, `POST /api/apps/settings/banner` | `Api::V1::CategoriesController`, `SurveysController`, `Apps::SettingsController#banner` | — | — | `categories`, `surveys`, `survey_answers`, `apps` | — |

---

## Journey: Login + OTP (app)
Registered subscriber signs in with mobile number + password, then confirms an SMS OTP.

| # | Step | Endpoint | Controller#action | Services/Lib | Integrations | DB tables | State transition |
|---|------|----------|-------------------|--------------|--------------|-----------|------------------|
| 1 | Sign-in (password) | `POST /api/users/sign_in` | `Api::V1::Users::AuthenticationController#create` | `Optiva::Subscription#get_subscription_profile`, `resource.authenticate`, `Customer#current_plan`, `resource.send_otp` | Optiva BSS, TCC/SMS vendor | `users`, `customers`, `otps` | — (Optiva account must be ACTIVATED) |
| 2 | Verify OTP | `POST /api/users/verify` | `Api::V1::Users::AuthenticationController#verify` | `authenticate_otp(otp_code, drift: 180)`, ApiGuard token | — | `users` | — |
| 3 | Sign-out | `DELETE /api/users/sign_out` | ApiGuard authentication controller | JWT blacklist | — | `users` | — |
| 4 | Dashboard | `GET /api/users/dashboard` (v1) / `GET /api/users/dashboard`+`dashboard_manage` (v2, header `X-Protocol-Version: v2+`) | `Api::V1::UsersController#dashboard` / `Api::V2::UsersController#dashboard/dashboard_manage` | `AccountManager`, `BundleManagment` | Optiva BSS | `users`, `customers`, `plans` | — |

Sub-flow — **forgot/reset password**: `POST /api/users/passwords/forgot` → `Api::V1::Users::PasswordsController#forgot` (creates `Otp` msg_type `forgot_password`, SMS/email) → `POST /api/users/passwords/otp_verify` (#otp_verify) → `POST /api/users/passwords/reset` (#reset updates `users.password`).

---

## Journey: Registration / sign-up (app)
Create a selfcare account for an already-active Salam number (v1/v7 with OTP; v5/v6 without pre-OTP).

| # | Step | Endpoint | Controller#action | Services/Lib | Integrations | DB tables | State transition |
|---|------|----------|-------------------|--------------|--------------|-----------|------------------|
| 1 | Is registered? | `GET /api/users/is_registered` | `Api::V1::Users::RegistrationController#is_registered` | `MobileNumberDecorator` | — | `users`, `deleted_users` | — |
| 2 | Check email | `GET /api/users/check_email` (v1 & v5) | `Users::RegistrationController#check_email` | — | — | `users` | — |
| 3 | Sign-up OTP | `POST /api/users/sign_up_otp` (v1; overridden in v7) | `Api::V1(V7)::Users::RegistrationController#otp` | `Otp.create(msg_type: 'create_account_mysalam')` | SMS vendor | `otps` | — |
| 4 | Verify sign-up OTP | `POST /api/users/sign_up_otp_verify` (v1) | `Api::V1::Users::RegistrationController#otp_verify` | `Otp#verify!` | — | `otps` | — |
| 5 | Create account | `POST /api/users/sign_up` (v1 default; v5 variant without OTP) | `Api::V1(V5)::Users::RegistrationController#create` | `Optiva::Subscription#get_subscription_profile`, `set_from_optiva`, `set_from_onboarding_order`, ApiGuard token | Optiva BSS | `users`, `customers`, `onboarding_orders` | — |
| 6 | List numbers per ID | `GET /api/users/list_mobile_numbers` (v1 base; v6/v7 overrides) | `Users::RegistrationController#list_mobile_numbers` | `MobileNumbersPerId` | Optiva BSS | — | — |

Guest variant: `POST /api/guests/sign_in` → `Api::V1::Guests::AuthenticationController#create` (Optiva profile check + OTP) → `POST /api/guests/verify` (#verify, attempt limits in Redis) → guest JWT.

---

## Journey: New line onboarding — physical SIM with home delivery (app/web)
Anonymous user configures a new prepaid/postpaid line, verifies identity via Nafath, pays and gets the SIM couriered. Drives the `OnboardingOrder` AASM (`update_order` event fires after every save).

| # | Step | Endpoint | Controller#action | Services/Lib | Integrations | DB tables | State transition |
|---|------|----------|-------------------|--------------|--------------|-----------|------------------|
| 1 | Create/reuse order | `POST /api/onboarding/orders` (v1; v5 adds flow_type detection) / `GET /api/onboarding/orders/current` / `GET /api/onboarding/orders/current_by_plan/:plan_id` | `Api::V1(V5)::Onboarding::OrdersController#create/current/create_by_plan` | `find_available_orders_to_be_reused`, `capture_utm_parameters` | — | `onboarding_orders` | → `plan_selection` (initial; `reseted` if reused) |
| 2 | Select plan | `POST /api/onboarding/orders/:order_id/plans` (v1; v3 override) | `Api::V1(V3)::Onboarding::PlansController#create` | `OnboardingOrder#save_plan` (data-bundle plans auto-pick data number via `Optiva::Numbers#data_number`) | Optiva BSS (data plans) | `onboarding_orders`, `plans` | `update_order` → `sim_type_selection` |
| 3 | Select SIM type | `POST /api/onboarding/orders/:order_id/sim_type` (v3) | `Api::V3::Onboarding::SimTypeController#create` | `save_sim_type` (0=physical, 1=eSIM) | — | `onboarding_orders` | → `number_order_type_selection` |
| 4 | New vs MNP | `POST /api/onboarding/orders/:order_id/numbers/order_type` | `Api::V1::Onboarding::NumbersController#order_type` | `save_number_order_type` (0=new, 1=MNP) | — | `onboarding_orders` | → `number_selection` (new) |
| 5 | Reserve MSISDN | `POST /api/onboarding/orders/:order_id/numbers/reserve` / `DELETE …/numbers/unreserve` | `Api::V1::Onboarding::NumbersController#reserve/unreserve` | `Optiva::Numbers#get_number`, `NumberManager` (reserve/unreserve), `save_number` | Optiva BSS number inventory | `onboarding_orders`, `numbers`, `vanities` | → `eligibility_check` |
| 6 | Eligibility | `POST /api/onboarding/orders/:order_id/eligibility/is_eligible` (also global `POST /api/eligibility/is_eligible`, `GET /api/eligibility/nationalities`, `GET /api/eligibility/visa_types`) | `Api::V1::Onboarding::EligibilityController#is_eligible` / `Api::V1::EligibilityController` | `save_eligibility`, `SematiAbsherUserType` | Optiva `Optiva::Activation#eligibility` (CITC line-count check) | `onboarding_orders`, `nationalities`, `eligibility_id_types`, `eligibility_logs`, `semati_absher_user_types` | → `account_details` |
| 7 | Customer info | `POST /api/onboarding/orders/:id/customer_info` (v5 adds TCC mobile-ownership check) | `Api::V1(V5)::Onboarding::OrdersController#customer_info` | `save_customer_info` (email/mobile/name); v5 `tcc_mobile_verify` | TCC (v5, prod) | `onboarding_orders` | → `account_verification`; `handle_order_transition` triggers `handle_otp_notifications` |
| 8 | OTP delivery+verify | (auto SMS via `OtpVerification#deliver!`) then `POST /api/otp/verify`, `POST /api/otp/resend` | `Api::V1::OtpController#verify/resend` | `OtpVerification`, `handle_onboarding_otp` | SMS vendor / email | `otp_verifications` | sets `mobile_number_verified` → `account_password` |
| 9 | Set password | `POST /api/onboarding/orders/:order_id/profiles/customer_password` | `Api::V1::Onboarding::ProfilesController#create` | `save_customer_password` | — | `onboarding_orders` (`has_password`) | → `delivery_details` |
| 10 | Nafath verification | see **Journey: Nafath/Absher identity verification** (`POST /api/semati/authorize` → callback → `GET /api/semati/check`) | `Api::SematiController` concern | `IamNew` | Nafath IAM | `nafath_logs`, `onboarding_orders` | — (IAM token cached in Redis for activation) |
| 11 | Delivery info | `POST /api/onboarding/orders/:id/delivery_info` | `Api::V1::Onboarding::OrdersController#delivery_info` | `save_delivery_info` (lat/lng, address, delivery_type delivery/pickup, delivery time) | Google Maps (geofence) | `onboarding_orders`, `geofences` | → `payment` (`payment_guard` = delivery set) |
| 12 | Pay | `POST /api/payment/initiate` (`object_type=OnboardingOrder`) → gateway redirect → `POST /payment/:vendor/callback` or `POST /api/payment/:id/commit` → `GET /api/payment/:id/status` | `Api::V1::PaymentController#initiate/commit/status`, `CallbacksController#payment/hyperpay/…` | `PaymentManager#create_for_onboarding`, `#initiate_payment`, `Payment#update_commit_response` | HyperPay/STC Pay/Salam/Tamara/Tap gateway | `payments` | — (order stays `payment`) |
| 13 | Commit worker | (async `Payment::CommitWorker`, queue `payment_commit`) | — | `Numbers::CommitWorker` (extend reservation), `DeliveryManager.create_from_order`, `Notifier::OrderPickupEmailWorker` (pickup) | Optiva BSS, SMSA/OTO/iMile/… delivery vendor | `payments`, `onboarding_orders.completed=true`, `delivery_requests` | expired number ⇒ `expired_guard` → `expired` |
| 14 | ZATCA + notify | (async `ZatcaTransactionWorker::AfterBssWorker`) | — | `ZatcaManager` | ZATCA | `payments` (zatca fields), `invoices` | — |
| 15 | Delivery status | `GET /api/deliveries/requests`; vendor webhook `POST /delivery/:vendor/callback` | `Api::V1::DeliveriesController#requests`, `CallbacksController#delivery` | `DeliveryManager.process_callback`, `Delivery::Oto::SignatureVerifier` | Delivery vendors | `delivery_requests` | — |
| 16 | Activate delivered SIM | see **Journey: SIM self-activation** | — | — | — | — | `activated=true` |

Auth: steps 1–12 `anonymous_user` (or `user`/`guest`); step 16 anonymous device.

---

## Journey: eSIM onboarding with QR (app/web)
Same wizard as physical SIM but `sim_type=ESIM`: delivery is skipped (`skip_the_delivery?`), the eSIM ICCID is reserved from Optiva at activation time, and the customer receives the eSIM profile as a QR code.

| # | Step | Endpoint | Controller#action | Services/Lib | Integrations | DB tables | State transition |
|---|------|----------|-------------------|--------------|--------------|-----------|------------------|
| 1 | Wizard steps 1–10 | as physical-SIM journey, with `POST …/sim_type` = `SIM_TYPE_ESIM (1)` | see above | `save_sim_type` | — | `onboarding_orders` | `delivery_details_guard` passes straight to `payment` (`skip_the_delivery?` true, no `delivery_info` needed) |
| 2 | Pay | `POST /api/payment/initiate` → callback/commit | `Api::V1::PaymentController` | `PaymentManager#create_for_onboarding` | Gateway | `payments` | — |
| 3 | Complete (no delivery) | async `Payment::CommitWorker` | — | `Numbers::CommitWorker`; **no** `DeliveryManager` call for eSIM without data-SIM | Optiva BSS | `onboarding_orders.completed=true` | — |
| 4 | Activate | `POST /api/activation` (order flow) | `Api::V1::ActivationController#create` | `Optiva::Esim#reserve_esim` (allocates ICCID), `IccidValidator`, `SimUpload.create_raw_esim`, `ActivationManager#activate` | Optiva BSS + Semati | `raw_sims`, `sim_uploads`, `onboarding_orders.activated=true` | — |
| 5 | Fetch eSIM QR | `GET /api/onboarding/orders/esim_qr?mobile_number=…` (unauthenticated) — also returned as `esim_profile_link` in activation response | `Api::V1::Onboarding::OrdersController#esim_qr` | `Qr#generate_qr`, `Optiva::Subscription#get_subscription_profile` → `cardPackageID`, `Optiva::Numbers#esim_qr_code` | Optiva BSS eSIM (SM-DP+ link) | — | — |

---

## Journey: MNP port-in (app/web)
New-line wizard with `number_order_type=MNP (1)`: user supplies donor number/operator instead of reserving a number; activation runs the Semati transfer + Optiva MNP APIs.

| # | Step | Endpoint | Controller#action | Services/Lib | Integrations | DB tables | State transition |
|---|------|----------|-------------------|--------------|--------------|-----------|------------------|
| 1 | Wizard steps 1–3 | as physical-SIM journey | — | — | — | `onboarding_orders` | → `number_order_type_selection` |
| 2 | Choose MNP | `POST /api/onboarding/orders/:order_id/numbers/order_type` (`order_type=1`) | `Api::V1::Onboarding::NumbersController#order_type` | `save_number_order_type` | — | `onboarding_orders` | → `mnp_info` (guard `is_mnp?`) |
| 3 | Donor info | `POST /api/onboarding/orders/:order_id/mnp` | `Api::V1::Onboarding::MnpController#create` | `save_mnp_info(mnp_operator, mnp_number)`; `mnp_number_available?` via `Optiva::Numbers#get_number(state)` | Optiva BSS | `onboarding_orders` (mnp_number, mnp_operator), `mnp_operators` lookup (`GET /api/lookup/operators`) | → `eligibility_check` |
| 4 | Eligibility → password → Nafath → payment | as physical-SIM steps 6–12 (delivery of a blank SIM still occurs unless eSIM) | — | — | — | — | … → `payment` |
| 5 | Commit | async `Payment::CommitWorker` (MNP branch: no number reservation extension) | — | `DeliveryManager.create_from_order` (physical) | Delivery vendor | `onboarding_orders.completed=true`, `delivery_requests` | — |
| 6 | Activate / port | `POST /api/activation` | `Api::V1::ActivationController#create` → `ActivationManager#mnp_activation` | `ExternalRequests::NewMobileNumber`, `Optiva::Activation#semati_transfer_number`, `#create_account`, `#create_subaccount`, `#add_update_supplementary_data`, `#mnp`; on failure `#cancel_mobile_number` + eSIM unreserve | Semati (CITC port), Optiva BSS | `onboarding_orders`, `raw_sims`, `activation_logs` | `activated=true` |
| 7 | Cancel a pending port (any user, unauthenticated web) | `POST /api/mnp/cancel_mnp` → `POST /api/mnp/cancel_mnp_otp` | `Api::V1::MnpController#cancel_mnp/cancel_mnp_otp` | `MnpManager.new_from_identifier_and_id`, `AccountManager`, `Otp` (msg_type `cancel_mnp`) | Optiva BSS/Semati, SMS via `Notifier::SematiSmsWorker` | `cancel_mnp_logs`, `otps` | — |

---

## Journey: Nafath/Absher identity verification — "Semati" (app/web/dealer/kiosk)
Regulatory KYC gate used by onboarding, activation, plan change (pre↔post), ownership transfer and SIM replacement. Shared concern `Api::SematiController` served at three mounts: `/api/semati/*` (app), `/api/apollo/semati/*` (Apollo partners), `/api/sedco/semati/*` (Sedco kiosks).

| # | Step | Endpoint | Controller#action | Services/Lib | Integrations | DB tables | State transition |
|---|------|----------|-------------------|--------------|--------------|-----------|------------------|
| 1 | Start verification | `POST /api/semati/authorize` (also `/api/apollo/semati/authorize`, `/api/sedco/semati/authorize`) | `Api::SematiController#authorize` (Nafath) or `#absher_authorize` | `IamNew#authorize(nationality_id, service, ip, use_v2: visitor)`; Absher branch `Optiva::Absher#create_absher_token` (`Setting.bypass_absher` in non-prod) | Nafath IAM v1 (citizens/residents) or v2 (visitors), Absher | `nafath_logs`, `onboarding_orders` (auth type) ; Redis keys `{trans_id}*` (15 min) | — |
| 2 | User approves in Nafath app | (out of band) | — | — | Nafath mobile app (random-number challenge / QR) | — | — |
| 3 | IAM callback | `POST /eChannels/iam/callback` (new), `GET /eChannels/iam/callback` (legacy), `GET /eChannels/iam/simulator`, `GET /eChannels/iam/callback_completed`, `GET /semati/login` | `CallbacksController#iam_new/iam/iam_simulator/iam_completed/iam_login` | JWT decode of Nafath response; stores PersonId on order; caches final token | Nafath | `nafath_logs`, `onboarding_orders.extra_person_id` | — |
| 4 | Poll result | `GET /api/semati/check` (all three mounts; sedco also `GET /api/sedco/semati/token`) | `Api::SematiController#check` / Sedco `#token` | reads Redis `trans_id` cache | Redis | — | — |
| 5 | Re-auth of an active customer (e.g. SIM replacement / spam unlock) | `PATCH /api/semati/authorize_active_user` → `POST /api/semati/authorize_active_user_otp` | `Api::SematiController#authorize_active_user/authorize_active_user_otp` | `AccountManager.new_from_mobile_number` (state must be ACTIVATED, ID must match), `Otp` (msg_type `validate_active_user`) then re-runs `authorize` with `semati_reauth` | Optiva BSS, Nafath, SMS | `otps`, `nafath_logs` | — |
| 6 | Register number on Semati (post-login remediation) | `POST /api/users/register_number_on_semati` (v2) | `Api::V2::UsersController#register_number_on_semati` | `Semati` service, `Optiva::Activation#semati_new_number` / `semati_reauth_mobile_number`; async `Optiva::RegisterNumberOnSematiWorker` | Semati/Optiva | `missing_semati_lists`, `nafath_logs` | — |

The completed IAM token (`iam_token`) is consumed later by `ActivationManager`, `SimReplacementManager`, `ChangePlanManager` (pre↔post switches) and DataSIM activation.

---

## Journey: SIM self-activation after purchase (app)
Customer who received the SIM (delivery/pickup) activates the line: order lookup by national ID, OTP match, Nafath, then BSS provisioning. v5 adds ICCID inventory checks; QR-POSA/visitor variants below.

| # | Step | Endpoint | Controller#action | Services/Lib | Integrations | DB tables | State transition |
|---|------|----------|-------------------|--------------|--------------|-----------|------------------|
| 1 | Find pending orders + send OTP | `GET/POST /api/activation/orders` (v1; v5 override; v12 override incl. expired-number orders) | `Api::V1(V5/V12)::ActivationController#orders` | matches `OnboardingOrder.pending_activation` by `nationality_id_number` + verified mobile; `OtpVerification#deliver!(OTP_TYPE_ACTIVATION)`; notification ids cached per device | SMS vendor | `onboarding_orders`, `otp_verifications` | — |
| 2 | Verify OTP / pick order | `POST /api/otp/verify` (`handle_list_orders_otp` / `handle_pick_order_otp`), `POST /api/otp/resend` | `Api::V1::OtpController#verify/resend` | `OtpVerification` | — | `otp_verifications` | — |
| 3 | Validate ICCID | `GET /api/activation/validate_iccid` (v1; v5 adds visitor-inventory rejection) | `Api::V1(V5)::ActivationController#validate_iccid` | `Optiva::Activation#get_card_package` (state must be `"1"`), `IccidValidator` | Optiva BSS | `raw_sims` | — |
| 4 | Absher fallback check | `GET /api/activation/can_verify_absher` | `Api::V1::ActivationController#can_verify_absher` | — | Absher | — | — |
| 5 | Nafath | `POST /api/semati/authorize` → `/eChannels/iam/callback` → `GET /api/semati/check` | `Api::SematiController` | `IamNew` | Nafath | `nafath_logs` | — |
| 6 | Activate | `POST /api/activation` (v1; v5 `POST /api/activation/order` per-order variant) | `Api::V1::ActivationController#create` / `Api::V5::ActivationController#order` | eSIM: `Optiva::Esim#reserve_esim`; `ActivationManager#activate` → `normal_activation` (`semati_new_number`, `create_account`, `create_individual_subscriber_v2`, `add_update_supplementary_data`, `store_csa`, `send_attachment`, initial-balance `handle_transactions`; Semati cleanup `cancel_mobile_number` on Optiva failure) or `mnp_activation`; `RawSim.redeem` | Semati, Optiva BSS, Absher (`update_mobile_number` when auth_type=absher) | `onboarding_orders` (`activated`, `activated_platform`, semati info), `raw_sims`, `sim_uploads`, `activation_logs` | `activated=true` |
| 7 | Auto-register selfcare user | (same request) | `#cleanup_user` / `#register_user` (v5 `cleanup_and_register_user`) | `User.set_from_optiva` (uses `has_password` + stored password) | Optiva BSS | `users`, `customers` | — |
| 8 | eSIM QR | response `esim_profile_link` + `GET /api/onboarding/orders/esim_qr` | see eSIM journey | `Qr`, `Optiva::Numbers#esim_qr_code` | Optiva | — | — |

Auth: anonymous device token. `POST /api/activation/validate_modem` (v1/v5) validates QR-POSA modem serials (below).

---

## Journey: POSA / QR-POSA dealer flow (POSA)
Point-of-sale-activation SIMs. Classic POSA: order created against a scanned ICCID and paid at the till. QR-POSA: a `QR_POSA`-vendor ICCID drives auto plan+data-number setup; completion is payment-less (`qr_posa_completions` instead of `payments`) and invoiced to ZATCA.

| # | Step | Endpoint | Controller#action | Services/Lib | Integrations | DB tables | State transition |
|---|------|----------|-------------------|--------------|--------------|-----------|------------------|
| 1 | Create order with ICCID | `POST /api/onboarding/orders` (v5) with `iccid` param | `Api::V5::Onboarding::OrdersController#create` | `RawSim`/`SimUpload.vendor` lookup: `QR_POSA` ⇒ `flow_type_qr_posa!` + `QrPosaFlow.setup_order!` (auto plan + `Optiva::Numbers#data_number` reserve); else `flow_type_posa!`; ICCID cached `{order_id}_iccid` 1 day | Optiva BSS | `onboarding_orders`, `raw_sims`, `sim_uploads` | `plan_selection` → auto-advanced (QR-POSA) |
| 2 | Wizard | plans/sim_type/number/eligibility/customer_info/password as normal (delivery skipped: `skip_the_delivery?` true for posa/qr_posa) | v1/v3/v5 onboarding controllers | — | — | `onboarding_orders` | … → `payment` |
| 3a | POSA payment | `POST /api/payment/initiate` (paid at till / gateway) | `Api::V1::PaymentController` | `PaymentManager#create_for_onboarding` (QR-POSA orders are **rejected** here) | Gateway | `payments` | — |
| 3b | QR-POSA completion | `POST /api/onboarding/orders/:id/complete_qr_posa` (v5; legacy v1 route exists) | `Api::V5::Onboarding::OrdersController#complete_qr_posa` | `QrPosaFlow.valid_modem?` (also exposed at `POST /api/activation/validate_modem`), `QrPosaOrderCompleter#complete!` → `Numbers::CommitWorker`, creates `QrPosaCompletion`, `ZatcaTransactionWorker` (INV) | ZATCA | `qr_posa_completions`, `onboarding_orders.completed=true` | order `payment` state, completed w/o payment |
| 4 | Activation | v5/v12 activation flow with cached ICCID (scope `qr_posa_pending_activation`) | `Api::V5(V12)::ActivationController` | `ActivationManager` | Semati, Optiva | `onboarding_orders.activated=true` | — |
| 5 | Invoice QR | `GET /zatca/:invoice_number`; partner QR `GET /api/partners/qr` | `ZatcaController#generate`, `Api::V1::PartnersController#qr` | `ZatcaManager`, `Qr` (TLV) | ZATCA | `invoices`, `payments` | — |

---

## Journey: Seller indirect orders (dealer)
A logged-in dealer (seller) creates orders on behalf of walk-in customers; payment is replaced by a wallet deduction from the seller's Optiva self-activation-portal balance, and commission is booked on activation.

| # | Step | Endpoint | Controller#action | Services/Lib | Integrations | DB tables | State transition |
|---|------|----------|-------------------|--------------|--------------|-----------|------------------|
| 1 | Seller login | `POST /api/sellers/sign_in` → `POST /api/sellers/verify_otp` | `Api::V1::Sellers::AuthenticationController#create/verify_otp` | `Seller#authenticate`, `SelfActivationManager#get_msisdn`, `send_otp`, `JsonWebToken.encode` | Optiva SelfActivationPortal, SMS | `sellers`, `otp_verifications` | — |
| 2 | Create order | `POST /api/onboarding/orders` (v5, seller token) | `Api::V5::Onboarding::OrdersController#create` | `flow_type_indirect!`, `seller_id` set; partner QR variant: `seller_key` (encrypted username) ⇒ `flow_type_partner!` | — | `onboarding_orders`, `sellers` | `plan_selection` |
| 3 | Wizard | plans → sim type → number → eligibility → customer info → OTP → password → Nafath (delivery skipped for indirect) | v1/v3/v5 onboarding controllers | — | Optiva, Nafath | `onboarding_orders` | … → `payment` |
| 4 | Wallet check | `GET /api/invoices/check_balance` | `Api::V1::InvoicesController#check_balance` | `SelfActivationManager#balance` | Optiva SelfActivationPortal | — | — |
| 5 | Deduct from wallet | `POST /api/invoices/deduct_amount/:order_id` | `Api::V1::InvoicesController#deduct_amount` | `SelfActivationManager#deduct_amount` → creates `SellerDeduction` (order completes without `Payment`) | Optiva SelfActivationPortal | `seller_deductions`, `onboarding_orders.completed=true` | — |
| 6 | Invoice customer | `GET /api/invoices/send_invoice/:onboarding_order_id`, `GET /api/invoices`, `GET /api/invoices/get_status/:id`, `GET /api/invoices/get_full_status/:id` | `Api::V1::InvoicesController#send_invoice/invoices/get_status/get_full_status` | `Payment::HyperbillSendInvoiceWorker` (send later) | Hyperbill payment-link | `invoices` | — |
| 7 | Customer pays invoice | `POST|GET /hyperbill/callback` (also `/merchalink/callback`) | `CallbacksController#hyperbill/merchalink` | `HyperbillResponse`/`MerchalinkResponse`, `PaymentManager` | Hyperbill/Merchalink | `payments`, `invoices` | — |
| 8 | Activation + commission | v12 activation (scope `indirect_pending_activation`); on success `SelfActivationManager#process_commission` → `Optiva::CommissionWorker`; manual `POST /api/invoices/commission` | `Api::V12::ActivationController#create`, `InvoicesController#commission` | `ActivationManager`, `Optiva::CommissionWorker` | Semati, Optiva | `onboarding_orders.activated=true`, `seller_deductions` | — |

---

## Journey: Dealer-app order servicing & v12 activation (dealer/POSA app, API-key)
Server-to-server namespace `/api/apps/*` (API-key auth, `ActionController::API`) used by the dealer/POSA application, plus the v12 activation flow that lets the agent re-pick a number before activating.

| # | Step | Endpoint | Controller#action | Services/Lib | Integrations | DB tables | State transition |
|---|------|----------|-------------------|--------------|--------------|-----------|------------------|
| 1 | Order QR | `GET /api/apps/orders/qr/:id` (encrypted order id PNG), `GET /api/apps/orders/qr_tlv` (ZATCA TLV) — unauthenticated; app scan | `Api::V1::Apps::OrdersController#qr/qr_tlv` | `Qr#encrypt_string/generate_qr` | — | — | — |
| 2 | Read order | `GET /api/apps/orders/:id`, `GET /api/apps/orders/get_details/:id` | `Apps::OrdersController#show/get_details` | — | — | `onboarding_orders`, `plans`, `numbers`, `payments` | — |
| 3 | Issue physical SIM | `POST /api/apps/orders/update_issued_sim/:id` | `Apps::OrdersController#update_issued_sim` | records handed-out ICCID | — | `issued_sims` | — |
| 4 | Social-security eligibility | `GET /api/apps/orders/check_social_security_eligibility` | `Apps::OrdersController#check_social_security_eligibility` | `SocialSecurityEligibilityManager`, `PlanRuleMap` | Gov eligibility API | `plan_rule_maps` | — |
| 5 | Payment check | `GET /api/apps/payment/check`, `GET /api/apps/payment/payment_status/:checkout_id`, `GET /api/apps/orders/active_checkouts` | `Apps::PaymentController#check/payment_status`, `Apps::OrdersController#active_checkouts` | `PaymentManager#check_status` | Gateway | `payments`, `checkouts` | — |
| 6 | List orders (v12) | `GET/POST /api/activation/orders` (v12, unauthenticated + OTP) | `Api::V12::ActivationController#orders` | includes expired-number & OT orders | SMS | `onboarding_orders` | — |
| 7 | Re-pick number | `GET /api/activation/:order_id/numbers`, `POST /api/activation/:order_id/reserve`, `DELETE /api/activation/:order_id/unreserve` | `Api::V12::ActivationController#numbers/reserve/unreserve` | `Optiva::Numbers`/`Optiva::Crm` (vanity search + `NumbersPageKey`), `NumberManager.new_from_identifier` | Optiva BSS | `numbers`, `vanities`, `onboarding_orders` | — |
| 8 | Cancel order | `POST /api/activation/:order_id/cancel` | `Api::V12::ActivationController#cancel` | unreserve + status update | Optiva | `onboarding_orders` (`status: cancelled_aged/abandoned`) | — |
| 9 | Activate | `POST /api/activation` (v12) | `Api::V12::ActivationController#create` | `ActivationManager`; handles `Optiva::SematiError::MobileAlreadyExists` (726); indirect ⇒ `SelfActivationManager#process_commission` | Semati, Optiva | `onboarding_orders.activated=true`, `seller_deductions` | — |

---

## Journey: Visitor / tourist (Hajj) plans (app/POSA)
Visitor buys a visitor plan with a physical SIM handed over at immigration/POSA; Nafath v2 (visitor) or Absher visa-type identity; number auto-reserved; no delivery, no separate payment step for the SIM handover variants.

| # | Step | Endpoint | Controller#action | Services/Lib | Integrations | DB tables | State transition |
|---|------|----------|-------------------|--------------|--------------|-----------|------------------|
| 1 | Create visitor order | `POST /api/onboarding/orders` (v5, `visitor_hajj_flow` param) | `Api::V5::Onboarding::OrdersController#create` | `flow_type_visitor_hajj_flow!`, `VisitorHajjFlow.apply_visa_type_to_order!` (`SematiAbsherUserType`) | — | `onboarding_orders`, `semati_absher_user_types` | `plan_selection` |
| 2 | Select visitor plan | `POST /api/onboarding/orders/:order_id/plans` | `Onboarding::PlansController#create` | `save_plan` (forces `SIM_TYPE_NORMAL`, re-applies visa type) | — | `onboarding_orders`, `plans` | → `sim_type_selection`+ |
| 3 | Scan SIM + auto number | `POST /api/onboarding/orders/:id/visitor_hajj_iccid` | `Api::V5::Onboarding::OrdersController#visitor_hajj_iccid` | `VisitorHajjFlow.iccid_and_reserve!`: `bss_card_package_available?` (`Optiva::Activation#get_card_package`), `iccid_in_visitor_hajj_inventory?` (`SimUpload::INVENTORY_VENDOR_VISITOR_HAJJ`), `auto_reserve_first_number` (`Optiva::Numbers`) | Optiva BSS | `onboarding_orders`, `raw_sims`, `sim_uploads`, `numbers` | → `number_selection`/`eligibility_check` |
| 4 | Eligibility (visitor visa) | `POST /api/onboarding/orders/:order_id/eligibility/is_eligible` (visa_type; BSS call skipped for visitor) | `Onboarding::EligibilityController#is_eligible` | `save_eligibility(visa_type_id, visa_number)` | — | `onboarding_orders` | → `account_details` |
| 5 | Customer info (email OTP) | `POST /api/onboarding/orders/:id/customer_info` | `Api::V5::Onboarding::OrdersController#customer_info` | visitor OTP delivered via **email** (`otp_type`); `account_password_guard` bypassed for visitor | Email | `onboarding_orders`, `otp_verifications` | → `account_verification` → `delivery_details` |
| 6 | Nafath v2 / Absher | `POST /api/semati/authorize` (`use_v2`, `nationality_iso3`) → check | `Api::SematiController` | `IamNew` v2 (visitor journey person_id) | Nafath v2 | `nafath_logs` | — |
| 7 | Pay + complete | `POST /api/payment/initiate` → commit worker (no delivery request — SIM already with user) | `PaymentController`, `Payment::CommitWorker` | `PaymentManager` | Gateway | `payments`, `onboarding_orders.completed=true` | `payment` |
| 8 | Activate | v5 activation with the immigration ICCID | `Api::V5::ActivationController` | `ActivationManager` (visitor semati config) | Semati, Optiva | `activated=true` | — |

Supporting lookups: `GET /api/eligibility/visa_types`, `GET /api/lookup/countries/:region` (visitor pricing via `country_pricings`, `country_visitor_operators`).

---

## Journey: Ownership transfer (app)
Current owner initiates a transfer of a line (checkout `OWNERSHIP_TRANSFER=5`); recipient accepts by OTP, builds an onboarding order (`flow_type_ownership_transfer`), pays outstanding dues and re-activates the line under their own ID via Nafath (`transfer_ownership_local/global` service).

| # | Step | Endpoint | Controller#action | Services/Lib | Integrations | DB tables | State transition |
|---|------|----------|-------------------|--------------|--------------|-----------|------------------|
| 1 | Sender creates checkout | `POST /api/checkout` (`checkout_type=5`) | `Api::V1::CheckoutController#create/create_for_ownership_transfer` | `OwnershipTransferManager.check_vanity`, duplicate-request checks, `pre_send` | — | `checkouts` (extra `ownership_transfer_state=initiated`) | `product_selection` → `contact_details` |
| 2 | Recipient contact + OTP | `POST /api/checkout/:id/customer_info` (TCC ownership check of recipient number in prod) → `POST /api/checkout/:id/customer_info_otp` | `CheckoutController#customer_info/customer_info_otp` | `Otp` (msg_type `transfer_new_user`), `check_tcc_mobile_verify` | TCC, SMS | `checkouts`, `otps` | `update_state` → `delivery_details` |
| 3 | Submit request | `POST /api/checkout/:id/submit` | `CheckoutController#submit` | `Checkout#complete!` → `OwnershipTransferManager.post_send` (SMS invite to recipient, state `sent`, reminder `Notifier::OwnershipTransferReminderWorker`) | SMS | `checkouts` (`completed`, state `sent`) | — |
| 4 | Recipient verifies | `POST /api/ownership_transfer/verify` (unauthenticated) → `POST /api/ownership_transfer/:id/verify_otp` | `Api::V1::OwnershipTransferController#verify/verify_otp` | expiry check (`Setting.ownership_transfer_validity`), `Otp` | SMS | `otps`, `checkouts` (state `accepted`) | — |
| 5 | Recipient builds order | `POST /api/onboarding/orders` (v5, `order_id=<checkout id>`) | `Api::V5::Onboarding::OrdersController#create` | `OwnershipTransferManager.prepare_order` + `pre_acceptance` (`OwnershipTransferPre` worker suspends old owner) | Optiva BSS | `onboarding_orders` (`flow_type_ownership_transfer`) | wizard states replayed |
| 6 | Eligibility/Nafath/plan | standard steps with service `transfer_ownership_local/global` | onboarding + semati controllers | — | Nafath, Optiva | `onboarding_orders`, `nafath_logs` | … → `payment` |
| 7 | Pay dues | `POST /api/payment/initiate` (`object_type=OnboardingOrder`; number-expiry check skipped for OT) | `PaymentController#initiate/handle_onboarding` | `PaymentManager#create_for_onboarding` | Gateway | `payments` | — |
| 8 | Commit | async `Payment::CommitWorker` | — | `OwnershipTransferManager.post_acceptance` (old-owner termination sequence via `OwnershipTransferPost` worker; no re-reserve) | Optiva BSS | `onboarding_orders.completed=true`, `checkouts` (state `completed`) | — |
| 9 | Re-activate under new owner | v12 activation | `Api::V12::ActivationController#create` → `ActivationManager#normal_activation` (OT branch: `add_update_supplementary_ownership_transfer`) | Semati, Optiva | `onboarding_orders.activated=true` | — |

Non-AASM state string on checkout extra: `initiated → sent → accepted → completed` (or `expired` / `deleted`).

---

## Journey: Plan change (app)
Upgrade/downgrade or prepaid↔postpaid switch. v2 is the main flow (OTP-gated); v8 adds `PlanRuleMap` variants; payment (if due) goes through a `CHANGE_PLAN_TYPE (2)` checkout, and the actual BSS switch runs in `ChangePlanWorker`.

| # | Step | Endpoint | Controller#action | Services/Lib | Integrations | DB tables | State transition |
|---|------|----------|-------------------|--------------|--------------|-----------|------------------|
| 1 | Eligible plans | `GET /api/change_plan/plans/prepaid`, `GET /api/change_plan/plans/postpaid` (v2) | `Api::V2::ChangePlanController#prepaid_plans/postpaid_plans` | `ChangePlanEligibility`, bundle/sim-type filters | — | `plans`, `change_plan_eligibilities` | — |
| 2 | Switch eligibility | `GET /api/change_plan/eligibility` (alias `GET /api/users/check_plan_switching_eligibility`) | `Api::V2::ChangePlanController#check_plan_switching_eligibility` | `Optiva::Activation#eligibility` (CITC) | Optiva/Semati | — | — |
| 3 | Nafath (pre↔post only) | `POST /api/change_plan/iam` (alias `POST /api/users/change_plan_iam`) then semati authorize/check | `Api::V2::ChangePlanController#change_plan_iam` + `Api::SematiController` | `IamNew` (service `change_plan`); token cached as `{mobile}_iam_token_response` | Nafath | `nafath_logs` | — |
| 4 | Request change + OTP | `PATCH /api/change_plan/otp` (alias `PATCH /api/users/change_plan`; v8 override) | `Api::V2(V8)::ChangePlanController#change_plan` | `ChangePlanManager.calculate_change_plan_amount` (`Optiva::Crm#change_plan_due_amount`), `create_or_update_checkout_for_change_on_plan`, `Otp` (msg_type `change_plan`) | Optiva CRM, SMS | `checkouts` (type 2), `otps` | checkout `product_selection` |
| 5 | Verify OTP | `POST /api/change_plan/verify_otp` (alias `POST /api/users/change_plan_otp`; v8 override) | `Api::V2(V8)::ChangePlanController#change_plan_otp` | `Otp#verify!`, Optiva state must be ACTIVATED | Optiva BSS | `otps`, `checkouts` | — |
| 6a | Zero-payment path | `POST /api/change_plan/process_postpaid` (alias `POST /api/users/change_plan_post`) | `Api::V2::ChangePlanController#change_plan_post` | `ChangePlanManager#switch!` synchronously | Optiva | `checkouts`, `change_plan_logs` | checkout completed |
| 6b | Payment path | `POST /api/payment/initiate` (`object_type=change_plan`, requires cached IAM token for pre↔post) → callback/commit | `PaymentController#handle_change_plan` | `PaymentManager#create_for_change_on_plan` | Gateway | `payments` | — |
| 7 | BSS switch | async `ChangePlanWorker` (from `Payment::CommitWorker`, checkout `complete!` first) | — | `ChangePlanManager#switch!`: `Optiva::Activation#add_update_supplementary_change_plan`, `store_csa`+`send_attachment` (pre↔post), `Optiva::Account#convert_billing_type` (+ data-SIM deactivate/convert), `Optiva::Transaction` (subscription/account transactions) | Optiva BSS, Semati docs | `change_plan_logs`, `checkouts`, `users` (`require_data_sim`) | checkout `paid/completed` |

Legacy: `PATCH /api/users/change_plan` etc. (v2 aliases) and v8 header `X-Protocol-Version: v8+`.

---

## Journey: Balance transfer (app)
Two mechanisms: (a) prepaid **credit transfer** to another Salam prepaid number with fees + BSS digital limits; (b) `users#transfer_balance` bundle/balance transfer between own numbers.

| # | Step | Endpoint | Controller#action | Services/Lib | Integrations | DB tables | State transition |
|---|------|----------|-------------------|--------------|--------------|-----------|------------------|
| 1 | Eligibility/denominations | `GET /api/users/profile/denominations_eligibility` | `Api::V1::ProfilesController#denominations_eligibility` | `Optiva::Balance#digital_transfer_limit`, `Setting.credit_transfer_fees` | Optiva BSS | `credit_denominations` | — |
| 2 | Target eligibility | `GET /api/numbers/credit_transfer_eligibility` | `Api::V1::NumbersController#credit_transfer_eligibility` | `Optiva::Subscription` | Optiva | — | — |
| 3 | Initiate + OTP | `PATCH /api/users/profile/credit_transfer` | `Api::V1::ProfilesController#credit_transfer` | recipient profile check (`get_subscription_profile`), limits, `Otp` (msg_type `credit_transfer`) | Optiva, SMS | `otps` | — |
| 4 | Confirm + execute | `POST /api/users/profile/credit_transfer_otp` | `Api::V1::ProfilesController#credit_transfer_otp` | re-check limits; `Optiva::Transaction` DEBIT amount+fee on sender, CREDIT on recipient (compensating CREDITs on failure); `Notifier::SmsWorker` both parties | Optiva BSS, SMS | `balance_transfer_logs`, `otps` | — |
| 5 | Own-numbers transfer check | `GET /api/users/check_transfer_balance` | `Api::V1::UsersController#check_transfer_balance` | `Optiva::Balance#transfer_list` | Optiva | — | — |
| 6 | Own-numbers transfer | `POST /api/users/transfer_balance` | `Api::V1::UsersController#transfer_balance` | `Optiva::Balance#transfer(from, to, balance, bundle_id)`, `Notifier::SmsWorker` | Optiva BSS | `balance_transfer_logs` | — |

---

## Journey: Voucher recharge (app/web, incl. anonymous)
Scratch-card / voucher PIN recharge; also exposed to anonymous users pre-login.

| # | Step | Endpoint | Controller#action | Services/Lib | Integrations | DB tables | State transition |
|---|------|----------|-------------------|--------------|--------------|-----------|------------------|
| 1 | Validate target | `GET /api/recharge/validate_details` / `GET /api/recharge/validate_details_with_account` (deactivated postpaid via account id) | `Api::V1::RechargeController#validate_details/validate_details_with_account` | `AccountManager`, `TotalBillManager` | Optiva BSS | — | — |
| 2 | Redeem voucher | `POST /api/recharge/voucher` (user/guest) / `POST /api/recharge/anonymous_voucher` (anonymous) | `Api::V1::RechargeController#voucher` | `Optiva::Transaction` voucher redemption, `Util.cache_clean` | Optiva BSS | — | — |
| 3 | Card recharge (denomination) | `POST /api/payment/initiate` (`object_type=recharge`, `object_id=denomination_id`, `mobile_number`) → gateway → callback → `Payment::CommitWorker` | `PaymentController#handle_recharge` | `PaymentManager#create_for_recharge`; worker: `Optiva::Transaction#create_subscription_transaction` (method 5, adj 32602) | Gateway, Optiva | `payments`, `recharge_options` | — |

---

## Journey: Dynamic recharge (app)
Prepaid customer tops up an arbitrary amount (min/max from settings) via card payment.

| # | Step | Endpoint | Controller#action | Services/Lib | Integrations | DB tables | State transition |
|---|------|----------|-------------------|--------------|--------------|-----------|------------------|
| 1 | Get bounds/plan info | `GET /api/dynamic_recharge/details` (postpaid rejected) | `Api::V1::DynamicRechargesController#details` | `Setting.minimum/maximum_dynamic_recharge_amount`, `Customer` remaining days | Optiva (customer cache) | `settings` | — |
| 2 | Quote VAT | `POST /api/dynamic_recharge/recharge` | `Api::V1::DynamicRechargesController#recharge` | `Price` (VAT calc) | — | — | — |
| 3 | Pay | `POST /api/payment/initiate` (`object_type=dynamic_recharge`) → callback → `Payment::CommitWorker` (`extra_recharge_type=dynamic_recharge`: VAT stripped, `create_subscription_transaction`) | `PaymentController#handle_dynamic_recharge` | `PaymentManager#create_for_recharge` | Gateway, Optiva | `payments` | — |

---

## Journey: Bill payment (postpaid) (app/web)
View bills, download PDF, pay the outstanding account balance (full or partial, logged-in or anonymous), or receive a Hyperbill payment link.

| # | Step | Endpoint | Controller#action | Services/Lib | Integrations | DB tables | State transition |
|---|------|----------|-------------------|--------------|--------------|-----------|------------------|
| 1 | Current bill | `GET /api/users/current_bill` | `Api::V1::UsersController#current_bill` | `Optiva::Account#query_bill` | Optiva BSS | — | — |
| 2 | Bill list | `GET /api/bill/list` | `Api::V1::BillsController#list` | `Optiva::Bills` | Optiva | — | — |
| 3 | Bill PDF | `GET /api/bill/generate_pdf` | `Api::V1::BillsController#generate_pdf` | `Optiva::Bills#get_bill_pdf` | Optiva | — | — |
| 4 | Pay (logged in) | `POST /api/payment/initiate` (`object_type=bill`) → callback → `Payment::CommitWorker` (`Optiva::Transaction#account_transaction`, clears `optiva_bill_*` cache) | `PaymentController#handle_bill` | `PaymentManager#create_for_bill`, `TotalBillManager` | Gateway, Optiva | `payments` | — |
| 5 | Pay (anonymous, full/partial) | `POST /api/payment/initiate` (`object_type=anonymous_bill`, `partial_payment` flag, `account_id`/`mobile_number`) | `PaymentController#handle_anonymous_bill/handle_anonymous_partial_bill` | `TotalBillManager.new_from_account_id`, `PartialBillManager` | Gateway, Optiva | `payments` | — |
| 6 | Invoice-link payment | Hyperbill link (sent by seller/CS) → `POST|GET /hyperbill/callback`, `POST|GET /merchalink/callback` | `CallbacksController#hyperbill/merchalink` | `HyperbillResponse`, `PaymentManager#create_for_invoice` | Hyperbill/Merchalink | `payments`, `invoices` | — |

---

## Journey: Advanced postpaid payment (app)
Postpaid customer pays ahead of the bill cycle (credit on account), optionally via an `ADVANCED_POSTPAID_PAYMENT_TYPE (7)` checkout.

| # | Step | Endpoint | Controller#action | Services/Lib | Integrations | DB tables | State transition |
|---|------|----------|-------------------|--------------|--------------|-----------|------------------|
| 1 | Create checkout | `POST /api/checkout` (`checkout_type=7`) | `Api::V1::CheckoutController#create_for_advanced_postpaid_payment` | `Checkout.create_or_update_for_advanced_postpaid_payment` (fills contact from `Current.customer`) | — | `checkouts` | `product_selection` → `delivery_details` (contact set) |
| 2 | Pay | `POST /api/payment/initiate` (`object_type=advanced_postpaid_payment`) → callback | `PaymentController#handle_advanced_postpaid_payment` | `PaymentManager#create_for_advanced_postpaid_payment` | Gateway | `payments` | — |
| 3 | Post to account | async `Payment::CommitWorker` | — | `Optiva::Transaction#account_transaction` (amount w/o VAT), `Util.cache_clean` | Optiva BSS | `payments` | — |

---

## Journey: Renewal (app) & external renewal (web link)
Manual renewal of the current prepaid plan — from balance (`renewal_transaction`) or by card via a `RENEWAL_TYPE (6)` checkout. External variant is driven by a checkout id from a notification link (no login).

| # | Step | Endpoint | Controller#action | Services/Lib | Integrations | DB tables | State transition |
|---|------|----------|-------------------|--------------|--------------|-----------|------------------|
| 1 | Get renewal checkout | `GET /api/renewal/checkout` (user/guest; validates plan + balance) | `Api::V1::RenewalsController#checkout` | `create_or_update_checkout_for_renewal` | Optiva (balance) | `checkouts` (type 6) | `product_selection` → `delivery_details` |
| 2 | Request renewal + OTP | `PATCH /api/renewal/renew` | `RenewalsController#renew` | `Otp` (msg_type `renewal`) | SMS | `otps` | — |
| 3 | Confirm — balance path | `POST /api/renewal/renew_otp` (`pay_with=balance`) | `RenewalsController#renew_otp` | `Optiva::Transaction#renewal_transaction` | Optiva BSS | `checkouts.completed` | — |
| 4 | Confirm — card path | `POST /api/payment/initiate` (`object_type=renewal`) → callback → `Payment::CommitWorker` (`create_subscription_transaction` + `renewal_transaction`) | `PaymentController#handle_renewal` | `PaymentManager#create_for_renewal` | Gateway, Optiva | `payments`, `checkouts` | checkout `complete!` |
| 5 | External: fetch | `GET /api/external_renewal/checkout` (unauthenticated, checkout id token) | `Api::V1::ExternalRenewalsController#checkout` | `AccountManager`, subscription-status check | Optiva | `checkouts` | — |
| 6 | External: renew + OTP | `PATCH /api/external_renewal/renew` → `POST /api/external_renewal/renew_otp` | `ExternalRenewalsController#renew/renew_otp` | `Otp` (msg_type `renewal`) | SMS | `otps` | — |
| 7 | External: choose method | `POST /api/external_renewal/update_pay_with` (validates balance) / `POST /api/external_renewal/deduct_from_balance` (`renewal_transaction`) or card via payment initiate | `ExternalRenewalsController#update_pay_with/deduct_from_balance` | `Optiva::Transaction` | Optiva BSS | `checkouts` | — |

---

## Journey: SIM replacement (app/web)
Lost/damaged SIM or physical↔eSIM swap. Double authentication (password / email OTP / SMS OTP / Nafath re-auth), `REPLACEMENT_TYPE (3)` checkout, fee payment, then `SimReplacementManager` swaps the ICCID in BSS. v8 tightens `validate_user_details`.

| # | Step | Endpoint | Controller#action | Services/Lib | Integrations | DB tables | State transition |
|---|------|----------|-------------------|--------------|--------------|-----------|------------------|
| 1 | Validate number | `GET /api/sim_replacement/validate_mobile_number` | `Api::V1::SimReplacementController#validate_mobile_number` | `Optiva::Subscription#get_subscription_profile` | Optiva BSS | — | — |
| 2 | Deactivated line path | `GET /api/sim_replacement/activate_mobile_number` | `#activate_mobile_number` | account state checks | Optiva | — | — |
| 3 | Validate identity | `GET /api/sim_replacement/validate_user_details` (v1; v8 override) | `Api::V1(V8)::SimReplacementController#validate_user_details` | ID/DOB match vs Optiva profile; creates replacement checkout (`create_checkout_for_replacement`) | Optiva | `checkouts` (type 3) | `product_selection` |
| 4 | Contact OTP | `POST /api/sim_replacement/contact_number_otp` | `#contact_number_otp` | `Otp` (msg_type `sim_replacement`) | SMS | `otps` | — |
| 5 | Password check | `GET /api/sim_replacement/validate_password` | `#validate_password` | `User#authenticate` | — | `users` | — |
| 6 | Double-auth options | `GET /api/sim_replacement/:id/double_auth_list` → `PATCH /api/sim_replacement/:id/double_auth` → `POST /api/sim_replacement/:id/double_auth_otp` | `#double_auth_list/double_auth/double_auth_otp` | `Otp` via SMS or `Otp::DELIVERY_EMAIL`; Nafath re-auth path via `authorize_active_user` | SMS/Email/Nafath | `otps`, `checkouts` | `update_state` → `delivery_details`/`payment` (esim skips delivery data) |
| 7 | Pay fee | `POST /api/payment/initiate` (`object_type=sim_replacement`) → callback | `PaymentController#handle_sim_replacement` | `PaymentManager#create_for_sim_replacement` | Gateway | `payments` | — |
| 8 | Deliver new SIM | async `Payment::CommitWorker`: `checkout.complete_payment!`; physical+non-pickup ⇒ `DeliveryManager.create_from_replacement_checkout` | — | Delivery vendor | `delivery_requests`, `checkouts.paid=true` | — |
| 9 | Activate replacement | `POST /api/sim_replacement/:id/activate` (new ICCID or auto eSIM) | `#activate` | `SimReplacementManager#proceed` (IAM token + `Optiva::Activation` card swap; eSIM ⇒ `Optiva::Esim#reserve_esim` + QR) | Optiva BSS, Semati/Nafath | `checkouts.completed`, `raw_sims` | — |

Note: `resources :sim_replacement` also exposes bare CRUD (`GET/POST /api/sim_replacement` etc.) but the actions above are the used surface. v8 route `GET /api/sim_replacement/validate_user_details` is selected by `X-Protocol-Version: v8+`.

---

## Journey: Cancellation / termination + refund (app)
Terminate a line: refund flow for recently-paid orders, or full account termination with settlement of balance/deposit, then BSS deactivation.

| # | Step | Endpoint | Controller#action | Services/Lib | Integrations | DB tables | State transition |
|---|------|----------|-------------------|--------------|--------------|-----------|------------------|
| 1 | Summary screens | `GET /api/users/profile/plan_summary`, `GET /api/users/profile/balance_summary` | `Api::V1::ProfilesController#plan_summary/balance_summary` | `Optiva::Numbers#get_number`, `AccountManager` | Optiva BSS | — | — |
| 2 | Init termination | `GET /api/users/profile/terminate_number_init` | `#terminate_number_init` | `ProfileManager.new_from_customer` (payable amount / refundable balance & deposit) | Optiva | — | — |
| 3 | Request + OTP | `PATCH /api/users/profile/terminate_number` → `POST /api/users/profile/terminate_number_otp` | `#terminate_number/terminate_number_otp` | `Otp` (msg_type `line_deactivation`); OTP ref cached `tm_mobile_number_{msisdn}` | SMS | `otps` | — |
| 4 | Settle dues (postpaid) | `POST /api/payment/initiate` (`object_type=termination`, amount = balance+deposit) → callback → `Payment::CommitWorker` (`account_transaction`) | `PaymentController#handle_termination` | `PaymentManager#create_for_termination` | Gateway, Optiva | `payments` | — |
| 5 | Execute termination | `POST /api/users/profile/terminate_number_process` | `#terminate_number_process` | `ProfileManager#terminate_mobile_number` (BSS state transition, Semati release) | Optiva BSS, Semati | `termination_logs`, `users` | — |
| 6 | Delete selfcare profile | `DELETE /api/users/profile/cancel_profile` | `#cancel_profile` | soft-delete | — | `deleted_users`, `users` | — |
| 7 | Refund (order/payment) | admin/Apollo initiated: `Refund.create_refund(payment)` (Apollo partners: `POST /api/apollo/checkout/refund`) | `Api::ApolloCheckoutController#refund`, ActiveAdmin | `Payment::RefundWorker#send_refund`, gateway refund API, `send_zatca_credit_note`, number unreserve (`post_handle_status` on `refunded`) | Gateway, ZATCA, Optiva | `refunds`, `refund_reasons`, `payments`, `installment_refunds` | order status → `refunded` (Statusable), number unreserved |

---

## Journey: Saleor e-commerce — devices & accessories (app/web)
Device shop backed by Saleor GraphQL. Backend wraps Saleor checkout in a `SALEOR_TYPE (4)` `Checkout`, adds Salam auth, payment, installments (EMKAN/Tamara/Tasheel), delivery and ZATCA.

| # | Step | Endpoint | Controller#action | Services/Lib | Integrations | DB tables | State transition |
|---|------|----------|-------------------|--------------|--------------|-----------|------------------|
| 1 | Shop login | `POST /api/saleor/login` → `POST /api/saleor/verify` (OTP) | `Api::V1::SaleorController#login/verify` | Optiva profile check; issues user/guest token (`login_as_guest`/`login_as_anonymous`) | Optiva BSS, SMS | `guests`/`users`, `otps` | — |
| 2 | Saleor user info | `GET /api/saleor/sc_user` | `SaleorController#sc_user` | customer → Saleor account mapping | Saleor GraphQL | — | — |
| 3 | Create checkout | `POST /api/checkout` (`checkout_type=4`) | `Api::V1::CheckoutController#create_for_saleor` | — | — | `checkouts` | `product_selection` |
| 4 | Attach Saleor cart | `POST /api/checkout/:id/saleor` (v1; **v9 override** with newer Saleor middleware payloads), test: `POST /api/checkout/simulate_saleor_sdk` | `Api::V1(V9)::CheckoutController#saleor` | `Saleor::Middleware#checkout/order` (GraphQL query of cart/order, prices, SKU into `checkouts.extra`) | Saleor GraphQL | `checkouts` (items, sku, invoice fields) | `update_state` |
| 5 | Contact info | `POST /api/checkout/:id/customer_info` (+ `customer_info_otp`) | `CheckoutController#customer_info/customer_info_otp` | `Otp` | SMS | `checkouts`, `otps` | → `contact_details`/`delivery_details` |
| 6 | Delivery address | `POST /api/checkout/:id/delivery_info` | `CheckoutController#delivery_info` | `Deliverable` concern | — | `checkouts` | → `payment` |
| 7 | Installments (optional) | `POST /api/emkan/vouchers/validate_voucher` → `pre_redeem` → `redeem`; Tamara handled inside payment vendor | `Api::V1::Emkan::VouchersController` | `Emkan` service, `Saleor::InstallmentWorker` | EMKAN financing, Tamara | `installments`, `installment_vendors`, `installment_refunds`, `checkouts.extra` (payment_plan=INSTALLMENT) | — |
| 8 | Pay | `POST /api/payment/initiate` (`object_type=saleor`) → gateway/`/payment/:vendor/callback` → commit; status: `GET /api/saleor/payment_status/:checkout_id`, `GET /api/saleor/active_checkouts` | `PaymentController#handle_saleor`, `SaleorController#payment_status/active_checkouts` | `PaymentManager#create_for_saleor`; Tamara authorize on pending callback | HyperPay/Tamara/Tap/STC Pay | `payments`, `checkouts` | — |
| 9 | Fulfil | async `Payment::CommitWorker`: `checkout.complete_payment!` + `DeliveryManager.create_from_saleor_checkout` (also `Delivery::SaleorWorker`); stock sync `SaleorStockProcessor` | — | Delivery vendors, Saleor (order fulfil) | `delivery_requests`, `checkouts` | — |
| 10 | Submit fallback / ZATCA | `POST /api/checkout/:id/submit` (creates delivery req if needed); ZATCA invoice via workers; `DELETE /api/checkout/:id/remove`, `GET /api/checkout/:id/get`, `GET /api/checkout/current` | `CheckoutController#submit/remove/get/current` | `ZatcaTransactionWorker` | ZATCA | `checkouts`, `invoices` | `complete!` |

---

## Journey: DataSIM — secondary data SIM (app)
Companion data SIM for an existing customer (also orderable inside onboarding via `require_data_sim`). v1 = direct activate; v5 = OTP-gated with IAM.

| # | Step | Endpoint | Controller#action | Services/Lib | Integrations | DB tables | State transition |
|---|------|----------|-------------------|--------------|--------------|-----------|------------------|
| 1 | Eligibility | `GET /api/datasims/is_eligible` | `Api::V1::DatasimsController#is_eligible` | plan `has_data_sim`, `require_data_sim` flags | — | `users`, `plans` | — |
| 2 | (v5) OTP | `GET /api/datasims/activate_otp` → `POST /api/datasims/activate_otp_verify` | `Api::V5::DatasimsController#activate_otp/activate_otp_verify` | `Otp` | SMS | `otps` | — |
| 3 | Activate | `POST /api/datasims/activate` (v1 or v5) | `Api::V1(V5)::DatasimsController#activate` | `Optiva::Activation#get_card_package`, `Optiva::Numbers` data number, `Optiva::Responses::SematiPerson` from parent line, subscriber creation | Optiva BSS, Semati data | `users` (`require_data_sim`), `raw_sims` | — |
| 4 | Delivery variant | `Checkout.create_for_data_sim_delivery` (`DATA_SIM_TYPE (1)` checkout) → `POST /api/checkout/:id/delivery_info` → submit | `Api::V1::CheckoutController` | `DeliveryManager.create_from_checkout`; `complete!` sets `checkoutable.require_data_sim=true` | Delivery vendor | `checkouts`, `delivery_requests` | `product_selection→delivery_details→payment` |

---

## Journey: Apollo / Tygo partner channel (partner API, API-key)
Aggregator partners (Tygo et al.) resell Salam lines. Mounted at `/api/apollo/*` (legacy alias `/api/tygo/*`), API-key auth via `AppsController` + `validate_apollo_access!`. Partner collects payment; backend records it via `confirm` and refunds via gateway.

| # | Step | Endpoint | Controller#action | Services/Lib | Integrations | DB tables | State transition |
|---|------|----------|-------------------|--------------|--------------|-----------|------------------|
| 1 | Plans | `GET /api/apollo/plans`, `/plans/prepaid`, `/plans/postpaid`, `/plans/:id` | `Api::V1::Apollo::PlansController` (concern `Api::PlansController`) | — | — | `plans` | — |
| 2 | Numbers | `GET /api/apollo/numbers`, `GET /api/apollo/numbers/vanities`, `POST /api/apollo/numbers/reserve`, `DELETE /api/apollo/numbers/unreserve` | `Api::V1::Apollo::NumbersController` | `NumberManager`, `Optiva::Numbers` | Optiva BSS | `numbers`, `vanities` | — |
| 3 | Eligibility | `POST /api/apollo/eligibility` | `Api::V1::Apollo::EligibilityController#create` | `Optiva::Activation#eligibility` | Optiva/CITC | `eligibility_logs` | — |
| 4 | Nafath | `POST /api/apollo/semati/authorize` → `GET /api/apollo/semati/check` | `Api::V1::Apollo::SematiController` | `IamNew` | Nafath | `nafath_logs` | — |
| 5 | Create order | `POST /api/apollo/checkout` | `Api::ApolloCheckoutController#create` | `ApolloOrderManager#save` (builds `flow_type_apollo` OnboardingOrder through all wizard saves), `create_otp` | SMS (partner OTP engine) | `onboarding_orders`, `otps` | wizard states → `payment` |
| 6 | OTP confirm/resend | `POST /api/apollo/checkout/otp_confirm`, `POST /api/apollo/checkout/otp_resend` | `#otp_confirm/#otp_resend` | `Otp#verify!` | — | `otps` | — |
| 7 | Confirm payment | `POST /api/apollo/checkout/confirm` (partner-collected payment record) | `#confirm` | `PaymentManager#create_for_apollo` (vendor `APOLLO_VENDOR`), `Payments::Apollo::Response`, `update_status` → `Payment::CommitWorker` (delivery skipped if `apollo_require_delivery=false`) | Apollo payment record, Optiva | `payments`, `onboarding_orders.completed` | order stays `payment`; completed |
| 8 | List/read orders | `GET /api/apollo/checkout`, `GET /api/apollo/checkout/:id` | `#index/#show` | — | — | `onboarding_orders` | — |
| 9 | Activation | `POST /api/apollo/activation` | `Api::V1::Apollo::ActivationController` (shared `Api::ActivationController` concern) | `ActivationManager` | Semati, Optiva | `onboarding_orders.activated` | — |
| 10 | eSIM handover | `GET /api/apollo/checkout/esim_details`, `GET /api/apollo/checkout/esim_qr` | `#esim_details/#esim_qr` | `Optiva::Subscription` → `Optiva::Numbers#esim_qr_code`, `Qr` | Optiva eSIM | — | — |
| 11 | Refund | `POST /api/apollo/checkout/refund` | `#refund` | `Refund.create_refund` → `Payment::RefundWorker` | Gateway refund, ZATCA credit note | `refunds`, `payments` | order → `refunded` |
| 12 | SMS relay | `POST /api/apollo/tcc/sms/send` | `Api::V1::Apollo::TccController#send_sms` | `Tcc` service | TCC SMS | — | — |

Sedco kiosk namespace: `POST /api/sedco/semati/authorize`, `GET /api/sedco/semati/check`, `GET /api/sedco/semati/token` → `Api::V1::Sedco::SematiController` (same `Api::SematiController` concern, API-key auth) — Nafath verification for kiosk-driven flows.

---

## Journey: Service (add-on/VAS bundle) activation & deactivation (app)
Boosters, roaming packs, data add-ons per plan; v11 adds OTP confirmation (incl. for data-SIM MSISDNs).

| # | Step | Endpoint | Controller#action | Services/Lib | Integrations | DB tables | State transition |
|---|------|----------|-------------------|--------------|--------------|-----------|------------------|
| 1 | Browse | `GET /api/services`, `GET /api/services/:service`, `GET /api/services/:service/promoted`, `GET /api/services/:service/:id`, groups: `GET /api/services/service_groups(/:id)` (also under `/api/lookup/…`) | `Api::V1::ServicesController#index/services/promoted/show/service_groups/service_group` | `ServiceManager` | Optiva BSS (subscribed state) | `services`, `service_groups`, `service_plans`, `service_group_pricings`, `plan_hidden_services` | — |
| 2 | Activate (v1) | `POST /api/services/:service/activate` or `GET /api/services/:service/:id/activate` | `Api::V1::ServicesController#activate` | balance check, `ServiceManager#activate` | Optiva provisioning | `service_logs` | — |
| 3 | Activate (v11, OTP) | `POST /api/services/:service/activate` returns OTP ref → `POST /api/services/:service/activate_otp` | `Api::V11::ServicesController#activate/activate_otp` | `Otp` (msg_type `activate_service`), `ServiceManager` | SMS, Optiva | `otps`, `service_logs` | — |
| 4 | Deactivate | `POST /api/services/:service/deactivate` (+ v11 `deactivate_otp`) | `V1/V11::ServicesController#deactivate/deactivate_otp` | `ServiceManager#deactivate` | Optiva | `service_logs` | — |
| 5 | Postpaid service recharge | `POST /api/payment/initiate` (`object_type=postpaid_service_recharge`, `object_id=service_id`) → `Payment::CommitWorker` (`create_subscription_transaction`, adj 50594) | `PaymentController#handle_postpaid_service_recharge` | `PaymentManager#create_for_postpaid_service_recharge` | Gateway, Optiva | `payments`, `services` | — |

VAS partner voucher: `POST /api/vas/redeem` → `Api::V1::VasController#redeem` (`AppsController` API-key; campaign redemption + `Notifier::SmsWorker`; tables `vas_campaigns`). Emkan vouchers: see Saleor journey.

---

## Journey: Payment backbone (all channels)
The shared machinery every paid journey rides on.

| # | Step | Endpoint | Controller#action | Services/Lib | Integrations | DB tables | State transition |
|---|------|----------|-------------------|--------------|--------------|-----------|------------------|
| 1 | Vendor discovery | `GET /api/payment/vendor`, `GET /api/payment/check` (installment options via `check_payment_options`) | `Api::V1::PaymentController#vendor/check` | `PaymentVendor.select_vendor` (per object type + platform) | — | `payment_vendors` | — |
| 2 | Initiate | `POST /api/payment/initiate` (`object_type` ∈ OnboardingOrder, Checkout, recharge, dynamic_recharge, bill, anonymous_bill, advanced_postpaid_payment, termination, change_plan, sim_replacement, postpaid_service_recharge, saleor, ownership_transfer, renewal) | `#initiate` + `handle_*` | `PaymentManager#create_for_*`, `#initiate_payment`, `validate_credit_card`, `validate_amount_limit` | HyperPay / STC Pay / Salam(Merchalink) / Tamara / Tap / Barq / TAM / Manarat | `payments` | payment `pending` |
| 3 | Gateway webhook | `POST /hyperpay/callback`, `POST /stcc/callback`, `POST /manarat/callback`, `POST /barq/callback`, `POST /tam/callback`, `POST|GET /merchalink/callback`, `POST|GET /hyperbill/callback`, generic `POST|GET /payment/:vendor/callback` | `CallbacksController#…` | `PaymentManager#parse_response/process_response`, `Payment#update_commit_response` | Gateways | `payments` | `pending → success/failed` |
| 4 | Client confirm/poll | `POST /api/payment/:id/commit` (unauthenticated), `GET /api/payment/:id/status`, `GET /api/payment/notify`, `POST /api/payment/:id/cancel` | `#commit/status/notify/cancel` | `AdjustManager#event('purchase')` on success | Adjust | `payments` | — |
| 5 | Fulfilment | async `Payment::CommitWorker` (per `payment_on_type`, see journeys above) | — | Optiva transactions, DeliveryManager, ChangePlanWorker, OwnershipTransferManager | Optiva, delivery | all | — |
| 6 | ZATCA | async `ZatcaTransactionWorker(::AfterBssWorker)`; QR: `GET /zatca/:invoice_number` | `ZatcaController#generate` | `ZatcaManager` (TLV/UBL, credit notes on refund) | ZATCA | `payments`, `invoices` | — |
| 7 | Refund | `Refund.create_refund` → `Payment::RefundWorker` → gateway refund API → `send_zatca_credit_note` | (admin / apollo#refund) | `PaymentManager#refund/refund_status` | Gateway, ZATCA | `refunds`, `payments` | payment → `refunded` |

---

## Journey: Support & misc flows
- **Remedy CRM OTP/login** (support portal, API-key): `POST /api/remedy/otp` → `POST /api/remedy/otp/confirm`; guest session: `POST /api/remedy/otp/login` → `POST /api/remedy/otp/verify` — `Api::V1::Remedy::OtpController` (`Otp`, `Optiva::Subscription`, guest JWT; tables `otps`, `guests`).
- **Profile management** (user): `PATCH /api/users/profile/email` + `POST …/email_otp`, `PATCH …/primary_number` + `primary_number_otp`, `PATCH …/alternative_number` + `alternative_number_otp`, `PATCH …/remove_primary_number`, `PATCH …/remove_alternative_number`, `GET …/avatars`, `GET …/generate_temp_token` — `Api::V1::ProfilesController` (tables `users`, `avatars`, `otps`).
- **Spam/number lock (Semati re-auth)**: `GET/POST /api/users/spam`, `POST /api/users/spam_otp` — `Api::V1::UsersController#spam/spam_otp` (Optiva flags + `Otp`).
- **Notifications**: `POST /api/notifications/token` (`Api::V1::NotificationsController#token`, table `notification_tokens`, Firebase); `POST /api/notifications/emails` (`Api::V1::Notifications::EmailsController#create`, `Notifier::EmailWorker`, table `email_notifications`).
- **Manage SIMs / multi-line**: `GET /api/users/manage_sims`, `GET /api/users/my_mobile_numbers`, `GET /api/users/widget_details`, `GET /api/users/bundles` (v1/v2), `GET /api/users/plan_details` (v2) — `Api::V1(V2)::UsersController` (Optiva `Balance/Subscription`).
- **Wordpress bridge**: `GET /api/wordpress/get_msisdn` — `Api::V1::WordpressController` (MSISDN for web store).
- **Geofence delivery hours**: `GET /api/geofences/delivery_hours` — `Api::V1::GeofencesController` (table `geofences`).
- **Client logs / diagnostics**: `POST /api/client_logs` — `Api::V1::ClientLogsController#create` (`ClientErrorLogService`).
- **Number checks**: `GET /api/numbers/verify_salam_number/:id` — verify a MSISDN belongs to Salam.

Journeys **not present** in this codebase (verified): no standalone "web store WooCommerce" flow (commented out), no v4/v10 controllers with routes (v10 scope is empty; `app/controllers/api/v4` exists but has no routed actions), and Tygo routes are pure aliases of Apollo.

---

## Route inventory

All paths verbatim from `config/routes.rb` (+ `config/routes/apollo.rb` drawn under `/api/apollo` and `/api/tygo`; `config/routes/sedco.rb` under `/api/sedco`). Version scopes share the same paths — the handling controller version is chosen by the `X-Protocol-Version` header (`>=` match, most-specific scope first, `v1` default).

### Root (no namespace)
| Verb | Path | Controller#action |
|------|------|-------------------|
| — | `devise_for :admin_users` + `ActiveAdmin.routes` | ActiveAdmin back-office (`/admin/*`) |
| GET | `/api-doc`, `/api-docs`, `/api-docs/`, `/api-docs/index.html` | `api_docs#index` (`#not_found` in production) |
| — | mount `/sidekiq` | Sidekiq::Web (basic auth) |
| GET | `/eChannels/iam/callback` | `callbacks#iam` |
| POST | `/eChannels/iam/callback` | `callbacks#iam_new` |
| GET | `/eChannels/iam/simulator` | `callbacks#iam_simulator` |
| GET | `/eChannels/iam/callback_completed` | `callbacks#iam_completed` |
| GET | `/semati/login` | `callbacks#iam_login` |
| POST | `/stcc/callback` | `callbacks#stcc` |
| POST | `/hyperpay/callback` | `callbacks#hyperpay` |
| POST | `/manarat/callback` | `callbacks#manarat` |
| POST | `/barq/callback` | `callbacks#barq` |
| POST | `/tam/callback` | `callbacks#tam` |
| POST, GET | `/merchalink/callback` | `callbacks#merchalink` |
| POST, GET | `/hyperbill/callback` | `callbacks#hyperbill` |
| POST, GET | `/payment/:vendor/callback` | `callbacks#payment` |
| GET | `/zatca/:invoice_number` | `zatca#generate` |
| POST | `/delivery/:vendor/callback` | `callbacks#delivery` |

### api / v12 (`X-Protocol-Version ≥ v12`)
| Verb | Path | Controller#action |
|------|------|-------------------|
| POST | `/api/activation` | `api/v12/activation#create` |
| GET, POST | `/api/activation/orders` | `api/v12/activation#orders` |
| GET | `/api/activation/:order_id/numbers` | `api/v12/activation#numbers` |
| POST | `/api/activation/:order_id/reserve` | `api/v12/activation#reserve` |
| DELETE | `/api/activation/:order_id/unreserve` | `api/v12/activation#unreserve` |
| POST | `/api/activation/:order_id/cancel` | `api/v12/activation#cancel` |

### api / v11 (≥ v11)
| Verb | Path | Controller#action |
|------|------|-------------------|
| POST | `/api/services/:service/activate` | `api/v11/services#activate` |
| POST | `/api/services/:service/deactivate` | `api/v11/services#deactivate` |
| POST | `/api/services/:service/activate_otp` | `api/v11/services#activate_otp` |
| POST | `/api/services/:service/deactivate_otp` | `api/v11/services#deactivate_otp` |
| GET | `/api/services/:service/:id/activate` | `api/v11/services#activate` |
| GET | `/api/services/:service/:id/deactivate` | `api/v11/services#deactivate` |
| GET | `/api/services` | `api/v11/services#services` |

### api / v9 (≥ v9)
| Verb | Path | Controller#action |
|------|------|-------------------|
| POST | `/api/checkout/:id/saleor` | `api/v9/checkout#saleor` |

### api / v8 (≥ v8)
| Verb | Path | Controller#action |
|------|------|-------------------|
| PATCH | `/api/users/change_plan` | `api/v8/change_plan#change_plan` |
| POST | `/api/users/change_plan_otp` | `api/v8/change_plan#change_plan_otp` |
| PATCH | `/api/change_plan/otp` | `api/v8/change_plan#change_plan` |
| POST | `/api/change_plan/verify_otp` | `api/v8/change_plan#change_plan_otp` |
| GET | `/api/sim_replacement/validate_user_details` | `api/v8/sim_replacement#validate_user_details` |

### api / v7 (≥ v7)
| Verb | Path | Controller#action |
|------|------|-------------------|
| POST | `/api/users/sign_up_otp` | `api/v7/users/registration#otp` |
| GET | `/api/users/list_mobile_numbers` | `api/v7/users/registration#list_mobile_numbers` |

### api / v6 (≥ v6)
| Verb | Path | Controller#action |
|------|------|-------------------|
| GET | `/api/users/list_mobile_numbers` | `api/v6/users/registration#list_mobile_numbers` |

### api / v5 (≥ v5)
| Verb | Path | Controller#action |
|------|------|-------------------|
| POST | `/api/users/sign_up` | `api/v5/users/registration#create` (ApiGuard registration routes also drawn) |
| GET | `/api/users/check_email` | `api/v5/users/registration#check_email` |
| GET | `/api/datasims/activate_otp` | `api/v5/datasims#activate_otp` |
| POST | `/api/datasims/activate_otp_verify` | `api/v5/datasims#activate_otp_verify` |
| POST | `/api/datasims/activate` | `api/v5/datasims#activate` |
| POST | `/api/activation` | `api/v5/activation#create` |
| GET | `/api/activation/validate_iccid` | `api/v5/activation#validate_iccid` |
| POST | `/api/activation/validate_modem` | `api/v5/activation#validate_modem` |
| GET, POST | `/api/activation/orders` | `api/v5/activation#orders` |
| POST | `/api/activation/order` | `api/v5/activation#order` |
| POST | `/api/onboarding/orders` | `api/v5/onboarding/orders#create` |
| POST | `/api/onboarding/orders/:id/customer_info` | `api/v5/onboarding/orders#customer_info` |
| POST | `/api/onboarding/orders/:id/visitor_hajj_iccid` | `api/v5/onboarding/orders#visitor_hajj_iccid` |
| POST | `/api/onboarding/orders/:id/complete_qr_posa` | `api/v5/onboarding/orders#complete_qr_posa` |
| GET | `/api/onboarding/orders/:id/get` | `api/v5/onboarding/orders#get` |

### api / v3 (≥ v3)
| Verb | Path | Controller#action |
|------|------|-------------------|
| POST | `/api/onboarding/orders` | `api/v3/onboarding/orders#create` |
| POST | `/api/onboarding/orders/:order_id/plans` | `api/v3/onboarding/plans#create` |
| POST | `/api/onboarding/orders/:order_id/sim_type` | `api/v3/onboarding/sim_type#create` |

### api / v2 (≥ v2)
| Verb | Path | Controller#action |
|------|------|-------------------|
| GET | `/api/users/dashboard` | `api/v2/users#dashboard` |
| GET | `/api/users/dashboard_manage` | `api/v2/users#dashboard_manage` |
| GET | `/api/users/bundles` | `api/v2/users#bundles` |
| PATCH | `/api/users/change_plan` | `api/v2/change_plan#change_plan` |
| POST | `/api/users/change_plan_otp` | `api/v2/change_plan#change_plan_otp` |
| POST | `/api/users/change_plan_post` | `api/v2/change_plan#change_plan_post` |
| GET | `/api/users/check_plan_switching_eligibility` | `api/v2/change_plan#check_plan_switching_eligibility` |
| POST | `/api/users/change_plan_iam` | `api/v2/change_plan#change_plan_iam` |
| GET | `/api/users/plan_details` | `api/v2/users#plan_details` |
| POST | `/api/users/register_number_on_semati` | `api/v2/users#register_number_on_semati` |
| GET | `/api/change_plan/plans/prepaid` | `api/v2/change_plan#prepaid_plans` |
| GET | `/api/change_plan/plans/postpaid` | `api/v2/change_plan#postpaid_plans` |
| PATCH | `/api/change_plan/otp` | `api/v2/change_plan#change_plan` |
| POST | `/api/change_plan/verify_otp` | `api/v2/change_plan#change_plan_otp` |
| POST | `/api/change_plan/process_postpaid` | `api/v2/change_plan#change_plan_post` |
| GET | `/api/change_plan/eligibility` | `api/v2/change_plan#check_plan_switching_eligibility` |
| POST | `/api/change_plan/iam` | `api/v2/change_plan#change_plan_iam` |

### api / v1 (default)

**Auth (ApiGuard + custom)**
| Verb | Path | Controller#action |
|------|------|-------------------|
| POST | `/api/sellers/sign_in` | `api/v1/sellers/authentication#create` |
| POST | `/api/sellers/verify_otp` | `api/v1/sellers/authentication#verify_otp` |
| POST / DELETE | `/api/users/sign_in`, `/api/users/sign_out` | `api/v1/users/authentication#create/destroy` (ApiGuard) |
| POST / DELETE / PATCH | `/api/users/sign_up`, `/api/users/delete`, `/api/users/passwords` | `api/v1/users/registration#create/destroy`, `users/passwords#update` (ApiGuard) |
| POST | `/api/anonymous_users/sign_in` | `api/v1/anonymous_users/authentication#create` (ApiGuard) |
| POST | `/api/guests/sign_in` | `api/v1/guests/authentication#create` (ApiGuard) |
| POST | `/api/guests/verify` | `api/v1/guests/authentication#verify` |
| POST | `/api/auth/device` | `api/v1/anonymous_users/authentication#create` |
| POST | `/api/users/sign_up_otp` | `api/v1/users/registration#otp` |
| POST | `/api/users/sign_up_otp_verify` | `api/v1/users/registration#otp_verify` |
| POST | `/api/users/sign_up` | `api/v1/users/registration#create` |
| POST | `/api/users/passwords/forgot` | `api/v1/users/passwords#forgot` |
| POST | `/api/users/passwords/otp_verify` | `api/v1/users/passwords#otp_verify` |
| POST | `/api/users/passwords/reset` | `api/v1/users/passwords#reset` |
| POST | `/api/users/verify` | `api/v1/users/authentication#verify` |

**Catalog & lookups**
| Verb | Path | Controller#action |
|------|------|-------------------|
| GET | `/api/categories`, `/api/categories/:id` | `api/v1/categories#index/show` |
| GET | `/api/plans`, `/api/plans/:id` | `api/v1/plans#index/show` |
| GET | `/api/plans/prepaid`, `/api/plans/postpaid`, `/api/plans/categories`, `/api/plans/sort_options`, `/api/plans/filter_options`, `/api/plans/sort_filter_options` | `api/v1/plans#…` |
| GET | `/api/lookup/nationalities`, `/api/lookup/nationalities_and_id_types`, `/api/lookup/operators`, `/api/lookup/recharge_options`, `/api/lookup/home_delivery_areas`, `/api/lookup/home_delivery_areas/:area_id/cities`, `/api/lookup/home_delivery_cities`, `/api/lookup/app_config`, `/api/lookup/delivery_times`, `/api/lookup/esim_devices`, `/api/lookup/social_networks`, `/api/lookup/countries/:region`, `/api/lookup/credit_denominations` | `api/v1/lookup#…` (cities→`#cities`, home_delivery_cities→`#cities_all`) |
| GET | `/api/lookup/service_groups`, `/api/lookup/service_groups/:id` | `api/v1/services#service_groups/service_group` |
| GET | `/api/geofences/delivery_hours` | `api/v1/geofences#delivery_hours` |
| GET | `/api/stores/get_stores` | `api/v1/stores#get_stores` |
| GET | `/api/numbers`, `/api/numbers/vanities`, `/api/numbers/enhanced_numbers`, `/api/numbers/verify_salam_number/:id`, `/api/numbers/credit_transfer_eligibility` | `api/v1/numbers#index/vanities/enhanced_numbers/verify_salam_number/credit_transfer_eligibility` |
| GET/POST | `/api/eligibility`, `/api/eligibility/nationalities`, `/api/eligibility/is_eligible`, `/api/eligibility/visa_types` | `api/v1/eligibility#index/nationalities/is_eligible/visa_types` |

**Onboarding**
| Verb | Path | Controller#action |
|------|------|-------------------|
| POST | `/api/onboarding/orders` | `api/v1/onboarding/orders#create` |
| GET | `/api/onboarding/orders/current` | `api/v1/onboarding/orders#current` |
| GET | `/api/onboarding/orders/current_by_plan/:plan_id` | `api/v1/onboarding/orders#create_by_plan` |
| GET | `/api/onboarding/orders/qr/:id` | `api/v1/onboarding/orders#qr` |
| GET | `/api/onboarding/orders/esim_qr` | `api/v1/onboarding/orders#esim_qr` |
| POST | `/api/onboarding/orders/:id/reset` | `api/v1/onboarding/orders#reset` |
| POST | `/api/onboarding/orders/:id/customer_info` | `api/v1/onboarding/orders#customer_info` |
| POST | `/api/onboarding/orders/:id/delivery_info` | `api/v1/onboarding/orders#delivery_info` |
| POST | `/api/onboarding/orders/:id/complete_qr_posa` | `api/v1/onboarding/orders#complete_qr_posa` |
| POST | `/api/onboarding/orders/:id/adjust` | `api/v1/onboarding/orders#adjust` |
| POST | `/api/onboarding/orders/:order_id/profiles/customer_password` | `api/v1/onboarding/profiles#create` |
| POST | `/api/onboarding/orders/:order_id/profiles/customer_verify` | `api/v1/onboarding/profiles#customer_verify` |
| POST | `/api/onboarding/orders/:order_id/profiles/customer_change_password` | `api/v1/onboarding/profiles#customer_change_password` |
| POST | `/api/onboarding/orders/:order_id/profiles/forgot` | `api/v1/onboarding/profiles#forgot` |
| POST | `/api/onboarding/orders/:order_id/profiles/otp_verify` | `api/v1/onboarding/profiles#otp_verify` |
| POST | `/api/onboarding/orders/:order_id/profiles/reset` | `api/v1/onboarding/profiles#reset` |
| POST | `/api/onboarding/orders/:order_id/plans` | `api/v1/onboarding/plans#create` |
| POST | `/api/onboarding/orders/:order_id/numbers/order_type` | `api/v1/onboarding/numbers#order_type` |
| POST | `/api/onboarding/orders/:order_id/numbers/reserve` | `api/v1/onboarding/numbers#reserve` |
| DELETE | `/api/onboarding/orders/:order_id/numbers/unreserve` | `api/v1/onboarding/numbers#unreserve` |
| POST | `/api/onboarding/orders/:order_id/mnp` | `api/v1/onboarding/mnp#create` |
| POST | `/api/onboarding/orders/:order_id/eligibility/is_eligible` | `api/v1/onboarding/eligibility#is_eligible` |

**Activation & OTP**
| Verb | Path | Controller#action |
|------|------|-------------------|
| POST | `/api/activation` | `api/v1/activation#create` |
| GET, POST | `/api/activation/orders` | `api/v1/activation#orders` |
| GET | `/api/activation/validate_iccid` | `api/v1/activation#validate_iccid` |
| POST | `/api/activation/validate_modem` | `api/v1/activation#validate_modem` |
| GET | `/api/activation/can_verify_absher` | `api/v1/activation#can_verify_absher` |
| POST | `/api/otp/verify` | `api/v1/otp#verify` |
| POST | `/api/otp/resend` | `api/v1/otp#resend` |

**Semati / identity**
| Verb | Path | Controller#action |
|------|------|-------------------|
| POST | `/api/semati/authorize` | `api/v1/semati#authorize` |
| GET | `/api/semati/check` | `api/v1/semati#check` |
| PATCH | `/api/semati/authorize_active_user` | `api/v1/semati#authorize_active_user` |
| POST | `/api/semati/authorize_active_user_otp` | `api/v1/semati#authorize_active_user_otp` |

**Payments & billing**
| Verb | Path | Controller#action |
|------|------|-------------------|
| POST | `/api/payment/initiate` | `api/v1/payment#initiate` |
| GET | `/api/payment/notify` | `api/v1/payment#notify` |
| GET | `/api/payment/check` | `api/v1/payment#check` |
| GET | `/api/payment/vendor` | `api/v1/payment#vendor` |
| GET | `/api/payment/:id/status` | `api/v1/payment#status` |
| POST | `/api/payment/:id/commit` | `api/v1/payment#commit` |
| POST | `/api/payment/:id/cancel` | `api/v1/payment#cancel` |
| GET | `/api/bill/list` | `api/v1/bills#list` |
| GET | `/api/bill/generate_pdf` | `api/v1/bills#generate_pdf` |
| POST | `/api/recharge/voucher` | `api/v1/recharge#voucher` |
| POST | `/api/recharge/anonymous_voucher` | `api/v1/recharge#voucher` |
| GET | `/api/recharge/validate_details` | `api/v1/recharge#validate_details` |
| GET | `/api/recharge/validate_details_with_account` | `api/v1/recharge#validate_details_with_account` |
| GET | `/api/dynamic_recharge/details` | `api/v1/dynamic_recharges#details` |
| POST | `/api/dynamic_recharge/recharge` | `api/v1/dynamic_recharges#recharge` |
| GET | `/api/renewal/checkout` | `api/v1/renewals#checkout` |
| PATCH | `/api/renewal/renew` | `api/v1/renewals#renew` |
| POST | `/api/renewal/renew_otp` | `api/v1/renewals#renew_otp` |
| GET | `/api/external_renewal/checkout` | `api/v1/external_renewals#checkout` |
| PATCH | `/api/external_renewal/renew` | `api/v1/external_renewals#renew` |
| POST | `/api/external_renewal/renew_otp` | `api/v1/external_renewals#renew_otp` |
| POST | `/api/external_renewal/update_pay_with` | `api/v1/external_renewals#update_pay_with` |
| POST | `/api/external_renewal/deduct_from_balance` | `api/v1/external_renewals#deduct_from_balance` |

**Checkout & commerce**
| Verb | Path | Controller#action |
|------|------|-------------------|
| POST | `/api/checkout` | `api/v1/checkout#create` |
| PATCH/PUT | `/api/checkout/:id` | `api/v1/checkout#update` |
| GET | `/api/checkout/current` | `api/v1/checkout#current` |
| POST | `/api/checkout/simulate_saleor_sdk` | `api/v1/checkout#simulate_saleor_sdk` |
| POST | `/api/checkout/:id/delivery_info` | `api/v1/checkout#delivery_info` |
| POST | `/api/checkout/:id/submit` | `api/v1/checkout#submit` |
| POST | `/api/checkout/:id/customer_info` | `api/v1/checkout#customer_info` |
| POST | `/api/checkout/:id/customer_info_otp` | `api/v1/checkout#customer_info_otp` |
| POST | `/api/checkout/:id/saleor` | `api/v1/checkout#saleor` |
| DELETE | `/api/checkout/:id/remove` | `api/v1/checkout#remove` |
| GET | `/api/checkout/:id/get` | `api/v1/checkout#get` |
| POST | `/api/saleor/login` | `api/v1/saleor#login` |
| POST | `/api/saleor/verify` | `api/v1/saleor#verify` |
| GET | `/api/saleor/sc_user` | `api/v1/saleor#sc_user` |
| GET | `/api/saleor/payment_status/:checkout_id` | `api/v1/saleor#payment_status` |
| GET | `/api/saleor/active_checkouts` | `api/v1/saleor#active_checkouts` |
| POST | `/api/emkan/vouchers/validate_voucher` | `api/v1/emkan/vouchers#validate_voucher` |
| POST | `/api/emkan/vouchers/pre_redeem` | `api/v1/emkan/vouchers#pre_redeem` |
| POST | `/api/emkan/vouchers/redeem` | `api/v1/emkan/vouchers#redeem` |

**SIM replacement, ownership transfer, MNP cancel**
| Verb | Path | Controller#action |
|------|------|-------------------|
| GET/POST/PATCH/PUT/DELETE | `/api/sim_replacement` (+`/:id`) | `api/v1/sim_replacement#index/create/show/update/destroy` (full resource) |
| GET | `/api/sim_replacement/validate_mobile_number` | `api/v1/sim_replacement#validate_mobile_number` |
| GET | `/api/sim_replacement/validate_user_details` | `api/v1/sim_replacement#validate_user_details` |
| GET | `/api/sim_replacement/validate_password` | `api/v1/sim_replacement#validate_password` |
| GET | `/api/sim_replacement/activate_mobile_number` | `api/v1/sim_replacement#activate_mobile_number` |
| POST | `/api/sim_replacement/contact_number_otp` | `api/v1/sim_replacement#contact_number_otp` |
| GET | `/api/sim_replacement/:id/double_auth_list` | `api/v1/sim_replacement#double_auth_list` |
| PATCH | `/api/sim_replacement/:id/double_auth` | `api/v1/sim_replacement#double_auth` |
| POST | `/api/sim_replacement/:id/double_auth_otp` | `api/v1/sim_replacement#double_auth_otp` |
| POST | `/api/sim_replacement/:id/activate` | `api/v1/sim_replacement#activate` |
| POST | `/api/ownership_transfer/verify` | `api/v1/ownership_transfer#verify` |
| POST | `/api/ownership_transfer/:id/verify_otp` | `api/v1/ownership_transfer#verify_otp` |
| POST | `/api/mnp/cancel_mnp` | `api/v1/mnp#cancel_mnp` |
| POST | `/api/mnp/cancel_mnp_otp` | `api/v1/mnp#cancel_mnp_otp` |

**Users & profile**
| Verb | Path | Controller#action |
|------|------|-------------------|
| GET | `/api/users/current`, `/api/users/bundles`, `/api/users/dashboard`, `/api/users/widget_details`, `/api/users/current_bill`, `/api/users/manage_sims`, `/api/users/my_mobile_numbers`, `/api/users/check_transfer_balance`, `/api/users/spam` | `api/v1/users#…` |
| GET | `/api/users/list_mobile_numbers`, `/api/users/check_email`, `/api/users/is_registered` | `api/v1/users/registration#…` |
| POST | `/api/users/spam`, `/api/users/spam_otp`, `/api/users/transfer_balance` | `api/v1/users#spam/spam_otp/transfer_balance` |
| GET/POST/PATCH/PUT/DELETE | `/api/users/profile` | `api/v1/profiles#show/create/update/destroy` (singular resource) |
| PATCH | `/api/users/profile/email`, `…/primary_number`, `…/alternative_number`, `…/remove_primary_number`, `…/remove_alternative_number`, `…/terminate_number`, `…/credit_transfer` | `api/v1/profiles#…` |
| POST | `/api/users/profile/email_otp`, `…/primary_number_otp`, `…/alternative_number_otp`, `…/terminate_number_otp`, `…/terminate_number_process`, `…/credit_transfer_otp` | `api/v1/profiles#…` |
| DELETE | `/api/users/profile/cancel_profile` | `api/v1/profiles#cancel_profile` |
| GET | `/api/users/profile/avatars`, `…/plan_summary`, `…/balance_summary`, `…/terminate_number_init`, `…/denominations_eligibility`, `…/generate_temp_token` | `api/v1/profiles#…` |

**Services, datasims, VAS**
| Verb | Path | Controller#action |
|------|------|-------------------|
| GET | `/api/services`, `/api/services/:id` | `api/v1/services#services/show` |
| GET | `/api/services/service_groups`, `/api/services/service_groups/:id` | `api/v1/services#service_groups/service_group` |
| POST | `/api/services/:service/activate`, `/api/services/:service/deactivate` | `api/v1/services#activate/deactivate` |
| GET | `/api/services/:service/promoted`, `/api/services/:service`, `/api/services/:service/:id`, `/api/services/:service/:id/activate`, `/api/services/:service/:id/deactivate` | `api/v1/services#promoted/index/show/activate/deactivate` |
| GET | `/api/datasims/is_eligible` | `api/v1/datasims#is_eligible` |
| POST | `/api/datasims/activate` | `api/v1/datasims#activate` |
| POST | `/api/vas/redeem` | `api/v1/vas#redeem` |
| GET | `/api/wordpress/get_msisdn` | `api/v1/wordpress#get_msisdn` |

**Dealer / partner / server-to-server**
| Verb | Path | Controller#action |
|------|------|-------------------|
| GET | `/api/deliveries/requests` | `api/v1/deliveries#requests` |
| POST | `/api/apps/settings/banner` | `api/v1/apps/settings#banner` |
| GET | `/api/apps/payment/check` | `api/v1/apps/payment#check` |
| GET | `/api/apps/payment/payment_status/:checkout_id` | `api/v1/apps/payment#payment_status` |
| GET | `/api/apps/orders/:id` | `api/v1/apps/orders#show` |
| GET | `/api/apps/orders/check_social_security_eligibility` | `api/v1/apps/orders#check_social_security_eligibility` |
| GET | `/api/apps/orders/qr/:id` | `api/v1/apps/orders#qr` |
| GET | `/api/apps/orders/qr_tlv` | `api/v1/apps/orders#qr_tlv` |
| GET | `/api/apps/orders/get_details/:id` | `api/v1/apps/orders#get_details` |
| POST | `/api/apps/orders/update_issued_sim/:id` | `api/v1/apps/orders#update_issued_sim` |
| GET | `/api/apps/orders/active_checkouts` | `api/v1/apps/orders#active_checkouts` |
| GET | `/api/invoices` | `api/v1/invoices#invoices` |
| GET | `/api/invoices/send_invoice/:onboarding_order_id` | `api/v1/invoices#send_invoice` |
| GET | `/api/invoices/get_status/:id`, `/api/invoices/get_full_status/:id` | `api/v1/invoices#get_status/get_full_status` |
| GET | `/api/invoices/check_balance` | `api/v1/invoices#check_balance` |
| POST | `/api/invoices/deduct_amount/:order_id` | `api/v1/invoices#deduct_amount` |
| POST | `/api/invoices/commission` | `api/v1/invoices#commission` |
| GET | `/api/partners/qr` | `api/v1/partners#qr` |
| POST | `/api/remedy/otp` | `api/v1/remedy/otp#create` |
| POST | `/api/remedy/otp/confirm`, `…/login`, `…/verify` | `api/v1/remedy/otp#confirm/login/verify` |

**Misc**
| Verb | Path | Controller#action |
|------|------|-------------------|
| POST | `/api/notifications/token` | `api/v1/notifications#token` |
| POST | `/api/notifications/emails` | `api/v1/notifications/emails#create` |
| POST | `/api/client_logs` | `api/v1/client_logs#create` |
| GET/POST | `/api/surveys`, `/api/surveys/:id` | `api/v1/surveys#index/show/create` |

**Apollo namespace** (drawn twice: `/api/apollo/*` and deprecated alias `/api/tygo/*`; controllers `api/v1/apollo/*`)
| Verb | Path | Controller#action |
|------|------|-------------------|
| GET | `/api/apollo/plans`, `/api/apollo/plans/:id`, `/api/apollo/plans/prepaid`, `/api/apollo/plans/postpaid` | `api/v1/apollo/plans#index/show/prepaid/postpaid` |
| GET | `/api/apollo/numbers`, `/api/apollo/numbers/vanities` | `api/v1/apollo/numbers#index/vanities` |
| POST | `/api/apollo/numbers/reserve` | `api/v1/apollo/numbers#reserve` |
| DELETE | `/api/apollo/numbers/unreserve` | `api/v1/apollo/numbers#unreserve` |
| POST | `/api/apollo/eligibility` | `api/v1/apollo/eligibility#create` |
| POST | `/api/apollo/semati/authorize` | `api/v1/apollo/semati#authorize` |
| GET | `/api/apollo/semati/check` | `api/v1/apollo/semati#check` |
| POST | `/api/apollo/checkout` | `api/v1/apollo/checkout#create` |
| GET | `/api/apollo/checkout`, `/api/apollo/checkout/:id` | `api/v1/apollo/checkout#index/show` |
| POST | `/api/apollo/checkout/otp_confirm`, `…/otp_resend`, `…/confirm`, `…/refund` | `api/v1/apollo/checkout#otp_confirm/otp_resend/confirm/refund` |
| GET | `/api/apollo/checkout/esim_qr`, `/api/apollo/checkout/esim_details` | `api/v1/apollo/checkout#esim_qr/esim_details` |
| POST | `/api/apollo/activation` | `api/v1/apollo/activation#create` |
| POST | `/api/apollo/tcc/sms/send` | `api/v1/apollo/tcc#send_sms` |

**Sedco namespace** (`/api/sedco/*`, controller `api/v1/sedco/semati`)
| Verb | Path | Controller#action |
|------|------|-------------------|
| POST | `/api/sedco/semati/authorize` | `api/v1/sedco/semati#authorize` |
| GET | `/api/sedco/semati/check` | `api/v1/sedco/semati#check` |
| GET | `/api/sedco/semati/token` | `api/v1/sedco/semati#token` |

---

## State machines

### OnboardingOrder (`app/models/onboarding_order.rb`) — AASM, column `aasm_state`
`aasm whiny_transitions: false, skip_validation_on_save: true`

**States:** `plan_selection` (initial), `sim_type_selection`, `number_order_type_selection`, `number_selection`, `mnp_info`, `eligibility_check`, `account_details`, `account_verification`, `account_password`, `delivery_details`, `payment`, `expired`.

**Event `update_order`** (fired via `save_and_reload_and_update_aasm` after every `save_*` mutator; `after_commit :handle_order_transition`). AASM evaluates transitions in declared order — the first guard that passes wins, so the order always lands on the furthest state its data supports:

| Priority | To | Guard(s) |
|---|----|----------|
| 1 | `expired` | `expired_guard` — not OT flow ∧ `payment_guard` ∧ `paid?` ∧ number present ∧ `number.expired?` |
| 2 | `payment` | `payment_guard` — `delivery_details_guard` ∧ (`skip_the_delivery?` ∨ `is_delivery_set?` (lat/lng)) |
| 3 | `delivery_details` | `delivery_details_guard` — `account_password_guard` ∧ (indirect/apollo/visitor flows bypass password ∨ `has_customer_password?` for new registrations) |
| 4 | `account_password` | `account_password_guard` — `account_verification_guard` ∧ `is_verified?` (email or mobile OTP-verified; visitor flow skips `is_verified?`) |
| 5 | `account_verification` | `account_verification_guard` — `account_details_guard` ∧ `has_customer_info?` |
| 6 | `account_details` | `account_details_guard` — `eligibility_check_guard` ∧ `is_eligiblity_checked?` ∧ `has_eligiblity?` |
| 7 | `eligibility_check` | `eligibility_check_guard` — order-type chosen ∧ (`is_number_selected?` ∨ `is_mnp_filled?`) |
| 8 | `mnp_info` | `number_order_type_selection_guard` ∧ `is_mnp?` |
| 9 | `number_selection` | `number_order_type_selection_guard` ∧ `is_new_number?` |
| 10 | `number_order_type_selection` | `number_order_type_selection_guard` — `sim_type_selection_guard` ∧ `is_sim_type_selected?` |
| 11 | `sim_type_selection` | `sim_type_selection_guard` — `is_plan_selected?` |

**Event `reseted`:** any state → `plan_selection` (used by `POST …/orders/:id/reset` and order reuse).

**Transition side-effects** (`handle_order_transition`, after_commit): entering `account_verification` ⇒ `handle_otp_notifications` (creates+delivers `OtpVerification`; SMS default, email for visitor flow; skipped for apollo/visitor OTP engines); entering `payment` ⇒ abandoned-order notification hook (currently disabled).

**Guard-relevant flags:** `skip_the_delivery?` = eSIM w/o data-SIM ∨ posa ∨ qr_posa ∨ indirect ∨ visitor_hajj. `flow_type` enum: `normal(0), indirect(1), posa(2), apollo(3), ownership_transfer(4), partner(5), visitor_hajj_flow(6), qr_posa(7)`. `number_order_type`: NEW=0, MNP=1. `sim_type`: NORMAL=0, ESIM=1. `delivery_type`: `delivery`/`pickup`/`not_selected`.

**Parallel non-AASM lifecycle (`Statusable` concern, column `status`):** enum `pending, abandoned, submitted, delivered, in_progress, cancelled_aged, refunded, completed` — recomputed on every save (`calculate_status` from `completed`, payments, delivery_requests, number-reservation age). `post_handle_status`: on `abandoned`/`refunded` non-MNP orders the reserved number is unreserved via `NumberManager`. Booleans `completed` (set by `Payment::CommitWorker` / `QrPosaOrderCompleter` / seller deduction) and `activated` (set by activation controllers) gate the `pending_activation`, `indirect_pending_activation`, `qr_posa_pending_activation` scopes.

### Checkout (`app/models/checkout.rb`) — AASM, column `aasm_state`
`aasm whiny_transitions: false, skip_validation_on_save: true`

**States:** `product_selection` (initial), `contact_details`, `delivery_details`, `payment`.

**Event `update_state`** (`after_commit :handle_checkout_transition` — currently a no-op), first-passing guard in order:

| Priority | To | Guard |
|---|----|-------|
| 1 | `payment` | `payment_guard` — `delivery_details_guard` ∧ `is_delivery_set?` (lat/lng) |
| 2 | `delivery_details` | `delivery_details_guard`, per `checkout_type`: DATA_SIM ⇒ `is_mobile_number_set?`; OWNERSHIP_TRANSFER / ADVANCED_POSTPAID_PAYMENT ⇒ `is_contact_number_set?`; SALEOR ⇒ `is_contact_details_set?` (contact_number+name+email); REPLACEMENT ⇒ `sim_replacement_delivery_check` (esim ⇒ true, else mobile+contact numbers); RENEWAL ⇒ true; NORMAL/other ⇒ **false** (never advances) |
| 3 | `contact_details` | `contact_details_guard` — always true |

**Event `reseted`:** → `product_selection`.

**`checkout_type`:** `NORMAL=0, DATA_SIM=1, CHANGE_PLAN=2, REPLACEMENT=3, SALEOR=4, OWNERSHIP_TRANSFER=5, RENEWAL=6, ADVANCED_POSTPAID_PAYMENT=7`; `sim_type`: NORMAL=0, ESIM=1.

**Completion flags (non-AASM):** `complete!` sets `paid+completed+completed_at` and runs type hooks (DATA_SIM ⇒ `checkoutable.require_data_sim=true`; OWNERSHIP_TRANSFER ⇒ `OwnershipTransferManager.post_send`); `complete_payment!` sets `paid` only (SALEOR/REPLACEMENT — completion happens after fulfilment/activation); `complete_without_payment!`. Ownership-transfer request lifecycle lives in `extra.ownership_transfer_state`: `initiated → sent → accepted → completed | expired | deleted`.

### Other stateful models (not AASM — plain enums/strings, listed for completeness)
- **`Payment.status`**: `pending → success | fail` (gateway notification via `update_commit_response`; `actual_pending?` re-checks); `refunded` effect is modelled via associated **`Refund.status`** (`pending → success | fail`) driven by `Payment::RefundWorker`. Successful commits enqueue `Payment::CommitWorker` (idempotency by queue check) and `ZatcaTransactionWorker`.
- **`DeliveryRequest`**: vendor-status strings updated by `DeliveryManager.process_callback` from `/delivery/:vendor/callback` (per-vendor mapping, OTO signature-verified).
- **`Otp` / `OtpVerification`**: `verified` boolean + attempt counters (Redis-cached attempt limits, `drift: 180`, fake-OTP switch `Otp.fake_otp?`).
- **`User` (Optiva mirror)**: account state from BSS (`ACTIVATED / PENDING / DEACTIVATED`) checked at every auth; not persisted as a machine.
