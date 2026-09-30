/* DMS ADMIN / CMS JOURNEYS — the back-office and system-internal journeys as the production code
 * defines them (30 Sep 2026). Companion of dmsJourneySpec.js (dealer journeys): same object shape,
 * new SYS keys, new families. Source: the decompiled production JARs under
 * /home/claude/dms/services/<service>/src (+ resources), read against DMS-FEATURE-DATAFLOW-MAP.md §1/§4/§5/§6
 * and dmsApiDocs.json (index entries with caller "cms", "internal", "partner", "callback", "unknown").
 *
 * Evidence only. Where the code does not settle a point the text says "not determined from code".
 * `console` = null everywhere: none of these journeys has a board yet. `sanity` = [] (the CRQ000000185185
 * sanity list has no admin rows). `rules` = [] — candidates are in ADMIN_RULE_CANDIDATES (prefix A).
 *
 * "NO audit row" in a signature means: the service has no producer (CHS, RPT, DOC, WAS, CON, CAB, PRD, APC)
 * — the only trace is the service's own log file (DMS-FEATURE-DATAFLOW-MAP.md §4.1).
 * Operator identity: no service verifies a bearer; CUS/PAY put the plain `username` header in cms_logs.username,
 * ONB/NOT put only the raw request body in user_onboarding_logs (username_req = the SUBJECT of the call, not the
 * operator), CHS/WAS/RPT/DOC log to file only. Whether the CMS portal sends a `username` header is not
 * determined from code (DMS-CODE-G-ADMIN.md §2). */
'use strict';

const ADMIN_SYS = {
  cms: 'CMS back-office portal (browser client, origin https://prod-div-tec.web.app per the CUS CORS bean)',
  chs: 'dms_channel_service (/chs) — no audit producer',
  rpt: 'dms_reports_service (/reports) — no audit producer',
  doc: 'dms_docmanagement_service (/doc_management) — no caller in the tree',
  okm: 'OpenKM (172.31.43.11 for CHS/WAS via SDK; 172.31.43.61 for DOC)',
  con: 'dms_audit_logs_consumer_service (/audit-log) — writes the ledgers, exposes an unauthenticated query API',
  prd: 'dms_audit_logs_producer_service (/rabbit) → RabbitMQ dms.direct.exchange',
  mq: 'RabbitMQ 172.31.42.34-36 (4 queues + 4 unread DLQs)',
  bi: 'Salam BI (x-api-key channel on UIL /salambi)',
  zatca: 'ZATCA e-invoicing (CSV drop under /opt/dmsprod/GENERATE_EINV/INPUT/INIT/, ingestion outside the tree)',
  trmscom: 'trms-commission-service (node 137, not decompiled; HTTP :9003 /cos/*)',
  redis: 'Redis 172.31.43.118 (CUS/ONB caches)',
  sadad: 'SADAD (SBM) — SOAP callback into CAB / PAY',
  cab: 'dms_callback_service (/cab, SOAP) — no DB, no audit',
  esmg: 'ESMG SMS gateway table esmg.esmg_sms_mt (172.31.42.39)',
  smtp: 'SMTP 172.20.50.13:25',
  fcm: 'FCM legacy push API',
  sched: 'Spring @Scheduled job (in-process, one copy per running instance)',
  portal: 'Self-activation / online portal (x-api-key caller of UIL)',
  eshop: 'Salam e-shop proxy.salammobile.sa (QR SIM issuance)'
};

const ADMIN_FAMILIES = {
  admin_users: { label: 'Dealer & user administration', icon: '👤', doc: 'DMS-CODE-G-ADMIN.md' },
  admin_channels: { label: 'Channels, documents & inventory', icon: '🏬', doc: 'DMS-CODE-G-ADMIN.md' },
  admin_money: { label: 'Admin money flows', icon: '◈', doc: 'DMS-CODE-G-ADMIN.md' },
  admin_config: { label: 'Configuration & catalogue', icon: '⚙', doc: 'DMS-CODE-G-ADMIN.md' },
  admin_reports: { label: 'Reports, dashboards & audit reads', icon: '▤', doc: 'DMS-CODE-G-ADMIN.md' },
  system: { label: 'System & batch', icon: '⏱', doc: 'DMS-CODE-G-ADMIN.md' }
};

/* step: { ep, svc, note } — ep is the full URI as served (dmsApiDocs.json paths), in the order the portal /
 * the system follows. svc keys come from SYS (dmsJourneySpec.js) + ADMIN_SYS above. */
