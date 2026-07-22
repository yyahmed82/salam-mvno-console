# Salam selfcare-backend — Data Model Analysis

Source: `selfcare-backend/db/schema.rb` (version `2026_06_10_120000`, PostgreSQL, extensions `pgcrypto` + `plpgsql`) and `app/models/*.rb` (96 model files). Rails 6.1.

Key architectural fact: this DB is the **journey/orchestration store**, not the subscriber ledger. Subscriber accounts, balances, plans-in-force live in the **Optiva BSS** (referenced via `optiva_identifier`, `optiva_account_id`, `optiva_reference`, `optiva_paid_type`). Several "entities" that payments point to (recharge, bill, termination, change_plan…) are **virtual** — they exist only as string labels in `payments.payment_on_type`, with the real effect executed against BSS by `PaymentManager` / `Payment::CommitWorker`.

---

## Core entities

### Identity & actors

| Table | Purpose | Key columns / values | Associations |
|---|---|---|---|
| `users` (506K) | Registered self-care accounts (post-activation login). `has_secure_password` | `mobile_number` (unique, intl format), `email`, `verified`, `verified_email`, `optiva_identifier`, `optiva_account_id`, `optiva_paid_type`, `nationality_id_number`, `primary_number`, `alternative_number` (data-SIM contact), `require_data_sim`, `avatar_id`, sign-in tracking, `platform`/`app_version`/`os_version` | `has_many :onboarding_orders, as: :orderable`; `has_many :checkouts, as: :checkoutable`; `has_one :profile, as: :profile_on`. On destroy → copied to `deleted_users` and polymorphic refs rewritten to `DeletedUser` |
| `anonymous_users` (16M) | Device-level pre-login identity (one per app install/device). Carries OTP secret for pre-login verification | `device_id` (indexed, not unique), `mobile_number`, `fut_mobile_number`, `otp_secret_key`, `platform`, `app_version`, `os_version`, `current_sign_in_ip` | `has_many :onboarding_orders, as: :orderable`; `has_many :checkouts, as: :checkoutable`. `inprogress_order` = last incomplete order |
| `guests` | Lightweight authenticated-by-OTP account (BSS subscriber without full User record) | `mobile_number` (unique), `optiva_identifier`, `optiva_account_id`, `optiva_paid_type`, `otp_secret_key`, `require_data_sim` | `has_many :onboarding_orders, as: :orderable`; `has_many :checkouts, as: :checkoutable`; `has_one :profile, as: :profile_on` |
| `deleted_users` | Tombstone copy of deleted `users` rows (GDPR-ish); polymorphic owners of old orders/checkouts | mirror of users columns | target of re-pointed `orderable`/`checkoutable` |
| `admin_users` | ActiveAdmin/Devise admins | Devise columns; `role` (integer, default 0) | `has_many :sim_uploads` (uploader) ; refunds/installment_refunds reference `admin_user_id` |
| `sellers` | Indirect/partner channel sales agents (JWT login, OTP) | `username`, `email` (unique), `mobile_number`, `group`, **`seller_type` enum: `indirect`=0, `partner`=1** (`_prefix`) | `has_many :invoices`, `has_many :seller_deductions`, `has_many :onboarding_orders` |
| `customer` (no table) | PORO façade over User/Guest + `AccountManager` (Optiva) — live plan, balance, status | — | wraps `user_or_guest` |
| `profiles` | Polymorphic key/value profile (e.g. `spam_block`) | `profile_on_type`/`profile_on_id`, `extra` jsonb | `belongs_to :profile_on, polymorphic` → [User, Guest] |

### Acquisition / onboarding

