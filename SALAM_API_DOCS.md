# Salam Selfcare API — imported documentation (2026-08-19)

Source: the app's own Slate docs (staging-proxy.salammobile.sa/api-docs). These describe the
Digital API the mobile app and web call — order wizard, checkout, payments, recharges, etc.

## Salam API · Introduction
Introduction

Welcome to the Salam API! You can use our API to access Salam API endpoints.

The purpose of this document is to explain the apis and how to use them.

## Salam API · Authentication
Authentication

To authorize, use this code:

# With shell, you can just pass the correct header with each request
curl "api_endpoint_here" \
  -H "Authorization: Bearer YOUR_API_KEY"

Check shell tab

Make sure to replace YOUR_API_KEY with your API key.

Salam uses API keys to allow access to the API. You can request this access from Salam

Salam expects for the API key to be included in all API requests to the server in a header that looks like the following:

Authorization: Bearer YOUR_API_KEY

You must replace YOUR_API_KEY with your personal API key.

## Salam API · API Resources and versions
API Resources and versions

All available resources follow the same URL pattern shown below:

https://{domains}/apis/{resource}/

Available domains:

https://staging-proxy.salammobile.sa

Salam Api Supports different api versions and we cascade back. Meaning, Apis are backward compatible as much as we can.

Salam Api layer uses API version in the header. To send a specific api version, use the following header name and format

X-Protocol-Version: v{numbber}

For  example to use  v5 of the api:

X-PROTOCOL-VERSION: 5

Latest Api-Version is: v5, so please make sure to use it.

## Salam API · Headers
Headers

### Salam API · Used by All
Used by All

Below are available headers based on the env:

 | 

 | Header
 | ENV
 | possible values
 | default
 | notes

 | X-Protocol-Version
 | STG/PROD
 | v1/v2/v3
 | v3
 | Use latest

 | Authorization
 | STG/PROD
 | N/A
 | N/A
 | Bearer API_KEY

 | Accept-Language
 | STG/PROD
 | en/ar
 | en
 | Will reflect on returned content

### Salam API · Only Salam SelfCare Apps
Only Salam SelfCare Apps

 | 

 | Header
 | ENV
 | possible values
 | default
 | notes

 | Salam-Platform
 | STG/PROD
 | ios/android/web
 | N/A
 | N/A

 | Salam-OS-Version
 | STG/PROD
 | N/A
 | N/A
 | for iOS and Android

 | Refresh-Token
 | STG/PROD
 | N/A
 | N/A
 | Used to refresh the session

 | Salam-Installed-App-Version
 | STG/PROD
 | en/ar
 | en
 | Current App Version

## Salam API · Models
Models

### Salam API · Plan
Plan

Sample Plan Object:

{
  "id": 7,
  "optiva_reference": "100016",
  "price": 85.68,
  "original_price": 85.68,
  "discount_rate": "0%",
  "plan_type": 2,
  "title": "سولو",
  "summary": "باقة سولو من سلام موبايل توفر لك جميع احتياجاتك من مكالمات وانترنت وسوشيال ميديا لامحدودة",
  "marketing_message": "مفوترة",
  "price_summary": "تجربه عرض تنبيه الضريبه",
  "validity": 30,
  "has_data_sim": true,
  "subplans": [
    {
      "name": "بيانات",
      "value": "40 جيجابايت"
    },
    {
      "name": "بيانات التواصل الإجتماعي",
      "value": "لامحدودة"
    },
    {
      "name": "الرسائل النصية المحلية",
      "value": "لامحدودة"
    },
    {
      "name": "نقل البيانات الغير مستخدمة",
      "value": "مجاناً"
    },
    {
      "name": "صلاحية الباقة",
      "value": "شهر"
    },
    {
      "name": "شامل ضريبة القيمة المضافة 15%",
      "value": "-"
    },
    {
      "name": "دقائق محلية",
      "value": "لامحدودة"
    }
  ]
}

