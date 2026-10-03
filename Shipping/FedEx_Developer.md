## About the Freight API

### **Introduction**

The Freight LTL API allows you to create shipments for less-than-truckload (LTL). LTL freight is too large to be shipped as a parcel but takes up less than an entire truck.

This allows you to get rate estimates, create unique shipping labels for individual handling units and Bills of Lading (when required), schedule pickups and track statuses of the shipment, check availability of and schedule pickups. This results in increased efficiency for your larger and heavier shipments.

LTL shipping at FedEx Freight offers handling-unit-level tracking and visibility for your multi-handling-unit shipments as well as domestic shipping without a paper Bill of Lading (BOL) in most instances. A Bill of Lading can be created when required. Even though all handling units have a unique tracking number, the shipment moves on one Bill of Lading, Delivery Receipt, and Invoice Statement.

### **Freight LTL API details**

The Freight LTL API enables LTL shipping and creates the necessary documents such as Bill of Lading (when requested), FedEx Freight shipping labels, and various other shipping documents. In a Freight LTL shipment, the master label goes on the first handling unit and the child labels are applied to the second and subsequent handling units. Child labels have their own unique tracking numbers but reference the master tracking number. A single Bill of Lading per shipment is created and covers all handling units and pieces.

Each handling unit can be associated with a tracking number and the label is similar to a FedEx Freight Ground or Express Parcel label, with the exception of an F prefix indicating a Freight shipment.

### **Maximums for handling units and pieces**

* Maximum pieces per handling unit: 9,999.  
* Maximum handling units: 200 (when printing handling-unit labels one at a time).  
* Maximum handling units: 40 (when printing handling-unit labels all at once).

FedEx LTL Freight shipments are available to all 50 states as well as Puerto Rico, USVI, Canada, and Mexico. Some shipments require a Bill of Lading in addition to shipping labels (for example, shipments containing hazardous materials).

### **Features available with this API**

* Manage Freight LTL pickup: get freight LTL pickup locations, schedule a freight pickup, and cancel an already-scheduled pickup.  
* Get Freight LTL rate quotes: retrieve rate quotes for a freight LTL shipment based on the locations and service options selected.  
* Ship Freight LTL: create a freight LTL shipment, including a single piece or MPS for all service types — generating shipping label(s) or a Bill of Lading (if required).  
* Create multi-handling-unit shipments and track each handling unit individually.  
* Create LTL shipments using FedEx Freight Priority and Freight Economy services.  
* Provide FedEx Freight Label with standard branding and support specified sizes for thermal labels.  
* Receive notifications via email or SMS during shipping events such as shipping notification, estimated delivery, and pickup notification.  
* Generate shipping documents: individual handling-unit labels, Bill of Lading, Commercial Invoice, and Canadian Customs Invoice.  
* Create shipments and print labels one handling unit at a time, or process all handling units at once.  
* Retrieve rates of a single piece or MPS shipment for all service types.  
* Check pickup availability, schedule a freight pickup, and cancel a pickup.  
* Create and schedule pickup with third-party accounts for an alternate billing address.

**Freight C.O.D.: end of support:** Carrier does not provide C.O.D. (Collect on Delivery) service to customers. Carrier will not be liable for collection of C.O.D. amounts as this is not a service provided by Carrier. All storage, reconsignment, and freight charges will apply to shipments marked C.O.D.

### **Freight LTL shipping services**

**FedEx Freight® Priority** — Industry-leading on-time performance and fast transit times. Count on regional service for extensive next-day and second-day delivery to your customers, all backed by a no-fee money-back guarantee.

* Fast transit times — next-day service up to 600 miles and second-day service up to 1,600 miles.  
* Direct delivery to virtually every ZIP code in the U.S., Canada, and Mexico.  
* Consistent, on-time reliability.  
* A no-fee money-back guarantee.  
* State-of-the-art information technology with end-to-end shipment visibility.  
* A dedicated team of professionals to assist with all your regional freight needs.

**FedEx Freight® Economy** — Economical LTL delivery focused on basic freight shipping needs, with on-time reliability and careful handling.

* Economical freight solutions.  
* Increased savings for shipments that are less time-sensitive but still need reliable delivery.  
* Consistent, on-time reliability.  
* Direct delivery to virtually every ZIP code in the U.S., Canada, Mexico, and Puerto Rico.  
* State-of-the-art information technology with end-to-end shipment visibility.  
* Improved visibility with end-to-end shipment tracking.

### **Freight LTL multi-piece shipment (MPS)**

A multi-piece shipment (MPS) consists of two or more handling units shipped to the same recipient. The first handling unit is considered the master and its sequenceNumber must equal 1\.

#### **Print handling-unit labels one at a time**

Set oneLabelAtATime: true to process MPS shipments and get labels one at a time. The first request generates a label with a master tracking number; pass that master tracking number via masterTrackingId on each subsequent request to generate child labels (child tracking numbers) for the defined totalPackageCount. Maximum: 200 handling units.

#### **Print all handling-unit labels at once**

Set oneLabelAtATime: false to process MPS shipments and generate all labels in a single transaction. Ideal for shipments with 40 or fewer handling units (totalPackageCount ≤ 40\) destined to the same recipient. The 40-handling-unit limit is indicative — the actual limit also depends on the combination of handling units and commodities.

### **FedEx Freight Direct**

Freight Direct provides delivery of large or palletized goods, including delivery of heavy, bulky shipments inside customers' homes or businesses. The same Rate, Ship, and Pickup endpoints support Freight Direct when the additional fields below are supplied.

* Enables creation of FedEx Freight Direct basic, basic-by-appointment, standard, and premium delivery shipments and basic return shipments / pickups within the continental United States, Alaska, and Hawaii.  
* Includes the ability to obtain a complete rate estimate for a Freight Direct shipment using a Freight Direct account number, and the ability to cancel a Freight Direct pickup. Rate estimates are not returned for Alaska or Hawaii — call FedEx Freight customer service for those states.  
* Email notifications can be sent to the original shipper / consignee for delivery scheduling, delivery / pickup confirmation, out-for-delivery / pickup notification, en-route notifications, and a customer survey for delivered shipments.  
* Business rules for ZIP-code validation, dimensions, piece weight, and handling-unit weight apply to Freight Direct to determine the correct combination of line-haul and first / last-mile services.  
* Required fields for Freight Direct: freightDirectType (BASIC, BASIC\_BY\_APPOINTMENT, STANDARD, or PREMIUM), freightDirectTransportationType (DELIVERY or PICKUP), email, phone, phoneNumberType (HOME, MOBILE, or WORK), weight, and non-negative dimensions.

### **Business rules**

* A master tracking (Pro) number is assigned to a Freight LTL shipment's first handling unit, and child tracking numbers are assigned to each subsequent handling unit.  
* Each handling unit in the shipment can be tracked individually or as part of the entire shipment.  
* Other documents may apply to specific shipments (for example, Freight Hazardous Materials \[HazMat\] and international shipments).  
* "LTL Freight only" and "Bill to LTL Freight" accounts cannot be added to the FedEx Freight Developer Portal.  
* Customers can use either the long-term single LTL account number or a FedEx Freight Direct account number to use Freight Direct services.  
* FedEx Freight Direct rating capabilities are only available in the regular LTL API.  
* All new errors / messaging will be in English only.  
* Email address and phone are required as part of FedEx Freight Direct service-option requests when creating shipments.

# API Authorization

**Note:** This API is limited to 5 calls per second.

**Get Access Token**

## Getting Started

#### **Step 1 – Create API Project**

Create an API project in the Developer Portal. The project represents your application's integration with the API and is used to manage credentials, configuration, and access. Once the project is created, you can associate it with the appropriate APIs and environments and begin using your Client ID and Client Secret for authorization.

#### **Step 2 – Request an Access Token**

Send a POST request to the token endpoint:

POST (Sandbox) https\://auth-qa.fedexfreight.com/am/oauth2/access\_token

OR

POST (Production) https\://auth.fedexfreight.com/am/oauth2/access\_token

Content-Type: application/x-www-form-urlencoded

grant\_type=client\_credentials

client\_id=\<your-client-id\>

client\_secret=\<your-client-secret\>

scope=fxf-api

**Example Response:**

{

  "access\_token": "eyJhbGciOiJSUzI1NiIsInR5...",

  "token\_type": "Bearer",

  "expires\_in": 3600

}

#### **Step 3 – Call the API**

Include the access token in the Authorization header of every API request:

POST https\://\<api-endpoint\>/resource

Authorization: Bearer \<access\_token\>

### **Token Management**

| Property | Details |
| :---- | :---- |
| **Token Type** | Bearer (JWT) |
| **Expiry** | 3600 seconds (60 mins) by default |
| **Renewal** | Request a new token before or upon expiry |
| **Revocation** | Tokens can be revoked upon client deregistration |