| Table | Purpose | Key columns / values | Associations |
|---|---|---|---|
| `onboarding_orders` (8M, **UUID pk**) | The line-acquisition funnel record (new SIM / MNP port-in), one per attempt. Central entity of the system | **`aasm_state`** (wizard step, see State machines), **`status`** (business status via `Statusable` enum: `pending`, `abandoned`, `submitted`, `delivered`, `in_progress`, `cancelled_aged`, `refunded`, `completed` — default `pending`), **`flow_type` enum**: `normal`=0, `indirect`=1, `posa`=2, `apollo`=3, `ownership_transfer`=4, `partner`=5, `visitor_hajj_flow`=6, `qr_posa`=7; `number_order_type` (0=new, 1=MNP), `sim_type` (0=normal, 1=eSIM), `delivery_type` (`delivery`/`pickup`/`not_selected`), `completed`, `activated`, `is_eligible`, `plan_id`, `mobile_number`+`mobile_number_verified`, `email`+`email_verified`, `nationality_id_number`, `nationality_id`, `nationality_id_type`, `mnp_operator`, `mnp_number`, `checkout_id` (random base36 public ref), `payments_count` (counter cache), delivery lat/lng/area/city/time, `store_id`, `seller_id`, `tcc_verified`, `terminated_at`, `archived`, `physical_sim_iccid`, UTM columns, `extra` jsonb (adjust attributions, offer_type, user_id_type, visa_number, lang…) | `belongs_to :orderable, polymorphic` → [AnonymousUser, User, Guest, DeletedUser]; `belongs_to :plan`, `:nationality`, `:store`, `:seller`; `has_one/has_many :numbers`; `has_many :otp_verifications, as: :otp_on`; `has_many :raw_sims, as: :redeemed_on`; `has_many :payments, as: :payment_on`; `has_one :invoice, as: :invoice_on`; `has_many :seller_deductions`; `has_one :qr_posa_completion`; `has_many :delivery_requests, as: :delivery_on` |
| `numbers` (1M) | MSISDN reserved (in Optiva) for an order | `identifier` (MSISDN), `group_id` (vanity group), `reservation_id` (new reservation system if present), `price_type`, `expires_at` (local expiry; remote checked via Optiva) | `belongs_to :onboarding_order`; `belongs_to :vanity` (by `group_id`). destroy → `UnreserveNumberWorker` |
| `tmp_numbers` | Number reservations not yet tied to an order (partner/Tygo flows) | `identifier`, `reservation_id`, `group_id`, `price_type`, `source` (default `tygo`), `expires_at` | promoted via `Number.create_from_tmp_numbers` |
| `vanities` | Vanity number groups & pricing | `group_id` (unique; 3=free/prepaid, 3–7 postpaid), `price`, `name` jsonb, `enabled`, `has_offer`, `commitment_period`, colors | referenced by `numbers.group_id` |
| `otps` (11.2M, UUID pk) | One-shot OTP codes (pre-login flows) | `otp_for` (msisdn/email), `otp_type` (default `mobile_number`), `code`, `verified`, `confirmation_reference` (uuid handed back to client), `delivery_method` (`sms`/`email`). ~24 `message_type`s cached in Rails.cache (login, purchase_line, sim_replacement, transfer_*, cancel_mnp, …) | standalone (no FK) |
| `otp_verifications` | TOTP-based verification attached to an entity (order account-verification step) | `otp_secret_key`, `delivery_type` (`mobile_number`/`email`), polymorphic `otp_on` (uuid) | `belongs_to :otp_on, polymorphic` → [OnboardingOrder] |
| `activation_logs` (4.4M) | Every BSS activation API call (request/response audit) | `api`, `msisdn`, `request`/`request_data`/`response` jsonb, `state` bool, `status_code`, `person_id`, `platform` | `belongs_to :onboarding_order, optional`. after_create → Slack notify |
| `eligibility_logs` (2.8M) | Semati/eligibility API call audit | same shape + `process` ∈ {`change_plan`, `onboarding_order`, `ownership_transfer`, `datasim_eligibility`} | `belongs_to :onboarding_order, optional` |
| `nafath_logs` (2.3M) | Nafath/Absher identity-verification transactions | `nationality_id_number`, `service`, `trans_id`, `status` (string, default `new`), **`auth_type` enum: `nafath`=0, `absher`=1**, `response`/`callback`/`token_data` jsonb, `channel_id`, `platform` | `belongs_to :channel` |
| `qr_posa_completions` | Completion marker for QR-POSA flow (retail QR activation) | `onboarding_order_id` (unique), `activation_price`, `extra` | `belongs_to :onboarding_order` |
| `seller_deductions` | Commission/deduction taken from a seller's wallet for an indirect order (acts as "payment" for indirect flow) | `seller_id`, `onboarding_order_id`, `amount`, `commission_response` jsonb, `shash`, `extra` | `belongs_to :onboarding_order`, `belongs_to :seller` |
| `nationalities` (no pk) | Lookup: nationality codes | `nationality_id`, `name` jsonb, `enabled`, `iso3_code` | referenced by `onboarding_orders.nationality_id` |
| `eligibility_id_types` (no pk) | Lookup: allowed ID types for eligibility | `type_id`, `type_name` jsonb, `enabled` | — |
| `semati_absher_user_types` | Maps Semati ID types ↔ Absher types; drives OTP/auth method per visa/ID type | `semati_user_id_type`, `absher_user_id_type`, `otp_type`, `authentication_type`, `hide`, `position` | snapshot stored in `onboarding_orders.extra.user_id_type` |

### Commerce (checkout / payments / refunds)