check Json tab

 | 

 | Field
 | Type
 | Description

 | id
 | number
 | A unique identifier of the plan.

 | optiva_reference
 | string
 | Reference ID to the Salam Backend

 | price
 | float
 | current price for the plan after discount

 | original_price
 | float
 | main price for the plan before discount

 | discount_rate
 | string
 | percentage format for the UI

 | plan_type
 | number
 | 1: Prepaid, 2: Postpaid, 3: hybrid

 | title
 | string
 | title for the plan (Translatable)

 | summary
 | string
 | summary for the plan (Translatable)

 | marketing_message
 | string
 | extra marketing message shown in the UI (Translatable)

 | price_summary
 | string
 | extra marketing for price shown in the UI (Translatable)

 | validity
 | Integer
 | validity for the plan in days.

 | has_data_sim
 | Boolean
 | define if the plan has a data sim included with it.

 | subplans
 | Array of Hashes
 | Array of Key values SubPlans to show on the UI (Translatable)

### Salam API · Vanity
Vanity

Sample Vanity Object:

{
      "id": 3,
      "name": "Regular",
      "price": 0.0,
      "color": "#dcdcdc",
      "color_dark": "#c84141"
}

check Json tab

Salam has the following defined vanities

 | 

 | ID
 | Name

 | 3
 | Regular

 | 4
 | Silver

 | 5
 | Gold

 | 6
 | Platinum

Structure for the vanity Object:

 | 

 | Field
 | Type
 | Description

 | id
 | number
 | Unique Vanity ID in SelfCare

 | name
 | string
 | Name of the vanity (Translatable)

 | price
 | float
 | price for the vanity

 | color
 | string
 | hex color for vanity in light theme

 | color_dark
 | string
 | hex color for vanity in dark theme

Currently Salam has no definition of Special Numbers. It leaves that defintions to the vendors. For example you can define special numbers to be number with price > 0 which means vanities 4,5,6 etc.

### Salam API · Number
Number

Sample Number Object:

{
  "identifier": "966511358934",
  "vanity": {
    "id": 4,
    "name": "فضي",
    "price": 500.0,
    "color": "#839099",
    "enabled": true,
    "color_dark": "#839099"
  }
}

check Json tab

 | 

 | Field
 | Type
 | Description

 | identifier
 | string
 | The unique MSISDN within backend

 | vanity
 | object
 | Vanity object.

Reservation Duration

Number Reservation has 2 checkpoints:

Initial Reservation: The initial reservation happens when the customer select the numbers but he didn't complete his purchase yet.

 | 

 | Vanity
 | Expiration

 | 3
 | 15 mins

 | 4
 | 15 mins

 | 5
 | 15 mins

 | 6
 | 15 mins

Extended Reservation: When the customer finishes the purchase journey

 | 

 | Vanity
 | Expiration

 | 3
 | 30 days

 | 4
 | 90 days

 | 5
 | 120 days

 | 6
 | 120 days

## Salam API · Apollo Apis
Apollo Apis

To keep things flexable, everything apollo will live in a namespace called /apollo

### Salam API · Plans
Plans

To Fetch all Plans:

curl "https://staging-proxy.salammobile.sa/api/apollo/plans" \
     -H 'X-PROTOCOL-VERSION: 5' \
     -H 'Accept-Language: ar' \
     -H 'Authorization: Bearer Apollo_KEY' \
     -H 'Content-Type: application/x-www-form-urlencoded; charset=utf-8'

