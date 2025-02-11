import { Construct } from "constructs";
import{ 
    aws_lambda as lambda,
    aws_iam as iam,
    custom_resources as cr,
    aws_logs as logs,
    aws_s3 as s3,
    Stack,
    Duration,
    CustomResource,    
 } from 'aws-cdk-lib';
import { PythonFunction } from "@aws-cdk/aws-lambda-python-alpha";
import { NagSuppressions } from "cdk-nag";
import { namespaced } from "../util/common";
import config from "../config";

export interface FeatureGroupDefinition {
    featureGroupName: string;
    featureDefinition:{[key: string]: string};
    recordIdentifier: string;
    eventTime: string;
}

export interface FeatureGroupCreateConstructProps {
    featureGroupDefinitions: FeatureGroupDefinition[];
    offlineStoreBucket: s3.IBucket;
}

export class FeatureGroupCreateConstruct extends Construct {
    constructor(scope: Construct, id: string, props: FeatureGroupCreateConstructProps) {
        super(scope, id);
        const { featureGroupDefinitions, offlineStoreBucket } = props;
        const { namespace } = config

        // Role for Create FeatureGroup
        const featureStoreCreationRole = this.createRoleForCreatingFeatureGroup(namespace, offlineStoreBucket.bucketArn);

        // Lambda handler
        const featureGroupHandler = this.buildFeatureStoreHandlerLambda(namespace);
        const featureGroupHandlerProvider = new cr.Provider(this, `${id}FGHandlerProvider`, {
            onEventHandler: featureGroupHandler,
            logRetention: logs.RetentionDays.TWO_WEEKS
        });

        // Create feature groups
        for(const fgDefinition of featureGroupDefinitions) {
            const featureDataTypes = fgDefinition.featureDefinition;
            const featureAttributes = Object.keys(featureDataTypes) as string[]
            new CustomResource(this, `Fg${fgDefinition.featureGroupName}Resource`, {
                serviceToken: featureGroupHandlerProvider.serviceToken,
                properties: {
                    fgConfig: {
                        creationRoleArn: featureStoreCreationRole.roleArn,
                        offlineStoreBucketName: offlineStoreBucket.bucketName,
                        featureGroupName: fgDefinition.featureGroupName,
                        featureAttributes: featureAttributes,
                        featureDataTypes: featureDataTypes,
                        recordIdentifier: fgDefinition.recordIdentifier,
                        eventTime: fgDefinition.eventTime
                    }
                }
            });
        }

        NagSuppressions.addResourceSuppressions(this, [
            { id: 'AwsPrototyping-LambdaLatestVersion', reason: 'sync with develoopement envitonment python 3.11' },
            { id: 'AwsPrototyping-IAMNoWildcardPermissions', reason: 'it is an utility function to create custom resource for kafka topics' }
        ], true);
        NagSuppressions.addResourceSuppressions(featureGroupHandlerProvider, [
            { id: 'AwsPrototyping-IAMNoManagedPolicies', reason: 'custom resource provider has default role as "AWSLambdaBasicExecutionRole"' },
        ], true);
        NagSuppressions.addResourceSuppressions(featureStoreCreationRole, [
            { id: 'AwsPrototyping-IAMNoManagedPolicies', reason: 'custom resource provider has default role as "AWSLambdaBasicExecutionRole"' },
        ], true);
    }

    private createRoleForCreatingFeatureGroup(namespace: string, offlineStoreBucketArn: string) {
        const account = Stack.of(this).account;
        // IAM Role
        const featureStoreRole = new iam.Role(this, 'FeatureStoreRole', {
            roleName: namespaced('feature-group-creation-role', namespace),
            assumedBy: new iam.ServicePrincipal('sagemaker.amazonaws.com'),
            description: 'IAM role for SageMaker Feature Store',
        });
        featureStoreRole.addManagedPolicy(
            iam.ManagedPolicy.fromAwsManagedPolicyName('AmazonSageMakerFeatureStoreAccess')
        );
        // S3 Access
        featureStoreRole.addToPolicy(new iam.PolicyStatement({
            actions: ["s3:GetBucketAcl", "s3:PutObjectAcl", "s3:GetObject", "s3:PutObject"],
            resources: [
                offlineStoreBucketArn,
                `${offlineStoreBucketArn}/*`            ],
        }));
        // Glue
        featureStoreRole.addToPolicy(new iam.PolicyStatement({
            actions: ["glue:GetTable", "glue:UpdateTable"],
            resources: [
                `arn:aws:glue:*:${account}:database/sagemaker_featurestore`,
                `arn:aws:glue:*:${account}:catalog/*`,
                `arn:aws:glue:*:${account}:table/sagemaker_featurestore/*`,
                `arn:aws:glue:*:${account}:catalog`,
            ],
        }));

        return featureStoreRole;
    }

    private buildFeatureStoreHandlerLambda(namespace:string) {
        const featureGroupHandler = new PythonFunction(this, `FeatureGroupHandler`, {
            runtime: lambda.Runtime.PYTHON_3_11,
            entry: '../lambda/custom-resource/feature-group-create',
            handler: 'handle',
            functionName: `${namespace}-FeatureGroupFunction`,
            timeout: Duration.minutes(10),
            memorySize: 4096,
            role: new iam.Role(this, `FeatureGroupRole`, {
                roleName: `${namespace}-CrFeatureGroupLambdaRole`,
                assumedBy: new iam.ServicePrincipal('lambda.amazonaws.com'),
                inlinePolicies:{
                    "LambdaInvoke": new iam.PolicyDocument({
                        statements: [
                            new iam.PolicyStatement({
                                effect: iam.Effect.ALLOW,
                                actions: [
                                    // Lambda default role in vpc
                                    "logs:CreateLogGroup",
                                    "logs:CreateLogStream",
                                    "logs:PutLogEvents",
                                ],
                                resources: ['*']
                            })
                        ]
                    }),
                    "FeatureStore": new iam.PolicyDocument({
                        statements: [
                            new iam.PolicyStatement({
                                effect: iam.Effect.ALLOW,
                                actions: [
                                    "sagemaker:CreateFeatureGroup",
                                    "sagemaker:DeleteFeatureGroup",
                                    "sagemaker:UpdateFeatureGroup",
                                    "sagemaker:DescribeFeatureGroup",
                                    "sagemaker:ListFeatureGroups",
                                    "glue:GetDatabase",
                                    "glue:GetTable",
                                    "glue:CreateTable",
                                    "glue:UpdateTable",
                                    "glue:DeleteTable",
                                    "iam:PassRole",
                                    "sagemaker:AddTags"
                                ],
                                resources: ['*']
                            })
                        ]
                    })
                }
            })
        });

        return featureGroupHandler;
    }
}