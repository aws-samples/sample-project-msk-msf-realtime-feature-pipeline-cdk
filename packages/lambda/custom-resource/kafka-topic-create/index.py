# Copyright 2025 Amazon.com, Inc. or its affiliates
# SPDX-License-Identifier: MIT-0

import logging
import os
import json
import socket
from aws_msk_iam_sasl_signer import MSKAuthTokenProvider
from kafka.admin import KafkaAdminClient, NewTopic
import cfnresponse

LOGGER = logging.getLogger()
LOGGER.setLevel(logging.INFO)

BROKERS = os.environ['BOOTSTRAP_ADDRESS'].split(',')
LOGGER.info(BROKERS)

REGION = os.environ['REGION']
LOGGER.info(REGION)

class MSKTokenProvider():
    def token(self):
        token, _ = MSKAuthTokenProvider.generate_auth_token(REGION)
        return token

tp = MSKTokenProvider()

LOGGER.info('Connect to kafka')
admin_client = KafkaAdminClient(
    bootstrap_servers=BROKERS,
    security_protocol='SASL_SSL',
    sasl_mechanism='OAUTHBEARER',
    sasl_oauth_token_provider=tp,
    client_id=socket.gethostname(),
)

def create_topic(topic_name, num_partitions, replication_factor):
    topic_list = []
    topic_list.append(
        NewTopic(
            name=topic_name, 
            num_partitions=int(num_partitions), 
            replication_factor=int(replication_factor)
        )
    )
    admin_client.create_topics(new_topics=topic_list, validate_only=False)

def delete_topic(topic_name):
    admin_client.delete_topics(topics=[topic_name])

def handle(event, context):
    LOGGER.info('Received Event: %s', event)
    request_type = event['RequestType']
    topic_config = event['ResourceProperties']['topicConfig']
    
    try:
        if request_type == 'Create':
            LOGGER.info('Create : %s', topic_config)
            create_topic(topic_config['topic'], topic_config['numPartitions'], topic_config['replicationFactor'])
        elif request_type == 'Update':
            LOGGER.info('Update : %s', topic_config)
            create_topic(topic_config['topic'], topic_config['numPartitions'], topic_config['replicationFactor'])
        elif request_type == 'Delete':
            LOGGER.info('Delete : %s', topic_config)
            delete_topic(topic_config['topic'])
        
        cfnresponse.send(event, context, cfnresponse.SUCCESS,  {"topicConfig": topic_config })
    except Exception as e:
        LOGGER.error(e)
        cfnresponse.send(event, context, cfnresponse.FAILED, {"topicConfig": topic_config })
    return { "topicConfig": topic_config }