{
  "plans": [
    {
      "id": 7,
      "optiva_reference": "100016",
      "price": 85.68,
      "original_price": 85.68,
      "discount_rate": "0%",
      "plan_type": 2,
      "title": "سولو",
      "summary": "باقة سولو من سلام موبايل توفر لك جميع احتياجاتك من مكالمات وانترنت وسوشيال ميديا لامحدودة",
      "marketing_message": "مفوترة",
      "price_summary": "تجربه عرض تنبيه الضريبه",
      "validity": 30,
      "has_data_sim": true,
      "subplans": [
        {
          "name": "بيانات",
          "value": "40 جيجابايت"
        },
        {
          "name": "بيانات التواصل الإجتماعي",
          "value": "لامحدودة"
        },
        {
          "name": "الرسائل النصية المحلية",
          "value": "لامحدودة"
        },
        {
          "name": "نقل البيانات الغير مستخدمة",
          "value": "مجاناً"
        },
        {
          "name": "صلاحية الباقة",
          "value": "شهر"
        },
        {
          "name": "شامل ضريبة القيمة المضافة 15%",
          "value": "-"
        },
        {
          "name": "دقائق محلية",
          "value": "لامحدودة"
        }
      ]
    },
    {
      "id": 6,
      "optiva_reference": "100103",
      "price": 179.5,
      "original_price": 179.5,
      "discount_rate": "0%",
      "plan_type": 1,
      "title": "60 الترا",
      "summary": "احصل على خط ألترا 10 من أمنية لتتمتع بالعديد من المزايا الحصرية : حزم بيانات كبيرة مكالمات على الشبكات المحلية والدولية يتم ترحيل المتبقي من حزم البيانات للشهر التالي عند التزامك لمدة سنة واحدة تحصل اشتراك شهرين (السابع والثالث عشر) مجاناً الأسعار لا تشمل الضرائب والرسوم دقائق الاستقبال صالحة لجميع الدول",
      "marketing_message": "كن أول من يقيم هذا المنتج",
      "price_summary": "تجربه عرض تنبيه الضريبه",
      "validity": 30,
      "has_data_sim": false,
      "social_networks": [
        {
          "name": "twitter",
          "png": "iVBORw0KGgoAAAANSUhEUgAAADcAAAA3CAYAAACo29JGAAAABmJLR0QA/w

### Salam API · Numbers
Numbers

To Fetch Numbers:

curl "https://staging-proxy.salammobile.sa/api/apollo/numbers?vanity_id=4" \
     -H 'X-PROTOCOL-VERSION: 5' \
     -H 'Accept-Language: ar' \
     -H 'Authorization: Bearer apollo_KEY'

{
  "numbers": [
    {
      "identifier": "966511112860",
      "vanity": {
        "id": 4,
        "name": "فضي",
        "price": 500.0,
        "color": "#839099",
        "enabled": true,
        "color_dark": "#839099"
      }
    },
    {
      "identifier": "966511112866",
      "vanity": {
        "id": 4,
        "name": "فضي",
        "price": 500.0,
        "color": "#839099",
        "enabled": true,
        "color_dark": "#839099"
      }
    },
    {
      "identifier": "966511112869",
      "vanity": {
        "id": 4,
        "name": "فضي",
        "price": 500.0,
        "color": "#839099",
        "enabled": true,
        "color_dark": "#839099"
      }
    },
    {
      "identifier": "966511112868",
      "vanity": {
        "id": 4,
        "name": "فضي",
        "price": 500.0,
        "color": "#839099",
        "enabled": true,
        "color_dark": "#839099"
      }
    },
    {
      "identifier": "966511112863",
      "vanity": {
        "id": 4,
        "name": "فضي",
        "price": 500.0,
        "color": "#839099",
        "enabled": true,
        "color_dark": "#839099"
      }
    }
  ],
  "next_page": "4_966511112869"
}

Get Numbers

 | 

 | path
 | Verb
 | Description

 | /api/apollo/numbers
 | GET
 | Fetch numbers (filter by vanity if vanity_id is passed)

 | 

 | param
 | Required
 | Description

 | vanity_id
 | false
 | 3/4/5/6, if not passed, will return numbers from all vanities.

 | next_page
 | false
 | After the first call, a next_page value will be returned. Use it from next call.

Please refer to the Number Model for more information on the response Array of Numbers

Reserve Number

 | 

 | path
 | Verb
 | Description

 | /api/apollo/numbers/reserve
 | POST
 | Reserve Number based on MSISDN

 | 

 | param
 | Required
 | Description

 | identifier
 | true
 | Full number format ex 966511489281

To Reserve Number:

curl -X "POST" "https://staging-proxy.salammobile.sa/api/apollo/numbers/reserve?vanity_id=5" 

### Salam API · Vanities
Vanities

To Fetch Vanities:

curl "https://staging-proxy.salammobile.sa/api/apollo/numbers/vanities" \
     -H 'X-PROTOCOL-VERSION: 5' \
     -H 'Accept-Language: en' \
     -H 'Authorization: Bearer Apollo_KEY'

{
  "vanities": [
    {
      "id": 3,
      "name": "Regular",
      "price": 0.0,
      "color": "#dcdcdc",
      "color_dark": "#c84141"
    },
    {
      "id": 4,
      "name": "Silver",
      "price": 500.0,
      "color": "#839099",
      "color_dark": "#839099"
    },
    {
      "id": 5,
      "name": "Gold",
      "price": 2500.0,
      "color": "#f5c25c",
      "color_dark": "#f5c25c"
    },
    {
      "id": 6,
      "name": "Platinum",
      "price": 7000.0,
      "color": "#334d5d",
      "color_dark": "#334d5d"
    }
  ]
}

Vanities Resource has 1 method

 | 

 | path
 | Verb
 | Description

 | /numbers/vanities
 | GET
 | Fetch all enabled Vanities

Please refer to the Vanity Model for more information on the response Array of Vanities

### Salam API · Eligibility
Eligibility

To query eligibility:

curl -X "POST" "https://staging-proxy.salammobile.sa/api/apollo/eligibility" \
     -H 'Authorization: Bearer APOLLO_KEY' \
     -H 'Content-Type: application/json; charset=utf-8' \
     -d $'{
  "subscription_type": 1,
  "person_id": "1003309307",
  "person_nationality": "113",
  "person_id_type": "1"
}'

{
  "is_eligible": true
}

{
  "is_eligible": false
}

In case of validation error (HTTP CODE: 422)

curl -X "POST" "https://staging-proxy.salammobile.sa/api/apollo/eligibility" \
     -H 'Authorization: Bearer APOLLO_KEY' \
     -H 'Content-Type: application/json; charset=utf-8' \
     -d $'{
  "subscription_type": 10,
  "person_id": "1003309307",
  "person_nationality": 113,
  "person_id_type": 1
}'

{
  "status": "Error",
  "code": -211,
  "error": "Subscription type 10 is not a proper plan type"
}

 | 

 | path
 | Verb
 | Description

 | /eligibility
 | POST
 | Check customer eligibility

 | 

 | Param
 | Type
 | Description

 | person_id
 | string
 | customer identification

 | subscription_type
 | number
 | Plan Type (1,2,3)

 | person_id_type
 | number
 | according to SEMATI document

 | person_nationality
 | number
 | according to SEMATI document, for example KSA is 113

### Salam API · Nafath v2
Nafath v2

To request Nafath:

curl -X "POST" "https://staging-proxy.salammobile.sa/api/apollo/semati/authorize" \
     -H 'Authorization: Bearer APOLLO_KEY' \
     -H 'Content-Type: application/json; charset=utf-8' \
     -H 'x-user-ip: 192.168.1.100' \
     -d $'{
  "nationality_id_number": "1000828812",
  "service": "new_mobile"
}'

Note: The x-user-ip header is optional but recommended. It should contain the end user's IP address.

{
  "transId": "93e60632-9c92-4a27-867b-c885c391a2a7",
  "random": "60"
}

{
    "status": "Error",
    "code": -501,
    "error": "NAFATH: THERE IS AN ACTIVE TRANSACTION"
}

{
    "status": "Error",
    "code": -501,
    "error": "id must be 10 digits and starts with 1,2,3,4,5,6"
}

To check Nafath Status:

curl "https://staging-proxy.salammobile.sa/api/apollo/semati/check?trans_id=410c9b95-9032-4cf9-8ea5-0c23bcb0bc57" \
     -H 'Authorization: Bearer APOLLO_KEY' \
     -H 'Content-Type: application/json; charset=utf-8' 

{
    "status": "success",
    "message": "success"
}

{
    "status": "Error",
    "code": -700,
    "error": "pending"          ---> try again after 2 seconds !!
}

{
    "status": "Error",
    "code": -111,
    "error": "Invalid I AM"
}

Available Nafath Apis

 | 

 | path
 | Verb
 | Description

 | /apollo/semati/authorize
 | POST
 | Request Random number

 | /apollo/semati/check
 | GET
 | Check Transaction Status

 | 

 | Service
 | Value
 | Description

 | new_mobile
 | string
 | Activiation new number

 | new_sim
 | string
 | Activating new SIM (used for data)

### Salam API · Checkout
Checkout

Please note checkout API requires a new header Unique-User-Id. Check curl for more information

To Create a checkout:

## breakdown
curl -X "POST" "https://staging-proxy.salammobile.sa/api/apollo/checkout" \
     -H 'X-PROTOCOL-VERSION: 5' \
     -H 'Salam-Platform: ios' \
     -H 'Accept-Language: ar' \
     -H 'Authorization: Apollo KEY' \
     -H 'Unique-User-Id: Apollo-1234-56' \
     -H 'Content-Type: application/json; charset=utf-8' \
     -d $'{
  "nationality": {
    "id": "2334773559",
    "eligible": true,
    "country_id": "207"
  },
  "number": {
    "reservation_id": "110222",
    "identifier": "966511489294"
  },
  "customer": {
    "email": "moski@startappz.com",
    "email_verified": "true",
    "contact_number_verified": "true",
    "contact_number": "966555127502",
    "name": "ahmad"
  },
  "delivery": {
    "delivery_lat": "24.61996330453463",
    "delivery_lng": "46.71823550015688"
  },
  "plan_id": "1",
  "sim_type": 0,
  "number_order_type": 1,
  "mnp_operator": "STC",
  "mnp_number": "96652111154",
  "referral_code": "xxxxxxx",
  "require_delivery": false
}'

{
  "nationality": {
    "id": "2334773559",
    "eligible": true,
    "country_id": "207"
  },
  "number": {
    "reservation_id": "110222",
    "identifier": "966511489294"
  },
  "customer": {
    "email": "moski@startappz.com",
    "email_verified": "true",
    "contact_number_verified": "true",
    "contact_number": "966555127502",
    "name": "ahmad"
  },
  "delivery": {
    "delivery_lat": "24.61996330453463",
    "delivery_lng": "46.71823550015688"
  },
  "plan_id": "1",
  "sim_type": 0,
  "number_order_type": 1,
  "mnp_operator": "STC",
  "mnp_number": "96652111154",
  "referral_code": "xxxxxxx",
  "require_delivery": false
}

{
  "onboarding_order": {
    "order_id": "e2864625-4e63-4d42-a464-1af7b80c88fe",
    "checkout_id": "rapca1dc",
    "current_state": "payment",
    "sim_type": 0,
    "require_data_sim": false,
    "plan": {
      "id": 1,
      "optiva_reference": "100103",
      "price": 179.5,
      "original_price": 179.5,
      "discount_rate": "0%",
      "plan_type": 1,
      "sim_type": 0,
      "title": "باقة سولو اللامحدودة",
      "summary": "استم

### Salam API · Load List of Operators.
Load List of Operators.

To load list of operators:

## breakdown
curl -X --location "'http://staging-proxy.salammobile.sa/api/lookup/operators'" \
     -H 'X-PROTOCOL-VERSION: 9' \
     -H 'Content-Type: application/json; charset=utf-8'

{
  "operators": [
    {
      "id": "Mobily",
      "name": "Mobily",
      "image_url": "https://salamsa-assets.s3.ap-southeast-1.amazonaws.com/mnp/1.png"
    },
    {
      "id": "Zain",
      "name": "Zain",
      "image_url": "https://salamsa-assets.s3.ap-southeast-1.amazonaws.com/mnp/2.png"
    },
    {
      "id": "STC",
      "name": "STC",
      "image_url": "https://salamsa-assets.s3.ap-southeast-1.amazonaws.com/mnp/103.png"
    },
    {
      "id": "Virgin",
      "name": "Virgin",
      "image_url": "https://salamsa-assets.s3.ap-southeast-1.amazonaws.com/mnp/7.png"
    },
    {
      "id": "Lebara",
      "name": "Lebara",
      "image_url": "https://salamsa-assets.s3.ap-southeast-1.amazonaws.com/mnp/8.png"
    },
    {
      "id": "REDBULLMOB",
      "name": "REDBULLMOB",
      "image_url": "https://salamsa-assets.s3.ap-southeast-1.amazonaws.com/mnp/102.png"
    }
  ]
}

### Salam API · OTP
OTP

After creating a checkout an OTP will be sent to the customer to confirm his identity. You can use the OTP refernece to confirm this transation.

id is the OTP Transation ID
code is the SMS code that was delivered to the customer. You can use 7421 to bypass on staging.

curl -X "POST" "https://staging-proxy.salammobile.sa/api/apollo/checkout/otp_confirm" \
     -H 'X-PROTOCOL-VERSION: 5' \
     -H 'Salam-Platform: ios' \
     -H 'Accept-Language: en' \
     -H 'Authorization: Bearer 2c6ad45391ae28bf2c129cd455b40591' \
     -H 'Unique-User-Id: Apollo-1234-56' \
     -H 'Content-Type: application/json; charset=utf-8' \
     -d $'{
      "id": "1922dd21-041e-4b6b-8dd3-0dd97ba10906",
      "code": "7421"
}'

{
  "status": "success",
  "message": "success"
}

Or

{
  "status": "Error",
  "code": -103,
  "error": "Invalid OTP Code"
}

### Salam API · Checkout Confirmation / Payment
Checkout Confirmation / Payment

Please note checkout API requires a new header Unique-User-Id. Check curl for more information

To Confirm/Pay for a checkout:

curl -X "POST" "https://staging-proxy.salammobile.sa/api/apollo/checkout/confirm" \
     -H 'X-PROTOCOL-VERSION: 5' \
     -H 'Salam-Platform: ios' \
     -H 'Accept-Language: ar' \
     -H 'Authorization: Bearer c88a9694fb5c58cc9243d34a3bfe298e' \
     -H 'Unique-User-Id: Apollo-1234-56' \
     -H 'Content-Type: application/json; charset=utf-8' \
     -d $'{
      "salam_order_id": "00cbc639-40e5-4dc8-9848-c88579a49bf6",
      "amount": 3081.43,
      "salam_checkout_id": "fe8skn4k",
      "external_transaction_id": "SOME_EXTERNAL_TRANS_ID",
      "paymentStatus": true,
      "date": "2023-04-09 11:51:46.9461751",
      "external_order_id": "SOME_EXTERNAL_ORDER_ID",
      "otp_id": "1922dd21-041e-4b6b-8dd3-0dd97ba10906"
    }'

### Salam API · Checkout Refund / Payment
Checkout Refund / Payment

Please note checkout API requires a new header Unique-User-Id. Check curl for more information

To Refund a checkout:

curl -X "POST" "https://staging-proxy.salammobile.sa/api/apollo/checkout/refund" \
     -H 'X-PROTOCOL-VERSION: 5' \
     -H 'Salam-Platform: ios' \
     -H 'Accept-Language: ar' \
     -H 'Authorization: Bearer c88a9694fb5c58cc9243d34a3bfe298e' \
     -H 'Unique-User-Id: Apollo-1234-56' \
     -H 'Content-Type: application/json; charset=utf-8' \
     -d $'{
      "salam_order_id": "00cbc639-40e5-4dc8-9848-c88579a49bf6"
    }'

# in case of success
{
    "status": "success",
    "message": "success"
}

# in case of pending status
{
    "status": "Error",
    "code": -10001,
    "error": "Sorry your payment couldn't be processed. Please try again using a different payment method",
    "source": "salam"
}

# in case of failure
{
    "status": "Error",
    "code": -10002,
    "error": "Sorry your payment is still in processing, please try again after 30 minutes.",
    "source": "salam"
}

# in case of invalid order id
{
    "status": "Error",
    "code": -100,
    "error": "Invalid Order ID",
    "source": "salam"
}

It will return an object of onboarding order if refund is success

### Salam API · Load Available orders for activation.
Load Available orders for activation.

Please note checkout API requires a new header Unique-User-Id. Check curl for more information

To load all Checkouts:

curl -X "GET" "https://staging-proxy.salammobile.sa/api/apollo/checkout" \
     -H 'X-PROTOCOL-VERSION: 5' \
     -H 'Salam-Platform: ios' \
     -H 'Accept-Language: ar' \
     -H 'Authorization: Bearer c88a9694fb5c58cc9243d34a3bfe298e' \
     -H 'Unique-User-Id: Apollo-1234-56' \
     -H 'Content-Type: application/json; charset=utf-8'

{
  "onboarding_orders": [
    {
      "order_id": "6b7cde4d-bb25-4d69-862a-26cc21b9cad8",
      "checkout_id": "wk9f7r2",
      "current_state": "payment",
      "sim_type": 0,
      "require_data_sim": false,
      "plan": {
        "id": 1,
        "optiva_reference": "100103",
        "price": 179.5,
        "original_price": 179.5,
        "discount_rate": "0%",
        "plan_type": 1,
        "sim_type": 0,
        "title": "باقة سولو اللامحدودة",
        "summary": "استمتع بمكالمات وانترنت لا محدود مع  باقة سولو اللامحدودة، التي  توفر لك كل ما تحتاج.\r\n* عرض الـ 50% صالح لمدة سنة\r\n** تطبق ضريبة القيمة المضافة عند الشحن",
        "marketing_message": "مسبقة الدفع",
        "price_summary": null,
        "validity": 30,
        "validity_text": null,
        "has_data_sim": true,
        "social_networks": [],
        "notes": null,
        "hide_change_plan": false,
        "bundle_type": 0,
        "subplans": [
          {
            "name": "بيانات",
            "value": "لامحدودة"
          },
          {
            "name": "بيانات التواصل الإجتماعي",
            "value": "لامحدودة"
          },
          {
            "name": "دقائق محلية",
            "value": "لامحدودة"
          },
          {
            "name": "الرسائل النصية المحلية",
            "value": "لامحدودة"
          },
          {
            "name": "شريحة بيانات إضافية",
            "value": "مجاناً"
          },
          {
            "name": "صلاحية الباقة",
            "value": "30 يوم"
          }
        ]
      },
      "number_order_type": 0,
      "email": "moski@startappz.com",
      "email_verified": true,
      "mobile_number": "966555127502",
      "mobile_number_verified": t

### Salam API · Fetch order details (status)
Fetch order details (status)

Please note checkout API requires a new header Unique-User-Id. Check curl for more information

To fetch a particular checkout:

curl -X "GET" "https://staging-proxy.salammobile.sa/api/apollo/checkout/4b206c0c-883d-4616-b779-b20f0c7cc370" \
     -H 'X-PROTOCOL-VERSION: 5' \
     -H 'Api-Key: 2c6ad45391ae28bf2c129cd455b40591' \
     -H 'Content-Type: application/json; charset=utf-8'

{
    "onboarding_order": {
        "order_id": "4b206c0c-883d-4616-b779-b20f0c7cc370",
        "checkout_id": "3un9oswf",
        "current_state": "payment",
        "sim_type": 0,
        "status": "cancelled_aged",
        "completed": true,
        "delivery_type": "delivery",
        "require_data_sim": true,
        "number_order_type": 0,
        "email": "Rawan@test.com",
        "email_verified": true,
        "mobile_number": "966512345678",
        "mobile_number_verified": false,
        "mnp_number": null,
        "number": {
            "identifier": "966511487331",
            "vanity": {
                "id": 3,
                "name": "Regular",
                "price": 0.0,
                "color": "#dcdcdc",
                "color_dark": "#c84141"
            },
            "expires_at": "2022-04-27T15:09:44.200+03:00"
        },
        "plan": {
            "id": 7,
            "optiva_reference": "100016",
            "price": 85.68,
            "original_price": 171.36,
            "display_price": 85.68,
            "display_original_price": 171.36,
            "discount_rate": "50%",
            "interest_rate": 0.1,
            "plan_type": 2,
            "sim_type": 0,
            "title": "Solo - postpaid",
            "summary": "Solo plan from Salam Mobile provides all your needs from calls, internet, and unlimited social media.\r\n100016 ",
            "marketing_message": "Postpaid",
            "price_summary": "VAT Testing price summary",
            "validity": 30,
            "validity_text": null,
            "has_data_sim": false,
            "notes": null,
            "hide_change_plan": false,
            "bundle_type": 0,
            "categories": []
        },
        "eligibility": {
            "nationality_id_

### Salam API · Activation
Activation

To activate an order (Normal SIM):

curl -X "POST" "https://staging-proxy.salammobile.sa/api/apollo/activation" \
     -H 'X-PROTOCOL-VERSION: 5' \
     -H 'Salam-Platform: ios' \
     -H 'Accept-Language: ar' \
     -H 'Authorization: Bearer c88a9694fb5c58cc9243d34a3bfe298e' \
     -H 'Unique-User-Id: Apollo-1234-56' \
     -H 'Content-Type: application/json; charset=utf-8' \
    -d $'{
      "order_id": "7b36ef4d-1c1c-4b3d-a9f7-70f80230e601",
      "iccid": "899660999660000541",
      "iam_token": ""
    }'

# In case of normal Response

{
  "completed": true,
  "is_registered": false
}

# In case of ESIM
{
  "completed": true,
  "is_registered": false,
  "esim_profile_link": "Link to download the profile"
}

 | 

 | Request Params
 | Type
 | Description

 | order_id
 | string
 | Salam Onboarding order ID

 | iccid
 | string
 | Customer ICCID in case of normal SIM [Optional]

 | iam_token
 | string
 | Nafath reference number

 | 

 | Response Params
 | Type
 | Description

 | completed
 | boolean
 | true/false

 | esim_profile_link
 | string
 | ESIM profile Link

 | is_registered
 | boolean
 | Not used by Apollo

### Salam API · Activation Code Details
Activation Code Details

To fetch QR Activation details (E-SIM):

curl --location 'https://staging-proxy.salammobile.sa/api/apollo/checkout/esim_details?mobile_number=966510018621' \
--header 'Authorization: Bearer APOLLO_KEY'

# In case of normal Response

{
    "esim_qr": "https://staging-proxy.salammobile.sa/api/apollo/checkout/esim_qr?esim_profile_link=LPA:1$salammobile.esim.com.sa$0D88F2822FFD2523798D938802C618C9C4A47F17FF8394FD39B0B81984994670",
    "esim_profile_link": "LPA:1$salammobile.esim.com.sa$0D88F2822FFD2523798D938802C618C9C4A47F17FF8394FD39B0B81984994670"
}

# In case of number does not exist
{
    "status": "Error",
    "code": -112,
    "error": "Invalid Mobile Number",
    "source": "salam"
}

# In case of number is not esim
{
    "status": "Error",
    "code": -125,
    "error": "The provided eSIM ICCID does not exist. Please check with the customer support.",
    "source": "salam"
}

 | 

 | Request Params
 | Type
 | Description

 | mobile_number
 | string
 | Salam Mobile Number

 | 

 | Response Params
 | Type
 | Description

 | esim_qr
 | string
 | Esim QR code link (generates PNG image)

 | esim_profile_link
 | string
 | ESIM profile Link

## Salam API · Sedco Apis
Sedco Apis

To keep things flexable, everything tygo will live in a namespace called /sedco

### Salam API · Nafath v2
Nafath v2

To request Nafath:

curl -X "POST" "https://staging-proxy.salammobile.sa/api/sedco/semati/authorize" \
     -H 'Authorization: Bearer SEDCO_KEY' \
     -H 'Content-Type: application/json; charset=utf-8' \
     -H 'x-user-ip: 192.168.1.100' \
     -d $'{
  "nationality_id_number": "1000828812",
  "service": "new_mobile"
}'

{
  "transId": "93e60632-9c92-4a27-867b-c885c391a2a7",
  "random": "60"
}

{
    "status": "Error",
    "code": -501,
    "error": "NAFATH: THERE IS AN ACTIVE TRANSACTION"
}

{
    "status": "Error",
    "code": -501,
    "error": "id must be 10 digits and starts with 1,2,3,4,5,6"
}

To check Nafath Status:

curl "https://staging-proxy.salammobile.sa/api/sedco/semati/check?trans_id=410c9b95-9032-4cf9-8ea5-0c23bcb0bc57" \
     -H 'Authorization: Bearer sedco_KEY' \
     -H 'Content-Type: application/json; charset=utf-8' 

{
    "status": "success",
    "message": "success"
}

{
    "status": "Error",
    "code": -700,
    "error": "pending"          ---> try again after 2 seconds !!
}

{
    "status": "Error",
    "code": -111,
    "error": "Invalid I AM"
}

To get Nafath token:

curl "https://staging-proxy.salammobile.sa/api/sedco/semati/token?trans_id=410c9b95-9032-4cf9-8ea5-0c23bcb0bc57" \
     -H 'Authorization: Bearer sedco_KEY' \
     -H 'Content-Type: application/json; charset=utf-8' 

Available Nafath Apis

 | 

 | path
 | Verb
 | Description

 | /sedco/semati/authorize
 | POST
 | Request Random number

 | /sedco/semati/check
 | GET
 | Check Transaction Status

 | /sedco/semati/token
 | GET
 | get token using Transaction ID

 | 

 | Service
 | Value
 | Description

 | new_mobile
 | string
 | Activiation new number

 | new_sim
 | string
 | Activating new SIM (used for data)

## Salam API · Errors
Errors

 | 

 | Salam Code
 | HTTP Code
 | Meaning

 | -211
 | 422
 | Validation Error

 | N/A
 | 401
 | Authorization error

 | -112
 | 422
 | INVALID MOBILE NUMBER

 | -113
 | 422
 | NUMBER ALREADY RESERVERED

 | -117
 | 422
 | RESERVATION NOT FOUND

 | -120
 | 422
 | SERVICE_UNAVAILABLE

 | -101
 | 422
 | INVALID_ONBOARDING_PLAN

 | -102
 | 422
 | INVALID_CUSTOMER_INFO

 | -104
 | 422
 | INVALID_DELIVERY_INFO

 | -117
 | 422
 | RESERVATION_NOT_FOUND

 | -115
 | 422
 | NUMBER_EXPIRED

 | -700
 | 422
 | PENDING_NAFATH_TOKEN

 | -111
 | 422
 | INVALID_IAM

 | -100
 | 422
 | INVALID_ONBOARDING_ORDER_ID

 | -110
 | 422
 | INVALID_ICCID

      

      
          
                shell
                json
