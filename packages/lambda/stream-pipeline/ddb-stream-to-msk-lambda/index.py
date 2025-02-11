# Copyright 2025 Amazon.com, Inc. or its affiliates
# SPDX-License-Identifier: MIT-0

import logging
import os
import json
import socket
from kafka import KafkaProducer
from aws_msk_iam_sasl_signer import MSKAuthTokenProvider
from decimal import Decimal
from boto3.dynamodb.types import TypeDeserializer

## Environment variables
LOGGER = logging.getLogger()
LOGGER.setLevel(logging.INFO)

BROKERS = os.environ['BOOTSTRAP_ADDRESS'].split(',')
LOGGER.info(BROKERS)

REGION = os.environ['REGION']
LOGGER.info(REGION)

TOPIC_NAME = os.environ['TOPIC_NAME']
LOGGER.info(TOPIC_NAME)

# MSK Connection
class MSKTokenProvider():
    def token(self):
        token, _ = MSKAuthTokenProvider.generate_auth_token(REGION)
        return token

tp = MSKTokenProvider()

producer = KafkaProducer(
    bootstrap_servers=BROKERS,
    security_protocol='SASL_SSL',
    sasl_mechanism='OAUTHBEARER',
    sasl_oauth_token_provider=tp,
    client_id=socket.gethostname(),
    acks='all',
    request_timeout_ms=60000,
    retry_backoff_ms=500,
    max_block_ms=60000
)

# Json serializer
deserializer = TypeDeserializer()
def dynamodb_deserialize(dynamodb_json_string):
    return deserializer.deserialize({'M': dynamodb_json_string})

class DecimalEncoder(json.JSONEncoder):
  def default(self, obj):
    if isinstance(obj, Decimal):
      return str(obj)
    return json.JSONEncoder.default(self, obj)

# Lambda Handler
def handle(event, context):
    LOGGER.info('Received Event: %s', event)
    for rec in event['Records']:
        LOGGER.info('Record: %s', rec)
        try:
            if rec['dynamodb'] is not None and rec['eventName'] == 'INSERT':
                updatedItem = dynamodb_deserialize(rec['dynamodb']['NewImage'])
                publishData = json.dumps(updatedItem, indent=2, cls=DecimalEncoder).encode("utf-8")
                LOGGER.info("Produced: %s",publishData)
                future = producer.send(TOPIC_NAME, publishData)
                result = future.get(timeout=60)
                LOGGER.info(result)
            else:
                LOGGER.info("No action taken: %s",rec['eventName'])
        except Exception as e:
            LOGGER.error(e)
    