| Table | Purpose | Key columns / values | Associations |
|---|---|---|---|
| `checkouts` (2.6M, **UUID pk**) | Generic post-acquisition purchase funnel (data SIM, change plan, SIM replacement, e-commerce, ownership transfer, renewal, advanced payment) | **`checkout_type`** (int, see Enums), **`aasm_state`** (`product_selection` → `contact_details` → `delivery_details` → `payment`), `items` jsonb (array of `{type: FeeType, value, extra}`), `paid`, `completed`, `completed_at`, `payments_count`, `checkout_id` (base36 public ref), delivery fields (lat/lng/area/city/time/type/store), `mobile_number`, `contact_number`, `contact_name`, `email`, `nationality_id_number`, `extra` jsonb (saleor payload, payment_plan `FULL_PRICE`/`INSTALLMENT`, payment_vendor, sim_type, pay_with, ownership_transfer_state `initiated/sent/accepted/completed/expired/deleted`) | `belongs_to :checkoutable, polymorphic` → [User, Guest, AnonymousUser, DeletedUser]; `belongs_to :checkout_for, polymorphic, optional` → [Plan] (change-plan target); `belongs_to :store`; `has_many :payments, as: :payment_on`; `has_many :delivery_requests, as: :delivery_on` |
| `payments` (4.88M, **UUID pk**) | Every PG transaction attempt (+ `payments_bkp` backup copy of same shape) | **`status`**: `pending` (default) → `success` / `fail` / `refunded` (+virtual `initiated` = pending w/o commit response); `amount`, `payment_method` (default `credit-card`), **`vendor`**: `hyperpay` (default) / `tap` / `tamara` / `apollo` / `salam` (see Enums), **`card_type` enum**: `apple_pay`=0, `credit_card`=1 (default), `mada`=2, `amex`=3, `stc`=4, `tasheel`=5, `other`=30, `n/a`=60; `payment_reference_id`, `payment_initialization_response` / `payment_commit_response` jsonb, `bss_response` jsonb (`{status, response[], retries}` — BSS commit result), `fail_reason`, `customer_mobile_number`, `target_mobile_number`, `platform` (default `Web`), `external_service_name`, `archived`, `extra` jsonb (procedure, optiva_account_id, zatca, token…) | **`belongs_to :payment_on, polymorphic, optional, counter_cache`** → mixed: real AR models [`OnboardingOrder`, `Checkout`] and **virtual string types** [`recharge`, `bill` (also used for anonymous bill), `termination`, `change_plan`, `sim_replacement`, `advanced_postpaid_payment`, `postpaid_service_recharge`] — for virtual types `payment_on_id` is a non-AR reference and `Payment::CommitWorker` branches on the string. Renewal & dynamic-recharge ride on `Checkout`/`recharge` respectively. `has_one :invoice`; `has_one :refund`; `has_one :termination_log` |
| `payment_vendors` | PG routing config (per payment type, platform, time window) | `name` ∈ {hyperpay, tap, tamara, apollo, salam}, `enabled`, `position`, **`payment_types` jsonb flags**: `bill, saleor, renewal, checkout, recharge, change_plan, termination, anonymous_bill, OnboardingOrder, sim_replacement, dynamic_recharge, ownership_transfer, advanced_postpaid_payment, postpaid_service_recharge`; **`platforms` jsonb**: `ios/web/android`; `channel`, `from_time`/`to_time` | `PaymentVendor.select_vendor(payment_type, platform)` picks first enabled match |
| `refunds` | Refund/reversal requests against payments | `payment_id` (string uuid), **`status`**: `pending` (default) / `success` / `fail`; **`refund_type` enum**: `reverse`=0 / `refund`=1 (`_prefix`); `refund_reason_id`, `admin_user_id`, `req`/`res` jsonb, `fail_reason`, `remote_payment_id`. success → payment.status='refunded'; also triggers ZATCA credit note (CRN) | `belongs_to :payment`, `:refund_reason`, `:admin_user` |
| `refund_reasons` | Lookup of refund reasons | `reason` | `has_many` refunds |
| `invoices` | Hyperbill invoices (mainly indirect-seller orders) | **`status` enum**: `new`=0, `created`=1, `sent`=2, `paid`=3, `failed`=4 (`_prefix`); `invoice_on_type`/`invoice_on_id` (string id — supports UUID), `amount`, `vat`, `invoice_no`, `invoice_url`, `creation_response`/`send_response`/`payment_response` jsonb, `seller_id`, `payment_id`, `archived` | `belongs_to :invoice_on, polymorphic` → [OnboardingOrder]; `belongs_to :seller`, `:payment` |
| `installments` | BNPL/financing vouchers (Emkan et al.) for Saleor orders | `vendor` (default `emkan`), `voucher_code`, `customer_id`, `order_id`, `otp`, `otp_id`, `saleor_order_id`, `response` jsonb | `has_one :installment_refund` |
| `installment_refunds` | Refund of an installment voucher | `admin_user_id`, `installment_id`, `vendor` (default `emkan`), otp fields, `response` | `belongs_to :admin_user`, `:installment` |
| `installment_vendors` | BNPL vendor config | `installment_type` ∈ {`emkan`, `tamara`, `tasheel`} (unique), `enabled`, `position`, `interest_rate`, `number_of_installments`, `display_name`/`url` jsonb (i18n), `max_items_per_checkout`, `min_checkout_price_value` | — |
| `credit_denominations` | Recharge amounts offered | `amount` (default 10.0), `active` | — |
| `recharge_options` | Named recharge products | `name` jsonb, `price` | — |

### Fulfilment / SIM logistics

| Table | Purpose | Key columns / values | Associations |
|---|---|---|---|
| `delivery_requests` (362K) | Courier shipment for a SIM (or Saleor parcel) | **`vendor`** (default `stcc`) ∈ {stcc, smsa, manarat, barq, tam, posa, saleor, imile, oto}; `delivery_state` (raw vendor state string — see normalization mapping in Enums section), `submitted`, `internal_reference_id`, `external_reference_id`, receiver_* (lat/long/email/full_name/mobile/nationality_id), `delivery_initialization_response` / `callback_response` jsonb, `delivered_at`, `require_data_sim`, `short_address` (reverse-geocoded) | `belongs_to :delivery_on, polymorphic, touch` → [OnboardingOrder, Checkout]; `belongs_to :delivery_vendor` (FK `vendor`→`name`); `has_many :raw_sims`. Completed callbacks map delivered ICCIDs onto `raw_sims` |
| `delivery_vendors` | Courier config (pk = `name`) | `name` (pk), `enabled`, `position`, per-weekday hours, `show_city`, `show_schedule`, `delivery_duration`. Vendor chosen by geofence containment (`find_vendor(lat,lng)`, fallback SMSA) | `has_many :geofences`, `:delivery_requests`, `:sim_uploads` (all FK `vendor`) |
| `geofences` | Vendor service-area polygons | `area_name`, `points[]`, `geojson`, `vendor` | `belongs_to`-ish to delivery_vendor by name |
| `delivery_areas` / `delivery_cities` | Region/city lookups for delivery | `name` jsonb; city → `delivery_area_id` | referenced by orders/checkouts (loose FK ints) |
| `sim_uploads` | Admin CSV batch of SIM stock | `file`, `esim` flag, `vendor` (delivery vendor name or inventory bucket e.g. `visitor_hajj`), `synced` | `belongs_to :admin_user`; `has_many :raw_sims` |
| `raw_sims` | Individual SIM inventory (ICCID/IMSI), redemption tracking | `iccid` (unique), `imsi`, `sim_type` (0 normal/1 esim), `reservation_id` (eSIM), `redeemed_on_type`/`redeemed_on_id` (polymorphic string id), `redeem_time`, `modem_serial_number`, `plan_id`, `extra` | `belongs_to :sim_upload`, `:plan (opt)`, `:delivery_request (opt)`, `:redeemed_on, polymorphic` → [OnboardingOrder] |
| `issued_sims` | SIMs issued by DMS/vendor agents (POSA), keyed by order reference | `sim_iccid`, `data_sim_iccid`, `reference_number` (→ onboarding_order id), `status`, agent_* fields, `dms_reference_id`, `created_by_vendor` | `belongs_to :onboarding_order, foreign_key: :reference_number` |
| `stores` | Physical pickup/service stores | `store_code`, names/addresses ar+en, lat/long, capability flags (`update_info`, `ownership`, `sim_replace`, `port_in`), weekly hours, `store_json` | `has_many :onboarding_orders`, `:checkouts` |
| `store_types` | Store category lookup | `store_type`, `code`, `pin_color_code` | — |

