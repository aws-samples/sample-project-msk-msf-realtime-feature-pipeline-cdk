// Copyright 2025 Amazon.com, Inc. or its affiliates
// SPDX-License-Identifier: MIT-0

import {
    Stack,
    StackProps,
    Duration,
    CfnOutput,
    aws_lambda as lambda,
    aws_iam as iam,
    aws_apigatewayv2 as apigatewayv2,
    aws_apigatewayv2_integrations as apigatewayv2_integrations,
    aws_apigatewayv2_authorizers as apigatewayv2_authorizers,
} from "aws-cdk-lib";
import { Construct } from "constructs";
import { NagSuppressions } from "cdk-nag";

import { config } from "../config";
import { namespaced, namespacedKey, putParameter } from "../util/common";

export interface ApigwStackProps extends StackProps {

}

export class ApigwStack extends Stack {

    constructor(scope: Construct, id: string, props: ApigwStackProps) {
        super(scope, id, props);

        const { namespace, parameterStoreKeys } = config;

        // Lambda authorizer function
        const authorizerFnRole = new iam.Role(this, `${id}SimpleAuthFunctionRole`, {
            assumedBy: new iam.ServicePrincipal('lambda.amazonaws.com'),
            inlinePolicies:{
                "LambdaInvoke": new iam.PolicyDocument({
                    statements: [
                        new iam.PolicyStatement({
                            effect: iam.Effect.ALLOW,
                            actions: [
                                "logs:CreateLogGroup",
                                "logs:CreateLogStream",
                                "logs:PutLogEvents",
                            ],
                            resources: ['*']
                        })
                    ]
                })
            }
        });
        const authorizer = new lambda.Function(this, 'SimpleAuthorizerFunction', {
            functionName: namespaced('api-authorizer', namespace),
            runtime: lambda.Runtime.PYTHON_3_11,
            handler: 'index.handler',
            code: lambda.Code.fromAsset('../lambda/api/apigw-authorizer'),
            role: authorizerFnRole
        });

        // Http API Authorizer
        const httpAuthorizer = new apigatewayv2_authorizers.HttpLambdaAuthorizer('SimpleHttpAuthorizer', authorizer, {
            authorizerName: 'prototype-authorizer',
            identitySource: ['$request.header.Authorization'],
            responseTypes: [apigatewayv2_authorizers.HttpLambdaResponseType.SIMPLE],
        });

        // HTTP API
        const httpApi = new apigatewayv2.HttpApi(this, 'SimpleHttpApi', {
            apiName: namespaced('demo-api', namespace),
            corsPreflight: {
                allowOrigins: ["*"],
                allowMethods: [
                    apigatewayv2.CorsHttpMethod.POST,
                    apigatewayv2.CorsHttpMethod.GET,
                    apigatewayv2.CorsHttpMethod.PUT,
                    apigatewayv2.CorsHttpMethod.DELETE,
                    apigatewayv2.CorsHttpMethod.OPTIONS,
                ],
                allowHeaders: [
                    "Authorization",
                    "Content-Type",
                    "X-Amzn-Trace-Id",
                    "X-Requested-With",
                ],
                allowCredentials: false,
                maxAge: Duration.hours(1),
            },
            defaultAuthorizer: httpAuthorizer
        });

        // Lambda function
        const httpEventFnRole = new iam.Role(this, `${id}HttpEventFunctionRole`, {
            assumedBy: new iam.ServicePrincipal('lambda.amazonaws.com'),
            inlinePolicies:{
                "LambdaInvoke": new iam.PolicyDocument({
                    statements: [
                        new iam.PolicyStatement({
                            effect: iam.Effect.ALLOW,
                            actions: [
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
        const lambdaFunction = new lambda.Function(this, 'HttpEventHandler', {
            functionName: namespaced('api-get-feature', namespace),
            runtime: lambda.Runtime.PYTHON_3_11,
            handler: 'index.handler',
            code: lambda.Code.fromAsset('../lambda/api/apigw-get-feature'),
            role: httpEventFnRole
        });
        lambdaFunction.addToRolePolicy(new iam.PolicyStatement({
            effect: iam.Effect.ALLOW,
            actions: [
                "sagemakerfeaturestore:DescribeFeatureGroup",
                "sagemaker:GetRecord",
                "sagemaker:BatchGetRecord",
                "featurestore-runtime:GetRecord",
                "featurestore-runtime:BatchGetRecord",
            ],
            resources: [ '*' ]
        }));

        // Lambda integration
        const lambdaIntegration = new apigatewayv2_integrations.HttpLambdaIntegration('LambdaIntegration', lambdaFunction);

        // Add route with authorizer
        httpApi.addRoutes({
            path: '/feature/{featuregroup}/{pk}',
            methods: [apigatewayv2.HttpMethod.GET],
            integration: lambdaIntegration,
            authorizer: httpAuthorizer,
        });

        // Output the API URL
        new CfnOutput(this, 'ApiUrl', { value: httpApi.url!, description: 'Online Feature HTTP API URL' });
        putParameter(this, namespacedKey(parameterStoreKeys.apigwUrl, namespace), httpApi.url!, 'Online Feature HTTP API URL');

        NagSuppressions.addResourceSuppressions(authorizerFnRole, [
            { id: 'AwsPrototyping-IAMNoWildcardPermissions', reason: 'use whildcard to authotize multiple apis' },
        ], true);
        NagSuppressions.addResourceSuppressions(httpEventFnRole, [
            { id: 'AwsPrototyping-IAMNoWildcardPermissions', reason: 'use whildcard to access feature groups for http response' },
        ], true);
        NagSuppressions.addStackSuppressions(this, [
            { id: 'AwsPrototyping-LambdaLatestVersion', reason: 'sync with develoopement envitonment python 3.11' },            
        ], true);
    }
}