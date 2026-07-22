/**
 * API_SAMPLES — realistic request/response samples for the Salam MVNO selfcare-backend Rails API.
 *
 * Derived from: config/routes.rb, controllers (params.require/permit + action bodies),
 * jbuilder views (app/views/api/**), and inline render json hashes.
 *
 * PII is SYNTHETIC / MASKED. Never contains real customer data.
 *   mobile "9665XXXXXXXX" / "966500000000" · national id "1000000000" · names "Test User"
 *   emails "user@example.com" · IBAN/cards masked · JWT truncated "eyJ...".
 *
 * Common headers (most endpoints):
 *   Access-Token: "eyJ..."        (JWT — anonymous, guest, or user scope depending on route)
 *   X-Protocol-Version: "v5"      (version selector; ApiVersion constraint reads it)
 *   Accept: "application/json"
 *
 * Error envelope (salam_render_error): { "error": <code:int>, "message": "<localised>" }
 * Success envelope (json_response): raw hash at 200; jbuilder actions render their view tree.
 */

const ANON_HEADERS = { "Access-Token": "eyJ...anon", "X-Protocol-Version": "v5" };
const USER_HEADERS = { "Access-Token": "eyJ...user", "X-Protocol-Version": "v5" };
const SELLER_HEADERS = { "Access-Token": "eyJ...seller", "X-Protocol-Version": "v1" };