**Note:** Your application should handle token expiry gracefully by detecting 401 Unauthorized responses and automatically requesting a new token.

### **Security Best Practices**

* Never share or expose your Client Secret publicly.  
* Store credentials in a secure vault or environment variables.  
* Use HTTPS for all API communication.  
* Request only the scopes your application needs.  
* Rotate your Client Secret periodically or immediately if compromised.

## Get Access Token

**POST**/am/oauth2/access\_token

Exchange your Client ID and Client Secret for an OAuth 2.0 access token. The returned bearer token must be included in the Authorization header of every Freight API request and expires 3600 seconds (60 minutes) after issuance.

### **Required input information**

* Client ID issued to your registered application.  
* Client Secret issued to your registered application.  
* grant\_type set to client\_credentials.  
* scope set to fxf-api.

### **Successful response includes**

* access\_token — the JWT bearer token to include on subsequent API calls.  
* token\_type — always Bearer.  
* expires\_in — token lifetime in seconds (3600 / 60 minutes).

**Note:** Use the sandbox endpoint (auth-qa.fedexfreight.com) while testing. Switch to the production endpoint (auth.fedexfreight.com) when promoting your integration.

**Note:** Tokens cannot be refreshed — request a new token before or upon expiry.

**Note:** FedEx Freight APIs do not support Cross-Origin Resource Sharing (CORS) mechanism.

To learn more about how to get OAuth access token, refer to API Authorization documentation.

### **Request Body schema**application/x-www-form-urlencoded

**grant\_typerequired**string

**Example:** client\_credentials

OAuth 2.0 grant type. Must be set to client\_credentials for Freight API authorization.

**client\_idrequired**string

Client ID issued to your application when the API project was created in the Developer Portal.

**client\_secretrequired**string

Client Secret paired with the Client ID. Treat this value as sensitive — never expose it in client-side code or public repositories.

**scoperequired**string

**Example:** fxf-api

Scope of access requested. Use fxf-api to obtain a token valid for FedEx Freight APIs.

### **Responses**

**200400401**

### **Response Schema**application/json

**access\_token**string

JWT bearer token to include on subsequent FedEx Freight API requests.

**token\_type**string

**Example:** Bearer

Token type. Always Bearer for this endpoint.

**expires\_in**integer

**Example:** 3600

Lifetime of the token in seconds. Default is 3600 (60 minutes).

## Get Access Token

**POST**/am/oauth2/access\_token

Exchange your Client ID and Client Secret for an OAuth 2.0 access token. The returned bearer token must be included in the Authorization header of every Freight API request and expires 3600 seconds (60 minutes) after issuance.

### **Required input information**

* Client ID issued to your registered application.  
* Client Secret issued to your registered application.  
* grant\_type set to client\_credentials.  
* scope set to fxf-api.

### **Successful response includes**

* access\_token — the JWT bearer token to include on subsequent API calls.  
* token\_type — always Bearer.  
* expires\_in — token lifetime in seconds (3600 / 60 minutes).

**Note:** Use the sandbox endpoint (auth-qa.fedexfreight.com) while testing. Switch to the production endpoint (auth.fedexfreight.com) when promoting your integration.

**Note:** Tokens cannot be refreshed — request a new token before or upon expiry.

**Note:** FedEx Freight APIs do not support Cross-Origin Resource Sharing (CORS) mechanism.

To learn more about how to get OAuth access token, refer to API Authorization documentation.

### **Request Body schema**application/x-www-form-urlencoded

**grant\_typerequired**string

**Example:** client\_credentials

OAuth 2.0 grant type. Must be set to client\_credentials for Freight API authorization.

**client\_idrequired**string

Client ID issued to your application when the API project was created in the Developer Portal.

**client\_secretrequired**string

Client Secret paired with the Client ID. Treat this value as sensitive — never expose it in client-side code or public repositories.

**scoperequired**string

**Example:** fxf-api

Scope of access requested. Use fxf-api to obtain a token valid for FedEx Freight APIs.

### **Responses**

**200400401**

### **Response Schema**application/json

**access\_token**string

JWT bearer token to include on subsequent FedEx Freight API requests.

**token\_type**string

**Example:** Bearer

Token type. Always Bearer for this endpoint.

**expires\_in**integer

**Example:** 3600

Lifetime of the token in seconds. Default is 3600 (60 minutes).

## Rate Freight

**POST**/fxf-external-rate-auth0/fxfgw/rate/getRateQuote

Use this endpoint to request a list of all possible Freight rate quotes and optional transit information based on input details. Rates retrieved are based on the origin, destination, and various other inputs in the shipment. Additional information such as carrier code, service type, or service option can be used to get more accurate results.

### **Required input information**

* Freight Account Number.  
* Freight Requested Shipment (origin, destination, total weight, packaging type, service type, line items).

### **Successful response includes**

* A list of all possible Freight rate quotes for the requested shipment.  
* Optional transit-time and commit information when returnTransitTimes is true.  
* Errors and descriptions in the case of any failures.

**Note:** Freight Direct rate estimates are not returned for Alaska or Hawaii. Customers should call FedEx Freight customer service to request a quote for those states.

**Note:** To get Freight Direct rates, include the freightDirectType (BASIC, BASIC\_BY\_APPOINTMENT, STANDARD, or PREMIUM) and freightDirectTransportationType (DELIVERY or PICKUP) along with weight and non-negative dimensions.

**Note:** FedEx Freight APIs do not support Cross-Origin Resource Sharing (CORS) mechanism.

To learn more about how to get OAuth access token, refer to API Authorization documentation.

### **Header Parameters**

**x-client-idrequired**string

**Example:** 06ff26de-dd66-4c92-9545-d0fe94288017

This element tells the API which application is calling, enabling routing, throttling, and auditing, while authentication is still handled separately. When you created your application during the integration setup flow, a Client ID was generated for you. This Client ID identifies your application when it calls the API. You must include this Client ID in every API request as an HTTP header.

**x-customer-transaction-id**string

**Example:** 624deea6-b709-470c-8c39-4b5511281492

This element allows you to assign a unique identifier to your transaction. This element is also returned in the reply and helps you match the request to the reply.

**content-typerequired**string

**Example:** application/json

This is used to indicate the media type of the resource. The media type is a string sent along with the file indicating format of the file.

**x-locale**string

**Example:** en\_US

This indicates the combination of language code and country code. Click here to see Locales.

**authorizationrequired**string

**Example:** Bearer XXX

This indicates the authorization token for the input request.

### **Request Body schema**application/json

**accountNumberrequired**object

This is the Account number details.

Note: If this is a shipping account number, use the account number used for creating the Auth Token.

**value**string

**Example:** XXX456XXX

This is the account number. Maximum length is 9\.

**rateRequestControlParameters**object

Various parameters you can provide for filtering and sorting capability in the response, such as transit time and commit data, rate sort order, etc.

**returnTransitTimes**boolean

Indicate if the transit time and commit data are to be returned in the reply. Default value is false.

**servicesNeededOnRateFailure**boolean

Specify the services to be requested if the rate data is not available.

**variableOptions**string

Enum: "SATURDAY\_DELIVERY" "FREIGHT\_GUARANTEE"

Specify service options whose combinations are to be considered when replying with available services.

**rateSortOrder**string

Enum: "COMMITASCENDING" "SERVICENAMETRADITIONAL" "COMMITDESCENDING"

Sort order you can specify to control the order of the response data:

SERVICENAMETRADITIONAL — data in order of highest to lowest service (default).

COMMITASCENDING — data in order of ascending delivery commitment.

COMMITDESCENDING — data in order of descending delivery commitment.

**freightRequestedShipmentrequired**object

The shipment data describing the shipment for which a freight rate quote (or rate-shopping comparison) is desired. Includes serviceType (FedEx Freight Priority or FedEx Freight Economy), packagingType, totalWeight, origin, destination, and freight line items.

**carrierCodes**Array of strings

Optional list of carrier codes the rate quote should be filtered by. Use the FedEx Freight carrier code(s) to constrain results to LTL Freight services.

**version**object

API version identifier (serviceId, major, intermediate, minor).

### **Responses**

**200 Success400 Bad Request401 Unauthorized403 Forbidden404 Not Found500 Failure503 Service Unavailable**

### **Response Schema**application/json

**transactionId**string

**Example:** 624deea6-b709-470c-8c39-4b5511281492

The transaction ID is a special set of numbers that defines each transaction.

**customerTransactionId**string

**Example:** AnyCo\_order123456789'

This element allows you to assign a unique identifier to your transaction. This element is also returned in the reply and helps you match the request to the reply.

**output**object

The response received for the freight pickup availability request.

## Get Special Service Options

**POST**/fxf-external-rate-auth0/fxfgw/rate/specialServiceOptions

Use this endpoint to retrieve the list of special service options that are available for a given Freight LTL shipment and carrier(s). Returns the special services (such as signature options, lift-gate, inside pickup or delivery, and hazardous materials) that can be applied to the shipment, allowing your application to present only the valid options to the user before submitting a rate or ship request.