const ADMIN_JOURNEYS = [
  /* ───────────────────────────── admin_users ───────────────────────────── */
  {
    key: 'cms_users', family: 'admin_users', label: 'CMS user & rights management', sanity: [], console: null,
    purpose: 'Create / update / deactivate / delete the back-office (CMS portal) operators and assign them cms_rights. The rights are stored and returned to the portal; no service evaluates them on any admin endpoint.',
    steps: [
      { ep: 'POST /onboarding/cms/user/rights', svc: 'onb', note: 'cms_rights master list (CmsRightsRepository.getAll)' },
      { ep: 'POST /onboarding/cms/user/getusers', svc: 'onb', note: 'cms_users with their rights' },
      { ep: 'POST /onboarding/cms/user/adduser', svc: 'onb', note: 'Keycloak admin POST users under keycloak.admin.cms.user.url (realm cmsapplication) with the LITERAL password "cms@***" (CmsUserService.java l.58) → cms_users(status ACTIVE, is_temp_password=true) → one cms_users_rights row per right id (findById().get() — unknown id → NoSuchElementException after the user row is already saved). On any exception the catch block logs and returns a BaseResponse with NO response code (null)' },
      { ep: 'POST /onboarding/cms/user/updateuser', svc: 'onb', note: 'Keycloak updateUserName → native DELETE of the user\'s rights → re-insert rights → save; role/mobile/email/department overwritten' },
      { ep: 'POST /onboarding/cms/user/updatestatus', svc: 'onb', note: 'cms_users.status = request value (free text); no Keycloak session revocation, login checks equalsIgnoreCase("Active") only' },
      { ep: 'POST /onboarding/cms/user/deleteuser', svc: 'onb', note: 'Keycloak DELETE users/{id} then native DELETE cms_users / cms_users_rights (CmsUserRepositoryImpl); findById().get() NPE-style failure when the id is unknown, no try/catch' }
    ],
    systems: ['cms', 'gw', 'onb', 'kc', 'ledger'],
    signature: [
      'user_onboarding_logs api_name=/onboarding/cms/user/adduser response_Code=00 (request body carries userName/email/mobile/role/rights; username_req = the NEW user, not the operator)',
      'dms_v1.cms_users row (key_cloak_user_id, status ACTIVE, is_temp_password 1) + dms_v1.cms_users_rights rows',
      'user_onboarding_logs /onboarding/cms/user/updateuser | /updatestatus | /deleteuser 00 — no operator identity anywhere in the row'
    ],
    breaks: [
      'Every CMS user is created with the same hard-coded initial password ("cms@***", CmsUserService.java l.58) and is_temp_password=true; nothing forces the change (login only returns isFirstLogin)',
      'Realm mismatch: users are created under keycloak.admin.cms.user.url = …/realms/cmsapplication/users but keycloak.cms.login.url = …/realms/dmsapplication/… (application-preprod.properties l.88 vs l.99) — whether a user created by this endpoint can log in through /onboarding/user/login userType=cms is not determined from code',
      'No endpoint checks a cms_rights entry: the rights only travel to the portal (dashboard / getusers); enforcement is client-side (DMS-FEATURE-DATAFLOW-MAP.md §6.4)',
      'addUser: cms_users row saved before the rights loop; an unknown right id throws after the save → user without rights and a response with responseCode=null',
      'No server-side authentication on /onboarding/** (Spring Security csrf().disable() only) — anyone who reaches ONB can create a CMS operator'
    ],
    rules: []
  },
  {
    key: 'cms_access', family: 'admin_users', label: 'CMS operator login & password reset', sanity: [], console: null,
    purpose: 'How a CMS operator gets a session: the same /onboarding/user/login endpoint as dealers with userType="cms", plus OTP/forgot-password and resetPassword branches that also accept userType="cms".',
    steps: [
      { ep: 'POST /onboarding/user/login (userType=cms)', svc: 'onb', note: 'Keycloak password grant with keycloak.cms.* = keycloak.dms.* (realm dmsapplication, client dmsclient) → cms_users.findByUsername → 1502 when status != Active → token + isFirstLogin=is_temp_password (UserLoginService.java l.165-186). No session pruning, no device binding for cms' },
      { ep: 'POST /onboarding/user/generateotp[forforgotpassword] → /verifyotp[forforgotpassword] (userType=cms)', svc: 'onb', note: 'OTP sent to cms_users.contact_number / email (UserLoginService.java l.339-345); onboarding_otp row' },
      { ep: 'POST /onboarding/user/resetPassword (userType=cms)', svc: 'onb', note: 'username + newPassword only: cms_users.findByUsername → Keycloak PUT users/{id} reset-password → is_temp_password=false (UserLoginService.java l.600-636). NO OTP / old-password check server-side' },
      { ep: 'POST /onboarding/user/changePassword · /verify-password', svc: 'onb', note: 'old password verified through a Keycloak password grant; verify-password deletes the session it created' },
      { ep: 'POST /onboarding/v1/user/dashboard (userType=cms)', svc: 'onb', note: 'returns the operator\'s cms_users_rights list (DashboardServiceImpl.java l.68-95) — this is the only place the CMS rights are read' }
    ],
    systems: ['cms', 'gw', 'onb', 'kc', 'sms', 'ledger'],
    signature: [
      'user_onboarding_logs api_name=/onboarding/user/login response_Code=00 with request userType=cms (username_req = operator); CON also fires the "Login" push/SMS/e-mail notifications for a 00 login regardless of userType (not determined from code whether dms_user_login_details lookup fails silently for a CMS user)',
      'user_onboarding_logs /onboarding/user/resetPassword 00 — the only trace of an operator password reset'
    ],
    breaks: [
      '/onboarding/user/resetPassword resets ANY CMS operator\'s password with only the username (no OTP, no old password) — same defect as for dealers (dmsJourneySpec.js login break) but on the back-office side',
      'Bearer tokens minted at login are never verified by any service (KeyCloakUserUtil.validateUserToken has no caller); the portal identity downstream is whatever `username` header the portal sends',
      'CMS and dealer realm/client are identical in properties (keycloak.cms.* = keycloak.dms.*): a dealer credential can obtain a token that the portal would accept, and vice-versa, unless the gateway separates them (not determined from code)'
    ],
    rules: []
  },
  {
    key: 'dealer_admin', family: 'admin_users', label: 'Dealer user create / update / status / delete', sanity: [], console: null,
    purpose: 'Back-office lifecycle of a dealer (dms_users): creation with Keycloak user + wallet account + credentials by mail/SMS, edits (rights, plan block-list, add-ons, limits, flags), status changes, deletion, roles, bulk Excel.',
    steps: [
      { ep: 'POST /onboarding/dms/user/rights · /getusers · /getfastusers · /getuserssearch · /getuserssearchbytype[download] · /getuserreport', svc: 'onb', note: 'listing / search; getuserreport is Redis-cached 600 s (reportDownload)' },
      { ep: 'POST /onboarding/dms/user/adduser', svc: 'onb', note: 'javax validation → shop code unique (findAllByShopCode) → CHS /chs/v1/channel/getById must be Active (1503) → CALL fn_get_username(userType) → random 8-char password → Keycloak POST users (realm dmsapplication) → WAS POST /was/account/create (wallet_accounts + wallet_balance + <account>_secret.key file) → INSERT dms_users (dealer_code = prefix_accountNumber), dms_users_payment_method, dms_users_rights, dms_users_plans, dms_user_addons → NOT sendemail + sendsms with the CLEAR password (DmsUserServiceImpl.java l.203-431)' },
      { ep: 'POST /onboarding/dms/user/updateuser', svc: 'onb', note: '@Transactional; deletes and re-inserts rights / plans / add-ons; 1562 when maximum_devices < registered devices' },
      { ep: 'POST /onboarding/dms/user/updatestatus', svc: 'onb', note: 'dms_users.status = free text + reason_for_deactivation (l.1520-1545); NO Keycloak session revocation, NO Semati/Nafath clear' },
      { ep: 'POST /onboarding/dms/user/enable-qr', svc: 'onb', note: 'is_qr_enabled toggle' },
      { ep: 'POST /onboarding/dms/user/deleteuser', svc: 'onb', note: 'Keycloak DELETE then native DELETE FROM dms_users (l.1050-1058); wallet account NOT closed; children rows depend on FK cascade (DDL not in tree)' },
      { ep: 'POST /onboarding/dms/user/adduserroles · /updateuserroles · /deleteuserrole · /getalluserrole · /getuserbyrole', svc: 'onb', note: 'dms_users_role_details (employee records, unique employee id)' },
      { ep: 'POST /onboarding/dms/user/add-bulk-users · /update-bulk-users (multipart Excel)', svc: 'onb', note: 'file written to the JVM CWD and never deleted; per-row this.addUser()/updateUser() IN-PROCESS (l.1587) → only the upload itself is ledgered; per-row outcome in dms_bulk_edit_status' }
    ],
    systems: ['cms', 'gw', 'onb', 'chs', 'kc', 'wallet', 'sms', 'smtp', 'esmg', 'ledger'],
    signature: [
      'user_onboarding_logs api_name=/onboarding/dms/user/adduser response_Code=00 (firstname_req, email_req, msisdn_req, channel_id_req, rights_req, plans_req; username_req empty because the request has no userName — the username is generated)',
      'user_onboarding_logs /notification/notification/sendemail + /sendsms rows (NOT filter) — the SMS body (with the password) is in the raw request column',
      'dms_v1.dms_users row (status Active, account_number, dealer_code, key_cloak_user_id) + dms_users_payment_method + dms_users_rights + dms_users_plans + dms_user_addons; trms_wallet.wallet_accounts + wallet_balance (0); Keycloak user',
      'user_onboarding_logs /onboarding/dms/user/updateuser | /updatestatus | /deleteuser | /enable-qr 00 (user_id_req / usetype_req)',
      'bulk: user_onboarding_logs /onboarding/dms/user/add-bulk-users 00 + dms_v1.dms_bulk_edit_file_details + dms_bulk_edit_status per row (NO per-user ledger row)'
    ],
    breaks: [
      'No compensation: Keycloak user and wallet account are created BEFORE the dms_users insert; a DataIntegrityViolation ("ID number already exists on this channel") or any later exception leaves an orphan Keycloak user + wallet account + secret-key file (l.226, l.344, catch l.412-431)',
      'Initial password travels in clear by SMS and e-mail and sits in user_onboarding_logs.request (NOT filter) forever',
      'updatestatus does not revoke Keycloak sessions or Semati/Nafath rows: a deactivated dealer keeps working until the token expires or the 23:58 logout-all',
      'deleteuser leaves the wallet account (and its balance) and the Keycloak sessions; native DELETE bypasses JPA cascades',
      'Bulk create/update: individual creations are invisible in any ledger; the Excel stays on disk',
      'Operator identity absent: ONB\'s filter ships only the request body (HttpLoggingFilter.java l.171-186) — who created/deactivated/deleted a dealer is not recorded anywhere'
    ],
    rules: []
  },
  {
    key: 'dealer_session_reset', family: 'admin_users', label: 'Support resets: Semati/Nafath clear, logout-all, password reset', sanity: [], console: null,
    purpose: 'Support-desk actions on a dealer session: clear the regulator session so the dealer can re-login at Semati/Nafath, force everyone out (Keycloak realm logout-all + close attendance), reset a dealer password.',
    steps: [
      { ep: 'POST /onboarding/dms/user/clearSematiSession {idNumber, userName}', svc: 'onb', note: 'nafath_record latest-by-person must exist (else 1571) → native DELETE semati_login_details of today for the username (all devices) → delete that nafath_record (DmsUserServiceImpl.java l.1769-1811)' },
      { ep: 'POST /onboarding/dms/user/logoutAll', svc: 'onb', note: 'Keycloak POST realms/dmsapplication/logout-all (EVERY session of the realm, dealers and CMS operators alike) + native UPDATE dms_attendance SET logout_time=NOW() (l.1547-1561); also run by the 23:58 cron (see job_logout_all)' },
      { ep: 'POST /onboarding/user/resetPassword (userType=dms)', svc: 'onb', note: 'username + newPassword → Keycloak reset; no OTP check (UserLoginService.java l.600)' }
    ],
    systems: ['cms', 'gw', 'onb', 'kc', 'ledger'],
    signature: [
      'user_onboarding_logs api_name=/onboarding/dms/user/clearSematiSession 00 (request idNumber, userName) — dms_v1.semati_login_details rows of the day gone, nafath_record row gone',
      'user_onboarding_logs /onboarding/dms/user/logoutAll 00 — dms_v1.dms_attendance.logout_time set on every open row',
      'user_onboarding_logs /onboarding/user/resetPassword 00'
    ],
    breaks: [
      'logoutAll is realm-wide: one support click logs out every dealer in the country and every CMS operator; the response is 00 even when Keycloak failed (catch logs only, l.1557)',
      'clearSematiSession requires a nafath_record for the id but deletes semati_login_details by USERNAME — the two inputs are not cross-checked (any username can be cleared by naming any id that has a Nafath record)',
      'resetPassword: no proof of possession; the caller only needs the username'
    ],
    rules: []
  },
  {
    key: 'devices_qr_admin', family: 'admin_users', label: 'Device binding, QR locations & login-without-QR approvals', sanity: [], console: null,
    purpose: 'Back-office control of the dealer app binding (which Android devices, how many users per device), the outlet QR locations and the daily approvals of "login without QR".',
    steps: [
      { ep: 'POST /onboarding/device/getDeviceInfo · /getAllRegisteredDevices · /getAllRegisteredUsers', svc: 'onb', note: 'reads dms_device_ids / dms_device_registration (400/505 on bad pagination / unknown user)' },
      { ep: 'POST /onboarding/device/updateMaximumUsers', svc: 'onb', note: 'dms_device_ids.maximum_users; 1562 when fewer than currently registered' },
      { ep: 'POST /onboarding/device/unregisterUser', svc: 'onb', note: 'DELETE dms_device_registration (device, user); Keycloak session NOT deleted here (only the dealer-side deleteRegisteredDevice does)' },
      { ep: 'POST /onboarding/qr/saveqrdetails · /getalllocations', svc: 'onb', note: 'qr_details create/update (response code 00 with message "Failure: Failed to update data" on the success path — QrServiceImpl, see dmsApiDocs codes)' },
      { ep: 'POST /onboarding/qr/update-qr-scan-login-time · GET /get-qr-scan-login-time', svc: 'onb', note: 'qr_scan_login_time id=1 (scan window); the login flow does getById(1) — a missing row breaks EVERY dealer login with 1500' },
      { ep: 'POST /onboarding/qr/getlistbystatus → /qr/updatestatus {ids, status}', svc: 'onb', note: 'login_without_qr_requests.status/updated_by; first request of the day is auto-Approved by the dealer flow, later ones wait here' }
    ],
    systems: ['cms', 'gw', 'onb', 'ledger'],
    signature: [
      'user_onboarding_logs /onboarding/device/updateMaximumUsers | /unregisterUser 00 → dms_v1.dms_device_ids / dms_device_registration',
      'user_onboarding_logs /onboarding/qr/saveqrdetails | /update-qr-scan-login-time | /updatestatus 00 → dms_v1.qr_details / qr_scan_login_time / login_without_qr_requests(updated_by = body username)'
    ],
    breaks: [
      'unregisterUser leaves the Keycloak session of that device alive',
      'qr_scan_login_time is a single row read with getById(1) at login: an admin edit that deletes/renumbers it turns into a login outage masked as 1500',
      'saveqrdetails / update-qr-scan-login-time answer 00 with a "Failure" message text on success (dmsApiDocs.json codes) — alerting on message text is unreliable',
      'NOT job every24HrsPendingReport counts Pending login_without_qr_requests older than yesterday — approvals left pending block the dealer with 1508 the next day'
    ],
    rules: []
  },

  /* ─────────────────────────── admin_channels ─────────────────────────── */
  {
    key: 'channel_admin', family: 'admin_channels', label: 'Channel (outlet) create / update / status / hierarchy', sanity: [], console: null,
    purpose: 'Master data of dealer outlets (dms_channel): creation, review/update, activation (which auto-creates the owner dealer user), deletion, and moving/swapping subtrees. The whole service is unaudited.',
    steps: [
      { ep: 'POST /chs/v1/channel/list · /listall · /listByType[V2] · /listByStatus · /search · /filterByParams · /getById · /getByErpCode · /listhierarchy · /rapidlisthierarchy', svc: 'chs', note: 'reads dms_channel (+ APC /apc/v1/region/list for region names; filterByParams → ONB getuserbyusername). Also the server-to-server lookups CUS/ONB/RPT depend on' },
      { ep: 'POST /chs/v1/channel/add', svc: 'chs', note: 'status Active for distributor/sub_distributor/mtl/rtl/rtl_acm, Pending otherwise; rtl unique per district; 07 regional team leader exists, 09 name exists → save dms_channel → if Active: private addUser() → ONB POST /onboarding/dms/user/adduser (owner user, rights = dms.user.rights property, limits 20/100 literal, fpDeviceId "Automated", geographicalArea "1000000000000") — response only logged (ChannelServiceImpl.java l.544-636, l.1219-1249)' },
      { ep: 'POST /chs/v1/channel/update · /reviewandupdate', svc: 'chs', note: 'same impl; when the status becomes Active → addUser() + status e-mail via NOT sendemail with "#loggedinusername#" = body username (l.808-822)' },
      { ep: 'POST /chs/v1/channel/updateStatus', svc: 'chs', note: 'status = request value (free text) → save → NOT sendemail "Onboarding Channel Status Update" → addUser() again if Active (l.1143-1169); any Throwable → printStackTrace + empty BaseResponse (no code)' },
      { ep: 'POST /chs/v1/channel/changehierarchy {changeType Transfer|SWAP, fromChannel, toChannel}', svc: 'chs', note: 'JPQL bulk UPDATE parent_id (@Modifying present, DmsChannelRepository.java l.47-55); SWAP re-parents children of both sides; response body EMPTY (no code) even on success; Throwable swallowed (l.860-880)' },
      { ep: 'POST /chs/v1/channel/delete', svc: 'chs', note: 'deleteById; 06 when child channels exist (FK violation)' }
    ],
    systems: ['cms', 'gw', 'chs', 'apc', 'onb', 'sms', 'smtp', 'kc', 'wallet'],
    signature: [
      'NO audit row for any /chs/** call (HttpLoggingFilter writes log.debug only — dms_channel_service/src/com/es/dms/channel/filter/HttpLoggingFilter.java l.55-87); only channel-service.log at DEBUG',
      'dms_v1.dms_channel row / status / parent_id change',
      'indirect traces only: user_onboarding_logs /onboarding/dms/user/adduser (owner user, ownerUser=true, channel_id_req) and user_onboarding_logs /notification/notification/sendemail (status mail) — these two rows are the ONLY database evidence that a channel was activated, and they carry no operator identity',
      'hierarchy moves and deletes: no row anywhere'
    ],
    breaks: [
      'Channel service is completely unaudited: create, status, hierarchy, delete leave no ledger row (DMS-FEATURE-DATAFLOW-MAP.md §9.1)',
      'Every transition to Active re-runs addUser(): a second activation of the same channel attempts a second owner user; only the shop-code uniqueness check in ONB (findAllByShopCode) stops it — a channel with a NULL shop code is not protected (not determined from code how findAllByShopCode(null) behaves)',
      'Owner creation failure is only logged (l.1244-1247): an Active channel without an owner user is a valid end state (see dmsJourneySpec rule L9)',
      'changehierarchy returns an empty response for success AND for a swallowed exception — the portal cannot distinguish them',
      'status is free text on updateStatus; the login path compares equalsIgnoreCase("Active") — a typo silently deactivates dealers',
      'No authentication on /chs/** and CORS * (DMS-FEATURE-DATAFLOW-MAP.md §6.2-6.3)'
    ],
    rules: []
  },
  {
    key: 'channel_documents', family: 'admin_channels', label: 'Dealer document upload (OpenKM)', sanity: [], console: null,
    purpose: 'Attach CR document, owner id and POS contract of a channel to OpenKM; the contract upload also activates the channel.',
    steps: [
      { ep: 'POST /chs/v1/channel/uploaddocuments {crNumber, crDocument, ownerIdDocument, posContract}', svc: 'chs', note: '1001 when a file is missing → OKMWebservicesFactory.newInstance(url, "okmAdmin", ***) → folder /okm:root/<crNumber>, document <uuid>.<ext> (ChannelServiceImpl.java l.882-905, uploadFile l.1171-1218) → UUIDs saved on dms_channel' },
      { ep: 'POST /chs/v1/channel/updatedocuments', svc: 'chs', note: 'controller logic; replaces the documents' },
      { ep: 'POST /chs/v1/channel/uploadcontract {id, contract}', svc: 'chs', note: '05 invalid id, 1001 missing → OpenKM upload → dms_channel.status = "Active" + addUser() (owner user via ONB) (l.1068-1099)' },
      { ep: '(unused) POST /doc_management/file/upload · /file/get', svc: 'doc', note: 'dms_docmanagement_service talks to a DIFFERENT OpenKM (https://172.31.43.61:8080) and always answers 00; CHS declares DocManagementServiceClient but never calls it (feature map §9.3)' }
    ],
    systems: ['cms', 'gw', 'chs', 'okm', 'onb', 'doc'],
    signature: [
      'NO audit row (CHS); channel-service.log DEBUG line with the multipart request',
      'OpenKM node /okm:root/<crNumber>/<uuid>.<ext> (outside every DMS database); dms_v1.dms_channel cr_document / owner_id_document / pos_contract UUID columns',
      'uploadcontract additionally: dms_channel.status=Active + user_onboarding_logs /onboarding/dms/user/adduser (owner user)'
    ],
    breaks: [
      'OpenKM administrator credentials are hard-coded in three services (CHS, WAS, DOC) and the documents are written as okmAdmin — no per-operator identity at the DMS side',
      'uploadcontract is a second, undocumented activation path (status → Active + owner user) with no ledger row',
      'The document service is dead code with its own OpenKM host: two document stores, one of which nothing reads',
      'Whether OpenKM upload failure is reported to the portal is not determined from code (uploadFile returns the UUID or null; callers store null)'
    ],
    rules: []
  },
  {
    key: 'commission_config', family: 'admin_channels', label: 'Commission configuration (per channel / dealer type)', sanity: [], console: null,
    purpose: 'CRUD of commission_configurations (SIM activation, 1st/2nd/3rd recharge, e-top-up commission amounts and types per channel or dealer type).',
    steps: [
      { ep: 'POST /chs/v1/commissionConf/list · /listByType · /getById', svc: 'chs', note: 'reads; 08 invalid id' },
      { ep: 'POST /chs/v1/commissionConf/add · /update · /delete', svc: 'chs', note: 'CommissionConfigurationRepository.save / deleteById (CommissionConfigurationServiceImpl.java l.78-185); no validation of amounts or types' }
    ],
    systems: ['cms', 'gw', 'chs', 'trmscom'],
    signature: [
      'NO audit row (CHS); dms_v1.commission_configurations row',
      'consumer of the table: none of the 14 decompiled services reads commission_configurations — presumably trms-commission-service (not decompiled) → not determined from code'
    ],
    breaks: [
      'A change to what dealers earn per activation/recharge leaves no trace and no before/after value anywhere',
      'Whether trms-commission-service reads this table live or caches it is not determined from code'
    ],
    rules: []
  },
  {
    key: 'device_inventory_admin', family: 'admin_channels', label: 'Device catalogue & inventory administration (+ bulk upload)', sanity: [], console: null,
    purpose: 'Back-office side of device sales: attribute master data, device configurations (item no, price, VAT, images), inventory rows, assignment to channels, returns acceptance, and the Excel bulk load of serials.',
    steps: [
      { ep: 'POST /cus/devicesales/savedeviceattributes · /updatedeviceattributes · /deletedeviceattributes', svc: 'cus', note: 'device_brand / device_color / device_ram / device_storage_capacity' },
      { ep: 'POST /cus/devicesales/savedeviceconfiguration · /updatedeviceconfiguration · /deletedeviceconfiguration · /deleteitem', svc: 'cus', note: 'device_configurations + device_images; deletedeviceconfiguration also deletes device_inventory + device_assigning_details rows of the item' },
      { ep: 'POST /chs/v1/channel/uploadbulkdeviceinventory (Excel)', svc: 'chs', note: 'MyBatis insert into device_inventory after validating item numbers against device_configurations (ChannelServiceImpl.java l.906-1038); username passed as a request part' },
      { ep: 'POST /cus/devicesales/assigninventory · /updateinventory · /updatestatusforreturns · /getdevicecountsofallusers · /filteruserbydate', svc: 'cus', note: 'device_inventory status updates (1533 already assigned), returns accept/reject, admin reports' }
    ],
    systems: ['cms', 'gw', 'cus', 'chs', 'ledger'],
    signature: [
      'cms_logs api_name=/cus/devicesales/<admin op> response_Code=00 with username = `username` header (CUS filter) — the CUS-side admin actions ARE ledgered',
      'dms_v1.device_brand/color/ram/storage_capacity, device_configurations, device_images, device_inventory, device_assigning_details',
      'bulk upload: NO audit row (CHS); device_inventory rows only'
    ],
    breaks: [
      'The same table (device_inventory) is fed by two services with two identities: CUS (audited) and CHS bulk (unaudited)',
      'deletedeviceconfiguration cascades into inventory and assignment rows in code (deleteAllById) — sold-device history for that item disappears with it',
      'Device-sale endpoints are mapped without a leading slash ("devicesales"); the served path is /cus/devicesales/* but the consumer\'s CmsApiNames match for device_sales_logs is uncertain (DMS-CODE-F §4.1)'
    ],
    rules: []
  },
  {
    key: 'sim_inventory_admin', family: 'admin_channels', label: 'SIM inventory administration (assign ranges, transfer, return)', sanity: [], console: null,
    purpose: 'Distributor / back-office side of the SIM inventory: assign an ICCID range to a channel, move inventory between channels, take back an unreceived range. (Receipt, sub-assignment and QR issuance are dealer-app journeys — dmsJourneySpec sim_inventory.)',
    steps: [
      { ep: 'POST /cus/simreceiving/assignsim {cardPackageStart, cardPackageEnd, channelId, userId}', svc: 'cus', note: 'CHS getById (1530 invalid channel, 1532 invalid channel type, 1533 invalid range) → INSERT sim_assigning_details' },
      { ep: 'POST /cus/simreceiving/transfer {id, newChannelId}', svc: 'cus', note: 'sim_inventory.channel_id moved (1550 invalid id, 1530 channel type)' },
      { ep: 'POST /cus/simreceiving/return-assigned-sim', svc: 'cus', note: 'deletes sim_assigning_details when not yet received (1500 "already received"); DMS-CODE-A: delete-then-reinsert without a transaction' },
      { ep: '(admin-side QR issuance)', svc: 'cus', note: 'none in code: /cus/simreceiving/get-qr-details and /issue-sim are dealer-app calls (username header = dealer); no CMS endpoint issues or cancels an e-shop order → not determined from code whether the portal reuses the dealer endpoints' }
    ],
    systems: ['cms', 'gw', 'cus', 'chs', 'ledger'],
    signature: [
      'cms_logs /cus/simreceiving/assignsim | /transfer | /return-assigned-sim 00 (sims_req; receivedBy/From columns swapped per feature map §4.2); username = header',
      'dms_v1.sim_assigning_details / sim_inventory rows; NO journey ledger table for the admin side (sim_receiving_logs is written only for the dealer /receive)'
    ],
    breaks: [
      'Only the dealer receipt has a ledger table; assignment and transfers are cms_logs-only, and /activate never checks inventory ownership (dmsJourneySpec sim_inventory)',
      'return-assigned-sim: delete before re-insert without a transaction (DMS-CODE-A §9.1)'
    ],
    rules: []
  },

  /* ───────────────────────────── admin_money ───────────────────────────── */
  {
    key: 'wallet_refill_admin', family: 'admin_money', label: 'Wallet refill: admin direct credit (v1) & request approval (v2)', sanity: [], console: null,
    purpose: 'Credit a dealer wallet from the back-office: v1 credits immediately from the pseudo account 1234569; v2 approves dealer-raised refill_wallet_requests, crediting each approved id from 1234569.',
    steps: [
      { ep: 'POST /cus/wallet/refill {userId, amount}', svc: 'cus', note: 'dms_users by id → WAS /was/payment/initiate {accountFrom "1234569", accountTo dealer account, amount*100, HYPERPAY_TOPUP, source HYPERPAY, comments "Comments..."} → /was/payment/commit → 00; 1001 on insufficient balance / other; NO dms_v1 write (WalletServiceImpl.java l.204-249)' },
      { ep: 'POST /cus/wallet/getrefillrequestsbystatus {status|All}', svc: 'cus', note: 'refill_wallet_requests by status + CHS getById per row (per-row Throwable swallowed)' },
      { ep: 'POST /cus/wallet/updaterefillrequests {ids "1,2,3", status}', svc: 'cus', note: 'per id: status = request value, updated_by = BODY baseRequest.username → save → if "Approved": WAS initiate+commit from 1234569 (amount*100.0) — current status NOT checked, so an already-Approved id is credited again; after the loop baseResponse is OVERWRITTEN with 00 Success (l.365) so a 1001 credit failure is invisible to the portal (l.315-371)' }
    ],
    systems: ['cms', 'gw', 'cus', 'chs', 'wallet', 'ledger'],
    signature: [
      'cms_logs api_name=/cus/wallet/refill 00 (amount_req, username = header) — NO journey ledger table, NO dms_v1 row',
      'trms_wallet.wallet_payment_initiate account_from=1234569 transaction_type=HYPERPAY_TOPUP status PAID comments="Comments..." (+ wallet_payment_commit) — indistinguishable from a v2 approval credit except by the cms_logs row that precedes it',
      'v2: cms_logs /cus/wallet/updaterefillrequests 00 (ids_req, status_req); dms_v1.refill_wallet_requests status Approved, updated_by = body username; one 1234569 wallet row per approved id'
    ],
    breaks: [
      'Re-approval re-credits: no status guard on updaterefillrequests (rule M7 on the dealer side)',
      'Approved is written BEFORE the credit; a wallet failure leaves an Approved request that was never paid, and the portal still sees 00 (l.365 overwrite)',
      'v1 refill has no request row and no ledger table: the only evidence of an operator crediting money is cms_logs.username = whatever `username` header the portal sent (not determined from code) and a wallet row from 1234569',
      'Amount handling differs: v1 amount*100L (Long), v2 BigDecimal(amount*100.0).toBigInteger() — fractional SAR in v2 rounds silently',
      'Pseudo account 1234569 must have balance in trms_wallet.wallet_balance (initiate checks from.account balance) — who funds it and how is not determined from code'
    ],
    rules: []
  },
  {
    key: 'bulk_disbursement', family: 'admin_money', label: 'Bulk wallet disbursement (finance upload + 1-second payer job)', sanity: [], console: null,
    purpose: 'Finance uploads a CSV/Excel of (Username, Amount(SAR)); rows become PENDING payment_bulk_disbursement records paid by an in-process scheduler from account 1234567 as BULK_WALLET_TRANSFER.',
    steps: [
      { ep: 'POST /was/payment/bulkreport (multipart)', svc: 'wallet', note: '1001 missing file → sheet uploaded to OpenKM via SDK (okmAdmin ***, BulkWalletDisbursementImpl.java l.81-113) → header must be "Username" / "Amount(SAR)" → per row CUS POST /cus/wallet/getagentuseraccount (username → account) → validations (account not found, user not found, amount ≤ 0, accountTo == 1234567) → amount*100 → INSERT payment_bulk_disbursement (status PENDING or the validation text) + bulk_record + bulk_file_completion_time (l.119-297)' },
      { ep: 'POST /was/payment/bulkreport/schedularTime {bulkSchedulerTime "HH:MM:SS"}', svc: 'wallet', note: 'payment_scheduler_time insert/update — NOT a time of day: the job sleeps that long before each run (WaitSchedulerRunning)' },
      { ep: '@Scheduled fixedDelay=1000 BulkWalletDisbursementsJobs.paymentInitialPending', svc: 'sched', note: 'Thread.sleep(payment_scheduler_time) → SELECT payment_bulk_disbursement WHERE status=PENDING → per file, per row: PaymentServiceBulkWalletTransferImpl initiate + commit {accountFrom 1234567, BULK_WALLET_TRANSFER, source TRMS} → status DONE (MyBatis session) → bulk_file_completion_time; on exception: rollback + WalletException (rows paid before the exception are already committed in the wallet ledger) (BulkWalletDisbursementsJobs.java l.45-145)' },
      { ep: 'POST /was/payment/bulkreport/status · /bulkreport/documents', svc: 'wallet', note: 'Queued / Finished / Partially Failed / Failed per file; documents list' }
    ],
    systems: ['cms', 'gw', 'wallet', 'okm', 'cus', 'sched'],
    signature: [
      'NO audit row (WAS filter is log.debug only); cms_logs /cus/wallet/getagentuseraccount rows (one per sheet row, username header absent → cms_logs.username empty) are the only ledger echo of an upload',
      'trms_wallet.payment_bulk_disbursement rows PENDING → DONE, bulk_record, bulk_file_completion_time, payment_scheduler_time',
      'trms_wallet.wallet_payment_initiate/commit account_from=1234567 transaction_type=BULK_WALLET_TRANSFER source_system=TRMS, one PAID pair per row',
      'OpenKM node under the CR-number path with the uploaded sheet'
    ],
    breaks: [
      'The payer job runs unlocked on the 4 WAS instances every second and selects the same PENDING rows; there is no claim/IN_PROGRESS transition before paying, so two instances can pay the same row (the DONE update happens only after initiate+commit) — DOUBLE PAYMENT risk; whether the sleep gate (payment_scheduler_time) de-synchronises the nodes enough is not determined from code',
      'initiate response null → NPE on getSignature (l.85) inside the per-file try: the file is rolled back at MyBatis level but rows already paid in the wallet stay paid',
      'No operator identity: the upload carries a `username` in BaseRequest for logging only; wallet rows say source_system=TRMS',
      'Amount is a float (row1.getCell(1).getNumericCellValue() cast to float, *100) → precision loss above ~167 772 SAR and on cents',
      'Account 1234567 is the SAME pseudo account that receives dealer payments (activation, top-up…): bulk payouts are funded by the operations float; no reconciliation job exists for BULK_WALLET_TRANSFER'
    ],
    rules: []
  },
  {
    key: 'self_activation_admin', family: 'admin_money', label: 'Self-activation portal money hooks (portal → UIL → CUS)', sanity: [], console: null,
    purpose: 'The online self-activation portal (an x-api-key channel of UIL) checks and debits the dealer wallet, files a report row and pays/refunds commission for orders sold under a dealer code. Admin-side view of the dealer journey self_activation.',
    steps: [
      { ep: 'POST /uil/self-activation-portal/wallet/getmsisdn → CUS /cus/self-activtion-portal/getmsisdnbyusername', svc: 'uil', note: 'dealer MSISDN (1501 not found, 1502 not active)' },
      { ep: 'POST /uil/self-activation-portal/wallet/balance → /cus/self-activtion-portal/balance', svc: 'uil', note: 'balance covers amount' },
      { ep: 'POST /uil/self-activation-portal/wallet/deductdealerbalance → /cus/self-activtion-portal/deductdealerbalance', svc: 'uil', note: 'dealerHash must equal HMAC(username_amount, self.activation.portal.key ***) → WAS CASH initiate+commit; "The Amount is Invalid" answered with 00' },
      { ep: 'POST /cus/self-activtion-portal/report', svc: 'cus', note: 'report_request_self_activation row (order_status, refund_status, commission_status, payment_id); caller = portal through UIL (the UIL controller does not expose it → path not determined from code)' },
      { ep: 'POST /uil/self-activation-portal/wallet/commission → /cus/self-activtion-portal/commission', svc: 'uil', note: 'APC price → TRMS commission cos/renew/commission → WAS COMMISSION credit → NOT sendsms → report row saved AFTER the credit' },
      { ep: 'POST /cus/self-activtion-portal/refundcommission (and /uil/mnp/mnp-commission-payout for MNP)', svc: 'cus', note: 'REFUND credit + SMS on port rejection; re-executable' },
      { ep: 'POST /uil/social-security-number/check', svc: 'uil', note: 'Tamkeen eligibility: CUS getsocialdata + APC allowed-count' }
    ],
    systems: ['portal', 'uil', 'cus', 'wallet', 'trmscom', 'apc', 'sms', 'ledger'],
    signature: [
      'uil_logs /uil/self-activation-portal/wallet/* (or /tpi/… depending on the running profile) + cms_logs /cus/self-activtion-portal/* — no journey table',
      'trms_wallet.wallet_payment_initiate CASH PAID comments="Self Activation"; COMMISSION / REFUND credits',
      'dms_v1.report_request_self_activation row'
    ],
    breaks: [
      'HMAC covers username_amount only → replayable debit (rule M12)',
      'Commission is paid before the report row is written; a failure in between leaves money without a report',
      'catch blocks set responseCode="Failure" (string) on several endpoints — not a numeric code the portal expects'
    ],
    rules: []
  },
  {
    key: 'salambi_decrypt', family: 'admin_money', label: 'Salam BI wallet-balance decrypt (/salambi)', sanity: [], console: null,
    purpose: 'Salam BI pulls the decrypted balances of a list of wallet accounts through UIL; WAS decrypts them in memory with the per-account key files.',
    steps: [
      { ep: 'POST /uil/salambi/api/v1/wallet-balance/decrypt {account_no:[…]} (x-api-key)', svc: 'uil', note: 'ApiKeyFilter (uil_channels/uil_channels_api/uil_api_info) → SalamBiServiceClient → WAS; empty result → 1500 "No wallet balances found" (SalamBiController.java, same build served as /tpi/salambi/…)' },
      { ep: 'POST /was/account/decrypt {account_no:[…]}', svc: 'wallet', note: 'reads wallet_balance, decrypts with <account>_secret.key files (WalletAccountCrypto); 999999 on error; NO authentication on WAS' }
    ],
    systems: ['bi', 'uil', 'wallet'],
    signature: [
      'uil_logs api_name=/uil/salambi/api/v1/wallet-balance/decrypt (LoggingAspect) with the account list in the request column — the ONLY trace',
      'WAS: NO audit row (log.debug)'
    ],
    breaks: [
      '/was/account/decrypt is reachable without any key from inside the mesh; whether the gateway exposes /was/** outside is not determined from code',
      'Every balance of every dealer can be pulled in one call by any holder of the BI channel key; UIL api-key rejections leave no ledger row',
      'The wallet\'s own recon and balance endpoints have no audit push: a decrypt call is invisible on the wallet side'
    ],
    rules: []
  },

  /* ───────────────────────────── admin_config ──────────────────────────── */
  {
    key: 'plan_catalogue_admin', family: 'admin_config', label: 'Price plan / add-on catalogue & eligibility administration', sanity: [], console: null,
    purpose: 'Reference data that gates what a dealer may sell: id types and their plan lists (visitor plans), the Tamkeen/social-security switch, the solo-digital recharge block-list, Renew-Now commission rules, id-type status. The catalogue itself (plans, add-ons, prices, flags) lives in Magento and has no DMS endpoint.',
    steps: [
      { ep: 'POST /cus/visitorplan/addvisitorplans', svc: 'cus', note: 'APC /apc/v2/config/getusereligibilitydata (Magento) → dms_visitors_plan.deleteAll() THEN re-insert (VisitorPlanServiceImpl) — a Magento/APC failure after the delete empties the table' },
      { ep: 'POST /cus/visitorplan/addselectedplans · /updatevisitorplans · /deletevisitorplan', svc: 'cus', note: 'customer_id_type + customer_id_price_plan (+ dms_visitor_rights on update); delete = deleteAll of the id type\'s rows' },
      { ep: 'POST /cus/visitorplan/getpriceplans · /getplanname · /getalleligibleplans · /getvisitorplans', svc: 'cus', note: 'lookups (BSS SOAP profile + APC eligibility for getpriceplans)' },
      { ep: 'POST /cus/visitorplan/getsocialsecurityplanstatus → /changesocialsecurityplanstatus {status}', svc: 'cus', note: 'social_security_permission toggle (Tamkeen plans on/off for everyone)' },
      { ep: 'POST /cus/customer/updateidtypestatus {id, status}', svc: 'cus', note: 'customer_id_type.status (400 validation, 505 not found) — disables an id type for activation/auth options' },
      { ep: 'POST /cus/priceplan/getsolodigitalplan · /addsolodigitalplan · /updatesolodigitalplan · /deletesolodigitalplan · /add-bulk-solo-plans · /update-bulk-solo-plans (Excel)', svc: 'cus', note: 'dms_solo_digital_plans = recharge block-list consulted by /recharge/topup (served under /cus/priceplan/… — the mapping lacks a leading slash)' },
      { ep: 'POST /cus/priceplan/renew/add · /updaterule · /deleterulebyid · /getrulebyid · /getallrulesbyplanidandname', svc: 'cus', note: 'renew_now_commission_rules (unique planId+name+attempt) — drives the Renew Now commission payout' },
      { ep: '(Magento admin)', svc: 'magento', note: 'plans, add-ons, prices, feature flags, app version list (android.configuration.app.version_list), theme, texts and the Tamkeen allowed-count are read by APC through dms_magento_apis.jar (AppConfigurationModule.getAppConfigurationsFromMagento); the Magento admin UI/URL is not in the properties → not determined from code' }
    ],
    systems: ['cms', 'gw', 'cus', 'apc', 'magento', 'bss', 'ledger'],
    signature: [
      'cms_logs api_name=/cus/visitorplan/* | /cus/customer/updateidtypestatus | /cus/priceplan/*solodigitalplan* | /cus/priceplan/renew/* response_Code=00, username = header (type_req / value_req may hold idType per feature map §4.2)',
      'dms_v1.dms_visitors_plan, customer_id_type, customer_id_price_plan, dms_visitor_rights, social_security_permission, dms_solo_digital_plans, renew_now_commission_rules',
      'Magento-side changes: NO row anywhere in DMS (APC has an empty filter)'
    ],
    breaks: [
      'addvisitorplans is delete-all-then-insert without a transaction boundary visible in the decompiled code: an APC/Magento outage mid-call empties the eligibility table → every activation fails eligibility (1501/1502) until re-run',
      'Commission rules and block-lists are edited with no before/after value in the ledger (cms_logs stores the raw request only)',
      'Solo-digital and renew-rule endpoints answer 400/505 codes that the consumer treats as non-00 → the journey is visible only as failures',
      'Magento configuration (the real catalogue, flags and version gate) is outside DMS: who changed a flag and when is not determined from code'
    ],
    rules: []
  },
  {
    key: 'txn_auth_policy', family: 'admin_config', label: 'Transaction authentication policy (daily limits)', sanity: [], console: null,
    purpose: 'Configure the per-dealer daily top-up / e-voucher limits and which transactions need OTP; readers take findAll().get(0).',
    steps: [
      { ep: 'POST /cus/transactionauthpolicy/gettransactionauthpolicies', svc: 'cus', note: 'findAll()' },
      { ep: 'POST /cus/transactionauthpolicy/savetransactionauthpolicy', svc: 'cus', note: 'saveAndFlush of a NEW row on every call (TransactionAuthPolicyImpl.java l.52-78)' },
      { ep: 'POST /cus/transactionauthpolicy/updatetransactionauthpolicy', svc: 'cus', note: 'saveAndFlush by id (l.80-105)' },
      { ep: '(readers) POST /cus/transactionauthpolicy/getrechargedailylimit · /getevoucherdailylimit', svc: 'cus', note: 'findAll().get(0) (l.118, l.156) vs CON /audit-log/logs/getdealerperdayamount (sum of topup_logs today); advisory only — /recharge/topup never enforces it (dmsJourneySpec topup)' }
    ],
    systems: ['cms', 'gw', 'cus', 'con', 'ledger'],
    signature: ['cms_logs /cus/transactionauthpolicy/savetransactionauthpolicy | /updatetransactionauthpolicy 00 (raw request holds the limits)', 'dms_v1.dms_transaction_authentication_policy row(s)'],
    breaks: [
      'Every save inserts a new row while every reader uses row 0 of findAll() (unordered) → after the second save the effective policy is whichever row the DB returns first',
      'The limits are never enforced server-side on the money endpoints — the policy is a UI hint (rule M11 counts breaches)',
      'The daily sum comes from the audit consumer: a consumer backlog under-counts (rule M11)'
    ],
    rules: []
  },
  {
    key: 'app_content_config', family: 'admin_config', label: 'App content, flags, version gate & caches', sanity: [], console: null,
    purpose: 'What the dealer app shows and allows: Magento-backed configuration (flags, prices, id types, texts, theme, version list) served by APC, plus the operator cache refreshes in CUS/ONB that make a change visible.',
    steps: [
      { ep: '(Magento admin — outside the tree)', svc: 'magento', note: 'keys read by APC AppContentServiceImpl / AppVersionServiceImpl ("Mobile Application Version") through AppConfigurationModule; no DMS write endpoint' },
      { ep: 'POST /apc/v1/config/getappconfigurations · /getappconfigurationsweb · /getappcontent · /getappthemeconfigurations · /verifyversion · /apc/v2/config/getusereligibilitydata', svc: 'apc', note: 'read paths (no row: APC filter is empty); getappconfigurations also calls CUS /cus/visitorplan/getvisitorplans' },
      { ep: 'POST /cus/cache/refresh {cacheName SimUsageHistory|OTPConfigCache|AvailableVersions, authKey} · /cache/config/remove', svc: 'cus', note: 'authKey == refresh.cache.token (***) else 1500; SimUsageHistory rebuilt from dms_activated_iccids_history in a parallel stream, OTPConfigCache from otp_text_configuration, AvailableVersions cleared (CacheServiceImpl.java l.37-50)' },
      { ep: 'POST /onboarding/cache/refresh · /cache/config/remove', svc: 'onb', note: 'reportDownload cache (both paths hit refreshCache)' },
      { ep: 'GET /uil/hc/refresh/configuration (no key) · /uil/hc/refresh/abshir/accesstoken', svc: 'uil', note: 'clears uilconfig / uilChannels caches; the UIL channel registry (uil_v1.uil_channels, uil_channels_api, uil_api_info, uil_configuration) is edited by SQL — no endpoint' }
    ],
    systems: ['cms', 'magento', 'apc', 'cus', 'onb', 'uil', 'redis', 'ledger'],
    signature: [
      'cms_logs /cus/cache/refresh 00 (authKey in the raw request!) · user_onboarding_logs /onboarding/cache/refresh 00 · uil_logs /uil/hc/refresh/configuration',
      'Magento edits and UIL registry SQL edits: NO row anywhere'
    ],
    breaks: [
      'An app-version gate or feature-flag change is a Magento edit + a cache refresh in CUS; neither is attributable to an operator',
      'UIL channel registry (who may call which /uil path) is maintained by SQL; the refresh endpoint is unauthenticated (bypass list in ApiKeyFilter)',
      'The cache-refresh token travels in the request body and is stored in cms_logs.request',
      'APC/Magento sits in the login critical path (dmsJourneySpec login): a broken configuration key is a login outage'
    ],
    rules: []
  },
  {
    key: 'semati_config', family: 'admin_config', label: 'Semati configuration & regulator-side bulk actions', sanity: [], console: null,
    purpose: 'Regulator-facing knobs: the dms_semati_configurations table (semati.cancel.sim.check), the Semati session gate profile, the UIL bulk cancel of numbers with a hard-coded operator identity, Semati notification update / inquiry pass-throughs.',
    steps: [
      { ep: '(SQL) dms_v1.dms_semati_configurations key=semati.cancel.sim.check', svc: 'cus', note: 'read by SimSwapServiceImpl.java l.434 and ESimSwapServiceImpl.java l.425 only; no endpoint writes it; true lets a swap continue after a failed Semati new-sim (dmsJourneySpec sim_swap)' },
      { ep: '(profile) AuthUtils.isTokenExist — Semati gate 757', svc: 'cus', note: 'enforced only when the active profile contains "preprod"; the running profile is not determined from code (DMS-CODE-A §2)' },
      { ep: 'POST /uil/semati/cancel-multiple-mobile-number (x-api-key)', svc: 'uil', note: 'one /api-tcc/individual/v2/verify type-4 call per number, sequential, Operator = hard-coded enum (employeeId/employeeUsername/sourceId/operatorTCN literals, region 01, branchAddress 24.685741,46.704745 — utils/Operator.java, masked); response has no top-level code' },
      { ep: 'POST /uil/semati/cancel-mobile-number · /cancel-sim · /update-notification · /inquiry', svc: 'uil', note: 'single-number cancels (type 4 / 5), notifications update, transaction query — internal callers; no DMS endpoint invokes cancel-multiple (caller = operator script / not determined from code)' },
      { ep: 'POST /audit-log/semati/notification/auth {uilTransactionId, customerPersonID, customerMsisdn}', svc: 'con', note: 'answers whether DMS authenticated this person in the last 14 days from semati_logs.operator_tcn; no auth, no caller in the tree' }
    ],
    systems: ['cms', 'cus', 'uil', 'semati', 'con'],
    signature: [
      'cancel-multiple: uil_logs /uil/semati/cancel-multiple-mobile-number + one semati_logs row per number with request_type=4 and employee_username = the literal operator — this is the recognisable fingerprint of a bulk regulator cancel',
      'dms_semati_configurations edits: NO row anywhere (SQL)'
    ],
    breaks: [
      'A configuration row decides whether a SIM swap may proceed after a failed regulator call, and it has no change history',
      'Bulk cancellations at the regulator are signed by one hard-coded employee identity regardless of who ran them',
      '/audit-log/semati/notification/auth leaks authentication history without any credential',
      'Whether the Semati gate is active in production depends on the Spring profile string — not determined from code'
    ],
    rules: []
  },
  {
    key: 'notification_admin', family: 'admin_config', label: 'Notification administration (templates, history)', sanity: [], console: null,
    purpose: 'Back-office view of what was sent: 30-day FCM / e-mail history endpoints of the notification service; the per-journey templates (dms_notification_configuration) and OTP texts have no endpoint.',
    steps: [
      { ep: 'POST /notification/notification/notification · /fcm · /email · /sms {channelId, channelUserId, mobileNumber, email}', svc: 'sms', note: 'last 30 days of notification_fcm_logs / notification_email_logs; /sms is ALWAYS empty (notification_sms_logs is never written); caller not found in the tree (CMS presumed)' },
      { ep: '(SQL) dms_v1.dms_notification_configuration · otp_text_configuration · addon_otp_text', svc: 'con', note: 'templates used by CON NotificationUtils per use case (NewActivation, TopUp, SimReceiving, SIMIssuance, NumberPort, SIMSwap, WalletMoneyTransfer, RefillWallet, Login) and by CUS OTP generators (cached in Redis OTPConfigCache → needs /cus/cache/refresh)' },
      { ep: '(UIL) POST /uil/salam/get-msg-list · /add-subscriber · /update-subscriber · /get-subscriber · /send-notification', svc: 'uil', note: 'pass-throughs to the Salam notification API (salam.notification.base.url); success branch answers "Failure" text per dmsApiDocs; no DMS caller' }
    ],
    systems: ['cms', 'sms', 'con', 'uil', 'esmg', 'smtp', 'fcm', 'ledger'],
    signature: [
      'user_onboarding_logs /notification/notification/fcm | /email | /notification (NOT filter) — the history READS are themselves ledgered',
      'template edits: NO row anywhere'
    ],
    breaks: [
      'SMS history is structurally empty: sendsms inserts into esmg.esmg_sms_mt and never into notification_sms_logs',
      'Template/OTP-text edits are SQL with a Redis cache in front — a change without /cus/cache/refresh is not applied for up to 600 s, and neither step is attributable',
      'FCM server key and SMTP host are literals in NotificationServiceImpl (masked); the mail path has no timeout'
    ],
    rules: []
  },
  {
    key: 'ticket_admin', family: 'admin_config', label: 'Ticket (CRM incident) administration', sanity: [], console: null,
    purpose: 'Back-office side of dealer complaint tickets. The code has NO admin endpoint: tickets are created by the dealer app (/cus/ticket/create → UIL /ticket/create → ticketing SOAP createIncident) and their status is read back through /ticket/search; the category tables are static.',
    steps: [
      { ep: '(SQL) dms_v1.create_ticket_cat1 · create_ticket_cat2 · create_ticket_cat3', svc: 'cus', note: 'category trees read by /cus/ticket/listCategory1..3; no write endpoint' },
      { ep: 'POST /cus/ticket/create → UIL POST /uil/ticket/create (SOAP urn:CreateTicket_Salam)', svc: 'cus', note: 'dealer-app call; duplicate open complaint → 1500; ticket_history row (B §10)' },
      { ep: 'POST /cus/ticket/search → UIL /uil/ticket/search', svc: 'cus', note: 'status lookup' },
      { ep: '(admin resolution / assignment)', svc: 'crm', note: 'happens in the ticketing system (Remedy-style SOAP service, credentials literal in UIL) — not determined from code' }
    ],
    systems: ['app', 'cus', 'uil', 'crm', 'ledger'],
    signature: ['cms_logs /cus/ticket/create 00 + uil_logs /uil/ticket/create; dms_v1.ticket_history (customerServiceNo)', 'admin actions: none in DMS'],
    breaks: ['No CMS view or action on tickets exists in the 14 services; ticket_history is write-only (no reader besides the duplicate check)'],
    rules: []
  },

  /* ───────────────────────────── admin_reports ─────────────────────────── */
  {
    key: 'reports_generate', family: 'admin_reports', label: 'CMS reports (/reports/generate/* + onboarding reports)', sanity: [], console: null,
    purpose: 'Paginated back-office reports over the ledgers, dms_v1, the wallet and the commission service. Read-only, unaudited (RPT), unauthenticated.',
    steps: [
      { ep: 'GET /reports/generate/channelHeirarchy · /all-channels', svc: 'rpt', note: 'CHS listhierarchy / listall' },
      { ep: 'POST /reports/generate/sim-stats (x-skippagination)', svc: 'rpt', note: 'sim_stats_report (nightly aggregate, job_sim_stats)' },
      { ep: 'POST /reports/generate/sold-sims · /sold-vouchers · /sim-activation-history · /topup-history · /mnp-port-in', svc: 'rpt', note: 'live reads of sim_activation_logs / topup_logs / mnp_logs (successes only — journey tables hold 00 rows)' },
      { ep: 'POST /reports/generate/commission-history · /commission-history-by-type · /commission-summary', svc: 'rpt', note: 'HTTP to trms-commission-service :9003 /cos/commission/history[/criteriatype|/summary/criteriatype]' },
      { ep: 'POST /reports/generate/wallet-transactions · /wallet-transactions-by-date', svc: 'rpt', note: 'WAS POST /was/account/transactions/an (PAID rows of one account)' },
      { ep: 'POST /reports/generate/get-refill-requests-by-status · /attendance · /get-mobile-users-list · /sim-inventory', svc: 'rpt', note: 'dms_v1 refill_wallet_requests / dms_attendance / dms_users / sim_inventory + sim_sub_inventory' },
      { ep: 'POST /onboarding/report/getattendancereport · /get-users-attendance-report · /get-sim-activation-report · GET /get-user-graph-sim-activation', svc: 'onb', note: 'JDBC on dms_v1 + dms_audit_logs.sim_activation_logs (jdbcTemplate2); get-sim-activation-report builds the user list by string concatenation (AttendanceServiceImpl.java l.76-84) → SQL injection surface' }
    ],
    systems: ['cms', 'gw', 'rpt', 'onb', 'chs', 'wallet', 'trmscom', 'ledger'],
    signature: [
      'RPT: NO audit row (no filter, no producer) — who ran which report is unknown; Tomcat/app log only',
      'ONB reports: user_onboarding_logs /onboarding/report/* rows (request filters visible, operator not)'
    ],
    breaks: [
      'Reports read the journey tables, which hold successes only and include false successes (00 after wallet failure — dmsJourneySpec breaks) → sold/activation counts overstate',
      'date-wise-sim-act compares month names without a year; amound-sold sums mnp_logs.price_plan (a name column) (feature map §5.6)',
      'No authentication and CORS * on /reports/** — every commercial KPI is readable by anyone who reaches port 9012',
      'ONB get-sim-activation-report: SQL built by concatenating request values'
    ],
    rules: []
  },
  {
    key: 'reports_dashboard', family: 'admin_reports', label: 'CMS dashboard widgets (/reports/dashboard/*)', sanity: [], console: null,
    purpose: 'KPI tiles of the portal home: active users, users created, pending requests, amount sold, activations per channel/region/date, commission earned, app totals.',
    steps: [
      { ep: 'GET /reports/dashboard/active-users · /users-created · /pending-requests · /amound-sold', svc: 'rpt', note: 'dms_users, refill_wallet_requests + login_without_qr_requests, mnp_logs.price_plan sum' },
      { ep: 'GET /reports/dashboard/activations-per-channel · /region-wise-sim-act[-detail] · /date-wise-sim-act · /app-total-activations · /app-plan-sold', svc: 'rpt', note: 'sim_stats_report / sim_activation_logs (controller logic for some)' },
      { ep: 'POST /reports/dashboard/app-total-activations-detail · /app-plan-sold-detail', svc: 'rpt', note: 'filtered detail' },
      { ep: 'GET /reports/dashboard/commission-earned-pos · /total-commission-earned', svc: 'rpt', note: 'trms_commission.commission_history (read-only datasource)' }
    ],
    systems: ['cms', 'gw', 'rpt', 'ledger'],
    signature: ['NO audit row; reads only'],
    breaks: ['Unbounded aggregates over the ledgers on every page load (no cache) — the dashboard is a load generator on dms_audit_logs', 'Same false-success bias as reports_generate'],
    rules: []
  },
  {
    key: 'reports_download', family: 'admin_reports', label: 'PDF report downloads (/reports/download-report/*)', sanity: [], console: null,
    purpose: 'Same twelve reports rendered as PDF (Flying Saucer, in memory) for download.',
    steps: [
      { ep: 'POST /reports/download-report/sim-stats-download · /sold-sims-download · /sold-vouchers-download · /sim-activation-history-download · /topup-history-download · /mnp-port-in-download · /get-refill-requests-by-status-download', svc: 'rpt', note: 'ledger / dms_v1 reads → HTML template → PDF bytes' },
      { ep: 'POST /reports/download-report/commission-history-download · /commission-history-by-type-download · /commission-summary-download', svc: 'rpt', note: 'trms-commission-service HTTP' },
      { ep: 'POST /reports/download-report/wallet-transactions-download · /wallet-transactions-by-date-download', svc: 'rpt', note: 'WAS /was/account/transactions/an' },
      { ep: 'POST /onboarding/dms/user/getuserssearchbytypedownload · /getuserreport', svc: 'onb', note: 'user exports (Redis-cached 600 s)' }
    ],
    systems: ['cms', 'gw', 'rpt', 'onb', 'wallet', 'trmscom', 'ledger'],
    signature: ['RPT: NO audit row; ONB exports: user_onboarding_logs rows', 'export format: PDF only for RPT (no CSV/XLSX endpoint in the tree); ONB "download" variants return JSON (the file is built client-side → not determined from code)'],
    breaks: ['A full wallet statement or activation history can be exported with no trace of who exported it', 'PDF rendering of unbounded result sets in memory (x-skippagination honoured on the JSON variants only)'],
    rules: []
  },
  {
    key: 'audit_query_api', family: 'admin_reports', label: 'Audit-consumer query API (/audit-log/logs/*)', sanity: [], console: null,
    purpose: 'Internal read (and one write) API of the audit consumer over the ledgers, used by CUS for statements and daily limits; unauthenticated, CORS *.',
    steps: [
      { ep: 'POST /audit-log/logs/getlogswithpayment {paymentids, fromDate, toDate}', svc: 'con', note: 'journey rows for wallet payment ids (CUS accountagenttransactionreport)' },
      { ep: 'POST /audit-log/logs/getdealerperdayamount', svc: 'con', note: 'SUM of topup_logs today for a dealer (daily-limit checks)' },
      { ep: 'POST /audit-log/logs/simactivelogs · /getactivationdate', svc: 'con', note: 'activation rows / latest activation date for a number' },
      { ep: 'GET /audit-log/logs/tpp/{number}', svc: 'con', note: 'barcode/ICCID check in the ledgers; no caller in the tree' },
      { ep: 'POST /audit-log/logs/smslog', svc: 'con', note: 'INSERT dealer_sms_log (Renew Now / self-activation commission SMS) — the one write' }
    ],
    systems: ['cus', 'con', 'ledger'],
    signature: ['NO audit row for the query calls (CON has no producer); the calling CUS endpoint has its cms_logs row', 'dealer_sms_log row for /smslog'],
    breaks: ['Ledger contents (national ids, OTPs in otp_req, e-voucher PINs) are readable by anyone who reaches port 9014 — no key, no header check (LogsController.java @CrossOrigin *)', 'The daily-limit sum depends on consumer lag (rule M11)'],
    rules: []
  },

  /* ─────────────────────────────── system ──────────────────────────────── */
  {
    key: 'audit_pipeline', family: 'system', label: 'Audit / ledger pipeline (filters → RabbitMQ → consumer)', sanity: [], console: null,
    purpose: 'How every ledger row comes to exist: the request filters of CUS/PAY/ONB/NOT and the UIL aspect post an MqObject to the producer, RabbitMQ routes by requestType, the consumer writes cms_logs / user_onboarding_logs / uil_logs / semati_logs and the journey tables, and sends the dealer notifications.',
    steps: [
      { ep: 'HttpLoggingFilter (CUS/PAY requestType CMS, ONB/NOT requestType DMS) · UIL LoggingAspect (requestType UIL)', svc: 'cus', note: 'CUS enriches with dms_users → CHS getById → ONB getparentchannel (channelId, dealerType, region…) — a failure in the enrichment drops the row (rule J4); ONB ships the raw body only' },
      { ep: 'POST /rabbit/mq/push', svc: 'prd', note: '@Async blocked by get(); 3 threads / 100 queue; broker error → "failed" with HTTP 200; unknown requestType → "Failed" (enum has REGUALTORY)' },
      { ep: 'RabbitMQ dms.direct.exchange → cms.services.queue | dms.onboarding.queue | unified.integration.queue | regulatory.requirements.queue (TTL 100 min, DLQs unread)', svc: 'mq' },
      { ep: 'CON RabbitMqConsumer (4 instances × 1 thread/queue)', svc: 'con', note: 'saveCmsLog: responseCode==00 && apiName ∈ CmsApiNames → journey table (+ dms_v1.dms_sim_activation_report) → NotificationUtils push/SMS/e-mail → cms_logs; saveUserOnboardLog → user_onboarding_logs (+ nafath_logs, Login notifications); saveUilLog → semati_logs | uil_logs; catch(Exception) ACKs and DROPS the message (retry config bypassed)' }
    ],
    systems: ['cus', 'onb', 'uil', 'prd', 'mq', 'con', 'sms', 'ledger'],
    signature: ['cms_logs / user_onboarding_logs / uil_logs / semati_logs rows with insert_date_time = consumer clock; logs_reference_id = Sleuth trace id', 'journey tables only for 00 responses of the 24 mapped URIs'],
    breaks: [
      'Message loss is silent at three points: producer publish error (HTTP 200 "failed"), consumer exception (ACK-and-drop), TTL 100 min under backlog (rules J5, J6)',
      'Four competing consumers per queue with no idempotency → duplicate rows on redelivery (rule J11)',
      'No event time in the message: insert_date_time drifts under backlog',
      'The pipeline is the ONLY audit mechanism for CUS/PAY/ONB/NOT/UIL and does not exist for CHS/RPT/DOC/WAS/CON/CAB/APC'
    ],
    rules: []
  },
  {
    key: 'job_logout_all', family: 'system', label: 'Nightly logout-all (23:58)', sanity: [], console: null,
    purpose: 'Every night ONB logs every Keycloak session of realm dmsapplication out and closes all open attendance rows.',
    steps: [
      { ep: '@Scheduled cron "0 58 23 * * *" UserSchedulers.logoutAllUsers → DmsUserServiceImpl.logoutAllUsers()', svc: 'sched', note: 'no ShedLock → runs on all 4 ONB instances (dms_onboarding_service/src/com/es/dms/scheduler/UserSchedulers.java)' },
      { ep: 'Keycloak POST realms/dmsapplication/logout-all', svc: 'kc', note: 'realm-wide (dealers AND CMS operators, same realm)' },
      { ep: 'native UPDATE dms_attendance SET logout_time=NOW() (AttendanceRepository.logoutAllUsers)', svc: 'onb' }
    ],
    systems: ['sched', 'onb', 'kc'],
    signature: ['dms_v1.dms_attendance: every open row gets logout_time ≈ 23:58 (working_hours computed by the endpoint variant only — not determined from code for the native UPDATE)', 'NO user_onboarding_logs row (the scheduler bypasses HTTP); the manual /onboarding/dms/user/logoutAll has one'],
    breaks: ['Runs 4× (one per node) — 4 realm logout-all calls within the same second', 'Produces the 00:00 login/Nafath/OTP storm (rule L8) and kills back-office sessions too', 'Exceptions are logged only'],
    rules: []
  },
  {
    key: 'job_absher_sync', family: 'system', label: 'Absher mobile-number sync (every minute)', sanity: [], console: null,
    purpose: 'After an Absher-verified activation, push the assigned MSISDN back to Elm (update-mobile) for rows flagged activation_status=1 and update_mobile_status=0.',
    steps: [
      { ep: '@Scheduled fixedRate=60000 AbsherUpdateMobileNumberScheduler.updateMobileNumberStatus', svc: 'sched', note: 'NOT service (node 136 only) — no lock but a single instance (dms_notification_service/src/com/es/dms/notification/service/schedulers/AbsherUpdateMobileNumberScheduler.java)' },
      { ep: 'SELECT dms_v1.person_verification_log WHERE activation_status=1 AND update_mobile_status=0 → UIL POST /tpi/abshir/update-mobile → Elm', svc: 'uil', note: 'update_mobile_status 1 (ok) / 2 (failed)' }
    ],
    systems: ['sched', 'sms', 'uil', 'absher'],
    signature: ['uil_logs /tpi/abshir/update-mobile per row; dms_v1.person_verification_log.update_mobile_status 1|2', 'no scheduled_job_info row (no ShedLock on this job)'],
    breaks: ['Rows that fail stay at 2 and are never retried; rows that throw before the status write are retried every minute forever', 'Absher token cache (uil_v1.token_entity) shared with the interactive flows — a bad token stalls both'],
    rules: []
  },
  {
    key: 'job_zatca_export', family: 'system', label: 'ZATCA e-invoice CSV export (every 30 min)', sanity: [], console: null,
    purpose: 'Export Pending dms_v1.zatca_integration rows (activation, MNP, swaps, ownership, plan change, device sale) as an E-INVOICE CSV for the e-invoicing system, then mark them Success.',
    steps: [
      { ep: 'CUS ZatcaIntegrationImpl.usecaseInsertionForZatca (after each 00 money journey)', svc: 'cus', note: 'INSERT zatca_integration status=Pending (seller VAT literal, dms_vat_configuration read)' },
      { ep: '@Scheduled fixedDelay=1800000 ZatcaFileBaseScheduler.zatcaDetailedReport', svc: 'sched', note: 'NOT service (136): SELECT * FROM zatca_integration WHERE status=\'Pending\' → CSV <sellerVat>_E-INVOICE GCC Standard_EINV<ts>.csv under csv.file.path=/opt/dmsprod/GENERATE_EINV/INPUT/INIT/ → updateAllPendingCases(ids)' },
      { ep: 'ZatcaIntegrationRepository.updateAllPendingCases', svc: 'sms', note: '@Query(nativeQuery, "UPDATE … SET status=\'Success\' …") declared WITHOUT @Modifying and returning List<DmsZatcaEntity> (ZatcaIntegrationRepository.java l.16-20) → Spring Data executes it as a SELECT → throws → rows stay Pending' },
      { ep: 'ZATCA ingestion of the CSV', svc: 'zatca', note: 'outside the tree' }
    ],
    systems: ['cus', 'sched', 'sms', 'zatca'],
    signature: ['dms_v1.zatca_integration rows Pending — permanently (the status flip is dead code)', 'a new CSV every 30 min containing ALL Pending rows again (file names differ by timestamp)', 'no scheduled_job_info row'],
    breaks: [
      'Missing @Modifying: every export re-sends every invoice ever queued; the downstream must de-duplicate or invoices are double-reported (feature map §9.2)',
      'CSV directory is never purged; the file grows with the Pending set',
      'The catch at l.71-79 swallows Throwable → the failure is not even an error log the operator can alert on (not determined from code which level)'
    ],
    rules: []
  },
  {
    key: 'job_sim_stats', family: 'system', label: 'Nightly SIM stats aggregation (00:01) + manual endpoint', sanity: [], console: null,
    purpose: 'Pre-compute sim_stats_report (activations, recharges, vouchers per channel/region/plan/city) for D-2 and D-1; the dashboard and sim-stats report read it.',
    steps: [
      { ep: '@Scheduled cron "0 1 0 * * *" + @SchedulerLock("SimReportStatsGeneration") Scheduler.cronJobSch', svc: 'sched', note: 'RPT ×4 with ShedLock on dms_audit_logs.shedlock (15–30 min) → one node runs; skips a date already in scheduled_job_info "Generating Sim Stats" (dms_reports_service/src/com/es/dms/reports/service/Scheduler.java l.41-53)' },
      { ep: 'saveCmsData(date): UNION over sim_activation_logs (physical/data only, not eSIM) + topup_logs (recharge / e-voucher) grouped → sim_stats_report.saveAll + scheduled_job_info', svc: 'rpt' },
      { ep: 'GET /reports/MANUAL-GENERATE-DATA/NOT_FOR_PRODUCTION', svc: 'rpt', note: 'TEMPController: saveCmsData(D-1) on demand, no delete-before-insert, no auth, CORS * (TEMPController.java)' }
    ],
    systems: ['sched', 'rpt', 'ledger'],
    signature: ['dms_audit_logs.sim_stats_report rows for the date; scheduled_job_info job_name="Generating Sim Stats" date', 'manual run: duplicate sim_stats_report rows for D-1 + another scheduled_job_info row; NO audit row'],
    breaks: ['The manual endpoint is live in production and appends duplicates → dashboard/report totals double for that day', 'eSIM activations are excluded from the stats (DMS-CODE-F §7)'],
    rules: []
  },
  {
    key: 'job_notification_reports', family: 'system', label: 'Notification-service report & digest jobs', sanity: [], console: null,
    purpose: 'Operational mails and dealer pushes generated by NOT: hourly activation-failure CSV, pending-request counts at 10:00/15:00, daily/weekly commission digests.',
    steps: [
      { ep: 'cron "0 0 * * * *" DmsReportScheduler.hourlySimActivationFailureReport (ShedLock)', svc: 'sched', note: 'cms_logs WHERE api_name=/cus/simactivation/activate AND response_Code<>00 AND DATE(insert_date_time) > DATE_SUB(CURRENT_DATE(), INTERVAL 1 HOUR) — i.e. since yesterday, not the last hour → CSV in CWD → e-mail sim.activation.report.recipients' },
      { ep: 'cron "0 0 10/24 * * *" every24HrsPendingReport · "0 0 15/24 * * *" every12HrsPendingReport (ShedLock)', svc: 'sched', note: 'counts Pending dms_channel and login_without_qr_requests → e-mail pending.requests.recipients' },
      { ep: 'cron "0 0 11 * * *" CommissionScheduler.dailyCommissionScheduler · "0 0 19 * * 4" weeklyCommissionScheduler (ShedLock)', svc: 'sched', note: 'trms_commission.commission_history (RTL_POS_SHOP) × active rtl_pos users with FCM token → FCM push; weekly also reads sim_activation_logs dealer_type=\'RTL_POS\' (spelling differs from RTL_POS_SHOP)' }
    ],
    systems: ['sched', 'sms', 'smtp', 'fcm', 'trmscom', 'ledger'],
    signature: ['scheduled_job_info rows per job; notification_email_logs / notification_fcm_logs; file sim_activation_failure_logs.csv in the NOT CWD (never deleted)'],
    breaks: ['The "hourly" failure report window is wrong (since yesterday) → the same failures are mailed every hour', 'Weekly digest dealer_type filter mismatch (RTL_POS vs RTL_POS_SHOP) → not determined from code which value the ledger holds'],
    rules: []
  },
  {
    key: 'job_wallet', family: 'system', label: 'Wallet reconciliation jobs (30 min) & bulk payer (1 s) — node 136 build only', sanity: [], console: null,
    purpose: 'Expire stale PENDING initiates per transaction type, release WALLET_TRANSFER reservations, and pay bulk disbursement rows. All six jobs are plain @Scheduled with no lock — but the jar diff of 30 Sep 2026 proved the six scheduler classes exist ONLY in the trms-wallet-service-0.0.8 build on node 136; the 0.0.8 jars on 137/138/139 have no scheduler package at all (a node-specific build, same version string).',
    steps: [
      { ep: 'fixedDelay=1800000 CashReconJobs · HyperPayReconJobs · WalletRefillReconJobs · ComissionReconJobs .paymentInitialPending', svc: 'sched', note: 'wallet_payment_initiate <type> PENDING past signature_expiry → EXPIRED (no balance change)' },
      { ep: 'fixedDelay=1800000 WalletTransferReconJobs.paymentInitialPending', svc: 'sched', note: 'expired WALLET_TRANSFER → available += amount (release) + EXPIRED; RETURNS on the first account-not-found → the rest of the batch stays PENDING (rule M6)' },
      { ep: 'fixedDelay=1000 BulkWalletDisbursementsJobs.paymentInitialPending', svc: 'sched', note: 'see bulk_disbursement: Thread.sleep(payment_scheduler_time) then pays every PENDING row from 1234567' },
      { ep: '(missing) recon for CC and REFUND initiates', svc: 'wallet', note: 'no job exists (feature map §5.4)' }
    ],
    systems: ['sched', 'wallet'],
    signature: ['trms_wallet.wallet_payment_initiate status EXPIRED; wallet_balance.available restored for WALLET_TRANSFER', 'bulk: BULK_WALLET_TRANSFER PAID pairs + payment_bulk_disbursement DONE', 'NO audit row, no scheduled_job_info (WAS has no ShedLock)'],
    breaks: [
      'Single point of failure by accident: the jobs run on node 136 only because its jar is different (jar diff 30 Sep 2026: 6 scheduler classes removed on 137/138/139) — if 136 is down or its wallet jar is "aligned" with the others, no reconciliation and no bulk payment runs, with nothing in the version string to show it',
      'Within node 136 there is still no lock, no claim step and no row locking (DMS-CODE-C §1): a second copy of the 136 build anywhere would pay bulk rows twice',
      'WalletTransferReconJobs aborts the batch on a missing account → reservations leak until the account is fixed',
      'CC / REFUND initiates are never expired',
      'Whether the vendor intends 136 as the only job runner is not determined from code (no configuration switch — the class files are simply absent elsewhere)'
    ],
    rules: []
  },
  {
    key: 'regulatory_suspension', family: 'system', label: 'Regulatory auto-suspension consumer (dead)', sanity: [], console: null,
    purpose: 'Suspend a dealer after repeated failed fingerprint verifications (4 consecutive per customer/finger, multiple 602 per customer, per user over N days, or a failure percentage) using regulatory_configurations rules.',
    steps: [
      { ep: 'RabbitMQ regulatory.requirements.queue', svc: 'mq', note: 'consumer bound; NO producer in the tree (the producer enum spells the type REGUALTORY, no filter sends it) → the queue is empty in normal operation' },
      { ep: 'CON DbPersistenceService.regulatoryRequirements(MqObject)', svc: 'con', note: 'RegulatoryService.saveRegulatoryInfo → regulatory_requirements row (REQUIRES_NEW) → rules from regulatory_configurations (four.consective.failed, multiple.failed.by.customer, multiple.failed.by.user, multiple.failed.percentage) → usersRepository.updateStatus("Inactive", userId) (DbPersistenceService.java l.318-373)' },
      { ep: 'DmsUsersRepository.updateStatus', svc: 'con', note: '@Query("UPDATE DmsUserEntity d set d.status = :status where d.id = :id") with NO @Modifying and NO @Transactional (dms_audit_logs_consumer_service/src/com/es/dms/repository/dmsdb/DmsUsersRepository.java l.11-12) → executed as a query → InvalidDataAccessApiUsageException → caught by the listener → message ACKed and dropped' }
    ],
    systems: ['mq', 'con'],
    signature: ['dms_audit_logs.regulatory_requirements row (only if something ever publishes); dms_users.status NEVER changes by this path', 'NO audit row of the suspension attempt'],
    breaks: ['Two dead ends: no producer, and the suspension UPDATE cannot execute (missing @Modifying) — dealers are never auto-suspended; a regulator expectation that failed verifications lead to suspension is unmet', 'fourConsctv.intValue() NPE when the configuration row is missing → the whole message is dropped'],
    rules: []
  },
  {
    key: 'cb_semati', family: 'system', label: 'Callback: Semati / TCC notification', sanity: [], console: null,
    purpose: 'The regulator notifies DMS of a customer request (cancel, etc.); UIL forwards it to AppCrm as a CreateCustomerRequest.',
    steps: [
      { ep: 'POST /uil/semati/call-back-notification {apiKey, personId, tcn, notificationCode}', svc: 'uil', note: 'ApiKeyFilter bypassed; body apiKey must equal sem.callback.apikey (else HTTP 401) → AppCrm POST {sem.notification.base.url}?cmd=CreateCustomerRequest (host 172.31.42.11:9260, Basic CSA auth) wrapped in catch(Exception); notificationCode 1..14 → ALWAYS {code 600 SUCCESS} whatever CRM answered; others → CRM code' }
    ],
    systems: ['semati', 'uil', 'crm'],
    signature: ['uil_logs api_name=/uil/semati/call-back-notification (LoggingAspect) — the CRM hop is NOT recorded'],
    breaks: ['CRM failure is swallowed and answered 600 → the regulator believes the request was filed; nothing in DMS shows it was not', 'The callback host for CRM differs from every other AppCrm URL (feature map §5.3)'],
    rules: []
  },
  {
    key: 'cb_nafath', family: 'system', label: 'Callback: Nafath result', sanity: [], console: null,
    purpose: 'Nafath posts the identity result (JWT) for a pending dealer transaction; UIL decodes it and ONB updates nafath_record.',
    steps: [
      { ep: 'POST /uil/nafath/v1/callback {response: <JWT>}', svc: 'uil', note: 'Authorization header string-equals naffat.api.key; JWT payload base64-decoded, signature NOT verified; controller excluded from the logging aspect and from ApiKeyFilter → always HTTP 200 (NafathController.java)' },
      { ep: 'POST /onboarding/user/updateNafathRecord?transId=', svc: 'onb', note: 'UPDATE nafath_record.status/token/person_id (INITIATED → COMPLETED|REJECTED)' }
    ],
    systems: ['nafath', 'uil', 'onb', 'ledger'],
    signature: ['NO uil_logs row; user_onboarding_logs /onboarding/user/updateNafathRecord (response code NULL); dms_v1.nafath_record status change'],
    breaks: ['A forged JWT with the shared key completes any INITIATED Nafath transaction (no signature check) and the UIL side leaves no trace', 'No TTL on INITIATED records (rule L5)'],
    rules: []
  },
  {
    key: 'cb_sadad', family: 'system', label: 'Callback: SADAD payment (CAB SOAP + PAY SOAP)', sanity: [], console: null,
    purpose: 'SADAD reports paid bills. Two receivers exist: the callback service forwards each payment to CRM as a create-request; the payment service only prints it.',
    steps: [
      { ep: 'CAB SOAP /cab/soap/services/* (WSDL sadadcallback, root payments) SadadCallbackEndpoint', svc: 'cab', note: 'no auth; per payment → UIL POST /tpi/bss/crm/create-request {identifierType -4, identifierValue trxreference, requestProfile -4} → AppCrm; answers paymentoutput{status = CRM responseCode} (SadadCallbackEndpoint.java l.39-55)' },
      { ep: 'PAY Spring-WS callbackRequest (namespace http://wwww.evampsaanga.com/dms/calback)', svc: 'pay', note: 'System.out.println of source/target/trxreference/date → status "0000"; NO wallet credit (SADAD_TOPUP strategy throws invalid.transaction.type) (SadadCallbackController.java l.18-27)' },
      { ep: 'dealer side: POST /pay/v1/saadad/create → UIL /uil/saadad/bill-upload-zm', svc: 'pay', note: 'path not served by UIL → 401/404 (feature map §9.3)' }
    ],
    systems: ['sadad', 'cab', 'uil', 'crm', 'pay'],
    signature: ['CAB: callback-services.log (TRACE) + uil_logs /tpi/bss/crm/create-request; NO DB row in CAB', 'PAY: stdout only; cms_logs row for the SOAP call not determined from code (filter matches servlet requests; SOAP endpoint path not verified)'],
    breaks: ['A SADAD payment never credits a wallet anywhere in the tree — the "SADAD refill" product has no completion path', 'Neither receiver authenticates SADAD'],
    rules: []
  },
  {
    key: 'cb_hyperpay', family: 'system', label: 'Callback: HyperPay result page', sanity: [], console: null,
    purpose: 'Browser return after the HyperPay widget. It is a static page: the credit happens only when the app polls /pay/v1/transaction/get.',
    steps: [
      { ep: 'GET /pay/v1/transaction/result', svc: 'pay', note: 'HyperpayCallBackController renders a Thymeleaf page; no wallet action' },
      { ep: 'POST /pay/v1/transaction/get {checkoutId, amount, type}', svc: 'pay', note: 'HyperPay GET /v1/checkouts/{id}/payment (bearer literal ***) → ONB getuserbyusername → WAS HYPERPAY_TOPUP initiate+commit with the CLIENT-supplied amount; re-poll credits again; success path NPEs after crediting → 1500 and wallet_refill_logs never written (DMS-CODE-C §6.3)' }
    ],
    systems: ['hyperpay', 'pay', 'onb', 'wallet', 'ledger'],
    signature: ['cms_logs /pay/v1/transaction/result (GET) and /pay/v1/transaction/get (≠00 today); wallet HYPERPAY_TOPUP account_from=1234567 comments="Credit Transaction Hyperpay"', 'wallet_refill_logs: unreachable'],
    breaks: ['No server-to-server webhook: a paid checkout whose app never polls is never credited; a polled one can be credited twice (rule M8)', 'Amount trusted from the client'],
    rules: []
  }
];

