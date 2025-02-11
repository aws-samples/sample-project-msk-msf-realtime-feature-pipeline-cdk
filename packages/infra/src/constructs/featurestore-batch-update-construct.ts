import * as msk from '@aws-cdk/aws-msk-alpha';
import { PythonFunction, PythonLayerVersion } from '@aws-cdk/aws-lambda-python-alpha';
import { Construct } from "constructs";
import { 
    Stack,
    RemovalPolicy,
    Duration,
    aws_lambda as lambda,
    aws_s3 as s3,
    aws_iam as iam,
    aws_events as events,
    aws_events_targets as targets,
} from "aws-cdk-lib";
import { NagSuppressions } from 'cdk-nag';
import config from '../config';

export interface FeatureStoreBatchUpdateProps {
    sourceFeatureGroupName: string; 
    targetFeatureGroupName: string;
}

export class FeatureStoreBatchUpdate extends Construct {
    constructor(scope: Construct, id: string, props: FeatureStoreBatchUpdateProps) {
        super(scope, id);

        const stack = Stack.of(this);
        const {namespace, featureUpdateBatch} = config;
        const {sourceFeatureGroupName, targetFeatureGroupName} = props; 

        // Query Bucket
        const bucketName = `${namespace}-${stack.account}-${stack.region}-feature-equery`;
        const queryBucket = this.createQueryBucket(id, bucketName);

        // Lambda Function
        const fnProcessing = this.createFeatureProcessingFunction(id, namespace, queryBucket.bucketName, sourceFeatureGroupName, targetFeatureGroupName);

        // Batch Schedule (00:30 KST -> 15:30 UTC)
        // https://docs.aws.amazon.com/eventbridge/latest/userguide/scheduled-events.html#cron-expressions
        if(featureUpdateBatch.enabled) {
            console.log('batch enabled')
            new events.Rule(this, `${id}Schedule`, {
                ruleName: `${namespace}-feature-processing-batch`,
                schedule: events.Schedule.cron({
                    hour: featureUpdateBatch.hour,
                    minute: featureUpdateBatch.minute,
                }),
                targets: [new targets.LambdaFunction(fnProcessing)]
            });
        }

        NagSuppressions.addResourceSuppressions(this, [
            { id: 'AwsPrototyping-LambdaLatestVersion', reason: 'sync with develoopement envitonment python 3.11' },
            { id: 'AwsPrototyping-IAMNoWildcardPermissions', reason: 'it is an utility function to access sagemaker/s3/athena/glue resources' },
        ], true);
    }

    private createQueryBucket(id: string, bucketName: string): s3.Bucket {        
        return new s3.Bucket(this, `${id}QueryBucket`, {
            bucketName: bucketName,
            encryption: s3.BucketEncryption.S3_MANAGED,
            blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
            enforceSSL: true,
            serverAccessLogsPrefix: 'logs/',
            removalPolicy: RemovalPolicy.DESTROY,
            autoDeleteObjects: true,
        });
    }

    private createFeatureProcessingFunction(id: string, namespace: string, queryBucketName: string, sourceFeatureGroupName: string, targetFeatureGroupName: string): lambda.Function{
        const stack = Stack.of(this);

        const lambdaLayer = new PythonLayerVersion(this, `${id}LambdaLayer`, {
            entry: '../lambda/stream-pipeline/sagemaker-lambda-layer',
            compatibleRuntimes: [lambda.Runtime.PYTHON_3_11],
            compatibleArchitectures: [lambda.Architecture.ARM_64],
            removalPolicy: RemovalPolicy.DESTROY
        });

        const fnStream = new lambda.Function(this, `${id}Handler`, {
            runtime: lambda.Runtime.PYTHON_3_11,
            code: lambda.Code.fromAsset('../lambda/stream-pipeline/featurestore-batch-lambda'),
            handler: 'index.handle',
            functionName: `${namespace}${id}Function`,
            timeout: Duration.minutes(10),
            memorySize: 4096,
            architecture: lambda.Architecture.ARM_64,
            layers: [lambdaLayer],
            environment: {
                "PROJECT_NAMESPACE": namespace,
                "QUERY_BUCKET_NAME": queryBucketName,
                "SOURCE_FEATURE": sourceFeatureGroupName, //"proto-contry-feature",
                "TARGET_FEATURE": targetFeatureGroupName, //"proto-contry-daily-feature",
            },
            role: new iam.Role(this, `${id}Role`, {
                assumedBy: new iam.ServicePrincipal('lambda.amazonaws.com'),
                inlinePolicies:{
                    "LambdaVpcInvoke": new iam.PolicyDocument({
                        statements: [
                            new iam.PolicyStatement({
                                effect: iam.Effect.ALLOW,
                                actions: [
                                    // Lambda default role 
                                    "logs:CreateLogGroup",
                                    "logs:CreateLogStream",
                                    "logs:PutLogEvents",
                                ],
                                resources: ['*']
                            })
                        ]
                    })
                }
            })
        });

        // SageMaker FeatureStore Access
        fnStream.addToRolePolicy(new iam.PolicyStatement({
            effect: iam.Effect.ALLOW,
            actions: [                
                "sagemakerfeaturestore:DescribeFeatureGroup",
                "sagemakerfeaturestore:ListFeatureGroups",
                "sagemaker:DescribeFeatureGroup",
                "sagemaker:ListFeatureGroups",
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