import { Construct } from "constructs";
import{ 
    aws_lambda as lambda,
    aws_lambda_nodejs as nodejs_lambda,
    aws_ec2 as ec2,
    aws_iam as iam,
    custom_resources as cr,
    aws_logs as logs,
    Stack,
    Duration,
    CustomResource,    
 } from 'aws-cdk-lib';
import { PythonFunction } from "@aws-cdk/aws-lambda-python-alpha";
import { NagSuppressions } from "cdk-nag";

export interface ITopicCponfig {
    topicName: string;
    numPartitions: number;
    replicationFactor: number;
}

export interface MskCreateTopicConstructProps {
    namespace: string;
    vpc: ec2.IVpc;
    securityGroup: ec2.ISecurityGroup;    
    mskBootstrapAddress: string;
    mskClusterArn: string;
    mskTopicConfig: ITopicCponfig;
}

export class MskCreateTopicConstruct extends Construct {
    constructor(scope: Construct, id: string, props: MskCreateTopicConstructProps) {
        super(scope, id);

        const stack = Stack.of(this);
        const { vpc, securityGroup, namespace, mskClusterArn, mskBootstrapAddress, mskTopicConfig } = props;

        const kafkaTopicHandler = new PythonFunction(this, `${id}KafkaTopicHandler`, {
            runtime: lambda.Runtime.PYTHON_3_11,
            entry: '../lambda/custom-resource/kafka-topic-create',
            handler: 'handle',
            vpc: vpc,
            vpcSubnets: vpc.selectSubnets({ subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS }),
            securityGroups: [securityGroup],
            functionName: `${namespace}${id}KafkaTopicFunction`,
            timeout: Duration.minutes(10),
            environment: {
                'REGION': stack.region,
                'BOOTSTRAP_ADDRESS': mskBootstrapAddress
            },
            role: new iam.Role(this, `${id}KafkaTopicRole`, {
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
                                    "ec2:CreateNetworkInterface",
                                    "ec2:DescribeNetworkInterfaces",
                                    "ec2:DescribeSubnets",
                                    "ec2:DeleteNetworkInterface",
                                    "ec2:AssignPrivateIpAddresses",
                                    "ec2:UnassignPrivateIpAddresses"
                                ],
                                resources: ['*']
                            })
                        ]
                    })
                    
                    
                }
            })
        });


        // https://docs.aws.amazon.com/msk/latest/developerguide/iam-access-control.html
        kafkaTopicHandler.addToRolePolicy(new iam.PolicyStatement({
            effect: iam.Effect.ALLOW,
            actions: [
                // connect and auth
                "kafka-cluster:Connect",
                "kafka-cluster:AlterCluster",
                "kafka-cluster:DescribeCluster",
                "kafka-cluster:WriteDataIdempotently",
                // topic policy
                "kafka-cluster:CreateTopic", 
                "kafka-cluster:DescribeTopic", 
                "kafka-cluster:AlterTopic", 
                "kafka-cluster:DeleteTopic",
                "kafka-cluster:WriteData",
                "kafka-cluster:ReadData"
            ],
            resources: ['*']
        }));
        
        const kafkaTopicHandlerProvider = new cr.Provider(this, `${id}KafkaTopicHandlerProvider`, {
            onEventHandler: kafkaTopicHandler,
            logRetention: logs.RetentionDays.TWO_WEEKS,
        });

        new CustomResource(this, `${id}KafkaTopicResource`, {
            serviceToken: kafkaTopicHandlerProvider.serviceToken,
            properties: {
                topicConfig: {
                    topic: mskTopicConfig.topicName,
                    numPartitions: mskTopicConfig.numPartitions,
                    replicationFactor: mskTopicConfig.replicationFactor
                }
            }
        });

        NagSuppressions.addResourceSuppressions(this, [
            { id: 'AwsPrototyping-LambdaLatestVersion', reason: 'sync with develoopement envitonment python 3.11' },
            { id: 'AwsPrototyping-IAMNoWildcardPermissions', reason: 'it is an utility function to create custom resource for kafka topics' }
        ], true);
        NagSuppressions.addResourceSuppressions(kafkaTopicHandlerProvider, [
            { id: 'AwsPrototyping-IAMNoManagedPolicies', reason: 'custom resource provider has default role as "AWSLambdaBasicExecutionRole"' },
        ], true);
    }
}