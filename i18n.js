/* Lightweight i18n + RTL for the console.
 *  - Dictionary below (en / ar). Add keys as views are localised.
 *  - Tag static markup with:
 *      data-i18n="key"        → textContent
 *      data-i18n-html="key"   → innerHTML (for label + <small> combos)
 *      data-i18n-ph="key"     → placeholder
 *      data-i18n-title="key"  → title attribute
 *  - window.t(key) for JS-rendered strings; dispatches 'langchange' on switch
 *    (view modules can listen and re-render, same pattern as 'themechange').
 */
(function () {
  "use strict";
  const KEY = 'cons_lang';
  const root = document.documentElement;

  const DICT = {
    en: {
      "brand.sub": "OPERATIONS CONSOLE",
      "beta": "BETA",
      "group.operate": "OPERATE",
      "group.explore": "EXPLORE",
      "group.guide": "GUIDE",
      "group.settings": "SETTINGS",
      "nav.home":      "Dashboard<small>Your home &amp; today's KPIs</small>",
      "nav.analytics": "Analytics<small>Charts &amp; dashboards</small>",
      "nav.slo":       "SLA<small>Targets &amp; vendor health</small>",
      "nav.errors":    "Troubleshoot<small>Live failures &amp; timelines</small>",
      "nav.alerts":    "Alerts<small>Rules &amp; notifications</small>",
      "nav.topology":  "Topology<small>The full system map</small>",
      "nav.journeys":  "Journeys<small>Every journey, step by step</small>",
      "nav.integrations": "Integrations<small>Catalogue &amp; workers</small>",
      "nav.sub360": "Subscriber 360<small>Unified profile by MSISDN / NID</small>",
      "menu.users":  "User management<small>Create users · roles · access</small>",
      "menu.sync":   "Sync engine<small>Watcher mode &amp; change log</small>",
      "menu.notify": "Notifications &amp; escalation<small>Slack / Teams &amp; on-call ladder</small>",
      "menu.audit":  "Audit log<small>Who did what · sign-ins &amp; trace access</small>",
      "menu.tour":   "Guided tour<small>Replay the 60-second walkthrough</small>",
      "title.settings": "Settings — user management & sync engine",
      "title.guide": "Explore & guided tour",
      "title.theme": "Toggle light / dark",
      "title.lang": "العربية",
      "title.menu": "Menu",
      "title.account": "Account / sign out",
      "login.sub": "OPERATIONS CONSOLE",
      "action.save": "Save",
      "action.cancel": "Cancel",
      "action.refresh": "Refresh",
      "action.test": "Send test",
      "action.enabled": "Enabled",
      "common.loading": "Loading…"
    },
    ar: {
      "brand.sub": "كونسول العمليات",
      "beta": "تجريبي",
      "group.operate": "التشغيل",
      "group.explore": "استكشاف",
      "group.guide": "الدليل",
      "group.settings": "الإعدادات",
      "nav.home":      "الرئيسية<small>لوحتك ومؤشرات اليوم</small>",
      "nav.analytics": "التحليلات<small>الرسوم واللوحات</small>",
      "nav.slo":       "مستوى الخدمة<small>الأهداف وصحة الموردين</small>",
      "nav.errors":    "معالجة الأعطال<small>الإخفاقات المباشرة والمسارات</small>",
      "nav.alerts":    "التنبيهات<small>القواعد والإشعارات</small>",
      "nav.topology":  "خريطة النظام<small>الخريطة الكاملة للنظام</small>",
      "nav.journeys":  "الرحلات<small>كل رحلة خطوة بخطوة</small>",
      "nav.integrations": "التكاملات<small>الكتالوج والعمال</small>",
      "nav.sub360": "ملف المشترك 360<small>ملف موحّد بالرقم / الهوية</small>",
      "menu.users":  "إدارة المستخدمين<small>إنشاء المستخدمين · الأدوار · الصلاحيات</small>",
      "menu.sync":   "محرك المزامنة<small>وضع المراقبة وسجل التغييرات</small>",
      "menu.notify": "الإشعارات والتصعيد<small>سلاك / تيمز وسلّم المناوبة</small>",
      "menu.audit":  "سجل التدقيق<small>من فعل ماذا · الدخول وتتبّع الوصول</small>",
      "menu.tour":   "جولة إرشادية<small>إعادة الجولة التعريفية</small>",
      "title.settings": "الإعدادات — إدارة المستخدمين ومحرك المزامنة",
      "title.guide": "استكشاف وجولة إرشادية",
      "title.theme": "تبديل الفاتح / الداكن",
      "title.lang": "English",
      "title.menu": "القائمة",
      "title.account": "الحساب / تسجيل الخروج",
      "login.sub": "كونسول العمليات",
      "action.save": "حفظ",
      "action.cancel": "إلغاء",
      "action.refresh": "تحديث",
      "action.test": "إرسال اختبار",
      "action.enabled": "مُفعّل",
      "common.loading": "جارٍ التحميل…"
    }
  };

  let lang = (function () { try { return localStorage.getItem(KEY) || 'en'; } catch (e) { return 'en'; } })();

  function t(key, fb) {
    const d = DICT[lang] || DICT.en;
    return (key in d) ? d[key] : (fb != null ? fb : (DICT.en[key] != null ? DICT.en[key] : key));
  }

  function applyI18n(scope) {
    const rootEl = scope || document;
    rootEl.querySelectorAll('[data-i18n]').forEach(el => { el.textContent = t(el.getAttribute('data-i18n'), el.textContent); });
    rootEl.querySelectorAll('[data-i18n-html]').forEach(el => { el.innerHTML = t(el.getAttribute('data-i18n-html'), el.innerHTML); });
    rootEl.querySelectorAll('[data-i18n-ph]').forEach(el => { el.setAttribute('placeholder', t(el.getAttribute('data-i18n-ph'))); });
    rootEl.querySelectorAll('[data-i18n-title]').forEach(el => { el.setAttribute('title', t(el.getAttribute('data-i18n-title'))); });
  }

  function setLang(next, dispatch) {
    lang = (next === 'ar') ? 'ar' : 'en';
    try { localStorage.setItem(KEY, lang); } catch (e) {}
    root.setAttribute('lang', lang);
    root.setAttribute('dir', lang === 'ar' ? 'rtl' : 'ltr');
    const btn = document.getElementById('langToggle');
    if (btn) { btn.textContent = lang === 'ar' ? 'EN' : 'ع'; btn.title = t('title.lang'); }
    applyI18n();
    if (dispatch !== false) {
      document.dispatchEvent(new CustomEvent('langchange', { detail: { lang } }));
      // reuse the existing re-render hook so SVG/dynamic views refresh
      document.dispatchEvent(new CustomEvent('themechange', { detail: { lang } }));
    }
  }

  // expose for JS-rendered strings
  window.t = t;
  window.i18n = { t, applyI18n, setLang, get lang() { return lang; }, DICT };

  function init() {
    // reflect the lang the head script already set (no dispatch → no flash)
    setLang(lang, false);
    const btn = document.getElementById('langToggle');
    if (btn) btn.addEventListener('click', () => setLang(lang === 'ar' ? 'en' : 'ar', true));
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
