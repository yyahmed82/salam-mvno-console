"""Failure-family classification, shared by the PDF and the workbook.

WHY THIS EXISTS
The two charts BI circulated group failures into families (abandoned · wallet rails with no
message · card declines · acquirer config · technical) rather than raw message strings. This
module reproduces those families over the 12-month app-side extract.

THE ONE THING TO UNDERSTAND BEFORE READING ANY FAMILY NUMBER
Reason coverage is VENDOR-STRUCTURAL, not a generic app limitation:
    salam (UPG) 546,013 failures →     25 carry a message (0.0%)
    hyperpay      6,775 failures →  6,775 carry a message (100.0%)
    tap             141 failures →    141 carry a message (100.0%)
    tamara          563 failures →      0 carry a message (0.0%)
HyperPay and Tap write the acquirer response into the app; UPG does not. So the reasoned families
below describe the HyperPay/Tap-routed minority almost exclusively. They are NOT a sample of all
failures and must never be scaled up to one.
"""
import re

# Ordered rules — first match wins. Every rule is anchored on wording the acquirer actually sends.
RULES = [
    ('Acquirer configuration', [
        r'transaction type not supported', r'invalid configuration data',
        r'format error', r'structural errors', r'invalid cc number/brand combination']),
    ('Timeout / gateway technical', [r'technical error in 3d']),
    ('Authentication / 3DS', [
        r'authentication', r'3d secure', r'3ds', r'scheme directory server', r'not authenticated']),
    ('Timeout / gateway technical', [
        r'timeout', r'timed out', r'external gateway', r'acquirer currently down',
        r'internal server error', r'cannot find transaction', r'^not found$']),
    ('Cancelled by user', [r'cancelled by user', r'^cancelled$']),
    ('Card / bank decline', [
        r'insufficient funds', r'exceeds credit', r'invalid card', r'expired', r'csc/cvv',
        r'card issuer', r'limit exceeded', r'not permitted', r'blacklist', r'restricted',
        r'authorization system', r'^declined$', r'unknown reason', r'invalid card no']),
    ('Unspecified failure', [r'unspecified failure', r'^failed$']),
]


def family(reason):
    """Classify one acquirer message. '(no message)' is handled by the caller, not here —
    it is a coverage fact about the vendor, not a reason."""
    r = (reason or '').lower()
    for name, pats in RULES:
        if any(re.search(p, r) for p in pats):
            return name
    return 'Other / unclassified'


# Display order and colour intent, mirroring the shared charts: customer-side blue, config amber,
# technical red, coverage-artefact grey.
ORDER = [
    ('Abandoned — never engaged',   'customer'),
    ('No acquirer message (UPG)',   'coverage'),
    ('Card / bank decline',         'customer'),
    ('Authentication / 3DS',        'customer'),
    ('Cancelled by user',           'customer'),
    ('Acquirer configuration',      'config'),
    ('Timeout / gateway technical', 'technical'),
    ('Stuck after gateway answer',  'technical'),
    ('Unspecified failure',         'technical'),
    ('Other / unclassified',        'technical'),
]
KIND_COLOR = {'customer': '#2563EB', 'coverage': '#9AA8A2',
              'config': '#D97706', 'technical': '#B3261E'}