### Catalog (plans & services)

| Table | Purpose | Key columns / values | Associations |
|---|---|---|---|
| `plans` | Tariff plans (mirror of Optiva offers) | `optiva_reference`, `price` + `discount_rate` (effective price computed), **`plan_type`**: 1=PREPAID, 2=POSTPAID, 3=HYBRID; **`sim_type` enum**: `normal_sim`=0, `esim`=1, `both`=2; **`bundle_type` enum**: `voice`=0, `data`=1 (`_prefix`); `enabled`, `validity` (days), `deposit` (postpaid), `has_data_sim`, `interest_rate` (BNPL), `activation_price` (QR-POSA), `hide_change_plan`, `popular`, `recommended`, `position`, i18n jsonb (`title`, `summary`, `marketing_message`, `price_summary`, `notes`, `validity_text`), `extra` (Adjust tokens) | `has_many :service_plans`, `:subplans` (feature bullets jsonb), `:plan_social_networks`→`:social_networks`, `:plan_channels`→`:channels`, `:plan_categories`→`:categories`, `:plan_hidden_services`→`:hidden_services (Service)`, `:change_plan_eligibilities`→`:to_plans`, `:rule_plans (PlanRuleMap from)`, `:checkouts, as: :checkout_for`; paper_trail |
| `subplans` | Plan feature key/values (i18n) | `plan_id`, `name`/`value` jsonb | belongs_to plan |
| `services` | VAS catalog (boosters, roaming, IDD…) | **`service_type` enum**: `booster`=0, `roaming`=1, `toggle`=2, `idd`=3, `flex_minute`=4, `flex_data`=5, `social_data`=6, `voice_minute`=7, `voice_data`=8 (`_prefix`); `price`, `validity`, `enabled`, `dashboard_promoted`, `position`, `service_group_id`, `parent_id` (self-ref hierarchy), i18n jsonb fields | `has_many :subservices`, `:service_plan_types` (per plan_type Optiva refs incl. `bundle_type`, `adjustment_type`, `option_type`), `:service_logs`; `belongs_to :service_group`, `:parent (Service)`; `has_many :children (Service)` |
| `service_plans` | Which service_type is eligible for a plan | `plan_id`, `service_type` | belongs_to plan |
| `service_plan_types` | Optiva reference per service × plan_type | `service_id`, `plan_type`, `optiva_reference`, `bundle_type`, `adjustment_type`, `option_type` | belongs_to service (implicit) |
| `service_groups` / `service_group_pricings` / `service_group_pricing_categories` / `service_group_countries` | Roaming/IDD grouping & per-country pricing matrix | jsonb names/values | group has_many pricings; countries join |
| `countries` / `country_pricings` / `country_pricing_categories` / `country_visitor_operators` | Country lookup (mena/gcc/promoted/visitor flags), IDD pricing, visitor-MNP operators | jsonb name/value | country has_many pricings & visitor_operators (FKs) |
| `categories` / `plan_categories` | Plan tagging (drives `plan.is_category_x?`) | `name`, `category_type`, `hide`, jsonb title/description | m:n with plans |
| `channels` / `plan_channels` | Sales-channel visibility of plans (e.g. app, web, partner) + Nafath channel attribution | `name` (unique) | m:n with plans; `has_many :nafath_logs` |
| `plan_rule_maps` | Social-security-eligibility plan mapping (from_plan → to_plan under `rule`) | `from_plan_id`, `to_plan_id`, `rule` int | used by `SocialSecurityEligibilityManager` |
| `change_plan_eligibilities` | Allowed plan-change graph | `plan_id` → `to_plan_id` (both FK plans) | plan has_many to_plans through |
| `social_networks` / `plan_social_networks` | Unlimited-social-app entitlements per plan | `name`, `link`, `svg`, `enabled` | m:n with plans |

### Operations / logs / misc

