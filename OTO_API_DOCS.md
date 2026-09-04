# OTO Courier API — imported reference (2026-08-19)

Source: apis.tryoto.com. Field mapping to our platform: createOrder "orderId" = delivery_requests.internal_reference_id · "otoId" = external_reference_id · "ref1" = customer nationality id.

## OTO guide ·  · Plan-Based API Access
API functionality is structured across subscription tiers, where basic operations are available in lower plans and advanced features, integrations, and system modules are unlocked in higher tiers. Below you can find the OTO API access plan.

 | 

 | Endpoint
 | Free Plan
 | Starter Plan
 | Scale Plan
 | Pro Plan
 | Enterprise Plan

 | Authorization
 | 
 | 
 | 
 | 
 | 

 | refreshToken
 | ✅
 | ✅
 | ✅
 | ✅
 | ✅

 | healthCheck
 | ✅
 | ✅
 | ✅
 | ✅
 | ✅

 | Account
 | 
 | 
 | 
 | 
 | 

 | accountInfo
 | ✅
 | ✅
 | ✅
 | ✅
 | ✅

 | buyCredit
 | ✅
 | ✅
 | ✅
 | ✅
 | ✅

 | requestMobileVerification
 | ✅
 | ✅
 | ✅
 | ✅
 | ✅

 | verifyMobileNumber
 | ✅
 | ✅
 | ✅
 | ✅
 | ✅

 | Transactions
 | 
 | 
 | 
 | 
 | 

 | getShippingPriceTransactionsList
 | ❌
 | ✅
 | ✅
 | ✅
 | ✅

 | creditTransactions
 | ✅
 | ✅
 | ✅
 | ✅
 | ✅

 | shipmentTransactions
 | ✅
 | ✅
 | ✅
 | ✅
 | ✅

 | Marketplace
 | 
 | 
 | 
 | 
 | 

 | register
 | ✅ (if marketplace token activated)
 | ✅ (if marketplace token activated)
 | ✅ (if marketplace token activated)
 | ✅ (if marketplace token activated)
 | ✅ (if marketplace token activated)

 | clientInfo
 | ✅ (if marketplace token activated)
 | ✅ (if marketplace token activated)
 | ✅ (if marketplace token activated)
 | ✅ (if marketplace token activated)
 | ✅ (if marketplace token activated)

 | GET clientInfo
 | ✅ (if marketplace token activated)
 | ✅ (if marketplace token activated)
 | ✅ (if marketplace token activated)
 | ✅ (if marketplace token activated)
 | ✅ (if marketplace token activated)

 | Orders
 | 
 | 
 | 
 | 
 | 

 | createOrder
 | ✅
 | ✅
 | ✅
 | ✅
 | ✅

 | updateOrder
 | ✅
 | ✅
 | ✅
 | ✅
 | ✅

 | updateOrderStatus
 | ❌
 | ❌
 | ✅
 | ✅
 | ✅

 | cancelOrder
 | ✅
 | ✅
 | ✅
 | ✅
 | ✅

 | GET orders
 | ✅
 | ✅
 | ✅
 | ✅
 | ✅

 | holdOrder
 | ✅
 | ✅
 | ✅
 | ✅
 | ✅

 | unHoldOrder
 | ✅
 | ✅
 | ✅
 | ✅
 | ✅

 | GET orderDetails
 | ✅
 | ✅
 | ✅
 | ✅
 | ✅

 | checkOrderAvailability
 | ❌
 | ❌
 | ❌
 | ✅
 | ✅

 | Shipping Prices
 | 
 | 
 | 
 | 
 | 

 | checkOTODeliveryFee
 | ✅
 | ✅
 | ✅
 | ✅
 | ✅

 | checkDeliveryFee
 | ❌
 | ✅
 | ✅
 | ✅
 | ✅

 | getDeliveryFee
 | ✅
 | ✅
 | ✅
 | ✅
 | ✅

 | getDeliveryOptions
 | ❌
 | ✅
 | ✅
 | ✅
 | ✅

 | Shipments
 | 
 | 
 | 
 | 
 | 



## OTO guide ·  · Release Notes
April 2026 Release Notes

🚀 Enhancement: Feasibility-Based Shipping Option Filtering

We are introducing a new optional request parameter that enables clients to control whether feasibility rules should be applied before returning shipping options.

This enhancement is available for the following endpoints:

POST /rest/v2/checkOTODeliveryFee

POST /rest/v2/checkDeliveryFee

📌 Overview

With this update, clients can ensure that only shipping options validated by feasibility rules are returned. This is particularly useful for enforcing operational constraints, delivery coverage, or client-specific logistics rules.

📥 New Request Parameter

 | 

 | Parameter
 | Required
 | Type
 | Description

 | checkShippingRule
 | No
 | Boolean
 | Determines whether feasibility rules should be applied before returning shipping options

⚙️ Behavior & Logic

✅ When checkShippingRule = true

The system calls the feasibility service.

Only the shipping company returned by the feasibility service will be included in the response.

Pricing, estimated delivery time, and other details will be calculated only for that specific shipping company.

🔁 When checkShippingRule = false or not provided

The system follows the existing behavior.

All available shipping companies are evaluated.

Standard response with multiple shipping options is returned.

New Feature Release: Customer Notifications Retrieval API

We are introducing a new API endpoint that enables enterprise clients to retrieve all customer-facing communication artifacts programmatically and manage their own communication workflows.

📌 Overview

Enterprise clients often require full control over how they communicate with their customers. Previously, customer-facing links and OTPs (One-Time Passwords) were automatically generated and sent via internal SMS workflows, without the ability for clients to access or reuse them.

With this release, clients can now retrieve these artifacts and deliver them through their own CRM, ERP, or communication systems.

🔗 New Endpoint

GET /rest/v2/orders/{orderId}/customer-notifications

📤 Supported Action Types

The endpoint can return the following customer communication artifacts:

Tracki

## OTO guide ·  · Sandbox Account
Use the sandbox environment to create and test new configurations without affecting your live data. This helps you validate changes safely before deployment.

Dev URL:

https://staging-api.tryoto.com

Please watch the guide to create a test account.

Test Delivery Companies for Sandbox Account

You can use the deliveryOptionIds below to test the createOrder , createShipment and createReverseShipment endpoints during your testing.

 | 

 | Delivery Option
 | deliveryOptionId

 | SMSA Express
 | 2828

 | SMSA Bullet
 | 56468

 | SMSA Same Day
 | 56469

 | SMSA Pudo
 | 56470

 | SMSA Heavy & Bulky
 | 56471

## OTO guide · Use Cases and Flows · Before Start
🚀 Before Start

Before you can create orders, generate shipments, or print Air Waybills (AWBs) in your OTO account, there are a few important setup steps you must complete. Follow this guide to ensure your account is fully activated and ready to operate smoothly.

✅ 1. Verify Your Account

After creating your OTO account:

Navigate to Settings → My Profile.  

Verify your phone number and email address to complete your profile verification.

🔑 2. Activate Your Refresh Token

Go to Settings → API Integrations.  

Click the Connect button to activate your Refresh Token.

🔐 3. Generate an Access Token

Use your refresh token to obtain an access token by sending a request to the Refresh Token endpoint:

https://api.tryoto.com/rest/v2/refreshToken

🔧 4. (Optional) Configure Delivery Company Integrations

If you have existing contracts with delivery companies and prefer using them instead of OTO’s rates:

Step 1: Retrieve Available Delivery Companies  

Get the list of integrated delivery companies:

https://api.tryoto.com/rest/v2/dcList

Identify the company code you want to configure.

Step 2: Get the Configuration Template

Retrieve the required fields and credentials template for the selected delivery company:

https://api.tryoto.com/rest/v2/dcConfig

Step 3: Activate Delivery Company Integration

Submit the completed configuration to activate the delivery company:

https://api.tryoto.com/rest/v2/dcActivation

📍 5. (Optional) Create Pickup Locations

If you have fixed pickup locations:

Pre-save them in your account using the Create Pickup Location endpoint:

https://api.tryoto.com/rest/v2/createPickupLocation

💳 6. Charge Your Wallet

Before creating shipments, ensure your account has enough balance. You have two options:

Per shipment: Calculate the required balance for each shipment using either:

POST https://api.tryoto.com/rest/v2/checkOTODeliveryFee (for OTO rates)
POST https://api.tryoto.com/rest/v2/checkDeliveryFee (for your own contract rates)

Bulk top-up: Add balance manually in advance.

To charge your wallet, use the Buy Credit endpoint:

https://api.tryoto.com/rest/v2/buyCredit

✅ Once all these steps are completed, you are ready to start creat

## OTO guide · Use Cases and Flows · 📦Create a Shipment
📝Step 1: Create an Order

To create a shipment, you must create an order in your OTO account. You can do this using the createOrder endpoint:

https://api.tryoto.com/rest/v2/createOrder

Prerequisites: Provide Sender Information

When creating an order, you need to provide sender information. There are two methods, depending on your business needs:

Fixed Pickup Locations:

Use createPickupLocation endpoint to create a pickup location.

https://api.tryoto.com/rest/v2/createPickupLocation

After creating a pickup location, you’ll receive a pickupLocationCode, which you can use in the createOrder request, eliminating the need to enter sender address details every time.

Flexible Pickup Locations:

If your addresses change frequently, skip the fixed pickup location creation and provide the sender details directly in the senderInformation object within the createOrder request.

🚚Step 2: Create a Shipment

Once your order is created, you can proceed to create a shipment. You can do this in two ways:

Create Shipment via createShipment endpoint:

Use the createShipment endpoint to create a shipment by providing the orderId and deliveryOptionId:

https://api.tryoto.com/rest/v2/createShipment

There are two ways to determine the deliveryOptionId:

Delivery Options with OTO Rates:

No contracted delivery companies or activation is required. OTO offers a range of delivery company options, which are available for use. You can view these options and their associated fees by using the Check OTO Delivery Fee endpoint and get the deliveryOptionId.

  https://api.tryoto.com/rest/v2/checkOTODeliveryFee

Delivery Options with Your Own Rates:

If you have agreements with specific delivery companies, each one will have a linked deliveryOptionId. You can retrieve these IDs using the following endpoints:

https://api.tryoto.com/rest/v2/checkOTODeliveryFee 

https://api.tryoto.com/rest/v2/checkDeliveryFee

Create Shipment via createOrder endpoint:

Alternatively, you can create the shipment directly during the createOrder step by adding a createShipment: true parameter in the request body:

{
  "createShipment": true
}

This will automatically create the shipment without needing a s

## OTO guide · Use Cases and Flows · Marketplace Integration
Marketplace Integration Guide

This document outlines the roadmap for integrating marketplace companies with the OTO system. It provides a structured, step-by-step process to seamlessly onboard vendors/sellers, ensuring each is correctly registered, connected, and operational within the OTO ecosystem.

Vendor/Seller Management Models

OTO offers two distinct approaches to managing vendors, allowing marketplaces to choose the model that best suits their operations:

1. Manage Vendors/Sellers as Sub-Accounts

In this model, each vendor is registered as a separate sub-account, managed independently under a main marketplace account.

Steps to Set Up:

a. Obtain a Marketplace Token:

Request a marketplace token from your OTO account manager or support team.

b. Get Access Token:

Use your marketplace token to request a fresh access token:  

https://api.tryoto.com/rest/v2/refreshToken

c. Register a Vendor/Seller:

After obtaining the access token, register vendors/sellers individually:
POST https://api.tryoto.com/rest/v2/register

⚡ Important: Capture the refresh token returned for each seller. Each seller receives a unique refresh token, which must be used for all transactions related to that specific seller account.

d. Update Vendor/Seller Information:

To update seller details, send a request to:  

POST https://api.tryoto.com/rest/v2/clientInfo

e. Charge Vendor/Seller Accounts:

Each vendor manages their own wallet.

To add credit to a vendor account:  

https://api.tryoto.com/rest/v2/buyCredit

f. Check Vendor/Seller Balance:

Retrieve account balance information via:  

GET https://api.tryoto.com/rest/v2/clientInfo

g. Add Delivery Company Settings for Each Vendor

If vendors have their own delivery company contracts, follow these steps:

Retrieve Delivery Companies List:
 GET https://api.tryoto.com/rest/v2/dcList

 (Find the delivery company’s unique code.)

Get Delivery Company Configuration Template:
 POST https://api.tryoto.com/rest/v2/dcConfig

 (Use the company code to retrieve the required configuration fields.)