### **Required input information**

* Freight Requested Shipment (origin, destination, total weight, packaging type, service type, line items).  
* Freight carrier code(s) — the FedEx Freight carrier code(s) the special-service options should be evaluated against.

### **Successful response includes**

* List of available special services for the requested shipment, grouped by service type and carrier.  
* Indicator of whether signature options are available for the shipment.  
* For each available special service: value, special service type, sub-type, and sequence number.  
* Errors and descriptions in the case of any failures.

**Note:** This endpoint is typically called before Rate Freight LTL or Ship Freight LTL so the calling application can present only the special-service options that are valid for the shipment \+ carrier combination.

**Note:** The shipment payload uses the same RequestedShipment structure as Rate Freight LTL and Ship Freight LTL.

**Note:** FedEx Freight APIs do not support Cross-Origin Resource Sharing (CORS) mechanism.

To learn more about how to get OAuth access token, refer to API Authorization documentation.

### **Header Parameters**

**x-client-idrequired**string

**Example:** 06ff26de-dd66-4c92-9545-d0fe94288017

This element tells the API which application is calling, enabling routing, throttling, and auditing, while authentication is still handled separately. When you created your application during the integration setup flow, a Client ID was generated for you. This Client ID identifies your application when it calls the API. You must include this Client ID in every API request as an HTTP header.

**x-customer-transaction-id**string

**Example:** 624deea6-b709-470c-8c39-4b5511281492

This element allows you to assign a unique identifier to your transaction. This element is also returned in the reply and helps you match the request to the reply.

**content-typerequired**string

**Example:** application/json

This is used to indicate the media type of the resource. The media type is a string sent along with the file indicating format of the file.

**x-locale**string

**Example:** en\_US

This indicates the combination of language code and country code. Click here to see Locales.

**authorizationrequired**string

**Example:** Bearer XXX

This indicates the authorization token for the input request.

### **Request Body schema**application/json

**requestedShipmentrequired**object

The shipment data describing the Freight LTL shipment for which special-service options should be evaluated. Includes serviceType (FedEx Freight Priority or FedEx Freight Economy), packagingType, totalWeight, origin, destination, and freight line items.

**carrierCodesrequired**Array of strings

List of FedEx Freight carrier code(s) to evaluate special-service availability against. Limit results to FedEx Freight carriers (for example FXFE for FedEx Freight Economy or FXNL for FedEx Freight Priority).

### **Responses**

**200 Success400 Bad Request401 Unauthorized403 Forbidden404 Not Found500 Failure503 Service Unavailable**

### **Response Schema**application/json

**transactionId**string

**Example:** 624deea6-b709-470c-8c39-4b5511281492

The transaction ID is a special set of numbers that defines each transaction.

**customerTransactionId**string

**Example:** AnyCo\_order123456789'

This element allows you to assign a unique identifier to your transaction. This element is also returned in the reply and helps you match the request to the reply.

**output**object

The response received for the freight pickup availability request.

## Get Special Service Options

**POST**/fxf-external-rate-auth0/fxfgw/rate/specialServiceOptions

Use this endpoint to retrieve the list of special service options that are available for a given Freight LTL shipment and carrier(s). Returns the special services (such as signature options, lift-gate, inside pickup or delivery, and hazardous materials) that can be applied to the shipment, allowing your application to present only the valid options to the user before submitting a rate or ship request.

### **Required input information**

* Freight Requested Shipment (origin, destination, total weight, packaging type, service type, line items).  
* Freight carrier code(s) — the FedEx Freight carrier code(s) the special-service options should be evaluated against.

### **Successful response includes**

* List of available special services for the requested shipment, grouped by service type and carrier.  
* Indicator of whether signature options are available for the shipment.  
* For each available special service: value, special service type, sub-type, and sequence number.  
* Errors and descriptions in the case of any failures.

**Note:** This endpoint is typically called before Rate Freight LTL or Ship Freight LTL so the calling application can present only the special-service options that are valid for the shipment \+ carrier combination.

**Note:** The shipment payload uses the same RequestedShipment structure as Rate Freight LTL and Ship Freight LTL.

**Note:** FedEx Freight APIs do not support Cross-Origin Resource Sharing (CORS) mechanism.

To learn more about how to get OAuth access token, refer to API Authorization documentation.

### **Header Parameters**

**x-client-idrequired**string

**Example:** 06ff26de-dd66-4c92-9545-d0fe94288017

This element tells the API which application is calling, enabling routing, throttling, and auditing, while authentication is still handled separately. When you created your application during the integration setup flow, a Client ID was generated for you. This Client ID identifies your application when it calls the API. You must include this Client ID in every API request as an HTTP header.

**x-customer-transaction-id**string

**Example:** 624deea6-b709-470c-8c39-4b5511281492

This element allows you to assign a unique identifier to your transaction. This element is also returned in the reply and helps you match the request to the reply.

**content-typerequired**string

**Example:** application/json

This is used to indicate the media type of the resource. The media type is a string sent along with the file indicating format of the file.

**x-locale**string

**Example:** en\_US

This indicates the combination of language code and country code. Click here to see Locales.

**authorizationrequired**string

**Example:** Bearer XXX

This indicates the authorization token for the input request.

### **Request Body schema**application/json

**requestedShipmentrequired**object

The shipment data describing the Freight LTL shipment for which special-service options should be evaluated. Includes serviceType (FedEx Freight Priority or FedEx Freight Economy), packagingType, totalWeight, origin, destination, and freight line items.

**carrierCodesrequired**Array of strings

List of FedEx Freight carrier code(s) to evaluate special-service availability against. Limit results to FedEx Freight carriers (for example FXFE for FedEx Freight Economy or FXNL for FedEx Freight Priority).

### **Responses**

**200 Success400 Bad Request401 Unauthorized403 Forbidden404 Not Found500 Failure503 Service Unavailable**

### **Response Schema**application/json

**transactionId**string

**Example:** 624deea6-b709-470c-8c39-4b5511281492

The transaction ID is a special set of numbers that defines each transaction.

**customerTransactionId**string

**Example:** AnyCo\_order123456789'

This element allows you to assign a unique identifier to your transaction. This element is also returned in the reply and helps you match the request to the reply.

**output**object

The response received for the freight pickup availability request.

## Ship Freight

**POST**/fxf-external-ship-auth0/fxfgw/route/freight/shipment

Use this endpoint to validate and create a FedEx Freight LTL shipment. The endpoint produces a Freight shipping label and a Bill of Lading (when required), supports MPS shipments, and returns tracking details and alert details for the created shipment.

In a Freight LTL shipment, the master label goes on the first handling unit and child labels are applied to the second and subsequent handling units. Child labels carry their own unique tracking numbers but reference the master tracking number. A single Bill of Lading per shipment is created and covers all handling units and pieces.

### **Required input information**

* Freight Account Number.  
* Mailing address of the account (may be different from the actual shipping address).  
* Freight Requested Shipment (serviceType, packagingType, totalWeight, totalPackageCount, freightShipmentDetail, requestedPackageLineItems).  
* Label Response Options — labels returned as encoded data (LABEL) or as URL (URL\_ONLY).  
* Master Tracking details — only when the MPS shipment is processed and labels are printed one at a time (oneLabelAtATime: true).

### **Successful response includes**

* Created LTL shipment with tracking details and alert details.  
* Shipping label(s) and / or Bill of Lading depending on the request.  
* Errors and descriptions in the case of any failures.

**Note:** For LTL Freight, set serviceType to FedEx Freight Priority or FedEx Freight Economy.

**Note:** For Freight Direct shipments, also include freightDirectType (BASIC, BASIC\_BY\_APPOINTMENT, STANDARD, PREMIUM), freightDirectTransportationType (DELIVERY or PICKUP), email, phone, and phoneNumberType (HOME, MOBILE, WORK), plus weight and non-negative dimensions.

**Note:** FedEx Freight APIs do not support Cross-Origin Resource Sharing (CORS) mechanism.

To learn more about how to get OAuth access token, refer to API Authorization documentation.

### **Header Parameters**

**x-client-idrequired**string

**Example:** 06ff26de-dd66-4c92-9545-d0fe94288017

This element tells the API which application is calling, enabling routing, throttling, and auditing, while authentication is still handled separately. When you created your application during the integration setup flow, a Client ID was generated for you. This Client ID identifies your application when it calls the API. You must include this Client ID in every API request as an HTTP header.

**x-customer-transaction-id**string

**Example:** 624deea6-b709-470c-8c39-4b5511281492

This element allows you to assign a unique identifier to your transaction. This element is also returned in the reply and helps you match the request to the reply.

**content-typerequired**string

**Example:** application/json

This is used to indicate the media type of the resource. The media type is a string sent along with the file indicating format of the file.

