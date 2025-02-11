# Copyright 2025 Amazon.com, Inc. or its affiliates
# SPDX-License-Identifier: MIT-0

def handler(event, context):
    auth_token = event['headers'].get('authorization')
    
    if auth_token == 'prototype':
        return {
            'isAuthorized': True,
            'context': {
                'user': 'prototype-user'
            }
        }
    else:
        return {
            'isAuthorized': False
        }