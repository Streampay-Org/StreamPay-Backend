#!/bin/bash
set -e

# Configuration
API_URL=${1:-"http://localhost:3000"}
MAX_RETRIES=30
RETRY_INTERVAL=2

echo "Starting StreamPay Smoke Test against $API_URL..."

# 1. Wait for Health Check
echo "Waiting for API to be healthy..."
count=0
until $(curl -sf "$API_URL/health" | grep -q "ok"); do
    if [ $count -eq $MAX_RETRIES ]; then
      echo "Error: API failed to become healthy in time."
      exit 1
    fi
    printf '.'
    sleep $RETRY_INTERVAL
    ((count++))
done
echo -e "\n API is healthy!"

# 2. Test: List Streams (Happy Path)
echo "Testing: List Streams..."
LIST_RESPONSE=$(curl -s -o /dev/null -w "%{http_code}" "$API_URL/api/v1/streams")
if [ "$LIST_RESPONSE" -ne 200 ]; then
    echo "Error: List Streams failed with status $LIST_RESPONSE"
    exit 1
fi
echo "List Streams success (200 OK)"

# 3. Test: Create Stream (Happy Path)
echo "Testing: Create Stream..."
# Note: Using dummy data - adjust keys based on your schema
CREATE_RESPONSE=$(curl -s -o /dev/null -w "%{http_code}" -X POST "$API_URL/api/v1/streams" \
     -H "Content-Type: application/json" \
     -d '{"sender": "test_user", "receiver": "dest_user", "amount": "100", "asset": "XLM"}')

if [ "$CREATE_RESPONSE" -ne 201 ] && [ "$CREATE_RESPONSE" -ne 200 ]; then
    echo "Error: Create Stream failed with status $CREATE_RESPONSE"
    exit 1
fi
echo "Create Stream success ($CREATE_RESPONSE)"

echo "Smoke Test Passed Successfully!"
exit 0