**x-locale**string

**Example:** en\_US

This indicates the combination of language code and country code. Click here to see Locales.

**authorizationrequired**string

**Example:** Bearer XXX

This indicates the authorization token for the input request.

### **Request Body schema**application/json

**accountNumberrequired**object

This is the Account number details.

Note: If this is a shipping account number, use the account number used for creating the Auth Token.

**rateRequestControlParameters**object

Various parameters you can provide for filtering and sorting capability in the response, such as transit time and commit data, rate sort order, etc.

**freightRequestedShipmentrequired**object

The full shipment definition: ship date, pickup type, service type (FedEx Freight Priority or Economy), packaging type, total weight, total package count, shipper, recipient, origin, payment, special services, label specification, freight shipment detail, and requested package line items.

**labelResponseOptionsrequired**string

Enum: "URL\_ONLY" "LABEL"

If the value is LABEL, the encoded label is included in the response. If the value is URL\_ONLY, the response includes the URLs.

Note: with URL\_ONLY, the URL is active for 24 hours after creation.

**oneLabelAtATime**boolean

**Example:** true or false

If false, all packages of an MPS shipment are processed in a single transaction and labels are generated all at once (up to 40 handling units). If true, packages and labels are processed one at a time (up to 200 handling units), and the master tracking number returned by the first call must be passed back via masterTrackingId on subsequent calls. Default value is false.

**masterTrackingId**object

Master tracking details returned by the first request of a one-label-at-a-time MPS shipment. Required on subsequent requests so child labels reference the master.

**version**object

API version identifier (serviceId, major, intermediate, minor).

### **Responses**

**200 Success400 Bad Request401 Unauthorized403 Forbidden404 Not Found500 Failure503 Service Unavailable**

### **Response Schema**application/json

**transactionId**string

**Example:** 624deea6-b709-470c-8c39-4b5511281492

The transaction ID is a special set of numbers that defines each transaction.

**customerTransactionId**string

**Example:** AnyCo\_order123456789'

This element allows you to assign a unique identifier to your transaction. This element is also returned in the reply and helps you match the request to the reply.

**output**object

The response received for the freight pickup availability request.

## Check Freight Pickup Availability

**POST**/fxf-external-pickup-auth0/fxfgw/pickup/availability

Use this endpoint to request a list of all available freight pickup locations along with the pickup schedule details — the carrier, latest available time of pickup, default latest available time, availability for pickup, time when the package is ready to be picked up, indication of whether the address is residential, cutoff time of the pickup, and the driver's access time to pick up the package.

### **Required input information**

* Pickup address / postal details.  
* Pickup request type (e.g., same day or future day).  
* Whether the pickup is domestic or international.

### **Successful response includes**

* List of available freight pickup locations.  
* Delivery day, availability flag, pickup date, cutoff time, access time, residential availability flag, close-time flag, close time, and local time.  
* Errors and descriptions in the case of any failures.

**Note:** Use a correct and valid pickup address.

**Note:** For Freight Direct pickup, include freightDirectType (BASIC, BASIC\_BY\_APPOINTMENT, STANDARD, PREMIUM), freightDirectTransportationType (DELIVERY or PICKUP), and weight.

**Note:** FedEx Freight APIs do not support Cross-Origin Resource Sharing (CORS) mechanism.

To learn more about how to get OAuth access token, refer to API Authorization documentation.

### **Header Parameters**

**x-client-idrequired**string

**Example:** 06ff26de-dd66-4c92-9545-d0fe94288017

This element tells the API which application is calling, enabling routing, throttling, and auditing, while authentication is still handled separately. When you created your application during the integration setup flow, a Client ID was generated for you. This Client ID identifies your application when it calls the API. You must include this Client ID in every API request as an HTTP header.

**x-customer-transaction-id**string

**Example:** 624deea6-b709-470c-8c39-4b5511281492

This element allows you to assign a unique identifier to your transaction. This element is also returned in the reply and helps you match the request to the reply.

**content-typerequired**string

**Example:** application/json

This is used to indicate the media type of the resource. The media type is a string sent along with the file indicating format of the file.

**x-locale**string

**Example:** en\_US

This indicates the combination of language code and country code. Click here to see Locales.

**authorizationrequired**string

**Example:** Bearer XXX

This indicates the authorization token for the input request.

### **Request Body schema**application/json

**pickupAddressrequired**object

The address for which the pickup availability inquiry is made.

**packageReadyTimerequired**string

The time the package will be ready for pickup. Format HH:MM:SS, in the local time zone of the pickup address.

**customerCloseTimerequired**string

The latest time the driver gets access to pick up the package. Format HH:MM:SS, in the local time zone of the pickup address.

**pickupRequestType**Array of strings

Identifies the type of the pickup request (e.g., SAME\_DAY or FUTURE\_DAY).

**shipmentAttributes**object

The shipment details such as service type (FedEx Freight Priority or Economy), packaging type, weight, and dimensions.

**numberOfBusinessDays**integer

**Example:** 3

Number of business days to consider when checking availability.

For example, if pickupDate is Saturday and 3 is supplied, Saturday, Sunday, and Monday are considered.

**carriers**Array of strings

List of FedEx Freight carrier code(s) the availability check should be limited to.

**dispatchDate**string

The date the package is to be picked up. Format YYYY-MM-DD. If omitted, the system uses the current date.

**freightPickupSpecialServiceDetail**object

Special services requested at the time of pickup, such as inside pickup or liftgate.

### **Responses**

**200 Success400 Bad Request401 Unauthorized403 Forbidden404 Not Found500 Failure503 Service Unavailable**

### **Response Schema**application/json

**transactionId**string

**Example:** 624deea6-b709-470c-8c39-4b5511281492

The transaction ID is a special set of numbers that defines each transaction.

**customerTransactionId**string

**Example:** AnyCo\_order123456789'

This element allows you to assign a unique identifier to your transaction. This element is also returned in the reply and helps you match the request to the reply.

**output**object

The response received for the freight pickup availability request.

## Create Freight Pickup

**POST**/fxf-external-pickup-auth0/fxfgw/pickup/create

Use this endpoint to create and schedule a Freight pickup. You can also schedule a pickup for third-party accounts by providing alternate, valid address details.

### **Required input information**

* Freight Account Number — the account that will be invoiced for the pickup.  
* Origin details (address, location, and pickup-address type such as account / shipper / other).  
* Address details for the associated account.

### **Successful response includes**

* Pickup confirmation number.  
* Pickup notification details.  
* Location code for the pickup being scheduled.  
* Errors and descriptions in the case of any failures.

**Note:** Use a correct and valid pickup address and provide the correct account address of record to schedule the pickup.

**Note:** Past ready times, past dates, or dates too far in the future cannot be used to schedule a pickup.

**Note:** Anonymous pickups are not allowed.

**Note:** For Freight Direct pickup, include freightDirectType, freightDirectTransportationType, email, phone, and phoneNumberType.

**Note:** FedEx Freight APIs do not support Cross-Origin Resource Sharing (CORS) mechanism.

To learn more about how to get OAuth access token, refer to API Authorization documentation.

### **Header Parameters**

**x-customer-transaction-id**string

**Example:** 624deea6-b709-470c-8c39-4b5511281492

This element allows you to assign a unique identifier to your transaction. This element is also returned in the reply and helps you match the request to the reply.

**content-typerequired**string

**Example:** application/json

This is used to indicate the media type of the resource. The media type is a string sent along with the file indicating format of the file.

**x-locale**string

**Example:** en\_US

This indicates the combination of language code and country code. Click here to see Locales.

**authorizationrequired**string

**Example:** Bearer XXX

This indicates the authorization token for the input request.

### **Request Body schema**application/json

**originDetailrequired**object

Origin location details for the pickup including pickup location address, ready timestamp, and company close time.

**freightPickupDetailrequired**object

Detailed pickup information for Freight LTL: account number, payment, role, line items, and trailer / truck details.

**associatedAccountNumber**object

The associated account number which is invoiced for the freight pickup.

**trackingNumber**string

**Example:** XXXX0365XXXX

A tracking number used for tracking a single package or a group of FedEx Freight packages.

**remarks**string

**Example:** Please ring bell at loading dock.

Free-form message passed to the FedEx pickup courier.

**billableAccountNumber**string

The account number that should be billed for the pickup if different from the associated account.

### **Responses**

**200 Success400 Bad Request401 Unauthorized403 Forbidden404 Not Found500 Failure503 Service Unavailable**

### **Response Schema**application/json

**transactionId**string

**Example:** 624deea6-b709-470c-8c39-4b5511281492

The transaction ID is a special set of numbers that defines each transaction.

**customerTransactionId**string

**Example:** AnyCo\_order123456789'

This element allows you to assign a unique identifier to your transaction. This element is also returned in the reply and helps you match the request to the reply.

**output**object

The response received for the freight pickup availability request.

## Cancel Freight Pickup

