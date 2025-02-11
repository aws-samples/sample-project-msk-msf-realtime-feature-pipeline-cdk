import * as msk from '@aws-cdk/aws-msk-alpha';
import { PythonFunction, PythonLayerVersion } from '@aws-cdk/aws-lambda-python-alpha';
import { Construct } from "constructs";
import { 
    Stack,
    RemovalPolicy,
    Duration,
    aws_ec2 as ec2,
    aws_lambda as lambda,
    aws_dynamodb as ddb,
    aws_iam as iam,
    aws_lambda_event_sources as lambda_events
} from "aws-cdk-lib";
import { NagSuppressions } from 'cdk-nag';

export interface MskToFeatureStoreProps {
    namespace: string;
    vpc: ec2.IVpc;
    securityGroup: ec2.ISecurityGroup;  
    cluster: msk.Cluster;
    mskTopicName: string;
}

export class MskToFeatureStore extends Construct {
    constructor(scope: Construct, id: string, props: MskToFeatureStoreProps) {
        super(scope, id);

        const { cluster, mskTopicName } = props;

        // Lambda Function
        const fnStream = this.createFeatureProcessingFunction(id, props);
        
        // Event Trigger
        // MSK event to Lambda : https://docs.aws.amazon.com/ko_kr/lambda/latest/dg/with-kafka.html
        const mskEvent = new lambda_events.ManagedKafkaEventSource({
            clusterArn: cluster.clusterArn,            
            topic: mskTopicName,
            consumerGroupId: 'featurestore',
            startingPosition: lambda.StartingPosition.LATEST            
        });

        fnStream.addEventSource(mskEvent);

        // CDK NagSupressions
        NagSuppressions.addResourceSuppressions(this, [
            { id: 'AwsPrototyping-LambdaLatestVersion', reason: 'sync with develoopement envitonment python 3.11' },
            { id: 'AwsPrototyping-IAMNoWildcardPermissions', reason: 'it is an utility function to access sagemaker/s3/athena/glue resources' },
            { id: 'AwsPrototyping-IAMNoManagedPolicies', reason: 'MSK event source mapping added "AWSLambdaMSKExecutionRole" by default' },
        ], true);
    }

    private createFeatureProcessingFunction(id: string, props: MskToFeatureStoreProps): lambda.Function{
        const stack = Stack.of(this);
        const { namespace, vpc, securityGroup, cluster, mskTopicName } = props;

        const fnStream = new lambda.Function(this, `${id}MskFeatureStoreHandler`, {
            runtime: lambda.Runtime.PYTHON_3_11,
            code: lambda.Code.fromAsset('../lambda/stream-pipeline/msk-to-featurestore-lambda'),
            handler: 'index.handle',
            memorySize: 512,
            architecture: lambda.Architecture.ARM_64,
            vpc: vpc,
            vpcSubnets: vpc.selectSubnets({ subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS }),
            securityGroups: [securityGroup],
            functionName: `${namespace}${id}MskFeatureStoreFunction`,
            timeout: Duration.minutes(5),
            role: new iam.Role(this, `${id}MskFeatureStoreRole`, {
                assumedBy: new iam.ServicePrincipal('lambda.amazonaws.com'),
                inlinePolicies:{
                    "LambdaVpcInvoke": new iam.PolicyDocument({
                        statements: [
                            new iam.PolicyStatement({
                                effect: iam.Effect.ALLOW,
                                actions: [
                                    // Lambda default role in vpc
                                    "logs:CreateLogGroup",
                                    "logs:CreateLogStream",
                                    "logs:PutLogEvents",
                                    "ec2:DescribeVpcs",
                                    "ec2:CreateNetworkInterface",
                                    "ec2:DescribeNetworkInterfaces",
                                    "ec2:DescribeSubnets",
                                    "ec2:DescribeSecurityGroups",
                                    "ec2:DeleteNetworkInterface",
                                    "ec2:AssignPrivateIpAddresses",
                                    "ec2:UnassignPrivateIpAddresses",
                                ],
                                resources: ['*']
                            })
                        ]
                    })
                }
            })
        });

        // Managed Kafka Access
        fnStream.addToRolePolicy(new iam.PolicyStatement({
            effect: iam.Effect.ALLOW,
            actions: [
                "kafka:DescribeCluster",
                "kafka:DescribeClusterV2",
                "kafka:GetBootstrapBrokers",
                "kafka-cluster:Connect",
                "kafka-cluster:DescribeCluster",
                "kafka-cluster:DescribeClusterV2",
                "kafka-cluster:AlterCluster",
                "kafka-cluster:CreateTopic", 
                "kafka-cluster:DescribeTopic", 
                "kafka-cluster:AlterTopic", 
                "kafka-cluster:DeleteTopic",
                "kafka-cluster:WriteData",
                "kafka-cluster:ReadData",
                "kafka-cluster:DescribeGroup",
                "kafka-cluster:AlterGroup",  
                "kafka-cluster:DescribeClusterDynamicConfiguration",              
            ],
            resources: [
                "*"
            ]
        }));
        
        // SageMaker FeatureStore Access
        fnStream.addToRolePolicy(new iam.PolicyStatement({
            effect: iam.Effect.ALLOW,
            actions: [
                "sagemakerfeaturestore:DescribeFeatureGroup",
                "sagemakerfeaturestore:ListFeatureGroups",
                "sagemaker:PutRecord",
                "sagemaker:GetRecord",
                "sagemaker:BatchGetRecord",
                "featurestore-runtime:PutRecord",
                "featurestore-runtime:GetRecord",
                "featurestore-runtime:BatchGetRecord",
                "s3:PutObject",
                "s3:GetBucketAcl",
                "s3:PutObjectAcl",
                "glue:CreateCrawler",
                "glue:StartCrawler",
                "glue:GetCrawler",
                "glue:GetTable",
                "glue:GetPartitions",
                "glue:DeleteCrawler",
                "glue:DeleteDatabase",
                "athena:StartQueryExecution",
                "athena:GetQueryExecution"
            ],
            resources: [
                "*"
            ]
        }));

        return fnStream;
    }

}