| Table | Purpose | Key columns / values | Associations |
|---|---|---|---|
| `change_plan_logs` | Plan-change execution log | **`status` enum**: `pending`=0, `success`=1, `failed`=2; `mobile_number`, `from_plan`/`to_plan` (optiva refs), `payment_id`, `final_step_message` | loose belongs_to user/guest by mobile_number; old_plan/new_plan by optiva_reference; payment |
| `termination_logs` | Line-termination attempts | `mobile_number`, `cvm`/`remedy` jsonb, `payment_id` (uuid), `otp` | `belongs_to :payment, optional`; `has_many :survey_answers` |
| `service_logs` | VAS activate/deactivate ops | `mobile_number`, `service_id`, `service_req/res`, `debit_res`/`credit_res` jsonb, `operation_type` int (0 default), `optiva_reference` | belongs_to service (implicit) |
| `balance_transfer_logs` | Credit/data transfer between lines | `from_mobile`, `to_mobile`, `transfer_type` (default `data_bundle`), `balance`, `amount_sar`, `rejection_reason`, `bss_limits_snapshot` jsonb | — |
| `cancel_mnp_logs` | Cancel port-in requests | `mobile_number`, `plan_id`, `operator_id` | — |
| `notification_tokens` (4.2M) | Push tokens per device | `token`, `device_id`, `platform` (validated against `Platform.mobile`), `lang` (default `en`), `enabled`, `anonymous_users_id` | loose FK to anonymous_users |
| `futs` / `fut_requests` | Friends-&-family / FUT allow-list & requests | `mobile_number` (unique), `enabled`, `plans[]` | — |
| `surveys` / `survey_questions` / `survey_question_options` / `survey_answers` | Termination/NPS surveys (options can chain via `next_type`/`next_id`) | `survey_type`; answers keyed by `mobile_number`, `termination_log_id` | question belongs_to survey; option belongs_to question |
| `settings` | Key/value app config (`vat`, `delivery_fee`, `sim_replacement_fees`, `default_payment_vendor`, `fake_otp_*`, …) | `var` (unique), `value` | rails-settings style |
| `apps` | External API-client apps (token auth, callback URL) | `name`, `token`, `ip_address`, `callback_url`, `apollo_enabled`, `semati_source_type` | — |
| `vas_campaigns` | VAS voucher campaigns | `mobile_number`, `service_name`, `voucher`, `redeemed`, `counter` | — |
| `missing_semati_lists` | Numbers missing Semati registration | `mobile_number`, `registered` | — |
| `versions` | PaperTrail audit (plans, vendors, sellers, vanities, services…) | `item_type`/`item_id`, `event`, `whodunnit`, `object_changes` | — |
| `active_admin_comments` | Admin comments | polymorphic `resource`, `author` | — |
| `rec` / `successcount` / `payments_bkp` | Ad-hoc ops leftovers (row-count scratch tables, payments backup) | — | — |

---

## State machines

Only **two models** use AASM (`include AASM`): `OnboardingOrder` and `Checkout`. Both use `whiny_transitions: false, skip_validation_on_save: true`, column **`aasm_state`** (string), and the same pattern: a single "advance" event whose transitions are tried top-down (deepest state first), each protected by a cumulative guard chain — so the record lands in the furthest state whose prerequisites are met. Both also have a `reseted` event back to the initial state.

### OnboardingOrder (`aasm_state`)

States (13): `plan_selection` (initial), `sim_type_selection`, `number_order_type_selection`, `number_selection`, `mnp_info`, `eligibility_check`, `account_details`, `account_verification`, `account_password`, `delivery_details`, `payment`, `expired`.

Event `update_order` (`after_commit: :handle_order_transition` — sends OTPs on entering `account_verification`, abandoned-order notification on entering `payment`). Transitions evaluated in order (any → target when guard passes):

| to | guard(s) | guard meaning |
|---|---|---|
| `expired` | `expired_guard` | not ownership-transfer flow AND payment_guard AND `paid?` AND number present AND `number.expired?` |
| `payment` | `payment_guard` | delivery_details_guard AND (`skip_the_delivery?` OR `is_delivery_set?`); skip_the_delivery? = eSIM w/o data-SIM, or posa/qr_posa/indirect/visitor_hajj flow |
| `delivery_details` | `delivery_details_guard` | account_password_guard AND (for indirect/apollo/visitor_hajj: nothing more; else `!Current.new_registration || has_customer_password?`) |
| `account_password` | `account_password_guard` | account_verification_guard AND `is_verified?` (email or mobile verified); visitor_hajj skips verification |
| `account_verification` | `account_verification_guard` | account_details_guard AND `has_customer_info?` (email+mobile+name) |
| `account_details` | `account_details_guard` | eligibility_check_guard AND `is_eligiblity_checked?` AND `has_eligiblity?` (`is_eligible`) |
| `eligibility_check` | `eligibility_check_guard` | number_order_type_selection_guard AND order type chosen AND (number selected OR mnp filled) |
| `mnp_info` | `number_order_type_selection_guard` + `is_mnp?` | sim type selected AND number_order_type = MNP(1) |
| `number_selection` | `number_order_type_selection_guard` + `is_new_number?` | sim type selected AND number_order_type = NEW(0) |
| `number_order_type_selection` | `number_order_type_selection_guard` | plan selected AND sim_type selected |
| `sim_type_selection` | `sim_type_selection_guard` | `is_plan_selected?` |

Event `reseted`: any → `plan_selection` (only invoked when `can_be_resetted?` — `payments_count == 0 && !completed`).

Orthogonal to aasm: the **`status` column** (Statusable concern) is a *derived business status* recalculated on every save of the order or of its Statusable children (Payment, DeliveryRequest, Invoice, Number all `include StatusableChild` → `find_onboarding_order.update_status`). Values: `pending` → `abandoned` (no payment + aged/ineligible) / `submitted` (paid or seller-deducted, awaiting activation) → `delivered` (courier completed, or eSIM/POSA/QR-POSA/Hajj auto-delivered) → `in_progress` (activation running) → `completed` (activated) / `refunded` / `cancelled_aged` (number expired or MNP payment >30 days).

### Checkout (`aasm_state`)

States (4): `product_selection` (initial), `contact_details`, `delivery_details`, `payment`.

Event `update_state` (`after_commit: :handle_checkout_transition`, currently a no-op):