**PUT**/fxf-external-pickup-auth0/fxfgw/pickup/cancel

Use this endpoint to cancel an already scheduled Freight pickup request. A successful cancellation returns a confirmation number and a pickup-cancellation confirmation message.

### **Required input information**

* Pickup Confirmation Code (obtained when the pickup was scheduled).  
* Scheduled Date — the date the pickup dispatch occurs.  
* Location — the FedEx Freight location responsible for processing the pickup request (only applies to FDXE).

### **Successful response includes**

* Pickup cancellation confirmation number and message.  
* Errors and descriptions in the case of any failures.

**Note:** Submit the pickup confirmation number along with the corresponding location code (for FDXE) to cancel a scheduled pickup.

**Note:** Use the correct account address of record to cancel the pickup.

**Note:** A failure notification is sent if you attempt to cancel a pickup after the FedEx Freight courier has been dispatched.

**Note:** FedEx Freight APIs do not support Cross-Origin Resource Sharing (CORS) mechanism.

To learn more about how to get OAuth access token, refer to API Authorization documentation.

### **Header Parameters**

**x-customer-transaction-id**string

**Example:** 624deea6-b709-470c-8c39-4b5511281492

This element allows you to assign a unique identifier to your transaction. This element is also returned in the reply and helps you match the request to the reply.

**content-typerequired**string

**Example:** application/json

This is used to indicate the media type of the resource. The media type is a string sent along with the file indicating format of the file.

**x-locale**string

**Example:** en\_US

This indicates the combination of language code and country code. Click here to see Locales.

**authorizationrequired**string

**Example:** Bearer XXX

This indicates the authorization token for the input request.

### **Request Body schema**application/json

**pickupConfirmationCoderequired**string

**Example:** XXXX1007MEM62XXXX

The confirmation number provided by FedEx to the customer when the pickup was scheduled or requested.

**associatedAccountNumber**object

**Example:** Your account number

Specifies the FedEx Freight account number associated with the pickup.

**scheduledDate**string

**Example:** 2019-10-15

The date when the pickup dispatch was scheduled.

Format YYYY-MM-DD.

**reason**string

The reason for cancelling the pickup.

**contactName**string

The name of the contact requesting the cancellation.

**carrierCode**string

The FedEx Freight carrier code for which the pickup was scheduled.

**remarks**string

Additional information passed to the pickup courier.

### **Responses**

**200 Success400 Bad Request401 Unauthorized403 Forbidden404 Not Found500 Failure503 Service Unavailable**

### **Response Schema**application/json

**transactionId**string

**Example:** 624deea6-b709-470c-8c39-4b5511281492

The transaction ID is a special set of numbers that defines each transaction.

**customerTransactionId**string

**Example:** AnyCo\_order123456789'

This element allows you to assign a unique identifier to your transaction. This element is also returned in the reply and helps you match the request to the reply.

**output**object

The response received for the freight pickup availability request.

## Track By Track Number

**POST**/fxf-external-tracking-auth0/fxfgw/route/track/v1/trackingnumbers

Use this endpoint to track packages based on a tracking number — including a FedEx Freight master Pro number, a child handling-unit number, a Door Tag number, or a FedEx Office order number — for various FedEx services. Up to 30 tracking numbers may be submitted in a single request.

### **Required input information**

* Tracking number (maximum 30 tracking numbers per request).  
* Detailed scans to be included (true / false).

### **Successful response includes**

* Tracking results for each input tracking number, including latest status, last updated destination / location, and distance to destination.  
* Any special handling details and the full scan-event history.  
* Return information in the case of a return shipment.  
* Errors and descriptions in the case of any failures.

**Note:** For Freight LTL, this endpoint accepts the master tracking (Pro) number assigned to the first handling unit or any child tracking number assigned to subsequent handling units.

**Note:** Tracking by master tracking number returns data for all associated child tracking numbers.

**Note:** FedEx Freight APIs do not support Cross-Origin Resource Sharing (CORS) mechanism.

To learn more about how to get OAuth access token, refer to API Authorization documentation.

### **Header Parameters**

**x-client-idrequired**string

**Example:** 06ff26de-dd66-4c92-9545-d0fe94288017

This element tells the API which application is calling, enabling routing, throttling, and auditing, while authentication is still handled separately. When you created your application during the integration setup flow, a Client ID was generated for you. This Client ID identifies your application when it calls the API. You must include this Client ID in every API request as an HTTP header.

**x-customer-transaction-id**string

**Example:** 624deea6-b709-470c-8c39-4b5511281492

This element allows you to assign a unique identifier to your transaction. This element is also returned in the reply and helps you match the request to the reply.

**content-typerequired**string

**Example:** application/json

This is used to indicate the media type of the resource. The media type is a string sent along with the file indicating format of the file.

**x-locale**string

**Example:** en\_US

This indicates the combination of language code and country code. Click here to see Locales.

**authorizationrequired**string

**Example:** Bearer XXX

This indicates the authorization token for the input request.

### **Request Body schema**application/json

**includeDetailedScans**boolean

**Example:** true

Indicates whether to include the full scan-event history for each tracking number in the response.

**trackingInforequired**Array of objects

List of tracking numbers (and optional shipment date range / shipper account number) to track. Up to 30 tracking entries may be submitted in a single request.

### **Responses**

**200 Success400 Bad Request401 Unauthorized403 Forbidden404 Not Found500 Failure503 Service Unavailable**

### **Response Schema**application/json

**transactionId**string

**Example:** 624deea6-b709-470c-8c39-4b5511281492

The transaction ID is a special set of numbers that defines each transaction.

**customerTransactionId**string

**Example:** AnyCo\_order123456789'

This element allows you to assign a unique identifier to your transaction. This element is also returned in the reply and helps you match the request to the reply.

**output**object

The response received for the freight pickup availability request.

## Search Associated Shipments

**POST**/fxf-external-tracking-auth0/fxfgw/route/track/v1/associatedShipments

Use this endpoint to retrieve all shipments associated with a master tracking number. Supports multiple association types — STANDARD\_MPS (standard multi-piece shipment), GROUP\_MPS (grouped shipments), and OUTBOUND\_LINK\_TO\_RETURN (outbound shipment linked to its return). For FedEx Freight LTL this is the primary way to look up every handling-unit tracking number that hangs off a master Pro number.

### **Required input information**

* Master tracking number information (tracking number and optional ship-date range).  
* Association type — STANDARD\_MPS, GROUP\_MPS, or OUTBOUND\_LINK\_TO\_RETURN.

### **Successful response includes**

* List of every associated shipment for the supplied master tracking number, including each child handling-unit tracking number and its detailed tracking-entry information.  
* Latest status, last updated destination / location, distance to destination, and any special handling details for each child shipment.  
* Full scan-event history when includeDetailedScans is true, plus return information in the case of a return shipment.  
* Errors and descriptions in the case of any failures.

**Note:** For Freight LTL, the master Pro number is assigned to the first handling unit and child tracking numbers are assigned to each subsequent handling unit. Use this endpoint with associatedType set to STANDARD\_MPS to retrieve every child handling unit attached to a Freight master Pro.

**Note:** Use the pagingDetails object to walk large result sets when a master shipment has many associated handling units or grouped shipments.

**Note:** FedEx Freight APIs do not support Cross-Origin Resource Sharing (CORS) mechanism.

To learn more about how to get OAuth access token, refer to API Authorization documentation.

### **Header Parameters**

**x-client-idrequired**string

**Example:** 06ff26de-dd66-4c92-9545-d0fe94288017

This element tells the API which application is calling, enabling routing, throttling, and auditing, while authentication is still handled separately. When you created your application during the integration setup flow, a Client ID was generated for you. This Client ID identifies your application when it calls the API. You must include this Client ID in every API request as an HTTP header.

**x-customer-transaction-id**string

**Example:** 624deea6-b709-470c-8c39-4b5511281492

This element allows you to assign a unique identifier to your transaction. This element is also returned in the reply and helps you match the request to the reply.

**content-typerequired**string

**Example:** application/json

This is used to indicate the media type of the resource. The media type is a string sent along with the file indicating format of the file.

**x-locale**string

**Example:** en\_US

This indicates the combination of language code and country code. Click here to see Locales.

**authorizationrequired**string

**Example:** Bearer XXX

This indicates the authorization token for the input request.

### **Request Body schema**application/json

**masterTrackingNumberInforequired**object

Master tracking number information for the shipment, including the tracking number, optional carrier code, and ship-date range.

**associatedTyperequired**string

Enum: "STANDARD\_MPS" "GROUP\_MPS" "OUTBOUND\_LINK\_TO\_RETURN"

**Example:** STANDARD\_MPS

Identifies the type of association to look up. STANDARD\_MPS returns the child handling units of a multi-piece shipment, GROUP\_MPS returns the members of a grouped shipment, and OUTBOUND\_LINK\_TO\_RETURN returns the return shipment linked to an outbound shipment.

