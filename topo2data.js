/* Salam DMS · Topology 2 — data layer (PAYMENTS domain vertical slice)
 * Source-linked: every node/flow carries the real class · file · line · methods · deps · failure
 * cases extracted by static analysis of selfcare-backend release-2.34.1 (app/ tree).
 * API docs: real Slate docs (apidocs.js API_DOCS) where they exist; otherwise a request/response/
 * failure panel synthesised from the controller + gateway client source.
 * Kept SEPARATE from data.js/app.js so the current Topology page is untouched while we compare. */
(function () {
  "use strict";

  // repoUrl: set to a Git web base (e.g. "https://git.internal/salam/selfcare-backend/blob/2.34.1/")
  // to make every file:line a clickable deep link. Empty = show path:line as plain text.
  const META = { repo: "selfcare-backend", release: "2.34.1", appBase: "app/", repoUrl: "", domain: "Payments" };

  // flow/edge kinds → colour (mirrors the console's business/technical + integration palette)
  const KIND = {
    channel:   { label: "Channel / front-end", color: "#2563eb" },
    api:       { label: "Rails API controller", color: "#0e9f5a" },
    manager:   { label: "Manager / facade (lib)", color: "#0d9488" },
    model:     { label: "ActiveRecord model", color: "#475569" },
    gateway:   { label: "Gateway client (service)", color: "#ea580c" },
    external:  { label: "External provider", color: "var(--warn-fg)" },
    worker:    { label: "Sidekiq worker", color: "#7c3aed" },
    compliance:{ label: "ZATCA / compliance", color: "#dc2626" }
  };

  // layout columns (left → right = request → fulfilment)
  const GROUPS = [
    { id: "channels", label: "CHANNELS", col: 0, color: KIND.channel.color },
    { id: "api",      label: "RAILS API · CONTROLLERS", col: 1, color: KIND.api.color },
    { id: "core",     label: "MANAGERS · MODELS", col: 2, color: KIND.manager.color },
    { id: "clients",  label: "GATEWAY CLIENTS (app/services)", col: 3, color: KIND.gateway.color },
    { id: "external", label: "EXTERNAL PROVIDERS", col: 4, color: KIND.external.color },
    { id: "async",    label: "FULFILMENT · WORKERS", col: 5, color: KIND.worker.color },
    { id: "zatca",    label: "COMPLIANCE · ZATCA", col: 6, color: KIND.compliance.color }
  ];

  const src = (cls, file, line, methods, deps) => ({ cls, file, line: line || null, methods: methods || [], deps: deps || [] });
  const m = (n, l, p) => ({ n, l, p });

  // ---- NODES -----------------------------------------------------------------------------------
  const NODES = [
    // channels
    { id: "app", group: "channels", kind: "channel", label: "Salam App", sub: "iOS / Android selfcare",
      detail: { overview: "Customer app — checkout + pay via /api/v1..v12. Card, ApplePay, mada, STC, Tamara BNPL." } },
    { id: "web", group: "channels", kind: "channel", label: "Web selfcare", sub: "e-purchase / bills / QR",
      detail: { overview: "Web e-purchase & bill pay. Same checkout/payment controllers as the app." } },
    { id: "sda", group: "channels", kind: "channel", label: "Dealer DMS", sub: "seller JWT · wallet",
      detail: { overview: "Indirect dealer orders; seller wallet deduction feeds ZATCA seller_deduction." } },
    { id: "posa", group: "channels", kind: "channel", label: "POSA / QR-POSA", sub: "till · scanned ICCID",
      detail: { overview: "QR-POSA orders bypass the payment gateway (PaymentManager raises on gateway use)." } },
    { id: "partner", group: "channels", kind: "channel", label: "Apollo / Tygo", sub: "partner resellers · API-key",
      detail: { overview: "External-service onboarding; payment recorded from partner notification (no live gateway HTTP)." } },

    // controllers
    { id: "checkout_ctrl", group: "api", kind: "api", label: "CheckoutController", sub: "create · submit · saleor",
      detail: { overview: "Customer-facing checkout lifecycle: create, customer/delivery info, submit, ownership transfer.",
        src: [ src("Api::V1::CheckoutController", "app/controllers/api/v1/checkout_controller.rb", 6,
          [ m("create", 6, "start a checkout"), m("customer_info", 129, "attach customer/delivery"), m("submit", 227, "submit for payment"), m("saleor", 247, "Saleor checkout"), m("create_for_ownership_transfer", 67, "ownership transfer") ],
          [ "Checkout", "OwnershipTransferManager", "Saleor::Middleware", "ErrorCodes" ]),
          src("Api::V9::CheckoutController", "app/controllers/api/v9/checkout_controller.rb", 3, [ m("saleor", 3, "V9 override of saleor") ], [ "Api::V1::CheckoutController" ]) ],
        failures: [ { at: "checkout_controller.rb:282", type: "rescue Saleor::Error", note: "renders 422 YOU_ALREADY_HAVE_ACTIVE_REQUEST etc." } ],
        doc: { verb: "POST", path: "/api/v1/checkout", req: [ "checkout[checkout_type]", "checkout[plan_id]", "checkout[msisdn]" ], res: [ "201 checkout {id, price, fees, state}" ], fail: [ "422 validation (ErrorCodes)", "422 Saleor::Error active request" ] } } },
    { id: "payment_ctrl", group: "api", kind: "api", label: "PaymentController", sub: "check · initiate · commit · notify",
      detail: { overview: "Central payment endpoints: vendor select, options, initiate, commit, status, and the gateway notify/callback dispatcher.",
        src: [ src("Api::V1::PaymentController", "app/controllers/api/v1/payment_controller.rb", 29,
          [ m("check", 29, "check payment options/vendor"), m("initiate", 42, "start gateway payment"), m("commit", 180, "commit after gateway"), m("status", 240, "poll status"), m("notify", 272, "gateway callback dispatch"), m("handle_checkout", 314, "checkout-flow notify"), m("find_payment", 590, "before_action loader") ],
          [ "PaymentManager", "Checkout", "Invoice", "Payment", "ErrorCodes" ]) ],
        failures: [ { at: "payment_controller.rb:4", type: "before_action :find_payment", note: "404 if payment missing (status)" }, { at: "handlers", type: "salam_render_error", note: "422 on flow validation" } ],
        doc: { verb: "POST", path: "/api/v1/payment/initiate", req: [ "checkout_id", "payment[vendor]", "payment[card_type]" ], res: [ "200 {redirect_url|3ds, remote_payment_id, status}" ], fail: [ "422 INVALID_CHECKOUT", "422 vendor inactive (PaymentVendor gating)" ] } } },
    { id: "apps_payment_ctrl", group: "api", kind: "api", label: "Apps::PaymentController", sub: "api-key · options · saleor status",
      detail: { overview: "API-key authenticated app endpoints: payment-option check, saleor payment status, card type.",
        src: [ src("Api::V1::Apps::PaymentController", "app/controllers/api/v1/apps/payment_controller.rb", 9,
          [ m("check", 9, "check payment options"), m("payment_status", 23, "saleor payment status"), m("card_type", 49, "resolve card type") ],
          [ "PaymentManager", "Checkout", "Payment", "ApiKeyAuthenticatable" ]) ],
        failures: [ { at: "apps/payment_controller.rb:7", type: "prepend_before_action :authenticate_with_api_key!", note: "401 without valid API key" }, { at: "check", type: "salam_render_error", note: "422 INVALID_CHECKOUT / NOT_ORDERS_FOUND" } ] } },
    { id: "apollo_checkout", group: "api", kind: "api", label: "ApolloCheckoutController", sub: "partner onboarding · OTP · confirm",
      detail: { overview: "Apollo/Tygo external onboarding: create order, OTP confirm/resend, confirm payment, eSIM details/QR.",
        src: [ src("Api::ApolloCheckoutController (concern)", "app/controllers/concerns/api/apollo_checkout_controller.rb", 45,
          [ m("create", 45, "create partner order"), m("otp_confirm", 53, "confirm OTP"), m("confirm", 80, "confirm payment"), m("esim_qr", 148, "eSIM QR"), m("refund", 24, "partner refund") ],
          [ "OnboardingOrder", "ApolloOrderManager", "PaymentManager", "Otp", "Payments::Apollo::Response" ]) ],
        failures: [ { at: "apollo_checkout_controller.rb:192", type: "validate_json", note: "422 on invalid OTP / order state" } ],
        doc: { ref: "checkout" } } },
    { id: "zatca_ctrl", group: "api", kind: "api", label: "ZatcaController", sub: "invoice PDF",
      detail: { overview: "Streams the ZATCA invoice PDF for a payment, looked up by invoice_number in payment.extra (JSONB).",
        src: [ src("ZatcaController", "app/controllers/zatca_controller.rb", 2, [ m("generate", 2, "find payment, stream PDF") ], [ "Payment", "Zatca::Client", "Setting" ]) ],
        failures: [ { at: "zatca_controller.rb:11", type: "rescue Exception", note: "JSON error; 'Payment not found' if absent/disabled" } ] } },

    // managers + models
    { id: "payment_manager", group: "core", kind: "manager", label: "PaymentManager", sub: "vendor-agnostic facade",
      detail: { overview: "Facade that builds Payments::<Vendor>::Client/Response by constantize, creates payments per flow, and proxies charge / refund / status. Vendor decided by PaymentVendor.select_vendor / Payment#find_vendor.",
        src: [ src("PaymentManager", "app/lib/payment_manager.rb", 8,
          [ m("initialize", 8, "@module=Payments::<Vendor>, build client"), m("initiate_payment", 431, "call client.checkout"), m("parse_response", 107, "wrap gateway response"), m("process_response", 111, "pending/authorize/commit"), m("create_for_checkout", 189, "create payment (checkout)"), m("refund", 411, "proxy refund") ],
          [ "Payments::<Vendor>::Client", "Payments::<Vendor>::Response", "PaymentVendor", "Payment", "MobileNumberDecorator", "Price" ]) ],
        failures: [ { at: "payment_manager.rb:21", type: "raise ExceptionHandler::InvalidAdvancedPostpaidPayment", note: "bad advanced-postpaid" }, { at: "payment_manager.rb:89", type: "raise ExceptionHandler::InvalidTasheelCard", note: "invalid Tasheel card" }, { at: "payment_manager.rb:177", type: "raise ArgumentError", note: "QR POSA orders cannot use a payment gateway" } ] } },
    { id: "zatca_manager", group: "core", kind: "manager", label: "ZatcaManager", sub: "submit · refund · after-BSS",
      detail: { overview: "Orchestrates ZATCA submission (validate → process → notify) and CRN refunds; updates payment/seller_deduction/qr_posa records.",
        src: [ src("ZatcaManager", "app/lib/zatca_manager.rb", 11,
          [ m("process!", 11, "validate + submit invoice"), m("refund!", 39, "enqueue CRN"), m("after_bss_request!", 46, "post-BSS reconcile"), m("self.update_payment!", 57, "persist ZATCA result") ],
          [ "Zatca::Client", "ZatcaTransactionWorker", "Payment", "Plan" ]) ],
        failures: [ { at: "zatca_manager.rb:31", type: "rescue Exception → puts (swallowed)", note: "process! never re-raises; failures are logged only — a known gap surfaced by the ZATCA-gap alert" } ] } },
    { id: "payment_model", group: "core", kind: "model", label: "Payment", sub: "state · commit-response · vendor",
      detail: { overview: "Core payment record (polymorphic payment_on). Parses gateway commit responses, resolves vendor/manager, triggers ZATCA. status='fail' (not 'failed').",
        src: [ src("Payment", "app/models/payment.rb", 1,
          [ m("update_commit_response_from_notification", 161, "apply gateway callback"), m("update_commit_response", 177, "persist commit response"), m("find_vendor", 296, "resolve vendor"), m("payment_manager", 306, "build PaymentManager"), m("handle_zatca_transaction", 279, "enqueue ZATCA") ],
          [ "PaymentManager", "PaymentVendor", "Invoice", "Refund" ]) ],
        failures: [ { at: "enum", type: "status", note: "scopes success / failed('fail') / pending / refunded — value is 'fail'" }, { at: "card_type enum", type: "apple_pay0 credit_card1 mada2 amex3 stc4 tasheel5 other30 n/a60", note: "card_type map" } ] } },
    { id: "checkout_model", group: "core", kind: "model", label: "Checkout", sub: "AASM · fees · price",
      detail: { overview: "Checkout aggregate — AASM state machine, fee/price calc, per-type factories, completion transitions.",
        src: [ src("Checkout", "app/models/checkout.rb", 41,
          [ m("complete!", 661, "AASM complete"), m("complete_payment!", 678, "mark paid"), m("fees", 486, "fee calc"), m("price", 554, "price calc"), m("is_payment_required?", 607, "gateway needed?") ],
          [ "Payment", "Plan", "Saleor" ]) ],
        failures: [ { at: "consts", type: "checkout_type", note: "NORMAL0 DATA_SIM1 CHANGE_PLAN2 REPLACEMENT3 SALEOR4 RENEWAL6 ADVANCED_POSTPAID7" } ] } },
    { id: "invoice_model", group: "core", kind: "model", label: "Invoice", sub: "onboarding e-invoice",
      detail: { overview: "Onboarding-order invoice; maps Hyperbill/Merchalink commit responses to status new→created→sent→paid.",
        src: [ src("Invoice", "app/models/invoice.rb", 25, [ m("self.create_or_load_for_onboarding", 25, "get/create invoice"), m("update_commit_response_from_response", 45, "apply provider response"), m("cleanup", 76, "housekeeping") ], [ "OnboardingOrder", "Payment", "Seller" ]) ],
        failures: [ { at: "enum status", type: "new0 created1 sent2 paid3 failed4", note: "invoice lifecycle" } ] } },
    { id: "refund_model", group: "core", kind: "model", label: "Refund", sub: "reverse · refund · CRN",
      detail: { overview: "Refund record — creation from payment, request/response tracking, resend, ZATCA credit note.",
        src: [ src("Refund", "app/models/refund.rb", 23, [ m("self.create_refund", 23, "build refund"), m("send_refund", 71, "enqueue RefundWorker"), m("send_zatca_credit_note", 87, "ZATCA CRN"), m("check_status", 58, "poll refund") ], [ "Payment", "RefundReason", "PaymentManager", "ZatcaManager" ]) ] } },
    { id: "payment_vendor", group: "core", kind: "model", label: "PaymentVendor", sub: "vendor registry + selection",
      detail: { overview: "Vendor registry & selection by payment_type/platform, gated by active-hours + enabled types/platforms. Names: hyperpay, tap, tamara, apollo, salam.",
        src: [ src("PaymentVendor", "app/models/payment_vendor.rb", 20, [ m("self.select_vendor", 41, "choose vendor"), m("self.default_vendor", 33, "fallback vendor"), m("active_time?", 57, "active-hours gate"), m("payment_types_active?", 100, "type gate") ], [ "Current" ]) ],
        failures: [ { at: "validation", type: "name inclusion", note: "must be one of the 5 vendor constants" } ] } },

    // gateway clients
    { id: "hyperpay_client", group: "clients", kind: "gateway", label: "Hyperpay::Client", sub: "OPPWA · cards/ApplePay",
      detail: { overview: "HyperPay (OPPWA) client — checkout, status, refund, reverse; AES-GCM encrypted webhooks.",
        src: [ src("Payments::Hyperpay::Client", "app/services/payments/hyperpay/client.rb", 11, [ m("checkout", 22, "POST /checkouts"), m("status", 54, "GET checkout status"), m("refund", 84, "POST refund"), m("reverse", 118, "reverse"), m("entity", 139, "pick entity by card") ], [ "HTTParty", "Payments::Hyperpay::Response", "Payment" ]),
          src("Payments::Hyperpay::Response", "app/services/payments/hyperpay/response.rb", 31, [ m("success?", 98, "code regex match"), m("failed?", 94, "failure codes"), m("initiated?", 39, "000.200"), m("not_found?", 48, "700.400.580") ], [ "Payment" ]) ],
        failures: [ { at: "response.rb", type: "failed? codes", note: "000.400 / 000.900 / 000.600 / 100. / 300.100.100" }, { at: "response.rb:125", type: "AES create_decipher", note: "decrypt encrypted notification" } ],
        doc: { verb: "POST", path: "{hyperpay base}/v1/checkouts", req: [ "entityId (by card type)", "amount", "currency=SAR", "merchantTransactionId", "Authorization: Bearer <token>" ], res: [ "id (checkoutId)", "result.code" ], fail: [ "success regex ^(000.000.|000.100.1|000.[36]|000.400.[12]0)", "failed: 000.400/000.900/000.600/100./300.100.100", "not_found: 700.400.580" ] } } },
    { id: "tap_client", group: "clients", kind: "gateway", label: "Tap::Client", sub: "charges · 3DS · tokens",
      detail: { overview: "Tap Payments client — charges, status, refunds, tokens; 3DS via transaction.url.",
        src: [ src("Payments::Tap::Client", "app/services/payments/tap/client.rb", 11, [ m("checkout", 24, "POST /charges"), m("status", 86, "GET /charges/{id}"), m("refund", 104, "POST /refunds"), m("credit_card", 147, "GET /tokens/{token}") ], [ "HTTParty", "Payments::Tap::Response", "Payment" ]),
          src("Payments::Tap::Response", "app/services/payments/tap/response.rb", 16, [ m("success?", 90, "code in [000,200]"), m("failed?", 84, "code.to_i>301"), m("pending?", 35, "200"), m("is_3dsecure?", 79, "transaction.url present") ], [ "Payment" ]) ],
        failures: [ { at: "response.rb:84", type: "failed? code>301", note: "Tap decline" }, { at: "response.rb:99", type: "errors", note: "payload['errors']" } ],
        doc: { verb: "POST", path: "{tap base}/v2/charges", req: [ "amount", "currency=SAR", "source.id (token)", "reference.transaction", "Authorization: Bearer <secret>" ], res: [ "id", "status (INITIATED/CAPTURED)", "transaction.url (3DS)" ], fail: [ "failed when code>301", "errors[] in payload" ] } } },
    { id: "tamara_client", group: "clients", kind: "gateway", label: "Tamara::Client", sub: "BNPL · authorize · capture",
      detail: { overview: "Tamara BNPL — options pre-check, checkout, authorize, capture, refund. Always 3DS-style redirect.",
        src: [ src("Payments::Tamara::Client", "app/services/payments/tamara/client.rb", 11, [ m("payment_options", 22, "pre-check eligibility"), m("checkout", 36, "POST /checkout"), m("authorize", 153, "POST authorise"), m("capture", 181, "capture"), m("refund", 223, "simplified refund") ], [ "HTTParty", "Payments::Tamara::Response", "Errors::ServiceError", "Checkout" ]),
          src("Payments::Tamara::Response", "app/services/payments/tamara/response.rb", 17, [ m("success?", 87, "authorised/captured"), m("failed?", 83, "declined/expired/canceled"), m("pending?", 35, "approved") ], [ "Payment" ]) ],
        failures: [ { at: "client.rb:141", type: "raise Errors::ServiceError", note: "Can't Create Tamara Checkout (BACKEND_GENERAL_ERROR)" }, { at: "client.rb:176", type: "raise Errors::ServiceError", note: "Can't authorize" } ],
        doc: { verb: "POST", path: "{tamara base}/checkout", req: [ "total_amount {amount,currency}", "items[]", "consumer", "shipping/billing address" ], res: [ "order_id", "checkout_url", "status" ], fail: [ "ServiceError on create/authorize", "declined/expired/canceled" ] } } },
    { id: "salam_client", group: "clients", kind: "gateway", label: "Salam::Client", sub: "UPG / SUP in-house",
      detail: { overview: "Salam (UPG / in-house SUP) — invoices create, status, refund, reverse. This is the 'UPG (salam)' gateway in the console.",
        src: [ src("Payments::Salam::Client", "app/services/payments/salam/client.rb", 11, [ m("checkout", 23, "POST /invoices"), m("status", 128, "GET /invoices/{id}"), m("refund", 146, "POST refund"), m("reverse", 195, "reverse") ], [ "HTTParty", "Payments::Salam::Response", "Errors::ServiceError" ]),
          src("Payments::Salam::Response", "app/services/payments/salam/response.rb", 16, [ m("success?", 105, "PAID/AUTHORIZED/CAPTURED..."), m("failed?", 99, "FAILED/CANCELLED/EXPIRED/DECLINED/VOIDED"), m("last_payment", 32, "latest of sorted payments") ], [ "Payment", "Money" ]) ],
        failures: [ { at: "client.rb:105", type: "raise Errors::ServiceError", note: "parsed_response['message'] (BACKEND_GENERAL_ERROR)" } ],
        doc: { verb: "POST", path: "{salam base}/invoices", req: [ "amount", "currency=SAR", "customer", "reference" ], res: [ "invoice id", "payments[] {status}" ], fail: [ "success: PAID/AUTHORIZED/CAPTURED/VERIFIED/REFUNDED", "failed: FAILED/CANCELLED/EXPIRED/DECLINED/VOIDED" ] } } },
    { id: "apollo_client", group: "clients", kind: "gateway", label: "Apollo::Client", sub: "partner stub (no live HTTP)",
      detail: { overview: "Apollo/Tygo stub — no live gateway HTTP. Wraps the stored payment.extra notification. Refund HTTP is commented out.",
        src: [ src("Payments::Apollo::Client", "app/services/payments/apollo/client.rb", 4, [ m("checkout", 12, "no-op / read extra"), m("update_status", 20, "from payment.extra"), m("refund", 29, "stub (HTTP commented)") ], [ "Payments::Apollo::Response" ]),
          src("Payments::Apollo::Response", "app/services/payments/apollo/response.rb", 20, [ m("success?", 26, "paymentStatus"), m("external_transaction_id", 55, "partner txn id") ], []) ],
        failures: [ { at: "response.rb:59", type: "remote_payment_id rescue nil", note: "tolerant parse" } ],
        doc: { ref: "checkout" } } },
    { id: "emkan_client", group: "clients", kind: "gateway", label: "Emkan::Client", sub: "BNPL vouchers (mocked env)",
      detail: { overview: "Emkan voucher/BNPL — voucher details, pre-redeem/redeem, pre-refund/refund. NOT wired through PaymentManager's vendor list; called directly by Emkan flows. Has mocked-env fallbacks.",
        src: [ src("Emkan::Client", "app/services/emkan/client.rb", 30, [ m("voucher_details", 41, "lookup voucher"), m("pre_redeem", 59, "pre-redeem"), m("redeem", 73, "redeem"), m("refund", 106, "refund"), m("mocked?", 123, "env short-circuit") ], [ "HTTParty" ]) ],
        failures: [ { at: "client.rb:123", type: "mocked_env? short-circuit", note: "returns canned responses in mocked env" } ] } },
    { id: "hyperbill_client", group: "clients", kind: "gateway", label: "Hyperbill::Client", sub: "e-invoice (onboarding)",
      detail: { overview: "Hyperbill e-invoicing — login/token + simpleInvoice create/send/resend/retrieve/delete. Drives onboarding Invoice status.",
        src: [ src("Hyperbill::Client", "app/services/hyperbill/client.rb", 11, [ m("token", 18, "POST /login"), m("simple_invoice_create", 35, "POST /simpleInvoice"), m("simple_invoice_send", 59, "GET send/{no}"), m("simple_invoice_resend", 74, "GET resend/{no}") ], [ "HTTParty", "Hyperbill::Response", "Invoice" ]),
          src("Hyperbill::Error", "app/services/hyperbill/error.rb", 4, [ m("initialize", 4, "custom error") ], []),
          src("HyperbillResponse", "app/lib/hyperbill_response.rb", 3, [ m("success?", 43, "status parse"), m("code", 53, "provider code") ], []) ],
        failures: [ { at: "client", type: "raise Hyperbill::Error", note: "remote failure → caught by worker → Slack" } ] } },
    { id: "merchalink_client", group: "clients", kind: "gateway", label: "Merchalink::Client", sub: "e-invoice (twin)",
      detail: { overview: "Merchalink e-invoicing — twin of Hyperbill (login + simpleInvoice CRUD).",
        src: [ src("Merchalink::Client", "app/services/merchalink/client.rb", 11, [ m("token", 18, "POST /login"), m("simple_invoice_create", 35, "POST /simpleInvoice"), m("simple_invoice_send", 59, "send") ], [ "HTTParty", "Merchalink::Response", "Invoice" ]),
          src("Merchalink::Error", "app/services/merchalink/error.rb", 4, [ m("initialize", 4, "custom error") ], []),
          src("MerchalinkResponse", "app/lib/merchalink_response.rb", 3, [ m("success?", 43, "status parse"), m("result_message", 57, "message") ], []) ],
        failures: [ { at: "client", type: "raise Merchalink::Error", note: "remote failure → caught by worker → Slack" } ] } },
    { id: "zatca_client", group: "clients", kind: "gateway", label: "Zatca::Client", sub: "e-invoice submit",
      detail: { overview: "ZATCA e-invoice submission — build UBL message, POST, wrap response, persist, notify. success = HTTP ok && code==200.",
        src: [ src("Zatca::Client", "app/services/zatca/client.rb", 10, [ m("process!", 18, "POST invoice"), m("validate!", 50, "eligibility"), m("notify_customer!", 54, "email PDF"), m("generate_pdf!", 66, "render PDF") ], [ "HTTParty", "Zatca::Request", "Zatca::Response", "Zatca::Validator", "ZatcaManager", "Notifier::ZatcaCustomerEmailWorker" ]),
          src("Zatca::Request", "app/services/zatca/request.rb", 5, [ m("build_message", 57, "UBL invoice body"), m("tax_total", 279, "VAT totals"), m("legal_monetary_total", 350, "monetary totals") ], [ "Payment", "SellerDeduction", "QrPosaCompletion", "Plan" ]),
          src("Zatca::Response", "app/services/zatca/response.rb", 5, [ m("success?", 34, "http ok && code==200"), m("raise_http_errors", 38, "fail Zatca::Error") , m("invoice_number", 18, "invoice no") ], [ "Zatca::Error" ]),
          src("Zatca::Validator", "app/services/zatca/validator.rb", 5, [ m("validate!", 17, "prepaid-only eligibility"), m("plan_is_prepaid?", 63, "private gate") ], [ "Payment", "Plan", "AccountManager", "Checkout" ]),
          src("Zatca::Error", "app/services/zatca/error.rb", 3, [ m("initialize", 3, "code + message") ], []) ],
        failures: [ { at: "response.rb:38", type: "raise Zatca::Error(code,message)", note: "unless http ok && code==200" }, { at: "validator.rb:57", type: "rescue Exception → puts (swallowed)", note: "eligibility errors are logged only" }, { at: "validator", type: "excludes", note: "recharge/renewal/tygo/non-prepaid excluded from ZATCA" } ],
        doc: { verb: "POST", path: "{zatca/ClearTax base}", req: [ "UBL invoice XML (Zatca::Request#build_message)", "api_key", "vat" ], res: [ "invoiceNumber", "status", "pdf" ], fail: [ "Zatca::Error unless code==200", "eligibility filtered by Zatca::Validator" ] } } },

    // external providers
    { id: "ext_hyperpay", group: "external", kind: "external", label: "HyperPay (OPPWA)", sub: "cards · ApplePay · mada",
      detail: { overview: "External card acquirer. Encrypted (AES-GCM) webhooks post back to the payment callback." } },
    { id: "ext_tap", group: "external", kind: "external", label: "Tap Payments", sub: "charges · 3DS",
      detail: { overview: "External gateway; 3DS redirect via transaction.url. Callback → PaymentController#notify." } },
    { id: "ext_tamara", group: "external", kind: "external", label: "Tamara", sub: "BNPL",
      detail: { overview: "BNPL provider; authorize/capture lifecycle; webhook drives pending→authorised." } },
    { id: "ext_salam", group: "external", kind: "external", label: "UPG / SalamPay", sub: "in-house SUP",
      detail: { overview: "In-house Unified Payment Gateway. 'UPG (salam)' in the console gateway breakdown." } },
    { id: "ext_zatca", group: "zatca", kind: "compliance", label: "ZATCA (ClearTax)", sub: "e-invoicing / Fatoora",
      detail: { overview: "Government e-invoicing. Unreported backlog is watched by the ZATCA-gap P1 alert." } },
    { id: "ext_bss", group: "async", kind: "external", label: "Oracle BSS (Optiva)", sub: "activation · billing",
      detail: { overview: "Commit worker posts BSS transactions (Optiva::Transaction) after a successful payment." } },

    // workers
    { id: "commit_worker", group: "async", kind: "worker", label: "Payment::CommitWorker", sub: "queue: payment_commit",
      detail: { overview: "Post-success fulfilment — BSS transactions per payment_on_type, delivery creation, and ZATCA enqueue. On fail: expire checkout / Saleor 'fail'. Idempotency via Rails.cache keys.",
        src: [ src("Payment::CommitWorker", "app/workers/payment/commit_worker.rb", 5, [ m("perform", 5, "fulfil per payment_on_type") ], [ "Payment", "Optiva::Transaction", "DeliveryManager", "Numbers::CommitWorker", "ZatcaTransactionWorker", "Saleor::Middleware" ]) ],
        failures: [ { at: "commit_worker.rb:211", type: "fail branch", note: "checkout expiry / Saleor 'fail' state" }, { at: "worker", type: "no top-level rescue", note: "relies on Sidekiq retry + Rails.cache idempotency" } ] } },
    { id: "refund_worker", group: "async", kind: "worker", label: "Payment::RefundWorker", sub: "queue: payment_commit",
      detail: { overview: "Processes a refund through PaymentManager#refund.",
        src: [ src("Payment::RefundWorker", "app/workers/payment/refund_worker.rb", 5, [ m("perform", 5, "PaymentManager.refund") ], [ "Payment", "PaymentManager" ]) ],
        failures: [ { at: "refund_worker.rb:18", type: "rescue Exception → Notifier::SlackWorker", note: "refund failure pings Slack" } ] } },
    { id: "hyperbill_worker", group: "async", kind: "worker", label: "HyperbillSendInvoiceWorker", sub: "queue: payment_commit",
      detail: { overview: "State-machine invoice create→send→resend; self re-enqueues after create.",
        src: [ src("Payment::HyperbillSendInvoiceWorker", "app/workers/payment/hyperbill_send_invoice_worker.rb", 5, [ m("perform", 5, "invoice state machine") ], [ "OnboardingOrder", "Invoice", "Hyperbill::Client", "Notifier::SlackWorker" ]) ],
        failures: [ { at: "hyperbill_send_invoice_worker.rb:22", type: "rescue Hyperbill::Error → Slack", note: "provider error" }, { at: ":25", type: "rescue Exception → Slack", note: "unexpected error" } ] } },
    { id: "merchalink_worker", group: "async", kind: "worker", label: "MerchalinkSendInvoiceWorker", sub: "queue: payment_commit",
      detail: { overview: "Merchalink invoice create→send→resend (twin of Hyperbill worker).",
        src: [ src("Payment::MerchalinkSendInvoiceWorker", "app/workers/payment/merchalink_send_invoice_worker.rb", 5, [ m("perform", 5, "invoice state machine") ], [ "OnboardingOrder", "Invoice", "Merchalink::Client", "Notifier::SlackWorker" ]) ],
        failures: [ { at: "merchalink_send_invoice_worker.rb:22", type: "rescue Merchalink::Error → Slack", note: "provider error" } ] } },
    { id: "zatca_txn_worker", group: "zatca", kind: "worker", label: "ZatcaTransactionWorker", sub: "queue: zatca_transaction · retry:false",
      detail: { overview: "Enqueues ZATCA processing via ZatcaManager for payment/seller_deduction/qr_posa. Nested AfterBssWorker runs after_bss_request!. retry: false (no auto-retry — a failed submit stays unreported).",
        src: [ src("ZatcaTransactionWorker", "app/workers/zatca_transaction_worker.rb", 5, [ m("perform", 5, "ZatcaManager.process!"), m("AfterBssWorker#perform", 18, "after_bss_request!") ], [ "ZatcaManager" ]) ],
        failures: [ { at: "worker", type: "sidekiq_options retry: false", note: "no retry → relies on the ZATCA-gap alert to catch backlog" } ] } },
    { id: "zatca_email_worker", group: "zatca", kind: "worker", label: "ZatcaCustomerEmailWorker", sub: "queue: zatca_customer_notification",
      detail: { overview: "Emails the ZATCA invoice to the customer.",
        src: [ src("Notifier::ZatcaCustomerEmailWorker", "app/workers/notifier/zatca_customer_email_worker.rb", 5, [ m("perform", 5, "ZatcaCustomerMailer") ], [ "ZatcaCustomerMailer" ]) ],
        failures: [ { at: "worker", type: "rescue Net::SMTP* → puts", note: "SMTP errors swallowed" } ] } }
  ];

  // ---- EDGES (flows) — each carries its own source refs / doc / failures where meaningful --------
  const E = (from, to, type, label, detail) => ({ from, to, type, label, detail: detail || null });
  const EDGES = [
    // channels → controllers
    E("app", "checkout_ctrl", "api", "create / submit checkout"),
    E("web", "checkout_ctrl", "api", "e-purchase / bills"),
    E("sda", "checkout_ctrl", "api", "dealer orders · wallet"),
    E("app", "payment_ctrl", "api", "initiate / commit / status"),
    E("web", "payment_ctrl", "api", "pay / status"),
    E("partner", "apollo_checkout", "api", "partner onboarding · OTP"),
    E("posa", "payment_ctrl", "api", "QR-POSA (no gateway)"),

    // controller → manager/models
    E("checkout_ctrl", "checkout_model", "manager", "create_or_update_for_*", {
      overview: "Checkout controller builds the Checkout aggregate.",
      src: [ src("Api::V1::CheckoutController#create", "app/controllers/api/v1/checkout_controller.rb", 6, [ m("create", 6, "→ Checkout.create_or_update_*") ], [ "Checkout" ]) ] }),
    E("payment_ctrl", "payment_manager", "manager", "PaymentManager.new(vendor)", {
      overview: "initiate/commit build a PaymentManager for the selected vendor.",
      src: [ src("Api::V1::PaymentController#initiate", "app/controllers/api/v1/payment_controller.rb", 42, [ m("initiate", 42, "PaymentManager#initiate_payment") ], [ "PaymentManager", "PaymentVendor" ]) ] }),
    E("payment_manager", "payment_vendor", "manager", "select_vendor / default_vendor", {
      overview: "Vendor chosen by PaymentVendor gating (type/platform/active-hours).",
      src: [ src("PaymentVendor.select_vendor", "app/models/payment_vendor.rb", 41, [ m("select_vendor", 41, "choose vendor") ], []) ] }),
    E("payment_manager", "payment_model", "manager", "create + update commit response", {
      overview: "PaymentManager creates the Payment and applies gateway commit responses.",
      src: [ src("Payment#update_commit_response_from_notification", "app/models/payment.rb", 161, [ m("update_commit_response_from_notification", 161, "apply callback") ], [ "PaymentManager" ]) ] }),

    // manager → gateway clients (constantize)
    E("payment_manager", "hyperpay_client", "gateway", "Payments::Hyperpay::Client#checkout", {
      overview: "constantize('Payments::Hyperpay::Client').new.checkout",
      src: [ src("PaymentManager#initialize", "app/lib/payment_manager.rb", 8, [ m("initialize", 8, "@module=Payments::Hyperpay") ], [ "Payments::Hyperpay::Client" ]) ] }),
    E("payment_manager", "tap_client", "gateway", "Payments::Tap::Client#checkout"),
    E("payment_manager", "tamara_client", "gateway", "Payments::Tamara::Client#checkout"),
    E("payment_manager", "salam_client", "gateway", "Payments::Salam::Client#checkout"),
    E("apollo_checkout", "apollo_client", "gateway", "Payments::Apollo (from extra)"),
    E("payment_manager", "emkan_client", "gateway", "Emkan flows (direct, not vendor list)"),

    // gateway clients → external
    E("hyperpay_client", "ext_hyperpay", "external", "POST /v1/checkouts"),
    E("tap_client", "ext_tap", "external", "POST /charges"),
    E("tamara_client", "ext_tamara", "external", "POST /checkout"),
    E("salam_client", "ext_salam", "external", "POST /invoices"),

    // external callback → controller → payment → commit worker
    E("ext_hyperpay", "payment_ctrl", "webhook", "AES-GCM webhook → notify", {
      overview: "Encrypted HyperPay webhook decrypted then dispatched by PaymentController#notify.",
      src: [ src("Api::V1::PaymentController#notify", "app/controllers/api/v1/payment_controller.rb", 272, [ m("notify", 272, "dispatch by flow") ], [ "PaymentManager", "Payment" ]),
             src("Payments::Hyperpay::Response", "app/services/payments/hyperpay/response.rb", 125, [ m("decrypt", 125, "AES create_decipher") ], []) ] }),
    E("ext_tap", "payment_ctrl", "webhook", "callback → notify"),
    E("ext_tamara", "payment_ctrl", "webhook", "webhook → authorize/notify"),
    E("ext_salam", "payment_ctrl", "webhook", "callback → notify"),
    E("payment_ctrl", "commit_worker", "async", "on success → CommitWorker", {
      overview: "A successful commit response enqueues Payment::CommitWorker for fulfilment.",
      src: [ src("Payment::CommitWorker#perform", "app/workers/payment/commit_worker.rb", 5, [ m("perform", 5, "BSS + delivery + ZATCA") ], [ "Optiva::Transaction", "DeliveryManager", "ZatcaTransactionWorker" ]) ] }),

    // commit worker → BSS / ZATCA / invoices
    E("commit_worker", "ext_bss", "async", "Optiva::Transaction (BSS)"),
    E("commit_worker", "zatca_txn_worker", "compliance", "perform_async(INV)", {
      overview: "CommitWorker enqueues ZATCA for the invoice.",
      src: [ src("Payment::CommitWorker#perform", "app/workers/payment/commit_worker.rb", 201, [ m("perform", 201, "ZatcaTransactionWorker.perform_async(:INV)") ], [ "ZatcaTransactionWorker" ]) ] }),
    E("commit_worker", "hyperbill_worker", "async", "onboarding invoice"),
    E("commit_worker", "merchalink_worker", "async", "onboarding invoice (twin)"),

    // ZATCA chain
    E("zatca_txn_worker", "zatca_manager", "compliance", "ZatcaManager#process!"),
    E("zatca_manager", "zatca_client", "compliance", "validate → POST invoice"),
    E("zatca_client", "ext_zatca", "compliance", "POST UBL invoice"),
    E("zatca_manager", "zatca_email_worker", "compliance", "notify customer (PDF)"),
    E("zatca_ctrl", "payment_model", "api", "find payment by invoice_number"),

    // invoice workers → clients
    E("hyperbill_worker", "hyperbill_client", "gateway", "login + simpleInvoice"),
    E("merchalink_worker", "merchalink_client", "gateway", "login + simpleInvoice"),
    E("hyperbill_client", "invoice_model", "manager", "status new→created→sent"),

    // refunds
    E("refund_model", "refund_worker", "async", "send_refund"),
    E("refund_worker", "payment_manager", "manager", "PaymentManager#refund"),
    E("refund_model", "zatca_manager", "compliance", "send_zatca_credit_note (CRN)")
  ];

  window.TOPO2 = { meta: META, kinds: KIND, groups: GROUPS, nodes: NODES, edges: EDGES };
})();
