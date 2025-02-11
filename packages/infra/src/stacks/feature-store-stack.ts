// Copyright 2025 Amazon.com, Inc. or its affiliates
// SPDX-License-Identifier: MIT-0

import { Construct } from "constructs";
import { 
    Stack, 
    StackProps, 
    CfnOutput,
    RemovalPolicy,
    aws_lambda as lambda,
    aws_s3 as s3,
    aws_iam as iam,
} from "aws-cdk-lib";
import { NagSuppressions } from "cdk-nag";
import { FeatureGroupCreateConstruct, FeatureGroupDefinition } from "../constructs/feature-group-create-construct";

import { config } from "../config";
import { namespaced, namespacedKey, putParameter, namespacedBucket, getParameter } from "../util/common";

export interface FeatureStoreStackProps extends StackProps {

}

export class FeatureStoreStack extends Stack {
    constructor(scope: Construct, id: string, props: FeatureStoreStackProps) {
        super(scope, id, props);
        const { namespace, parameterStoreKeys } = config;

        // Offline Store Bucket
        const offlineStoreBucketName = namespacedBucket('sagemaker-feature-store', namespace, this.account, this.region)!;
        const offlineStoreBucket = this.createOfflineStoreBucket(offlineStoreBucketName);

        // Feature Group Names
        const fgCouponPrefix = namespaced("coupon-prefix-count", namespace)!;        
        const fgLocationInvalid = namespaced("coupon-location-invalid-count", namespace)!;
        const fgLocationDaily = namespaced("coupon-location-daily-count", namespace)!;

        // Feature Group Definition
        const featureGroupDefinitions: FeatureGroupDefinition[] = [
            // real-time features
            {
                featureGroupName: fgCouponPrefix,
                featureDefinition:{
                    "loc_coupon_prefix": "string",
                    "msg_count": "int64",
                    "event_time": "string",
                },
                recordIdentifier: "loc_coupon_prefix",
                eventTime: "event_time"
            }, 
            {
                featureGroupName: fgLocationInvalid,
                featureDefinition:{
                    "location_code": "string",
                    "msg_count": "int64",
                    "event_time": "string",
                },
                recordIdentifier: "location_code",
                eventTime: "event_time"
            },
            // batch updated features
            {
                featureGroupName: fgLocationDaily,
                featureDefinition:{
                    "location_with_date": "string",
                    "msg_count": "int64",
                    "event_time": "string",
                },
                recordIdentifier: "location_with_date",
                eventTime: "event_time"
            }
        ]

        // Create Feature Group
        new FeatureGroupCreateConstruct(this, 'FeatureGroupCreateConstruct', {
            offlineStoreBucket: offlineStoreBucket,
            featureGroupDefinitions: featureGroupDefinitions,
        });

        // Export feature group names
        putParameter(this, namespacedKey(parameterStoreKeys.featureGroupCouponPrefix, namespace), fgCouponPrefix);        
        putParameter(this, namespacedKey(parameterStoreKeys.featureGroupLocationInvalid, namespace), fgLocationInvalid);
        putParameter(this, namespacedKey(parameterStoreKeys.featureGroupLocationDaily, namespace), fgLocationDaily);
        new CfnOutput(this, 'FeatureGroupCouponPrefix', { value: fgCouponPrefix });
        new CfnOutput(this, 'FeatureGroupLocationInvalid', { value: fgLocationInvalid });
        new CfnOutput(this, 'FeatureGroupLocationDaily', { value: fgLocationDaily });
    }

    private createOfflineStoreBucket(offlineStoreBuckerName: string) {
        // Offlinestore Bucket
        const offlineStoreBucket = new s3.Bucket(this, `FeatureStoreBucket`, {
            bucketName: offlineStoreBuckerName,        
            blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
            enforceSSL: true,
            serverAccessLogsPrefix: 'logs/',        
            encryption: s3.BucketEncryption.S3_MANAGED,

            // TO-DO: Review in production
            removalPolicy: RemovalPolicy.DESTROY,
            autoDeleteObjects: true,
        });

        return offlineStoreBucket;
    }
}