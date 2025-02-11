// Copyright 2025 Amazon.com, Inc. or its affiliates
// SPDX-License-Identifier: MIT-0

import { Construct } from "constructs";
import { 
    Stack, 
    StackProps, 
    aws_ec2 as ec2,
    aws_iam as iam,
} from "aws-cdk-lib";
import * as msk from '@aws-cdk/aws-msk-alpha';
import * as flink from "@aws-cdk/aws-kinesisanalytics-flink-alpha"
import { NagSuppressions } from "cdk-nag";

import { config } from "../config";
import { namespaced, namespacedKey, putParameter, namespacedBucket, getParameter } from "../util/common";
import { PersistentStack } from "./persistent-stack";
import { MskCreateTopicConstruct, ITopicCponfig } from "../constructs/msk-topic-create-construct"
import { ISecurityGroup, IVpc } from "aws-cdk-lib/aws-ec2";
import { FeatureStoreBatchUpdate } from "../constructs/featurestore-batch-update-construct";

export interface StreamingProcessingStackProps extends StackProps {
    readonly persistentStack: PersistentStack;
}

export class StreamingProcessingStack extends Stack {
    constructor(scope: Construct, id: string, props: StreamingProcessingStackProps) {
        super(scope, id, props);

        const { namespace, parameterStoreKeys, mskConfig } = config;
        const { vpc, msfSecurityGroup } = props.persistentStack;

        // MSK Cluster
        const clusterArn = getParameter(this, namespacedKey(parameterStoreKeys.mskEventClusterArn, namespace));
        const cluster = msk.Cluster.fromClusterArn(this, 'MskCluster', clusterArn);

        // Flink app deployment
        const flinkProps = this.createFinkAppProperties();
        const mskTopicNames = [mskConfig.sourceTopic.topicName, mskConfig.sinkTopic.topicName];
        this.deployFlinkApplication(namespace, vpc, msfSecurityGroup, cluster, mskTopicNames, flinkProps);

        // Batch processing offilne feature to online feature
        const sourceFeatureGroupName = getParameter(this, namespacedKey(parameterStoreKeys.featureGroupCouponPrefix, namespace));
        const targetFeatureGroupName = getParameter(this, namespacedKey(parameterStoreKeys.featureGroupLocationDaily, namespace));
        new FeatureStoreBatchUpdate(this, 'FeatureStoreBatchUpdate', {
            sourceFeatureGroupName,
            targetFeatureGroupName,
        })
    }

    private createFinkAppProperties() {
        const { namespace, mskConfig, parameterStoreKeys } = config;
        const bootstrapBrokersSaslIam = getParameter(this, namespacedKey(parameterStoreKeys.mskEventClusterIamBroker, namespace));
        const flinkAppProperties = {
            "Input0": {
                "bootstrap.servers": bootstrapBrokersSaslIam,
                "topic": mskConfig.sourceTopic.topicName,
                "group.id": namespaced("msfconsumer", namespace)
            },
            "Output0": {
                "bootstrap.servers": bootstrapBrokersSaslIam,
                "topic": mskConfig.sinkTopic.topicName,
                "transaction.timeout.ms": "1000"
            },
            "AuthProperties": {
                "sasl.mechanism": "AWS_MSK_IAM",
                "sasl.client.callback.handler.class": "software.amazon.msk.auth.iam.IAMClientCallbackHandler",
                "sasl.jaas.config": "software.amazon.msk.auth.iam.IAMLoginModule required;",
                "security.protocol": "SASL_SSL"
            }
        };
        return flinkAppProperties;
    }

    private deployFlinkApplication(namespace: string, vpc: IVpc, securityGroup: ISecurityGroup, cluster: msk.ICluster, mskTopicNames: string[], flinkProps: any) {
        // Flink App role
        const flinkRole = new iam.Role(this, 'FilnkAppRole', {
            assumedBy: new iam.ServicePrincipal('kinesisanalytics.amazonaws.com'),
            description: 'IAM role for Filnk App',
        });
        // MSK Policy :: https://docs.aws.amazon.com/ko_kr/msk/latest/developerguide/iam-access-control.html
        flinkRole.addToPolicy(new iam.PolicyStatement({
            actions: [
                "kafka-cluster:Connect",
                "kafka-cluster:DescribeCluster",
                "kafka-cluster:DescribeClusterV2",
                "kafka-cluster:AlterCluster",
            ],
            resources: [`arn:aws:kafka:${this.region}:${this.account}:cluster/${cluster.clusterName}/*`],
        }));
        flinkRole.addToPolicy(new iam.PolicyStatement({
            actions: [
                "kafka-cluster:DescribeGroup"
            ],
            resources: [`arn:aws:kafka:${this.region}:${this.account}:group/${cluster.clusterName}/*`],
        }));        
        flinkRole.addToPolicy(new iam.PolicyStatement({
            actions: [
                "kafka-cluster:CreateTopic", 
                "kafka-cluster:DescribeTopic", 
                "kafka-cluster:AlterTopic", 
                "kafka-cluster:DeleteTopic",
                "kafka-cluster:WriteData",
                "kafka-cluster:ReadData",
            ],
            resources: [
                `arn:aws:kafka:${this.region}:${this.account}:topic`,
                `arn:aws:kafka:${this.region}:${this.account}:topic/*`
            ],
        }));
        // Log Events
        flinkRole.addToPolicy(new iam.PolicyStatement({
            effect: iam.Effect.ALLOW,
            actions: [
                "logs:DescribeLogGroups",
                "logs:DescribeLogStreams",
                "logs:CreateLogGroup",
                "logs:CreateLogStream",
                "logs:PutLogEvents",
            ],
            resources: ['*']
        }));
        // VPC Policy
        flinkRole.addToPolicy(new iam.PolicyStatement({
            effect: iam.Effect.ALLOW,
            actions: [
                "ec2:DescribeVpcs",
                "ec2:DescribeSubnets",
                "ec2:DescribeSecurityGroups",
                "ec2:DescribeDhcpOptions",
                "ec2:CreateNetworkInterface",
                "ec2:CreateNetworkInterfacePermission",
                "ec2:DescribeNetworkInterfaces",
                "ec2:DeleteNetworkInterface"
            ],
            resources: ['*']
        }));
        // S3 Access
        flinkRole.addToPolicy(new iam.PolicyStatement({
            effect: iam.Effect.ALLOW,
            actions: [
                "s3:GetObject",
                "s3:GetObjectVersion"
            ],
            resources: ['*']
        }));

        // Filnk app
        const app = new flink.Application(this, 'FlinkApp', {
            applicationName: namespaced('realtime-feature-aggr', namespace),
            code: flink.ApplicationCode.fromAsset('../flink-feature-aggr-app/target/flink-feature-aggr-app-1.0.jar'),
            runtime: flink.Runtime.FLINK_1_19,
            role: flinkRole,
            vpc: vpc,
            vpcSubnets: vpc.selectSubnets({ subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS }),
            securityGroups: [securityGroup],
            propertyGroups: flinkProps
        });

        NagSuppressions.addResourceSuppressions(flinkRole, [
            { id: 'AwsPrototyping-IAMNoWildcardPermissions', reason: 'it is an utility function to deploy flink applications' },
        ], true);
    }
}