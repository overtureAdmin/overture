import * as cdk from 'aws-cdk-lib';
import { Construct } from 'constructs';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import * as ecs from 'aws-cdk-lib/aws-ecs';
import * as ecsPatterns from 'aws-cdk-lib/aws-ecs-patterns';
import * as ecr from 'aws-cdk-lib/aws-ecr';

export class InfraStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    // Import existing VPC by name
    const vpc = ec2.Vpc.fromLookup(this, 'ExistingVpc', {
      vpcName: 'unity-appeals-dev-vpc-vpc',
    });

    // App Security Group (ECS tasks) - created/managed by CDK
    const appSg = new ec2.SecurityGroup(this, 'UnityAppealsAppSg', {
      vpc,
      securityGroupName: 'unity-appeals-dev-app-sg',
      description: 'Security group for Unity Appeals ECS app',
      allowAllOutbound: true,
    });

    // Security group dedicated to VPC interface endpoints
    const endpointsSg = new ec2.SecurityGroup(this, 'UnityAppealsEndpointsSg', {
      vpc,
      securityGroupName: 'unity-appeals-dev-endpoints-sg',
      description: 'Security group for Unity Appeals VPC interface endpoints',
      allowAllOutbound: true,
    });

    // Allow ECS tasks to reach endpoint ENIs on TLS port
    endpointsSg.addIngressRule(
      appSg,
      ec2.Port.tcp(443),
      'Allow ECS tasks to access interface endpoints over TLS'
    );

    // ALB Security Group - already exists, import it
    const albSg = ec2.SecurityGroup.fromSecurityGroupId(
      this,
      'ExistingAlbSg',
      'sg-0eb1ef4f97ee4c029',
      { mutable: true }
    );

    // Ensure ALB -> App allowed on port 3000
    appSg.addIngressRule(albSg, ec2.Port.tcp(3000), 'Allow ALB to reach app on 3000');

    // ECS Cluster (dev)
    const cluster = new ecs.Cluster(this, 'UnityAppealsCluster', {
      vpc,
      clusterName: 'unity-appeals-dev-cluster',
    });

    const endpointSubnets: ec2.SubnetSelection = { subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS };

    // Required interface endpoints for private ECS startup path
    const logsEndpoint = new ec2.InterfaceVpcEndpoint(this, 'LogsVpcEndpoint', {
      vpc,
      service: ec2.InterfaceVpcEndpointAwsService.CLOUDWATCH_LOGS,
      privateDnsEnabled: true,
      securityGroups: [endpointsSg],
      subnets: endpointSubnets,
    });

    const secretsManagerEndpoint = new ec2.InterfaceVpcEndpoint(this, 'SecretsManagerVpcEndpoint', {
      vpc,
      service: ec2.InterfaceVpcEndpointAwsService.SECRETS_MANAGER,
      privateDnsEnabled: true,
      securityGroups: [endpointsSg],
      subnets: endpointSubnets,
    });

    const kmsEndpoint = new ec2.InterfaceVpcEndpoint(this, 'KmsVpcEndpoint', {
      vpc,
      service: ec2.InterfaceVpcEndpointAwsService.KMS,
      privateDnsEnabled: true,
      securityGroups: [endpointsSg],
      subnets: endpointSubnets,
    });

    const ecrApiEndpoint = new ec2.InterfaceVpcEndpoint(this, 'EcrApiVpcEndpoint', {
      vpc,
      service: ec2.InterfaceVpcEndpointAwsService.ECR,
      privateDnsEnabled: true,
      securityGroups: [endpointsSg],
      subnets: endpointSubnets,
    });

    const ecrDkrEndpoint = new ec2.InterfaceVpcEndpoint(this, 'EcrDockerVpcEndpoint', {
      vpc,
      service: ec2.InterfaceVpcEndpointAwsService.ECR_DOCKER,
      privateDnsEnabled: true,
      securityGroups: [endpointsSg],
      subnets: endpointSubnets,
    });

    const stsEndpoint = new ec2.InterfaceVpcEndpoint(this, 'StsVpcEndpoint', {
      vpc,
      service: ec2.InterfaceVpcEndpointAwsService.STS,
      privateDnsEnabled: true,
      securityGroups: [endpointsSg],
      subnets: endpointSubnets,
    });

    // ECR repo for the web image
    const webRepo = ecr.Repository.fromRepositoryName(this, 'WebRepo', 'unity-appeals-web');

    // TaskDefinition pinned to ARM64 (matches your pushed image)
    const taskDef = new ecs.FargateTaskDefinition(this, 'WebTaskDef', {
      cpu: 256,
      memoryLimitMiB: 512,
      runtimePlatform: {
        cpuArchitecture: ecs.CpuArchitecture.ARM64,
        operatingSystemFamily: ecs.OperatingSystemFamily.LINUX,
      },
    });

    taskDef.addContainer('web', {
      image: ecs.ContainerImage.fromEcrRepository(webRepo, 'latest'),
      logging: ecs.LogDrivers.awsLogs({ streamPrefix: 'web' }),
      portMappings: [{ containerPort: 3000 }],
    });

    // Web service behind an internet-facing ALB
    const webService = new ecsPatterns.ApplicationLoadBalancedFargateService(
      this,
      'UnityAppealsWebService',
      {
        cluster,
        publicLoadBalancer: true,
        desiredCount: 1,
        securityGroups: [appSg],
        taskSubnets: { subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS },
        taskDefinition: taskDef,
      }
    );

    // Add the pre-existing ALB SG (HTTPS allowed there)
    webService.loadBalancer.addSecurityGroup(albSg);

    new cdk.CfnOutput(this, 'AppSecurityGroupId', {
      value: appSg.securityGroupId,
    });

    new cdk.CfnOutput(this, 'AlbSecurityGroupId', {
      value: albSg.securityGroupId,
    });

    new cdk.CfnOutput(this, 'EndpointsSecurityGroupId', {
      value: endpointsSg.securityGroupId,
    });

    new cdk.CfnOutput(this, 'LogsVpcEndpointId', {
      value: logsEndpoint.vpcEndpointId,
    });

    new cdk.CfnOutput(this, 'SecretsManagerVpcEndpointId', {
      value: secretsManagerEndpoint.vpcEndpointId,
    });

    new cdk.CfnOutput(this, 'KmsVpcEndpointId', {
      value: kmsEndpoint.vpcEndpointId,
    });

    new cdk.CfnOutput(this, 'EcrApiVpcEndpointId', {
      value: ecrApiEndpoint.vpcEndpointId,
    });

    new cdk.CfnOutput(this, 'EcrDockerVpcEndpointId', {
      value: ecrDkrEndpoint.vpcEndpointId,
    });

    new cdk.CfnOutput(this, 'StsVpcEndpointId', {
      value: stsEndpoint.vpcEndpointId,
    });

    new cdk.CfnOutput(this, 'WebLoadBalancerDnsName', {
      value: webService.loadBalancer.loadBalancerDnsName,
    });

    new cdk.CfnOutput(this, 'WebServiceUrl', {
      value: `http://${webService.loadBalancer.loadBalancerDnsName}`,
    });
  }
}
