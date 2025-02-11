# Copyright 2025 Amazon.com, Inc. or its affiliates
# SPDX-License-Identifier: MIT-0

import time
import logging
import cfnresponse

import boto3
import sagemaker
from sagemaker.feature_store.feature_group import FeatureGroup
from sagemaker.feature_store.inputs import TableFormatEnum

import pandas as pd

LOGGER = logging.getLogger()
LOGGER.setLevel(logging.INFO)
LOGGER.addHandler(logging.StreamHandler())
LOGGER.info("init function")

# Sagemaker setup
sagemaker_session = sagemaker.Session()

def wait_for_feature_group_creation_complete(feature_group):
    fg_info = feature_group.describe()
    status = fg_info.get('FeatureGroupStatus')
    LOGGER.info(f'Initial status: {status}')
    while status == 'Creating':
        fg_info = feature_group.describe()
        status = fg_info.get('FeatureGroupStatus')
        LOGGER.info(f'Waiting for feature group: {feature_group.name} to be created ...')
        time.sleep(5)
    if status != 'Created':
        fail_reason = fg_info.get('FailureReason')
        raise Exception(f'Failed to create feature group {feature_group.name}: {status}, Reason: {fail_reason}')
    LOGGER.info(f'FeatureGroup {feature_group.name} was successfully created.')

def feature_group_exists(feature_group_name):
    boto_session = boto3.Session() 
    sagemaker_client = boto_session.client(service_name='sagemaker')
    fg_list = sagemaker_client.list_feature_groups()['FeatureGroupSummaries']
    fg = next((item for item in fg_list if item['FeatureGroupName'] == feature_group_name), None)
    return (fg is not None)

def create_feature_group(fg_config):
    LOGGER.info(f'create_feature_group - ')
    # Feature Group Info
    feature_group_name = fg_config["featureGroupName"]
    role = fg_config["creationRoleArn"]
    offlinestore_s3_uri = f's3://{fg_config["offlineStoreBucketName"]}/{feature_group_name}'
    # Data definition
    feature_df = pd.DataFrame(columns=fg_config["featureAttributes"])
    feature_df = feature_df.astype(fg_config["featureDataTypes"])
    record_identifier_name = fg_config["recordIdentifier"]
    event_time_feature_name = fg_config["eventTime"]
    # Feature Group setup
    feature_group = FeatureGroup(name=feature_group_name, sagemaker_session=sagemaker_session)
    feature_group.load_feature_definitions(data_frame=feature_df)
    LOGGER.info(f'load_feature_definitions: {feature_group_name}')
    feature_group.create(
        s3_uri=offlinestore_s3_uri, 
        record_identifier_name=record_identifier_name, ## key 값 
        event_time_feature_name=event_time_feature_name, ## event time (timestamp)
        role_arn=role, ## feature group creatin role
        enable_online_store=True, ## oline store enalblemnt
        table_format=TableFormatEnum.ICEBERG ## ICEBERG or GLUE
    )
    LOGGER.info(f'create_feature_group: requested')
    # wait for creation
    wait_for_feature_group_creation_complete(feature_group)
    LOGGER.info(f'create_feature_group: done')

def delete_feature_group(fg_config):
    # delete frature group
    feature_group_name = fg_config["featureGroupName"]
    feature_group = FeatureGroup(name=feature_group_name, sagemaker_session=sagemaker_session)
    feature_group.delete()

def handle(event, context):
    LOGGER.info('Received Event: %s', event)
    request_type = event['RequestType']
    fg_config = event['ResourceProperties']['fgConfig']
    
    try:
        if request_type == 'Create':
            LOGGER.info('Create : %s', fg_config)
            if feature_group_exists(fg_config["featureGroupName"]):
                LOGGER.info(f'Feature Group {fg_config["featureGroupName"]} already exists. Skipping creation.')
            else:
                create_feature_group(fg_config)
            cfnresponse.send(event, context, cfnresponse.SUCCESS,  {"fgConfig": fg_config })
        elif request_type == 'Update':
            LOGGER.info('Update : %s', fg_config)
            if not feature_group_exists(fg_config["featureGroupName"]):                
                create_feature_group(fg_config)
            cfnresponse.send(event, context, cfnresponse.SUCCESS,  {"fgConfig": fg_config })
        elif request_type == 'Delete':
            LOGGER.info('Delete : %s', fg_config)
            delete_feature_group(fg_config)
            cfnresponse.send(event, context, cfnresponse.SUCCESS)
        else:
            cfnresponse.send(event, context, cfnresponse.FAILED, {"fgConfig": fg_config, "error": f"unknown request type - {request_type}" })
        
    except Exception as e:
        LOGGER.error(e)
        cfnresponse.send(event, context, cfnresponse.FAILED, {"fgConfig": fg_config, "error": str(e) })
    return { "fgConfig": fg_config }