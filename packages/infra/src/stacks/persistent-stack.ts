// Copyright 2025 Amazon.com, Inc. or its affiliates
// SPDX-License-Identifier: MIT-0

import { Stack, StackProps, RemovalPolicy } from "aws-cdk-lib";
import { Construct } from "constructs";
import { Vpc, IVpc, ISecurityGroup, SecurityGroup } from "aws-cdk-lib/aws-ec2";
import { Table, ITable, AttributeType, BillingMode, TableEncryption, StreamViewType } from "aws-cdk-lib/aws-dynamodb";

import { SimpleVpc } from "../constructs/simple-vpc";
import { config } from "../config";
import { namespaced, namespacedKey, putParameter } from "../util/common";

export interface PersistentStackProps extends StackProps {
    readonly vpcName?: string;
    readonly mskSecurityGroupName?: string;
    readonly lambdaSecurityGroupName?: string;
    readonly logTableName?: string;
    readonly msfSecurityGroupName?: string;
}


export class PersistentStack extends Stack {
    readonly vpc: IVpc;
    readonly logTable: ITable;
    readonly mskSecurityGroup: ISecurityGroup;
    readonly lambdaSecurityGroup: ISecurityGroup;
    readonly msfSecurityGroup: ISecurityGroup;

    constructor(scope: Construct, id: string, props: PersistentStackProps) {
        super(scope, id, props);

        const { vpcName, logTableName, mskSecurityGroupName, lambdaSecurityGroupName, msfSecurityGroupName } = props;
        const { namespace, parameterStoreKeys } = config;

        // VPC Setup
        if(vpcName && mskSecurityGroupName && lambdaSecurityGroupName && msfSecurityGroupName) {
            this.vpc = Vpc.fromLookup(this, 'Vpc', { vpcName });
            this.mskSecurityGroup = SecurityGroup.fromLookupByName(this, 'MskSecurityGroup', mskSecurityGroupName, this.vpc);
            this.lambdaSecurityGroup = SecurityGroup.fromLookupByName(this, 'LambdaSecurityGroup', lambdaSecurityGroupName, this.vpc);
            this.msfSecurityGroup = SecurityGroup.fromLookupByName(this, 'MsfSecurityGroup', msfSecurityGroupName, this.vpc);
        } else {
            const simpleVpcName = namespaced('simple-vpc', namespace)
            const simpleVpc = new SimpleVpc(this, 'SimpleVpc', {vpcName: simpleVpcName});
            this.vpc = simpleVpc.vpc;
            this.mskSecurityGroup = simpleVpc.mskSecurityGroup;
            this.lambdaSecurityGroup = simpleVpc.lambdaSecurityGroup;
            this.msfSecurityGroup = simpleVpc.msfSecurityGroup;
        }

        // Log Table
        if(logTableName) {
            this.logTable = Table.fromTableName(this, 'LogTable', logTableName);
        } else {
            this.logTable = new Table(this, 'LogTable', {
                tableName: namespaced('-log-input', namespace),
                partitionKey: { name: 'msg_id', type: AttributeType.STRING },
                billingMode: BillingMode.PAY_PER_REQUEST,
                encryption: TableEncryption.AWS_MANAGED,
                stream: StreamViewType.NEW_IMAGE,
          
                // TO-DO: check removal policy in production
                removalPolicy: RemovalPolicy.DESTROY,
            });
        }

        // save ddb table name to parameter store
        putParameter(this, namespacedKey(parameterStoreKeys.ddbLogTable, namespace), this.logTable.tableArn);
        putParameter(this, namespacedKey(parameterStoreKeys.ddbLogTableEventSrc, namespace), this.logTable.tableStreamArn!);
    }
}