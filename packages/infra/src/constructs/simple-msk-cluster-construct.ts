import * as ec2 from "aws-cdk-lib/aws-ec2";
import * as msk from '@aws-cdk/aws-msk-alpha';
import { Construct } from "constructs";

import { RemovalPolicy } from "aws-cdk-lib";
import { CfnThreatIntelSet } from "aws-cdk-lib/aws-guardduty";
export interface SimpleMskClusterProps {
    vpc: ec2.IVpc;
    mskSecurityGroup: ec2.ISecurityGroup;
    clusterName: string;
    removalPolicy?: RemovalPolicy;
}

export class SimpleMskCluster extends Construct {
    readonly cluster: msk.Cluster;

    constructor(scope: Construct, id: string, props: SimpleMskClusterProps) {
        super(scope, id);

        this.cluster = this.createKafkaCluster(props.clusterName, props.vpc, props.mskSecurityGroup);

    }

    private createKafkaCluster(clusterName: string, vpc: ec2.IVpc, securityGroup: ec2.ISecurityGroup): msk.Cluster {
        return new msk.Cluster(this, 'MskCluster', {
            vpc,
            clusterName: clusterName,
            securityGroups: [securityGroup],

            // Instance Type : https://docs.aws.amazon.com/ko_kr/msk/latest/developerguide/msk-create-cluster.html#broker-instance-types
            instanceType: ec2.InstanceType.of(ec2.InstanceClass.T3, ec2.InstanceSize.SMALL),

            // Kafka Version : https://docs.aws.amazon.com/msk/latest/developerguide/supported-kafka-versions.html
            kafkaVersion: msk.KafkaVersion.V3_5_1,
            
            // Authentication : https://docs.aws.amazon.com/msk/latest/developerguide/iam-access-control.html
            encryptionInTransit: { clientBroker: msk.ClientBrokerEncryption.TLS },
            clientAuthentication: msk.ClientAuthentication.sasl({ iam: true }),

            // TO-DO : review in production
            removalPolicy: RemovalPolicy.DESTROY,
        });
    }

    
}