| to | guard | meaning |
|---|---|---|
| `payment` | `payment_guard` | delivery_details_guard AND `is_delivery_set?` (pickup ⇒ true; OWNERSHIP_TRANSFER/RENEWAL/ADVANCED types ⇒ true; delivery ⇒ lat+lng present; REPLACEMENT+esim ⇒ true) |
| `delivery_details` | `delivery_details_guard` | per checkout_type: DATA_SIM ⇒ mobile_number set (if required); OWNERSHIP_TRANSFER / ADVANCED_POSTPAID ⇒ contact_number set; SALEOR ⇒ contact_number+name+email set; REPLACEMENT ⇒ esim OR (mobile+contact numbers); RENEWAL ⇒ always; others ⇒ false |
| `contact_details` | `contact_details_guard` | always true |

Event `reseted`: any → `product_selection` (guarded in practice by `can_be_resetted?` = `!completed`).

Completion is outside aasm: `complete!` sets `paid: true, completed: true, completed_at` (DATA_SIM ⇒ flags user `require_data_sim`; OWNERSHIP_TRANSFER ⇒ `OwnershipTransferManager.post_send`, whose sub-state lives in `extra.ownership_transfer_state`: `initiated → sent → accepted → completed / expired / deleted`).

*(No other model uses aasm. `DeliveryRequest`, `Payment`, `Refund`, `Invoice`, `ChangePlanLog` use plain status strings/enums as described above.)*

---

## Enums & vendor values

### payments.vendor (string, default `hyperpay`)
Valid set (PaymentVendor validation): **`hyperpay`, `tap`, `tamara`, `apollo`, `salam`**. Selection: `PaymentVendor.select_vendor(payment_type, platform)` → first enabled vendor (by `position`) whose `payment_types[payment_type]`, `platforms[platform]`, and time-window all pass; `salam` only for API protocol >v9; fallback `Setting.default_payment_vendor` (hyperpay). Partial index exists on `vendor='salam' AND status='success'`. Response parsing is convention-based: `Payments::<Vendor.capitalize>::Response`. BNPL vendors (separate axis, in `checkouts.extra.payment_vendor` / `installment_vendors.installment_type`): **`emkan`, `tamara`, `tasheel`**; `checkouts.extra.payment_plan` ∈ `FULL_PRICE` | `INSTALLMENT`.

### payments.payment_on_type (polymorphic + virtual)
Real models: `OnboardingOrder`, `Checkout`. Virtual string types written by `PaymentManager`: `recharge`, `bill` (anonymous bill also stored as `bill`), `termination`, `change_plan`, `sim_replacement`, `advanced_postpaid_payment`, `postpaid_service_recharge` (retired: `woocommerce`). `payment_vendors.payment_types` config additionally names `saleor`, `renewal`, `checkout`, `anonymous_bill`, `dynamic_recharge`, `ownership_transfer` as *payment types* for vendor routing — renewal/saleor/ownership-transfer payments are persisted with `payment_on_type='Checkout'`, dynamic recharge with `'recharge'`.

### payments.status / card_type
`status`: `pending` (default) → `success` | `fail` | `refunded`; virtual `initiated` = pending with blank `payment_commit_response`. `card_type` enum: `apple_pay`=0, `credit_card`=1, `mada`=2, `amex`=3, `stc`=4, `tasheel`=5, `other`=30, `n/a`=60; normalized from PG brand strings via `CARD_TYPES_MAP` (VISA/MASTERCARD→credit_card, MADA→mada, STC/STC_PAY→stc, AMEX→amex, APPLE_PAY→apple_pay, KNET→other).

### checkouts.checkout_type (integer constants)
`0 NORMAL_TYPE`, `1 DATA_SIM_TYPE`, `2 CHANGE_PLAN_TYPE`, `3 REPLACEMENT_TYPE` (SIM/eSIM replacement — esim iff `extra.sim_type == 1`), `4 SALEOR_TYPE` (e-commerce), `5 OWNERSHIP_TRANSFER`, `6 RENEWAL_TYPE`, `7 ADVANCED_POSTPAID_PAYMENT_TYPE`.

### Delivery vendors & status normalization
`delivery_requests.vendor` ∈ **`stcc` (default), `smsa`, `manarat`, `barq`, `tam`, `posa`, `saleor`, `imile`, `oto`** (DeliveryVendor config additionally defines `qr_posa`). Raw courier state strings in `delivery_state` are normalized by `DeliveryRequest#status` via mapping constants:

| normalized status | source (`delivery_state` in…) |
|---|---|
| `pending` | `MAPPED_NEW_STATES` — e.g. `new`, `200`, `SubmitOrder`, `paymentConfirmed`, `waitingAddressConfirmation`, `orderConfirmed`, `pickupFromStore`, … (also default for unknown) |
| `in_progress` | `MAPPED_INPROGRESS_STATES` — huge multi-vendor set: SMSA codes (`OFD`, `PU`, `IC`, `ST44`…), `pickedUp`, `outForDelivery`, `inTransit`, `shipmentCreated`, `searchingDriver`, reverse-shipment states, `PICKING`, `ALLOCATED`, `DeliveryCompleted`(!), … |
| `undelivered` (bucket exists, not surfaced by `#status`) | `MAPPED_UNDELIVERED_STATES` — `DE`, `DEX03*`, `failedAttempt`, `undeliveredAttempt`, `lostOrDamaged`, `rejected`, … |
| `cancelled` | `MAPPED_CANCELLED_STATES` — `cancelled`, `canceled`, `deleted`, `RTO`, `returned`, `shipmentCanceled`, … |
| `refused` | `MAPPED_REFUSED_STATES` — `REFUSED`, `onhold`, `pickup_failed`, `DEX93*`, `RD`, `DEX07*`, … |
| `completed` | `MAPPED_COMPLETED_STATES` — `complete`, `completed`, `DELIVERED`, `DL`, `DEX09`, `POD`, `Delivered`, `delivered` |
| `expired` | computed: `created_at < 1.month.ago` and not completed |

