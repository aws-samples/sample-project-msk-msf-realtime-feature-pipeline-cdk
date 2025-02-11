# Copyright 2025 Amazon.com, Inc. or its affiliates
# SPDX-License-Identifier: MIT-0

import os
import logging
import boto3

import sagemaker
from sagemaker.feature_store.feature_group import FeatureGroup

import dateutil.tz
from datetime import datetime, timedelta

LOGGER = logging.getLogger()
LOGGER.setLevel(logging.INFO)

## Environment variables
region = os.environ['AWS_REGION']
project_namespace = os.environ["PROJECT_NAMESPACE"]
default_bucket = os.environ['QUERY_BUCKET_NAME']
source_feature_group_name = os.environ['SOURCE_FEATURE']
target_feature_group_name = os.environ['TARGET_FEATURE']

# Sagemaker Session
boto_session = boto3.Session(region_name=region)
sagemaker_client = boto_session.client(
    service_name='sagemaker',
    region_name=region
)
featurestore_runtime = boto_session.client(
    service_name='sagemaker-featurestore-runtime',
    region_name=region
)
feature_store_session = sagemaker.Session(
    boto_session=boto_session, 
    sagemaker_client=sagemaker_client, 
    sagemaker_featurestore_runtime_client=featurestore_runtime
)

# Athena query config
query_results_prefix=f'{project_namespace}-featurestore'
output_location = f's3://{default_bucket}/{query_results_prefix}/query-results/'

# Offline store
country_fg = FeatureGroup(name=source_feature_group_name, sagemaker_session=feature_store_session)
country_query = country_fg.athena_query()
country_table = country_query.table_name

def query_offline_store():
    # Today range
    yesterday = datetime.now() - timedelta(days=1)
    aggr_date = yesterday.strftime('%Y%m%d')
    start_date = datetime.combine(yesterday, datetime.min.time())  # 00:00:00
    end_date = datetime.combine(yesterday, datetime.max.time())  # 23:59:59.999999

    # ISO Format
    korea_tz = dateutil.tz.gettz('Asia/Seoul')
    start_date_iso = start_date.astimezone(korea_tz).strftime("%Y-%m-%dT%H:%M:%S.%f")[:-3] + "Z"
    end_date_iso = end_date.astimezone(korea_tz).strftime("%Y-%m-%dT%H:%M:%S.%f")[:-3] + "Z"

    # Batch processing query
    query_string = f'''
        SELECT 
            countycode,
            '{aggr_date}' AS aggr_date,
            SUM(smscount) AS sum_count,
            MAX(eventtime) AS eventtime
        FROM "{country_table}"
        GROUP BY countycode
        HAVING MAX(eventtime) BETWEEN '{start_date_iso}' AND '{end_date_iso}'
    '''
    
    # Execute query
    LOGGER.info('Athena Query - table: %s / datetime : %s ~ %s', country_table, start_date_iso, end_date_iso)
    country_query.run(query_string=query_string, output_location=output_location)
    country_query.wait()
    country_query_df = country_query.as_dataframe()

    return country_query_df

def build_feature_record(country_query_df):
    featurtes = []
    for index, row in country_query_df.iterrows():
        record = [
            {
                'FeatureName': 'location_with_date', 
                'ValueAsString': f"{row['countycode']}#{row['aggr_date']}"
            },
            {
                'FeatureName': 'event_time', 
                'ValueAsString': row['eventtime']
            },
            {
                'FeatureName': 'count', 
                'ValueAsString': str(row['sum_count'])
            },
        ]
        featurtes.append(record)
    return featurtes

def handle(event, context):
    LOGGER.info('Received Event: %s', event)

    # Execute query
    country_query_df = query_offline_store()
    LOGGER.info('Feature query result: %s', country_query_df)

    # Build feature store record
    featurte_records = build_feature_record(country_query_df)
    
    # Update feature store
    for record in featurte_records:
        LOGGER.info('Record: %s', record)
        featurestore_runtime.put_record(
            FeatureGroupName=target_feature_group_name,
            Record=record
        )
    
    LOGGER.info("Done")