Activate Delivery Company:
 POST https://api.tryoto.com/rest/v2/dcActivation

 (Use the configuration object to activate the vendor’s delive

## OTO guide ·  · Authorization
You need your refresh_token for authorization. You can obtain your token from the UI by following these steps:

Go to Settings → API Integrations.

Click the Connect button to activate your Refresh Token.

The refresh_token can only be used to get a new access_token.

Use the access_token to call other API endpoints with the following header:

## OTO guide ·  · Webhook
WEBHOOK for ORDER

There are 3 types of webhook for now, newOrders, orderStatus ,shipmentError and walletTransaction.

OTO will push updates to the registered webhook endpoint for the orderStatus type whenever an order status changes. This includes statuses such as Processing, Delivered, Returned, and more.

OTO will push an update via the shipmentError webhook type, providing details about the error, if an error occurs while an order shipment.

OTO will push the order details to you through the newOrders webhook type, If you need to create an existing order in a different WMS system.

OTO will push wallet transaction details to you through the walletTransaction webhook type, allowing you to track credit usage, charges, refunds, and balance updates in real time for financial reconciliation and reporting.

timestamp value belongs to UTC time zone.

If registered webhook type is orderStatus, endpoint will get a payload:

{
  "orderId": "1234",
  "parentOrderId":"12334"
  "returnOrderId":"1234-R1",
  "otoId":"17234521",
  "entityId":"5433121",
  "brandedTrackingURL": "https://app.tryoto.com/sms/order-tracking?key=RUtIVHlMYkVBdlZRck1XbDhZVlBuR0FnUE5ZalVWdjFQMnhaYzlJb0tNYTh2bDB2TDZQekdXVHhxN3E0K0xyZ0xSeS8rWFoxQll4UnpKKzBaUGhNVkE9PQ==",
  "brandId":"515",
  "status": "shipmentProcessing|delivered|returned|...",
  "dcStatus": "status coming from the delivery company",
  "returnStatus":"reverseShipment",
  "note": "optional note to show in order history",
  "pickupLocationCode":"code-101",
  "driverName": "FirstName LastName",
  "driverPhone": "966555444333",
  "driverEmail": "driver@example.com",
  "driverId":"123124", 
  "printAWBURL": "https://app.tryoto.com/OTOAWB?enc=eyJpZHMiOlsxMjU1MDkzOF0sImNvbXBhbnlJZCI6MTQ5MjF9",
  "trackingNumber": "ASD00123",
  "dcTrackingNumber":"983643812",
  "trackingUrl": "www.example…...",
  "deliveryCompany": "fastExpress",
  "shipmentWeight":2,
  "attemptFailureReason": "Customer was not in the house",
  "ref1": "REF001",
  "ref2": "REF002",
  "ref3": "REF003"
  "timestamp": "1595941360328",
  "signature": "S7aLSdZjfZAIf9IOArNgTLI5PXhKDkTeYmrhIfhpE79REU2NLg6Kbeb9KavwRfhV3UhAoFNefnezBEbnn5VO7GlTN4FSESUjf1wKctrfO5gJLFuK2JhIG/p32HSj7A4Xvv

## OTO guide ·  · List Of Statuses
| 

 | Status
 | Stage
 | Description

 | new
 | Order Management
 | New order

 | missingData
 | Order Management
 | The order is missing required information to proceed with shipment creation

 | paymentConfirmed
 | Order Management
 | Payment is confirmed for the order

 | waitingAddressConfirmation
 | Order Management
 | Order waits address confirmation by customer

 | waitingAssignment
 | Order Management
 | 

 | addressConfirmed
 | Order Management
 | Customer confirmed the order address

 | addressVerified
 | Order Management
 | Customer verified the order address

 | needConfirmation
 | Order Management
 | Order waits for confirmation

 | waitingApproval
 | Order Management
 | Order waits approval

 | smsSentToReceiver
 | Order Management
 | SMS sent to receiver for a confirmation or a validation

 | paymentTypeConfirmed
 | Order Management
 | The payment type and amounts are confirmed

 | codOrderConfirmed
 | Order Management
 | COD order is confirmed by end customer

 | orderConfirmed
 | Order Management
 | Order is confirmed

 | pickupFromStore
 | Order Management
 | Order will be collected by end customer

 | interDepotTransfer
 | Order Management
 | Order is shipping to another warehouse before shipping to the end customer

 | canceled
 | Order Management
 | Order is canceled

 | deleted
 | Order Management
 | Order is deleted

 | readyForCollection
 | Warehouse Management
 | Order is ready to be collected by end customer

 | branchAssigned
 | Warehouse Management
 | Order is assigned to branch

 | assignedToWarehouse
 | Warehouse Management
 | Order is assigned to warehouse

 | shipmentOnHoldWarehouse
 | Warehouse Management
 | Shipment is on hold by warehouse

 | shipmentOnHoldToCancel
 | Warehouse Management
 | Shipment is on hold by warehouse

 | notAvailableBR
 | Warehouse Management
 | Order is not available in the assigned branch

 | notAvailableWH
 | Warehouse Management
 | Order is not available in the assigned warehouse

 | picked
 | Warehouse Management
 | Order items picked by picker

 | packed
 | Warehouse Management
 | Order items packed by packer

 | searchingDriver
 | Creation
 | Shipment created and waiting for delivery company to a

## OTO guide ·  · Error Codes
HTTP Status Codes

 | 

 | Error Code
 | Error Description

 | 200
 | SUCCESS

 | 400
 | BAD REQUEST

 | 403
 | FORBIDDEN

 | 404
 | NOT FOUND

 | 409
 | CONFLICT

 | 500
 | INTERNAL_SERVER_ERROR

OTO Error Codes

Error codes and messages are returned as otoErrorCode and otoErrorMessage responses.

 | 

 | OTO Error Code
 | OTO Error Description

 | OTO1001
 | Invalid or missing order Id

 | OTO1002
 | The order ID does not exist

 | OTO1004
 | There is no available delivery company setting

 | OTO1006
 | Credit is not enough

 | OTO1009
 | Something went wrong

 | OTO1010
 | Check the missing details

 | OTO1011
 | Shipment is already exist

 | OTO1015
 | Database Error

 | OTO1016
 | Sender details are missing or invalid

 | OTO1021
 | Recipient address is missing or invalid

 | OTO1022
 | Recipient city is missing or invalid

 | OTO1024
 | Recipient country is missing or invalid

 | OTO1029
 | Recipient name is missing or invalid

 | OTO1030
 | Recipient phone is missing or invalid

 | OTO1049
 | Weight is missing or invalid

 | OTO1063
 | Order Id is already exist

 | OTO1067
 | Order Status is not allowed for update

 | OTO1070
 | Pickup location code or name is missing, invalid or not unique

 | OTO1071
 | Item has pickupLocation array for split order process but the input is invalid in the array.

 | OTO1072
 | This orderId is used on another split item before.

 | OTO1073
 | Box name is missing or invalid

 | OTO1074
 | Invalid items

 | OTO1075
 | Invalid Json format

 | OTO1077
 | Error occurred while generating zpl data

 | OTO1079
 | Shipment id is required

 | OTO1080
 | This account is not authorized for the use this service

 | OTO1081
 | a system error occured

 | OTO1082
 | Order Status is not allowed for cancel shipment

 | OTO1083
 | Refresh Token is required

 | OTO1084
 | Login is required

 | OTO1085
 | Email is missing or invalid

 | OTO1086
 | User does not exist

 | OTO1087
 | Country is missing or invalid

 | OTO1088
 | This action is not allowed for this token

 | OTO1089
 | Company already exists

 | OTO1090
 | Unknown integration

 | OTO1091
 | Sales channel registration error

 | OTO1092
 | Company registration error

 | OTO1093
 | 

## OTO POST /rest/v2/refreshToken — Refresh Token
Folder: Authorization. Docs anchor: https://apis.tryoto.com/#da086827-8b22-457c-997e-b8aad8732030
This API endpoint is used to obtain a new access_token by providing a valid refresh_token. The access_token is a temporary token with a lifespan of one hour, used to authenticate and authorize all subsequent API requests.

Include the access_token in the request headers as:
Authorization: Bearer access_token

To adhere to security standards, it is recommended to renew the access_token periodically (every hour) to maintain uninterrupted access to the API while minimizing security risks. This endpoint ensures seamless and secure token management for applications relying on API interactions.

Request Parameters:

 | 

 | Name
 | Required
 | Type
 | Description

 | refresh_token
 | yes
 | string
 | refresh_token can obtain token from the UI, this is permanent token, use only to get access_token
Request example:
{
    "refresh_token":"refresh_token"}
Response OK example:
{
    "access_token": "ey***************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************

## OTO GET /rest/v2/healthCheck — Health Check
Folder: Authorization. Docs anchor: https://apis.tryoto.com/#811007ad-d997-4486-8968-0c59993856c7
This API endpoint is used to check if the system is working properly
Response OK example:
{
    "status": "ok"
}

## OTO GET /rest/v2/accountInfo — Account Info
Folder: Account. Docs anchor: https://apis.tryoto.com/#23d18202-c681-4404-99ce-188cf0c0e8d3
This API endpoint retrieves detailed information about the authenticated user's account. This includes general profile details, current subscription and balance of the account.

Note: You can only see the account information that your token belongs to.

Response Body:

name: full name of the account owner

email: email address belong to the account

mobileNumber: mobile number belong to the account

packageName: current subscription package name( scalePackage, enterprisePackage etc.)

remainingCredit: balance in account

remainingFreeShipments: number of free shipments offered in campaigns

freelanceDocStatus: Represents the verification status of freelancer documents

CRDocStatus: Indicates the current status of the Commercial Registration document(VERIFIED, INDIVIDUAL)

accountType: Represents the user's account type within the system (personal etc.)
Response  example:
{
    "remainingCredit": 1578.46,
    "remainingFreeShipments": "0",
    "mobileNumber": "9664564845222",
    "accountType": "personal",
    "CRDocStatus": "NOT_UPLOADED",
    "name": "testUserEnterprise",
    "packageName": "EnterprisePackage",
    "email": "testEmail_enterprise@tryoto.com",
    "freelanceDocStatus": "INDIVIDUAL"
}

## OTO POST /rest/v2/buyCredit — Buy Credit
Folder: Account. Docs anchor: https://apis.tryoto.com/#84addb64-05c9-47a4-89ad-b3dac7a55fd8
Provide amount of credit you wanted to buy, this will response a paymentURL and paymentID.

Request Parameters:

 | 

 | Name
 | Required
 | Type
 | Description

 | amount
 | yes
 | number
 | the amount of credit wanted to buy
Request example:
{
    "amount": 13.50
}
Response  example:
{
    "success": true,
    "paymentID": "chg_LV03G2920250933Jk9c2603152",
    "paymentURL": "https://checkout.tap.company/?mode=page&themeMode=&language=en&token=eyJhbGciOiJIUzI1NiJ9.eyJpZCI6IjY3ZTM5ZmI5OGE3Y2NkMWQwZGE1NzlhMSJ9.71AJo8AcbO96of1mbvGLZR7x2cnrcquiwJii0zOGLmE"
}

## OTO POST /rest/v2/requestMobileVerification — Request Mobile Verification
Folder: Account. Docs anchor: https://apis.tryoto.com/#218f07f6-52ba-46df-be23-54e17de62099
This API endpoint allows you to use a phone number to request a verification token (OTP) for account/phone number verification. Marketplaces can also use this endpoint to verify their sellers’ phone numbers.

Verification can be done in verifyMobileNumber.

Request Parameters:

 | 

 | Name
 | Required
 | Type
 | Description

 | phone
 | yes
 | string
 | Phone number to be verified

Response body includes success, errorMsg, otoErrorCode, otoErrorMessage when success is false.
Request example:
{
  "phone": "+905365042516"
}
Response  example:
{
    "success": true,
    "token": "fa4f8d03-451c-44f7-9262-10fe193e854d"
}

## OTO POST /rest/v2/verifyMobileNumber — Verify Mobile Number
Folder: Account. Docs anchor: https://apis.tryoto.com/#e5e3c056-5919-4abf-b5be-49e1048a0cdc
This API endpoint verifies a user’s mobile phone number by confirming the one-time password (OTP) sent via SMS. The endpoint requires the phone number, the OTP received, and the token obtained from the requestMobileVerification step. Once successfully verified, the phone number is confirmed for account or seller verification purposes.

Request Parameters:

 | 

 | Name
 | Required
 | Type
 | Description

 | phone
 | yes
 | string
 | The phone number to verify (same as in step 1, in E.164 format).

 | code
 | yes
 | string
 | The OTP received via SMS.

 | token
 | yes
 | string
 | The token returned from the requestMobileVerification response.
Request example:
{
    "phone": "+905365042516",
    "code": "4739",
    "token": "fa4f8d03-451c-44f7-9262-10fe193e854d"
}
Response  example:
{
    "success": true
}

## OTO POST /rest/v2/getShippingPriceTransactionsList — Get Shipping Price Transactions List
Folder: Transactions. Docs anchor: https://apis.tryoto.com/#ccf593c8-a972-4ebe-8d8c-0576cf0f00c4
This API endpoint provides details of your Shipping Price Transactions, calculated based on your configured shipping price settings. By providing either the Order ID or Shipment ID, you can retrieve the shipping cost along with other transactional details.

Important Note:
The results from this API apply only to shipments created using your configured shipping price contracts. Shipping costs are calculated based on factors such as weight, destination, and other predefined configurations.

Request Parameters:

 | 

 | Name
 | Required
 | Type
 | Description

 | orderId
 | yes
 | string
 | Id of the order.

 | shipmentId
 | yes
 | string
 | The shipment ID to retrieve shipping cost details.
Request example:
{
    "shipmentId": "2302416029",
    "orderId": "OID-22700-1013"
}
Response OK example:
{
    "success": true,
    "count": 1,
    "shippingTransactions": [
        {
            "amount": 11,
            "orderID": "OID-9618-1062",
            "shipmentID": "290615409716",
            "description": "shipment created",
            "orderStatus": "shipmentCreated",
            "ID": 1347,
            "transactionDate": "2023-12-06T16:18",
            "otoOrderID": 30798075,
            "deliveryName": "smsav2-2",
            "transaction": "shippingCost",
            "status": "booked"
        }
    ]
}

## OTO GET /rest/v2/creditTransactions — Credit Transactions
Folder: Transactions. Docs anchor: https://apis.tryoto.com/#8e1ce29b-9483-4e2d-adec-e9650ec81f27
This API endpoint provides a powerful way to retrieve credit transaction records from your system. This endpoint supports pagination for efficient data retrieval and allows filtering based on minimum and maximum dates. Additionally, if an orderId is provided, the maxDate and minDate parameters become optional, enabling direct access to transactions associated with the specified order.

Request Parameters:

 | 

 | Name
 | Required
 | Type
 | Description

 | perPage
 | yes
 | number
 | Credit transaction count in the response. Max limit 100

 | page
 | yes
 | number
 | Pagination number. You can iterate this field to get all items.

 | minDate
 | yes (If there is no orderId)
 | date
 | Starting "Transaction Date" of your credit transactions in "yyyy-mm-dd" format.

 | maxDate
 | yes (If there is no orderId)
 | date
 | Ending "Transaction Date" of your credit transactions in "yyyy-mm-dd" format.

 | orderId
 | no
 | string
 | Order ID for transactions of a single Order

Response Body

The response will include a success flag indicating the status of the request, and an orders array containing transaction details. Each transaction object in the orders array includes the following properties:

transactionType (string) - Type of the transaction.

remainingAmount (number) - The remaining amount for the transaction.

amount (number) - The transaction amount.

deliveryCompanyName (string) - Name of the delivery company.

orderID (string) - ID of the order.

shipmentID (string) - ID of the shipment.

description (string) - Description of the transaction.

ID (number) - Unique ID of the transaction.

transactionDate (string) - Date of the transaction.

otoOrderID (number) - OTO (One-Time-Only) order ID.

orderPaymentType (string) - Payment type for the order.

status (string) - S
Response OK example:
{
    "success": true,
    "transactions": [
         {
            "amount": 19,
            "orderID": "41590739",
            "deliveryCompanySettingsId": 5564,
            "description": "Shipment canceled. Delivery fees will be credited back to your account.",
            "transactionDate": "2024-09-16T11:26:01",
            "orderPaymentType": "cod",
            "shipmentType": "forward",
            "transactionType": "dcFee",
            "remainingAmount": 85.9,
            "deliveryCompanyName": "Deliver Now",
            "chargingType": "charge",
            "langKey": "dcFeeShipmentCanceledRevokedDescription",
            "shipmentID": "DNL05000049328",
            "ID": 8294185,


## OTO GET /rest/v2/shipmentTransactions — Shipment Transactions
Folder: Transactions. Docs anchor: https://apis.tryoto.com/#274a57b9-2229-450d-b1ec-685242db7410
Shipment Transactions

This API endpoint provides users with access to detailed information about shipment transactions. This API is designed to retrieve and display key transaction data, allowing users to monitor and review shipment-related activities.It retrieves shipment transactions with the option to paginate and filter by minimum and maximum dates.

Note:

If orderId exists maxDate and minDate are not required.

If shipment number exists maxDate and minDate are not required.

Request Parameters:

 | 

 | Name
 | Required
 | Type
 | Description

 | perPage
 | no
 | number
 | The number of transactions to be included per page.

 | page
 | no
 | number
 | The page number for paginated results.

 | minDate
 | yes (If there is no orderId and shipmentNumber)
 | date
 | Starting "Transaction Date" of your credit transactions in "yyyy-mm-dd" format.

 | maxDate
 | yes (If there is no orderId and shipmentNumber)
 | date
 | Ending "Transaction Date" of your credit transactions in "yyyy-mm-dd" format.

 | orderId
 | no
 | string
 | Order ID for transactions of a single Order

 | shipmentNumber
 | no
 | string
 | Shipment Number for transactions of a single shipment

Response Body

The response will include a success flag indicating the status of the request, and an shipments array containing transaction details. Each transaction object in the shipments array includes the following properties:

{
  "success": true,
  "shipments": [
    {
      "shipmentNumnber": "1231231AS",
      "orderId": "123123",
      "shipmentCreationDate": "2023-12-05T06:47:46",
      "deliveryCompanyName": "deliveryCompany",
      "dcConnectionName": "connectionName",
      "shipmentType": "Forward Shipment",
      "dcCharge": 25,
      "currency": "TRY",
      "originalWeight": 100,
      "dcUpdated
Response OK example:
{
    "success": true,
    "shipments": [
        {
            "shipmentNumber": "1231231AS", 
            "orderId": "123123", 
            "shipmentCreationDate": "2023-12-05T06:47:46",
            "deliveryCompanyName": "deliveryCompany",
            "dcConnectionName": "connectionName",
            "shipmentType": "Forward Shipment",
            "dcCharge": 25,
            "currency": "TRY",
            "originalWeight": 100,
            "dcUpdatedWeight": 50,
            "status": "status",
            "dcInvoiceNumber": 15579456
        },
        {
            "shipmentNumber": "12435356",
            "orderId": "342324234",
            "shipmentCreationDate": "2023-12-05T06:47:46",


## OTO POST /rest/v2/register — Register
Folder: Marketplace. Docs anchor: https://apis.tryoto.com/#903880b0-2d78-40fc-87d9-d36072bac879
This API endpoint is just for marketplaces with multiple vendors. Marketplaces can register their vendors to OTO with this endpoint. It requires a special kind of token provided by OTO. Regular refresh tokens will not work here.

If you are a market place you can use register endpoint to create an OTO account for your vendors.

Request Parameters:

 | 

 | Field Name
 | Type
 | Required
 | Description

 | country
 | string
 | Yes
 | Country tag (e.g., “TR”, “SA”).

 | city
 | string
 | Yes
 | City tag (must match OTO city tags).

 | companyName
 | string
 | Yes*
 | Required if isVatRegistered is true.

 | email
 | string
 | Yes
 | User’s email address.

 | mobileNumber
 | string
 | Yes
 | User’s mobile number (validated per country).

 | firstName
 | string
 | Yes
 | User’s first name (max 30 chars).

 | lastName
 | string
 | Yes
 | User’s last name (max 30 chars).

 | isVatRegistered
 | boolean
 | Yes
 | Whether the company is VAT registered.

 | billingAddress
 | string
 | Yes
 | Billing address.

 | vatNumber
 | string
 | Conditional
 | Required if isVatRegistered is true. Format depends on country.

 | CRNumber
 | string
 | Conditional
 | Required for SA if isVatRegistered is true (10 digits).

 | district
 | string
 | Conditional
 | Required if isVatRegistered is true.

 | zipCode
 | string
 | Conditional
 | Required for SA (5 digits) and other countries if VAT registered.

 | buildingNo
 | string
 | Conditional
 | Required for SA (4 digits) and other countries if VAT registered.

 | streetName
 | string
 | Conditional
 | Required if isVatRegistered is true.

 | shortCode
 | string
 | No
 | Optional short code.

 | secondaryNumber
 | string
 | No
 | Optional (SA: 4 digits if present).

 | nationalID
 | string
 | Conditional
 | Required for TR (11 digits).

 | taxOf
Request example:
{
    "mobileNumber":"966559665498",
    "fullName":"test vendor",
    "email":"test987654@example.com",
    "companyName":"test company 987654"}
Response OK example:
{
    "success": true,
    "activationLink": "https://login.tryoto.com/XYZ",
    "refreshToken": "_refreshToken_"
}

## OTO POST /rest/v2/clientInfo — Client Info
Folder: Marketplace. Docs anchor: https://apis.tryoto.com/#0f182d7a-89f3-4fec-81df-73461ad29b7d
This API endpoint is just for marketplaces. Marketplaces can register their vendors to OTO with a special kind of token provided by OTO. Regular refresh tokens will not work here.

If you are a marketplace and used register endpoint to create an OTO account for your vendors , you can get the information about the client you have registered.

Request Parameters:

 | 

 | Name
 | Required
 | Type
 | Description

 | email
 | yes
 | string
 | registered email of client
Request example:
{
    "email":"test30@tryoto.com"
}
Response OK example:
{
    "userActivated": "false",
    "remainingCredit": 0,
    "validityDate": "13-October-2028",
    "success": true,
    "refreshToken": "_refreshToken_"
}

## OTO GET /rest/v2/clientInfo — Client Info
Folder: Marketplace. Docs anchor: https://apis.tryoto.com/#54e67ae4-e992-4d75-8117-524564ed4006
This API endpoint provides detailed information about a vendor's account and its current status. This endpoint returns essential client-related data, including contact details, account balances, and service validity, enabling seamless integration for managing and monitoring client activities.

Request Parameters:

No request body parameters are required for this GET request.

Response:

{
    "remainingCredit": 10,
    "phone": "+966567130000",
    "validityDate": "11-01-2028",
    "success": true,
    "name": "test Company",
    "email": "test@example.com"
}
Response OK example:
{
    "remainingCredit": 10,
    "phone": "+966567130000",
    "validityDate": "11-01-2028",
    "success": true,
    "name": "test Company",
    "email": "test@example.com",
    "refreshToken": "_refreshToken_"
}

## OTO POST /rest/v2/createOrder — Create Order
Folder: Orders. Docs anchor: https://apis.tryoto.com/#1ef36925-012f-4572-8555-7a83283d0b09
This API endpoint is a critical component in e-commerce and logistics systems, enabling external applications to initiate and manage new orders seamlessly. This endpoint allows you to submit order details, such as customer information, product data, shipping preferences, and payment methods.

For KSA Shipments:

If you are providing the sender and receiver short address codes, there is no need to include the city and address information.

Note: If you send the createShipment: true parameter and the delivery company returns an error during shipment creation, you must register the shipmentError webhook in order to receive and view the error details.

For more information, please refer to the Webhook section in the documentation.

Request Parameters:

 | 

 | Parameter
 | Required
 | Type
 | Description

 | orderId
 | yes
 | string
 | Unique identifier of the Order

 | createShipment
 | no
 | boolean
 | If true, shipment is created automatically.

 | forReverseShipment
 | no
 | boolean
 | Creates reverse shipment without forward shipment.

 | deliveryOptionId
 | no
 | string
 | Specifies the delivery option to be used for the shipment.

 | customer
 | yes
 | object
 | Customer Data( can not be used together with destinationLocationCode.)

 | senderInformation
 | yes
 | object
 | Sender data (can not be used together with pickupLocationCode.)

 | destinationLocationCode
 | conditional
 | string
 | Used for B2B orders such as branch-to-branch or warehouse transfers. Provide warehouse or branch code.

 | pickupLocationCode
 | conditional
 | string
 | Predefined pickup address of store/warehouse. If not exist, OTO assigns automatically.

 | items
 | yes (if there is no item_description)
 | array
 | Items data

 | item_description
 | yes( if there is no items array)
 | string
 
Request example:
{
    "orderId": "1234",    
    "pickupLocationCode": "jdd_wh",
    "createShipment": "true",
    "deliveryOptionId": 564,
    "payment_method": "paid",
    "amount": 100,
    "amount_due": 0,
    "currency": "SAR",
    "customsValue":"12",
    "customsCurrency":"USD",
    "packageCount": 2,
    "packageWeight": 1,
    "boxWidth": 10,
    "boxLength": 10,
    "boxHeight": 10,
    "orderDate": "31/12/2022 15:45",
    "deliverySlotDate": "31/12/2020",
    "deliverySlotTo": "12pm",
    "deliverySlotFrom": "2:30pm",
    "senderName":"Sender Company",
    "customer": {
        "name": "عبدالله الغامدي",
        "email": "test@test.com",
        "mobile": "546607389",
        "address": "6832, Abruq AR Rughamah District, Jeddah 22272 3330, Saudi Arabia",
        "district": "Al Hamra",
        "city": "Jeddah",
        "country": "SA",
        "postcode": "12345",
        "lat": "40.706333",

Response OK example:
{
    "success": true,
    "otoId": 540789
}

## OTO POST /rest/v2/updateOrder — Update Order
Folder: Orders. Docs anchor: https://apis.tryoto.com/#6b210bf6-8651-4f3f-95f3-7528b153df20
This API endpoint allows you update order info with this endpoint before shipment creation. If you created a shipment and need to update an information after that you have to cancel the shipment first then you can update.

Request Parameters:

 | 

 | Parameter
 | Required
 | Type
 | Description

 | orderId
 | yes
 | string
 | Unique identifier of the Order

 | deliveryOptionId
 | no
 | string
 | Specifies the delivery option to be used for the shipment.

 | customer
 | yes
 | object
 | Customer Data( can not be used together with destinationLocationCode.)

 | senderInformation
 | yes
 | object
 | Sender data (can not be used together with pickupLocationCode.)

 | destinationLocationCode
 | conditional
 | string
 | Used for B2B orders such as branch-to-branch or warehouse transfers. Provide warehouse or branch code.

 | pickupLocationCode
 | conditional
 | string
 | Predefined pickup address of store/warehouse. If not exist, OTO assigns automatically.

 | items
 | yes (if there is no item_description)
 | array
 | Items data

 | amount
 | yes
 | double
 | Total value amount of the order

 | amount_due
 | yes
 | double
 | Total due amount of the order. If order paid amount_due will be 0, otherwise equal to amount

 | currency
 | yes
 | string
 | Currency code of the order currency

 | orderDate
 | no
 | datetime
 | Date of the order

 | parentOrderId
 | no
 | string
 | Parent id of split orders

 | entityId
 | no
 | number
 | Identifier of the entity (e.g. sales channels) linked to the order

 | brandId
 | no
 | long
 | Brand (Client Store) ID

 | sourceId
 | no
 | string
 | Sales channel credentials ID identifying the order source

 | ref1
 | no
 | string
 | Reference for order

 | ref2
 | no
 | string
 | Reference for order

 | ref3
 | no
 | string
 | Reference for orde
Request example:
{
    "orderId": "202111081227",
    "ref1": "1234ABCDE",
    "pickupLocationCode": "12364",
    "deliveryOptionId": "12364",
    "storeName": "Brand A English",
    "payment_method": "paid",
    "amount": 100,
    "amount_due": 0,
    "shippingAmount":20,
    "subtotal":100,
    "currency": "SAR",
    "customsValue":"12",
    "customsCurrency":"USD",
    "shippingNotes": "be careful. it is fragile",
    "packageSize": "small",
    "packageCount": 2,
    "packageWeight": 1,
    "boxWidth": 10,
    "boxLength": 10,
    "boxHeight": 10,
    "orderDate": "30/12/2022 15:45",
    "deliverySlotDate": "31/12/2022",
    "deliverySlotTo": "12pm",
    "deliverySlotFrom": "2:30pm",
    "customer": {
        "name": "عبدالله الغامدي",
        "email": "test@test.com",
        "mobile": "546607389",
        "address": "6832, Abruq AR Rughamah District, Jeddah 22272 3330, Saudi Arabia",
        "distr
Response OK example:

{
    "success":true,
	"message": "Successfully updated"
}

## OTO POST /rest/v2/updateOrderStatus — Update Order Status
Folder: Orders. Docs anchor: https://apis.tryoto.com/#ba49080b-8881-4da1-9a34-3a9dae839f60
This API endpoint allows you to modify the current status of an order within the system.
You can update the order status to "delivered," "returned," if the order does not have an associated shipment. For "picked up" there should be an associated shipment. However, if a shipment exists, only statuses for integrator-managed shipments can be updated.

Request Parameters:

 | 

 | Name
 | Required
 | Type
 | Description

 | orderIds
 | yes
 | string
 | Id of the order/s

 | status
 | yes
 | string
 | status of the shipment(delivered, returned, pickedUp)

 | description
 | no
 | string
 | description of the status change

 | date
 | no
 | date
 | the delivery date of the order( ex: 2024-08-06T21:00:00.000Z)
Request example:
{
    "orderIds": [
        30846946
    ],
    "status": "delivered",
    "date": "2024-08-06T21:00:00.000Z",
    "description": "aaaaaa"
}
Response OK example:
{
    "result": [
        {},
        {
            "success": true,
            "orderIds": [
                "30846946"
            ]
        }
    ]
}

## OTO POST /rest/v2/cancelOrder — Cancel Order
Folder: Orders. Docs anchor: https://apis.tryoto.com/#949199e8-41cc-4f5b-b1b9-83280d39ed9d
This API endpoint allows users to cancel an existing order under specific conditions. It ensures smooth and efficient handling of cancellations while maintaining the integrity of related processes.

Important Note: If the order has an associated shipment, it cannot be canceled via this endpoint. Shipment-related restrictions ensure the system prevents conflicts or inconsistencies in ongoing fulfillment processes.

Request Parameters:

 | 

 | Name
 | Required
 | Type
 | Description

 | orderId
 | yes(if there is no otoId)
 | string
 | The orderId for the order to be canceled.

 | otoId
 | yes(if there is no orderId)
 | string
 | The otoId for the order to be canceled.
Request example:
{
    "orderId": "1234"
}
Response OK example:
{
    "success": true
}

## OTO GET /rest/v2/orders — Get Orders
Folder: Orders. Docs anchor: https://apis.tryoto.com/#c2e94027-5214-456d-b653-0a66c038e3a4
This API endpoint is designed to provide a comprehensive overview of orders in your system. This endpoint returns detailed information about each order, including pickup locations, order IDs, item details, and current statuses. It enables seamless tracking and management of orders, ensuring better visibility and control.

Request Parameters:

 | 

 | Name
 | Required
 | Type
 | Description

 | perPage
 | no
 | number
 | Order count in the response. Max limit 100

 | page
 | no
 | number
 | Pagination number. You can iterate this field to get all items.

 | minDate
 | no
 | date
 | Starting "Order Creation Date" of your orders in "yyyy-mm-dd" format.

 | maxDate
 | no
 | date
 | Ending "Order Creation Date" of your orders in "yyyy-mm-dd" format.

 | modifiedDate
 | no
 | date
 | The date and time when the order was last updated.

 | status
 | no
 | string
 | Status of the orders.

 | customerPhone
 | no
 | string
 | Customer’s contact phone number.
Response OK example:
{
    "perPage": 5,
    "totalPage": 1,
    "success": true,
    "orders": [
        {
            "skus": "",
            "orderId": "OID-2476-70000203527-1",
            "trackingURL": "",
            "reverseShipment": "false",
            "totalDue": 0,
            "quantities": "",
            "subTotal": 0,
            "totalCount": 2,
            "addressConfirm": "notYet",
            "customerPhone": "4563731231",
            "drivingDistance": 0,
            "originCity": "Al Kharj",
            "currency": "SAR",
            "modifiedBy": "Demo Niceone",
            "customerReturnReason": "test",
            "id": "30824696",
            "deliveryDate": "2024-02-28 14:44:30",
   

## OTO POST /rest/v2/holdOrder — Hold Order
Folder: Orders. Docs anchor: https://apis.tryoto.com/#607357c6-e58d-4923-9fc4-a7bb1e716a92
This API endpoint allows you to place an order on hold, temporarily pausing its processing. This is useful for scenarios such as payment verification, inventory issues, or customer requests.

Request Parameters:

 | 

 | Name
 | Required
 | Type
 | Description

 | orderId
 | yes
 | string
 | Id of the order that you will place on hold.

 | onHoldReason
 | yes
 | string
 | Reason for being an order on hold.

 | onHoldReasonLang
 | yes
 | string
 | Values can be: eng, tr, ar.

 | onHoldComment
 | no
 | string
 | Reason or note explaining why the order is placed on hold.
Request example:
{
    "orderId": "OID-20980-1146",
    "onHoldReason": "Fraud",
    "onHoldReasonLang" : "en"
}
Response OK example:
{
    "success": true
}

## OTO POST /rest/v2/unHoldOrder — Unhold Order
Folder: Orders. Docs anchor: https://apis.tryoto.com/#74ad2aaa-809e-4234-8be0-25f01aadd0dc
This API endpoint allows users to release orders that are currently on hold. This endpoint is designed to resume the processing of held orders, making them available for fulfillment or further actions in the order management workflow.

Request Parameters:

 | 

 | Name
 | Required
 | Type
 | Description

 | orderId
 | yes
 | string
 | The orderId you want to unhold.
Request example:
{
    "orderId": "OID-9616-98794"
}
Response OK example:
{
    "success": true
}

## OTO GET /rest/v2/orderDetails — Get Order Details
Folder: Orders. Docs anchor: https://apis.tryoto.com/#ba9979b7-df72-4840-8a9c-549baac1e94f
This API endpoint provides detailed information about a specific order. By using this endpoint, you can retrieve comprehensive data about an order including status updates.

Request Parameters:

 | 

 | Name
 | Required
 | Type
 | Description

 | orderId
 | yes(if there is no otoId or ref1)
 | string
 | Id of the Order.

 | otoId
 | yes(if there is no orderId or ref1)
 | string
 | A unique id of the order generated by OTO.

 | ref1
 | yes(if there is no orderId or otoId)
 | string
 | ref1 provided while create order.
Response OK example:
{
    "orderId": "OID-50919-4346-C-C",
    "trackingURL": "https://qa.tryoto.com/otoflex-tracking?enc=dXpMZTVNZCtMQStiOENERS83aVBYdHkwMFVPUDNnT21rM3VFbzRZbVREUGpRb3JZVXdpU1B3PT0=",
    "packageWeight": 1,
    "orderDocs": [],
    "dcName": "OTO Flex",
    "originCity": "Madinah",
    "currency": "SAR",
    "id": 31078194,
    "amount": 215,
    "customsValue": 215,
    "pickupLocation": "WH - Madinah",
    "deliveryOptionId": 55266,
    "destinationCity": "Madinah",
    "amountDue": 0,
    "statusHistory": [
        {
            "date": "2026-02-18T12:15:31",
            "description": "Created by m.pisgin enter",
            "id": 55113452,
            "status": "new"
        },
        {


## OTO POST /rest/v2/checkOrderAvailability — Check Order Availability
Folder: Orders. Docs anchor: https://apis.tryoto.com/#5fbc10cf-e360-4d8f-88b5-60dd3f467cbd
Check Order Availability

This API endpoint allows you to check the availability of an order based on the provided orderId and associated ruleIds.

Request Parameters

Existing Order (with OrderID)

The user provides an orderId (increment ID) that is already created in OTO.

The system checks the availability of the order and returns the list of locations where it can be fulfilled.

By default, the API considers all OMS rules while checking availability.

Optionally, the user can provide specific OMS ruleIds, and the system will use these rules instead of the default set.

Draft Order (without OrderID)

The user provides all required order and customer details for an order that has not yet been created in OTO.

The system checks the availability based on the provided information and returns the list of locations where the order can be fulfilled.

By default, the API considers all OMS rules while checking availability.

Optionally, the user can provide specific OMS ruleIds, and the system will use these rules instead of the default set.

 | 

 | Name
 | Required
 | Type
 | Description

 | orderId
 | yes(if there is no order and customer object)
 | string
 | The unique ID of the order.

 | order
 | yes(if there is no orderId)
 | json object
 | Object containing the details of the order.

 | customer
 | (yes if there is no orderId)
 | json object
 | Object containing the customer's details.

 | ruleIds
 | no
 | array
 | List of rule identifiers.

Order Object

 | 

 | Name
 | Required
 | Type
 | Description

 | storeName
 | no
 | string
 | Store name associated with the order.

 | packageWeight
 | no
 | double
 | The total weight of the package.

 | packageCount
 | no
 | int
 | Total number of packages.

 | paymentMethod
 | no
 | string
 | Payment method selected for the o
Request example:
{
    "orderId": "extra-test-10",
    "ruleIds": [
    "b781d9e6-36da-4cd1-bf7d-f8604561ca6a" 
     ]
}
Response OK example:
{
    "success": true,
    "locations": [
        {
            "locationName": "Home - John Doe",
            "distance": 2510.18,
            "locationCoordinates": {
                "lon": 46.70160836,
                "lat": 24.7310685
            },
            "locationCode": "123452"
        }
    ],
    "orderAvailability": "Yes"
}

## OTO POST /rest/v2/checkOTODeliveryFee — Check OTO Delivery Fee
Folder: Shipping Prices. Docs anchor: https://apis.tryoto.com/#bfd1a95c-af05-422d-8bd7-82f27d8b62db
This API endpoint calculates shipping prices offered by OTO rates. By providing the origin city, destination city, and package details (such as weight and dimensions), the API computes the price based on the provided request parameters.

Important Note:

The prices returned by this API are applicable only to shipping options available under OTO's contracts.

To calculate prices for your own custom contracts, please use the Check Delivery Fee API.

You can see the shipping prices of delivery companies regarding to your account's country information.

Pricing Calculation Details:

The price is determined based on the greater value between the actual weight and the volumetric weight of the package.

Be sure to include the larger of these two values in your request.

Request Parameters:

 | 

 | Name
 | Required
 | Type
 | Description

 | originCity
 | yes
 | string
 | pickup city

 | destinationCity
 | yes
 | string
 | destination city

 | originLat
 | no
 | number
 | reqired for bullet type

 | originLon
 | no
 | number
 | reqired for bullet type

 | destinationLat
 | no
 | number
 | reqired for bullet type

 | destinationLon
 | no
 | number
 | reqired for bullet type

 | weight*
 | yes
 | number
 | approximate weight of package(kg)

 | forReverseShipment
 | no
 | boolean
 | When you set is true, it will list the delivery companies that you can create reverse shipments.

 | currency
 | no
 | string
 | ISO 4217 code, "SAR","KWD", etc

 | packageCount
 | no
 | number
 | 1

 | totalDue
 | no
 | number
 | cash on delivery amount

 | length
 | no
 | number
 | length of the package(cm)

 | width
 | no
 | number
 | width of the package(cm)

 | height
 | no
 | number
 | height of the package(cm)

 | serviceType
 | no
 | enum
 | express,sameDay, fastDelivery, coldDelivery,heavyAnd
Request example:
{
    "weight":"3",
    "originCity":"Riyadh",
    "destinationCity":"Jeddah",
    "height":30,
    "width":30,
    "length":30
}
Response OK example:
{
    "traceId": "63545-73855-176.88.141.22-c4270220-89f8-4fe4-a645-2f82fb5c499d",
    "success": true,
    "deliveryCompany": [
        {
            "serviceType": "sameDay",
            "deliveryOptionName": "Deliver Now",
            "trackingType": "excellent",
            "score5": 4.9,
            "deliveryType": "toCustomerDoorstep",
            "codCharge": 3,
            "pickupCutOffTime": "12:00",
            "maxOrderValue": 5000,
            "maxCODValue": 3000,
            "deliveryOptionId": 7109,
            "extraWeightPerKg": 1,
            "estimatedDeliveryDate": "2025-11-17",
            "deliveryCompanyName": "delivernow",
            "estimatedPickupDate": "2025-11-17

## OTO POST /rest/v2/checkDeliveryFee — Check Delivery Fee
Folder: Shipping Prices. Docs anchor: https://apis.tryoto.com/#31fd30ad-75dd-4a2d-9485-0f5fa8273a20
This API endpoint calculates contract-based shipping prices using your own rates. By providing the origin city, destination city, and package details (such as weight and dimensions), the API computes the price based on the provided request parameters.

Important Note:

The prices returned by this API are applicable only to your own contracts.

To calculate prices for shipping options available under OTO's contracts, please use the checkOTODeliveryFee API.

Pricing Calculation Details:

The price is determined based on the greater value between the actual weight and the volumetric weight of the package.

Be sure to include the larger of these two values in your request.

Request Parameters:

 | 

 | Name
 | Required
 | Type
 | Description

 | originCity
 | yes
 | string
 | pickup city

 | destinationCity
 | yes
 | string
 | destination city

 | weight
 | yes
 | number
 | approximate weight of package(kg)

 | totalDue
 | no
 | number
 | cash on delivery amount

 | deliveryType
 | no
 | enum
 | bullet,courier

 | originLat
 | no
 | string
 | reqired for bullet type

 | originLon
 | no
 | string
 | reqired for bullet type

 | destinationLat
 | no
 | string
 | reqired for bullet type

 | destinationLon
 | no
 | string
 | reqired for bullet type

 | forReverseShipment
 | no
 | boolean
 | when you set this to true, it will list the delivery companies that you can create reverse shipments

 | includeEstimatedDates
 | no
 | boolean
 | If you set this parameter to true, the response will include the estimated pickup and delivery dates, generated using our AI-powered prediction model.
Request example:
{
    "weight":"50",
    "totalDue":10,
    "originCity":"Riyadh",
    "destinationCity":"Jeddah",
    "height":170,
    "width":50,
    "length":50
}
Response OK example:
{
    "traceId": "63545-73855-176.88.141.22-c4270220-89f8-4fe4-a645-2f82fb5c499d",
    "success": true,
    "deliveryCompany": [
        {
            "serviceType": "sameDay",
            "deliveryOptionName": "Deliver Now",
            "trackingType": "excellent",
            "score5": 4.9,
            "deliveryType": "toCustomerDoorstep",
            "codCharge": 3,
            "pickupCutOffTime": "12:00",
            "maxOrderValue": 5000,
            "maxCODValue": 3000,
            "deliveryOptionId": 7109,
            "extraWeightPerKg": 1,
            "estimatedDeliveryDate": "2025-11-17",
            "deliveryCompanyName": "delivernow",
            "estimatedPickupDate": "2025-11-17

## OTO POST /rest/v2/getDeliveryFee — Get Delivery Fee
Folder: Shipping Prices. Docs anchor: https://apis.tryoto.com/#fdda5b32-678f-4361-9857-16cd007aa549
This API endpoint calculates the shipping fee for a specific order in OTO. It offers two methods for price calculation:

By Order ID: Provide the orderId, and the API will return all possible shipping rates for each defined shipping company.

By Delivery Option ID: Provide the deliveryOptionId to calculate the shipping fee for a specific shipping company. You can get this information from checkOTODeliveryFee or from checkDeliveryFee endpoints.

Request Parameters:

 | 

 | Name
 | Required
 | Type
 | Description

 | orderId
 | yes
 | string
 | Id of the order

 | deliveryCompanySettingsId
 | no
 | string
 | Delivery Company settings id
Request example:
{
    "orderId": "OID-22700-1006"
}
Response OK example:
{
    "success": true,
    "deliveryCompany": [
        {
            "serviceType": "pudo",
            "deliveryOptionName": "SPL PUDO",
            "trackingType": "excellent",
            "codCharge": 8,
            "maxOrderValue": 10000,
            "maxCODValue": 5000,
            "deliveryOptionId": 6927,
            "extraWeightPerKg": 1,
            "deliveryCompanyName": "splUpds",
            "returnFee": 13,
            "maxFreeWeight": 15,
            "avgDeliveryTime": "1 to 2 Working Days",
            "price": 13,
            "logo": "https://storage.googleapis.com/tryoto-public/delivery-logo/spl.jpg",
            "currency": "SAR",
            "pickupDropoff": "dropoffOnly"

## OTO GET /rest/v2/getDeliveryOptions — Get Delivery Options
Folder: Shipping Prices. Docs anchor: https://apis.tryoto.com/#c21db287-d379-4260-b040-d48a23fe0959
This API endpoint allows you to check coverage for your active delivery company contracts by providing either the orderId or the city details. Follow these guidelines:

Important:

Do not include both orderId and city in the same request, as this will result in an error.

Ensure your request contains only one of these parameters to proceed successfully.

Request Parameters:

 | 

 | Name
 | Required
 | Type
 | Description

 | city
 | no
 | string
 | Check coverage in the city.

 | orderId
 | no
 | string
 | Check coverage for that specific order.
Response OK example:
{
    "success": true,
    "options": [
        {
            "name": "Tam",
            "deliveryOptionId": 4,
            "integrationName": "tam"
        },
        {
            "name": "Aymakan",
            "deliveryOptionId": 20,
            "webhookUrl": "https://login.tryoto.com/shipmentStatus?token=7NhG6Fhsk8MMoLYBMmMo&dc=aymakan"
        },
        {
            "name": "Aramex",
            "deliveryOptionId": 22,
            "webhookUrl": "https://login.tryoto.com/shipmentStatus?token=TMcFSCSFSD3ctGpIk7wX&dc=aramex"
        }
    ]
}

## OTO POST /rest/v2/createShipment — Create Shipment
Folder: Shipments. Docs anchor: https://apis.tryoto.com/#b4e5723b-4160-471d-b897-971f08838c03
This API endpoint allows you create shipment for orders, while creating shipments need a valid delivery option id. You can get valid delivery options in two ways:

Delivery Options with OTO rates:
  No contracted delivery companies or activation is required. OTO offers a range of delivery company options, which are available for use. You can view these options and their associated fees by using the Check OTO Delivery Fee endpoint.

Delivery Options with your own rates:
  In this case, you already have agreements with one or more delivery companies. Each delivery company you connect is linked to a specific delivery option ID. You can retrieve these IDs by using the Get Delivery Options or checkDeliveryFee endpoints.

Note: If deliveryOptionId is not sent on the request, the assignment is made to the delivery company that complies with your feasibility rule. If you do not have a feasibility rule setting, the order will be automatically assigned to the first delivery company added.

Request Parameters:

 | 

 | Name
 | Required
 | Type
 | Description

 | orderId
 | yes(if there is no otoId)
 | string
 | Order number for which you want to create a shipment

 | otoId
 | yes(if there is no orderId)
 | string
 | Unique id created by OTO

 | deliveryOptionId
 | no
 | int
 | Activated delivery company option id

 | packageWeight
 | no
 | double
 | Total weight of the shipment

 | boxWidth
 | no
 | double
 | Width of package (used for OTO rates)

 | boxLength
 | no
 | double
 | Lenght of package (used for OTO rates)

 | boxHeight
 | no
 | double
 | Height of package (used for OTO rates)

 | packageCount
 | no
 | integer
 | Number of packages in the order

 | pickingType
 | no
 | enum
 | Possible values:  
PICKUP_BY_DC: Shipping company offers free pickup from origin. BRANCH_DROP_
Request example:
{
    "orderId": "1232464",
    "deliveryOptionId":"12345"
}
Response OK example:
{
    "success": true,
    "message": "create shipment request is received."
}

## OTO POST /rest/v2/cancelShipment — Cancel Shipment
Folder: Shipments. Docs anchor: https://apis.tryoto.com/#858499ac-1ae9-42ff-9f33-c617ea0b79a2
This API initiates the cancellation process with the shipping company.

Shipments cannot be canceled once they have reached the "picked up" status.

Some shipping companies do not support shipment cancellations, which may result in a failure response indicating the shipment could not be canceled.

Request Parameters:

 | 

 | Name
 | Required
 | Type
 | Description

 | orderId
 | yes( if there is no otoId)
 | string
 | orderId from which shipment was created

 | otoId
 | yes( if there is no orderId)
 | string
 | Unique id created by OTO.

 | shipmentId
 | yes
 | string
 | Shipment id to be cancelled.
Request example:
{
    "orderId": "24543ec5-1dd2-46a1-b4b3-d3bd47837665",
    "shipmentId": "F21SACO00227700000"
}
Response OK example:
{
    "success": true
}

## OTO POST /rest/v2/createReturnShipment — Create Return Shipment
Folder: Return Shipments. Docs anchor: https://apis.tryoto.com/#fd6ba07d-1320-40aa-8aac-893b99b67ebe
This API endpoint creates a new return order for delivered forward orders.
A new return order ID is generated by appending a suffix (e.g. -R1, -R2) to the original order ID and is returned in the response for return tracking and related operations.
Return processing is handled on an item basis, meaning only the specified items are included in the return order and used for all return-related calculations.

Example:

Original order ID: ORD-1234

Order status: delivered

Result:

A new return order is created with order ID: ORD-1234-R1

The return order includes only SKU-1

All return-related actions (tracking, printing, status checks) must be performed using ORD-1234-R1

Delivery Options with OTO rates:
  No contracted delivery companies or activation is required. OTO offers a range of delivery company options, which are available for use. You can view these options and their associated fees by using the Check OTO Delivery Fee endpoint.

Delivery Options with your own rates:
  In this case, you already have agreements with one or more delivery companies. Each delivery company you connect is linked to a specific delivery option ID. You can retrieve these IDs by using the Get Delivery Options or checkDeliveryFee endpoints.

Request Parameters:

 | 

 | Name
 | Required
 | Type
 | Description

 | orderId
 | yes
 | string
 | Order number for which you want to create a reverse shipment.

 | pickupLocationCode
 | no
 | string
 | Predefined pickup address of branches/warehouses from Create Pickup Location endpoint.

 | deliveryOptionId
 | no
 | string
 | Activated delivery company option id.

 | pickingType
 | 
 | enum
 | Possible values:  
PICKUP_BY_DC: Shipping company offers free pickup from origin. BRANCH_DROP_OFF: Package must be delivered to a branch of the shipping compan
Request example:
{
    "orderId": "202111080914",
    "deliveryOptionId": "156",
    "pickupLocationCode": "wh1",
    "items": [
        {
            "quantity": "1",
            "sku": "SKU045857"
        }
    ]
}
Response OK example:
{
    "success": true,
    "returnOrderId": "2204749035-R1",
    "message": "A new return order is created for return shipment"
}


## OTO POST /rest/v2/getReturnLink — Get Return Link
Folder: Return Shipments. Docs anchor: https://apis.tryoto.com/#e3373724-ebbe-4dbf-bddd-0b99484b2be5
This API endpoint generates a link that serves as a return request portal for end customers. The portal allows customers to initiate return requests seamlessly. Additionally, the portal's details and settings can be customized in the OTO Dashboard to align with your specific requirements.

Request Parameters:

 | 

 | Name
 | Required
 | Type
 | Description

 | orderId
 | yes
 | string
 | The order for which a return request is requested.
Request example:
{
    "orderId":"123"
}
Response OK example:
{
    "success": true,
    "returnLink": "https://app.tryoto.com/sms/return-request?key=Y3RnL0MwMTJiTFYwOVo5UnhGS0lOcU0xcnhBclRVMGwzTENGcjd4bEZCST0="
}

## OTO POST /rest/v2/getReturnDetails — Get Return Details
Folder: Return Shipments. Docs anchor: https://apis.tryoto.com/#111c0ebb-52da-4b55-b83b-99ef46d8dc09
This API endpoint allows you to retrieve detailed information about the reverse shipment associated with a specific order. Reverse shipments are typically created when an order is returned or exchanged. This endpoint provides comprehensive insights into the reverse shipment process, including: return reason, returned items etc.

Request Parameters:

 | 

 | Name
 | Required
 | Type
 | Description

 | orderId
 | yes
 | string
 | Id of the order

Response Parameters:

returnedItems: An array showing information about items to be returned.

sku: sku of the item.

quantityToBeReturned: Quantity on how many items will be returned.

returnLocationCode: Pickup location code that the items will be return.

items: An array shows the all items on the order.

quantityOrdered: Quantity of items ordered

status: Current status of the return shipment.
Request example:
{
    "orderId": "OID-9616-1008"
}
Response OK example:
{
    "returnLocationCode": "Riyadh",
    "orderId": "OID-9616-1008",
    "returnReason": "Damaged",
    "items": [
        {
            "sku": "123456",
            "quantityOrdered": 1
        }
    ],
    "status": "returned"
}

## OTO POST /rest/v2/triggerReturnSms — Trigger Return SMS
Folder: Return Shipments. Docs anchor: https://apis.tryoto.com/#f226d1f7-2643-42f2-a664-09cea8733efc
This API endpoint will trigger an SMS for a successful return request, If your SMS settings are configured correctly.

Please note that, since the SMS service operates asynchronously, the response does not confirm that the SMS has been delivered to the end customer. For a more detailed investigation of any SMS delivery issues, we recommend checking the SMS Logs under the Logs section in the OTO UI.

Request Parameters:

 | 

 | Name
 | Required
 | Type
 | Description

 | orderId
 | yes
 | string
 | The orderId you want to trigger return sms.
Request example:
{
    "orderId":"523939"
}
Response OK example:
{
    "success": true,
    "otoId": 3077435
}

## OTO GET /rest/v2/print/orderId — Print AWB
Folder: Shipping Label(AWB). Docs anchor: https://apis.tryoto.com/#b0ed99bb-9684-49d2-9881-3ee692724e1e
This API endpointallows you to access print URL for generated Air Waybill (AWB) for shipments. An AWB is a crucial document used in air delivery transport that contains essential shipping information.

Request Parameters:

 | 

 | Name
 | Required
 | Type
 | Description

 | orderId
 | yes
 | string
 | Order id of the order to be printed

 | internationalProforma
 | no
 | boolean
 | If set to true, the response will include the International Proforma for international shipments.

 | printReverseShipment
 | no
 | boolean
 | Generates the AWB for a reverse (return) shipment.
Response  example:
{
    "dcTrackingNumber": "",
    "success": true,
    "printAWBURL": "https://app.tryoto.com/print/awb?enc=eyJjb21wYW55SWQiOiIxNzA2OCIsImlkcyI6WzMwMDQzMjc5XX0=",
    "deliveryCompany": "saudiPostV2",
    "trackingNumber": "GNTUPD0042953826"
}

## OTO POST /rest/v2/orderStatus — Order Tracking
Folder: Tracking. Docs anchor: https://apis.tryoto.com/#0cf3d22a-5b3f-4a2f-995b-e9cfe817bcfe
This API endpoint enables you to track the real-time status and progress of an order. By using this endpoint, you can retrieve detailed tracking information, including:

Current order status (e.g.,pickedUp, outForDelivery, delivered).

Shipment details such as carrier, tracking number, and estimated delivery time, print AWB URL.

Request Parameters:

 | 

 | Name
 | Required
 | Type
 | Description

 | orderId
 | yes (if there is no otoId)
 | string
 | Id of the order that you will track.

 | otoId
 | yes (if there is no orderId)
 | string
 | A unique id of the order generated by OTO.

 | labelType
 | no
 | string
 | Specifies the label output format. If zpl is selected, the label will be generated in ZPL (Zebra Programming Language) format.
Request example:
{
    "orderId": "1234"
}
Response OK example:
{
    "date": "2026-04-27 12:42:07",
    "customerAddress": "Khayran Al Murrah",
    "totalValue": 10,
    "orderId": "OID-23331-9749",
    "trackingUrl": "https://app.tryoto.com/otoflex-tracking?enc=dUszSFUzRDZRVnZYWU9LZTBPODV0MG1pWldrU3JSVnh6QWVEYXJCRWN4cz0=",
    "dcTrackingNumber": "",
    "deliveryCompany": "otoDriverApp",
    "printAWBURL": "https://app.tryoto.com/print/awb?enc=eyJjb21wYW55SWQiOiIxNzA2OCIsImlkcyI6WyIzMDUxNDI4MSJdLCJyZXZlcnNlIjp0cnVlfQ==",
    "customerName": "redcar  testing",
    "shipmentId": "DCA87E10",
    "success": true,
    "otoId": "30514281",
    "status": "returnShipmentProcessing"
}

## OTO POST /rest/v2/orderHistory — Order History
Folder: Tracking. Docs anchor: https://apis.tryoto.com/#89dd3e18-7cc7-4586-9f28-68ed78d7764d
This API endpoint allows you to retrieve the complete history of an order, providing detailed insights into its lifecycle. This includes:

Status changes (e.g., pickedUp, arrivedTerminal, delivered).

Timestamps for each status update.

Actions taken during the order process, such as cancellations or modifications.

Request Parameters:

 | 

 | Name
 | Required
 | Type
 | Description

 | orderIds
 | yes( if there is no otoIds or shipmentIds)
 | array
 | Ids of the order that you will track.

 | otoIds
 | yes( if there is no orderIds or shipmentIds)
 | array
 | A unique id of the order generated by OTO

 | shipmentIds
 | yes( if there is no orderIds or otoIds)
 | array
 | The unique shipment identifier returned by the delivery company after the shipment is successfully created.
Request example:
{
    "orderIds": ["2414124","3223523"]
}
Response OK example:
{
    "success": true,
    "items": [
        {
            "amount": 1,
            "orderId": "OID-23331-9743",
            "trackingURL": "https://app.tryoto.com/otoflex-tracking?enc=MUZEMGdSVXNaTkxYWU9LZTBPODV0K1JSYzJYMXlHMnd6QWVEYXJCRWN4cz0=",
            "dcTrackingNumber": "",
            "history": [
                {
                    "date": "2025-11-30 08:09:54",
                    "description": "Created by fatmanur yavuz asd",
                    "status": "new",
                    "currentLocation": {}
                },
                {
                    "date": "2025-11-30 08:09:54",
                    "description": "Created by fatmanur yavuz asd",


## OTO POST /rest/v2/trackShipment — Track Shipment
Folder: Tracking. Docs anchor: https://apis.tryoto.com/#3b8d84ec-7769-41d4-adf2-6d2d8c1189a4
This API endpoint enables you to track a shipment by providing the tracking number and delivery company name. Without requiring any authorization, it offers detailed shipment information, including tracking URL, real time status updates and status history.

If you are a marketplace, you can track your sellers' shipments without requiring additional authorization.

Request Parameters:

 | 

 | Name
 | Required
 | Type
 | Description

 | trackingNumber
 | yes
 | string
 | The shipment/ tracking number that you wanna track.

 | deliveryCompanyName
 | yes
 | string
 | The name of the delivery company. You can get this information from DC List endpoint with code paramater

 | statusHistory
 | no
 | boolean(true, false)
 | To bring the history of the shipment.

 | brandName
 | no
 | string
 | The brand name associated with the shipment.
Request example:
{
    "trackingNumber": "290692134777",
    "deliveryCompanyName":"smsaecom",
    "statusHistory":true,
    "brandName":"test brand"
}
Response OK example:
{
    "trackingUrl": "https://www.naqelexpress.com/en/sa/tracking/",
    "success": true,
    "items": [
        {
            "dcStatus": "1",
            "updateStatusDate": true,
            "shipmentId": "289812708",
            "otoStatus": "pickedUp",
            "success": true,
            "dcUpdateDate": "2024-08-15T11:36:00",
            "dcDescription": "1 Picked up by Naqel at : JEDDAH",
            "history": [
                {
                    "dcStatus": "0",
                    "updateStatusDate": true,
                    "shipmentId": "289812708",
                    "otoStatus": "shipmentCreated",
                    "dcUpdateDate": "2024-08-14T15:24:13",
             

## OTO GET /rest/v2/orders/{orderId}/customer-notifications — Customer Notifications
Folder: Customer Notifications. Docs anchor: https://apis.tryoto.com/#5a9e48dd-a5c9-4209-a8e2-3e9ee57cedc1
This endpoint allows you to retrieve all system-generated customer communication artifacts related to a specific order.

It enables you to fully control your customer communication by consuming these artifacts and sending them through your own CRM, ERP, or communication platforms.

The API endpoint provides the below customer notifications if generated and still valid.

You can configure the actionTypes:

Tracking Link

Feedback (Rating) Link

Undelivered Attempt Link

Delivery Slot Selection Link

Address Verification Link

Reschedule Link

Order Confirmation Link

in the customer notifications by following these steps:

Log in to your account at app.tryoto.com

From the main dashboard, click on Settings in the navigation menu

Inside the Settings page, go to Customizable Pages

Locate the relevant actionType in the list

Configure the settings for each actionType based on your needs and save your changes

You can configure the Return Link in the customer notifications by following these steps:

StartFragment

Here’s a more step-by-step, navigational version:

Go to app.tryoto.com and log in to your account.

From the main dashboard, click on Settings in the left-hand menu.

In the Settings page, select Return Portal.

Inside the Return Portal section, review the available options and make the necessary configurations.

After adjusting the settings, click Save to apply your changes.

 | 

 | Parameter
 | Required
 | Type
 | Description

 | orderId
 | Yes
 | String
 | Order ID

 | actionType
 | No
 | Enum
 | Filters by actionType. Values can be: trackingLink, feedbackLink, undeliveredAttemptLink, deliverySlotLink, addressVerificationLink, rescheduleLink, orderConfirmationLink, clickCollectOTP, otoFlexDeliveryOTP, returnLink
Response  example:
{
    "orderId": "123456",
    "actions": [
        {
            "type": "trackingLink",
            "value": "https://tracking-link..."
        },
        {
            "type": "feedbackLink",
            "value": "https://feedback-link..."
        },
        {
            "type": "clickCollectOTP",
            "channel": "OTP",
            "value": "458921"
        }
    ]
}

## OTO POST /rest/v2/getDeliveryEstimation — Get Delivery Estimation
Folder: Carrier Integrations. Docs anchor: https://apis.tryoto.com/#79362527-630c-4434-b200-7a47739768a0
This API endpoint allows you to access estimated delivery dates, times, and other last-mile process details by utilizing the SLA configurations of your shipping partners. By providing key information such as the pickup and customer addresses, you can retrieve precise delivery and pickup date estimates. This capability enhances the accuracy of your shipping operations and proves invaluable for businesses and logistics providers aiming to streamline workflows and deliver reliable delivery timelines to their customers.

Request Parameters:

 | 

 | Name
 | Required
 | Type
 | Description

 | calculationData
 | yes
 | JSONObject
 | Attributes will be used to calculate estimations, it should include originAddress & destinationAddress objects.

 | deliveryCompanySettingsId
 | no
 | number
 | To ask for specific contract

 | slaMethodType
 | no
 | enum
 | To filter contracts based on the SLA Calculation Method. Enum list: ["BULLET_KM","CITY_BASED","DISTRICT_BASED","KM_BASED","TIER_BASED"]

Request Paramaters: originAddress and destinationAddress

 | 

 | Name
 | Required
 | Type
 | Description

 | city
 | yes
 | string
 | Pickup city and destination city separately

 | country
 | yes
 | string
 | Pickup country and destination country separately

 | lat
 | no
 | number
 | Reqired for bullet type

 | lon
 | no
 | number
 | Reqired for bullet type

 | district
 | no
 | number
 | Reqired for dtistrict based sla
Request example:
{
    "calculationData": {
        "originAddress": {
            "city": "Riyadh",
            "country": "SA",
            "lat": 45,
            "lon": 45,
            "district": ""
        },
        "destinationAddress": {
            "city": "Riyadh",
            "country": "SA",
            "lat": 45,
            "lon": 45,
            "district": ""
        }
    },
    "deliveryCompanySettingsId": 1233,
    "slaMethodType": "CITY_BASED"
}
Response OK example:
{
    "result": [
        {
            "estimatedTransferDuration": 3,
            "shippingContract": {
                "agreementType": "INTEGRATOR",
                "deliveryCompanySettingsId": 1233,
                "name": "Smsa Ecom V2",
                "id": 117,
                "slaMethodType": "TIER_BASED",
                "deliveryIntegrationName": "secom"
            },
            "estimatedPickupDate": "2024-01-15",
            "cutOffSameDayPickup": "15:00",
            "estimatedTransferCompletionDate": "2024-01-18",
            "estimatedDeliveryDate": "2024-01-18",
            "shipmentCreateDate": "2024-01-10"
        }
    ],
    "success": true
}

## OTO POST /rest/v2/aiEstimatedDeliveryDates — AI Estimated Delivery Dates
Folder: Carrier Integrations. Docs anchor: https://apis.tryoto.com/#9fde5009-7ef6-4f66-a384-d0cf521d74d1
This API endpoint allows you retrieve OTO’s AI-generated estimated pickup and delivery dates.
The endpoint is designed solely for prediction purposes—it does not create or update any shipments.

The prediction model uses all up-to-date operational data within OTO, including historical delivery patterns, courier performance, service types, regions, and peak-time behavior.

Based on this data, it produces a reliable estimate for both pickup and delivery timelines.

Request Parameters:

 | 

 | Name
 | Required
 | Type
 | Description

 | originCity
 | yes
 | string
 | pickup city

 | destinationCity
 | yes
 | string
 | destination city

 | originLat
 | no
 | number
 | reqired for bullet type

 | originLon
 | no
 | number
 | reqired for bullet type

 | destinationLat
 | no
 | number
 | reqired for bullet type

 | destinationLon
 | no
 | number
 | reqired for bullet type

 | weight*
 | yes
 | number
 | approximate weight of package(kg)

 | forReverseShipment
 | no
 | boolean
 | When you set is true, it will list the delivery companies that you can create reverse shipments.

 | currency
 | no
 | string
 | ISO 4217 code, "SAR","KWD", etc

 | packageCount
 | no
 | number
 | 1

 | totalDue
 | no
 | number
 | cash on delivery amount

 | length
 | no
 | number
 | length of the package(cm)

 | width
 | no
 | number
 | width of the package(cm)

 | height
 | no
 | number
 | height of the package(cm)

 | serviceType
 | no
 | enum
 | express,sameDay, fastDelivery, coldDelivery,heavyAndBulky, electronicAndHeavy

 | deliveryType
 | no
 | enum
 | toCustomerDoorstep pickupByCustomer toCustomerDoorstepOrPickupByCustomer

 | includeEstimatedDeliveryDates
 | no
 | boolean
 | If you set this parameter to true, the response will include the estimated pickup and delivery dates, generated using o
Request example:
{
    "weight":"1",
    "originCity":"Riyadh",
    "destinationCity":"Riyadh",
    "height":15,
    "width":10,
    "length":10,
    "includeEstimatedDates":true
}
Response  example:
{
    "traceId": "63545-73855-176.88.141.22-04260af8-e9da-4597-b652-1d6f9f89554c",
    "success": true,
    "deliveryCompany": [
        {
            "deliveryCompanyName": "Deliver Now",
            "estimatedPickupDate": "2025-11-17",
            "deliveryCompanySettingsId": 7109,
            "estimatedDeliveryDate": "2025-11-17"
        },
        {
            "deliveryCompanyName": "Omni Llama",
            "estimatedPickupDate": "2025-11-16",
            "deliveryCompanySettingsId": 7252,
            "estimatedDeliveryDate": "2025-11-17"
        },
        {
            "deliveryCompanyName": "SPL PUDO",
            "estimatedPickupDate": "2025-11-17",
            "

## OTO POST /rest/v2/checkCoverage — Check Coverage
Folder: Carrier Integrations. Docs anchor: https://apis.tryoto.com/#8459659b-f15d-46f5-b71e-7599b3cb1404
This API endpoint allows you to verify whether the location provided in your request is within the coverage area defined by your OTO settings, including the coverage configurations for delivery companies and the branches.

Request Parameters:

 | 

 | Name
 | Required
 | Type
 | Description

 | city
 | yes
 | string
 | City to check coverage

 | lat
 | yes
 | long
 | Latitude

 | lon
 | yes
 | long
 | Longitude

 | pickupLocation
 | no
 | boolean
 | If you pass true, it will list the covered and available pickup locations.

 | pickupLocationCode
 | no
 | string
 | Lists only the pickup location associated with the provided code.

 | checkAvailability
 | no
 | boolean
 | It checks the pickup location's working hours to determine whether the location is available.

 | packageSize
 | no
 | string
 | small,medium,large,simcard,iphone13,
Request example:
{
    "lat": "24.28738403",
    "lon": "46.44305038",
    "city": "Riyadh"
}
Response OK example:
{
    "branchCoverage": true,
    "courierDelivery": true,
    "success": true,
    "bulletDelivery": true
}

## OTO POST /rest/v2/availableCities — Available Cities
Folder: Carrier Integrations. Docs anchor: https://apis.tryoto.com/#567bdc76-ea72-42e6-ae4e-8fb40e12f34d
This API endpoint retrieves a list of cities available for delivery based on your coverage settings for active delivery companies you have contracts with. To obtain results, ensure that the delivery companies' coverage areas are configured by adding cities through the OTO UI.

Request Parameters:

 | 

 | Name
 | Required
 | Type
 | Description

 | page
 | no
 | number
 | Number of page, default is 1

 | limit
 | no
 | number
 | Number of cities in a single page, default is 100
Request example:
{
    "limit":3
}
Response OK example:
{
    "success": true,
    "limit": 3,
    "page": 1,
    "orders": [
        {
            "city": "Riyadh",
            "city_ar": "الرياض"
        },
        {
            "city": "Dammam",
            "city_ar": "الدمام"
        },
        {
            "city": "Jeddah",
            "city_ar": "جدة"
        }
    ]
}

## OTO POST /rest/v2/availableTimeslots — Available Time Slots
Folder: Carrier Integrations. Docs anchor: https://apis.tryoto.com/#d45a2134-81a0-4493-a250-283f1c629868
This API endpoint retrieves the available delivery time slots for delivery companies based on their specified working hours.

Request Parameters:

 | 

 | Name
 | Required
 | Type
 | Description

 | lat
 | no
 | string
 | Latitude

 | lon
 | no
 | string
 | Longitude

 | serviceType
 | yes
 | string
 | Possible values: bullet,courier

 | packageSize
 | no
 | string
 |
Request example:
{
    "serviceType": "bullet",
    "packageSize": "simCard",
    "lat": "24.00",
    "lon": "46.00"
}
Response OK example:
{
    "success": true,
    "availableSlots": [
        {
            "times": [
                "9:30AM-11:30AM",
                "11:30AM-1:30PM",
                "1:30PM-3:30PM",
                "3:30PM-5:30PM",
                "5:30PM-7:30PM",
                "7:30PM-9:30PM",
                "9:30PM-11:30PM"
            ],
            "day": "05/11/2020"
        },
        {
            "times": [
                "5:30PM-7:30PM",
                "7:30PM-9:30PM",
                "9:30PM-11:30PM"
            ],
            "day": "06/11/2020"
        },
        {
            "times": [
                "9:30AM-11:30AM",
                "11:30AM-1:30PM",
                "1:30PM-3:30PM",
     

## OTO POST /rest/v2/dcList — DC List
Folder: Carrier Integrations. Docs anchor: https://apis.tryoto.com/#98adae28-1da8-458c-92de-37e62ca0c379
This API endpoint provides a list of all delivery companies integrated with OTO. If you have a contract with any of these companies, you can connect your account to OTO. Use the company's unique code to configure settings through the DC Activation and DC Config API endpoints.

If a delivery company you have a contract with is not listed, please notify us to initiate the integration process.
Response OK example:
{
    "data": [
        {
            "Name": "3speeds",
            "code": "3speeds"
        },
        {
            "Name": "4PL",
            "code": "4pl"
        },
        {
            "Name": "4U Express",
            "code": "4uexpress"
        },
        {
            "Name": "4U Logistics",
            "code": "4u"
        },
        {
            "Name": "9Cloud",
            "code": "9cloud"
        },
        {
            "Name": "Adam Pharmacy",
            "code": "adamPharmacy"
        },
        {
            "Name": "Adwar Logistics",
            "code": "adwar"
        },
        {
            "Name": "Adwar Logistics (Logestechs)",
            "code": "adwarLogestechs

## OTO POST /rest/v2/dcConfig — DC Config
Folder: Carrier Integrations. Docs anchor: https://apis.tryoto.com/#da63eaaa-61a9-4423-8454-7d7f705d89a6
This API endpoint allows you to view the required account credentials and the template for the delivery company specified in the request, which are needed for the next step: DC activation.
Retrieve the delivery company configuration template.
Use this template to create a valid configuration object, similar to the given exampleJson.
This configuration object is then used to activate the delivery company with the DC Activation API endpoint.

Request Parameters:

 | 

 | Name
 | Required
 | Type
 | Description

 | code
 | yes
 | string
 | The integration name obtained from the DC List.
Request example:
{
    "code":"aramex"
}
Response OK example:
{
    "settings": [
        {
            "fieldName": "UserName",
            "parentJson": "ClientInfo",
            "fieldType": "string"
        },
        {
            "fieldName": "Password",
            "parentJson": "ClientInfo",
            "fieldType": "string"
        },
        {
            "fieldName": "Version",
            "parentJson": "ClientInfo",
            "fieldType": "string"
        },
        {
            "fieldName": "AccountNumber",
            "parentJson": "ClientInfo",
            "fieldType": "string"
        },
        {
            "fieldName": "AccountPin",
            "parentJson": "ClientInfo",
            "fieldType": "string"
        },
        {
    

## OTO POST /rest/v2/dcActivation — DC Activation
Folder: Carrier Integrations. Docs anchor: https://apis.tryoto.com/#ec780d5e-2dfb-4859-9f22-d5eeed22f13c
This API endpoint is used to perform Delivery Company (DC) activation. It enables you to activate a delivery company by providing the required configuration details.

Request Parameters:

 | 

 | Name
 | Required
 | Type
 | Description

 | code
 | yes
 | string
 | The integration name obtained from the DC List.

 | deliveryOptionName
 | yes
 | string
 | A name you assign to easily identify this configuration.

 | brandID
 | no
 | number
 | id of the brand created by Create Brand endpoint

 | settings
 | yes
 | object
 | A configuration object created based on the example provided by the DC Config endpoint.

 | active
 | no
 | boolean
 | If pass true it will activate the delivery company settins automatically.

Note: You can activate 1 DC for the Free package and 3 DC for the Starter package and unlimited for other packages.
Request example:
{
    "code":"aramex",
    "deliveryOptionName":"api test aramex",
    "settings":{
        "ClientInfo": {
            "UserName": "apitest@example.com",
            "Version": "v1",
            "AccountPin": "123",
            "AccountCountryCode": "SA",
            "AccountEntity": "RUH",
            "Source": 24,
            "Password": "123abc",
            "AccountNumber": "123456"
        },
        "productType": "CDS"
    }
    
}
Response OK example:
{
	"success": true,
    "deliveryOptionId":"123"
}

## OTO POST /rest/v2/getCities — Get Cities
Folder: Carrier Integrations. Docs anchor: https://apis.tryoto.com/#19acafde-0a16-4fcd-aa39-18119bbcd343
This API endpoint is used to retrieve a list of cities of a given country.

Request Parameters:

 | 

 | Name
 | Required
 | Type
 | Description

 | country
 | yes
 | string
 | The country for which cities are to be retrieved.

 | perPage
 | no
 | integer
 | The number of cities to be displayed per page. Default value is 100, max value is 500.

 | page
 | no
 | integer
 | The page number for pagination.

Example Response:

{
    "getCities": {
        "totalCount": 1,
        "perPage": 1,
        "Cities": [
            {
                "name": "Riyadh"
            }
        ]
    }
}
Request example:
{
    "country": "SA",
    "perPage": 10,
    "page": 1
}
Response OK example:
{
    "getCities": {
        "totalCount": 704,
        "perPage": 400,
        "Cities": [
            {
                "name": "Aba Alworood"
            },
            {
                "name": "Abayt"
            },
            {
                "name": "Abha"
            },
            {
                "name": "Abha Manhal"
            },
            {
                "name": "Abiar Al Mashi"
            },
            {
                "name": "Abil"
            },
            {
                "name": "Abu Ajram"
            },
            {
                "name": "Abu Al Arj"
            },
            {
                "name": "Abu Arish"
            },
            {
            

## OTO POST /rest/v2/checkDCBranchList — Check DC Branch List
Folder: Carrier Integrations. Docs anchor: https://apis.tryoto.com/#354d84b1-c761-4850-81a9-10c091eb1168
This API endpoint retrieves the available branch list, PUDO (Pick-Up/Drop-Off) points, parcel shops, lockers, and other supported service locations for the selected delivery company. It can be used to obtain the latest carrier location information required for branch deliveries, pickup point selection, return shipments, and other location-based shipping services. The response includes all available service points supported by the carrier based on the provided request parameters.

Request Parameters

 | 

 | Name
 | Required
 | Type
 | Description

 | deliveryCompanyName
 | Yes
 | string
 | The integrationName value from the DeliveryCompanies table.

 | countryCode
 | Yes
 | string
 | The ISO country code used to retrieve the available branches and service points.

 | city
 | No
 | string
 | Filters the results by the specified city. If not provided, branches from all cities may be returned (depending on the carrier).

 | paymentMethod
 | No
 | string
 | Filters service points by supported payment method. Accepted values are paid and cod. If omitted or null, service points for all payment methods are returned.

Response Parameters

 | 

 | Parameter
 | Type
 | Description

 | dcBranchName
 | string
 | Name of the pickup point, PUDO point, locker, or service branch.

 | country
 | string
 | Country where the branch is located.

 | city
 | string
 | City where the branch is located.

 | state
 | string
 | State, province, or region where the branch is located.

 | address
 | string
 | Full address of the branch.

 | postCode
 | string
 | Postal or ZIP code of the branch location.

 | workingHours
 | string
 | Branch operating hours on weekdays.

 | weekendWorkingHours
 | string
 | Branch operating hours on weekends.

 | branchEmail
 | string
 | Contact email address of the
Request example:
{
    "deliveryCompanyName": "acs",
    "countryCode": "GR"

}
Response  example:
{
  "pickupPoints": [
    {
      "dcBranchName": "Saudi Post Riyadh Olaya Branch",
      "country": "SA",
      "address": "King Fahd Road, Al Olaya District",
      "city": "RIYADH",
      "codSupported": true,
      "branchEmail": "olaya@splonline.com.sa",
      "lon": 46.675296,
      "paymentType": "Cash, Mada, Visa, Mastercard",
      "branchCode": "SPL1001",
      "phoneNumber": "+966112345678",
      "postCode": "12214",
      "state": "RIYADH",
      "branchType": "POST_OFFICE",
      "workingHours": "08:00-21:00",
      "weekendWorkingHours": "16:00-21:00",
      "lat": 24.713552
    },
    {
      "dcBranchName": "Saudi Post Smart Locker Riyadh Olaya",
      "country": "SA",
     

## OTO POST /rest/v2/createPickupLocation — Create Pickup Location
Folder: Pickup Locations. Docs anchor: https://apis.tryoto.com/#43a9c8fe-2549-4682-bd6b-b612ec816563
This API endpoint allows you to define and register a new pickup location within the system. By specifying the location details, you can expand your network of pickup points, improving logistics and delivery workflows.

Request Parameters:

 | 

 | Name
 | Required
 | Type
 | Description

 | name
 | yes
 | string
 | Name of the pickup location; should be unique.

 | type
 | no
 | string
 | You can enter these values: branch, warehouse.  
Branch can only be used by enterprise and marketplace packages

 | code
 | yes
 | string
 | Code of the pickup location; should be unique.

 | mobile
 | yes
 | string
 | Mobile number of the pickup location

 | lat
 | no
 | number
 | Latitude, *if not exist orders may not assigned to pickupLocations automatically

 | lon
 | no
 | number
 | Longitude, * if not exist orders may not assigned to pickupLocations automatically

 | city
 | yes
 | string
 | City name of the pickup location

 | country
 | yes
 | string
 | Country ISO2 code "SA","AE" etc.

 | postcode
 | no
 | string
 | Postal code of the pickup location

 | address
 | yes
 | string
 | Address of the pickup location

 | district
 | no
 | string
 | The district or area where the location is situated

 | state
 | no
 | string
 | The state or province where the pickup location is located

 | street
 | no
 | string
 | The street address of the pickup location

 | shortAddressCode
 | no
 | string
 | The short address code in the national address

 | secondaryAddressNumber
 | no
 | string
 | The additional/secondary number in the national address

 | buildingNo
 | no
 | string
 | The building number from the national address

 | contactName
 | yes
 | string
 | If not exists you may not create shipments with some delivery companies

 | contactEmail
 | yes
 | string
 | In format of test@
Request example:
{
    "type": "branch",
    "code": "code-0211112",
    "name": "Location-02 Name11111",
    "mobile": "555888777",
    "address": "3474, Abi Almahd, 7026, Al Olaya, 12221, Riyadh, Kingdom of Saudi Arabia",
    "contactName": "Test Contact",
    "contactEmail": "Test Email",
    "lat": "26.001",
    "lon": "50.001",
    "city": "Dammam",
    "country":"SA",
    "street":"Abi Almahd",
    "district":"Al Olaya",
    "buildingNo":"3474",
    "secondaryAddressNumber":"7026",
    "postcode": "12221",
    "servingRadius": "10",
    "shortAddressCode":"RHOD3474",
    "brandName": "Example Seller"
}
Response OK example:
{
    "warhouseId": "123",
    "pickupLocationCode":"code-01",
    "success": true,
    "message": "warehouse has been created"
}

## OTO POST /rest/v2/updatePickupLocation — Update Pickup Location
Folder: Pickup Locations. Docs anchor: https://apis.tryoto.com/#7bc1f108-c8fa-4183-836c-59cc11b26db4
This API endpoint allows you to modify the details of your existing pickup locations efficiently. This endpoint provides a streamlined way to ensure that your pickup location information remains accurate and up to date, enabling smooth and reliable operations.

Request Parameters:

 | 

 | Name
 | Required
 | Type
 | Description

 | name
 | yes
 | string
 | Name of the pickup location

 | type
 | yes
 | string
 | You can enter these values: branch, warehouse.  
Branch can only be used by enterprise and marketplace packages

 | code
 | yes
 | string
 | Code of the pickup location

 | mobile
 | yes
 | string
 | Mobile number of the pickup location

 | lat
 | no
 | number
 | Latitude, *if not exist orders may not assigned to pickupLocations automatically

 | lon
 | no
 | number
 | Longitude, * if not exist orders may not assigned to pickupLocations automatically

 | city
 | yes
 | string
 | City name of the pickup location

 | country
 | yes
 | string
 | Country ISO2 code "SA","AE" etc.

 | postcode
 | no
 | string
 | Postal code of the pickup location

 | address
 | yes
 | string
 | Address of the pickup location

 | district
 | no
 | string
 | The district or area where the location is situated

 | state
 | no
 | string
 | The state or province where the pickup location is located

 | street
 | no
 | string
 | The street address of the pickup location

 | secondaryAddressNumber
 | no
 | string
 | The additional/secondary number in the national address.

 | buildingNo
 | no
 | string
 | The building number from the national address.

 | contactName
 | yes
 | string
 | If not exists you may not create shipments with some delivery companies

 | contactEmail
 | yes
 | string
 | In format of test@example.com

 | servingRadius
 | no
 | number
 | Serving radius of branch in KM

Request example:
{
    "type": "warehouse",
    "code": "code-02",
    "name": "Location-02 Name",
    "mobile": "555888777",
    "address": "Test warehouse 3539, Al Khalidiyyah Al Janubiyyah, Dammam 32225",
    "contactName": "Test Contact",
    "contactEmail": "Test Email",
    "lat": "26.001",
    "lon": "50.001",
    "city": "Dammam",
    "district":"Latifah Manaf",
    "street":"Long Street",
    "state":"Eastern Province",
    "country": "SA",
    "postcode": "77777",
    "servingRadius": "10",
    "brandName": "Example Seller 2",
    "status":"active"
}
Response OK example:
{
    "branchId": "1878",
    "pickupLocationCode": "code-02",
    "success": true
}

## OTO GET /rest/v2/getPickupLocationList — Get Pickup Location List
Folder: Pickup Locations. Docs anchor: https://apis.tryoto.com/#9bfefc3f-a421-4a51-bc88-bbdff28482b6
This API endpoint enables you to retrieve a comprehensive list of pickup locations by specifying a date range and status. This endpoint provides an efficient way to filter and access relevant pickup location data, ensuring streamlined tracking and management.

Request Parameters:

 | 

 | Name
 | Required
 | Type
 | Description

 | minDate
 | no
 | date
 | Starting Pickup location create date in "yyyy-mm-dd" format. (e.g. "2024-08-01")

 | maxDate
 | no
 | date
 | Ending Pickup location create date in "yyyy-mm-dd" format. (e.g. "2024-08-05")

 | pickupLocationCode
 | no
 | string
 | The pickup location code when creating a warehouse or branch

 | status
 | no
 | string
 | Status of the pickup location(active, inactive)

Response Body

The response includes a boolean flag "success" indicating the success of the request, along with arrays of "warehouses" and "branches" containing details of pickup locations including their codes, addresses, contact information, geographical coordinates, and other relevant attributes.

{
  "success": true,
  "warehouses": [
    {
      "code": "code-999",
      "address": "Test warehouse 3539, Al Khalidiyyah Al Janubiyyah, Dammam 32225",
      "contactEmail": "Test Email",
      "city": "Dammam",
      "name": "Location Name",
      "contactPerson": "Test Contact",
      "lon": 50.001,
      "id": 17051,
      "contactPhone": "555888777",
      "secondaryAddressNumber":"5555",
      "buildingNo":"A5",
      "lat": 26.001
    },
    {
      "code": "code-95",
      "address": "Test warehouse 3539, Al Khalidiyyah Al Janubiyyah, Dammam 32225",
      "contactEmail": "Test Email",
      "city": "Dammam",
      "name": "Location Name",
      "contactPerson": "Test Contact",
      "lon": 50.001,
      "id": 17052,
      "contactPhone": "555888777
Response OK example:
{
    "success": true,
    "warehouses": [
        {
            "code": "code-999",
            "address": "Test warehouse 3539, Al Khalidiyyah Al Janubiyyah, Dammam 32225",
            "contactEmail": "Test Email",
            "city": "Dammam",
            "country": "SA",
            "street": "Abi Almahd",
            "district": "Al Olaya",
            "buildingNo": "3474",
            "secondaryAddressNumber": "7026",
            "postcode": "12221",
            "name": "Location Name",
            "contactPerson": "Test Contact",
            "lon": 50.001,
            "id": 17051,
            "contactPhone": "555888777",
            "lat": 26.001
        }
    ],
    "branches": [
   

## OTO GET /rest/v2/getBrandList — Get List of Brands (Client Store)
Folder: Brands. Docs anchor: https://apis.tryoto.com/#3cd8a414-d00e-46da-a608-47ce1b8ce5ac
This API endpoint provides access to a comprehensive list of brand (client store) details. This endpoint enables users to retrieve information about brands associated with their account, including key attributes such as brand name, store identifiers, and other relevant metadata.

Request Parameters:

No request body parameters are required for this GET request.

Response:

Upon a successful execution, the server responds with a 200 status code and a JSON object containing the following fields:

success (boolean) - Indicates the success status of the request.

clientStores (array) - An array of client store objects, each containing the following fields:

companyId (integer) - The ID of the company.

storeName (string) - The name of the store.

ID (integer) - The ID of the store.

wareHouseName (string) - The name of the warehouse.

brandLogo (string) - The URL of the brand logo.

defaultWarehouseId (integer) - The ID of the default warehouse.

In case of an empty response, the server still returns a 200 status code with an empty clientStores array.
Response  example:
{
    "success": true,
    "clientStores": [
        {
            "companyId": 24772,
            "storeName": "test123",
            "ID": 1161,
            "wareHouseName": "DefaultWH",
            "brandLogo": "https://storage.googleapis.com/download/storage/v1/b/oto-files-stage/",
            "defaultWarehouseId": 16415
        }
    ]
}

## OTO POST /rest/v2/createBrand — Create Brand (Client Store)
Folder: Brands. Docs anchor: https://apis.tryoto.com/#98a7c1d0-8101-457b-8d2b-ca6c856a6247
This API endpoint allows you to add a new brand (client store) to the system. By using this endpoint, you can define and register a brand with essential details, enabling integration with various systems.

Request Parameters:

 | 

 | Name
 | Required
 | Type
 | Description

 | storeName
 | yes
 | string
 | The name of the store

 | logo
 | no
 | string
 | The logo URL of the brand

 | defaultWarehouseID
 | no
 | integer
 | The ID of the default warehouse

 | stores
 | no
 | array
 | An array of store objects containing the following fields

 | storeName
 | no
 | string
 | The name of the store

 | salesChannelCredentialsID
 | no
 | integer
 | The ID of the sales channel credentials

{
    "success": true,
    "clientStoreId": 1193
}
Request example:
{
    "storeName": "Brand A",
    "logo": "https://storage.googleapis.com/download/storage/v1/b/oto-files-stage/o/files%2F24772%2Fimport%2Fb58b6d41-af83-492c-a416-d4bb0d076be1.png?generation=1721804238908930&alt=media",
    "defaultWarehouseID": 16415,
    "stores": [
        {
            "storeName": "store A",
            "salesChannelCredentialsID": 4512
        }
    ]
}
Response OK example:
{
    "success": true,
    "clientStoreId": 1193
}

## OTO GET /rest/v2/salesChannel/getSalesChannelsList — Sales Channels List
Folder: Sales Channels. Docs anchor: https://apis.tryoto.com/#39ce3908-f5e6-496f-accb-570915608d83
This API endpoint provides a list of all sales channels integrated with OTO. If you have a store with any of these sales channels, you can connect your store to OTO. Use the sales channel's unique code to configure settings through the Sales Channels Config and Sales Channels Activation API endpoints.
Response  example:
{
    "salesChannelsList": [
        {
            "name": "Adobe Commerce",
            "code": "adobeEcommerce"
        },
        {
            "name": "WooCommerce",
            "code": "wooCommerce"
        },
        {
            "name": "Shopify",
            "code": "shopify"
        },
        {
            "name": "OpenCart",
            "code": "opencart"
        },
        {
            "name": "Store Hippo",
            "code": "storehippo"
        },
        {
            "name": "Foodics",
            "code": "foodics"
        },
        {
            "name": "Tsoft",
            "code": "tsoft"
        },
        {
            "name": "shahband

## OTO POST /rest/v2/salesChannel/getSalesChannelConfig — Sales Channel Config
Folder: Sales Channels. Docs anchor: https://apis.tryoto.com/#86498a3b-5dee-481d-bdf9-a6884d75381e
Available Packages: Starter Package, Scale Package, Enterprise Package, Marketplaces

This API endpoint allows you to view the required store credentials and the template for the sales channels specified in the request, which are needed for the next step: Sales Channel Activation.
Retrieve the sales channel configuration template.
Use this template to create a valid configuration object, similar to the given exampleJson.
This configuration object is then used to activate the sales channel with the Sales Channel Activation API endpoint.

Request Parameters:

 | 

 | Name
 | Required
 | Type
 | Description

 | code
 | yes
 | string
 | The integration name obtained from the Sales Channels List.
Request example:
 {
 "code":"shopify"
 }
Response  example:
{
    "code": "shopify",
    "storeURL": "",
    "adminApiAccessToken": "",
    "active": true,
    "storeName": ""
}

## OTO POST /rest/v2/salesChannel/salesChannelActivation — Sales Channel Activation
Folder: Sales Channels. Docs anchor: https://apis.tryoto.com/#910e42be-3e93-4b3f-bb0d-1d9a5eefe194
This API endpoint is used to perform Sales Channels Activation. It enables you to activate a sales channel by providing the required configuration details.

Request Parameters:

 | 

 | Name
 | Required
 | Type
 | Description

 | code
 | yes
 | string
 | The integration name obtained from the Sales Channels List
Request example:
{
    "code": "shopify",
    "storeURL": "https://shopifytest.myshopify.com",
    "adminApiAccessToken": "shopifytoken",
    "active": true,
    "storeName": "Shopify Store"
}
Response  example:
{
    "success": true
}

## OTO POST /rest/v2/createProduct — Create Product
Folder: Products. Docs anchor: https://apis.tryoto.com/#21b289bc-04c1-49b1-993e-23e928d57f56
This API endpointallows clients to add new products to the system by providing key product details. This endpoint is essential for catalog management, enabling businesses to define and register products for use in their operations, such as inventory management, sales, and order processing.

Request Parameters:

 | 

 | Name
 | Required
 | Type
 | Description

 | sku
 | yes
 | string
 | SKU of the product

 | productName
 | yes
 | string
 | Name of the product

 | price
 | yes
 | string
 | Price of the product

 | taxAmount
 | no
 | string
 | Tax Amount of the product

 | brandId
 | no
 | string
 | Brand id of the product

 | description
 | no
 | string
 | Description of the product

 | barcode
 | no
 | string
 | Barcode of the product

 | secondBarcode
 | no
 | string
 | Second Barcode of the product

 | productImage
 | no
 | string
 | Image Link of the product

 | category
 | no
 | string
 | Category of the product

 | hsCode
 | no
 | string
 | A standardized numerical method of classifying traded products

 | itemOrigin
 | no
 | string
 | Origin of the product

 | bundleItems
 | no
 | boolean
 | It can be true/ false

 | category
 | no
 | 
 | Category of product

 | customAttributes
 | no
 | JSONArray
 | Custom attributes of the product

Request Paramaters for Custom Attributes array:

 | 

 | Name
 | Required
 | Type
 | Description

 | attributeValue
 | no
 | string
 | Value of the attribute

 | attributeName
 | yes
 | string
 | Name of the attribute
Request example:
{
    "productName": "Pencil",
    "sku": "1234AB123CDEas",
    "price": "23.5",
    "taxAmount": "11",
    "barcode": "1245125123421",
    "secondBarcode": "231412312",
    "description": "This is product description",
    "brandId": 6345,
    "category" : "Category of the product",
    "productImage": "",
    "packagingMaterial": true,
    "customAttributes": [
        {
            "attributeName": "112",
            "attributeValue": "test product"
        }
    ]
}
Response OK example:
{
    "productId": 6084100,
    "success": true
}

## OTO POST /rest/v2/productList — Product List
Folder: Products. Docs anchor: https://apis.tryoto.com/#7e3709b0-b1b3-4f9d-8cd1-d9ab513825b0
This API endpoint provides a simple and efficient way to retrieve a list of products available in your inventory. This endpoint returns essential product details such as names, images, SKUs, and barcodes, enabling applications to display and manage product information effectively.
Request Parameters:

 | 

 | Name
 | Required
 | Type
 | Description

 | pageSize
 | no
 | number
 | items per page, default is 100

 | currentPage
 | no
 | number
 | page numbe to be called, default is 1
Request example:
{
    "pageSize":100,
    "currentPage":1
}
Response OK example:
{
    "success": true,
    "productCount": 3,
    "products": [
        {
            "name": "renegade",
            "productImage": "https://i.pinimg.com/564x/8b/46/bd/8b46bd024b6a53f09ad35c29f8ffb50b.jpg",
            "sku": "001",
            "barcode": "1111"
        },
        {
            "name": "football",
            "productImage": "https://i.pinimg.com/236x/e4/be/bb/e4bebbaf7a4b7efa305e198720248e9b.jpg",
            "sku": "002",
            "barcode": "6120000210"
        },
        {
            "name": "icecream",
            "productImage": "https://i.pinimg.com/236x/96/e7/ac/96e7accacdb0c1ec87c7ebfd2dc26f3b.jpg",
            "sku": "003",
            "barcode": "46666588851

## OTO POST /rest/v2/addBox — Add Box
Folder: Products. Docs anchor: https://apis.tryoto.com/#b3e3ef16-2faf-4a83-8703-df9416b2e463
This API endpoint allows you to create new boxes with the dimensions you provided.

Request Parameters:

 | 

 | Name
 | Required
 | Type
 | Description

 | name
 | yes
 | string
 | name of the box, name should be unique

 | length
 | yes
 | double
 | length of the package

 | width
 | yes
 | double
 | width of the package

 | height
 | yes
 | double
 | height of the package
Request example:
{
"name":"xsmall",
"length":25,
"width":24,
"height":9
}
Response OK example:
{
    "success": true,
    "message": "Box successfully created"
}

## OTO POST /rest/v2/updateBox — Update Box
Folder: Products. Docs anchor: https://apis.tryoto.com/#d0f104c1-ad85-4685-886f-ad5d18209baf
You can change the dimension information of an existing box. Since the name is unique, you can change the information of that box by entering the name information in the request.
Request example:
{
"name":"xsmall",
"length":3,
"width":4,
"height":3
}
Response OK example:
{
    "success": true,
    "message": "Box successfully updated"
}

## OTO GET /rest/v2/getBox — Get Box
Folder: Products. Docs anchor: https://apis.tryoto.com/#6426c5a4-5e91-497a-8c34-15e03a83c5f1
This API endpoint you to retrieve the name, id and dimension information of all boxes currently in your account.
Response OK example:
{
    "boxes": [
        {
            "length": 10,
            "width": 9,
            "boxName": "medium",
            "id": 2642,
            "height": 5
        }
    ],
    "success": true
}

## OTO POST /rest/v2/updateStockQuantity — Update Stock Quantity
Folder: Stock Management. Docs anchor: https://apis.tryoto.com/#07150d0c-513a-41a6-a5d9-6b974245a796
This API endpoint enables efficient inventory management by allowing you to update the quantity of a SKU in two flexible ways:

Adjust: Modify the existing quantity by adding or deducting a specified amount. To decrease the quantity, provide a negative value for qty. For example, setting qty to -5 will deduct 5 units from the current stock.

Set: Directly set the quantity on hand to a specific value, replacing the current stock with the provided qty.

Request Parameters:

 | 

 | Name
 | Required
 | Type
 | Description

 | actionType
 | yes
 | enum
 | "set","adjust"

 | locationCode
 | yes
 | string
 | Location code of the inventory

 | inventoryType
 | no
 | string
 | Inventory type to update. Default: onHand

 | sku
 | yes
 | string
 | SKU of the product in the inventory

 | qty
 | yes
 | integer
 | Quantity to be set or adjusted in the inventory
Request example:
{
    "actionType": "adjust",
    "locationCode": "ASDS",
    "sku": "156487494561",
    "qty": "40"
}
Response OK example:
{
    "success": true,
    "warnings": [
        "Inventory quantity set to the given qty according to the action type"
    ],
    "transactionID": 591611
}

## OTO GET /rest/v2/checkInventoryStock — Check Inventory Stock
Folder: Stock Management. Docs anchor: https://apis.tryoto.com/#5a10d023-5dbf-4eeb-87b8-9bf56be081a8
This API endpoint allows you to retrieve real-time stock availability for products at specific locations.

It provides detailed information on the quantity of items on hand and forecasted stock for each product at various pickup locations, offering a location-based view of inventory distribution.

Request Parameters:

 | 

 | Name
 | Required
 | Type
 | Description

 | sku
 | yes
 | string
 | The product's SKU identifier

 | pickupLocationCode
 | no
 | string
 | The code representing the specific location.

Response:

success: Indicates whether the request was successful (true or false).

stock: A dictionary with SKUs as keys, containing a list of stock details for each location:

pickupLocationCode: The code representing the specific location.

sku: The product's SKU identifier.

quantityForecasted: The forecasted stock level at the location.

quantityOnHand: The actual available stock at the location.
Response OK example:
{
    "success": true,
    "stock": {
        "SG1": [
            {
                "pickupLocationCode": "DMW",
                "sku": "SG1",
                "quantityForecasted": 261,
                "quantityOnHand": 277
            },
            {
                "sku": "SG1",
                "quantityForecasted": -16,
                "quantityOnHand": -7
            }
        ],
        "SG3": [
            {
                "pickupLocationCode": "DMW",
                "sku": "SG3",
                "quantityForecasted": 55,
                "quantityOnHand": 67
            },
            {
                "sku": "SG3",
                "quantityForecasted": -7,
                "quantity

## OTO GET /rest/v2/checkGlobalStock — Check Global Stock
Folder: Stock Management. Docs anchor: https://apis.tryoto.com/#09452f7c-0b4c-47e8-a491-c82621b5f7e9
This API endpoint provides an overview of total stock availability for SKUs across all locations. This endpoint aggregates stock levels to display a global view, helping businesses understand their overall inventory status.

Request Parameters:

 | 

 | Name
 | Required
 | Type
 | Description

 | sku
 | yes
 | string
 | The product's SKU identifier

Response:

success: Indicates whether the request was successful (true or false).

stock: A dictionary with SKUs as keys, containing global stock details for each product:

sku: The product's unique SKU identifier.

quantityOnHand: The total quantity of the product available across all locations.

quantityForecasted: The total forecasted stock quantity, if applicable.

minInventory: The minimum inventory threshold for the product, if defined.
Response OK example:
{
    "success": true,
    "stock": {
        "12": [
            {
                "minInventory": 50,
                "sku": "12",
                "quantityForecasted": 122,
                "quantityOnHand": 39
            }
        ],
        "123123": [
            {
                "sku": "123123",
                "quantityOnHand": 14
            }
        ]
    }
}

## OTO POST /rest/v2/createInventoryOrder — Create Inventory Order
Folder: Stock Management. Docs anchor: https://apis.tryoto.com/#063dff8d-fed4-4695-9b75-93ffcfc663d0
This API endpoint creates inventory order as inbound or outbound for a warehouse or branch location. This API is used mostly to provide the incoming or outgoing bulk items from ERP systems to OTO. Once the order is created the status will be new for the warehouse or branch to accept and process the order.

Request Parameters:

 | 

 | Name
 | Required
 | Type
 | Description

 | action
 | yes
 | enum
 | "inbound": Creates the order as purchase type and sets the ingoing location field  
"outbound": Creates the order as disposal and sets the outgoing location field

 | locationCode
 | yes
 | string
 | Code of the warehouse or the branch of the inventory

 | binLocationName
 | no
 | string
 | Name of the desired Bin

 | orderDate
 | no
 | date
 | Date of the order, must be a valid date value

 | deliveryDate
 | no
 | date
 | Date of the delivery, must be a valid date value

 | waybillNumber
 | no
 | string
 | WayBillNumber of the order

 | description
 | no
 | string
 | Arbitrary description of the order

 | type
 | no
 | string
 | 

 | items
 | no
 | JSONArray
 | An array of the items of the order

Request paramaters for Items array:

 | 

 | Name
 | Required
 | Type
 | Description

 | sku
 | yes
 | string
 | SKU of the item of the customer that exists on database

 | qty
 | yes
 | integer
 | Quantity of the item, must be a positive number
Request example:
{
    "action":"inbound",
    "locationCode": "WHA",
    "binLocationName": "test",
    "orderDate": "31/03/2022",
    "deliveryDate": "31/03/2023",
    "waybillNumber": "12345",
    "description": "loc1",
    "items": [
        {
            "sku": "123123",
            "qty": "1"
         }
    ]
}

Response OK example:
{
    "success": true,
    "otoId": 4026
}

## OTO POST /rest/v2/updatePackingStatus — Update Packing Status
Folder: Stock Management. Docs anchor: https://apis.tryoto.com/#2951e884-7e5a-47ee-8c21-0c629b6874f7
This API endpoint allows you to update the packing status of an order during the fulfillment process. This endpoint is used to record and track the progress of orders as they move through the packing stage, ensuring accurate status updates for operational visibility.

Request Parameters:

 | 

 | Name
 | Required
 | Type
 | Description

 | orderId
 | yes
 | string
 | Id of the order that you wanna update packing status

 | packingStatus
 | yes
 | string
 | Packing status value can be packed or picked
Request example:
{
    "orderId":"123",
    "packingStatus":"packed"
}
Response OK example:
{
    "success": true,
    "message": "Successfully updated"
}

## OTO POST /rest/v2/getPackingOrders — Get Orders Ready For Packing
Folder: Stock Management. Docs anchor: https://apis.tryoto.com/#10453aef-82b7-4efa-896a-a0bdb203dcbb
This API endpoint retrieves a list of orders that are ready for pick and pack operations. This endpoint is designed to streamline warehouse workflows by providing access to orders that have completed prior processes and are prepared for fulfillment.

Request Parameters:

 | 

 | Name
 | Required
 | Type
 | Description

 | warehouseCode
 | yes
 | String
 | pickupLocationCode of the warehouse.
Request example:
{
    "warehouseCode": "WH123"
}
Response OK example:
{
    "success":true,
    "count": 2,
    "orders": [
        {
            "orderId": "11022",
            "items": [
                {
                    "productId": 112,
                    "name": "test product",
                    "quantity": 1,
                    "sku": "test-product"
                },
                {
                    "name": "test product 2",
                    "quantity": 1,
                    "sku": "test-product-2"
                }
            ]
        },
        {
            "orderId": "11051222",
            "items": [
                {
                    "productId": 12312,
                    "name": "test2 product",
                    "quantit

## OTO POST /rest/v2/availableStoresForPickup — Check Available Stores For Pickup
Folder: Stock Management. Docs anchor: https://apis.tryoto.com/#a2ab47a7-5f91-4717-ad85-26a6ad7f4306
This API endpoint retrieves a list of physical stores where the requested items are currently available for customer pickup. By providing a list of SKUs with required quantities and a selected city, the endpoint validates stock availability and returns eligible stores that can fulfill the pickup request.

The response includes detailed store information such as store name, location coordinates, address details, operating hours by day, and stock status. This endpoint is designed to support omnichannel and click-and-collect flows by enabling marketplaces and merchants to present accurate pickup options to customers based on real-time inventory and location.

 | 

 | Name
 | Required
 | Type
 | Description

 | selectedCity
 | yes
 | string
 | City to filter available pickup stores.

 | items
 | yes
 | array
 | Item list.

Items Array

 | 

 | Name
 | Required
 | Type
 | Description

 | sku
 | no
 | string
 | SKU of the item.

 | qty
 | no
 | double
 | Quantity of the item.
Request example:
{
  "items": [
    {
      "sku": "Umberella-2",
      "qty": 11
    },
    {
      "sku": "Umberella-1",
      "qty": 11
    }
  ],
  "selectedCity": "Jeddah"
}

Response  example:
{
    "success": true,
    "stores": [
        {
            "streetName": "M5M8+5M",
            "storeHours": [
                {
                    "from": "00:00",
                    "to": "23:30",
                    "day": "monday"
                },
                {
                    "from": "00:00",
                    "to": "23:30",
                    "day": "tuesday"
                },
                {
                    "from": "00:00",
                    "to": "23:30",
                    "day": "wednesday"
                },
                {
                    "from": "00:00",
                    "to": "23:30",
                    "day": "thursday"
                },


## OTO POST /rest/v2/availableCitiesForPickup — Available Cities For Pickup
Folder: Stock Management. Docs anchor: https://apis.tryoto.com/#fe4fd93e-bc4a-4c14-bdfd-8dabf60949c3
This API endpoint retrieves a list of cities where in-store pickup is currently supported. It allows marketplaces and merchants to identify eligible cities in which customers can select the pickup option during checkout or order creation. You can enable and disable it. from Warehouse/ Branch form.

The response returns a simple list of city names where pickup-enabled stores are available, helping ensure that pickup options are only displayed for supported locations. This endpoint is designed to enhance pickup and click-and-collect experiences by providing a reliable reference for city-level pickup availability.
Response  example:
{
    "cities": [
        "Jeddah",
        "Aqiq"
    ],
    "success": true
}

## OTO POST /rest/v2/getNationalAddressFromShortCode — Get NationalAddress From ShortCode
Folder: National Address. Docs anchor: https://apis.tryoto.com/#3dc4066c-3984-452b-b811-1c518d04a9ae
This API endpoint accepts a short address code (also called shortAddressCode or national address short code) and returns the complete national address details for the corresponding location in the Kingdom of Saudi Arabia. It allows you to quickly retrieve full address information from the abbreviated code.
Request example:
{
    "shortAddressCode":"RGUC8214"
}
Response OK example:
{
    "data": {
        "zipCode": "12325",
        "country": {
            "unitOfMeasurement": "metricSystem",
            "createdDate": "2020-11-12T08:38:46",
            "nameAr": "المملكة العربية السعودية",
            "dateFormat": "dateFormat.type1",
            "name": "Kingdom of Saudi Arabia",
            "modifiedDate": "2025-12-31T11:59:22",
            "phoneCode": "966",
            "currency": "SAR",
            "id": 1,
            "shortCode": "SA",
            "countrySettings": {
                "monetizedIntroVideoAmount": 10,
                "flag": "Llq%2FIAM8asmOQzLTjHPCrUaI%2F3sqXwd9Hom6M6zcZsern0hyWdMhcWchHUGf0qEWsUBzL7dZWMHdygEgoEhmaA%3D%3D",
                "mone

## OTO POST /rest/v2/webhook — webhook
Folder: Webhook. Docs anchor: https://apis.tryoto.com/#9671ca1f-7d06-43fc-8ee9-cf9c336b088d
This endpoint enables OTO to send update payloads to the specified URL using the defined method. Optional security measures, such as token authentication and payload validation, can be configured for enhanced security.

Request Parameters:

 | 

 | Name
 | Required
 | Type
 | Description

 | method
 | yes
 | string
 | POST or PUT

 | url
 | yes
 | string
 | Your endpoint listens to get OTO webhook payload, when order status changes. exp.https://webhook.site/3e53c98a-a089-4ca4-9bc4-df10e5a71e4b

 | secretKey
 | no
 | string
 | With this key message is signed and receiver validate.(Character limit is 255)

 | authorizationKey
 | no
 | string
 | Secure token used to authenticate and validate incoming webhook requests.(Character limit is 255)

 | timestampFormat
 | no
 | string
 | Exp "yyyy-MM-dd HH:mm:ss" format receiver want to get.

 | orderPrefix
 | no
 | string
 | If orders has prefix in OTO, then put prefix string to be removed before webhook body prepared.

 | webhookType
 | no
 | string
 | shipmentError, sends create shipment error messages; orderStatus sends order status changes, newOrders webhook is used to create orders in a different WMS and walletTransactions sends real-time notifications whenever a wallet transaction
Request example:
{
    "method":"post",
    "url":"https://webhook.site/3e53c98a-a089-4ca4-9bc4-df10e5a71e4b",
    "orderPrefix":"fulfillment",
    "timestampFormat":"2025-01-01 13:14:34",
    "secretKey":"key1234",
    "authorizationKey":"authorizationkey123",
    "webhookType":"shipmentError"
}
Response OK example:
{
    "success": true,
    "id": "59",
    "message": "webhook has been created"
}

## OTO GET /rest/v2/webhook — webhook
Folder: Webhook. Docs anchor: https://apis.tryoto.com/#ac4e1163-dbe4-4b74-a10f-4098731dfc27
This endpoint allows you to retrieve a list of all registered webhook definitions. It provides detailed information about each webhook, including its configuration and associated event triggers, enabling you to manage and review your webhook integrations effectively.

Note: You can filter by id if you know the id of the webhook.

Request Parameters:

 | 

 | Name
 | Required
 | Type
 | Description

 | id
 | no
 | string
 | id of the webhook
Response OK example:
{
    "webhooks": [
        {
            "method": "post",
            "secretKey": "secret123",
            "authorizationKey": "authorization123",
            "timestampFormat": "2025-01-01 10:10:10",
            "id": 59,
            "url": "https://webhook.site/3e53c98a-a089-4ca4-9bc4-df10e5a71e4b",
            "orderPrefix": "fulfillment"
        }
    ],
    "success": true
}

## OTO PUT /rest/v2/webhook — webhook
Folder: Webhook. Docs anchor: https://apis.tryoto.com/#02dab629-9c15-4cc5-973a-363e1745a90f
This API endpoint allows updating an already registered webhook by providing its unique ID. This ensures you can modify existing webhook configurations, such as URL, secretKey, or other parameters, without needing to delete and recreate it.

Request Parameters:

 | 

 | Name
 | Required
 | Type
 | Description

 | id
 | yes
 | string
 | Id of the webhook record.

 | method
 | yes
 | string
 | POST or PUT

 | url
 | yes
 | string
 | Your endpoint listens to get OTO webhook payload, when order status changes. exp.https://webhook.site/3e53c98a-a089-4ca4-9bc4-df10e5a71e4b

 | secretKey
 | no
 | string
 | With this key message is signed and receiver validate.(Character limit is 255)

 | authorizationKey
 | no
 | string
 | Secure token used to authenticate and validate incoming webhook requests.(Character limit is 255)

 | timestampFormat
 | no
 | string
 | Exp "yyyy-MM-dd HH:mm:ss" format receiver want to get.

 | orderPrefix
 | no
 | string
 | If orders has prefix in OTO, then put prefix string to be removed before webhook body prepared.

 | webhookType
 | no
 | string
 | shipmentError, sends create shipment error messages; orderStatus sends order status changes. default is orderStatus and newOrders webhook is used to create orders in a different WMS.
Request example:
{
    "id":59,
    "method":"post",
    "url":"https://webhook.site/3e53c98a-a089-4ca4-9bc4-df10e5a71e4b",
    "orderPrefix":"test-2",
    "timestampFormat":"2025-01-01 10:10:10",
    "secretKey":"secret123",
    "authorizationKey":"authorizationkey123",
    "webhookType":"orderStatus"
}
Response OK example:
{
    "success": true,
    "message": "webhook has been updated"
}

## OTO DELETE /rest/v2/webhook — webhook
Folder: Webhook. Docs anchor: https://apis.tryoto.com/#49a5d0df-b7b3-4e40-b8e4-3cb41783a7fe
This API endpoint enables the removal of a registered webhook from the system using its unique ID. This ensures you can effectively manage and clean up webhook configurations that are no longer needed.

Request Parameters:

 | 

 | Name
 | Required
 | Type
 | Description

 | id
 | yes
 | string
 | Id of the webhook record.
Response  example:
{
    "success": true,
    "message": "webhook has been deleted"
}

## OTO POST /rest/v2/assignDriver — assignDriver
Folder: OTO FLEX. Docs anchor: https://apis.tryoto.com/#8a756562-ee93-4b6e-9de7-9dcd44d4dc41
This API endpoint enables clients to assign a specific driver to their shipments for the OTO Flex app. This endpoint streamlines the allocation process, allowing businesses to efficiently manage driver assignments and ensure smooth delivery operations. Either valid driverID or driverEmail is required.

Request Paramaters:

 | 

 | Name
 | Required
 | Type
 | Description

 | orderIDs
 | yes
 | array
 | An array of orderIDs objects containing the order ids

 | driverID
 | yes (If driverEmail isn't present)
 | long
 | ID of the driver

 | driverEmail
 | yes (If driverID isn't present)
 | string
 | Email of the driver
Request example:
{
  "orderIDs": [3079460],
  "driverID": 8702,
  "driverEmail": "test@driver.com"
}

Response OK example:
{
    "31071127": {
        "success": true,
        "otoId": 31071127
    }
}

## OTO POST /rest/v2/trackDriver — trackDriver
Folder: OTO FLEX. Docs anchor: https://apis.tryoto.com/#8a917f90-4841-48a7-b78e-aaf1b1f7c700
This API endpoint provides real-time location updates for a specific order within the Oto Flex application and for the OTO Flex orders.
By continuously tracking the active driver's GPS position, the endpoint returns a stream of latitude and longitude updates, allowing the client to monitor the order’s movement throughout the delivery journey.

 | 

 | Name
 | Required
 | Type
 | Description

 | orderId
 | yes
 | string
 | OrderId of the OTO flex shipment
Request example:
{
    "orderID": "OID-9885-70000203806"
}
Response  example:
{
    "lng": 29.285591158223777,
    "data": [
        {
            "createdDate": "2025-11-12T18:04:29.273Z",
            "lng": 29.285591158223777,
            "onDuty": true,
            "lat": 40.96489515570657
        },
        {
            "createdDate": "2025-11-12T18:04:08.171Z",
            "lng": 29.286784231123974,
            "onDuty": true,
            "lat": 40.96497927896817
        },
        {
            "createdDate": "2025-11-12T18:01:35.302Z",
            "lng": 29.286580389904795,
            "onDuty": true,
            "lat": 40.96435106894622
        },
        {
            "createdDate": "2025-11-12T18:00:52.093Z",
            "lng": 29.28637669086292,
          