/* Candidate rule ids for the admin side (prefix A). Not implemented — proposals only. */
const ADMIN_RULE_CANDIDATES = {
  A1: { sev: 'P2', family: 'admin_money', title: 'Admin refill credit (account_from 1234569) without a matching cms_logs /cus/wallet/refill or Approved refill_wallet_requests row' },
  A2: { sev: 'P2', family: 'admin_money', title: 'Refill request Approved but zero or >1 wallet credits (re-approval / masked 1001)' },
  A3: { sev: 'P2', family: 'admin_money', title: 'Bulk disbursement row paid more than once (duplicate BULK_WALLET_TRANSFER pairs for the same file/account/amount within seconds)' },
  A4: { sev: 'P3', family: 'admin_money', title: 'Bulk disbursement rows PENDING longer than the configured sleep + 5 min, or file completion missing' },
  A5: { sev: 'P3', family: 'admin_money', title: 'Pseudo-account balance drift: 1234569 / 1234567 movements not explained by ledger rows' },
  A6: { sev: 'P3', family: 'admin_money', title: 'Salam BI decrypt volume / unexpected key (uil_logs /salambi count per hour above baseline)' },
  A7: { sev: 'P2', family: 'admin_users', title: 'Password reset via /onboarding/user/resetPassword with no preceding OTP verification row for the same username' },
  A8: { sev: 'P3', family: 'admin_users', title: 'Dealer create failed after Keycloak/wallet creation (adduser ≠00 with a wallet_accounts row created in the same minute)' },
  A9: { sev: 'P3', family: 'admin_users', title: 'Dealer deactivated/deleted while still transacting (cms_logs 00 for a username whose dms_users.status ≠ Active or row missing)' },
  A10: { sev: 'P4', family: 'admin_users', title: 'CMS operator still on the default password (cms_users.is_temp_password=1 older than 7 days)' },
  A11: { sev: 'P3', family: 'admin_users', title: 'Manual logoutAll during business hours (user_onboarding_logs /onboarding/dms/user/logoutAll outside 23:50–00:10)' },
  A12: { sev: 'P3', family: 'admin_channels', title: 'Channel activated without owner user (dms_channel Active created/updated today with no dms_users ownerUser and no adduser 00 row)' },
  A13: { sev: 'P4', family: 'admin_channels', title: 'Channel parent_id / status / commission_configurations changed with no ledger row (snapshot diff — the only way to see CHS writes)' },
  A14: { sev: 'P4', family: 'admin_channels', title: 'device_inventory rows inserted by CHS bulk upload (no cms_logs) vs CUS (cms_logs) — untraced stock' },
  A15: { sev: 'P3', family: 'admin_config', title: 'dms_transaction_authentication_policy has more than one row (ambiguous findAll().get(0))' },
  A16: { sev: 'P2', family: 'admin_config', title: 'dms_visitors_plan emptied (row count 0 after an addvisitorplans call) — activation eligibility outage' },
  A17: { sev: 'P3', family: 'admin_config', title: 'Semati bulk cancel executed (semati_logs request_type=4 with the literal operator employee_username)' },
  A18: { sev: 'P4', family: 'admin_config', title: 'cms_logs admin call with empty username header (operator identity missing)' },
  A19: { sev: 'P3', family: 'admin_reports', title: 'sim_stats_report duplicate rows per date/channel (manual NOT_FOR_PRODUCTION endpoint used)' },
  A20: { sev: 'P3', family: 'system', title: 'ZATCA rows Pending older than 1 h / CSV re-export growth (dead status update)' },
  A21: { sev: 'P3', family: 'system', title: 'Regulatory suspension never applied: regulatory_requirements rows meeting a rule while dms_users.status still Active (or queue silent for 24 h)' },
  A22: { sev: 'P3', family: 'system', title: 'Absher update-mobile backlog (person_verification_log activation_status=1, update_mobile_status=0 older than 10 min) or failed (=2) ratio' },
  A23: { sev: 'P3', family: 'system', title: 'Wallet recon batch aborted (WALLET_TRANSFER PENDING past expiry surviving two 30-min cycles)' },
  A24: { sev: 'P4', family: 'system', title: 'Nightly logout-all ran ≠1 time or off-schedule (dms_attendance logout_time burst outside 23:58)' },
  A25: { sev: 'P3', family: 'system', title: 'SADAD callback create-request failures (uil_logs /tpi/bss/crm/create-request ≠00 from CAB)' },
  A26: { sev: 'P4', family: 'system', title: 'Hourly activation-failure mail repeating the same rows (job window bug) — mail volume vs distinct failures' }
};

function adminSpec() {
  return { generated: '2026-09-30', source: 'production JARs decompiled under /home/claude/dms/services (APP nodes 172.31.43.136-139)', doc: 'DMS-CODE-G-ADMIN.md',
    systems: ADMIN_SYS, families: ADMIN_FAMILIES, journeys: ADMIN_JOURNEYS, rules: ADMIN_RULE_CANDIDATES };
}
module.exports = { adminSpec, ADMIN_SYS, ADMIN_FAMILIES, ADMIN_JOURNEYS, ADMIN_RULE_CANDIDATES };