**pagingDetails**object

Paging details (page number and page size) for retrieving large association result sets in batches.

**includeDetailedScans**boolean

If true, the response includes the full scan-event history for each associated shipment.

### **Responses**

**200 Success400 Bad Request401 Unauthorized403 Forbidden404 Not Found500 Failure503 Service Unavailable**

### **Response Schema**application/json

**transactionId**string

**Example:** 624deea6-b709-470c-8c39-4b5511281492

The transaction ID is a special set of numbers that defines each transaction.

**customerTransactionId**string

**Example:** AnyCo\_order123456789'

This element allows you to assign a unique identifier to your transaction. This element is also returned in the reply and helps you match the request to the reply.

**output**object

The response received for the freight pickup availability request.

## Track By Reference

**POST**/fxf-external-tracking-auth0/fxfgw/route/track/v1/referencenumbers

Use this endpoint to track packages by an alternate reference rather than a tracking number — for example a customer reference, purchase order (PO), invoice number, Bill of Lading (BOL), or part number. Either a FedEx account number or a destination postal-code / country pair (with a ship-date range) is required.

### **Required input information**

* Reference type and value (BILL\_OF\_LADING, CUSTOMER\_REFERENCE, INVOICE, PURCHASE\_ORDER, etc.).  
* FedEx account number — or destination postal code, destination country code, and ship-date range when an account number is not provided.  
* Detailed scans to be included (true / false).

### **Successful response includes**

* Tracking results for every shipment matching the supplied reference value(s).  
* Detailed tracking-entry information, latest status, last updated destination / location, and distance to destination.  
* Any special handling details and the full scan-event history.  
* Return information in the case of a return shipment.  
* Errors and descriptions in the case of any failures.

**Note:** With a FedEx Express, FedEx Freight, or FedEx Ground shipment, the customer's reference number is coded as either Shipper Reference or Customer Reference.

**Note:** Returns Material Authorization (RMA) is not available for FedEx Freight®.

**Note:** If a tracking number is also supplied, the tracking number takes precedence over the reference value.

**Note:** FedEx Freight APIs do not support Cross-Origin Resource Sharing (CORS) mechanism.

To learn more about how to get OAuth access token, refer to API Authorization documentation.

### **Header Parameters**

**x-client-idrequired**string

**Example:** 06ff26de-dd66-4c92-9545-d0fe94288017

This element tells the API which application is calling, enabling routing, throttling, and auditing, while authentication is still handled separately. When you created your application during the integration setup flow, a Client ID was generated for you. This Client ID identifies your application when it calls the API. You must include this Client ID in every API request as an HTTP header.

**x-customer-transaction-id**string

**Example:** 624deea6-b709-470c-8c39-4b5511281492

This element allows you to assign a unique identifier to your transaction. This element is also returned in the reply and helps you match the request to the reply.

**content-typerequired**string

**Example:** application/json

This is used to indicate the media type of the resource. The media type is a string sent along with the file indicating format of the file.

**x-locale**string

**Example:** en\_US

This indicates the combination of language code and country code. Click here to see Locales.

**authorizationrequired**string

**Example:** Bearer XXX

This indicates the authorization token for the input request.

### **Request Body schema**application/json

**referenceTyperequired**string

**Example:** BILL\_OF\_LADING

Type of reference being supplied. Valid values include BILL\_OF\_LADING, CUSTOMER\_REFERENCE, INVOICE, PURCHASE\_ORDER, SHIPPER\_REFERENCE, and DEPARTMENT.

**valuerequired**string

The reference value to search by.

**accountNumber**object

FedEx account number associated with the shipment. Required when destination postal / country and ship-date range are not provided.

**destinationCountryCode**string

ISO country code of the shipment destination. Required when accountNumber is not supplied.

**destinationPostalCode**string

Postal code of the shipment destination. Required when accountNumber is not supplied (for postal-aware countries).

**shipDateRangeBegin**string

Start of the ship-date range to search within. Format YYYY-MM-DD.

**shipDateRangeEnd**string

End of the ship-date range to search within. Format YYYY-MM-DD.

**includeDetailedScans**boolean

Indicates whether to include the full scan-event history in the response.

### **Responses**

**200 Success400 Bad Request401 Unauthorized403 Forbidden404 Not Found500 Failure503 Service Unavailable**

### **Response Schema**application/json

**transactionId**string

**Example:** 624deea6-b709-470c-8c39-4b5511281492

The transaction ID is a special set of numbers that defines each transaction.

**customerTransactionId**string

**Example:** AnyCo\_order123456789'

This element allows you to assign a unique identifier to your transaction. This element is also returned in the reply and helps you match the request to the reply.

**output**object

The response received for the freight pickup availability request.

## Track By Track Control Number

**POST**/fxf-external-tracking-auth0/fxfgw/route/track/v1/tcn

Use this endpoint to track packages by their Transportation Control Number (TCN). A TCN is a U.S. Department of Defense identifier assigned to government / military shipments. Only one TCN is supported per request.

### **Required input information**

* Transportation Control Number — for example N552428361Y555XXX (only one TCN per request).  
* Detailed scans to be included (true / false).

### **Successful response includes**

* Tracking results for the supplied TCN, including detailed tracking-entry information.  
* Latest status, last updated destination / location, distance to destination, and any special handling details.  
* Full scan-event history and return information in the case of a return shipment.  
* Errors and descriptions in the case of any failures.

**Note:** TCNs are primarily used for U.S. government / military shipments. The canonical Track v1 doc explicitly excludes TCN as a reference type when calling Track By Reference for FedEx Freight, but the dedicated TCN endpoint may still accept Freight shipments that have a TCN attached.

**Note:** For most Freight LTL workflows, Track By Track Number or Track By Reference is the primary lookup mechanism.

**Note:** Do not precede the value with any spaces or with the letters "TCN".

**Note:** FedEx Freight APIs do not support Cross-Origin Resource Sharing (CORS) mechanism.

To learn more about how to get OAuth access token, refer to API Authorization documentation.

### **Header Parameters**

**x-client-idrequired**string

**Example:** 06ff26de-dd66-4c92-9545-d0fe94288017

This element tells the API which application is calling, enabling routing, throttling, and auditing, while authentication is still handled separately. When you created your application during the integration setup flow, a Client ID was generated for you. This Client ID identifies your application when it calls the API. You must include this Client ID in every API request as an HTTP header.

**x-customer-transaction-id**string

**Example:** 624deea6-b709-470c-8c39-4b5511281492

This element allows you to assign a unique identifier to your transaction. This element is also returned in the reply and helps you match the request to the reply.

**content-typerequired**string

**Example:** application/json

This is used to indicate the media type of the resource. The media type is a string sent along with the file indicating format of the file.

**x-locale**string

**Example:** en\_US

This indicates the combination of language code and country code. Click here to see Locales.

**authorizationrequired**string

**Example:** Bearer XXX

This indicates the authorization token for the input request.

### **Request Body schema**application/json

**tcnInforequired**object

Transportation Control Number details, including the TCN value (only one TCN per request).

**includeDetailedScans**boolean

Indicates whether to include the full scan-event history in the response.

### **Responses**

**200 Success400 Bad Request401 Unauthorized403 Forbidden404 Not Found500 Failure503 Service Unavailable**

### **Response Schema**application/json

**transactionId**string

**Example:** 624deea6-b709-470c-8c39-4b5511281492

The transaction ID is a special set of numbers that defines each transaction.

**customerTransactionId**string

**Example:** AnyCo\_order123456789'

This element allows you to assign a unique identifier to your transaction. This element is also returned in the reply and helps you match the request to the reply.

**output**object

The response received for the freight pickup availability request.

## Track Document

**POST**/fxf-external-tracking-auth0/fxfgw/route/track/v1/trackingdocument

Use this endpoint to retrieve a Signature Proof of Delivery (SPOD), a Bill of Lading (BOL), or a Freight Billing Document (FBD) for a tracked shipment.

### **Required input information**

* Document type — SIGNATURE\_PROOF\_OF\_DELIVERY, BILL\_OF\_LADING, or FREIGHT\_BILLING\_DOCUMENT.  
* Tracking number for the shipment whose document is being requested.  
* Document format — PDF or PNG.

### **Successful response includes**

* For SPOD: an image of the recipient's signature (if available) once the shipment has been delivered.  
* For BOL: a document containing shipment details and the legal contracts of carriage with terms and conditions.  
* For FBD: the shipment invoice.  
* The document is returned as a base64-encoded byte array, which can be decoded to a PDF or PNG.  
* Errors and descriptions in the case of any failures.

**Note:** For Freight LTL, BOL and Freight Billing Document are the most commonly retrieved document types.

**Note:** To retrieve an SPOD that includes the recipient's signature image, the request must include the shipper's billing account number associated with the shipment.

