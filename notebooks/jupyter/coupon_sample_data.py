# Copyright 2025 Amazon.com, Inc. or its affiliates
# SPDX-License-Identifier: MIT-0

import time
import random
from datetime import datetime, timezone

import boto3
from botocore.exceptions import ClientError

## Data Templates
TEMPLATE = {
    "msg_id": "A12345678",
    "msg_type": "COUPON_VALIDATE",    
    "device_id": "user0001",
    "location_code": "loc4588",
    "coupon_code": "9945-4485-5524-4452",
    "response": "VALID",
    "create_time": "2024-09-01T23:16:01.000"
}
LOCATIONS = [ 'loc0000', 'loc0001','loc0002','loc0003','loc0004','loc0005','loc0006','loc0007','loc0008','loc0009' ]
DEVICES = ['user3127', 'user7687', 'user7193', 'user7339', 'user3385', 'user1445', 'user6151', 'user1482', 'user7426', 'user1154', 'user8348', 'user4378', 'user5877', 'user6869', 'user5661', 'user8697', 'user5254', 'user5159', 'user2425', 'user4339', 'user3251', 'user2117', 'user8221', 'user7634', 'user5931', 'user4733', 'user7722', 'user9446', 'user7134', 'user3445', 'user5595', 'user2666', 'user7351', 'user5125', 'user2439', 'user5195', 'user3275', 'user1465', 'user3136', 'user7283', 'user7115', 'user4957', 'user3829', 'user5994', 'user1193', 'user3126', 'user6664', 'user6274', 'user9586', 'user3565', 'user2589', 'user4755', 'user1539', 'user6819', 'user9313', 'user3373', 'user1711', 'user2817', 'user3989', 'user6524', 'user8468', 'user8822', 'user1333', 'user1693', 'user4862', 'user4329', 'user3951', 'user7173', 'user2936', 'user5799', 'user5438', 'user5846', 'user3531', 'user6181', 'user6445', 'user3449', 'user3797', 'user8865', 'user6368', 'user3917', 'user6819', 'user7835', 'user4126', 'user2176', 'user8332', 'user8165', 'user4642', 'user3253', 'user7854', 'user2746', 'user8331', 'user3288', 'user2712', 'user5121', 'user9858', 'user9398', 'user3729', 'user1442', 'user9563', 'user8568']

## Feaud Message
FRAUD_TEMPLATE = {
    "msg_id": "A12345678",
    "msg_type": "COUPON_VALIDATE",    
    "device_id": "user0000",
    "location_code": "loc0000",
    "coupon_code": "9945-4485-5524-4452",
    "response": "INVALID",
    "create_time": "2024-09-01T23:16:01.000"
}

def _msg_id():
    id_prefix = f'A{int(time.time())}'    
    id_seq = 0
    while True:
        id_seq = id_seq+1
        yield f'{id_prefix}{id_seq}'
msg_id = _msg_id()

def _generate_coupon_code():
    digits = ''.join(str(random.randint(0, 9)) for _ in range(16))
    coupon_code = f"{digits[0:4]}-{digits[4:8]}-{digits[8:12]}-{digits[12:16]}"
    return coupon_code

def get_valid_message():
    template = TEMPLATE.copy()
    template['msg_id'] = next(msg_id)
    template['coupon_code'] = _generate_coupon_code()
    template['device_id'] = DEVICES[random.randint(0, 99)]
    template['location_code'] = LOCATIONS[random.randint(0, 9)]
    template['create_time'] = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%S.%f")[:-3]
    return template

def _fraud_message(fraud_coupon_code):
    attack_seq = 0
    FRAUD_COUPON_CODE = fraud_coupon_code
    while True:
        template = FRAUD_TEMPLATE.copy()
        template['msg_id'] = next(msg_id)
        template['coupon_code'] = '{}{:04d}'.format(FRAUD_COUPON_CODE[:-4], attack_seq)
        template['create_time'] = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%S.%f")[:-3]
        attack_seq = attack_seq + 1
        yield template

fraud_generators = {}
def get_fraud_message(fraud_coupon_code):
    if fraud_coupon_code not in fraud_generators:
        fraud_generators[fraud_coupon_code] = _fraud_message(fraud_coupon_code)
    return next(fraud_generators[fraud_coupon_code])

dynamodb = boto3.resource('dynamodb')
table = None
def batch_write_items(table_name, items):
    global table
    if table is None:
        table = dynamodb.Table(table_name)
    try:
        with table.batch_writer() as batch:
            for item in items:
                batch.put_item(Item=item)
        print(f"Successfully wrote {len(items)} items to table {table_name}")
        return True
        
    except ClientError as err:
        print(
            "Couldn't load data into table %s. reason: %s: %s",
            table_name,
            err.response["Error"]["Code"],
            err.response["Error"]["Message"],
        )
        raise