Vendor is chosen by geofence hit (`DeliveryVendor.find_vendor(lat,lng)`, enabled+open, ordered by position; fallback **SMSA**). Completed callbacks harvest ICCIDs (barq: `products[].serial_no`; tam: `unique_references[]`; default: `items[].item_serial`) and link `raw_sims.delivery_request_id`.

### Channel typing (direct / indirect / POSA)
- **Acquisition channel** = `onboarding_orders.flow_type`: `normal` (0, direct D2C), `indirect` (1, seller w/ `seller_deductions` instead of card payment), `posa` (2, point-of-sale activation), `apollo` (3, external partner API), `ownership_transfer` (4), `partner` (5), `visitor_hajj_flow` (6), `qr_posa` (7, retail QR w/ `qr_posa_completions`).
- **Seller typing**: `sellers.seller_type` enum `indirect`=0 / `partner`=1.
- **Plan channel visibility**: `channels` ↔ `plan_channels` m:n (also attributed on `nafath_logs.channel_id`).
- **Platform**: free-string `platform` columns (ios/android/web/huawei) + `payment_vendors.platforms` flags.

### Plan / service typing
- `plans.plan_type`: 1 PREPAID, 2 POSTPAID, 3 HYBRID; `plans.sim_type`: normal_sim=0 / esim=1 / both=2; `plans.bundle_type`: voice=0 / data=1.
- `services.service_type`: booster=0, roaming=1, toggle=2, idd=3, flex_minute=4, flex_data=5, social_data=6, voice_minute=7, voice_data=8.
- `onboarding_orders.number_order_type`: 0 new number / 1 MNP; `sim_type`: 0 normal / 1 eSIM; `delivery_type`: `delivery`/`pickup`/`not_selected`.
- `FeeType` (checkout `items[].type` & fee rows): 0 NUMBER, 1 DELIVERY, 2 VAT, 3 DEPOSIT, 4 TOTAL, 5 DATA_SIM, 6 DUE_AMOUNT, 7 CHANGE_PLAN, 8 SIM_REPLACEMENT, 9 ESIM_REPLACEMENT, 10 SALEOR, 11 INSTALLMENT, 12 OWNERSHIP_TRANSFER, 13 RENEWAL, 14 ADVANCED_POSTPAID_PAYMENT.
- Other notable enums: `invoices.status` (new/created/sent/paid/failed), `refunds.refund_type` (reverse/refund), `nafath_logs.auth_type` (nafath/absher), `change_plan_logs.status` (pending/success/failed), `otps.delivery_method` (sms/email), `admin_users.role` (int).

---

## ER adjacency list

Format: `A → B (relation)`. `[poly]` = polymorphic; virtual payment targets in braces.

```
OnboardingOrder → orderable [poly: AnonymousUser|User|Guest|DeletedUser] (belongs_to)
OnboardingOrder → Plan (belongs_to, optional)
OnboardingOrder → Nationality (belongs_to, optional)
OnboardingOrder → Store (belongs_to, optional)
OnboardingOrder → Seller (belongs_to, optional)
OnboardingOrder → Number (has_one/has_many)
OnboardingOrder → OtpVerification (has_many, as otp_on [poly])
OnboardingOrder → RawSim (has_many, as redeemed_on [poly])
OnboardingOrder → Payment (has_many, as payment_on [poly], counter_cache payments_count)
OnboardingOrder → Invoice (has_one, as invoice_on [poly])
OnboardingOrder → SellerDeduction (has_many)
OnboardingOrder → QrPosaCompletion (has_one)
OnboardingOrder → DeliveryRequest (has_many, as delivery_on [poly])
OnboardingOrder → ActivationLog (has_many, loose FK)
OnboardingOrder → EligibilityLog (has_many, loose FK)
OnboardingOrder → IssuedSim (has_many, via issued_sims.reference_number)

Checkout → checkoutable [poly: User|Guest|AnonymousUser|DeletedUser] (belongs_to)
Checkout → checkout_for [poly: Plan] (belongs_to, optional — change-plan target)
Checkout → Store (belongs_to, optional)
Checkout → Payment (has_many, as payment_on [poly], counter_cache)
Checkout → DeliveryRequest (has_many, as delivery_on [poly])

Payment → payment_on [poly: OnboardingOrder|Checkout|{recharge,bill,termination,change_plan,sim_replacement,advanced_postpaid_payment,postpaid_service_recharge}] (belongs_to, optional)
Payment → Invoice (has_one)
Payment → Refund (has_one)
Payment → TerminationLog (has_one)
Refund → Payment (belongs_to)
Refund → RefundReason (belongs_to)
Refund → AdminUser (belongs_to)
Invoice → invoice_on [poly: OnboardingOrder] (belongs_to)
Invoice → Seller (belongs_to)
Invoice → Payment (belongs_to)
PaymentVendor ⇢ Payment (routing config, no FK)
Installment → InstallmentRefund (has_one)
InstallmentRefund → AdminUser, Installment (belongs_to)

DeliveryRequest → delivery_on [poly: OnboardingOrder|Checkout] (belongs_to, touch)
DeliveryRequest → DeliveryVendor (belongs_to, vendor→name)
DeliveryRequest → RawSim (has_many)
DeliveryVendor → Geofence (has_many, by vendor name)
DeliveryVendor → SimUpload (has_many, by vendor name)
DeliveryCity → DeliveryArea (belongs_to)

SimUpload → AdminUser (belongs_to)
SimUpload → RawSim (has_many)
RawSim → SimUpload, Plan(opt), DeliveryRequest(opt) (belongs_to)
RawSim → redeemed_on [poly: OnboardingOrder] (belongs_to)
IssuedSim → OnboardingOrder (belongs_to, reference_number)

Number → OnboardingOrder (belongs_to)
Number → Vanity (belongs_to, group_id→group_id)
TmpNumber ⇢ Number (promoted, no FK)

User → OnboardingOrder, Checkout (has_many [poly owners])
User → Profile (has_one, as profile_on [poly])
AnonymousUser → OnboardingOrder, Checkout (has_many [poly owners])
AnonymousUser ⇢ NotificationToken (loose anonymous_users_id)
Guest → OnboardingOrder, Checkout, Profile (has_many/has_one [poly owners])
Seller → Invoice, SellerDeduction, OnboardingOrder (has_many)
SellerDeduction → OnboardingOrder, Seller (belongs_to)

Plan → ServicePlan, Subplan, PlanSocialNetwork→SocialNetwork, PlanChannel→Channel,
       PlanCategory→Category, PlanHiddenService→Service, ChangePlanEligibility→Plan(to_plan),
       PlanRuleMap(from/to), Checkout (as checkout_for) (has_many)
Service → Subservice, ServicePlanType, ServiceLog (has_many)
Service → ServiceGroup (belongs_to), Service.parent/children (self-ref)
ServiceGroup → ServiceGroupPricing (has_many); ServiceGroupPricing → ServiceGroupPricingCategory (loose)
ServiceGroupCountry → ServiceGroup, Country (join)
Country → CountryPricing, CountryVisitorOperator (has_many, FK)
CountryPricing → CountryPricingCategory (loose)

NafathLog → Channel (belongs_to, FK)
Channel → PlanChannel, NafathLog (has_many)
TerminationLog → Payment (belongs_to, optional); TerminationLog → SurveyAnswer (has_many)
ChangePlanLog ⇢ User/Guest (by mobile_number), Plan (by optiva_reference), Payment (loose)
Survey → SurveyQuestion → SurveyQuestionOption (has_many, FK); SurveyAnswer ⇢ Survey/Question/Option/TerminationLog (loose)
QrPosaCompletion → OnboardingOrder (belongs_to, unique)
Profile → profile_on [poly: User|Guest] (belongs_to)
OtpVerification → otp_on [poly: OnboardingOrder] (belongs_to)
ActiveAdminComment → resource/author [poly]
Version(PaperTrail) → item [poly: Plan|Service|Seller|Vanity|DeliveryVendor|PaymentVendor|InstallmentVendor|...]
```