**Note:** SPOD is available for FedEx Express and FedEx Ground shipments only, for up to 16 months after the ship date.

**Note:** FedEx Freight APIs do not support Cross-Origin Resource Sharing (CORS) mechanism.

To learn more about how to get OAuth access token, refer to API Authorization documentation.

### **Header Parameters**

**x-client-idrequired**string

**Example:** 06ff26de-dd66-4c92-9545-d0fe94288017

This element tells the API which application is calling, enabling routing, throttling, and auditing, while authentication is still handled separately. When you created your application during the integration setup flow, a Client ID was generated for you. This Client ID identifies your application when it calls the API. You must include this Client ID in every API request as an HTTP header.

**x-customer-transaction-id**string

**Example:** 624deea6-b709-470c-8c39-4b5511281492

This element allows you to assign a unique identifier to your transaction. This element is also returned in the reply and helps you match the request to the reply.

**content-typerequired**string

**Example:** application/json

This is used to indicate the media type of the resource. The media type is a string sent along with the file indicating format of the file.

**x-locale**string

**Example:** en\_US

This indicates the combination of language code and country code. Click here to see Locales.

**authorizationrequired**string

**Example:** Bearer XXX

This indicates the authorization token for the input request.

### **Request Body schema**application/json

**documentTyperequired**string

**Example:** BILL\_OF\_LADING

Type of document being requested. Valid values are SIGNATURE\_PROOF\_OF\_DELIVERY, BILL\_OF\_LADING, and FREIGHT\_BILLING\_DOCUMENT.

**trackingNumberInforequired**object

Tracking number information identifying the shipment whose document is being requested.

**documentFormatrequired**string

**Example:** PDF

Desired document format — PDF or PNG.

**shipperAccountNumber**object

Shipper's billing account number associated with the shipment. Required to receive an SPOD with a signature image.

### **Responses**

**200 Success400 Bad Request401 Unauthorized403 Forbidden404 Not Found500 Failure503 Service Unavailable**

### **Response Schema**application/json

**transactionId**string

**Example:** 624deea6-b709-470c-8c39-4b5511281492

The transaction ID is a special set of numbers that defines each transaction.

**customerTransactionId**string

**Example:** AnyCo\_order123456789'

This element allows you to assign a unique identifier to your transaction. This element is also returned in the reply and helps you match the request to the reply.

**output**object

The response received for the freight pickup availability request.

## Send Notification

**POST**/fxf-external-tracking-auth0/fxfgw/route/track/v1/notifications

Use this endpoint to set up tracking event notifications for a shipment. Email notifications can be sent to the sender, recipient, and / or other parties for significant shipment events such as tender, delivery exceptions, estimated delivery, and delivery.

### **Required input information**

* Sender name.  
* Recipient email address(es).  
* Notification events — ON\_DELIVERY, ON\_ESTIMATED\_DELIVERY, ON\_EXCEPTION, ON\_TENDER.  
* Tracking number for the shipment whose events should be monitored.

### **Successful response includes**

* Confirmation that the notifications were registered for the specified events.  
* A notification email is sent to the supplied address(es) as and when each event occurs.  
* Errors and descriptions in the case of any failures.

**Note:** Notifications are supported for FedEx Express, FedEx Freight, FedEx Ground, and FedEx Ground® Economy shipments.

**Note:** Up to 4 email recipients can be notified, optionally with a personal message (non-English characters are not supported in the personal message).

**Note:** FedEx Freight APIs do not support Cross-Origin Resource Sharing (CORS) mechanism.

To learn more about how to get OAuth access token, refer to API Authorization documentation.

### **Header Parameters**

**x-client-idrequired**string

**Example:** 06ff26de-dd66-4c92-9545-d0fe94288017

This element tells the API which application is calling, enabling routing, throttling, and auditing, while authentication is still handled separately. When you created your application during the integration setup flow, a Client ID was generated for you. This Client ID identifies your application when it calls the API. You must include this Client ID in every API request as an HTTP header.

**x-customer-transaction-id**string

**Example:** 624deea6-b709-470c-8c39-4b5511281492

This element allows you to assign a unique identifier to your transaction. This element is also returned in the reply and helps you match the request to the reply.

**content-typerequired**string

**Example:** application/json

This is used to indicate the media type of the resource. The media type is a string sent along with the file indicating format of the file.

**x-locale**string

**Example:** en\_US

This indicates the combination of language code and country code. Click here to see Locales.

**authorizationrequired**string

**Example:** Bearer XXX

This indicates the authorization token for the input request.

### **Request Body schema**application/json

**senderEMailAddressrequired**string

Email address of the party requesting the notifications.

**senderContactNamerequired**string

Contact name of the party requesting the notifications.

**trackingEventNotificationDetailrequired**object

Notification details, including tracking number(s), notification events (ON\_DELIVERY, ON\_ESTIMATED\_DELIVERY, ON\_EXCEPTION, ON\_TENDER), recipient email addresses, locale, and optional personal message.

### **Responses**

**200 Success400 Bad Request401 Unauthorized403 Forbidden404 Not Found500 Failure503 Service Unavailable**

### **Response Schema**application/json

**transactionId**string

**Example:** 624deea6-b709-470c-8c39-4b5511281492

The transaction ID is a special set of numbers that defines each transaction.

**customerTransactionId**string

**Example:** AnyCo\_order123456789'

This element allows you to assign a unique identifier to your transaction. This element is also returned in the reply and helps you match the request to the reply.

**output**object

The response received for the freight pickup availability request.

## Get Shipment Visibilities

**POST**/fxf-external-tracking-auth0/fxfgw/route/track/v2/visibilitieslist

Use this endpoint to retrieve a paginated list of FedEx Freight shipments visible to the authenticated account, with filtering and sorting capabilities. This is the Freight Tracking v2 "shipment list" / visibilities feed used to populate dashboards and shipment-management views with the most recent freight activity for an account.

### **Required input information**

* Shipment filter list — at least one filter (date range, status, origin / destination, account, etc.) defining which shipments should be returned.  
* Application type and device type identifiers for the calling client.

### **Successful response includes**

* Paginated list of Freight shipments matching the supplied filters, sorted by the requested sort key.  
* Page token for retrieving the next page of results when more shipments are available.  
* Optional summary count of total matching shipments when isSummaryCount is true.  
* Errors and descriptions in the case of any failures.

**Note:** This is a Freight-specific endpoint (tagged "Freight Tracking" in the API spec) and is intended for retrieving lists of LTL Freight shipments rather than individual parcel tracking.

**Note:** Use updatedSinceTs to retrieve only shipments whose status has changed since a given timestamp — useful for incremental dashboard refresh.

**Note:** FedEx Freight APIs do not support Cross-Origin Resource Sharing (CORS) mechanism.

To learn more about how to get OAuth access token, refer to API Authorization documentation.

### **Header Parameters**

**x-client-idrequired**string

**Example:** 06ff26de-dd66-4c92-9545-d0fe94288017

This element tells the API which application is calling, enabling routing, throttling, and auditing, while authentication is still handled separately. When you created your application during the integration setup flow, a Client ID was generated for you. This Client ID identifies your application when it calls the API. You must include this Client ID in every API request as an HTTP header.

**x-customer-transaction-id**string

**Example:** 624deea6-b709-470c-8c39-4b5511281492

This element allows you to assign a unique identifier to your transaction. This element is also returned in the reply and helps you match the request to the reply.

**content-typerequired**string

**Example:** application/json

This is used to indicate the media type of the resource. The media type is a string sent along with the file indicating format of the file.

**x-locale**string

**Example:** en\_US

This indicates the combination of language code and country code. Click here to see Locales.

**authorizationrequired**string

**Example:** Bearer XXX

This indicates the authorization token for the input request.

### **Request Body schema**application/json

**shipmentFilterListrequired**Array of objects

List of filter criteria (date range, shipment status, origin / destination, account number, etc.) that the returned shipment list should match.

**appType**string

**Example:** WTRK

Application type identifier for the calling client.

**appDeviceType**string

**Example:** WTRK

Application device type identifier for the calling client.

**uniqueKey**string

Unique key for the request, used for correlation across systems.

**processingParameters**object

Processing parameters that control how the request is handled (locale, channel, etc.).

**pageSize**string

Number of shipments to return per page.

**pageToken**string

Opaque pagination token returned by a previous call. Supply to retrieve the next page of results.

**sort**string

Sort key to apply to the returned shipment list (for example by ship date or status).

**updatedSinceTs**string

Return only shipments updated since this timestamp. Useful for incremental refresh of dashboards.

**isSummaryCount**boolean

If true, the response also returns the total summary count of shipments matching the filters.

### **Responses**

**200 Success400 Bad Request401 Unauthorized403 Forbidden404 Not Found500 Failure503 Service Unavailable**

### **Response Schema**application/json

**transactionId**string

**Example:** 624deea6-b709-470c-8c39-4b5511281492

