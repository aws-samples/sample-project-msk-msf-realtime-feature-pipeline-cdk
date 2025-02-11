#!/bin/sh

# Feature Group & Feature Identifier (must be url encoded)
FEATURE_GROUP=proto-coupon-prefix-count
FEATURE_IDENTIFIER=loc0000%230000-0000-0000-

# API authorization token
AUTH_HEADER=prototype

# API Gateway URL
cf_outputs=$(aws cloudformation describe-stacks --stack-name proto-ApigwStack --query 'Stacks[0].Outputs')
API_URL=$(echo $cf_outputs | jq -r '.[] | select(.OutputKey | contains("ApiUrl")).OutputValue')

# Request URL
REQUEST_URL=$API_URL'/feature/'$FEATURE_GROUP'/'$FEATURE_IDENTIFIER
echo "==[ Request ]=="
echo $REQUEST_URL
echo ""

# HTTP query
RESPONSE_BODY=$(curl -s -X GET $REQUEST_URL -H 'Authorization: '$AUTH_HEADER)

# Print result (if jq exists, print formatted json)
echo "==[ Response ]=="
if command -v jq >/dev/null 2>&1; then
    echo $RESPONSE_BODY | jq .
else
    echo $RESPONSE_BODY
fi
