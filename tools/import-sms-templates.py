#!/usr/bin/env python3
"""Extract the SMS templates the app actually sends into smsTemplates.json.

WHY THIS EXISTS
The platform keeps NO record of an SMS body. Notifier::SmsWorker takes (number, message),
posts it to Unifonic/Msegat and discards the response — nothing is written to any table. So the
only way the console can show "what did we send this customer" is to rebuild the text from the
same source the app builds it from: MessageBuilder + config/locales/{en,ar}.yml, keyed
`notification_sms_otp_<message_type>` (Otp::OTP_MESSAGE_TYPES).

That makes the console's rendering a RECONSTRUCTION, not a copy of a sent message — and it is
labelled as such everywhere it appears. It is exact whenever the message type is known, because
it comes from the very template the app interpolated.

Run from the repo root (needs the app checkout beside the console):
    python3 mvno-console/tools/import-sms-templates.py
Writes mvno-console/smsTemplates.json (shipped to STATIC_DIR by deploy.sh with the other *.json).
"""
import json, os, re, sys, datetime

HERE = os.path.dirname(os.path.abspath(__file__))
CONSOLE = os.path.dirname(HERE)
APP = os.path.join(os.path.dirname(CONSOLE), 'selfcare-backend')
LOCALES = os.path.join(APP, 'config', 'locales')
PREFIX = 'notification_sms_otp_'

try:
    import yaml
except ImportError:
    sys.exit('pyyaml is required:  pip3 install pyyaml --break-system-packages')


def load(lang):
    path = os.path.join(LOCALES, f'{lang}.yml')
    if not os.path.exists(path):
        return {}
    with open(path, encoding='utf-8') as fh:
        doc = yaml.safe_load(fh) or {}
    # locale files are { en: { key: value, ... } }
    root = doc.get(lang) or next(iter(doc.values()), {}) or {}
    return {k[len(PREFIX):]: v for k, v in root.items()
            if isinstance(k, str) and k.startswith(PREFIX) and isinstance(v, str)}


def placeholders(text):
    return sorted(set(re.findall(r'%\{(\w+)\}', text or '')))


def main():
    if not os.path.isdir(LOCALES):
        sys.exit(f'app locales not found at {LOCALES}')
    en, ar = load('en'), load('ar')

    # the generic body Otp#send_otp falls back to when message_type is not in OTP_MESSAGE_TYPES
    fallback = ('كلمه المرور لمرة واحدة لسلام موبايل هي {code} is your Salam Mobile otp\n'
                '<protection message, ar>\n<protection message, en>')

    keys = sorted(set(en) | set(ar))
    out = {
        'generated_at': datetime.datetime.now(datetime.timezone.utc).isoformat(),
        'source': 'selfcare-backend config/locales/{en,ar}.yml · MessageBuilder · Otp::OTP_MESSAGE_TYPES',
        'note': ('Templates, not sent messages. The app stores no SMS body — these are the strings '
                 'MessageBuilder interpolates, so the rendered text is exact whenever the message '
                 'type is known.'),
        'fallback': fallback,
        'count': len(keys),
        'templates': {k: {'en': en.get(k), 'ar': ar.get(k), 'vars': placeholders(en.get(k) or ar.get(k))}
                      for k in keys}
    }
    dest = os.path.join(CONSOLE, 'smsTemplates.json')
    with open(dest, 'w', encoding='utf-8') as fh:
        json.dump(out, fh, ensure_ascii=False, indent=1)
    both = sum(1 for k in keys if en.get(k) and ar.get(k))
    print(f'{len(keys)} templates  ({both} with both en+ar)  ->  {dest}')


if __name__ == '__main__':
    main()