The transaction ID is a special set of numbers that defines each transaction.

**customerTransactionId**string

**Example:** AnyCo\_order123456789'

This element allows you to assign a unique identifier to your transaction. This element is also returned in the reply and helps you match the request to the reply.

**output**object

The response received for the freight pickup availability request.

## Track Shipment Packages

**POST**/fxf-external-tracking-auth0/fxfgw/route/track/v2/shipments

Use this endpoint to retrieve detailed tracking information for one or more FedEx Freight shipment handling units. This is the Freight Tracking v2 endpoint that powers the freight.com tracking UI — accepting up to 30 tracking numbers per request and returning the same handling-unit-level visibility used by FedEx Freight's own customer-facing tracking screens.

### **Required input information**

* Tracking number(s) — the master Pro number assigned to the first handling unit, or any child tracking number assigned to a subsequent handling unit. Up to 30 per request.  
* Carrier code for each tracking number (FedEx Freight carrier code).

### **Successful response includes**

* Detailed tracking information for each tracked handling unit: current status, last updated location, estimated delivery, and special handling details.  
* Full scan-event history for each handling unit.  
* Master and child tracking-number relationships for MPS shipments.  
* Optional current-location and map-view data when supportCurrentLocation / mapView are true.  
* Errors and descriptions in the case of any failures.

**Note:** This is a Freight-specific endpoint (tagged "Freight Tracking" in the API spec) intended for the freight.com tracking UI. For multi-carrier tracking across FedEx Express, Ground, and Freight, use the v1 endpoint Track By Track Number above.

**Note:** Maximum of 30 tracking numbers per request.

**Note:** Use summaryView: true for a lightweight response containing only the latest status; omit it for the full event history.

**Note:** FedEx Freight APIs do not support Cross-Origin Resource Sharing (CORS) mechanism.

To learn more about how to get OAuth access token, refer to API Authorization documentation.

### **Header Parameters**

**x-client-idrequired**string

**Example:** 06ff26de-dd66-4c92-9545-d0fe94288017

This element tells the API which application is calling, enabling routing, throttling, and auditing, while authentication is still handled separately. When you created your application during the integration setup flow, a Client ID was generated for you. This Client ID identifies your application when it calls the API. You must include this Client ID in every API request as an HTTP header.

**x-customer-transaction-id**string

**Example:** 624deea6-b709-470c-8c39-4b5511281492

This element allows you to assign a unique identifier to your transaction. This element is also returned in the reply and helps you match the request to the reply.

**content-typerequired**string

**Example:** application/json

This is used to indicate the media type of the resource. The media type is a string sent along with the file indicating format of the file.

**x-locale**string

**Example:** en\_US

This indicates the combination of language code and country code. Click here to see Locales.

**authorizationrequired**string

**Example:** Bearer XXX

This indicates the authorization token for the input request.

### **Request Body schema**application/json

**trackingInforequired**Array of objects

List of tracking-number entries to track. Each entry contains a trackNumberInfo object with the tracking number, the FedEx Freight carrier code, and an optional unique tracking number id. Up to 30 entries per request.

**appType**string

**Example:** WTRK

Application type identifier for the calling client.

**appDeviceType**string

**Example:** WTRK

Application device type identifier for the calling client.

**uniqueKey**string

Unique key for the request, used for correlation across systems.

**formatType**string

Desired response format type.

**supportHTML**boolean

Indicates whether the response can include HTML-formatted content.

**supportCurrentLocation**boolean

Indicates whether to return the current location of each shipment.

**summaryView**boolean

If true, returns a summary view of the tracking results (latest status only) rather than the full scan-event history.

**mapView**boolean

If true, returns map-view coordinates and metadata.

**guestAuthenticationToken**string

Optional guest authentication token for unauthenticated tracking flows.

### **Responses**

**200 Success400 Bad Request401 Unauthorized403 Forbidden404 Not Found500 Failure503 Service Unavailable**

### **Response Schema**application/json

**transactionId**string

**Example:** 624deea6-b709-470c-8c39-4b5511281492

The transaction ID is a special set of numbers that defines each transaction.

**customerTransactionId**string

**Example:** AnyCo\_order123456789'

This element allows you to assign a unique identifier to your transaction. This element is also returned in the reply and helps you match the request to the reply.

**output**object

The response received for the freight pickup availability request.

## Get Tracking Documents

**POST**/fxf-external-tracking-auth0/fxfgw/route/track/v2/shipments/trackingdocuments

Use this endpoint to retrieve tracking-related documents for a FedEx Freight shipment, including Signature Proof of Delivery (SPOD), Bill of Lading (BOL), Freight Bill (BILL), and Delivery Receipt (DELRECPT). This is the Freight Tracking v2 document-retrieval endpoint and complements Track Shipment Packages above.

### **Required input information**

* Document type (appType) — SPOD, DELRECPT, BOL, or BILL.  
* For SPOD / DELRECPT: spodInfo entries identifying the shipments whose documents are requested.  
* For BOL / BILL: trackingNumber, trackingQualifier, trackingCarrier, destCountry, and an account number (BOL / BILL requests are authenticated).  
* Image type (e.g., PDF, JPEG).

### **Successful response includes**

* Document image returned as a base64-encoded byte array (decode to obtain the final PDF or JPEG).  
* Optional document image URL when available.  
* Errors and descriptions in the case of any failures.

**Note:** This is a Freight-specific endpoint (tagged "Freight Tracking" in the API spec).

**Note:** BOL and BILL requests require authentication — the account number must match the shipper or payer of the shipment.

**Note:** SPOD and DELRECPT requests use the spodInfo array; BOL and BILL requests use the top-level trackingNumber / trackingQualifier / trackingCarrier fields instead.

**Note:** Default image type is PDF when not supplied.

**Note:** FedEx Freight APIs do not support Cross-Origin Resource Sharing (CORS) mechanism.

To learn more about how to get OAuth access token, refer to API Authorization documentation.

### **Header Parameters**

**x-client-idrequired**string

**Example:** 06ff26de-dd66-4c92-9545-d0fe94288017

This element tells the API which application is calling, enabling routing, throttling, and auditing, while authentication is still handled separately. When you created your application during the integration setup flow, a Client ID was generated for you. This Client ID identifies your application when it calls the API. You must include this Client ID in every API request as an HTTP header.

**x-customer-transaction-id**string

**Example:** 624deea6-b709-470c-8c39-4b5511281492

This element allows you to assign a unique identifier to your transaction. This element is also returned in the reply and helps you match the request to the reply.

**content-typerequired**string

**Example:** application/json

This is used to indicate the media type of the resource. The media type is a string sent along with the file indicating format of the file.

**x-locale**string

**Example:** en\_US

This indicates the combination of language code and country code. Click here to see Locales.

**authorizationrequired**string

**Example:** Bearer XXX

This indicates the authorization token for the input request.

### **Request Body schema**application/json

**appTyperequired**string

**Example:** SPOD

Document type to retrieve. Valid values: SPOD, DELRECPT, BOL, BILL.

**appDeviceType**string

**Example:** WTRK

Application device type identifier for the calling client.

**uniqueKey**string

Unique key for the request, used for correlation across systems.

**processingParameters**object

Processing parameters that control how the request is handled.

**spodInfo**Array of objects

List of SPOD entries identifying the shipments whose documents are requested. Required for SPOD / DELRECPT requests.

**trackingNumber**string

Tracking number for the shipment whose document is being requested. Required for BOL / BILL requests.

**trackingQualifier**string

Tracking qualifier for the shipment. Required for BOL / BILL requests.

**trackingCarrier**string

FedEx Freight carrier code for the shipment. Required for BOL / BILL requests.

**destCountry**string

Destination country code for the shipment. Required for BOL / BILL requests.

**accountNumber**string

Account number used to authorize the request. Required for BOL / BILL requests; must match the shipper or payer of the shipment.

**type**string

**Example:** PDF

Image type for the returned document (e.g., PDF, JPEG). Default is PDF.

**opco**string

Operating company code identifying which FedEx operating company processed the shipment.

**shipDate**string

Ship date of the shipment whose document is being requested.

**termsConditionsAccepted**boolean

Indicates whether the terms and conditions for document retrieval have been accepted. Default is true.

**isRawDataRequested**boolean

If true, raw document data is returned in addition to the rendered document. Default is false.

### **Responses**

**200 Success400 Bad Request401 Unauthorized403 Forbidden404 Not Found500 Failure503 Service Unavailable**

### **Response Schema**application/json

**transactionId**string

**Example:** 624deea6-b709-470c-8c39-4b5511281492

The transaction ID is a special set of numbers that defines each transaction.

**customerTransactionId**string

**Example:** AnyCo\_order123456789'

This element allows you to assign a unique identifier to your transaction. This element is also returned in the reply and helps you match the request to the reply.

**output**object

The response received for the freight pickup availability request.

