import { 
    aws_iam as iam,
    RemovalPolicy, 
    CfnOutput
} from "aws-cdk-lib";
import {
    FlowLogDestination,
    FlowLogTrafficType,
    GatewayVpcEndpointAwsService,
    InterfaceVpcEndpointAwsService,
    SubnetType,
    Vpc,
    IVpc,
    SecurityGroup,
    ISecurityGroup,
    Peer,
    Port,
} from "aws-cdk-lib/aws-ec2";
import { LogGroup, RetentionDays } from "aws-cdk-lib/aws-logs";
import { Construct } from "constructs";

export interface SimpleVpcProps {
    vpcName: string;
    removalPolicy?: RemovalPolicy;
}

export class SimpleVpc extends Construct {
    readonly vpc: Vpc;
    readonly mskSecurityGroup: ISecurityGroup;
    readonly lambdaSecurityGroup: ISecurityGroup;
    readonly msfSecurityGroup: ISecurityGroup;

    constructor(scope: Construct, id: string, props: SimpleVpcProps) {
        super(scope, id);

        const { vpcName, removalPolicy } = props;

        const cloudWatchLogs = new LogGroup(this, "FlowLogs", {
            // TO-DO: check removal policy in production
            retention: RetentionDays.ONE_MONTH,
            removalPolicy: RemovalPolicy.DESTROY,
        });

        this.vpc = new Vpc(this, "Vpc", {
            vpcName: vpcName,
            subnetConfiguration: [
                {
                    cidrMask: 24,
                    name: "ingress",
                    subnetType: SubnetType.PUBLIC,
                    mapPublicIpOnLaunch: false,
                },
                {
                    cidrMask: 24,
                    name: "egress",
                    subnetType: SubnetType.PRIVATE_WITH_EGRESS,
                },
                {
                    cidrMask: 24,
                    name: "isolated",
                    subnetType: SubnetType.PRIVATE_ISOLATED,
                },
            ],
            flowLogs: {
                cloudwatch: {
                    destination: FlowLogDestination.toCloudWatchLogs(cloudWatchLogs),
                    trafficType: FlowLogTrafficType.ALL,
                },
            },
            natGateways: 1,
        });

        // create security group for applications        
        this.msfSecurityGroup = this.createSecurityGroupForMsf(this.vpc);
        this.lambdaSecurityGroup = this.createSecurityGroupForLambda(this.vpc);

        // create SecurityGroup for MSK
        this.mskSecurityGroup = this.createSecurityGroupForMSK(this.vpc, [
            this.msfSecurityGroup,
            this.lambdaSecurityGroup
        ]);

        // Vpc Endpoints
        this.createVpcEndpoints(this.vpc);
        //this.createVpcEndpointsForMskEvent(this.vpc, this.mskSecurityGroup);

        // TO-DO: check removal policy in production
        this.vpc.applyRemovalPolicy(removalPolicy ? removalPolicy : RemovalPolicy.DESTROY)

        // Export outputs
        new CfnOutput(this, "VpcId", { value: this.vpc.vpcId });
        new CfnOutput(this, "MskSecurityGroupId", { value: this.mskSecurityGroup.securityGroupId });
        new CfnOutput(this, "MsfSecurityGroupId", { value: this.msfSecurityGroup.securityGroupId });
        new CfnOutput(this, "LambdaSecurityGroupId", { value: this.lambdaSecurityGroup.securityGroupId });
    }

    private createVpcEndpoints(vpc: IVpc) {
        vpc.addGatewayEndpoint("S3VpcE", { service: GatewayVpcEndpointAwsService.S3 });
        vpc.addGatewayEndpoint("DdbVpcE", { service: GatewayVpcEndpointAwsService.DYNAMODB });
    }

    // Network Setting for msk event
    // https://docs.aws.amazon.com/ko_kr/lambda/latest/dg/services-msk-tutorial.html
    private createSecurityGroupForMSK(vpc: IVpc, associatedSecurityGroups: ISecurityGroup[]): SecurityGroup {
        const mskSecurityGroup = new SecurityGroup(this, 'MskSecurityGroup', {
            vpc,
            description: 'Security group for MSK cluster',
            allowAllOutbound: true
        });

        // 클라이언트 접근을 위한 인바운드 규칙 추가
        // https://docs.aws.amazon.com/msk/latest/developerguide/port-info.html
        for(const sg of associatedSecurityGroups) {
            mskSecurityGroup.connections.allowFrom(sg, Port.tcp(9098), `MSK IAM Auth for ${sg.securityGroupId}`);
        }

        // MSK EventSourceMapping 을 위한 자체 인바운드 룰 설정
        mskSecurityGroup.connections.allowFrom(mskSecurityGroup, Port.tcp(9098), 'default, security group internal routing');
        mskSecurityGroup.connections.allowFrom(mskSecurityGroup, Port.tcp(443), 'default, security group internal routing');

        return mskSecurityGroup;
    }

    private createSecurityGroupForLambda(vpc: IVpc,) {
        const sgLambda = new SecurityGroup(this, 'LambdaSecurityGroup', { 
            vpc,
            allowAllOutbound: true,
        });

        return sgLambda;
    }

    private createSecurityGroupForMsf(vpc: IVpc) {
        const sgMsf = new SecurityGroup(this, 'MsfSecurityGroup', { 
            vpc,
            allowAllOutbound: true,
        });

        return sgMsf;
    }
}
