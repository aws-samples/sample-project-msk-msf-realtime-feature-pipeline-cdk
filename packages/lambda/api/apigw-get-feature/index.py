# Copyright 2025 Amazon.com, Inc. or its affiliates
# SPDX-License-Identifier: MIT-0

import logging
import os
import json
import boto3

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

def handler(event, context):
    feature_group = event['pathParameters']['featuregroup']
    pk = event['pathParameters']['pk']
    LOGGER.info(f'feature_group: {feature_group}, pk: {pk}')

    feature_record = featurestore_runtime.get_record(
        FeatureGroupName=feature_group, 
        RecordIdentifierValueAsString=pk
    )
    LOGGER.info(feature_record)

    return {
        'statusCode': 200,
        'contentType': 'application/json',
        'headers': {
            'Access-Control-Allow-Origin': '*'
        },
        'body': json.dumps({
            'FeatureGroupName': feature_group,
            'RecordIdentifierValueAsString': pk,
            'Record': feature_record['Record']
        })
    }