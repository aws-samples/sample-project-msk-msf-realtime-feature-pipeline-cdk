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
} from "aws-cdk-lib";
import { NagSuppressions } from "cdk-nag";

export interface DynamoDBStreamsToMskProps {
    namespace: string;
    vpc: ec2.IVpc;
    securityGroup: ec2.ISecurityGroup;  
    cluster: msk.Cluster;
    ddbTable: ddb.ITable;
    mskTopicName: string;
}

export class DynamoDBStreamsToMsk extends Construct {
    constructor(scope: Construct, id: string, props: DynamoDBStreamsToMskProps) {
        super(scope, id);

        const { namespace, vpc, securityGroup, cluster, ddbTable, mskTopicName } = props;

        // Lambda Function
        const fnStream = this.createDdbStreamProcessingFunction(id, props);
        
        // Event Trigger
        // DynamoDB Stream Event : https://docs.aws.amazon.com/amazondynamodb/latest/developerguide/Streams.Lambda.Tutorial2.html
        new lambda.EventSourceMapping(this, `${id}DdbStreamMapping`, {
            eventSourceArn: ddbTable.tableStreamArn,
            target: fnStream,
            maxBatchingWindow: Duration.seconds(1),
            batchSize: 1,
            filters: [ 
                lambda.FilterCriteria.filter({
                    eventName: lambda.FilterRule.isEqual("INSERT"),
                })
            ],
            startingPosition: lambda.StartingPosition.LATEST
        });

        NagSuppressions.addResourceSuppressions(this, [
            { id: 'AwsPrototyping-LambdaLatestVersion', reason: 'sync with develoopement envitonment python 3.11' },
            { id: 'AwsPrototyping-IAMNoWildcardPermissions', reason: 'it is an utility function to create custom resource for kafka topics' }
        ], true);
    }

    private createDdbStreamProcessingFunction(id: string, props: DynamoDBStreamsToMskProps): lambda.Function{
        const stack = Stack.of(this);
        const { namespace, vpc, securityGroup, cluster, ddbTable, mskTopicName } = props;

        const lambdaLayer = new PythonLayerVersion(this, `${id}LambdaLayer`, {
            entry: '../lambda/stream-pipeline/kafka-lambda-layer',
            compatibleRuntimes: [lambda.Runtime.PYTHON_3_11],
            compatibleArchitectures: [lambda.Architecture.ARM_64],
            removalPolicy: RemovalPolicy.DESTROY
        });

        const fnStream = new lambda.Function(this, `${id}DdbStreamHandler`, {
            runtime: lambda.Runtime.PYTHON_3_11,
            code: lambda.Code.fromAsset('../lambda/stream-pipeline/ddb-stream-to-msk-lambda'),
            handler: 'index.handle',
            memorySize: 512,
            architecture: lambda.Architecture.ARM_64,
            vpc: vpc,
            vpcSubnets: vpc.selectSubnets({ subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS }),
            securityGroups: [securityGroup],
            functionName: `${namespace}${id}DdbStreamFunction`,
            timeout: Duration.minutes(5),
            environment: {
                'REGION': stack.region,
                'BOOTSTRAP_ADDRESS': cluster.bootstrapBrokersSaslIam,
                'TOPIC_NAME': mskTopicName
            },
            layers: [lambdaLayer],
            role: new iam.Role(this, `${id}DdbStreamFunctionRole`, {
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

        fnStream.addToRolePolicy(new iam.PolicyStatement({
            effect: iam.Effect.ALLOW,
            actions: [
                "dynamodb:DescribeStream",
                "dynamodb:GetRecords",
                "dynamodb:GetShardIterator",
                "dynamodb:ListStreams"
            ],
            resources: [
                `${ddbTable.tableArn}`,
                `${ddbTable.tableArn}/*`,
            ]
        }));

        fnStream.addToRolePolicy(new iam.PolicyStatement({
            effect: iam.Effect.ALLOW,
            actions: [
                // connect and auth
                "kafka-cluster:Connect",
                "kafka-cluster:AlterCluster",
                "kafka-cluster:DescribeCluster",
                "kafka-cluster:WriteDataIdempotently",
                // topic policy
                "kafka-cluster:DescribeTopic", 
                "kafka-cluster:WriteData",
                "kafka-cluster:ReadData"
            ],
            resources: ["*"]
        }));

        return fnStream;
    }

}