const API_SAMPLES = {

  /* ============================ AUTH / DEVICE ============================ */

  "POST /api/auth/device": {
    req: { headers: { "X-Protocol-Version": "v1" }, body: { device_id: "dev-abc-123", platform: "ios" } },
    res: { status: 200, body: { auth_token: "eyJ...anon" } },
    errors: [{ status: 422, body: { error: -1, message: "Invalid validation" } }],
    logSig: "AnonymousUsers::Authentication#create"
  },
  "POST /api/guests/verify": {
    req: { headers: ANON_HEADERS, body: { mobile_number: "966500000000", code: "0000", reference: 12345 } },
    res: { status: 200, body: { auth_token: "eyJ...guest" } },
    errors: [{ status: 422, body: { error: -14, message: "Invalid OTP" } }],
    logSig: "Guests::Authentication#verify"
  },

  /* ============================ ONBOARDING WIZARD ============================ */

  "POST /api/onboarding/orders": {
    req: { headers: ANON_HEADERS, body: { plan_id: 101, channel: "app", flow_type: "new_mobile" } },
    res: { status: 200, body: {
      onboarding_order: {
        order_id: "b0a1c2d3-e4f5-6789-abcd-000000000001", checkout_id: null,
        current_state: "plan_selection", sim_type: 0, require_data_sim: false,
        plan: { id: 101, price: 55, plan_type: 1, title: "Salam 55", sim_type: 0 },
        number_order_type: null, email: null, email_verified: false,
        mobile_number: null, mobile_number_verified: false, number: null,
        eligibility: null, delivery: null, delivery_type: null, mnp_number: null,
        fees: 0, sim_cards: [], has_password: false, flow_type: "new_mobile",
        skip_payment: false, requires_modem_validation: false
      }
    } },
    errors: [
      { status: 422, body: { error: -42, message: "Invalid onboarding plan" } },
      { status: 422, body: { error: -22, message: "No numbers available" } }
    ],
    logSig: "V5::Onboarding::Orders#create → OnboardingOrder.save_plan"
  },
  "GET /api/onboarding/orders/current": {
    req: { headers: USER_HEADERS, body: {} },
    res: { status: 200, body: { onboarding_order: { order_id: "b0a1...001", current_state: "customer_info", plan: { id: 101 } } } },
    errors: [{ status: 422, body: { error: -30, message: "Invalid onboarding order id" } }],
    logSig: "V1::Onboarding::Orders#current"
  },
  "POST /api/onboarding/orders/:id/plans": {
    req: { headers: ANON_HEADERS, body: { plan_id: 101 } },
    res: { status: 200, body: { onboarding_order: { order_id: "b0a1...001", current_state: "number_selection", plan: { id: 101, title: "Salam 55" } } } },
    errors: [{ status: 422, body: { error: -42, message: "Invalid onboarding plan" } }],
    logSig: "V3::Onboarding::Plans#create"
  },
  "POST /api/v3/onboarding/orders/:order_id/sim_type": {
    req: { headers: { ...ANON_HEADERS, "X-Protocol-Version": "v3" }, body: { sim_type: 1 } },
    res: { status: 200, body: { onboarding_order: { order_id: "b0a1...001", sim_type: 1, current_state: "number_selection" } } },
    errors: [{ status: 422, body: { error: -1, message: "Invalid validation" } }],
    logSig: "V3::Onboarding::SimType#create (esim=1 / physical=0)"
  },
  "POST /api/onboarding/orders/:order_id/numbers/order_type": {
    req: { headers: ANON_HEADERS, body: { number_order_type: "random" } },
    res: { status: 200, body: { onboarding_order: { order_id: "b0a1...001", number_order_type: "random", current_state: "number_selection" } } },
    errors: [{ status: 422, body: { error: -18, message: "Service suspended" } }],
    logSig: "V1::Onboarding::Numbers#order_type"
  },
  "POST /api/onboarding/orders/:order_id/numbers/reserve": {
    req: { headers: ANON_HEADERS, body: { identifier: "966560000000", offer_type: "free" } },
    res: { status: 200, body: { onboarding_order: {
      order_id: "b0a1...001", current_state: "customer_info",
      reserved_mobile_number: "966560000000", phone_number: "966560000000",
      number: { identifier: "966560000000", vanity: { name: "Silver", color: "#C0C0C0", price: 0 }, expires_at: "2026-07-09T12:30:00Z" },
      vanity_offer: { has_offer: true, identifier: "966560000000", vanity_name: "Silver", color: "#C0C0C0", price: 0, offer_type: "free", commitment_period: 12 }
    } } },
    errors: [{ status: 422, body: { error: -21, message: "Number already reserved" } }],
    logSig: "V1::Onboarding::Numbers#reserve → order.save_number"
  },
  "DELETE /api/onboarding/orders/:order_id/numbers/unreserve": {
    req: { headers: ANON_HEADERS, body: {} },
    res: { status: 200, body: { onboarding_order: { order_id: "b0a1...001", number: null, current_state: "number_selection" } } },
    errors: [],
    logSig: "V1::Onboarding::Numbers#unreserve"
  },
  "POST /api/onboarding/orders/:order_id/eligibility/is_eligible": {
    req: { headers: ANON_HEADERS, body: { nationality_id: 1, nationality_id_number: "1000000000" } },
    res: { status: 200, body: { onboarding_order: { order_id: "b0a1...001", eligibility: { nationality_id_number: "1000000000", nationality_id: 1, is_eligible: true } } } },
    errors: [{ status: 422, body: { error: -3, message: "Invalid customer info" } }],
    logSig: "V1::Onboarding::Eligibility#is_eligible"
  },
  "POST /api/onboarding/orders/:id/customer_info": {
    req: { headers: ANON_HEADERS, body: { email: "user@example.com", mobile_number: "966500000000" } },
    res: { status: 200, body: { onboarding_order: {
      order_id: "b0a1...001", current_state: "delivery", email: "user@example.com",
      email_verified: false, mobile_number: "966500000000", mobile_number_verified: false
    } } },
    errors: [
      { status: 422, body: { error: -8, message: "Invalid email format" } },
      { status: 422, body: { error: -3, message: "Invalid customer info" } },
      { status: 422, body: { error: -9, message: "Email is registered" } }
    ],
    logSig: "V5::Onboarding::Orders#customer_info"
  },
  "POST /api/onboarding/orders/:id/delivery_info": {
    req: { headers: ANON_HEADERS, body: { delivery_lat: 24.7136, delivery_lng: 46.6753, delivery_notes: "Gate 3", delivery_type: "home", area_id: 5, city_id: 12, delivery_time: "18:00-21:00" } },
    res: { status: 200, body: { onboarding_order: {
      order_id: "b0a1...001", current_state: "payment",
      delivery: { lat: 24.7136, lng: 46.6753, notes: "Gate 3" },
      delivery_lat: 24.7136, delivery_lng: 46.6753, delivery_type: "home", fees: 0
    } } },
    errors: [{ status: 422, body: { error: -10, message: "Invalid delivery info" } }],
    logSig: "V1::Onboarding::Orders#delivery_info"
  },
  "POST /api/onboarding/orders/:id/reset": {
    req: { headers: USER_HEADERS, body: {} },
    res: { status: 200, body: { onboarding_order: { order_id: "b0a1...001", current_state: "plan_selection" } } },
    errors: [{ status: 422, body: { error: -30, message: "Invalid onboarding order id" } }],
    logSig: "V1::Onboarding::Orders#reset"
  },
  "POST /api/onboarding/orders/:id/complete_qr_posa": {
    req: { headers: ANON_HEADERS, body: { modem_sn: "SN-000000", iccid: "8996600000000000000" } },
    res: { status: 200, body: { onboarding_order: { order_id: "b0a1...001", current_state: "activation", flow_type: "qr_posa", skip_payment: true } } },
    errors: [
      { status: 422, body: { error: -113, message: "Invalid modem SN" } },
      { status: 422, body: { error: -30, message: "Order is already completed" } }
    ],
    logSig: "V5::Onboarding::Orders#complete_qr_posa"
  },
  "GET /api/v5/onboarding/orders/:id/get": {
    req: { headers: ANON_HEADERS, body: {} },
    res: { status: 200, body: { onboarding_order: { order_id: "b0a1...001", checkout_id: "co-1", current_state: "payment", status: "inprogress", completed: false, plan: { id: 101 } }, otp: { id: 999, otp_for: "966500000000" } } },
    errors: [{ status: 422, body: { error: -30, message: "Invalid onboarding order id" } }],
    logSig: "V5::Onboarding::Orders#get (mini_order + otp)"
  },
  "POST /api/onboarding/orders/:order_id/mnp": {
    req: { headers: ANON_HEADERS, body: { mnp_number: "966510000000", operator_id: 3 } },
    res: { status: 200, body: { onboarding_order: { order_id: "b0a1...001", mnp_number: "966510000000", current_state: "customer_info" } } },
    errors: [{ status: 422, body: { error: -1, message: "Invalid validation" } }],
    logSig: "V1::Onboarding::Mnp#create"
  },

  /* --- onboarding profiles (guest password) --- */
  "POST /api/onboarding/orders/:order_id/profiles/customer_password": {
    req: { headers: ANON_HEADERS, body: { password: "Passw0rd!", password_confirmation: "Passw0rd!" } },
    res: { status: 200, body: { onboarding_order: { order_id: "b0a1...001", has_password: true } } },
    errors: [{ status: 422, body: { error: -1, message: "Invalid validation" } }],
    logSig: "V1::Onboarding::Profiles#create"
  },
  "POST /api/onboarding/orders/:order_id/profiles/customer_verify": {
    req: { headers: ANON_HEADERS, body: { reference: 999, code: "0000" } },
    res: { status: 200, body: { confirmation_reference: "cref-abc" } },
    errors: [{ status: 422, body: { error: -14, message: "Invalid OTP" } }],
    logSig: "V1::Onboarding::Profiles#customer_verify"
  },
  "POST /api/onboarding/orders/:order_id/profiles/forgot": {
    req: { headers: ANON_HEADERS, body: { mobile_number: "966500000000" } },
    res: { status: 200, body: { reference: 999, received_on: "966500000000" } },
    errors: [{ status: 422, body: { error: -3, message: "Invalid customer info" } }],
    logSig: "V1::Onboarding::Profiles#forgot"
  },

  /* --- OTP (shared) --- */
  "POST /api/otp/verify": {
    req: { headers: ANON_HEADERS, body: { reference: 999, code: "0000", otp_for: "email" } },
    res: { status: 200, body: { verified: true, confirmation_reference: "cref-abc" } },
    errors: [{ status: 422, body: { error: -14, message: "Invalid OTP" } }],
    logSig: "V1::Otp#verify"
  },
  "POST /api/otp/resend": {
    req: { headers: ANON_HEADERS, body: { reference: 999 } },
    res: { status: 200, body: { reference: 1000, received_on: "966500000000" } },
    errors: [{ status: 422, body: { error: -1, message: "Invalid validation" } }],
    logSig: "V1::Otp#resend"
  },

  /* ============================ SEMATI (NAFATH / ABSHER AUTHORIZE) ============================ */

  "POST /api/semati/authorize": {
    req: { headers: ANON_HEADERS, body: { order_id: "b0a1...001", nationality_id_number: "1000000000", service: "new_mobile", auth_type: "nafath" } },
    res: { status: 200, body: { transId: "702c8177-5385-4bb7-a1b7-000000000000", random: "74" } },
    errors: [
      { status: 422, body: { error: -17, message: "Service unavailable" } },
      { status: 422, body: { error: -3, message: "Invalid customer info" } },
      { status: 422, body: { error: -6, message: "NAFATH API ERROR" } }
    ],
    logSig: "Api::SematiController#authorize → nafath_authorize (V1/V2)"
  },
  "GET /api/semati/check": {
    req: { headers: ANON_HEADERS, query: { iam_token: "eyJ...iam", trans_id: "702c8177-..." }, body: {} },
    res: { status: 200, body: { status: "COMPLETED" } },
    errors: [{ status: 422, body: { error: -6, message: "Backend general error" } }],
    logSig: "Api::SematiController#check (cache read of trans_id status)"
  },
  "PATCH /api/semati/authorize_active_user": {
    req: { headers: USER_HEADERS, body: { mobile_number: "966500000000", service: "change_plan", semati_reauth: true } },
    res: { status: 200, body: { transId: "702c8177-...", random: "74" } },
    errors: [{ status: 422, body: { error: -3, message: "Invalid customer info" } }],
    logSig: "Api::SematiController#authorize_active_user"
  },
  "POST /api/sedco/semati/authorize": {
    req: { headers: SELLER_HEADERS, body: { nationality_id_number: "1000000000", service: "new_mobile" } },
    res: { status: 200, body: { transId: "702c8177-...", random: "74" } },
    errors: [{ status: 422, body: { error: -17, message: "Service unavailable" } }],
    logSig: "Sedco::Semati#authorize"
  },
  "GET /api/sedco/semati/token": {
    req: { headers: SELLER_HEADERS, body: {} },
    res: { status: 200, body: { token: "eyJ...sedco" } },
    errors: [],
    logSig: "Sedco::Semati#token"
  },

  /* ============================ PAYMENT ============================ */

  "GET /api/payment/vendor": {
    req: { headers: USER_HEADERS, query: { payment_type: "card" }, body: {} },
    res: { status: 200, body: { current_vendor: "tap" } },
    errors: [],
    logSig: "V1::Payment#vendor → PaymentVendor.select_vendor"
  },
  "GET /api/payment/check": {
    req: { headers: USER_HEADERS, query: { object_type: "OnboardingOrder", object_id: "b0a1...001", amount: "55.00", vendor: "tap" }, body: {} },
    res: { status: 200, body: { supported: ["card", "apple_pay", "tabby"], installment_available: false } },
    errors: [],
    logSig: "V1::Payment#check → PaymentManager.check_payment_options"
  },
  "POST /api/payment/initiate (OnboardingOrder)": {
    req: { headers: USER_HEADERS, body: { object_type: "OnboardingOrder", object_id: "b0a1...001", redirect_url: "salamapp://pay/callback", vendor: "tap", card_type: "mada" } },
    res: { status: 200, body: {
      transaction_id: 5001, checkout_id: "chk_tap_000001", payment_status: "pending",
      vendor: "tap", transaction_url: "https://pay.example.com/chk_tap_000001",
      callback_url: "https://api.salam/payment/tap/callback",
      extra: { transaction_url: "https://pay.example.com/chk_tap_000001", callback_url: "https://api.salam/payment/tap/callback" }
    } },
    errors: [
      { status: 422, body: { error: -30, message: "Invalid onboarding order id" } },
      { status: 422, body: { error: -35, message: "Number expired" } },
      { status: 422, body: { error: -60, message: "Payment invalid" } }
    ],
    logSig: "V1::Payment#initiate → handle_onboarding"
  },
  "POST /api/payment/initiate (recharge)": {
    req: { headers: USER_HEADERS, body: { object_type: "recharge", object_id: 30, mobile_number: "966500000000", redirect_url: "salamapp://pay/callback" } },
    res: { status: 200, body: { transaction_id: 5002, checkout_id: "chk_tap_000002", payment_status: "pending", vendor: "tap", transaction_url: "https://pay.example.com/chk_tap_000002" } },
    errors: [{ status: 422, body: { error: -60, message: "Payment invalid" } }],
    logSig: "V1::Payment#initiate → handle_recharge(denomination_id)"
  },
  "POST /api/payment/initiate (bill)": {
    req: { headers: USER_HEADERS, body: { object_type: "bill", object_id: "INV-100001", partial_payment: false } },
    res: { status: 200, body: { transaction_id: 5003, checkout_id: "chk_tap_000003", payment_status: "pending", vendor: "tap", transaction_url: "https://pay.example.com/chk_tap_000003" } },
    errors: [{ status: 422, body: { error: -60, message: "Payment invalid" } }],
    logSig: "V1::Payment#initiate → handle_bill"
  },
  "POST /api/payment/initiate (saleor)": {
    req: { headers: USER_HEADERS, body: { object_type: "saleor", object_id: 44, redirect_url: "salamapp://pay/callback" } },
    res: { status: 200, body: { transaction_id: 5004, checkout_id: "chk_tap_000004", payment_status: "pending", vendor: "tap", transaction_url: "https://pay.example.com/chk_tap_000004" } },
    errors: [{ status: 422, body: { error: -30, message: "Invalid checkout id" } }],
    logSig: "V1::Payment#initiate → handle_saleor (Checkout.inprogress)"
  },
  "POST /api/payment/initiate (change_plan)": {
    req: { headers: USER_HEADERS, body: { object_type: "change_plan", object_id: 55, redirect_url: "salamapp://pay/callback" } },
    res: { status: 200, body: { transaction_id: 5005, checkout_id: "chk_tap_000005", payment_status: "pending", vendor: "tap", transaction_url: "https://pay.example.com/chk_tap_000005" } },
    errors: [{ status: 422, body: { error: -60, message: "Payment invalid" } }],
    logSig: "V1::Payment#initiate → handle_change_plan"
  },
  "POST /api/payment/initiate (renewal)": {
    req: { headers: USER_HEADERS, body: { object_type: "renewal", object_id: 66 } },
    res: { status: 200, body: { transaction_id: 5006, checkout_id: "chk_tap_000006", payment_status: "pending", vendor: "tap", transaction_url: "https://pay.example.com/chk_tap_000006" } },
    errors: [{ status: 422, body: { error: -60, message: "Payment invalid" } }],
    logSig: "V1::Payment#initiate → handle_renewal"
  },
  "POST /api/payment/initiate (termination)": {
    req: { headers: USER_HEADERS, body: { object_type: "termination", object_id: 77 } },
    res: { status: 200, body: { transaction_id: 5007, checkout_id: "chk_tap_000007", payment_status: "pending", vendor: "tap", transaction_url: "https://pay.example.com/chk_tap_000007" } },
    errors: [{ status: 422, body: { error: -60, message: "Payment invalid" } }],
    logSig: "V1::Payment#initiate → handle_termination"
  },
  "POST /api/payment/initiate (sim_replacement)": {
    req: { headers: USER_HEADERS, body: { object_type: "sim_replacement", object_id: 88 } },
    res: { status: 200, body: { transaction_id: 5008, checkout_id: "chk_tap_000008", payment_status: "pending", vendor: "tap", transaction_url: "https://pay.example.com/chk_tap_000008" } },
    errors: [{ status: 422, body: { error: -30, message: "Invalid checkout id" } }],
    logSig: "V1::Payment#initiate → handle_sim_replacement (un_paid.for_replacement)"
  },
  "POST /api/payment/:id/commit": {
    req: { headers: { "X-Protocol-Version": "v1" }, body: { redirect_url: "salamapp://pay/callback", token: "eyJ...pay" } },
    res: { status: 200, body: { completed: true } },
    errors: [
      { status: 422, body: { error: -61, message: "Payment pending" } },
      { status: 422, body: { error: -60, message: "Payment invalid" } },
      { status: 422, body: { error: -62, message: "Invalid transaction" } }
    ],
    logSig: "V1::Payment#commit (auth skipped) → check_status if pending"
  },
  "GET /api/payment/:id/status": {
    req: { headers: USER_HEADERS, query: { for: "recharge_status" }, body: {} },
    res: { status: 200, body: { status: "success", balance: { available: 45.5, currency: "SAR" }, credit: 0 } },
    errors: [{ status: 422, body: { error: -60, message: "Payment invalid" } }],
    logSig: "V1::Payment#status (cache read <for>_<id>)"
  },
  "POST /api/payment/:id/cancel": {
    req: { headers: USER_HEADERS, body: {} },
    res: { status: 200, body: { completed: true } },
    errors: [{ status: 422, body: { error: -63, message: "Saleor invalid checkout" } }],
    logSig: "V1::Payment#cancel (saleor state=cancel)"
  },

  /* ============================ ACTIVATION ============================ */

  "GET /api/activation/orders": {
    req: { headers: ANON_HEADERS, query: { nationality_id_number: "1000000000", mobile_number: "966560000000" }, body: {} },
    res: { status: 200, body: { orders: [{ order_id: "b0a1...001", plan: { id: 101 }, current_state: "activation", sim_type: 0 }] } },
    errors: [
      { status: 422, body: { error: -20, message: "No orders found within details" } },
      { status: 422, body: { error: -19, message: "Order details mismatch" } }
    ],
    logSig: "V1::Activation#orders"
  },
  "GET /api/activation/validate_iccid": {
    req: { headers: ANON_HEADERS, query: { iccid: "8996600000000000000" }, body: {} },
    res: { status: 200, body: { valid: true } },
    errors: [{ status: 422, body: { error: -31, message: "Invalid ICCID" } }],
    logSig: "V1::Activation#validate_iccid"
  },
  "POST /api/activation": {
    req: { headers: ANON_HEADERS, body: { order_id: "b0a1...001", iccid: "8996600000000000000", iam_token: "eyJ...iam" } },
    res: { status: 200, body: { completed: true, mobile_number: "966560000000", esim_profile_link: null, activated: true } },
    errors: [
      { status: 422, body: { error: -30, message: "Invalid onboarding order id" } },
      { status: 422, body: { error: -31, message: "Invalid ICCID" } },
      { status: 422, body: { error: -32, message: "Invalid IAM" } }
    ],
    logSig: "V1::Activation#create (Oracle activation)"
  },
  "GET /api/activation/can_verify_absher": {
    req: { headers: ANON_HEADERS, query: { mobile_number: "966560000000" }, body: {} },
    res: { status: 200, body: { status: true, trials: 3 } },
    errors: [{ status: 422, body: { error: -11, message: "Invalid mobile number" } }],
    logSig: "V1::Activation#can_verify_absher"
  },

  /* ============================ CHECKOUT ============================ */

  "POST /api/checkout": {
    req: { headers: USER_HEADERS, body: { checkout_type: "plan", checkout_for_id: 101, mobile_number: "966500000000" } },
    res: { status: 200, body: { checkout: {
      order_id: 44, checkout_id: "co-44", checkout_type: "plan",
      delivery: { lat: null, lng: null, notes: null, area_id: null, city_id: null, delivery_time: null, delivery_type: null },
      fees: 0, paid: false, completed: false, items: [], current_state: "created",
      is_payment_required: true, require_mobile_number: true, mobile_number: "966500000000",
      is_esim: false, eligibility: null, contact_number: null, email: null, contact_name: null,
      show_pickup_delivery_type: true, plan: { id: 101, title: "Salam 55" }
    } } },
    errors: [{ status: 422, body: { error: -1, message: "Invalid validation" } }],
    logSig: "V1::Checkout#create"
  },
  "POST /api/checkout/:id/saleor": {
    req: { headers: USER_HEADERS, body: { saleor_checkout_id: "U2FsZW9y", user_saleor_email: "user@example.com" } },
    res: { status: 200, body: { checkout: { order_id: 45, checkout_id: "co-45", checkout_type: "saleor", fees: 120, items: [{ name: "eSIM Device", qty: 1 }], current_state: "created" } } },
    errors: [{ status: 422, body: { error: -63, message: "Saleor invalid checkout" } }],
    logSig: "V9::Checkout#saleor (override) / V1::Checkout#saleor"
  },
  "POST /api/checkout/:id/customer_info": {
    req: { headers: USER_HEADERS, body: { email: "user@example.com", contact_name: "Test User", contact_number: "966500000000" } },
    res: { status: 200, body: { checkout: { order_id: 44, checkout_id: "co-44", email: "user@example.com", contact_name: "Test User", contact_number: "966500000000", current_state: "customer_info" } } },
    errors: [{ status: 422, body: { error: -8, message: "Invalid email format" } }],
    logSig: "V1::Checkout#customer_info"
  },
  "POST /api/checkout/:id/delivery_info": {
    req: { headers: USER_HEADERS, body: { delivery_lat: 24.7136, delivery_lng: 46.6753, area_id: 5, city_id: 12, delivery_time: "18:00-21:00", delivery_type: "home" } },
    res: { status: 200, body: { checkout: { order_id: 44, checkout_id: "co-44", delivery: { lat: 24.7136, lng: 46.6753, area_id: 5, city_id: 12, delivery_type: "home" }, current_state: "delivery" } } },
    errors: [{ status: 422, body: { error: -10, message: "Invalid delivery info" } }],
    logSig: "V1::Checkout#delivery_info"
  },
  "POST /api/checkout/:id/submit": {
    req: { headers: USER_HEADERS, body: {} },
    res: { status: 200, body: { checkout: { order_id: 44, checkout_id: "co-44", completed: true, current_state: "submitted", paid: true } } },
    errors: [{ status: 422, body: { error: -1, message: "Invalid validation" } }],
    logSig: "V1::Checkout#submit"
  },
  "GET /api/checkout/current": {
    req: { headers: USER_HEADERS, body: {} },
    res: { status: 200, body: { checkout: { order_id: 44, checkout_id: "co-44", current_state: "delivery" } } },
    errors: [],
    logSig: "V1::Checkout#current"
  },

  /* ============================ CHANGE PLAN ============================ */

  "GET /api/change_plan/plans/prepaid": {
    req: { headers: { ...USER_HEADERS, "X-Protocol-Version": "v2" }, query: { category_id: 2 }, body: {} },
    res: { status: 200, body: { plans: [{ id: 101, title: "Salam 55", price: 55, plan_type: 1 }] } },
    errors: [],
    logSig: "V2::ChangePlan#prepaid_plans"
  },
  "GET /api/change_plan/plans/postpaid": {
    req: { headers: { ...USER_HEADERS, "X-Protocol-Version": "v2" }, body: {} },
    res: { status: 200, body: { plans: [{ id: 201, title: "Salam Postpaid 120", price: 120, plan_type: 2 }] } },
    errors: [],
    logSig: "V2::ChangePlan#postpaid_plans"
  },
  "PATCH /api/change_plan/otp": {
    req: { headers: { ...USER_HEADERS, "X-Protocol-Version": "v2" }, body: { plan_id: 201 } },
    res: { status: 200, body: { reference: 999, received_on: "966500000000" } },
    errors: [{ status: 422, body: { error: -50, message: "Invalid plan id" } }],
    logSig: "V2/V8::ChangePlan#change_plan"
  },
  "POST /api/change_plan/verify_otp": {
    req: { headers: { ...USER_HEADERS, "X-Protocol-Version": "v8" }, body: { reference: 999, code: "0000" } },
    res: { status: 200, body: { message: "success", checkout_id: 55 } },
    errors: [
      { status: 422, body: { error: -14, message: "Invalid OTP" } },
      { status: 422, body: { error: -18, message: "Service suspended" } }
    ],
    logSig: "V8::ChangePlan#change_plan_otp (creates checkout for paid switch)"
  },
  "POST /api/change_plan/process_postpaid": {
    req: { headers: { ...USER_HEADERS, "X-Protocol-Version": "v2" }, body: { checkout_id: "co-55" } },
    res: { status: 200, body: { result: true } },
    errors: [
      { status: 422, body: { error: -70, message: "Invalid checkout" } },
      { status: 422, body: { error: -17, message: "Service unavailable" } }
    ],
    logSig: "V2::ChangePlan#change_plan_post (postpaid zero-payment)"
  },
  "GET /api/change_plan/eligibility": {
    req: { headers: { ...USER_HEADERS, "X-Protocol-Version": "v2" }, query: { plan_id: 201 }, body: {} },
    res: { status: 200, body: { result: true } },
    errors: [{ status: 422, body: { error: -50, message: "Invalid plan id" } }],
    logSig: "V2::ChangePlan#check_plan_switching_eligibility"
  },
  "POST /api/change_plan/iam": {
    req: { headers: { ...USER_HEADERS, "X-Protocol-Version": "v2" }, body: { iam_token: "eyJ...iam", plan_id: 201 } },
    res: { status: 200, body: { result: true } },
    errors: [{ status: 422, body: { error: -32, message: "Invalid IAM" } }],
    logSig: "V2::ChangePlan#change_plan_iam"
  },

  /* ============================ RECHARGE ============================ */

  "POST /api/recharge/voucher": {
    req: { headers: USER_HEADERS, body: { voucher: "1234-5678-9012-3456", mobile_number: "966500000000" } },
    res: { status: 200, body: { completed: true } },
    errors: [{ status: 422, body: { error: -80, message: "Voucher recharge failed" } }],
    logSig: "V1::Recharge#voucher"
  },
  "POST /api/recharge/anonymous_voucher": {
    req: { headers: ANON_HEADERS, body: { voucher: "1234-5678-9012-3456", mobile_number: "966500000000" } },
    res: { status: 200, body: { completed: true } },
    errors: [{ status: 422, body: { error: -80, message: "Voucher recharge failed" } }],
    logSig: "V1::Recharge#voucher (anonymous alias)"
  },
  "GET /api/recharge/validate_details": {
    req: { headers: ANON_HEADERS, query: { mobile_number: "966500000000", nationality_id_number: "1000000000" }, body: {} },
    res: { status: 200, body: { plan_type: 2, amount: 120.0, account_id: "ACC-100000", last_invoice_due_date: "2026-07-25" } },
    errors: [{ status: 422, body: { error: -81, message: "Data mismatch" } }],
    logSig: "V1::Recharge#validate_details"
  },
  "GET /api/recharge/validate_details_with_account": {
    req: { headers: ANON_HEADERS, query: { account_id: "ACC-100000", mobile_number: "966500000000" }, body: {} },
    res: { status: 200, body: { plan_type: 2, amount: 120.0, account_id: "ACC-100000", last_invoice_due_date: "2026-07-25" } },
    errors: [
      { status: 422, body: { error: -82, message: "Plan not eligible for this service" } },
      { status: 422, body: { error: -81, message: "Data mismatch" } }
    ],
    logSig: "V1::Recharge#validate_details_with_account (postpaid)"
  },

  /* ============================ DYNAMIC RECHARGE ============================ */

  "GET /api/dynamic_recharge/details": {
    req: { headers: USER_HEADERS, body: {} },
    res: { status: 200, body: { min_amount: 5.0, max_amount: 500.0, currency: "SAR", eligible: true } },
    errors: [{ status: 422, body: { error: -82, message: "Plan not eligible for this service" } }],
    logSig: "V1::DynamicRecharges#details"
  },
  "POST /api/dynamic_recharge/recharge": {
    req: { headers: USER_HEADERS, body: { amount: 50.0 } },
    res: { status: 200, body: { transaction_id: 6001, amount: 50.0, status: "pending" } },
    errors: [{ status: 422, body: { error: -83, message: "Invalid recharge amount" } }],
    logSig: "V1::DynamicRecharges#recharge"
  },

  /* ============================ BILLS ============================ */

  "GET /api/bill/list": {
    req: { headers: USER_HEADERS, body: {} },
    res: { status: 200, body: { bills: [{ invoice_id: "INV-100001", amount: 120.0, status: "unpaid", due_date: "2026-07-25", issued_at: "2026-07-01" }] } },
    errors: [],
    logSig: "V1::Bills#list"
  },
  "GET /api/bill/generate_pdf": {
    req: { headers: USER_HEADERS, query: { invoice_id: "INV-100001", file_format: "pdf" }, body: {} },
    res: { status: 200, body: { pdf: "JVBERi0xLjQK...base64..." } },
    errors: [{ status: 422, body: { error: -90, message: "Bill PDF not found" } }],
    logSig: "V1::Bills#generate_pdf"
  },

  /* ============================ USERS (SELFCARE) ============================ */

  "POST /api/users/sign_in": {
    req: { headers: ANON_HEADERS, body: { mobile_number: "966500000000", password: "Passw0rd!" } },
    res: { status: 200, body: {
      id: 4321, mobile_number: "966500000000", contact_number: null, email: "user@example.com",
      is_email_verified: true, optiva_account_id: "ACC-100000", auth_token: "eyJ...user",
      status: { active: true }, balance: { available: 45.5, currency: "SAR" },
      plan_type: 1, has_delivery: false, is_registered: true, hybrid_account: false
    } },
    errors: [
      { status: 422, body: { error: -4, message: "Invalid login credentials" } },
      { status: 422, body: { error: -100, message: "Plan not registered" } }
    ],
    logSig: "V1::Users::Authentication#create → customers/customer"
  },
  "POST /api/users/verify": {
    req: { headers: ANON_HEADERS, body: { mobile_number: "966500000000", code: "0000", reference: 999 } },
    res: { status: 200, body: { id: 4321, mobile_number: "966500000000", auth_token: "eyJ...user", plan_type: 1 } },
    errors: [{ status: 422, body: { error: -14, message: "Invalid OTP" } }],
    logSig: "V1::Users::Authentication#verify → customers/customer"
  },
  "GET /api/users/current": {
    req: { headers: USER_HEADERS, body: {} },
    res: { status: 200, body: { id: 4321, mobile_number: "966500000000", email: "user@example.com", plan_type: 1, balance: { available: 45.5, currency: "SAR" }, status: { active: true } } },
    errors: [],
    logSig: "V1::Users#current → customers/customer"
  },
  "GET /api/users/dashboard": {
    req: { headers: USER_HEADERS, body: {} },
    res: { status: 200, body: {
      profile: { id: 4321, mobile_number: "966500000000", plan_type: 1, balance: { available: 45.5, currency: "SAR" } },
      bundles: { optiva_plan_id: "OPT-101", plan_name: "Salam 55", plan_type: 1, bundles: [{ name: "Data", remaining: "12 GB", total: "20 GB" }] },
      plan: { id: 101, title: "Salam 55", price: 55 },
      boosters: null, data_bundles: null
    } },
    errors: [],
    logSig: "V1::Users#dashboard → customers/dashboard"
  },
  "GET /api/users/current_bill": {
    req: { headers: USER_HEADERS, body: {} },
    res: { status: 200, body: { invoice_id: "INV-100001", amount: 120.0, status: "unpaid", due_date: "2026-07-25" } },
    errors: [],
    logSig: "V1::Users#current_bill"
  },
  "GET /api/users/bundles": {
    req: { headers: USER_HEADERS, body: {} },
    res: { status: 200, body: { optiva_plan_id: "OPT-101", plan_name: "Salam 55", plan_type: 1, bundles: [{ name: "Voice", remaining: "unlimited" }] } },
    errors: [],
    logSig: "V1::Users#bundles"
  },
  "GET /api/users/manage_sims": {
    req: { headers: USER_HEADERS, body: {} },
    res: { status: 200, body: { numbers: [{ mobile_number: "966500000000", status: "active", is_primary: true }] } },
    errors: [],
    logSig: "V1::Users#manage_sims"
  },
  "GET /api/users/check_transfer_balance": {
    req: { headers: USER_HEADERS, query: { target_mobile_number: "966510000000" }, body: {} },
    res: { status: 200, body: { available: 20.0, min: 1.0, max: 20.0, eligible: true } },
    errors: [{ status: 422, body: { error: -17, message: "coming soon" } }],
    logSig: "V1::Users#check_transfer_balance (Setting.enable_data_transfer)"
  },
  "POST /api/users/transfer_balance": {
    req: { headers: USER_HEADERS, body: { target_mobile_number: "966510000000", balance: 5 } },
    res: { status: 200, body: { status: true, request: { balance: 5 }, response: { code: 0 } } },
    errors: [
      { status: 422, body: { error: -62, message: "Invalid transaction" } },
      { status: 422, body: { error: -101, message: "Invalid data balance" } }
    ],
    logSig: "V1::Users#transfer_balance"
  },

  /* --- users/profile management --- */
  "PATCH /api/users/profile/email": {
    req: { headers: USER_HEADERS, body: { email: "new@example.com" } },
    res: { status: 200, body: { reference: 999, received_on: "new@example.com" } },
    errors: [{ status: 422, body: { error: -8, message: "Invalid email format" } }],
    logSig: "V1::Profiles#email"
  },
  "GET /api/users/profile/plan_summary": {
    req: { headers: USER_HEADERS, body: {} },
    res: { status: 200, body: { plan: { id: 101, title: "Salam 55", price: 55 }, renewal_date: "2026-08-01" } },
    errors: [],
    logSig: "V1::Profiles#plan_summary → profiles/plan_summary"
  },
  "GET /api/users/profile/balance_summary": {
    req: { headers: USER_HEADERS, body: {} },
    res: { status: 200, body: { balance: { available: 45.5, currency: "SAR" }, credit: 0 } },
    errors: [],
    logSig: "V1::Profiles#balance_summary → profiles/balance_summary"
  },
  "GET /api/users/profile/denominations_eligibility": {
    req: { headers: USER_HEADERS, body: {} },
    res: { status: 200, body: { eligible: true, denominations: [{ id: 30, amount: 30 }, { id: 50, amount: 50 }] } },
    errors: [],
    logSig: "V1::Profiles#denominations_eligibility"
  },
  "PATCH /api/users/profile/credit_transfer": {
    req: { headers: USER_HEADERS, body: { target_mobile_number: "966510000000", amount: 10, denomination_id: 30 } },
    res: { status: 200, body: { reference: 999, received_on: "966500000000" } },
    errors: [{ status: 422, body: { error: -82, message: "Plan not eligible for credit transfer" } }],
    logSig: "V1::Profiles#credit_transfer"
  },
  "PATCH /api/users/profile/terminate_number": {
    req: { headers: USER_HEADERS, body: {} },
    res: { status: 200, body: { reference: 999, received_on: "966500000000" } },
    errors: [{ status: 422, body: { error: -17, message: "Service unavailable" } }],
    logSig: "V1::Profiles#terminate_number"
  },

  /* ============================ SELLERS ============================ */

  "POST /api/sellers/sign_in": {
    req: { headers: { "X-Protocol-Version": "v1" }, body: { username: "seller01", password: "Passw0rd!" } },
    res: { status: 200, body: { reference: 999, received_on: "9665XXXXXXXX" } },
    errors: [{ status: 422, body: { error: -102, message: "Invalid seller credentials" } }],
    logSig: "V1::Sellers::Authentication#create (sends OTP)"
  },
  "POST /api/sellers/verify_otp": {
    req: { headers: { "X-Protocol-Version": "v1" }, body: { reference: 999, code: "0000" } },
    res: { status: 200, body: { auth_token: "eyJ...seller", seller: { id: 12, name: "Test Seller", seller_type: "partner" } } },
    errors: [{ status: 422, body: { error: -14, message: "Invalid OTP" } }],
    logSig: "V1::Sellers::Authentication#verify_otp"
  },

  /* ============================ INVOICES (SELLER) ============================ */

  "GET /api/invoices/check_balance": {
    req: { headers: SELLER_HEADERS, query: { amount: "120.00" }, body: {} },
    res: { status: 200, body: { sufficient: true } },
    errors: [{ status: 501, body: { error: -6, message: "Backend general error" } }],
    logSig: "V1::Invoices#check_balance"
  },
  "POST /api/invoices/deduct_amount/:order_id": {
    req: { headers: SELLER_HEADERS, body: { amount: "55.00" } },
    res: { status: 200, body: { message: "deducted" } },
    errors: [
      { status: 501, body: { error: -30, message: "Invalid onboarding order id" } },
      { status: 501, body: { error: -103, message: "Credit transfer invalid amount" } }
    ],
    logSig: "V1::Invoices#deduct_amount"
  },
  "GET /api/invoices/send_invoice/:onboarding_order_id": {
    req: { headers: SELLER_HEADERS, body: {} },
    res: { status: 200, body: { id: 700, invoice_no: "INV-700", status: "invoice_sent", amount: 55.0, invoice_url: "https://bill.example.com/INV-700", sent_by: "seller01" } },
    errors: [{ status: 522, body: { error: -104, message: "Hyperbill general error" } }],
    logSig: "V1::Invoices#send_invoice"
  },
  "GET /api/invoices/get_status/:id": {
    req: { headers: SELLER_HEADERS, body: {} },
    res: { status: 200, body: { id: 700, invoice_no: "INV-700", status: "invoice_paid", amount: 55.0, invoice_url: "https://bill.example.com/INV-700", sent_by: "seller01" } },
    errors: [{ status: 422, body: { error: -105, message: "Invalid Invoice Id" } }],
    logSig: "V1::Invoices#get_status"
  },

  /* ============================ APOLLO (Tygo/partner storefront) ============================ */

  "POST /api/apollo/eligibility": {
    req: { headers: ANON_HEADERS, body: { eligibility: { nationality_id: 1, nationality_id_number: "1000000000", mobile_number: "966500000000" } } },
    res: { status: 200, body: { is_eligible: true } },
    errors: [{ status: 422, body: { error: -1, message: "Invalid validation" } }],
    logSig: "Apollo::Eligibility#create (params.require(:eligibility))"
  },
  "POST /api/apollo/checkout": {
    req: { headers: ANON_HEADERS, body: { plan_id: 101, sim_type: 0, number_identifier: "966560000000" } },
    res: { status: 200, body: { onboarding_order: { order_id: "b0a1...001", current_state: "customer_info", plan: { id: 101 } } } },
    errors: [{ status: 422, body: { error: -22, message: "No numbers available" } }],
    logSig: "Apollo::Checkout#create (ApolloCheckoutController concern)"
  },
  "POST /api/apollo/checkout/confirm": {
    req: { headers: ANON_HEADERS, body: { salam_order_id: "b0a1...001", otp_id: 999 } },
    res: { status: 200, body: { onboarding_order: { order_id: "b0a1...001", current_state: "payment", completed: false } } },
    errors: [
      { status: 422, body: { error: -30, message: "Invalid onboarding order id" } },
      { status: 422, body: { error: -14, message: "Invalid OTP" } },
      { status: 422, body: { error: -35, message: "Number expired" } }
    ],
    logSig: "Apollo::Checkout#confirm (aasm_state must be 'payment')"
  },
  "POST /api/apollo/checkout/otp_resend": {
    req: { headers: ANON_HEADERS, body: { salam_order_id: "b0a1...001" } },
    res: { status: 200, body: { otp: { id: 999, otp_for: "966500000000" } } },
    errors: [{ status: 422, body: { error: -30, message: "Invalid onboarding order id" } }],
    logSig: "Apollo::Checkout#otp_resend"
  },
  "POST /api/apollo/checkout/refund": {
    req: { headers: ANON_HEADERS, body: { salam_order_id: "b0a1...001" } },
    res: { status: 200, body: { completed: true } },
    errors: [
      { status: 422, body: { error: -30, message: "Invalid onboarding order id" } },
      { status: 422, body: { error: -60, message: "Payment invalid" } },
      { status: 422, body: { error: -61, message: "Payment pending" } }
    ],
    logSig: "Apollo::Checkout#refund"
  },
  "POST /api/apollo/activation": {
    req: { headers: ANON_HEADERS, body: { order_id: "b0a1...001", iccid: "8996600000000000000", iam_token: "eyJ...iam" } },
    res: { status: 200, body: { completed: true, mobile_number: "966560000000", activated: true } },
    errors: [{ status: 422, body: { error: -31, message: "Invalid ICCID" } }],
    logSig: "Apollo::Activation#create (ActivationController concern)"
  },
  "GET /api/apollo/checkout/esim_details": {
    req: { headers: ANON_HEADERS, query: { mobile_number: "966560000000", order_id: "b0a1...001" }, body: {} },
    res: { status: 200, body: { iccid: "8996600000000000000", esim_profile_link: "LPA:1$rsp.example.com$AB-CD", activation_code: "AB-CD" } },
    errors: [{ status: 422, body: { error: -33, message: "Invalid eSIM ICCID" } }],
    logSig: "Apollo::Checkout#esim_details"
  },

  /* ============================ SIM REPLACEMENT ============================ */

  "GET /api/sim_replacement/validate_user_details": {
    req: { headers: ANON_HEADERS, query: { mobile_number: "966500000000", nationality: 1, nationality_id_number: "1000000000" }, body: {} },
    res: { status: 200, body: { valid: true, checkout_id: 88 } },
    errors: [
      { status: 422, body: { error: -81, message: "Data mismatch" } },
      { status: 422, body: { error: -11, message: "Invalid mobile number" } }
    ],
    logSig: "V1::SimReplacement#validate_user_details"
  },
  "PATCH /api/sim_replacement/:id/double_auth": {
    req: { headers: ANON_HEADERS, body: { selected_type: "email", email: "user@example.com" } },
    res: { status: 200, body: { reference: 999, received_on: "user@example.com" } },
    errors: [
      { status: 422, body: { error: -8, message: "Invalid email format" } },
      { status: 422, body: { error: -81, message: "Data mismatch" } }
    ],
    logSig: "V1::SimReplacement#double_auth"
  },
  "POST /api/sim_replacement/:id/double_auth_otp": {
    req: { headers: ANON_HEADERS, body: { reference: 999, otp: "0000" } },
    res: { status: 200, body: { verified: true } },
    errors: [{ status: 422, body: { error: -14, message: "Invalid OTP" } }],
    logSig: "V1::SimReplacement#double_auth_otp"
  },
  "POST /api/sim_replacement/:id/activate": {
    req: { headers: ANON_HEADERS, body: { reference: 999, otp: "0000", iccid: "8996600000000000000", iam_token: "eyJ...iam" } },
    res: { status: 200, body: { completed: true, esim_profile_link: null } },
    errors: [{ status: 422, body: { error: -14, message: "Invalid OTP" } }],
    logSig: "V1::SimReplacement#activate"
  },

  /* ============================ OWNERSHIP TRANSFER ============================ */

  "POST /api/ownership_transfer/verify": {
    req: { headers: ANON_HEADERS, body: { nationality_id: 1, nationality_id_number: "1000000000", contact_mobile_number: "966500000000" } },
    res: { status: 200, body: { reference: 999, received_on: "966500000000", order_id: 44 } },
    errors: [
      { status: 442, body: { error: -20, message: "No orders found within details" } },
      { status: 442, body: { error: -219, message: "Ownership transfer request expired" } }
    ],
    logSig: "V1::OwnershipTransfer#verify"
  },
  "POST /api/ownership_transfer/:id/verify_otp": {
    req: { headers: ANON_HEADERS, body: { reference: 999, code: "0000" } },
    res: { status: 200, body: { checkout_id: 44, plan: { id: 101, title: "Salam 55" }, fees: 0, mobile_number: "966560000000" } },
    errors: [
      { status: 422, body: { error: -70, message: "Invalid checkout" } },
      { status: 422, body: { error: -14, message: "Invalid OTP" } }
    ],
    logSig: "V1::OwnershipTransfer#verify_otp → OwnershipTransferManager.checkout_details"
  },

  /* ============================ MNP ============================ */

  "POST /api/mnp/cancel_mnp": {
    req: { headers: ANON_HEADERS, body: { mobile_number: "966510000000", absher_mobile_number: "966500000000", nationality_id_number: "1000000000" } },
    res: { status: 200, body: { reference: 999, received_on: "966510000000" } },
    errors: [
      { status: 422, body: { error: -110, message: "Invalid MNP info" } },
      { status: 422, body: { error: -111, message: "MNP order not found" } }
    ],
    logSig: "V1::Mnp#cancel_mnp"
  },
  "POST /api/mnp/cancel_mnp_otp": {
    req: { headers: ANON_HEADERS, body: { reference: 999, code: "0000" } },
    res: { status: 200, body: { completed: true } },
    errors: [
      { status: 422, body: { error: -14, message: "Invalid OTP" } },
      { status: 422, body: { error: -112, message: "MNP order accepted" } }
    ],
    logSig: "V1::Mnp#cancel_mnp_otp"
  },

  /* ============================ DATASIMS ============================ */

  "GET /api/datasims/is_eligible": {
    req: { headers: USER_HEADERS, body: {} },
    res: { status: 200, body: { status: true } },
    errors: [],
    logSig: "V1::Datasims#is_eligible"
  },
  "POST /api/datasims/activate": {
    req: { headers: USER_HEADERS, body: { iccid: "8996600000000000000", iam_token: "eyJ...iam" } },
    res: { status: 200, body: { completed: true } },
    errors: [
      { status: 422, body: { error: -120, message: "Plan not eligible for data service" } },
      { status: 422, body: { error: -31, message: "Invalid ICCID" } },
      { status: 422, body: { error: -32, message: "Invalid IAM" } },
      { status: 422, body: { error: -22, message: "No numbers available" } }
    ],
    logSig: "V1::Datasims#activate"
  },

  /* ============================ SERVICES ============================ */

  "GET /api/services": {
    req: { headers: USER_HEADERS, query: { subscribed: "false" }, body: {} },
    res: { status: 200, body: { services: [{ id: 10, name: "Roaming", enabled: true, active: false, price: 25 }] } },
    errors: [],
    logSig: "V1::Services#index → services/index"
  },
  "POST /api/services/:service/activate": {
    req: { headers: USER_HEADERS, body: { id: 10 } },
    res: { status: 200, body: { completed: true } },
    errors: [
      { status: 422, body: { error: -18, message: "Service suspended" } },
      { status: 422, body: { error: -130, message: "Insufficient balance" } },
      { status: 422, body: { error: -131, message: "Duplicated active service" } }
    ],
    logSig: "V1::Services#activate"
  },
  "POST /api/services/:service/deactivate": {
    req: { headers: USER_HEADERS, body: { id: 10 } },
    res: { status: 200, body: { completed: true } },
    errors: [{ status: 422, body: { error: -18, message: "Service suspended" } }],
    logSig: "V1::Services#deactivate"
  },
  "GET /api/services/service_groups": {
    req: { headers: USER_HEADERS, query: { service_type: "roaming", detailed: "true" }, body: {} },
    res: { status: 200, body: { service_groups: [{ id: 3, name: "Travel", services: [{ id: 10, name: "Roaming" }] }] } },
    errors: [],
    logSig: "V1::Services#service_groups"
  },

  /* ============================ RENEWALS ============================ */

  "GET /api/renewal/checkout": {
    req: { headers: USER_HEADERS, body: {} },
    res: { status: 200, body: { plan: { id: 101, title: "Salam 55", price: 55 }, amount: 55.0, renewal_date: "2026-08-01" } },
    errors: [],
    logSig: "V1::Renewals#checkout"
  },
  "POST /api/renewal/renew_otp": {
    req: { headers: USER_HEADERS, body: {} },
    res: { status: 200, body: { reference: 999, received_on: "966500000000" } },
    errors: [{ status: 422, body: { error: -18, message: "Service suspended" } }],
    logSig: "V1::Renewals#renew_otp"
  },
  "PATCH /api/renewal/renew": {
    req: { headers: USER_HEADERS, body: { reference: 999, code: "0000" } },
    res: { status: 200, body: { completed: true, checkout_id: 66 } },
    errors: [{ status: 422, body: { error: -14, message: "Invalid OTP" } }],
    logSig: "V1::Renewals#renew"
  },

  /* ============================ LOOKUPS ============================ */

  "GET /api/lookup/nationalities": {
    req: { headers: ANON_HEADERS, body: {} },
    res: { status: 200, body: { nationalities: [{ id: 1, name: "Saudi", iso3: "SAU" }, { id: 2, name: "Egyptian", iso3: "EGY" }] } },
    errors: [],
    logSig: "V1::Lookup#nationalities"
  },
  "GET /api/lookup/nationalities_and_id_types": {
    req: { headers: ANON_HEADERS, body: {} },
    res: { status: 200, body: { nationalities: [{ id: 1, name: "Saudi" }], id_types: [{ id: 1, name: "National ID" }, { id: 2, name: "Iqama" }] } },
    errors: [],
    logSig: "V1::Lookup#nationalities_and_id_types"
  },
  "GET /api/lookup/app_config": {
    req: { headers: ANON_HEADERS, body: {} },
    res: { status: 200, body: { min_ios_version: "3.2.0", min_android_version: "3.2.0", force_update: false, maintenance: false, enable_ownership_transfer: true } },
    errors: [],
    logSig: "V1::Lookup#app_config"
  },
  "GET /api/lookup/operators": {
    req: { headers: ANON_HEADERS, body: {} },
    res: { status: 200, body: { operators: [{ id: 1, name: "STC" }, { id: 2, name: "Mobily" }, { id: 3, name: "Zain" }] } },
    errors: [],
    logSig: "V1::Lookup#operators (MnpOperator.lookup)"
  },
  "GET /api/lookup/home_delivery_areas": {
    req: { headers: ANON_HEADERS, body: {} },
    res: { status: 200, body: { areas: [{ id: 5, name: "Riyadh" }, { id: 6, name: "Jeddah" }] } },
    errors: [],
    logSig: "V1::Lookup#home_delivery_areas"
  },
  "GET /api/lookup/home_delivery_areas/:area_id/cities": {
    req: { headers: ANON_HEADERS, body: {} },
    res: { status: 200, body: { cities: [{ id: 12, name: "Al Olaya" }] } },
    errors: [{ status: 422, body: { error: -140, message: "Invalid area id" } }],
    logSig: "V1::Lookup#cities"
  },
  "GET /api/lookup/esim_devices": {
    req: { headers: ANON_HEADERS, body: {} },
    res: { status: 200, body: [{ brand: "Apple", model: "iPhone 15", supported: true }] },
    errors: [],
    logSig: "V1::Lookup#esim_devices"
  },
  "GET /api/lookup/credit_denominations": {
    req: { headers: ANON_HEADERS, body: {} },
    res: { status: 200, body: { credit_denominations: [{ id: 30, amount: 30 }, { id: 50, amount: 50 }] } },
    errors: [],
    logSig: "V1::Lookup#credit_denominations → credit_denominations/index"
  },

  /* ============================ PLANS / NUMBERS / CATEGORIES ============================ */

  "GET /api/plans": {
    req: { headers: ANON_HEADERS, body: {} },
    res: { status: 200, body: { plans: [{
      id: 101, optiva_reference: "OPT-101", price: 55, original_price: 65, display_price: "55 SAR",
      discount_rate: "15%", plan_type: 1, sim_type: 0, title: "Salam 55", summary: "20GB + unlimited",
      validity: 30, validity_text: "30 days", has_data_sim: true, bundle_type: "monthly",
      recommended: true, popular: false, categories: [{ id: 2, name: "Prepaid" }],
      subplans: [], eligible_vanity_offer: true
    }] } },
    errors: [],
    logSig: "V1::Plans#index → plans/index (_plan)"
  },
  "GET /api/plans/prepaid": {
    req: { headers: ANON_HEADERS, body: {} },
    res: { status: 200, body: { plans: [{ id: 101, title: "Salam 55", price: 55, plan_type: 1 }] } },
    errors: [],
    logSig: "V1::Plans#prepaid"
  },
  "GET /api/plans/:id": {
    req: { headers: ANON_HEADERS, body: {} },
    res: { status: 200, body: { plan: { id: 101, title: "Salam 55", price: 55, plan_type: 1, subplans: [], categories: [{ id: 2, name: "Prepaid" }] } } },
    errors: [],
    logSig: "V1::Plans#show → plans/show"
  },
  "GET /api/numbers": {
    req: { headers: ANON_HEADERS, query: { plan_id: 101 }, body: {} },
    res: { status: 200, body: { numbers: [{ identifier: "966560000000", vanity: { name: "Silver", price: 0 } }] } },
    errors: [],
    logSig: "V1::Numbers#index"
  },
  "GET /api/numbers/vanities": {
    req: { headers: ANON_HEADERS, body: {} },
    res: { status: 200, body: { vanities: [{ id: 1, name: "Gold", color: "#FFD700", price: 200, commitment_period: 12 }] } },
    errors: [],
    logSig: "V1::Numbers#vanities → numbers/vanities"
  },
  "GET /api/numbers/credit_transfer_eligibility": {
    req: { headers: USER_HEADERS, query: { mobile_number: "966510000000" }, body: {} },
    res: { status: 200, body: { mobile_number: "966510000000", eligible: true } },
    errors: [
      { status: 422, body: { error: -11, message: "Invalid mobile number" } },
      { status: 422, body: { error: -141, message: "Invalid salam number" } }
    ],
    logSig: "V1::Numbers#credit_transfer_eligibility"
  },

  /* ============================ ELIGIBILITY (public) ============================ */

  "GET /api/eligibility": {
    req: { headers: ANON_HEADERS, body: {} },
    res: { status: 200, body: { id_types: [{ id: 1, name: "National ID" }], nationalities: [{ id: 1, name: "Saudi" }], visa_types: [{ id: 1, name: "Work" }] } },
    errors: [],
    logSig: "V1::Eligibility#index → eligibility/index"
  },
  "POST /api/eligibility/is_eligible": {
    req: { headers: ANON_HEADERS, body: { nationality_id: 1, nationality_id_number: "1000000000", plan_id: 101 } },
    res: { status: 200, body: { is_eligible: true } },
    errors: [{ status: 422, body: { error: -3, message: "Invalid customer info" } }],
    logSig: "V1::Eligibility#is_eligible"
  },

  /* ============================ DELIVERIES ============================ */

  "GET /api/deliveries/requests": {
    req: { headers: USER_HEADERS, body: {} },
    res: { status: 200, body: { requests: [{ shipment_id: "SHP-100001", delivery_status: "out_for_delivery", updated_at: "2026-07-09T09:00:00Z", order_id: "b0a1...001" }] } },
    errors: [],
    logSig: "V1::Deliveries#requests → deliveries/requests (_delivery_request)"
  },

  /* ============================ REMEDY OTP ============================ */

  "POST /api/remedy/otp": {
    req: { headers: ANON_HEADERS, body: { mobile_number: "966500000000", nationality_id_number: "1000000000" } },
    res: { status: 200, body: { reference: 999, received_on: "966500000000" } },
    errors: [{ status: 422, body: { error: -1, message: "Invalid validation" } }],
    logSig: "V1::Remedy::Otp#create"
  },
  "POST /api/remedy/otp/verify": {
    req: { headers: ANON_HEADERS, body: { reference: 999, code: "0000" } },
    res: { status: 200, body: { id: 4321, mobile_number: "966500000000", auth_token: "eyJ...user" } },
    errors: [{ status: 422, body: { error: -14, message: "Invalid OTP" } }],
    logSig: "V1::Remedy::Otp#verify → customers/customer"
  },

  /* ============================ EMKAN VOUCHERS (installment) ============================ */

  "POST /api/emkan/vouchers/validate_voucher": {
    req: { headers: USER_HEADERS, body: { voucher_code: "EMK-000000" } },
    res: { status: 200, body: { valid: true, amount: 500.0, currency: "SAR" } },
    errors: [{ status: 422, body: { error: -1, message: "Invalid validation" } }],
    logSig: "V1::Emkan::Vouchers#validate_voucher"
  },
  "POST /api/emkan/vouchers/redeem": {
    req: { headers: USER_HEADERS, body: { voucher_code: "EMK-000000", object_type: "OnboardingOrder", object_id: "b0a1...001" } },
    res: { status: 200, body: { redeemed: true, reference: "EMK-REF-1" } },
    errors: [{ status: 422, body: { error: -1, message: "Invalid validation" } }],
    logSig: "V1::Emkan::Vouchers#redeem"
  },

  /* ============================ VAS / CLIENT LOGS / SURVEYS ============================ */

  "POST /api/vas/redeem": {
    req: { headers: USER_HEADERS, body: { code: "VAS-000000" } },
    res: { status: 200, body: { redeemed: true } },
    errors: [{ status: 422, body: { error: -1, message: "Invalid validation" } }],
    logSig: "V1::Vas#redeem"
  },
  "POST /api/client_logs": {
    req: { headers: ANON_HEADERS, body: { level: "error", message: "checkout failed", context: { screen: "payment" } } },
    res: { status: 201, body: { id: 900001 } },
    errors: [{ status: 422, body: { error: -1, message: "Invalid validation" } }],
    logSig: "V1::ClientLogs#create"
  },
  "GET /api/surveys/:id": {
    req: { headers: USER_HEADERS, body: {} },
    res: { status: 200, body: { survey: { id: 4, title: "NPS", questions: [{ id: 1, text: "Rate us", options: [{ id: 1, label: "5" }] }] } } },
    errors: [],
    logSig: "V1::Surveys#show → surveys/show"
  },

  /* ============================ INBOUND WEBHOOKS (callbacks_controller) ============================ */

  "POST /payment/:vendor/callback": {
    req: { headers: { "Content-Type": "application/json" }, params: { vendor: "tap" }, body: {
      id: "chg_TS0000", status: "CAPTURED", amount: 55.0, currency: "SAR",
      reference: { transaction: "5001", order: "chk_tap_000001" }, source: { type: "mada" }
    } },
    res: { status: 200, body: "" },
    errors: [{ status: 200, body: "" }],
    logSig: "CallbacksController#payment → PaymentManager(vendor).parse_response (always head :ok)"
  },
  "GET /payment/:vendor/callback": {
    req: { params: { vendor: "tap" }, query: { tap_id: "chg_TS0000" }, body: {} },
    res: { status: 200, body: "" },
    errors: [],
    logSig: "CallbacksController#payment (GET redirect return)"
  },
  "POST /eChannels/iam/callback": {
    req: { headers: { "Content-Type": "application/json" }, body: {
      transId: "702c8177-5385-4bb7-a1b7-000000000000", status: "COMPLETED",
      idToken: "eyJ...nafath", personId: "1000000000"
    } },
    res: { status: 200, body: "" },
    errors: [{ status: 200, body: "" }],
    logSig: "CallbacksController#iam_new (VerifyIamToken → cache trans_id=COMPLETED, head :ok)"
  },
  "POST /delivery/:vendor/callback": {
    req: { headers: { "Content-Type": "application/json" }, params: { vendor: "aramex" }, body: {
      shipment_id: "SHP-100001", status: "delivered", external_reference_id: "SHP-100001",
      delivered_at: "2026-07-09T11:00:00Z"
    } },
    res: { status: 200, body: "" },
    errors: [{ status: 422, body: { error: null, message: "wrong vendor / parameters or missing body!" } }],
    logSig: "CallbacksController#delivery (updates DeliveryRequest.status, head :ok)"
  },
  "POST /hyperbill/callback": {
    req: { headers: { "Content-Type": "application/json" }, body: {
      invoice_no: "INV-700", status: "paid", amount: 55.0, payment_id: "chg_TS0000"
    } },
    res: { status: 200, body: "5050111" },
    errors: [{ status: 204, body: "" }],
    logSig: "CallbacksController#hyperbill (renders '5050111' ack, else head :no_content)"
  }

};

if (typeof module !== "undefined" && module.exports) { module.exports = API_SAMPLES; }
