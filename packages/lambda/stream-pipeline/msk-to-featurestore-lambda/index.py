# Copyright 2025 Amazon.com, Inc. or its affiliates
# SPDX-License-Identifier: MIT-0

import logging
import os
import json
import base64
import boto3
from datetime import datetime
import dateutil.tz

## Environment variables
LOGGER = logging.getLogger()
LOGGER.setLevel(logging.INFO)

REGION = os.environ['AWS_REGION']
LOGGER.info(REGION)

boto_session = boto3.Session(region_name=REGION)

featurestore_runtime = boto_session.client(
    service_name='sagemaker-featurestore-runtime',
    region_name=REGION
)

def load_msk_event_records(records):
    data = []
    for recKey in records:
        rec = records[recKey]    
        for item in rec:
            value = base64.b64decode(item['value'])
            data.append(json.loads(value))
    return data

def format_datetime(inpdt):
    return datetime.strptime(inpdt, '%Y-%m-%d %H:%M:%S.%f').strftime("%Y-%m-%dT%H:%M:%S.%f")[:-3] + "Z"

# Lambda Handler
def handle(event, context):
    LOGGER.info('Received Event')
    LOGGER.info(event)
    
    event_data = load_msk_event_records(event['records'])
    LOGGER.info(event_data)

    for rec in event_data:        
        LOGGER.info(rec)
        feature_group_name = rec['feature_group_name']
        record = []
        for feature in rec:
            if feature == 'event_time':
                record.append({'FeatureName': feature, 'ValueAsString': format_datetime(rec[feature])})
            elif feature != 'feature_group_name':
                record.append({'FeatureName': feature, 'ValueAsString': str(rec[feature])})
            else:
                pass
        
        LOGGER.info(f"put record : {record}")
        featurestore_runtime.put_record(
            FeatureGroupName=feature_group_name,
            Record=record,
            TargetStores=['OnlineStore', 'OfflineStore']
        )
    