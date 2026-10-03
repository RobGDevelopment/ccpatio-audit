# FedEx Freight LTL API - Integration Blueprint (Auth & Rating)

## 1. Authentication (OAuth 2.0)
**Endpoint:** `POST https://auth-qa.fedexfreight.com/am/oauth2/access_token` (Sandbox) / `https://auth.fedexfreight.com/am/oauth2/access_token` (Production)
**Content-Type:** `application/x-www-form-urlencoded`
**Rate Limit:** 5 calls per second. Tokens expire in 3600 seconds.

### Request Body
* `grant_type`: "client_credentials" (Required)
* `client_id`: <your_client_id> (Required)
* `client_secret`: <your_client_secret> (Required)
* `scope`: "fxf-api" (Required)

### Success Response (200 OK)
```json
{
  "access_token": "eyJhbGciOiJSUzI1...",
  "token_type": "Bearer",
  "expires_in": 3600
}
2. Rate Freight
Endpoint: POST /fxf-external-rate-auth0/fxfgw/rate/getRateQuote
Content-Type: application/json

Required Headers
authorization: Bearer <access_token>

x-client-id: <your_client_id>

x-locale: en_US

Request Body Schema (Abridged for Quoting)
JSON
{
  "accountNumber": {
    "value": "XXX456XXX" 
  },
  "freightRequestedShipment": {
    "serviceType": "FEDEX_FREIGHT_ECONOMY", 
    "packagingType": "PALLET",
    "totalWeight": {
      "value": 562.3,
      "units": "LB"
    },
    "origin": {
      "address": {
        "postalCode": "85021",
        "countryCode": "US"
      }
    },
    "destination": {
      "address": {
        "postalCode": "90005",
        "countryCode": "US"
      }
    },
    "requestedPackageLineItems": [
      {
        "weight": {
          "value": 562.3,
          "units": "LB"
        },
        "dimensions": {
          "length": 124,
          "width": 40,
          "height": 34,
          "units": "IN"
        },
        "freightClass": "CLASS_175"
      }
    ]
  }
}