Declared DB foreign keys (only 16 — most relations are soft): change_plan_eligibilities→plans(×2), country_pricings→countries, country_visitor_operators→countries, nafath_logs→channels, plan_channels→channels/plans, plan_hidden_services→plans/services, plan_social_networks→plans/social_networks, raw_sims→sim_uploads, service_group_pricings→service_groups, sim_uploads→admin_users, subservices→services, survey_question_options→survey_questions. Everything else (incl. all polymorphics and all UUID↔string joins like `payments.payment_on_id`) is application-enforced; joins on the order side are done as `payment_on_id = onboarding_orders.id::text`.

---

## Volume notes (production row counts)

| Table | Rows | Implication |
|---|---|---|
| `anonymous_users` | 16,000,000 | Largest table — one row per device/app-install; dwarfs real users 31:1. Any device-level join (notification fan-out, `orderable` resolution) must be index-driven; only `device_id` is indexed. |
| `otps` | 11,200,000 | Append-only OTP audit; UUID pk, indexed only on `confirmation_reference`. Effectively a log — candidate for partitioning/pruning. |
| `onboarding_orders` | 8,000,000 | ~16 attempts per activated user — funnel is mostly abandoned orders (`status` scopes + `abandon_notification_level` exist for this). Indexed on aasm_state, status, checkout_id, orderable, plan, seller, UTM columns. |
| `payments` | 4,880,000 | ~0.6 payment attempts per order; mixed real/virtual `payment_on_type` — the `(payment_on_id, payment_on_type, status)` composite index carries the join to orders/checkouts. `payments_bkp` duplicates the shape (one-off ops copy). |
| `activation_logs` | 4,400,000 | Per-BSS-call audit incl. full jsonb request/response — heavy storage; Slack notify on create. |
| `notification_tokens` | 4,200,000 | Push tokens, ~1 per 4 devices; enabled/token indexed. |
| `eligibility_logs` | 2,800,000 | Semati checks across 4 processes; jsonb heavy. |
| `checkouts` | 2,600,000 | Post-acquisition commerce funnel — roughly 1 checkout per 3 orders; UUID pk, `completed`+`checkout_type` indexed. |
| `nafath_logs` | 2,300,000 | ~1 identity verification per 3.5 orders (Nafath/Absher). |
| `numbers` | 1,000,000 | Only reserved MSISDNs kept (reservation churn handled remotely in Optiva; expired ones unreserved via worker). |
| `users` | 506,000 | Actual registered base — the "real" customer count anchor. |
| `delivery_requests` | 362,000 | Physical fulfilment ≈ 4.5% of orders (rest eSIM/POSA/abandoned) — courier volume is small relative to funnel noise. |

Ratios worth remembering for the console: **16M devices → 8M order attempts → ~2.6M checkouts → 4.9M payment attempts → 506K users / 362K deliveries** — i.e. the data model is dominated by funnel exhaust (logs + abandoned attempts), while the transactional core (users, numbers, deliveries) is 1–2 orders of magnitude smaller.
