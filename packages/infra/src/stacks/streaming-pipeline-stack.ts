// Copyright 2025 Amazon.com, Inc. or its affiliates
// SPDX-License-Identifier: MIT-0

import { Construct } from "constructs";
import { 
    Stack, 
    StackProps, 
    CfnOutput,
} from "aws-cdk-lib";

import { config } from "../config";
import { namespaced, namespacedKey, putParameter } from "../util/common";
import { PersistentStack } from "./persistent-stack";
import { SimpleMskCluster } from "../constructs/simple-msk-cluster-construct";
import { MskCreateTopicConstruct } from "../constructs/msk-topic-create-construct"
import { DynamoDBStreamsToMsk } from "../constructs/ddb-stream-to-msk-construct";
import { MskToFeatureStore } from "../constructs/msk-to-featurestore-construct";

export interface StreamingPipelineStackProps extends StackProps {
    readonly persistentStack: PersistentStack;
}

export class StreamingPipelineStack extends Stack {
    constructor(scope: Construct, id: string, props: StreamingPipelineStackProps) {
        super(scope, id, props);

        const { namespace, parameterStoreKeys, mskConfig } = config;
        const { vpc, logTable, mskSecurityGroup, lambdaSecurityGroup } = props.persistentStack;
        
        // Create MSK Cluster
        const clusterName = namespaced(mskConfig.clusterName, namespace);
        const mskCluster = new SimpleMskCluster(this, 'MskCluster', { clusterName, vpc, mskSecurityGroup });
        const cluster = mskCluster.cluster;
        
        // Create Msk Topics : source, sink
        // Source Topic
        new MskCreateTopicConstruct(this, 'MskSourceTopic', { 
            namespace,
            vpc,
            securityGroup: lambdaSecurityGroup,
            mskClusterArn: cluster.clusterArn,
            mskBootstrapAddress: cluster.bootstrapBrokersSaslIam,
            mskTopicConfig: mskConfig.sourceTopic
        });

        // Sink Topic
        new MskCreateTopicConstruct(this, 'MskSinkTopic', { 
            namespace,
            vpc,
            securityGroup: lambdaSecurityGroup,
            mskClusterArn: cluster.clusterArn,
            mskBootstrapAddress: cluster.bootstrapBrokersSaslIam,
            mskTopicConfig: mskConfig.sinkTopic
        });

        // DynamoDb Stream to MSK source topic
        new DynamoDBStreamsToMsk(this, 'DdbStreamToMsk', {
            namespace,
            vpc,
            securityGroup: lambdaSecurityGroup,
            ddbTable: logTable,
            cluster: cluster,
            mskTopicName: mskConfig.sourceTopic.topicName
        });

        // MSK sink topic to SageMaker Feature Store        
        new MskToFeatureStore(this, 'MskToFeatureStore', {
            namespace,
            vpc,
            securityGroup: mskSecurityGroup,
            cluster: cluster,
            mskTopicName: mskConfig.sinkTopic.topicName,
        });

        // Export parameters
        new CfnOutput(this, 'MskClusterArn', { value: cluster.clusterArn });
        new CfnOutput(this, 'BootstrapBrokerStringSaslIam', { value: cluster.bootstrapBrokersSaslIam });
        putParameter(this, namespacedKey(parameterStoreKeys.mskEventClusterArn, namespace), cluster.clusterArn);
        putParameter(this, namespacedKey(parameterStoreKeys.mskEventClusterIamBroker, namespace), cluster.bootstrapBrokersSaslIam);
    }
}