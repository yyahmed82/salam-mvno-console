/* Supplemental API samples — fills gaps not covered by samples.js.
   Merged into the global API_SAMPLES at load. PII synthetic/masked. */
(function(){
  const EXTRA = {
   "POST /api/onboarding/orders/:id/sim_type": {
     req:{headers:{"Access-Token":"eyJ… (anonymous)","X-Protocol-Version":"v3"}, body:{sim_type:1}},
     res:{status:200, body:{id:"a1b2…uuid", sim_type:"esim", state:"number_order_type_selection"}},
     errors:[{status:422, body:{error:"invalid sim_type"}}],
     logSig:"Api::V3::Onboarding::SimTypeController#create → save_sim_type"},
   "POST /api/onboarding/orders/:id/visitor_hajj_iccid": {
     req:{headers:{"Access-Token":"eyJ…","X-Protocol-Version":"v5"}, body:{iccid:"8996611000000000000"}},
     res:{status:200, body:{id:"a1b2…uuid", iccid:"8996611000000000000", reserved_number:"9665XXXXXXXX", state:"eligibility_check"}},
     errors:[{status:422, body:{error:"ICCID not in visitor-hajj inventory"}},{status:404, body:{error:"card package not available"}}],
     logSig:"Api::V5::Onboarding::OrdersController#visitor_hajj_iccid → VisitorHajjFlow.iccid_and_reserve!"},
   "POST /api/onboarding/orders/:id/complete_qr_posa": {
     req:{headers:{"Access-Token":"eyJ…","X-Protocol-Version":"v5"}, body:{modem_serial:"MDM-000-XXXX"}},
     res:{status:200, body:{id:"a1b2…uuid", completed:true, qr_posa_completion_id:1234, invoice_number:"INV-000123"}},
     errors:[{status:422, body:{error:"invalid modem serial"}}],
     logSig:"complete_qr_posa → QrPosaOrderCompleter#complete! (payment-less, enqueues ZatcaTransactionWorker)"},
   "GET /api/onboarding/orders/esim_qr": {
     req:{headers:{}, query:{mobile_number:"9665XXXXXXXX"}},
     res:{status:200, body:{esim_profile_link:"LPA:1$smdp.salam.sa$XXXX-XXXX", qr_png_base64:"iVBORw0KGgo…"}},
     errors:[{status:404, body:{error:"no eSIM profile for number"}}],
     logSig:"Onboarding::OrdersController#esim_qr → Oracle::Numbers#esim_qr_code (public, no auth)"},
   "POST /api/users/register_number_on_semati": {
     req:{headers:{"Access-Token":"eyJ… (user)","X-Protocol-Version":"v2"}, body:{mobile_number:"9665XXXXXXXX"}},
     res:{status:200, body:{message:"registration queued", trans_id:"naf-XXXX"}},
     errors:[{status:409, body:{error:"already registered"}}],
     logSig:"Api::V2::UsersController#register_number_on_semati → Oracle::RegisterNumberOnSematiWorker"},

   "GET /api/apps/orders/qr/:id": {
     req:{headers:{"X-Api-Key":"<apps key>"}, note:"encrypted order id in path"},
     res:{status:200, contentType:"image/png", body:"<PNG bytes>"},
     errors:[{status:404, body:{error:"order not found"}}],
     logSig:"Api::V1::Apps::OrdersController#qr → Qr#encrypt_string/generate_qr (no auth)"},
   "GET /api/apps/orders/:id": {
     req:{headers:{"X-Api-Key":"<apps key>"}},
     res:{status:200, body:{id:"a1b2…uuid", plan:{id:12,name:"Solo 99"}, number:"9665XXXXXXXX", status:"submitted", payment:{status:"success",amount:95.68}}},
     errors:[{status:404, body:{error:"not found"}}],
     logSig:"Apps::OrdersController#show"},
   "POST /api/apps/orders/update_issued_sim/:id": {
     req:{headers:{"X-Api-Key":"<apps key>"}, body:{iccid:"8996611000000000000"}},
     res:{status:200, body:{id:"a1b2…uuid", issued_iccid:"8996611000000000000"}},
     errors:[{status:422, body:{error:"iccid required"}}],
     logSig:"Apps::OrdersController#update_issued_sim → issued_sims"},
   "GET /api/apps/orders/check_social_security_eligibility": {
     req:{headers:{"X-Api-Key":"<apps key>"}, query:{nationality_id:"1000000000", plan_id:"12"}},
     res:{status:200, body:{eligible:true, discount_plan_id:34, source:"SSE"}},
     errors:[{status:422, body:{eligible:false, reason:"not a beneficiary"}}],
     logSig:"Apps::OrdersController#check_social_security_eligibility → SocialSecurityEligibilityManager"},
   "GET /api/apps/payment/check": {
     req:{headers:{"X-Api-Key":"<apps key>"}, query:{checkout_id:"chk_XXXX"}},
     res:{status:200, body:{status:"success", amount:95.68, vendor:"hyperpay"}},
     errors:[{status:404, body:{error:"payment not found"}}],
     logSig:"Apps::PaymentController#check → PaymentManager#check_status"},

   "GET /api/activation/:order_id/numbers": {
     req:{headers:{"X-Api-Key":"<apps key>","X-Protocol-Version":"v12"}, query:{vanity:"true", page_key:"…"}},
     res:{status:200, body:{numbers:["9665XXXXXX01","9665XXXXXX02"], page_key:"next…"}},
     errors:[{status:404, body:{error:"order not found"}}],
     logSig:"Api::V12::ActivationController#numbers → Oracle::Crm vanity search"},
   "POST /api/activation/:order_id/reserve": {
     req:{headers:{"X-Api-Key":"<apps key>","X-Protocol-Version":"v12"}, body:{number:"9665XXXXXX01"}},
     res:{status:200, body:{reserved:true, number:"9665XXXXXX01", expires_at:"2026-07-01T12:00:00Z"}},
     errors:[{status:409, body:{error:"number no longer available"}}],
     logSig:"Api::V12::ActivationController#reserve → NumberManager"},
   "POST /api/activation/:order_id/cancel": {
     req:{headers:{"X-Api-Key":"<apps key>","X-Protocol-Version":"v12"}, body:{}},
     res:{status:200, body:{id:"a1b2…uuid", status:"cancelled_aged"}},
     errors:[],
     logSig:"Api::V12::ActivationController#cancel → unreserve + status update"},

   "POST /api/apollo/checkout": {
     req:{headers:{"X-Api-Key":"<apollo key>"}, body:{plan_id:"12", number:"9665XXXXXXXX", sim_type:"esim", nationality_id:"1000000000", first_name:"Test", email:"user@example.com", mnp:false}},
     res:{status:201, body:{order_id:"a1b2…uuid", state:"payment", otp_sent:true}},
     errors:[{status:422, body:{error:"eligibility failed"}},{status:401, body:{error:"invalid api key"}}],
     logSig:"Api::ApolloCheckoutController#create → ApolloOrderManager#save (replays wizard)"},
   "POST /api/apollo/checkout/confirm": {
     req:{headers:{"X-Api-Key":"<apollo key>"}, body:{order_id:"a1b2…uuid", amount:95.68, partner_reference:"APL-XXXX"}},
     res:{status:200, body:{order_id:"a1b2…uuid", completed:true, payment_vendor:"apollo"}},
     errors:[{status:422, body:{error:"order not in payable state"}}],
     logSig:"#confirm → PaymentManager#create_for_apollo (vendor APOLLO) → Payment::CommitWorker"},
   "POST /api/apollo/checkout/refund": {
     req:{headers:{"X-Api-Key":"<apollo key>"}, body:{order_id:"a1b2…uuid", reason_id:3}},
     res:{status:200, body:{refund_id:987, status:"processing"}},
     errors:[{status:422, body:{error:"payment not refundable"}}],
     logSig:"#refund → Refund.create_refund → Payment::RefundWorker (+ ZATCA CRN)"},
   "POST /api/apollo/semati/authorize": {
     req:{headers:{"X-Api-Key":"<apollo key>"}, body:{nationality_id:"1000000000", service:"onboarding"}},
     res:{status:200, body:{trans_id:"naf-XXXX", random:"42", status:"waiting"}},
     errors:[{status:503, body:{error:"IAM unavailable"}}],
     logSig:"Api::V1::Apollo::SematiController#authorize → IamNew"},
   "GET /api/apollo/plans": {
     req:{headers:{"X-Api-Key":"<apollo key>"}},
     res:{status:200, body:{plans:[{id:12,name:"Solo 99",price:99,type:"postpaid"}]}},
     errors:[],
     logSig:"Api::V1::Apollo::PlansController#index"},

   "POST /api/saleor/login": {
     req:{headers:{}, body:{mobile_number:"9665XXXXXXXX"}},
     res:{status:200, body:{otp_sent:true, session:"guest"}},
     errors:[{status:404, body:{error:"number not a Salam subscriber"}}],
     logSig:"Api::V1::SaleorController#login → Oracle profile check + OTP"},
   "GET /zatca/:invoice_number": {
     req:{headers:{}, note:"public invoice link"},
     res:{status:200, contentType:"application/pdf", body:"<PDF bytes>"},
     errors:[{status:404, body:{error:"invoice not found"}}],
     logSig:"ZatcaController#generate → ClearTax generate_pdf!"},

   "POST /api/users/profile/credit_transfer_otp": {
     req:{headers:{"Access-Token":"eyJ… (user)"}, body:{otp:"1234"}},
     res:{status:200, body:{transferred:true, amount:20.0, fee:1.15, recipient:"9665XXXXXXXX"}},
     errors:[{status:422, body:{error:"limit exceeded"}},{status:401, body:{error:"wrong otp"}}],
     logSig:"ProfilesController#credit_transfer_otp → Oracle::Transaction DEBIT/CREDIT (compensating on fail)"},
   "GET /api/users/profile/terminate_number_init": {
     req:{headers:{"Access-Token":"eyJ… (user)"}},
     res:{status:200, body:{payable_amount:45.0, refundable_balance:12.5, deposit:0.0}},
     errors:[],
     logSig:"ProfilesController#terminate_number_init → ProfileManager"},
   "POST /api/users/profile/terminate_number_process": {
     req:{headers:{"Access-Token":"eyJ… (user)"}, body:{otp_verified:true}},
     res:{status:200, body:{terminated:true, mobile_number:"9665XXXXXXXX"}},
     errors:[{status:422, body:{error:"outstanding balance"}}],
     logSig:"#terminate_number_process → ProfileManager#terminate_mobile_number (BSS + Semati release)"},

   "GET /api/sim_replacement/validate_mobile_number": {
     req:{headers:{}, query:{mobile_number:"9665XXXXXXXX"}},
     res:{status:200, body:{valid:true, sim_type:"physical", account_state:"ACTIVATED"}},
     errors:[{status:404, body:{error:"number not found"}}],
     logSig:"SimReplacementController#validate_mobile_number → Oracle::Subscription"},
   "GET /api/sim_replacement/:id/double_auth_list": {
     req:{headers:{}, note:"checkout id in path"},
     res:{status:200, body:{options:["password","email_otp","sms_otp","nafath"]}},
     errors:[],
     logSig:"#double_auth_list"},

   "GET /api/external_renewal/checkout": {
     req:{headers:{}, query:{checkout_id:"chk_XXXX"}},
     res:{status:200, body:{plan:{id:12,name:"Solo 99",price:99}, balance:40.0, can_pay_with_balance:false}},
     errors:[{status:404, body:{error:"checkout not found / expired"}}],
     logSig:"ExternalRenewalsController#checkout (unauthenticated, checkout-id token)"},
   "GET /api/datasims/activate_otp": {
     req:{headers:{"Access-Token":"eyJ… (user)","X-Protocol-Version":"v5"}},
     res:{status:200, body:{otp_sent:true, ref:"otp-XXXX"}},
     errors:[{status:422, body:{error:"not eligible for data sim"}}],
     logSig:"Api::V5::DatasimsController#activate_otp"},

   "POST /delivery/:vendor/callback": {
     req:{headers:{"X-Signature":"<hmac, OTO only>"}, body:{tracking_number:"OTO-XXXX", status:"DELIVERED", awb:"123456"}},
     res:{status:200, body:"OK"},
     errors:[{status:401, body:{error:"bad signature (OTO)"}}],
     logSig:"CallbacksController#delivery → DeliveryManager.process_callback (OTO HMAC-verified; others unverified)"},
   "POST /eChannels/iam/callback": {
     req:{headers:{"Content-Type":"application/jwt"}, body:{jwt:"eyJhbGci…"}, note:"Nafath posts a JWT (⚠ decoded WITHOUT signature verification)"},
     res:{status:200, body:"5050111"},
     errors:[],
     logSig:"CallbacksController#iam_new → decode JWT → order/checkout update → RegisterNumberOnSematiWorker"},
   "POST /hyperbill/callback": {
     req:{headers:{}, body:{invoice_id:"HB-XXXX", status:"PAID", amount:95.68}},
     res:{status:200, body:"5050111"},
     errors:[],
     logSig:"CallbacksController#hyperbill → mark Invoice paid (⚠ weak/no verification)"},

   "POST /api/users/sign_up": {
     req:{headers:{"X-Protocol-Version":"v1"}, body:{mobile_number:"9665XXXXXXXX", password:"••••••", nationality_id:"1000000000"}},
     res:{status:201, body:{"access-token":"eyJ…", user:{id:42, mobile_number:"9665XXXXXXXX", full_name:"Test User"}}},
     errors:[{status:422, body:{error:"account already exists"}},{status:404, body:{error:"number not active on Salam"}}],
     logSig:"Users::RegistrationController#create → User.set_from_Oracle / set_from_onboarding_order"},
   "POST /api/guests/sign_in": {
     req:{headers:{}, body:{mobile_number:"9665XXXXXXXX"}},
     res:{status:200, body:{otp_sent:true, message:"OTP sent"}},
     errors:[{status:429, body:{error:"too many attempts"}},{status:404, body:{error:"not a subscriber"}}],
     logSig:"Api::V1::Guests::AuthenticationController#create → Otp + Redis attempt limits"},
   "POST /api/users/passwords/forgot": {
     req:{headers:{}, body:{mobile_number:"9665XXXXXXXX"}},
     res:{status:200, body:{otp_sent:true, channel:"sms"}},
     errors:[{status:404, body:{error:"user not found"}}],
     logSig:"Users::PasswordsController#forgot → Otp(msg_type: forgot_password)"},
   "GET /api/stores/get_stores": {
     req:{headers:{"Access-Token":"eyJ… (anonymous)"}, query:{lat:"24.7136", lng:"46.6753"}},
     res:{status:200, body:{stores:[{id:8, name:"Salam Riyadh Gallery", type:"flagship", lat:24.71, lng:46.67, distance_km:2.4, working_hours:"09:00–23:00"}]}},
     errors:[],
     logSig:"StoresController#get_stores → StoresProcessor + DistanceCalculator (Google Maps)"},
   "GET /api/categories": {
     req:{headers:{"Access-Token":"eyJ…"}},
     res:{status:200, body:{categories:[{id:1, name:"Plans", slug:"plans"},{id:2, name:"Devices", slug:"devices"}]}},
     errors:[],
     logSig:"Api::V1::CategoriesController#index"},
   "GET /api/lookup/*": {
     req:{headers:{"Access-Token":"eyJ…"}, note:"one endpoint per lookup: nationalities, operators, recharge_options, home_delivery_areas, esim_devices, countries/:region, credit_denominations, app_config, delivery_times …"},
     res:{status:200, body:{nationalities:[{id:1, name_en:"Saudi", name_ar:"سعودي", iso3:"SAU"}], /* shape varies per lookup */}},
     errors:[],
     logSig:"Api::V1::LookupController#<lookup> (see route inventory for the full list)"},
   "POST /api/apollo/checkout/otp_confirm": {
     req:{headers:{"X-Api-Key":"<apollo key>"}, body:{order_id:"a1b2…uuid", otp:"1234"}},
     res:{status:200, body:{order_id:"a1b2…uuid", verified:true, state:"payment"}},
     errors:[{status:401, body:{error:"wrong otp"}}],
     logSig:"Api::ApolloCheckoutController#otp_confirm → Otp#verify!"},
   "POST /api/apollo/tcc/sms/send": {
     req:{headers:{"X-Api-Key":"<apollo key>"}, body:{nationality_id:"1000000000", message:"Your Salam order is ready"}},
     res:{status:200, body:{sent:true, reference:"TCC-XXXX"}},
     errors:[{status:502, body:{error:"TCC unavailable"}}],
     logSig:"Api::V1::Apollo::TccController#send_sms → Tcc service"},
   "POST /api/sim_replacement/contact_number_otp": {
     req:{headers:{"Access-Token":"eyJ… (user)"}, body:{checkout_id:"chk_XXXX"}},
     res:{status:200, body:{otp_sent:true, ref:"otp-XXXX"}},
     errors:[{status:422, body:{error:"contact number invalid"}}],
     logSig:"SimReplacementController#contact_number_otp → Otp(msg_type: sim_replacement)"},
   "DELETE /api/users/profile/cancel_profile": {
     req:{headers:{"Access-Token":"eyJ… (user)"}},
     res:{status:200, body:{deleted:true}},
     errors:[],
     logSig:"ProfilesController#cancel_profile → soft-delete → deleted_users"},
   "PATCH /api/users/profile/terminate_number": {
     req:{headers:{"Access-Token":"eyJ… (user)"}, body:{}},
     res:{status:200, body:{otp_sent:true, payable_amount:45.0}},
     errors:[{status:422, body:{error:"line not terminable"}}],
     logSig:"ProfilesController#terminate_number → Otp(msg_type: line_deactivation)"}
  };
  if (typeof API_SAMPLES !== "undefined") Object.assign(API_SAMPLES, EXTRA);
})();
